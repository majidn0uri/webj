import type { Database, Queryable } from '@set/db';
import { AppError } from '@set/shared-kernel';
import { addMonths } from './eligibility.js';
import { readReturnSettings } from './service.js';
import type { WarrantyRow } from './types.js';

/**
 * گارانتی — تعهدی که پس از فروش تازه شروع می‌شود.
 *
 * چرا گارانتی جدولِ جدا است و نه دو ستون رویِ کالا؟
 * چون گارانتی «به یک نسخه‌یِ مشخص از کالا» وابسته است، نه به کالا در کل.
 * دو مشتری دو قابِ یک‌مدل می‌خرند: یکی را امروز تحویل می‌گیرد و یکی دو ماه
 * دیگر. گارانتیِ این دو یک تاریخِ پایان ندارد. پس هر ردیفِ سفارش می‌تواند یک
 * گارانتیِ مستقل داشته باشد (یکتایی روی order_item_id).
 *
 * و چرا تاریخِ پایان ذخیره می‌شود نه محاسبه؟ برای آنکه بتوان روی آن ایندکس
 * ساخت و پرسید «کدام گارانتی‌ها ماهِ دیگر تمام می‌شوند» — پرسشی که در فروشگاهِ
 * لوازمِ جانبی، مستقیم به فروشِ بعدی وصل است.
 */

export function warrantyEndsAt(startsAt: Date, months: number): Date {
  return addMonths(startsAt, months);
}

/** وضعیتِ واقعیِ گارانتی در یک لحظه (ستونِ status ممکن است کهنه باشد) */
export function effectiveStatus(warranty: WarrantyRow, now: Date = new Date()): 'active' | 'expired' | 'void' {
  if (warranty.status === 'void') return 'void';
  const ends = new Date(`${warranty.ends_at}T23:59:59.999Z`);
  return now.getTime() > ends.getTime() ? 'expired' : 'active';
}

export interface StartWarrantyInput {
  orderItemId: string;
  /** در صورتِ نبودن، از تنظیمات می‌آید */
  months?: number;
  provider?: 'manufacturer' | 'store' | 'seller';
  serialNo?: string | null;
  /** آغازِ گارانتی؛ پیش‌فرض: لحظه‌ی پرداختِ سفارش */
  startsAt?: Date;
  notes?: string | null;
}

/**
 * صدورِ گارانتی برایِ یک ردیفِ سفارش.
 *
 * آغازِ گارانتی از «پرداخت» حساب می‌شود، نه از ارسال — چون در این سامانه هنوز
 * رخدادِ تحویل ثبت نمی‌شود و سنجیدن از پرداخت به نفعِ مشتری است: مدتِ گارانتی
 * در مسیرِ ارسال خورده نمی‌شود.
 */
export async function startWarranty(
  db: Database,
  input: StartWarrantyInput,
): Promise<{ id: string; endsAt: string; months: number }> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      order_id: string;
      variant_id: string;
      user_id: string | null;
      customer_id: string | null;
      paid_at: string | null;
    }>(
      `SELECT oi.id, oi.order_id, oi.variant_id, o.user_id, o.customer_id, o.paid_at::text
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE oi.id = $1`,
      [input.orderItemId],
    );
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { message: 'ردیفِ سفارش یافت نشد.' });

    const settings = await readReturnSettings(tx);
    const months = input.months ?? settings.warrantyDefaultMonths;
    if (months <= 0) {
      throw new AppError('VALIDATION', { message: 'مدتِ گارانتی باید بیش از صفر باشد.' });
    }

    const startsAt = input.startsAt ?? (row.paid_at ? new Date(row.paid_at) : new Date());
    const endsAt = warrantyEndsAt(startsAt, months);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO warranties
         (order_item_id, order_id, variant_id, user_id, customer_id, serial_no, provider,
          starts_at, months, ends_at, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10::date,'active',$11)
       ON CONFLICT (order_item_id) DO UPDATE
         SET months = EXCLUDED.months, ends_at = EXCLUDED.ends_at,
             serial_no = COALESCE(EXCLUDED.serial_no, warranties.serial_no),
             notes = COALESCE(EXCLUDED.notes, warranties.notes)
       RETURNING id`,
      [
        row.id,
        row.order_id,
        row.variant_id,
        row.user_id,
        row.customer_id,
        input.serialNo ?? null,
        input.provider ?? 'manufacturer',
        iso(startsAt),
        months,
        iso(endsAt),
        input.notes ?? null,
      ],
    );

    return { id: inserted.rows[0]!.id, endsAt: iso(endsAt), months };
  });
}

export interface WarrantyFilter {
  userId?: string;
  /** گارانتی‌هایِ این مشتری */
  customerId?: string;
  /** «all» یعنی بی‌فیلتر — مقداری است که پنل برایِ «همه» می‌فرستد */
  status?: 'active' | 'expired' | 'claimed' | 'void' | 'all';
  /** فقط آن‌هایی که تا N روزِ دیگر پایان می‌یابند */
  expiringInDays?: number;
  q?: string;
  limit?: number;
}

export async function listWarranties(
  db: Queryable,
  filter: WarrantyFilter = {},
): Promise<Array<WarrantyRow & { title: string; sku: string | null; order_no: string; customer_name: string | null }>> {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.userId) {
    params.push(filter.userId);
    clauses.push(`w.user_id = $${params.length}`);
  }
  if (filter.customerId) {
    params.push(filter.customerId);
    clauses.push(`w.customer_id = $${params.length}`);
  }
  // «همه» یعنی بی‌فیلتر — نه وضعیتی به نامِ all (که هیچ ردیفی ندارد)
  const status = filter.status && filter.status !== 'all' ? filter.status : null;
  if (status === 'active') {
    clauses.push(`w.status = 'active' AND w.ends_at >= CURRENT_DATE`);
  } else if (status === 'expired') {
    clauses.push(`(w.status = 'expired' OR (w.status = 'active' AND w.ends_at < CURRENT_DATE))`);
  } else if (status) {
    params.push(status);
    clauses.push(`w.status = $${params.length}`);
  }
  if (filter.expiringInDays !== undefined) {
    params.push(filter.expiringInDays);
    clauses.push(`w.ends_at BETWEEN CURRENT_DATE AND CURRENT_DATE + ($${params.length} || ' days')::interval`);
  }
  if (filter.q && filter.q.trim()) {
    params.push(`%${filter.q.trim()}%`);
    clauses.push(
      `(p.title ILIKE $${params.length} OR v.sku ILIKE $${params.length}
        OR w.serial_no ILIKE $${params.length} OR o.order_no ILIKE $${params.length}
        OR o.customer_mobile ILIKE $${params.length})`,
    );
  }
  params.push(Math.min(Math.max(filter.limit ?? 50, 1), 200));

  const { rows } = await db.query<
    WarrantyRow & { title: string; sku: string | null; order_no: string; customer_name: string | null }
  >(
    `SELECT w.*, p.title, v.sku, o.order_no, o.customer_name
       FROM warranties w
       JOIN product_variants v ON v.id = w.variant_id
       JOIN products p ON p.id = v.product_id
       JOIN orders o ON o.id = w.order_id
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY w.ends_at
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/**
 * گارانتی‌هایی که به‌زودی پایان می‌یابند.
 *
 * این یک «گزارشِ قشنگ» نیست: پیامکی که ۳۰ روز پیش از پایانِ گارانتی برایِ
 * مشتری می‌رود، هم به نفعِ اوست و هم یکی از معدود راه‌هایِ بازگشتِ مشتری به
 * فروشگاهِ لوازمِ جانبی است — بدونِ آنکه آزاردهنده باشد.
 */
export async function expiringWarranties(db: Queryable, days = 30) {
  return listWarranties(db, { expiringInDays: days, limit: 200 });
}

export async function claimWarranty(
  db: Database,
  input: { warrantyId: string; note?: string | null; serialNo?: string | null },
): Promise<{ id: string; status: string }> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE warranties
        SET status = 'claimed',
            notes = COALESCE($2, notes),
            serial_no = COALESCE($3, serial_no)
      WHERE id = $1
      RETURNING id`,
    [input.warrantyId, input.note ?? null, input.serialNo ?? null],
  );
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', { message: 'گارانتی‌ای با این شناسه نیست.' });
  return { id: row.id, status: 'claimed' };
}
