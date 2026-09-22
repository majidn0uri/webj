import type { Queryable } from '@set/db';

/**
 * تنظیمات فروشگاه — پیش‌فرض‌های بخش ۱۱ سند، نشانده‌شده در خودِ پایگاه.
 *
 * چرا در پایگاه و نه در کد؟ چون مدیر باید بتواند مهلتِ مرجوعی یا سقفِ چک را
 * بدون انتشارِ نسخه‌ی جدید تغییر دهد؛ و چون هر تغییر باید در لاگ بماند.
 */
export interface StoreSetting {
  key: string;
  value: string;
  description: string;
}

const DEFAULTS: Record<string, string> = {
  sell_without_account: 'false',
  partner_price_mode: 'amount',
  discount_on_partner: 'false',
  trend_definition: 'auto_14d',
  coupon_enabled: 'false',
  show_price_to_guest: 'true',
  reviews_enabled: 'true',
  compare_enabled: 'false',
  blog_enabled: 'false',
  partner_check_online: 'after_receipt',
  return_window_days: '7',
  reserve_minutes: '15',
  payment_expiry_hours: '24',
  default_check_ceiling: '0',
  reorder_point_default: '10',
  cash_diff_alert_rial: '500000000',
  sms_enabled: 'false',
  sms_provider: 'none',
  sms_max_attempts: '5',
  sms_retry_minutes: '10',
  store_name: 'ست‌شاپ',
  store_phone: '021-00000000',
};

export async function getSetting(db: Queryable, key: string): Promise<string> {
  const { rows } = await db.query<{ value: string }>(
    `SELECT value FROM store_settings WHERE key = $1`,
    [key],
  );
  return rows[0]?.value ?? DEFAULTS[key] ?? '';
}

export async function getNumber(db: Queryable, key: string): Promise<number> {
  return Number(await getSetting(db, key));
}

export async function getBoolean(db: Queryable, key: string): Promise<boolean> {
  return (await getSetting(db, key)) === 'true';
}

export async function setSetting(
  db: Queryable,
  key: string,
  value: string,
  actorId?: string | null,
): Promise<void> {
  const previous = await getSetting(db, key);
  await db.query(
    `INSERT INTO store_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, value, actorId ?? null],
  );
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity, before_data, after_data)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [
      actorId ?? null,
      'setting.changed',
      'store_settings',
      JSON.stringify({ key, value: previous }),
      JSON.stringify({ key, value }),
    ],
  );
}

export async function listSettings(db: Queryable): Promise<StoreSetting[]> {
  const { rows } = await db.query<StoreSetting>(
    `SELECT key, value, description FROM store_settings ORDER BY key`,
  );
  return rows;
}
