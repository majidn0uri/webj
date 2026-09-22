import type { Queryable } from './client.js';
import { AppError } from '@set/shared-kernel';

/**
 * صدور شماره‌ی اسناد (بخش Q-1).
 *
 * ❌ ممنوع: SELECT MAX(order_no)+1  یا  COUNT(*)+1
 *    — این روش‌ها زیر بارِ همزمان، شماره‌ی تکراری یا خلأ تولید می‌کنند.
 * ✅ روشِ مجاز: یک UPDATE/INSERTِ اتمیک با RETURNING روی جدولِ counters؛
 *    پایگاه‌داده‌ی Postgres خودش همزمانی را مدیریت می‌کند.
 */
export interface NextNumberOptions {
  scope?: string;
  prefix?: string;
  /** تعداد ارقامِ شماره (مثال: ۶ → 000123) */
  pad?: number;
  /** افزودنِ سالِ شمسی به شماره (مثال: ORD-1405-000123) */
  jalaliYear?: number;
}

export interface NextNumber {
  value: bigint;
  formatted: string;
}

export async function nextNumber(
  db: Queryable,
  key: string,
  opts: NextNumberOptions = {},
): Promise<NextNumber> {
  const scope = opts.scope ?? 'global';

  const { rows } = await db.query<{ value: string | number | bigint }>(
    `INSERT INTO counters (scope, key, value)
     VALUES ($1, $2, 1)
     ON CONFLICT (scope, key)
     DO UPDATE SET value = counters.value + 1, updated_at = now()
     RETURNING value`,
    [scope, key],
  );

  const raw = rows[0]?.value;
  if (raw === undefined) throw new AppError('INTERNAL', { message: 'صدور شماره ناموفق بود' });

  const value = BigInt(raw);
  return { value, formatted: formatNumber(value, opts) };
}

export function formatNumber(value: bigint, opts: NextNumberOptions = {}): string {
  const pad = opts.pad ?? 6;
  const num = value.toString().padStart(pad, '0');
  const parts = [opts.prefix, opts.jalaliYear ? String(opts.jalaliYear) : null, num].filter(
    (p): p is string => Boolean(p),
  );
  return parts.join('-');
}
