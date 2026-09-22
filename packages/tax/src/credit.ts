import type { Database, Transaction, Queryable } from '@set/db';
import { AppError } from '@set/shared-kernel';
import { nextNumber } from '@set/db';
import { buildInvoicePacket, buildTaxId, validateInvoice } from './moadian.js';
import type { MoadianInvoiceInput, MoadianLine } from './moadian.js';
import { readTaxSettings } from './submission.js';
import { enqueueOrder, markRejected } from './queue.js';
import { periodKeyFromParts } from './queue.js';
import { jalaliParts } from '@set/shared-kernel';

/**
 * صورتحسابِ اصلاحی (اعتبارِ مرجوعی).
 *
 * حقیتِ ساده: وقتی فروش برمی‌گردد، ارزش‌افزوده‌ای که بابتش به سازمان بدهکار
 * شده‌ایم دیگر بدهی نیست. اگر صورتحسابِ اصلاحی نفرستیم، عملاً مالیاتِ چیزی را
 * می‌دهیم که نفروخته‌ایم.
 *
 * در سامانه‌یِ مؤدیان، اصلاح با «ارجاع به صورتحسابِ اصلی» انجام می‌شود:
 * فیلدِ irtaxid شناسه‌یِ صورتحسابی است که درست می‌شود. مبالغِ این بسته
 * همان مقادیرِ برگشتی است (اعدادِ مثبت، با تعداد و مبلغِ کالایِ برگشتی)؛
 * اظهارنامه‌یِ ما آن را از فروشِ دوره کم می‌کند (در vat.ts).
 *
 * یک تصمیمِ مهم: ما صورتحسابِ اصلی را «دوباره از روی سفارش» نمی‌سازیم، بلکه
 * بسته‌یِ ذخیره‌شده‌یِ همان صورتحساب را مبنا می‌گیریم (ستونِ payload). چرا؟
 * چون اگر سفارش بعداً ویرایش شود (مثلِ تغییرِ شناسه‌یِ کالا)، اصلاحی باید
 * همان چیزی را درست کند که فرستاده شده بود، نه نسخه‌یِ امروزِ سفارش را.
 *
 * ⚠️ پیش از فعال‌سازیِ production باید این رفتار با تازه‌ترین مستنداتِ سازمان
 * سنجیده شود (نشانیِ مستندات در docs/maliat-moadian.md).
 */
export async function createCreditNoteForReturn(
  db: Database | Transaction,
  input: { returnId: string; orderId: string; orderNo?: string | null },
): Promise<{ id: string; taxid: string; validationErrors: string[]; skippedReason?: string } | null> {
  const settings = await readTaxSettings(db);

  // صورتحسابِ اصلی: همان که باید اصلاح شود
  const { rows: originals } = await db.query<{
    id: string;
    taxid: string | null;
    payload: unknown;
    order_no: string;
  }>(
    `SELECT id, taxid, payload, order_no
       FROM tax_invoices
      WHERE order_id = $1 AND invoice_kind = 'sale'
      ORDER BY created_at
      LIMIT 1`,
    [input.orderId],
  );
  const original = originals[0];
  if (!original) return null; // هنوز صورتحسابی صادر نشده: چیزی برایِ اصلاح نیست
  if (!original.taxid) return null; // صورتحساب شناسه نگرفته: اصلاحی معنا ندارد

  const payload = original.payload as {
    header?: Record<string, unknown>;
    body?: Array<Record<string, unknown>>;
    payments?: Array<Record<string, unknown>>;
  } | null;
  const header = payload?.header ?? {};

  // ردیف‌هایِ مرجوعی با مبالغِ واقعی (همان که رویِ ردیف ثبت شده)
  const { rows: items } = await db.query<{
    id: string;
    variant_id: string;
    quantity: number;
    refund_rial: string;
    refund_tax_rial: string;
    title: string;
    sku: string | null;
    unit: string | null;
    sstid: string | null;
  }>(
    `SELECT cri.id, cri.variant_id, cri.quantity,
            cri.refund_rial::text, cri.refund_tax_rial::text,
            p.title, v.sku, p.tax_unit AS unit, p.tax_sstid AS sstid
       FROM customer_return_items cri
       JOIN product_variants v ON v.id = cri.variant_id
       JOIN products p ON p.id = v.product_id
      WHERE cri.return_id = $1
      ORDER BY p.title`,
    [input.returnId],
  );

  if (items.length === 0) return null;

  const now = new Date();
  const jp = jalaliParts(now);
  const { value: serialValue } = await nextNumber(db, 'tax_invoice_serial', { scope: 'global' });

  const taxid = buildTaxId({
    fiscalId: settings.fiscalId,
    issuedAt: now,
    serial: Number(serialValue),
  });

  const lines: MoadianLine[] = items.map((it) => {
    const gross = BigInt(it.refund_rial);
    const vat = BigInt(it.refund_tax_rial);
    const net = gross - vat;
    const qty = Number(it.quantity) || 1;
    const rate = net > 0n ? Number(vat) / Number(net) : 0;
    return {
      sstid: it.sstid ?? '',
      title: it.sku && it.sku !== 'DEFAULT' ? `${it.title} (${it.sku})` : it.title,
      unit: it.unit ?? 'عدد',
      quantity: qty,
      unitPriceRial: net / BigInt(qty),
      preDiscountRial: net,
      discountRial: 0n,
      afterDiscountRial: net,
      vatRate: Number.isFinite(rate) ? Math.round(rate * 1000) / 1000 : 0,
      vatRial: vat,
      totalRial: gross,
    };
  });

  const input2: MoadianInvoiceInput = {
    taxid,
    issuedAtMs: now.getTime(),
    serial: String(serialValue),
    seller: {
      nationalId: settings.nationalId,
      fiscalId: settings.fiscalId,
      postalCode: settings.postalCode,
    },
    buyer: {
      nationalId: (header['tins'] as string | undefined) ?? null,
      postalCode: (header['bpc'] as string | undefined) ?? null,
      economicCode: null,
      name: (header['tob'] as string | undefined) ? null : ((header['tinb'] as string | undefined) ?? null),
      type: ((header['tob'] as number | undefined) ?? 1) as 1 | 2 | 3,
    },
    lines,
    // اصلاحی: ارجاع به شناسه‌یِ صورتحسابِ اصلی (irtaxid)
    payments: [{ referenceNo: input.orderNo ?? original.order_no }],
    settlement: 1,
    referenceTaxId: original.taxid,
  };

  const validationErrors = validateInvoice(input2);

  let packet: unknown;
  try {
    packet = buildInvoicePacket(input2);
  } catch {
    packet = { header: { taxid, error: validationErrors }, body: [], payments: [] };
  }

  const periodKey = await periodKeyFromParts(now, jp);

  const { rows: inserted } = await db.query<{ id: string }>(
    `INSERT INTO tax_invoices
       (order_id, order_no, period_key, taxid, payload, status, invoice_kind, customer_return_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,'queued','credit_note',$6)
     ON CONFLICT (customer_return_id) WHERE customer_return_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [input.orderId, original.order_no, periodKey, taxid, JSON.stringify(packet), input.returnId],
  );

  const row = inserted[0];
  if (!row) {
    // پیش‌تر برایِ این مرجوعی صادر شده — دوباره صادر نمی‌کنیم (تکرار یعنی رد)
    return null;
  }

  if (validationErrors.length > 0) {
    await markRejected(db, {
      id: row.id,
      errorCode: 'LOCAL_VALIDATION',
      errorDetail: validationErrors.join(' '),
    });
  }

  return { id: row.id, taxid, validationErrors };
}

/** فهرستِ صورتحساب‌هایِ اصلاحی — برایِ پنلِ مالیات */
export async function listCreditNotes(db: Queryable, limit = 50) {
  const { rows } = await db.query<{
    id: string;
    order_no: string;
    taxid: string | null;
    status: string;
    created_at: string;
    customer_return_id: string;
    return_no: string | null;
  }>(
    `SELECT t.id, t.order_no, t.taxid, t.status, t.created_at::text,
            t.customer_return_id, cr.return_no
       FROM tax_invoices t
       LEFT JOIN customer_returns cr ON cr.id = t.customer_return_id
      WHERE t.invoice_kind = 'credit_note'
      ORDER BY t.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

/**
 * بازسازیِ یک صورتحسابِ اصلاحی که «هرگز فرستاده نشده» است.
 *
 * چرا لازم است؟ چون رایج‌ترین علتِ رد شدنِ اصلاحی، نبودنِ «شناسه‌یِ کالا/خدمت»
 * است. مدیر شناسه را ثبت می‌کند و «تلاشِ دوباره» می‌زند — اگر ما همان بسته‌یِ
 * کهنه را دوباره در صف بگذاریم، بسته‌ای با همان نقص فرستاده می‌شود و سازمان
 * دوباره رد می‌کند؛ این بار با تأخیرِ بیشتر و با یک سریالِ مصرف‌شده.
 *
 * پس تفاوتِ این تابع با «تلاشِ دوباره» (‎`retryNow`‎) این است:
 *   • تلاشِ دوباره برای خطایِ **شبکه** است (بسته درست است، نرسیده)؛
 *   • بازسازی برای خطایِ **داده** است (بسته ناقص بوده و حالا داده درست شده).
 *
 * ایمنی: فقط ردیفی بازسازی می‌شود که ‎`uid`‎ نداشته باشد — یعنی هرگز به سامانه
 * نرسیده است. صورتحسابی که ارسال شده (حتی اگر بعداً رد شده باشد) دست‌نخورده
 * می‌ماند، چون تغییرِ بسته‌یِ ارسال‌شده یعنی از بین رفتنِ امکانِ پیگیری.
 */
export async function rebuildUnsentCreditNote(
  db: Database,
  invoiceId: string,
): Promise<{ rebuilt: true; id: string; taxid: string; validationErrors: string[] } | { rebuilt: false; reason: string }> {
  const { rows } = await db.query<{
    id: string;
    customer_return_id: string | null;
    order_id: string;
    uid: string | null;
    invoice_kind: string;
  }>(
    `SELECT id, customer_return_id, order_id, uid, invoice_kind
       FROM tax_invoices WHERE id = $1`,
    [invoiceId],
  );
  const row = rows[0];
  if (!row) return { rebuilt: false, reason: 'صورتحساب یافت نشد.' };
  if (row.invoice_kind !== 'credit_note') return { rebuilt: false, reason: 'این صورتحساب اصلاحی نیست.' };
  if (row.uid) return { rebuilt: false, reason: 'این صورتحساب پیش‌تر فرستاده شده؛ بسته‌یِ آن تغییر نمی‌کند.' };
  if (!row.customer_return_id) return { rebuilt: false, reason: 'این اصلاحی به مرجوعی وصل نیست.' };

  // بسته‌یِ کهنه را برمی‌داریم و از نو می‌سازیم. حذف امن است چون هرگز ارسال نشده.
  await db.query(`DELETE FROM tax_invoices WHERE id = $1`, [invoiceId]);
  const created = await createCreditNoteForReturn(db, {
    returnId: row.customer_return_id,
    orderId: row.order_id,
  });

  if (!created) {
    return { rebuilt: false, reason: 'ساختِ دوباره ناموفق بود (تنظیماتِ مالیات بررسی شود).' };
  }
  return {
    rebuilt: true,
    id: created.id,
    taxid: created.taxid,
    validationErrors: created.validationErrors,
  };
}
