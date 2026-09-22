/**
 * صفِ ارسالِ صورتحساب به سامانه‌یِ مؤدیان.
 *
 * چرا صف و نه ارسالِ مستقیم؟ سه دلیلِ واقعی، نه نظری:
 *   ۱) اینترنتِ ایران قطع و وصل می‌شود و سامانه‌یِ مؤدیان در ساعاتِ اوج
 *      پاسخ نمی‌دهد. اگر ارسال به درخواستِ لحظه‌ای گره بخورد، فروش ثبت می‌شود
 *      اما صورتحساب نه — و از نظرِ قانون، فروشِ بی‌صورتحساب یعنی کتمان.
 *   ۲) سامانه گاه درخواست را می‌پذیرد اما پاسخ به دستِ ما نمی‌رسد. برای همین
 *      «فرستاده‌شده» (sent) از «تأییدشده» (accepted) جداست و استعلامِ بعدی
 *      وضعیت را قطعی می‌کند. ارسالِ دوباره‌یِ یک صورتحسابِ پذیرفته‌شده خطاست
 *      (سریالِ تکراری)، پس پیش از ارسال وضعیت بررسی می‌شود.
 *   ۳) چند پردازشگر ممکن است همزمان بفرستند. قفل‌کردنِ ردیف‌ها با
 *      `FOR UPDATE SKIP LOCKED` جلویِ ارسالِ تکراری را می‌گیرد بدون اینکه
 *      پردازشگرها منتظرِ هم بمانند — همان الگویی که در پردازشِ صف‌هایِ
 *      بانکی به کار می‌رود.
 */

import { AppError, type Rial } from '@set/shared-kernel';
import type { Database, Transaction } from '@set/db';

export type TaxStatus = 'queued' | 'sending' | 'sent' | 'accepted' | 'rejected' | 'failed';

export interface TaxInvoiceRow {
  id: string;
  /** «فروش» (sale) یا «اصلاحیِ مرجوعی» (credit_note) — در یک صف‌اند، اما تکلیفِ قانونی‌شان یکی نیست */
  kind: 'sale' | 'credit_note';
  /** برایِ اصلاحی: شناسه‌یِ مرجوعی‌ای که این صورتحساب برایش صادر شده */
  customerReturnId: string | null;
  orderId: string;
  orderNo: string;
  periodKey: string;
  taxid: string | null;
  status: TaxStatus;
  payload: unknown;
  uid: string | null;
  referenceNumber: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
  respondedAt: string | null;
}

interface RawRow {
  id: string;
  invoice_kind: 'sale' | 'credit_note';
  customer_return_id: string | null;
  order_id: string;
  order_no: string;
  period_key: string;
  taxid: string | null;
  status: TaxStatus;
  payload: unknown;
  uid: string | null;
  reference_number: string | null;
  error_code: string | null;
  error_detail: string | null;
  attempts: number;
  created_at: string;
  sent_at: string | null;
  responded_at: string | null;
}

function mapRow(r: RawRow): TaxInvoiceRow {
  return {
    id: r.id,
    kind: r.invoice_kind,
    customerReturnId: r.customer_return_id,
    orderId: r.order_id,
    orderNo: r.order_no,
    periodKey: r.period_key,
    taxid: r.taxid,
    status: r.status,
    payload: r.payload,
    uid: r.uid,
    referenceNumber: r.reference_number,
    errorCode: r.error_code,
    errorDetail: r.error_detail,
    attempts: r.attempts,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    respondedAt: r.responded_at,
  };
}

const SELECT = `
  SELECT id, invoice_kind, customer_return_id, order_id, order_no, period_key, taxid, status, payload, uid,
         reference_number, error_code, error_detail, attempts,
         created_at::text, sent_at::text, responded_at::text
    FROM tax_invoices`;

/**
 * وارد کردنِ یک سفارش به صف. یکتاییِ order_id باعث می‌شود فراخوانیِ تکراری
 * (مثلاً دوبار فشردنِ دکمه، یا اجرایِ دوباره‌یِ یک کار) دو ردیف نسازد.
 */
export async function enqueueOrder(
  db: Database | Transaction,
  input: {
    orderId: string;
    orderNo: string;
    periodKey: string;
    taxid: string | null;
    payload: unknown;
  },
): Promise<{ id: string; alreadyQueued: boolean }> {
  // یکتایی شرطی است: هر سفارش یک صورتحسابِ «فروش» و هر مرجوعی یک «اصلاحی».
  // (یکتاییِ ساده روی order_id با آمدنِ صورتحسابِ اصلاحی کنار گذاشته شد.)
  const { rows } = await db.query<{ id: string; inserted: boolean }>(
    `INSERT INTO tax_invoices (order_id, order_no, period_key, taxid, payload, status)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'queued')
     ON CONFLICT (order_id) WHERE customer_return_id IS NULL DO NOTHING
     RETURNING id, true AS inserted`,
    [input.orderId, input.orderNo, input.periodKey, input.taxid, JSON.stringify(input.payload)],
  );
  const row = rows[0];
  if (row) return { id: row.id, alreadyQueued: false };

  // پیش‌تر در صف بوده: همان را برمی‌گردانیم تا فراخوان بی‌خبر نماند
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM tax_invoices WHERE order_id = $1 AND customer_return_id IS NULL`,
    [input.orderId],
  );
  const found = existing.rows[0];
  if (!found) throw new AppError('INTERNAL', { message: 'صورتحساب ثبت نشد و ردیفی هم پیدا نشد.' });
  return { id: found.id, alreadyQueued: true };
}

/**
 * برداشتنِ یک دسته برای ارسال.
 *
 * `SKIP LOCKED` یعنی اگر ردیفی در تراکنشِ دیگری قفل شده باشد، از آن می‌گذرد؛
 * پس دو کارگر هیچ‌گاه یک صورتحساب را دوبار نمی‌فرستند و هیچ‌کدام هم منتظر
 * نمی‌مانند.
 */
export async function claimDueBatch(
  db: Database,
  limit = 20,
): Promise<TaxInvoiceRow[]> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<RawRow>(
      `SELECT id, order_id, order_no, period_key, taxid, status, payload, uid,
              reference_number, error_code, error_detail, attempts,
              created_at::text, sent_at::text, responded_at::text
         FROM tax_invoices
        WHERE status IN ('queued', 'failed')
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    if (rows.length === 0) return [];
    await tx.query(
      `UPDATE tax_invoices
          SET status = 'sending', attempts = attempts + 1, next_attempt_at = NULL
        WHERE id = ANY($1)`,
      [rows.map((r) => r.id)],
    );
    return rows.map((r) => mapRow({ ...r, status: 'sending' as TaxStatus }));
  });
}

/** فرستاده شد؛ منتظرِ استعلام هستیم */
export async function markSent(
  db: Database | Transaction,
  input: { id: string; uid: string; referenceNumber?: string | null },
): Promise<void> {
  await db.query(
    `UPDATE tax_invoices
        SET status = 'sent', uid = $2, reference_number = $3, sent_at = now(),
            error_code = NULL, error_detail = NULL
      WHERE id = $1`,
    [input.id, input.uid, input.referenceNumber ?? null],
  );
}

/** سازمان تأیید کرد — صورتحساب قطعی شد */
export async function markAccepted(
  db: Database | Transaction,
  input: { id: string; taxid?: string | null },
): Promise<void> {
  await db.query(
    `UPDATE tax_invoices
        SET status = 'accepted', responded_at = now(),
            taxid = COALESCE($2, taxid), error_code = NULL, error_detail = NULL
      WHERE id = $1`,
    [input.id, input.taxid ?? null],
  );
}

/**
 * سازمان رد کرد. رد با خطایِ شبکه فرق دارد: رد یعنی بسته به دستِ سازمان
 * رسیده و مشکل دارد، پس نباید بی‌پایان تلاشِ دوباره شود — نیاز به اصلاح دارد.
 */
export async function markRejected(
  db: Database | Transaction,
  input: { id: string; errorCode?: string | null; errorDetail?: string | null },
): Promise<void> {
  await db.query(
    `UPDATE tax_invoices
        SET status = 'rejected', responded_at = now(), error_code = $2, error_detail = $3
      WHERE id = $1`,
    [input.id, input.errorCode ?? null, input.errorDetail ?? null],
  );
}

/**
 * خطایِ ارتباطی. تلاشِ دوباره با فاصله‌یِ بیشتر (exponential backoff):
 * نخست ۲ دقیقه، بعد ۸، ۱۸، ۳۲ دقیقه… تا سقفِ ۶ ساعت. قطعیِ کوتاه با همین
 * چند تلاش بی‌سروصدا حل می‌شود؛ قطعیِ بلند هم سرور را خفه نمی‌کند.
 */
export async function markFailed(
  db: Database | Transaction,
  input: { id: string; errorCode?: string | null; errorDetail?: string | null },
): Promise<void> {
  const { rows } = await db.query<{ attempts: number }>(
    `UPDATE tax_invoices
        SET status = 'failed', error_code = $2, error_detail = $3,
            -- GREATEST برای این است که نخستین شکست (attempts=۰) هم دست‌کم
            -- دو دقیقه صبر کند؛ بی‌آن، فرمول صفر می‌شد و صف بی‌وقفه تلاش
            -- می‌کرد — یعنی در یک قطعیِ شبکه، هزاران درخواستِ بی‌فایده.
            next_attempt_at = now() + make_interval(mins => GREATEST(2, LEAST(360, POWER(attempts, 2) * 2))::int)
      WHERE id = $1
      RETURNING attempts`,
    [input.id, input.errorCode ?? null, input.errorDetail ?? null],
  );
  if (rows.length === 0) throw new AppError('NOT_FOUND', { message: 'صورتحسابی با این شناسه نیست.' });
}

/** فرستادنِ دوباره‌یِ دستی (از پنل): وضعیت به صف برمی‌گردد */
export async function retryNow(db: Database, id: string): Promise<void> {
  const { rows } = await db.query<{ status: TaxStatus }>(
    `UPDATE tax_invoices
        SET status = 'queued', next_attempt_at = NULL, error_code = NULL, error_detail = NULL
      WHERE id = $1 AND status IN ('failed', 'rejected')
      RETURNING status`,
    [id],
  );
  if (rows.length === 0) {
    throw new AppError('CONFLICT', {
      message: 'تنها صورتحساب‌هایِ ناموفق یا ردشده را می‌توان دوباره فرستاد.',
    });
  }
}

export interface QueueFilter {
  status?: TaxStatus | null;
  periodKey?: string | null;
  /** فقط فروش (sale) یا فقط اصلاحیِ مرجوعی (credit_note) */
  kind?: 'sale' | 'credit_note' | null;
  limit?: number;
}

export async function listQueue(
  db: Database,
  filter: QueueFilter = {},
): Promise<TaxInvoiceRow[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.status) {
    params.push(filter.status);
    where.push(`status = $${params.length}`);
  }
  if (filter.periodKey) {
    params.push(filter.periodKey);
    where.push(`period_key = $${params.length}`);
  }
  if (filter.kind) {
    params.push(filter.kind);
    where.push(`invoice_kind = $${params.length}`);
  }
  params.push(filter.limit ?? 100);
  const { rows } = await db.query<RawRow>(
    `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(mapRow);
}

export interface QueueStats {
  byStatus: Record<TaxStatus, number>;
  total: number;
  oldestQueuedAt: string | null;
}

/** خلاصه‌یِ صف برایِ سربرگِ پنل — مدیر باید یک نگاه بفهمد عقب‌مانده‌ای هست یا نه */
export async function queueStats(db: Database): Promise<QueueStats> {
  const { rows } = await db.query<{ status: TaxStatus; count: string }>(
    `SELECT status, COUNT(*)::text AS count FROM tax_invoices GROUP BY status`,
  );
  const byStatus: Record<TaxStatus, number> = {
    queued: 0,
    sending: 0,
    sent: 0,
    accepted: 0,
    rejected: 0,
    failed: 0,
  };
  let total = 0;
  for (const r of rows) {
    byStatus[r.status] = Number(r.count);
    total += Number(r.count);
  }
  const oldest = await db.query<{ created_at: string }>(
    `SELECT created_at::text FROM tax_invoices
      WHERE status IN ('queued', 'failed') ORDER BY created_at LIMIT 1`,
  );
  return { byStatus, total, oldestQueuedAt: oldest.rows[0]?.created_at ?? null };
}

/** ساختِ کلیدِ دوره از یک تاریخ: «۱۴۰۵-۰۶» (سال/ماهِ شمسی) */
export async function periodKeyFromParts(date: Date, jalali: { year: number; month: number }): Promise<string> {
  void date;
  return `${jalali.year}-${String(jalali.month).padStart(2, '0')}`;
}

export type { Rial };
