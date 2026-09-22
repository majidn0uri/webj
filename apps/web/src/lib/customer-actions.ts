'use server';

import { revalidatePath } from 'next/cache';
import { adminPatch, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

/**
 * کنش‌هایِ مدیریتِ مشتری — سمتِ سرور.
 *
 * همان دلیلِ همیشگی: نشانه‌ی دسترسی در کوکیِ HttpOnly است و از مرورگر قابلِ
 * خواندن نیست، پس فراخوانیِ مستقیمِ مرورگر همیشه ۴۰۱ می‌گرفت.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

async function run(fn: (token: string) => Promise<unknown>, successMessage?: string): Promise<ActionResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشستِ شما پایان یافته است؛ دوباره وارد شوید.' };
  try {
    await fn(token);
    revalidatePath('/admin/customers');
    return { ok: true, message: successMessage };
  } catch (err) {
    if (err instanceof AdminApiError) return { ok: false, message: err.message };
    if (err instanceof Error && err.message) return { ok: false, message: err.message };
    return { ok: false, message: 'خطایِ پیش‌بینی‌نشده؛ دوباره تلاش کنید.' };
  }
}

export interface UpdateCustomerInput {
  fullName?: string;
  email?: string | null;
  note?: string | null;
  creditLimitToman?: number;
  checkCeilingToman?: number;
  isPartner?: boolean;
}

export async function updateCustomer(
  id: string,
  input: UpdateCustomerInput,
): Promise<ActionResult> {
  return run((token) => adminPatch(`/admin/customers/${id}`, token, input), 'پرونده به‌روزرسانی شد.');
}

/**
 * مسدود یا فعال کردن. نشست‌هایِ بازِ مشتری در همان لحظه باطل می‌شوند —
 * مسدودسازی‌ای که فقط در ورودِ بعدی اثر کند، برایِ جلوگیری از سوءاستفاده
 * بی‌فایده است.
 */
export async function setCustomerStatus(
  id: string,
  block: boolean,
  reason?: string,
): Promise<ActionResult> {
  return run(
    (token) => adminPatch(`/admin/customers/${id}/status`, token, { block, reason: reason ?? null }),
    block ? 'حساب مسدود شد و نشست‌هایِ باز باطل شدند.' : 'حساب دوباره فعال شد.',
  );
}
