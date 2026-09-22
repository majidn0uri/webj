import type { Queryable } from '@set/db';
import { formatToman } from '@set/shared-kernel';
import { getBoolean, getSetting } from './settings.js';

/**
 * پیامک‌ها — متن‌ها در پایگاه‌اند، نه در کد (بخش ۶ سند).
 *
 * چرا در پایگاه؟ چون متنِ پیامک در ایران باید با قالبِ تأییدشده‌ی سامانه
 * (مانندِ کاوه‌نگار/ملی‌پیامک) یکی باشد؛ اگر متن در کد باشد، هر بار تغییرِ
 * متن یعنی انتشارِ نسخه. اینجا مدیر متن را ویرایش می‌کند و پیام با همان
 * قالب ارسال می‌شود.
 *
 * ارسال واقعی (در مرحله‌ی اتصالِ سامانه) از همین صفحه‌ی خروجی خوانده می‌شود؛
 * تا آن روز، پیام‌ها با وضعیتِ «در انتظار» ثبت می‌شوند تا چیزی گم نشود.
 */

export type SmsTemplateKey =
  | 'welcome'
  | 'otp_login'
  | 'order_paid'
  | 'order_confirmed'
  | 'order_shipped'
  | 'order_delivered'
  | 'check_due'
  | 'check_bounced'
  | 'product_back'
  | 'order_cancelled'
  | 'invoice_issued';

/**
 * متغیرهایی که هر قالب باید در متن داشته باشد.
 *
 * چرا بیرون از تابع؟ چون پنلِ تنظیمات هم باید آن‌ها را بخواند تا هنگامِ
 * ویرایشِ متن، همان‌جا بگوید «متغیرِ {store} افتاده است» — نه این‌که پیامکِ
 * ناقص برود و بعداً در صندوقِ پیامک‌ها دیده شود.
 */
export const REQUIRED_VARS: Record<SmsTemplateKey, string[]> = {
  welcome: ['store'],
  otp_login: ['store', 'code'],
  order_paid: ['store', 'order', 'amount'],
  order_confirmed: ['store', 'order'],
  order_shipped: ['store', 'order', 'tracking'],
  order_delivered: ['store', 'order'],
  check_due: ['store', 'check', 'amount', 'date'],
  check_bounced: ['store', 'check', 'phone'],
  product_back: ['store', 'product'],
  order_cancelled: ['store', 'order', 'amount'],
  invoice_issued: ['store', 'invoice', 'amount', 'link'],
};

export async function renderTemplate(
  db: Queryable,
  key: SmsTemplateKey,
  vars: Record<string, string | number> = {},
): Promise<string> {
  const { rows } = await db.query<{ body: string }>(
    `SELECT body FROM sms_templates WHERE key = $1 AND is_active = true`,
    [key],
  );
  const template = rows[0]?.body;
  if (!template) throw new Error(`قالب پیامک «${key}» یافت نشد`);

  const store = await getSetting(db, 'store_name');
  const phone = await getSetting(db, 'store_phone');
  const values: Record<string, string> = { store, phone };
  for (const [k, v] of Object.entries(vars)) values[k] = String(v);

  for (const required of REQUIRED_VARS[key] ?? []) {
    if (values[required] == null || values[required] === '') {
      throw new Error(`متغیرِ {${required}} برای قالب «${key}» مقدار ندارد`);
    }
  }

  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** مبالغ همیشه با واحدِ «تومان» می‌آیند (الزامِ بخش ۶) */
export function amountForSms(rial: bigint | string): string {
  return formatToman(BigInt(rial));
}

/**
 * ثبتِ پیام در صفحه‌ی خروجی. اگر پیامک غیرفعال باشد، پیام با وضعیتِ
 * «در انتظار» می‌ماند تا پس از اتصالِ سامانه، یک‌جا ارسال شود.
 */
export async function enqueueSms(
  db: Queryable,
  input: {
    phone: string;
    templateKey: SmsTemplateKey;
    vars?: Record<string, string | number>;
    body?: string;
  },
): Promise<{ id: string; body: string; skipped: boolean }> {
  const body = input.body ?? (await renderTemplate(db, input.templateKey, input.vars ?? {}));
  const enabled = await getBoolean(db, 'sms_enabled');

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO sms_outbox (phone, template_key, body, status)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [input.phone, input.templateKey, body, enabled ? 'pending' : 'pending'],
  );

  return { id: rows[0]?.id ?? '', body, skipped: !enabled };
}

export async function markSent(
  db: Queryable,
  id: string,
  providerRef?: string | null,
): Promise<void> {
  await db.query(
    `UPDATE sms_outbox SET status = 'sent', sent_at = now(), provider_ref = $1 WHERE id = $2`,
    [providerRef ?? null, id],
  );
}

export async function pendingSms(db: Queryable, limit = 50): Promise<
  Array<{ id: string; phone: string; body: string }>
> {
  const { rows } = await db.query<{ id: string; phone: string; body: string }>(
    `SELECT id, phone, body FROM sms_outbox WHERE status = 'pending' ORDER BY created_at LIMIT $1`,
    [limit],
  );
  return rows;
}
