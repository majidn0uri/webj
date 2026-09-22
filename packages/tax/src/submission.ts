/**
 * گردشِ کارِ ارسال: از «سفارش پرداخت شد» تا «صورتحساب تأیید شد».
 *
 * این فایل جایی است که تصمیم‌هایِ سخت گرفته می‌شود:
 *
 *   ۱) **سریالِ داخلی یکتا و افزایشی** — سامانه شماره‌یِ سریالِ تکراری را رد
 *      می‌کند. پس شماره از جدولِ counters می‌آید (اتمیک و بدونِ شکاف)، نه از
 *      COUNT(*) که زیرِ بارِ همزمان تکراری می‌دهد.
 *   ۲) **شناسه‌یِ مالیاتی در لحظه‌یِ ساخت صادر می‌شود**، نه در لحظه‌یِ ارسال؛
 *      چون اگر ارسال شکست بخورد و شناسه عوض شود، پیگیریِ صورتحسابِ قبلی
 *      ناممکن می‌شود.
 *   ۳) **ارسالِ دسته‌ای با تلاشِ دوباره** — هر بار تعدادی محدود از صف برداشته
 *      می‌شود تا یک قطعیِ طولانی باعثِ انباشته‌شدنِ هزاران درخواست نشود.
 *   ۴) **جداییِ «فرستاده‌شده» از «تأییدشده»** — پاسخِ موفق فقط یعنی «رسید»؛
 *      قطعیت با استعلام می‌آید. (تجربه‌یِ عملیِ سامانه‌هایِ دولتی: پاسخ گاه
 *      گم می‌شود، در حالی که صورتحساب ثبت شده است.)
 */

import { AppError, jalaliParts } from '@set/shared-kernel';
import { nextNumber, type Database, type Transaction } from '@set/db';
import {
  buildInvoicePacket,
  buildTaxId,
  validateInvoice,
  BUYER_TYPE,
  SETTLEMENT_METHOD,
  type MoadianInvoiceInput,
  type MoadianLine,
} from './moadian.js';
import {
  claimDueBatch,
  enqueueOrder,
  markFailed,
  markRejected,
  markSent,
  markAccepted,
  periodKeyFromParts,
  type TaxInvoiceRow,
} from './queue.js';
import type { MoadianClient, SendResult } from './client.js';

// ─────────────────────────────────────────────────────────────────────────────
// خواندنِ تنظیمات
// ─────────────────────────────────────────────────────────────────────────────

interface TaxSettings {
  enabled: boolean;
  mode: 'sandbox' | 'production';
  fiscalId: string;
  clientId: string;
  nationalId: string;
  postalCode: string;
  autoSend: boolean;
}

export async function readTaxSettings(db: Database | Transaction): Promise<TaxSettings> {
  const { rows } = await db.query<{ key: string; value: string }>(
    `SELECT key, value FROM store_settings
      WHERE key IN ('moadian_enabled','moadian_mode','moadian_fiscal_id',
                    'moadian_client_id','moadian_taxpayer_national_id',
                    'store_national_id','store_postal_code','moadian_auto_send')`,
  );
  const map = new Map(rows.map((r) => [r.key, r.value ?? '']));
  return {
    enabled: map.get('moadian_enabled') === 'true',
    mode: map.get('moadian_mode') === 'production' ? 'production' : 'sandbox',
    fiscalId: map.get('moadian_fiscal_id') ?? '',
    clientId: map.get('moadian_client_id') ?? '',
    nationalId: map.get('moadian_taxpayer_national_id') || map.get('store_national_id') || '',
    postalCode: map.get('store_postal_code') ?? '',
    autoSend: map.get('moadian_auto_send') === 'true',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ساختِ صورتحساب از سفارش
// ─────────────────────────────────────────────────────────────────────────────

interface OrderRow {
  id: string;
  order_no: string;
  subtotal_rial: string;
  discount_rial: string;
  tax_rial: string;
  shipping_rial: string;
  total_rial: string;
  paid_at: string | null;
  customer_name: string | null;
  customer_mobile: string | null;
  payment_method: string | null;
  national_id: string | null;
  postal_code: string | null;
  branch_code: string | null;
}

interface ItemRow {
  title: string;
  quantity: number;
  unit_price_rial: string;
  discount_rial: string;
  tax_rial: string;
  total_rial: string;
  tax_sstid: string | null;
  tax_unit: string | null;
  variant_sku: string | null;
}

/**
 * ساخت و در صف گذاشتنِ صورتحسابِ یک سفارش.
 *
 * این تابع «بی‌خطر برای تکرار» است: اگر صورتحسابِ سفارش پیش‌تر ساخته شده باشد،
 * همان را برمی‌گرداند و دوباره نمی‌سازد — چون سریالِ تکراری یعنی رد شدن توسطِ
 * سازمان.
 */
export async function createInvoiceForOrder(
  db: Database,
  orderId: string,
): Promise<{ id: string; taxid: string; status: string; validationErrors: string[] }> {
  const settings = await readTaxSettings(db);

  const orderRes = await db.query<OrderRow>(
    `SELECT o.id, o.order_no,
            o.subtotal_rial::text, o.discount_rial::text, o.tax_rial::text,
            o.shipping_rial::text, o.total_rial::text, o.paid_at::text,
            o.customer_name, o.customer_mobile, o.payment_method,
            c.national_id,
            a.postal_code,
            NULL::text AS branch_code
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN customer_addresses a ON a.id = o.address_id
      WHERE o.id = $1 AND o.status = 'paid'`,
    [orderId],
  );
  const order = orderRes.rows[0];
  if (!order) {
    throw new AppError('NOT_FOUND', { message: 'سفارشی با این شناسه پرداخت‌شده نیست.' });
  }

  const itemsRes = await db.query<ItemRow>(
    `SELECT p.title, oi.quantity,
            oi.unit_price_rial::text, oi.discount_rial::text, oi.tax_rial::text,
            oi.total_rial::text,
            p.tax_sstid, p.tax_unit, v.sku AS variant_sku
       FROM order_items oi
       JOIN product_variants v ON v.id = oi.variant_id
       JOIN products p ON p.id = v.product_id
      WHERE oi.order_id = $1
      ORDER BY p.title`,
    [orderId],
  );
  if (itemsRes.rows.length === 0) {
    throw new AppError('VALIDATION', { message: 'سفارش هیچ ردیفی ندارد.' });
  }

  const paidAt = order.paid_at ? new Date(order.paid_at) : new Date();
  const jp = jalaliParts(paidAt);

  // سریالِ یکتا و افزایشی (اتمیک)
  const { value: serialValue } = await nextNumber(db, 'tax_invoice_serial', { scope: 'global' });

  const taxid = buildTaxId({
    fiscalId: settings.fiscalId,
    issuedAt: paidAt,
    serial: Number(serialValue),
  });

  const lines: MoadianLine[] = itemsRes.rows.map((it) => {
    const unitPrice = BigInt(it.unit_price_rial);
    const qty = Number(it.quantity);
    const preDiscount = unitPrice * BigInt(qty);
    const discount = BigInt(it.discount_rial);
    const after = preDiscount - discount;
    const vat = BigInt(it.tax_rial);
    const rate = after > 0n ? Number(vat) / Number(after) : 0;
    return {
      // اگر شناسه‌یِ کالا ثبت نشده باشد، از «عنوانِ کالا» به‌عنوانِ آخرین چاره
      // استفاده نمی‌کنیم: صورتحساب ساخته می‌شود اما پیش از ارسال خطا می‌دهد،
      // تا مدیر مجبور شود شناسه را وارد کند، نه اینکه با داده‌یِ غلط بفرستد.
      sstid: it.tax_sstid ?? '',
      // اگر تنوع‌ها نامِ جدا ندارند (ساختارِ این پروژه)، شناسه‌یِ کالا در شرح
      // می‌آید تا ردیف‌هایِ صورتحساب از هم بازشناخته شوند
      title: it.variant_sku && it.variant_sku !== 'DEFAULT' ? `${it.title} (${it.variant_sku})` : it.title,
      unit: it.tax_unit ?? 'عدد',
      quantity: qty,
      unitPriceRial: unitPrice,
      preDiscountRial: preDiscount,
      discountRial: discount,
      afterDiscountRial: after,
      vatRate: Number.isFinite(rate) ? Math.round(rate * 1000) / 1000 : 0,
      vatRial: vat,
      totalRial: after + vat,
    };
  });

  const settlement =
    order.payment_method === 'credit' ? SETTLEMENT_METHOD.credit : SETTLEMENT_METHOD.cash;

  const input: MoadianInvoiceInput = {
    taxid,
    issuedAtMs: paidAt.getTime(),
    serial: String(serialValue),
    seller: {
      nationalId: settings.nationalId,
      fiscalId: settings.fiscalId,
      postalCode: settings.postalCode,
    },
    buyer: {
      nationalId: order.national_id ?? null,
      postalCode: order.postal_code ?? null,
      economicCode: null,
      name: order.customer_name ?? order.customer_mobile ?? null,
      // در فروشِ خرد، خریدارِ حقیقی است مگر آنکه شناسه‌یِ ۱۱ رقمی داشته باشد
      type:
        order.national_id && order.national_id.length === 11
          ? BUYER_TYPE.company
          : BUYER_TYPE.person,
    },
    lines,
    payments: [{ referenceNo: order.order_no }],
    settlement,
    shippingRial: BigInt(order.shipping_rial ?? '0'),
  };

  const validationErrors = validateInvoice(input);

  // بسته را هرچه هست می‌سازیم تا مدیر بتواند آن را ببیند و خطایش را بخواند؛
  // اما اگر خطا داشت، وضعیت «ردشده» می‌شود تا هرگز ناخواسته ارسال نشود.
  let payload: unknown;
  try {
    payload = buildInvoicePacket(input);
  } catch (e) {
    payload = { header: { taxid, error: validationErrors }, body: [], payments: [] };
  }

  const periodKey = await periodKeyFromParts(paidAt, jp);
  const { id, alreadyQueued } = await enqueueOrder(db, {
    orderId,
    orderNo: order.order_no,
    periodKey,
    taxid,
    payload,
  });

  if (validationErrors.length > 0 && !alreadyQueued) {
    await markRejected(db, { id, errorCode: 'LOCAL_VALIDATION', errorDetail: validationErrors.join(' ') });
  }

  return {
    id,
    taxid,
    status: validationErrors.length > 0 ? 'rejected' : 'queued',
    validationErrors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ارسالِ دسته‌ای و استعلام
// ─────────────────────────────────────────────────────────────────────────────

export interface SendBatchResult {
  claimed: number;
  sent: number;
  failed: number;
  details: Array<{ orderNo: string; uid: string | null; error: string | null }>;
}

/**
 * ارسالِ یک دسته از صف.
 *
 * ترتیبِ کار: برداشتن (با قفل) → ارسال → به‌روزرسانیِ وضعیت. هیچ‌کدام از این
 * مراحل یک تراکنشِ واحد نیستند (ارسال شبکه‌ای را نمی‌توان در تراکنشِ پایگاه
 * داشت)، برای همین وضعیتِ «sending» وجود دارد: اگر فرایند بمیرد، ردیف‌ها در
 * «در حالِ ارسال» نمی‌مانند، چون `retryStuck` آن‌ها را به صف برمی‌گرداند.
 */
export async function sendDueBatch(
  db: Database,
  client: MoadianClient,
  limit = 20,
): Promise<SendBatchResult> {
  const batch = await claimDueBatch(db, limit);
  const out: SendBatchResult = { claimed: batch.length, sent: 0, failed: 0, details: [] };
  if (batch.length === 0) return out;

  let results: SendResult[];
  try {
    results = await client.send(
      batch.map((row) => ({
        packet: row.payload,
        requestTraceId: row.id,
      })),
    );
  } catch (e) {
    // خطایِ شبکه‌ای: کلِ دسته ناموفق شد — وضعیتِ هر ردیف جداگانه به‌روزرسانی
    // می‌شود تا تلاشِ دوباره با فاصله انجام گیرد
    for (const row of batch) {
      await markFailed(db, { id: row.id, errorCode: 'NETWORK', errorDetail: String(e) });
      out.failed += 1;
      out.details.push({ orderNo: row.orderNo, uid: null, error: String(e).slice(0, 200) });
    }
    return out;
  }

  for (let i = 0; i < batch.length; i += 1) {
    const row = batch[i];
    const res = results[i];
    if (!row) continue;

    if (!res || res.errorCode) {
      // سامانه بسته را رد کرده (نه خطایِ شبکه): دوباره فرستادن بی‌فایده است
      await markRejected(db, {
        id: row.id,
        errorCode: res?.errorCode ?? 'NO_RESPONSE',
        errorDetail: res?.errorDetail ?? 'پاسخی از سامانه نرسید.',
      });
      out.failed += 1;
      out.details.push({
        orderNo: row.orderNo,
        uid: res?.uid ?? null,
        error: res?.errorDetail ?? 'پاسخی از سامانه نرسید.',
      });
      continue;
    }

    await markSent(db, { id: row.id, uid: res.uid, referenceNumber: res.referenceNumber });
    out.sent += 1;
    out.details.push({ orderNo: row.orderNo, uid: res.uid, error: null });
  }
  return out;
}

/**
 * استعلامِ وضعیتِ صورتحساب‌هایِ فرستاده‌شده.
 *
 * چرا لازم است؟ چون پاسخِ ارسال فقط «رسید» را می‌گوید. تا وقتی سازمان تأیید
 * نکند، از نظرِ قانونی صورتحسابِ قطعی نداریم و در اظهارنامه نباید به آن تکیه
 * کرد.
 */
export async function inquirePending(
  db: Database,
  client: MoadianClient,
  limit = 50,
): Promise<{ checked: number; accepted: number; rejected: number }> {
  const { rows } = await db.query<{ id: string; uid: string }>(
    `SELECT id, uid FROM tax_invoices
      WHERE status = 'sent' AND uid IS NOT NULL
      ORDER BY sent_at LIMIT $1`,
    [limit],
  );
  if (rows.length === 0) return { checked: 0, accepted: 0, rejected: 0 };

  const results = await client.inquire(rows.map((r) => r.uid));
  let accepted = 0;
  let rejected = 0;
  for (const r of results) {
    const row = rows.find((x) => x.uid === r.uid);
    if (!row) continue;
    if (r.status === 'accepted') {
      await markAccepted(db, { id: row.id, taxid: r.taxid });
      accepted += 1;
    } else if (r.status === 'rejected') {
      await markRejected(db, {
        id: row.id,
        errorCode: r.errorCode,
        errorDetail: r.errorDetail,
      });
      rejected += 1;
    }
  }
  return { checked: rows.length, accepted, rejected };
}

/**
 * ردیف‌هایی که در وضعیتِ «در حالِ ارسال» گیر کرده‌اند (به‌خاطرِ خاموش‌شدنِ
 * فرایند) به صف برمی‌گردند.
 */
export async function retryStuck(db: Database, olderThanMinutes = 15): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE tax_invoices
        SET status = 'queued', next_attempt_at = NULL
      WHERE status = 'sending'
        AND COALESCE(sent_at, created_at) < now() - make_interval(mins => $1)
      RETURNING id`,
    [olderThanMinutes],
  );
  return rows.length;
}

export type { TaxInvoiceRow };
