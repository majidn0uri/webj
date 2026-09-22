import type { Queryable } from '@set/db';
import { AppError, type Rial } from '@set/shared-kernel';
import { getBoolean, getNumber } from './settings.js';

/**
 * مشتریان — سه نوع: حضوری، آنلاین، همکار (BR-20..BR-26)
 *
 * خط قرمزِ این ماژول: «اکانت تکراری نساز».
 * کلید یکتا کد ملی است و شناسه‌ی ورود موبایل؛ اگر با کد ملی مشتری پیدا شد،
 * هرگز اکانت جدید ساخته نمی‌شود — حتی اگر نام متفاوت باشد (در آن صورت هشدار
 * می‌دهیم تا مدیر ادغام کند؛ BR-21).
 */

export type CustomerKind = 'in_person' | 'online';

export interface Customer {
  id: string;
  national_id: string | null;
  phone: string;
  full_name: string;
  kind: CustomerKind;
  is_partner: boolean;
  is_active: boolean;
  check_ceiling_rial: string;
  credit_rial: string;
}

export interface FindOrCreateInput {
  nationalId?: string | null;
  phone: string;
  fullName: string;
  kind?: CustomerKind;
  createdBy?: string | null;
}

export interface FindOrCreateResult {
  customer: Customer;
  created: boolean;
  /** اگر کد ملی موجود بود اما نام متفاوت: هشدار برای ادغام (BR-21) */
  nameMismatch: boolean;
}

const NATIONAL_ID_RE = /^[0-9۰-۹]{10}$/;
const PHONE_RE = /^09[0-9۰-۹]{9}$/;

function toLatinDigits(input: string): string {
  return input.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

export function normalizePhone(phone: string): string {
  return toLatinDigits(phone.trim());
}

export function normalizeNationalId(id: string): string {
  return toLatinDigits(id.trim());
}

/** اعتبارسنجیِ کد ملی با الگوریتمِ ضرب در ارقام و باقیمانده (کنترلِ واقعی، نه فقط ۱۰ رقم) */
export function isValidNationalId(input: string): boolean {
  const code = normalizeNationalId(input);
  if (!NATIONAL_ID_RE.test(code)) return false;
  if (/^(\d)\1{9}$/.test(code)) return false; // ۱۱۱۱۱۱۱۱۱۱ و مانند آن

  const check = Number(code[9]);
  const sum = code
    .slice(0, 9)
    .split('')
    .reduce((acc, d, i) => acc + Number(d) * (10 - i), 0);
  const remainder = sum % 11;
  return remainder < 2 ? check === remainder : check === 11 - remainder;
}

/** یافتن بر اساس کد ملی یا موبایل — پیش از ساختِ هر اکانتِ حضوری الزامی (BR-20) */
export async function findCustomer(
  db: Queryable,
  q: { nationalId?: string | null; phone?: string | null },
): Promise<Customer | null> {
  if (q.nationalId) {
    const { rows } = await db.query<Customer>(
      `SELECT * FROM customers WHERE national_id = $1`,
      [normalizeNationalId(q.nationalId)],
    );
    if (rows[0]) return rows[0];
  }
  if (q.phone) {
    const { rows } = await db.query<Customer>(
      `SELECT * FROM customers WHERE phone = $1`,
      [normalizePhone(q.phone)],
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

export async function findOrCreateCustomer(
  db: Queryable,
  input: FindOrCreateInput,
): Promise<FindOrCreateResult> {
  const phone = normalizePhone(input.phone);
  if (!PHONE_RE.test(phone)) {
    throw new AppError('VALIDATION', { message: 'شماره موبایل باید با ۰۹ و ۱۱ رقم باشد' });
  }

  const nationalId = input.nationalId ? normalizeNationalId(input.nationalId) : null;
  if (nationalId && !isValidNationalId(nationalId)) {
    throw new AppError('VALIDATION', { message: 'کد ملی معتبر نیست' });
  }

  // ۱) کد ملی یکتاست: اگر یافت شد، همان اکانت (BR-20 , BR-21)
  if (nationalId) {
    const byId = await findCustomer(db, { nationalId });
    if (byId) {
      return {
        customer: byId,
        created: false,
        nameMismatch: byId.full_name.trim() !== input.fullName.trim(),
      };
    }
  }

  // ۲) موبایل یکتاست
  const byPhone = await findCustomer(db, { phone });
  if (byPhone) {
    // اگر اکانت با موبایل پیدا شد ولی کد ملی نداشت، کد ملی را تکمیل می‌کنیم
    if (nationalId && !byPhone.national_id) {
      const { rows } = await db.query<Customer>(
        `UPDATE customers SET national_id = $1, updated_at = now() WHERE id = $2 RETURNING *`,
        [nationalId, byPhone.id],
      );
      return { customer: rows[0] ?? byPhone, created: false, nameMismatch: false };
    }
    return {
      customer: byPhone,
      created: false,
      nameMismatch: byPhone.full_name.trim() !== input.fullName.trim(),
    };
  }

  // ۳) مشتری جدید
  const { rows } = await db.query<Customer>(
    `INSERT INTO customers (national_id, phone, full_name, kind, check_ceiling_rial, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      nationalId,
      phone,
      input.fullName.trim(),
      input.kind ?? 'online',
      String(await getNumber(db, 'default_check_ceiling')),
      input.createdBy ?? null,
    ],
  );
  const created = rows[0];
  if (!created) throw new AppError('INTERNAL', { message: 'ساختِ مشتری ناموفق بود' });

  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity, entity_id, after_data)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.createdBy ?? null,
      'customer.created',
      'customers',
      created.id,
      JSON.stringify({ phone, nationalId, kind: created.kind }),
    ],
  );

  return { customer: created, created: true, nameMismatch: false };
}

/** تغییر وضعیتِ همکار — فقط مدیر (BR-22) + ثبت در لاگ */
export async function setPartnerStatus(
  db: Queryable,
  input: {
    customerId: string;
    isPartner: boolean;
    actorId?: string | null;
    reason: string;
    checkCeilingRial?: bigint | number | null;
  },
): Promise<Customer> {
  const { rows: before } = await db.query<Customer>(
    `SELECT * FROM customers WHERE id = $1`,
    [input.customerId],
  );
  const current = before[0];
  if (!current) throw new AppError('NOT_FOUND', { message: 'مشتری یافت نشد' });

  // لغو همکاری: چک‌های باز باید تسویه یا تضمین شوند (BR-25)
  if (current.is_partner && !input.isPartner) {
    const { rows: open } = await db.query<{ cnt: string; total: string }>(
      `SELECT COUNT(*)::text AS cnt, COALESCE(SUM(amount_rial),0)::text AS total
         FROM checks
        WHERE drawer_id = $1 AND status IN ('in_circulation','deposited')`,
      [input.customerId],
    );
    const openCount = Number(open[0]?.cnt ?? 0);
    if (openCount > 0 && !input.reason.includes('تضمین')) {
      throw new AppError('CONFLICT', {
        message: `این همکار ${openCount} چکِ وصول‌نشده به مبلغ ${open[0]?.total ?? '0'} ریال دارد؛ پیش از لغو همکاری باید تسویه یا تضمین شود`,
      });
    }
  }

  const ceiling = input.checkCeilingRial != null ? String(input.checkCeilingRial) : null;
  const { rows } = await db.query<Customer>(
    `UPDATE customers
        SET is_partner = $1,
            partner_since = CASE WHEN $1 THEN now() ELSE partner_since END,
            partner_ended_at = CASE WHEN $1 THEN NULL ELSE now() END,
            check_ceiling_rial = COALESCE($2, check_ceiling_rial),
            updated_at = now()
      WHERE id = $3
      RETURNING *`,
    [input.isPartner, ceiling, input.customerId],
  );
  const updated = rows[0];
  if (!updated) throw new AppError('NOT_FOUND', { message: 'مشتری یافت نشد' });

  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity, entity_id, before_data, after_data)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      input.actorId ?? null,
      'customer.partner_changed',
      'customers',
      input.customerId,
      JSON.stringify({ isPartner: current.is_partner }),
      JSON.stringify({ isPartner: input.isPartner, reason: input.reason }),
    ],
  );

  return updated;
}

/**
 * ادغام دو اکانت تکراری — فقط مدیر (BR-21)
 * سابقه (سفارش‌ها، چک‌ها، اعتبار، آدرس‌ها) به اکانتِ مقصد منتقل و مبدأ غیرفعال می‌شود.
 */
export async function mergeCustomers(
  db: Queryable,
  input: { sourceId: string; targetId: string; actorId: string; reason: string },
): Promise<void> {
  if (input.sourceId === input.targetId) {
    throw new AppError('VALIDATION', { message: 'مبدأ و مقصد یکی است' });
  }

  await db.query(`UPDATE orders SET customer_id = $1 WHERE customer_id = $2`, [
    input.targetId,
    input.sourceId,
  ]);
  await db.query(`UPDATE checks SET drawer_id = $1 WHERE drawer_id = $2`, [
    input.targetId,
    input.sourceId,
  ]);
  await db.query(
    `UPDATE customers
        SET credit_rial = credit_rial + (SELECT credit_rial FROM customers WHERE id = $1),
            updated_at = now()
      WHERE id = $2`,
    [input.sourceId, input.targetId],
  );
  await db.query(`UPDATE customer_addresses SET customer_id = $1 WHERE customer_id = $2`, [
    input.targetId,
    input.sourceId,
  ]);
  // حذف ممنوع است (BR-23): فقط غیرفعال
  await db.query(
    `UPDATE customers
        SET is_active = false, deactivated_reason = $2, credit_rial = 0, updated_at = now()
      WHERE id = $1`,
    [input.sourceId, `ادغام در ${input.targetId}: ${input.reason}`],
  );

  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity, entity_id, before_data, after_data)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      input.actorId,
      'customer.merged',
      'customers',
      input.sourceId,
      JSON.stringify({ sourceId: input.sourceId, targetId: input.targetId }),
      JSON.stringify({ reason: input.reason }),
    ],
  );
}

/** افزایش/مصرفِ اعتبار خرید (مرجوعی → اعتبار) */
export async function changeCredit(
  db: Queryable,
  input: { customerId: string; deltaRial: Rial; actorId?: string | null; note: string },
): Promise<bigint> {
  const { rows } = await db.query<{ credit_rial: string }>(
    `UPDATE customers
        SET credit_rial = credit_rial + $1, updated_at = now()
      WHERE id = $2 AND credit_rial + $1 >= 0
      RETURNING credit_rial`,
    [input.deltaRial.toString(), input.customerId],
  );
  const row = rows[0];
  if (!row) {
    throw new AppError('CONFLICT', { message: 'موجودیِ اعتبار کافی نیست' });
  }
  return BigInt(row.credit_rial);
}

/** آیا فروشِ حضوری بدون کد ملی مجاز است؟ (BR-26 — پیش‌فرض: ممنوع) */
export async function canSellWithoutAccount(db: Queryable): Promise<boolean> {
  return getBoolean(db, 'sell_without_account');
}
