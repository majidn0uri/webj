/**
 * تأمین و خرید — زنجیره‌یِ کامل از «کمبود دیده شد» تا «کالا در قفسه است»
 *
 *   درخواستِ خرید (PR)  →  تأیید  →  فاکتورِ خرید (فقط مالی)  →  رسیدِ انبار (KH)  →  موجودی
 *                                                                    ↓ مغایرت
 *                                                              برگشت به تأمین‌کننده (BS)
 *
 * سه تصمیمِ اساسی در این طراحی:
 *
 *  ۱) موجودی را «رسیدِ انبار» بالا می‌برد، نه فاکتور (BR-19).
 *     فاکتور در مسیرِ تأمین فقط سندِ مالی است (stockEffect: 'none')؛ چون ممکن
 *     است کالا کمتر یا دیرتر از فاکتور برسد. اگر فاکتور موجودی را بالا
 *     می‌برد، انبار می‌گفت «داریم» در حالی که قفسه خالی بود.
 *
 *  ۲) مغایرت پنهان نمی‌شود (BR-18).
 *     تفاوتِ مقدار یا قیمت با فاکتور، در خودِ ردیفِ رسید ثبت می‌شود و وضعیتِ
 *     رسید discrepancy می‌گردد تا در فهرست بماند تا وقتی حل شود.
 *
 *  ۳) میانگینِ موزون با هر رسید به‌روزرسانی می‌شود (BR-17) با همان فرمولِ
 *     حسابداری — نه نسخه‌ی دوم از آن.
 */

import type { Database, Queryable } from '@set/db';
import { AppError, type Rial } from '@set/shared-kernel';
import { AccountingService, updateWeightedAverage } from '@set/accounting';
import { nextDocumentNumber } from '@set/commerce';

// ===========================================================================
// تأمین‌کنندگان
// ===========================================================================

export interface CreateSupplierInput {
  name: string;
  storeName?: string | null;
  kind?: 'company' | 'person';
  nationalId?: string | null;
  economicCode?: string | null;
  registrationNo?: string | null;
  contactName?: string | null;
  phone?: string | null;
  mobile?: string | null;
  province?: string | null;
  city?: string | null;
  address?: string | null;
  postalCode?: string | null;
  bankName?: string | null;
  sheba?: string | null;
  accountNo?: string | null;
  settlementTerms?: 'cash' | 'credit_15' | 'credit_30' | 'cheque';
  creditLimitRial?: bigint;
  leadTimeDays?: number;
  note?: string | null;
  actorId?: string | null;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  store_name: string | null;
  national_id: string | null;
  economic_code: string | null;
  mobile: string | null;
  city: string | null;
  sheba: string | null;
  settlement_terms: string;
  lead_time_days: number;
  is_active: boolean;
}

export async function createSupplier(
  db: Database,
  input: CreateSupplierInput,
): Promise<Supplier> {
  return db.transaction(async (tx) => {
    // کدِ تأمین‌کننده با همان مکانیزمِ شماره‌گذاریِ اسناد (بدون قفل روی جدول)
    const { rows: seq } = await tx.query<{ value: string }>(
      `INSERT INTO counters (scope, key, value) VALUES ('global','supplier',1)
       ON CONFLICT (scope, key) DO UPDATE SET value = counters.value + 1
       RETURNING value`,
    );
    const code = `T-${String(Number(seq[0]?.value ?? 1)).padStart(4, '0')}`;

    const { rows } = await tx.query<Supplier>(
      `INSERT INTO suppliers
         (code, name, store_name, kind, national_id, economic_code, registration_no,
          contact_name, phone, mobile, province, city, address, postal_code,
          bank_name, sheba, account_no, settlement_terms, credit_limit_rial,
          lead_time_days, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING *`,
      [
        code,
        input.name.trim(),
        input.storeName ?? null,
        input.kind ?? 'company',
        input.nationalId ?? null,
        input.economicCode ?? null,
        input.registrationNo ?? null,
        input.contactName ?? null,
        input.phone ?? null,
        input.mobile ?? null,
        input.province ?? null,
        input.city ?? null,
        input.address ?? null,
        input.postalCode ?? null,
        input.bankName ?? null,
        input.sheba ?? null,
        input.accountNo ?? null,
        input.settlementTerms ?? 'cash',
        (input.creditLimitRial ?? 0n).toString(),
        input.leadTimeDays ?? 3,
        input.note ?? null,
      ],
    );
    const supplier = rows[0]!;

    await tx.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity, entity_id, after_data)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        input.actorId ?? null,
        'supplier.created',
        'suppliers',
        supplier.id,
        JSON.stringify({ code, name: supplier.name }),
      ],
    );
    return supplier;
  });
}

export async function listSuppliers(
  db: Queryable,
  opts: { onlyActive?: boolean; q?: string } = {},
): Promise<Supplier[]> {
  const conditions = [opts.onlyActive === false ? 'true' : 'is_active = true'];
  const params: unknown[] = [];
  if (opts.q) {
    conditions.push(`(name ILIKE $1 OR code ILIKE $1 OR mobile ILIKE $1)`);
    params.push(`%${opts.q}%`);
  }
  const { rows } = await db.query<Supplier>(
    `SELECT * FROM suppliers WHERE ${conditions.join(' AND ')} ORDER BY name`,
    params,
  );
  return rows;
}

// ===========================================================================
// درخواستِ خرید
// ===========================================================================

export interface RequestItemInput {
  variantId: string;
  quantity: number;
  note?: string | null;
}

export interface PurchaseRequest {
  id: string;
  request_no: string;
  status: string;
  priority: string;
  source: string;
  supplier_id: string | null;
  reason: string | null;
  created_at: Date;
}

export async function createPurchaseRequest(
  db: Database,
  input: {
    items: RequestItemInput[];
    requestedBy?: string | null;
    branchId?: string | null;
    supplierId?: string | null;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    source?: 'manual' | 'reorder_alert' | 'customer_order';
    reorderAlertId?: string | null;
    expectedAt?: Date | null;
    reason?: string | null;
  },
): Promise<PurchaseRequest> {
  if (!input.items.length) {
    throw new AppError('VALIDATION', { message: 'درخواستِ خرید باید دست‌کم یک قلم داشته باشد' });
  }

  return db.transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, 'PR');
    const { rows } = await tx.query<PurchaseRequest>(
      `INSERT INTO purchase_requests
         (request_no, requested_by, branch_id, supplier_id, priority, source,
          reorder_alert_id, expected_at, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        number.code,
        input.requestedBy ?? null,
        input.branchId ?? null,
        input.supplierId ?? null,
        input.priority ?? 'normal',
        input.source ?? 'manual',
        input.reorderAlertId ?? null,
        input.expectedAt ?? null,
        input.reason ?? null,
      ],
    );
    const request = rows[0]!;

    for (const item of input.items) {
      // آخرین قیمتِ خرید را کنارِ درخواست می‌گذاریم تا مدیر هنگامِ تأیید،
      // رقمِ واقعی را جلویِ چشم داشته باشد (بدون مراجعه به فاکتورها)
      const { rows: lastCost } = await tx.query<{ unit_cost_rial: string | null }>(
        `SELECT unit_cost_rial::text FROM purchase_invoice_items
          WHERE variant_id = $1 ORDER BY (SELECT created_at FROM purchase_invoices pi WHERE pi.id = invoice_id) DESC LIMIT 1`,
        [item.variantId],
      );
      await tx.query(
        `INSERT INTO purchase_request_items (request_id, variant_id, quantity, last_cost_rial, note)
         VALUES ($1,$2,$3,$4,$5)`,
        [request.id, item.variantId, item.quantity, lastCost[0]?.unit_cost_rial ?? null, item.note ?? null],
      );
    }

    await tx.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity, entity_id, after_data)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        input.requestedBy ?? null,
        'purchase_request.created',
        'purchase_requests',
        request.id,
        JSON.stringify({ request_no: request.request_no, items: input.items.length }),
      ],
    );
    return request;
  });
}

export async function decidePurchaseRequest(
  db: Database,
  input: {
    requestId: string;
    approve: boolean;
    actorId?: string | null;
    note: string;
    supplierId?: string | null;
  },
): Promise<PurchaseRequest> {
  return db.transaction(async (tx) => {
    const { rows: before } = await tx.query<PurchaseRequest>(
      `SELECT * FROM purchase_requests WHERE id = $1`,
      [input.requestId],
    );
    const request = before[0];
    if (!request) throw new AppError('NOT_FOUND', { message: 'درخواست یافت نشد' });
    if (request.status !== 'pending_approval') {
      throw new AppError('CONFLICT', { message: 'این درخواست پیش‌تر بررسی شده است' });
    }

    const { rows } = await tx.query<PurchaseRequest>(
      `UPDATE purchase_requests
          SET status = $1, decided_by = $2, decided_at = now(), decision_note = $3,
              supplier_id = COALESCE($4, supplier_id), updated_at = now()
        WHERE id = $5 RETURNING *`,
      [
        input.approve ? 'approved' : 'rejected',
        input.actorId ?? null,
        input.note,
        input.supplierId ?? null,
        input.requestId,
      ],
    );

    await tx.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity, entity_id, before_data, after_data)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [
        input.actorId ?? null,
        input.approve ? 'purchase_request.approved' : 'purchase_request.rejected',
        'purchase_requests',
        input.requestId,
        JSON.stringify({ status: request.status }),
        JSON.stringify({ status: input.approve ? 'approved' : 'rejected', note: input.note }),
      ],
    );
    return rows[0]!;
  });
}

export interface RequestView extends PurchaseRequest {
  items: Array<{
    variant_id: string;
    sku: string | null;
    product_title: string;
    quantity: number;
    received_quantity: number;
    last_cost_rial: string | null;
    on_hand: number;
  }>;
}

export async function listPurchaseRequests(
  db: Queryable,
  filter: { status?: string; limit?: number } = {},
): Promise<RequestView[]> {
  const { rows } = await db.query<RequestView>(
    `SELECT * FROM purchase_requests
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY
        CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT $2`,
    [filter.status ?? null, filter.limit ?? 100],
  );

  if (!rows.length) return rows;
  const { rows: items } = await db.query<{
    request_id: string;
    variant_id: string;
    sku: string | null;
    product_title: string;
    quantity: number;
    received_quantity: number;
    last_cost_rial: string | null;
    on_hand: number;
  }>(
    `SELECT pri.request_id, pri.variant_id, v.sku, p.title AS product_title,
            pri.quantity, pri.received_quantity, pri.last_cost_rial::text,
            COALESCE(SUM(si.on_hand), 0)::int AS on_hand
       FROM purchase_request_items pri
       JOIN product_variants v ON v.id = pri.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN stock_items si ON si.variant_id = pri.variant_id
      WHERE pri.request_id = ANY($1)
      GROUP BY pri.request_id, pri.variant_id, v.sku, p.title,
               pri.quantity, pri.received_quantity, pri.last_cost_rial`,
    [rows.map((r) => r.id)],
  );

  return rows.map((r) => ({ ...r, items: items.filter((i) => i.request_id === r.id) }));
}

// ===========================================================================
// تبدیلِ درخواست به فاکتورِ خرید (سندِ مالیِ بدون اثرِ موجودی)
// ===========================================================================

export interface InvoiceFromRequestInput {
  requestId: string;
  supplierId?: string | null;
  warehouseId: string;
  /** قیمتِ توافقیِ هر قلم (ریال) */
  prices: Record<string, Rial>; // variantId → unitCostRial
  extraCostRial?: Rial;
  vatRial?: Rial;
  supplierInvoiceNo?: string | null;
  issuedAt?: Date | null;
  dueAt?: Date | null;
  actorId?: string | null;
}

export async function createInvoiceFromRequest(
  db: Database,
  input: InvoiceFromRequestInput,
): Promise<{ invoiceId: string; invoiceNo: string; entryNo: string; requestNo: string }> {
  const { rows: req } = await db.query<{ id: string; request_no: string; status: string; supplier_id: string | null }>(
    `SELECT id, request_no, status, supplier_id FROM purchase_requests WHERE id = $1`,
    [input.requestId],
  );
  const request = req[0];
  if (!request) throw new AppError('NOT_FOUND', { message: 'درخواست یافت نشد' });
  if (request.status !== 'approved') {
    throw new AppError('CONFLICT', { message: 'فقط درخواستِ تأییدشده به فاکتور تبدیل می‌شود' });
  }

  const supplierId = input.supplierId ?? request.supplier_id;
  if (!supplierId) {
    throw new AppError('VALIDATION', { message: 'تأمین‌کننده برای صدورِ فاکتور مشخص نیست' });
  }
  const { rows: supplierRows } = await db.query<Supplier>(
    `SELECT * FROM suppliers WHERE id = $1`,
    [supplierId],
  );
  const supplier = supplierRows[0];
  if (!supplier) throw new AppError('NOT_FOUND', { message: 'تأمین‌کننده یافت نشد' });

  const { rows: items } = await db.query<{ variant_id: string; quantity: number }>(
    `SELECT variant_id, quantity FROM purchase_request_items WHERE request_id = $1`,
    [input.requestId],
  );

  const missing = items.filter((i) => input.prices[i.variant_id] == null);
  if (missing.length) {
    throw new AppError('VALIDATION', {
      message: `برای ${missing.length} قلم قیمتِ خرید وارد نشده است`,
    });
  }

  const accounting = new AccountingService(db);
  const posted = await accounting.postPurchaseInvoice({
    supplierName: supplier.name,
    warehouseId: input.warehouseId,
    // BR-19: موجودی را رسیدِ انبار بالا می‌برد، نه این فاکتور
    stockEffect: 'none',
    items: items.map((i) => ({
      variantId: i.variant_id,
      quantity: i.quantity,
      unitCostRial: BigInt(input.prices[i.variant_id]!),
    })),
    extraCostRial: input.extraCostRial ?? 0n,
    vatRial: input.vatRial ?? 0n,
    supplierNationalId: supplier.national_id,
    supplierEconomicCode: supplier.economic_code,
    supplierInvoiceNo: input.supplierInvoiceNo ?? null,
    issuedAt: input.issuedAt ?? null,
    dueAt: input.dueAt ?? null,
    createdBy: input.actorId ?? null,
  });

  // پیوندِ فاکتور به درخواست و تأمین‌کننده + پیشبردِ وضعیت
  await db.query(
    `UPDATE purchase_invoices SET supplier_id = $1, purchase_request_id = $2 WHERE id = $3`,
    [supplierId, request.id, posted.invoiceId],
  );
  await db.query(
    `UPDATE purchase_request_items SET ordered_quantity = quantity WHERE request_id = $1`,
    [request.id],
  );
  await db.query(
    `UPDATE purchase_requests SET status = 'ordered', supplier_id = $1, updated_at = now() WHERE id = $2`,
    [supplierId, request.id],
  );

  return {
    invoiceId: posted.invoiceId,
    invoiceNo: posted.invoiceNo,
    entryNo: posted.entryNo,
    requestNo: request.request_no,
  };
}

// ===========================================================================
// رسیدِ انبار (BR-16..BR-19)
// ===========================================================================

export interface ReceiptItemInput {
  variantId: string;
  expectedQuantity?: number;
  receivedQuantity: number;
  damagedQuantity?: number;
  unitCostRial?: Rial;
  note?: string | null;
}

export interface Discrepancy {
  variantId: string;
  sku: string | null;
  title: string;
  expected: number;
  received: number;
  damaged: number;
  /** تفاوتِ مقدار (منفی = کسر دارد) */
  quantityDiff: number;
  /** تفاوتِ قیمتِ واحد (منفی = ارزان‌تر از فاکتور) */
  priceDiffRial: bigint | null;
  kind: 'shortage' | 'surplus' | 'damaged' | 'price' | null;
}

export interface ReceiveGoodsInput {
  purchaseInvoiceId?: string | null;
  purchaseRequestId?: string | null;
  supplierId?: string | null;
  warehouseId: string;
  branchId?: string | null;
  supplierInvoiceNo?: string | null;
  carrier?: string | null;
  trackingNo?: string | null;
  items: ReceiptItemInput[];
  receivedBy?: string | null;
  discrepancyNote?: string | null;
}

export interface GoodsReceiptResult {
  receiptId: string;
  receiptNo: string;
  status: 'confirmed' | 'discrepancy';
  discrepancies: Discrepancy[];
  totalReceivedQty: number;
  totalDamagedQty: number;
}

/**
 * ثبتِ رسیدِ انبار — تنها راهِ افزایشِ موجودی در مسیرِ تأمین (BR-19).
 *
 * ترتیبِ کار در یک تراکنش:
 *   ۱) ساختِ سربرگِ رسید با شماره‌ی KH
 *   ۲) برای هر قلم: مقایسه با فاکتور (مقدار/قیمت) + ثبتِ ردیف
 *   ۳) ورودِ کالایِ سالم به موجودی + ثبتِ حرکتِ انبار
 *   ۴) به‌روزرسانیِ میانگینِ موزون
 *   ۵) پیشبردِ وضعیتِ درخواست و ثبتِ کالایِ معیوب به‌عنوانِ ضایعات
 */
export async function receiveGoods(
  db: Database,
  input: ReceiveGoodsInput,
): Promise<GoodsReceiptResult> {
  if (!input.items.length) {
    throw new AppError('VALIDATION', { message: 'رسید باید دست‌کم یک قلم داشته باشد' });
  }

  return db.transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, 'KH');

    const { rows } = await tx.query<{ id: string; receipt_no: string }>(
      `INSERT INTO goods_receipts
         (receipt_no, purchase_invoice_id, purchase_request_id, supplier_id, warehouse_id,
          branch_id, supplier_invoice_no, carrier, tracking_no, received_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, receipt_no`,
      [
        number.code,
        input.purchaseInvoiceId ?? null,
        input.purchaseRequestId ?? null,
        input.supplierId ?? null,
        input.warehouseId,
        input.branchId ?? null,
        input.supplierInvoiceNo ?? null,
        input.carrier ?? null,
        input.trackingNo ?? null,
        input.receivedBy ?? null,
      ],
    );
    const receipt = rows[0]!;

    // ردیف‌های فاکتور برای مقایسه (اگر فاکتوری هست)
    const invoiceItems = new Map<string, { quantity: number; unitCostRial: bigint }>();
    if (input.purchaseInvoiceId) {
      const { rows: inv } = await tx.query<{
        variant_id: string;
        quantity: number;
        unit_cost_rial: string;
      }>(
        `SELECT variant_id, quantity, unit_cost_rial::text FROM purchase_invoice_items WHERE invoice_id = $1`,
        [input.purchaseInvoiceId],
      );
      for (const r of inv) {
        invoiceItems.set(r.variant_id, {
          quantity: r.quantity,
          unitCostRial: BigInt(r.unit_cost_rial),
        });
      }
    }

    const discrepancies: Discrepancy[] = [];
    let totalReceived = 0;
    let totalDamaged = 0;

    for (const item of input.items) {
      const expected = item.expectedQuantity ?? invoiceItems.get(item.variantId)?.quantity ?? 0;
      const damaged = item.damagedQuantity ?? 0;
      const received = item.receivedQuantity;

      if (received < 0 || damaged < 0) {
        throw new AppError('VALIDATION', { message: 'مقدار نمی‌تواند منفی باشد' });
      }
      if (damaged > received) {
        throw new AppError('VALIDATION', {
          message: 'تعدادِ معیوب نمی‌تواند از کلِ دریافتی بیشتر باشد',
        });
      }

      const unitCostRial =
        item.unitCostRial ?? invoiceItems.get(item.variantId)?.unitCostRial ?? 0n;

      await tx.query(
        `INSERT INTO goods_receipt_items
           (receipt_id, variant_id, expected_quantity, received_quantity, damaged_quantity, unit_cost_rial, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          receipt.id,
          item.variantId,
          expected,
          received,
          damaged,
          unitCostRial.toString(),
          item.note ?? null,
        ],
      );

      // --- ورودِ کالایِ سالم به موجودی (BR-16 , BR-19)
      const sellable = received - damaged;
      if (sellable > 0) {
        await tx.query(
          `INSERT INTO stock_items (variant_id, warehouse_id, on_hand)
           VALUES ($1,$2,$3)
           ON CONFLICT (variant_id, warehouse_id)
           DO UPDATE SET on_hand = stock_items.on_hand + EXCLUDED.on_hand, updated_at = now()`,
          [item.variantId, input.warehouseId, sellable],
        );
        await tx.query(
          `INSERT INTO stock_movements
             (variant_id, warehouse_id, quantity, reason, reference_type, reference_id, unit_cost_rial, actor_user_id)
           VALUES ($1,$2,$3,'purchase_receipt','goods_receipt',$4,$5,$6)`,
          [
            item.variantId,
            input.warehouseId,
            sellable,
            receipt.id,
            unitCostRial.toString(),
            input.receivedBy ?? null,
          ],
        );
      }

      // --- ضایعات: کالایِ معیوب به موجودی نمی‌آید، اما حرکتش ثبت می‌شود (BR-«ضایعات»)
      if (damaged > 0) {
        await tx.query(
          `INSERT INTO stock_movements
             (variant_id, warehouse_id, quantity, reason, reference_type, reference_id, unit_cost_rial, actor_user_id)
           VALUES ($1,$2,$3,'waste','goods_receipt',$4,$5,$6)`,
          [
            item.variantId,
            input.warehouseId,
            damaged,
            receipt.id,
            unitCostRial.toString(),
            input.receivedBy ?? null,
          ],
        );
      }

      // --- به‌روزرسانیِ بهای میانگینِ موزون (BR-17)
      //     مبنا: کالایِ سالم + معیوب (هر دو خریداری شده‌اند؛ معیوب بعداً ضایعات می‌شود)
      if (received > 0) {
        await updateWeightedAverage(
          tx,
          input.warehouseId,
          item.variantId,
          sellable,
          unitCostRial * BigInt(sellable),
        );
      }

      // ثبت خودکار قیمت تأمین‌کننده — برای مقایسه آینده
      if (input.supplierId && received > 0 && unitCostRial > 0n) {
        await tx.query(
          `INSERT INTO supplier_price_history (supplier_id, variant_id, unit_cost_rial, source, source_id)
           VALUES ($1, $2, $3, 'receipt', $4)`,
          [input.supplierId, item.variantId, unitCostRial.toString(), receipt.id],
        );
      }

      // --- مغایرت (BR-18)
      const invoicePrice = invoiceItems.get(item.variantId)?.unitCostRial ?? null;
      const priceDiff = invoicePrice != null ? unitCostRial - invoicePrice : null;
      const quantityDiff = received - expected;

      let kind: Discrepancy['kind'] = null;
      if (damaged > 0) kind = 'damaged';
      else if (quantityDiff < 0) kind = 'shortage';
      else if (quantityDiff > 0) kind = 'surplus';
      else if (priceDiff != null && priceDiff !== 0n) kind = 'price';

      if (kind) {
        const { rows: meta } = await tx.query<{ sku: string | null; title: string }>(
          `SELECT v.sku, p.title FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`,
          [item.variantId],
        );
        discrepancies.push({
          variantId: item.variantId,
          sku: meta[0]?.sku ?? null,
          title: meta[0]?.title ?? '',
          expected,
          received,
          damaged,
          quantityDiff,
          priceDiffRial: priceDiff,
          kind,
        });
      }

      totalReceived += received;
      totalDamaged += damaged;
    }

    const status = discrepancies.length ? 'discrepancy' : 'confirmed';
    await tx.query(
      `UPDATE goods_receipts
          SET status = $1, total_expected_qty = $2, total_received_qty = $3,
              total_damaged_qty = $4, discrepancy_note = $5, updated_at = now()
        WHERE id = $6`,
      [
        status,
        input.items.reduce((s, i) => s + (i.expectedQuantity ?? 0), 0),
        totalReceived,
        totalDamaged,
        input.discrepancyNote ?? null,
        receipt.id,
      ],
    );

    // پیشبردِ خودکارِ وضعیتِ درخواست: مقدارِ دریافتی روی هر قلم می‌نشیند
    if (input.purchaseRequestId) {
      for (const item of input.items) {
        await tx.query(
          `UPDATE purchase_request_items
              SET received_quantity = received_quantity + $1
            WHERE request_id = $2 AND variant_id = $3`,
          [item.receivedQuantity - (item.damagedQuantity ?? 0), input.purchaseRequestId, item.variantId],
        );
      }
      await tx.query(
        `UPDATE purchase_requests pr
            SET status = CASE
                  WHEN NOT EXISTS (
                        SELECT 1 FROM purchase_request_items pri
                         WHERE pri.request_id = pr.id
                           AND pri.received_quantity < pri.quantity
                  ) THEN 'received'
                  ELSE 'partially_received'
                END,
                updated_at = now()
          WHERE pr.id = $1`,
        [input.purchaseRequestId],
      );
    }

    await tx.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity, entity_id, after_data)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        input.receivedBy ?? null,
        'goods_receipt.created',
        'goods_receipts',
        receipt.id,
        JSON.stringify({
          receipt_no: receipt.receipt_no,
          status,
          totalReceived,
          totalDamaged,
          discrepancies: discrepancies.length,
        }),
      ],
    );

    return {
      receiptId: receipt.id,
      receiptNo: receipt.receipt_no,
      status,
      discrepancies,
      totalReceivedQty: totalReceived,
      totalDamagedQty: totalDamaged,
    };
  });
}

export async function listGoodsReceipts(
  db: Queryable,
  filter: { status?: string; warehouseId?: string; limit?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const { rows } = await db.query(
    `SELECT gr.*, s.name AS supplier_name, w.name AS warehouse_name
       FROM goods_receipts gr
       LEFT JOIN suppliers s ON s.id = gr.supplier_id
       LEFT JOIN warehouses w ON w.id = gr.warehouse_id
      WHERE ($1::text IS NULL OR gr.status = $1)
        AND ($2::uuid IS NULL OR gr.warehouse_id = $2)
      ORDER BY gr.received_at DESC
      LIMIT $3`,
    [filter.status ?? null, filter.warehouseId ?? null, filter.limit ?? 100],
  );
  return rows;
}

// ===========================================================================
// برگشت به تأمین‌کننده (BS)
// ===========================================================================

export async function createSupplierReturn(
  db: Database,
  input: {
    supplierId: string;
    goodsReceiptId?: string | null;
    warehouseId?: string | null;
    reason: string;
    items: Array<{ variantId: string; quantity: number; unitCostRial: Rial; reason?: string | null }>;
    actorId?: string | null;
  },
): Promise<{ returnNo: string; totalRial: bigint; returnId: string }> {
  if (!input.items.length) {
    throw new AppError('VALIDATION', { message: 'برگشت باید دست‌کم یک قلم داشته باشد' });
  }

  return db.transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, 'BS');
    let total = 0n;
    for (const it of input.items) total += BigInt(it.unitCostRial) * BigInt(it.quantity);

    const { rows } = await tx.query<{ id: string; return_no: string }>(
      `INSERT INTO supplier_returns (return_no, supplier_id, goods_receipt_id, warehouse_id, total_rial, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, return_no`,
      [
        number.code,
        input.supplierId,
        input.goodsReceiptId ?? null,
        input.warehouseId ?? null,
        total.toString(),
        input.reason,
        input.actorId ?? null,
      ],
    );
    const record = rows[0]!;

    for (const it of input.items) {
      await tx.query(
        `INSERT INTO supplier_return_items (return_id, variant_id, quantity, unit_cost_rial, reason)
         VALUES ($1,$2,$3,$4,$5)`,
        [record.id, it.variantId, it.quantity, it.unitCostRial.toString(), it.reason ?? null],
      );

      // خروج از موجودی (اگر انبار مشخص شده باشد)
      if (input.warehouseId) {
        const { rows: stock } = await tx.query<{ on_hand: number }>(
          `SELECT on_hand FROM stock_items WHERE variant_id = $1 AND warehouse_id = $2`,
          [it.variantId, input.warehouseId],
        );
        if ((stock[0]?.on_hand ?? 0) < it.quantity) {
          throw new AppError('CONFLICT', {
            message: 'موجودیِ قفسه از مقدارِ برگشتی کمتر است',
          });
        }
        await tx.query(
          `UPDATE stock_items SET on_hand = on_hand - $1, updated_at = now()
            WHERE variant_id = $2 AND warehouse_id = $3`,
          [it.quantity, it.variantId, input.warehouseId],
        );
        await tx.query(
          `INSERT INTO stock_movements
             (variant_id, warehouse_id, quantity, reason, reference_type, reference_id, actor_user_id)
           VALUES ($1,$2,$3,'supplier_return','supplier_return',$4,$5)`,
          [it.variantId, input.warehouseId, -it.quantity, record.id, input.actorId ?? null],
        );
      }
    }

    return { returnNo: record.return_no, totalRial: total, returnId: record.id };
  });
}

/**
 * پیشنهادِ خودکارِ خرید از روی هشدارهایِ بازسازی (BR-15 → درخواستِ خرید)
 * چرا خودکار؟ چون انباردار نباید هر روز فهرستِ موجودی را زیر و رو کند؛
 * سیستم کمبود را می‌بیند و درخواست را «پیش‌نویس» می‌گذارد تا انسان تأیید کند.
 */
export async function suggestRequestsFromAlerts(db: Database, actorId?: string | null) {
  const { rows } = await db.query<{ id: string; variant_id: string; deficit: number }>(
    `SELECT id, variant_id, (reorder_point - available_at_check)::int AS deficit
       FROM reorder_alerts
      WHERE status = 'open'
      ORDER BY created_at DESC
      LIMIT 50`,
  );
  if (!rows.length) return { created: 0, requests: [] as PurchaseRequest[] };

  // درخواست‌ها را بر اساسِ تأمین‌کننده‌ی پیش‌فرض دسته‌بندی نمی‌کنیم (هنوز انتخاب
  // نشده)؛ یک درخواست به ازایِ هر ۲۰ قلم می‌سازیم تا فهرست خوانا بماند
  const chunks: Array<RequestItemInput[]> = [];
  for (let i = 0; i < rows.length; i += 20) {
    chunks.push(
      rows.slice(i, i + 20).map((r) => ({
        variantId: r.variant_id,
        quantity: Math.max(1, r.deficit),
      })),
    );
  }

  const requests: PurchaseRequest[] = [];
  for (const chunk of chunks) {
    const req = await createPurchaseRequest(db, {
      items: chunk,
      requestedBy: actorId ?? null,
      source: 'reorder_alert',
      priority: 'normal',
      reason: 'ساخته‌شده از هشدارِ رسیدن به نقطه‌ی سفارش',
    });
    requests.push(req);
  }

  return { created: requests.length, requests };
}

/* ---------- تسویه‌یِ فاکتورِ خرید ---------- */

export {
  paySupplierInvoice,
  clearSupplierCheck,
  listInvoicePayments,
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
  type PayInvoiceInput,
  type PaymentResult,
} from './settlement.js';
