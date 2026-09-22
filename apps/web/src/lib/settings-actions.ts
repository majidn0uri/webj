'use server';

import { revalidatePath } from 'next/cache';
import { adminPatch, adminPost, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

/**
 * کنش‌هایِ تنظیمات و پیامک — سمتِ سرور.
 *
 * همان دلیلِ همیشگی: نشانه‌ی دسترسی در کوکیِ HttpOnly است و مرورگر نمی‌تواند
 * آن را در سرآیند بفرستد؛ پس فراخوانیِ مستقیم از مرورگر همواره ۴۰۱ می‌گرفت.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

async function run(fn: (token: string) => Promise<unknown>, successMessage?: string): Promise<ActionResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشستِ شما پایان یافته است؛ دوباره وارد شوید.' };
  try {
    await fn(token);
    revalidatePath('/admin/settings');
    return { ok: true, message: successMessage };
  } catch (err) {
    if (err instanceof AdminApiError) return { ok: false, message: err.message };
    if (err instanceof Error && err.message) return { ok: false, message: err.message };
    return { ok: false, message: 'خطایِ پیش‌بینی‌نشده؛ دوباره تلاش کنید.' };
  }
}

export async function saveSettings(values: Record<string, string>): Promise<ActionResult> {
  return run((token) => adminPatch('/admin/settings', token, { values }), 'تنظیمات ذخیره شد.');
}

/**
 * «همین حالا بفرست» — یک دورِ ارسالِ دستی رویِ صفِ پیامک.
 *
 * چرا نتیجه را برمی‌گردانیم و نه فقط «موفق»؟ چون پاسخِ درست اینجا عدد است:
 * چندتا رفت، چندتا دوباره در صف نشست، چندتا ناامیدکننده بود. مدیر که دکمه را
 * می‌زند، «ذخیره شد» به هیچ دردی نمی‌خورد — می‌خواهد بداند پیامک‌هایِ تأییدِ
 * سفارش واقعاً از سامانه رد شده‌اند یا نه.
 */
export async function flushSmsOutbox(): Promise<ActionResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشستِ شما پایان یافته است؛ دوباره وارد شوید.' };
  try {
    const r = await adminPost<{
      sent: number;
      failed: number;
      dead: number;
      claimed: number;
      notes: string[];
      dryRun: boolean;
    }>('/admin/settings/sms/outbox/flush', token, { limit: 20 });
    const bits = [
      `${r.sent} پیامک فرستاده شد`,
      r.failed ? `${r.failed} تا دوباره در صف نشست` : '',
      r.dead ? `${r.dead} تا از تلاش ناامیدکننده بود` : '',
      r.claimed === 0 ? 'صفی برای ارسال نبود' : '',
      r.dryRun ? '(حالتِ آزمایشی — به سامانه نرفت)' : '',
    ].filter(Boolean);
    const note = r.notes?.[0] ? ` · ${r.notes[0]}` : '';
    return { ok: true, message: bits.join('، ') + note };
  } catch (err) {
    if (err instanceof AdminApiError) return { ok: false, message: err.message };
    return { ok: false, message: 'ارسال انجام نشد؛ لاگِ سرویس را ببینید.' };
  }
}

/** نتیجهٔ «آزمونِ ارسال» — همان چیزی که در لاگِ کارگر گم می‌شود، اینجا خوانده می‌شود */
export type SmsTestResult = {
  ok: boolean;
  phone: string;
  provider: string;
  templateKey: string | null;
  providerTemplateId: string | null;
  vars: string[];
  body: string;
  dryRun: boolean;
  elapsedMs: number;
  httpStatus: number | null;
  providerCode: number | null;
  ref: string | null;
  raw: string | null;
  error: string | null;
  retryable: boolean | null;
  notes: string[];
  remainingTests?: number;
};

export type SmsTestOutcome = { ok: true; result: SmsTestResult } | { ok: false; message: string };

/**
 * «آزمونِ ارسال» — یک پیامکِ واقعی به شماره‌یِ خودِ مدیر.
 *
 * چرا نتیجه را کامل برمی‌گردانیم (نه «موفق/ناموفق»)؟ چون تمامِ ارزشِ این کار
 * در پاسخِ خامِ سامانه است: «اعتبار تمام شده»، «قالب تأیید نشده»، «کلید غلط»
 * و «شماره در سیاه‌list» چهار تشخیصِ متفاوت‌اند و هر چهار در یک پیامِ
 * «خطا»ی عمومی گم می‌شوند.
 */
export async function testSmsSend(input: {
  phone: string;
  templateKey?: string;
}): Promise<SmsTestOutcome> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشستِ شما پایان یافته است؛ دوباره وارد شوید.' };
  try {
    const result = (await adminPost('/admin/settings/sms/test', token, input)) as SmsTestResult;
    return { ok: true, result };
  } catch (err) {
    if (err instanceof AdminApiError) return { ok: false, message: err.message };
    return { ok: false, message: 'آزمون انجام نشد؛ سرویس در دسترس نیست.' };
  }
}

/** نتیجهٔ «بازگرداندنِ پیام‌هایِ مسدودشده» */
export type RequeueResult = {
  requeued: number;
  statuses: Record<string, number>;
  stillBlocked: number;
  notes: string[];
  counts: Record<string, number>;
};

export type RequeueOutcome = { ok: true; result: RequeueResult } | { ok: false; message: string };

/**
 * «بازگرداندنِ صف» — پس ازِ پرکردنِ شناسهٔ قالب یا کلید، پیام‌هایی که به‌خاطرِ
 * همین خانه‌هایِ خالی در صف مانده‌اند (و بعضی‌شان به «ناامیدکننده» رسیده‌اند)
 * دوباره نوبت می‌گیرند.
 *
 * چرا `templateKey` اختیاری است؟ چون مدیرِ عاقل اول یک قالب را پر می‌کند و
 * همان را می‌آزماید؛ بازگرداندنِ همه‌چیز در همان لحظه یعنی فرستادنِ پیام‌هایی
 * که قالب‌هایشان هنوز خالی است و سوزاندنِ دوبارهٔ تلاش‌ها.
 */
export async function requeueSmsOutbox(input: {
  templateKey?: string;
  includeWaiting?: boolean;
} = {}): Promise<RequeueOutcome> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشستِ شما پایان یافته است؛ دوباره وارد شوید.' };
  try {
    const result = (await adminPost('/admin/settings/sms/outbox/requeue', token, {
      limit: 500,
      ...(input.templateKey ? { templateKey: input.templateKey } : {}),
      ...(input.includeWaiting ? { includeWaiting: true } : {}),
    })) as RequeueResult;
    revalidatePath('/admin/settings');
    return { ok: true, result };
  } catch (err) {
    if (err instanceof AdminApiError) return { ok: false, message: err.message };
    return { ok: false, message: 'بازگردانی انجام نشد؛ سرویس در دسترس نیست.' };
  }
}

export async function saveSmsTemplate(
  key: string,
  input: { title?: string; body?: string; providerTemplateId?: string; isActive?: boolean },
): Promise<ActionResult> {
  return run(
    (token) => adminPatch(`/admin/settings/sms/templates/${key}`, token, input),
    'قالبِ پیامک ذخیره شد.',
  );
}
