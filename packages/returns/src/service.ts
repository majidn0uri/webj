import type { Database, Queryable } from '@set/db';
import { AppError, type Rial } from '@set/shared-kernel';
import { AccountingService, updateWeightedAverage } from '@set/accounting';
import { nextDocumentNumber } from '@set/commerce';
import { createCreditNoteForReturn } from '@set/tax';
import { evaluateEligibility } from './eligibility.js';
import { refundLine, restockFeeOf } from './refund.js';
import { assertTransition, canTransition, isOpen } from './state.js';
import type {
  ItemCondition,
  RefundMethod,
  ReturnItemRow,
  ReturnKind,
  ReturnRow,
  ReturnSettings,
  ReturnStatus,
} from './types.js';

// حساب‌هایی که برایِ مرجوعی لازم داریم و در دفترِ پیش‌فرض نبوده‌اند
const ACCOUNT = {
  /** برگشت از فروش (کم‌کننده‌ی درآمد) */
  salesReturn: '4200',
  /** درآمدِ کارمزدِ مرجوعی (وقتی کالایِ بازشده برمی‌گردد) */
  restockFeeIncome: '4300',
  /** بدهیِ بازپرداخت به مشتری */
  refundPayable: '2300',
  /** موجودیِ کالا */
  inventory: '1000',
  /** بهایِ کالایِ فروخته‌شده */
  cogs: '5000',
  /** ارزش‌افزوده‌ی پرداختنی */
  vatPayable: '2100',
} as const;

// ===========================================================================
// تنظیمات
// ===========================================================================

export async function readReturnSettings(db: Queryable): Promise<ReturnSettings> {
  const { rows } = await db.query<{ key: string; value: string }>(
    `SELECT key, value FROM store_settings
      WHERE key IN ('return_window_days','return_auto_approve_withdrawal',
                    'return_restock_fee_bp','warranty_default_months')`,
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const num = (key: string, fallback: number): number => {
    const raw = Number(map.get(key));
    return Number.isFinite(raw) && map.get(key) !== undefined ? raw : fallback;
  };
  return {
    windowDays: num('return_window_days', 7),
    autoApproveWithdrawal: map.get('return_auto_approve_withdrawal') === 'true',
    restockFeeBp: num('return_restock_fee_bp', 0),
    warrantyDefaultMonths: num('warranty_default_months', 12),
  };
}

// ===========================================================================
// برآورد — «اگر این‌ها را برگردانم، چقدر برمی‌گردد؟»
// ===========================================================================

export interface QuoteItemInput {
  orderItemId: string;
  quantity: number;
}

export interface QuoteItemResult {
  orderItemId: string;
  variantId: string;
  title: string;
  quantity: number;
  netRial: Rial;
  taxRial: Rial;
  grossRial: Rial;
}

export interface ReturnQuote {
  items: QuoteItemResult[];
  netRial: Rial;
  taxRial: Rial;
  grossRial: Rial;
  /** کارمزدِ احتمالی — بسته به وضعیتِ کالا پس از بازرسی قطعی می‌شود */
  estimatedFeeRial: Rial;
}

/**
 * برآوردِ مبلغِ بازگشتی، پیش از آنکه چیزی ثبت شود.
 *
 * چرا جدا از «ثبت»؟ چون مشتری و پشتیبان باید پیش از تعهد بتوانند عدد را
 * ببینند. عددی که در انتها به مشتری گفته شود و با آنچه در سند ثبت شده فرق
 * داشته باشد، از هر خطایِ دیگری بدتر است: اعتماد را یک‌باره می‌سوزاند.
 */
export async function quoteReturn(
  db: Queryable,
  input: { orderId: string; items: QuoteItemInput[]; kind?: ReturnKind },
): Promise<ReturnQuote> {
  const kind = input.kind ?? 'withdrawal';
  const items: QuoteItemResult[] = [];
  let net = 0n;
  let tax = 0n;

  for (const requested of input.items) {
    const { rows } = await db.query<{
      id: string;
      variant_id: string;
      title: string;
      quantity: number;
      unit_price_rial: string;
      discount_rial: string;
      tax_rial: string;
    }>(
      `SELECT oi.id, oi.variant_id, p.title, oi.quantity,
              oi.unit_price_rial::text, oi.discount_rial::text, oi.tax_rial::text
         FROM order_items oi
         JOIN product_variants v ON v.id = oi.variant_id
         JOIN products p ON p.id = v.product_id
        WHERE oi.id = $1 AND oi.order_id = $2`,
      [requested.orderItemId, input.orderId],
    );
    const row = rows[0];
    if (!row) {
      throw new AppError('NOT_FOUND', { message: 'ردیفی با این شناسه در این سفارش نیست.' });
    }

    const line = refundLine({
      unitPriceRial: BigInt(row.unit_price_rial),
      purchasedQuantity: Number(row.quantity),
      returnedQuantity: requested.quantity,
      lineDiscountRial: BigInt(row.discount_rial),
      lineTaxRial: BigInt(row.tax_rial),
    });

    items.push({
      orderItemId: row.id,
      variantId: row.variant_id,
      title: row.title,
      quantity: requested.quantity,
      netRial: line.netRial,
      taxRial: line.taxRial,
      grossRial: line.grossRial,
    });
    net += line.netRial;
    tax += line.taxRial;
  }

  const settings = await readReturnSettings(db);
  const estimatedFee = items.reduce(
    (sum, it) =>
      sum +
      restockFeeOf({
        netRial: it.netRial,
        feeBp: settings.restockFeeBp,
        kind,
        // در مرحله‌یِ برآورد هنوز بازرسی نشده: بدترین حالت را نشان می‌دهیم تا
        // بعداً مشتری غافلگیر نشود
        condition: 'opened',
      }),
    0n,
  );

  return {
    items,
    netRial: net,
    taxRial: tax,
    grossRial: net + tax,
    estimatedFeeRial: estimatedFee,
  };
}

// ===========================================================================
// ثبتِ درخواست
// ===========================================================================

export interface RequestReturnInput {
  orderId: string;
  userId?: string | null;
  /** مشتری (برایِ درخواست‌هایی که خودِ مشتری ثبت می‌کند) */
  customerId?: string | null;
  kind: ReturnKind;
  items: QuoteItemInput[];
  reason?: string | null;
  customerNote?: string | null;
  pickupMethod?: 'courier' | 'in_person';
  /** کارمندی که از سمتِ مشتری درخواست را ثبت می‌کند (سفارشِ تلفنی) */
  actorId?: string | null;
}

/**
 * ثبتِ درخواستِ مرجوعی.
 *
 * همه‌اش در یک تراکنش است: بررسیِ شایستگی، شماره‌ی سند، ردیف‌ها و نخستین
 * رخداد. اگر هر بخش شکست بخورد، هیچ اثری از درخواست نمی‌ماند — درخواستِ
 * نیمه‌ثبت‌شده یعنی مشتری فکر می‌کند کالا را برگردانده و ما بی‌خبریم.
 */
export async function requestReturn(
  db: Database,
  input: RequestReturnInput,
): Promise<{ id: string; returnNo: string; status: ReturnStatus; quote: ReturnQuote }> {
  if (input.items.length === 0) {
    throw new AppError('VALIDATION', { message: 'دست‌کم یک کالا برایِ مرجوعی انتخاب کنید.' });
  }

  return db.transaction(async (tx) => {
    // قفل رویِ سفارش: دو درخواستِ همزمان نباید هر دو «آخرین عددِ باقی‌مانده»
    // را ببینند و هر دو پذیرفته شوند
    const orderRes = await tx.query<{
      id: string;
      order_no: string;
      status: string;
      paid_at: string | null;
      user_id: string | null;
      customer_id: string | null;
      branch_id: string | null;
    }>(
      `SELECT id, order_no, status, paid_at::text, user_id, branch_id
         FROM orders WHERE id = $1 FOR UPDATE`,
      [input.orderId],
    );
    const order = orderRes.rows[0];
    if (!order) throw new AppError('NOT_FOUND', { message: 'سفارشی با این شناسه نیست.' });

    const settings = await readReturnSettings(tx);
    const paidAt = order.paid_at ? new Date(order.paid_at) : null;

    const { rows: itemRows } = await tx.query<{
      id: string;
      variant_id: string;
      title: string;
      quantity: number;
      unit_price_rial: string;
      discount_rial: string;
      tax_rial: string;
      product_type: string | null;
      warranty_ends_at: string | null;
      already_returned: number;
    }>(
      `SELECT oi.id, oi.variant_id, p.title, oi.quantity,
              oi.unit_price_rial::text, oi.discount_rial::text, oi.tax_rial::text,
              pt.key AS product_type,
              w.ends_at::text AS warranty_ends_at,
              COALESCE((SELECT SUM(cri.quantity)::int
                          FROM customer_return_items cri
                          JOIN customer_returns cr ON cr.id = cri.return_id
                         WHERE cri.order_item_id = oi.id
                           AND cr.status NOT IN ('cancelled','rejected')), 0) AS already_returned
         FROM order_items oi
         JOIN product_variants v ON v.id = oi.variant_id
         JOIN products p ON p.id = v.product_id
         LEFT JOIN product_types pt ON pt.id = p.type_id
         LEFT JOIN warranties w ON w.order_item_id = oi.id
        WHERE oi.order_id = $1
        ORDER BY p.title`,
      [input.orderId],
    );

    const byId = new Map(itemRows.map((r) => [r.id, r]));
    const problems: string[] = [];
    const computed: Array<{ row: (typeof itemRows)[number]; quantity: number; net: Rial; tax: Rial }> =
      [];

    for (const requested of input.items) {
      const row = byId.get(requested.orderItemId);
      if (!row) {
        problems.push('ردیفی با این شناسه در این سفارش نیست.');
        continue;
      }
      const check = evaluateEligibility({
        kind: input.kind,
        paidAt,
        orderStatus: order.status,
        settings,
        purchasedQuantity: Number(row.quantity),
        alreadyReturned: Number(row.already_returned),
        requestedQuantity: requested.quantity,
        warrantyEndsAt: row.warranty_ends_at ? new Date(row.warranty_ends_at) : null,
        productType: row.product_type,
      });
      if (!check.eligible) {
        problems.push(`${row.title}: ${check.reasons.join(' ')}`);
        continue;
      }
      const line = refundLine({
        unitPriceRial: BigInt(row.unit_price_rial),
        purchasedQuantity: Number(row.quantity),
        returnedQuantity: requested.quantity,
        lineDiscountRial: BigInt(row.discount_rial),
        lineTaxRial: BigInt(row.tax_rial),
        alreadyReturnedQuantity: Number(row.already_returned),
      });
      computed.push({ row, quantity: requested.quantity, net: line.netRial, tax: line.taxRial });
    }

    if (problems.length > 0) {
      throw new AppError('VALIDATION', { message: problems.join(' | ') });
    }

    const now = new Date();
    const doc = await nextDocumentNumber(tx, 'MR', now);

    const autoApprove = settings.autoApproveWithdrawal && input.kind === 'withdrawal';
    const status: ReturnStatus = autoApprove ? 'approved' : 'requested';

    const insertRes = await tx.query<{ id: string }>(
      `INSERT INTO customer_returns
         (return_no, order_id, user_id, branch_id, kind, status, reason, customer_note,
          pickup_method, requested_at, decided_at, decided_by, decision_note, customer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(),
               CASE WHEN $6 <> 'requested' THEN now() END,
               CASE WHEN $6 <> 'requested' THEN $10::uuid END,
               CASE WHEN $6 <> 'requested' THEN 'پذیرشِ خودکار: درخواست در مهلت و بی‌نقص بود' END,
               $11::uuid)
       RETURNING id`,
      [
        doc.code,
        input.orderId,
        input.userId ?? order.user_id ?? null,
        order.branch_id,
        input.kind,
        status,
        input.reason ?? null,
        input.customerNote ?? null,
        input.pickupMethod ?? 'courier',
        input.actorId ?? null,
        input.customerId ?? order.customer_id ?? null,
      ],
    );
    const returnId = insertRes.rows[0]!.id;

    for (const c of computed) {
      await tx.query(
        `INSERT INTO customer_return_items
           (return_id, order_item_id, variant_id, quantity, refund_rial, refund_tax_rial)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          returnId,
          c.row.id,
          c.row.variant_id,
          c.quantity,
          (c.net + c.tax).toString(),
          c.tax.toString(),
        ],
      );
    }

    await tx.query(
      `INSERT INTO customer_return_events (return_id, event_type, to_status, actor_id, note)
       VALUES ($1,'requested',$2,$3,$4)`,
      [returnId, status, input.actorId ?? input.userId ?? null, input.customerNote ?? null],
    );

    const quote: ReturnQuote = {
      items: computed.map((c) => ({
        orderItemId: c.row.id,
        variantId: c.row.variant_id,
        title: c.row.title,
        quantity: c.quantity,
        netRial: c.net,
        taxRial: c.tax,
        grossRial: c.net + c.tax,
      })),
      netRial: computed.reduce((s, c) => s + c.net, 0n),
      taxRial: computed.reduce((s, c) => s + c.tax, 0n),
      grossRial: computed.reduce((s, c) => s + c.net + c.tax, 0n),
      estimatedFeeRial: 0n,
    };

    return { id: returnId, returnNo: doc.code, status, quote };
  });
}

// ===========================================================================
// تصمیم
// ===========================================================================

export async function decideReturn(
  db: Database,
  input: { returnId: string; decision: 'approved' | 'rejected'; actorId?: string | null; note?: string | null },
): Promise<{ id: string; status: ReturnStatus }> {
  return db.transaction(async (tx) => {
    const current = await lockReturn(tx, input.returnId);
    const to: ReturnStatus = input.decision === 'approved' ? 'approved' : 'rejected';
    assertTransition(current.status, to);

    await tx.query(
      `UPDATE customer_returns
          SET status = $2, decided_at = now(), decided_by = $3, decision_note = $4,
              updated_at = now()
        WHERE id = $1`,
      [input.returnId, to, input.actorId ?? null, input.note ?? null],
    );
    await recordEvent(tx, {
      returnId: input.returnId,
      eventType: input.decision === 'approved' ? 'approved' : 'rejected',
      from: current.status,
      to,
      actorId: input.actorId ?? null,
      note: input.note ?? null,
    });
    return { id: input.returnId, status: to };
  });
}

export async function markInTransit(
  db: Database,
  input: { returnId: string; trackingCode?: string | null; actorId?: string | null },
): Promise<{ id: string; status: ReturnStatus }> {
  return db.transaction(async (tx) => {
    const current = await lockReturn(tx, input.returnId);
    assertTransition(current.status, 'in_transit');
    await tx.query(
      `UPDATE customer_returns SET status = 'in_transit', tracking_code = $2, updated_at = now()
        WHERE id = $1`,
      [input.returnId, input.trackingCode ?? null],
    );
    await recordEvent(tx, {
      returnId: input.returnId,
      eventType: 'in_transit',
      from: current.status,
      to: 'in_transit',
      actorId: input.actorId ?? null,
      note: input.trackingCode ? `کدِ رهگیری: ${input.trackingCode}` : null,
    });
    return { id: input.returnId, status: 'in_transit' };
  });
}

// ===========================================================================
// دریافت و بازرسی — جایی که کالا به انبار برمی‌گردد و سند می‌خورد
// ===========================================================================

export interface ReceivedItemInput {
  itemId: string;
  condition: ItemCondition;
  restock?: boolean;
  note?: string | null;
}

/**
 * دریافت و بازرسیِ کالایِ برگشتی.
 *
 * این مهم‌ترین تابعِ این بسته است و سه کار را در یک تراکنش انجام می‌دهد:
 *   ۱) وضعیتِ هر ردیف را پس از بازرسی ثبت می‌کند (سالم؟ آسیب‌دیده؟)؛
 *   ۲) کالایِ قابلِ فروش را به موجودی برمی‌گرداند — هم موجودیِ فیزیکی
 *      (stock_items) و هم موجودیِ حسابداری و بهایِ میانگین؛
 *   ۳) سندِ «برگشت از فروش» را می‌نویسد.
 *
 * چرا هر سه با هم؟ چون اگر موجودی برگردد اما سند نخورد، ترازنامه دروغ می‌گوید؛
 * و اگر سند بخورد اما موجودی برنگردد، انبار عددی را نشان می‌دهد که در قفسه
 * نیست. جداییِ این دو همان خطایِ کلاسیکی است که انبار و حسابداری را به جانِ
 * هم می‌اندازد.
 */
export async function receiveReturn(
  db: Database,
  input: {
    returnId: string;
    items: ReceivedItemInput[];
    warehouseId?: string | null;
    actorId?: string | null;
    note?: string | null;
  },
): Promise<{ id: string; status: ReturnStatus; refundRial: Rial; restockFeeRial: Rial; restocked: number }> {
  return db.transaction(async (tx) => {
    const current = await lockReturn(tx, input.returnId);

    // مسیر: تأییدشده/در راه ← رسیده ← در بازرسی ← در انتظارِ وجه
    //
    // چرا «تأییدشده» هم پذیرفته می‌شود؟ چون اگر مشتری کالا را حضوری
    // برگرداند، هرگز وضعیتِ «در راه» ثبت نمی‌شود. و چرا «رسیده» هم؟ چون
    // انباردار ممکن است نخست رسیدن را ثبت کند و بازرسی را بعداً انجام دهد.
    const allowedPredecessors: ReturnStatus[] = ['approved', 'in_transit', 'received'];
    if (!allowedPredecessors.includes(current.status)) {
      assertTransition(current.status, 'received'); // پیامِ خطا با فهرستِ راه‌هایِ مجاز
    }
    const from = current.status;
    if (current.status !== 'received') {
      await tx.query(
        `UPDATE customer_returns
            SET status = 'received', received_at = COALESCE(received_at, now()),
                received_by = $2, updated_at = now()
          WHERE id = $1`,
        [input.returnId, input.actorId ?? null],
      );
      await recordEvent(tx, {
        returnId: input.returnId,
        eventType: 'received',
        from,
        to: 'received',
        actorId: input.actorId ?? null,
        note: 'کالا به انبار رسید',
      });
    }

    const { rows: itemRows } = await tx.query<{
      id: string;
      order_item_id: string;
      variant_id: string;
      quantity: number;
      refund_rial: string;
      refund_tax_rial: string;
      unit_price_rial: string;
      purchased_quantity: number;
      line_discount_rial: string;
      line_tax_rial: string;
    }>(
      `SELECT cri.id, cri.order_item_id, cri.variant_id, cri.quantity,
              cri.refund_rial::text, cri.refund_tax_rial::text,
              oi.unit_price_rial::text, oi.quantity AS purchased_quantity,
              oi.discount_rial::text AS line_discount_rial,
              oi.tax_rial::text AS line_tax_rial
         FROM customer_return_items cri
         JOIN order_items oi ON oi.id = cri.order_item_id
        WHERE cri.return_id = $1
        ORDER BY cri.id`,
      [input.returnId],
    );

    const byId = new Map(itemRows.map((r) => [r.id, r]));
    const settings = await readReturnSettings(tx);
    const accounting = new AccountingService(db);

    // حساب‌ها باید با همان تراکنش ساخته شوند (ساخت با اتصالِ جدا بن‌بست می‌سازد)
    await accounting.ensureAccountOn(tx, ACCOUNT.salesReturn, 'برگشت از فروش و مرجوعی', 'revenue');
    await accounting.ensureAccountOn(tx, ACCOUNT.restockFeeIncome, 'درآمدِ کارمزدِ مرجوعی', 'revenue');
    await accounting.ensureAccountOn(tx, ACCOUNT.refundPayable, 'بدهیِ بازپرداخت به مشتریان', 'liability');

    let totalNet = 0n;
    let totalTax = 0n;
    let totalFee = 0n;
    let restocked = 0;
    let cogsReversal = 0n;

    for (const received of input.items) {
      const row = byId.get(received.itemId);
      if (!row) {
        throw new AppError('NOT_FOUND', { message: 'ردیفی با این شناسه در این مرجوعی نیست.' });
      }

      // مبلغ را بر پایه‌یِ وضعیتِ بازرسی‌شده دوباره حساب می‌کنیم: کارمزد فقط
      // وقتی می‌آید که کالا سالم برنگشته باشد و تقصیر هم از ما نباشد
      const base = refundLine({
        unitPriceRial: BigInt(row.unit_price_rial),
        purchasedQuantity: Number(row.purchased_quantity),
        returnedQuantity: Number(row.quantity),
        lineDiscountRial: BigInt(row.line_discount_rial),
        lineTaxRial: BigInt(row.line_tax_rial),
      });
      const fee = restockFeeOf({
        netRial: base.netRial,
        feeBp: settings.restockFeeBp,
        kind: current.kind,
        condition: received.condition,
      });

      const restock = received.restock ?? true;
      const canRestock =
        restock && (received.condition === 'sellable' || received.condition === 'opened');

      await tx.query(
        `UPDATE customer_return_items
            SET condition = $2, restock = $3, note = $4,
                refund_rial = $5, refund_tax_rial = $6
          WHERE id = $1`,
        [
          row.id,
          received.condition,
          canRestock,
          received.note ?? null,
          (base.netRial + base.taxRial - fee).toString(),
          base.taxRial.toString(),
        ],
      );

      totalNet += base.netRial;
      totalTax += base.taxRial;
      totalFee += fee;

      if (canRestock) {
        const warehouseId = input.warehouseId ?? (await defaultWarehouse(tx));
        // موجودیِ فیزیکی
        await tx.query(
          `INSERT INTO stock_items (variant_id, warehouse_id, on_hand, reserved)
           VALUES ($1,$2,$3,0)
           ON CONFLICT (variant_id, warehouse_id)
           DO UPDATE SET on_hand = stock_items.on_hand + EXCLUDED.on_hand,
                         updated_at = now()`,
          [row.variant_id, warehouseId, Number(row.quantity)],
        );

        // موجودیِ حسابداری و بهایِ میانگین: کالا با همان بهایی برمی‌گردد که
        // اکنون میانگینِ انبار است. بهایِ تک‌تکِ واحدها را جدا نگه نمی‌داریم
        // (نیازمندِ ردیابیِ سریال است)؛ این ساده‌سازی در مستندات آمده است.
        const { rows: val } = await tx.query<{ avg_cost_rial: string }>(
          `SELECT avg_cost_rial::text FROM inventory_valuation
            WHERE variant_id = $1 AND warehouse_id = $2`,
          [row.variant_id, warehouseId],
        );
        const avg = BigInt(val[0]?.avg_cost_rial ?? '0');
        const cost = avg * BigInt(row.quantity);
        await updateWeightedAverage(tx, warehouseId, row.variant_id, Number(row.quantity), cost);
        cogsReversal += cost;
        restocked += Number(row.quantity);
      }
    }

    // ── سندِ برگشت از فروش ────────────────────────────────────────────────
    // بدهکار: برگشت از فروش (کاهشِ درآمد) + ارزش‌افزوده (کاهشِ بدهیِ مالیاتی)
    // بستانکار: بدهیِ بازپرداخت به مشتری + کارمزدی که به‌عنوان درآمد می‌ماند
    const lines: Array<{ code: string; debit?: Rial; credit?: Rial; note: string }> = [
      {
        code: ACCOUNT.salesReturn,
        debit: totalNet,
        note: 'برگشت از فروش — خالصِ کالایِ مرجوعی',
      },
    ];
    if (totalTax > 0n) {
      lines.push({ code: ACCOUNT.vatPayable, debit: totalTax, note: 'کاهشِ ارزش‌افزوده‌ی فروشِ برگشتی' });
    }
    if (totalFee > 0n) {
      lines.push({ code: ACCOUNT.restockFeeIncome, credit: totalFee, note: 'کارمزدِ بازگشتِ کالا' });
    }
    lines.push({
      code: ACCOUNT.refundPayable,
      credit: totalNet + totalTax - totalFee,
      note: 'بدهیِ بازپرداخت به مشتری',
    });
    if (cogsReversal > 0n) {
      lines.push({ code: ACCOUNT.inventory, debit: cogsReversal, note: 'بازگشتِ کالا به موجودی' });
      lines.push({ code: ACCOUNT.cogs, credit: cogsReversal, note: 'برگشتِ بهایِ کالایِ فروخته‌شده' });
    }

    const entry = await accounting.postJournalOn(tx, {
      description: `برگشت از فروش — مرجوعیِ ${current.return_no}`,
      referenceType: 'customer_return',
      referenceId: input.returnId,
      lines: lines.map((l) => ({
        accountCode: l.code,
        debitRial: l.debit ?? 0n,
        creditRial: l.credit ?? 0n,
        description: l.note,
      })),
    });

    const refundTotal = totalNet + totalTax - totalFee;

    // ── اعتبارِ مالیاتی ────────────────────────────────────────────────────
    // اگر برایِ این سفارش صورتحساب صادر شده، اصلاحی‌اش را در صف می‌گذاریم تا
    // ارزش‌افزوده‌ی فروشِ برگشتی همچنان بدهی نماند. نبودِ صورتحسابِ اصلی خطا
    // نیست (ممکن است سفارش هنوز ارسال نشده باشد).
    let creditNoteId: string | null = null;
    try {
      const credit = await createCreditNoteForReturn(tx, {
        returnId: input.returnId,
        orderId: current.order_id,
        orderNo: null,
      });
      creditNoteId = credit?.id ?? null;
    } catch (error) {
      // شکست در صدورِ اصلاحی نباید جلویِ ثبتِ مرجوعی را بگیرد؛ اما بی‌صدا هم
      // نمی‌ماند: در رخداد ثبت می‌شود تا در پنل دیده شود.
      await recordEvent(tx, {
        returnId: input.returnId,
        eventType: 'credit_note_failed',
        from: current.status,
        to: 'refund_pending',
        actorId: input.actorId ?? null,
        note: `صدورِ صورتحسابِ اصلاحی ناموفق بود: ${(error as Error).message}`,
      });
    }
    if (creditNoteId) {
      await recordEvent(tx, {
        returnId: input.returnId,
        eventType: 'credit_note_queued',
        from: current.status,
        to: 'refund_pending',
        actorId: input.actorId ?? null,
        note: 'صورتحسابِ اصلاحی در صفِ ارسال قرار گرفت',
      });
    }

    await tx.query(
      `UPDATE customer_returns
          SET status = 'refund_pending', received_at = COALESCE(received_at, now()),
              received_by = $2, refund_rial = $3, restock_fee_rial = $4,
              entry_id = $5, updated_at = now()
        WHERE id = $1`,
      [input.returnId, input.actorId ?? null, refundTotal.toString(), totalFee.toString(), entry.entryId],
    );

    await recordEvent(tx, {
      returnId: input.returnId,
      eventType: 'inspected',
      from: 'inspecting',
      to: 'refund_pending',
      actorId: input.actorId ?? null,
      note:
        `بازرسی شد: ${restocked} عدد به موجودی برگشت` +
        (totalFee > 0n ? `، کارمزدِ ${totalFee.toString()} ریال` : '') +
        (input.note ? ` — ${input.note}` : ''),
    });

    return {
      id: input.returnId,
      status: 'refund_pending',
      refundRial: refundTotal,
      restockFeeRial: totalFee,
      restocked,
    };
  });
}

// ===========================================================================
// بازگشتِ وجه
// ===========================================================================

/**
 * پرداختِ وجهِ مرجوعی به مشتری.
 *
 * دو مرحله‌ای است (تعهد در بازرسی، پرداخت اینجا) چون در دنیایِ واقعی،
 * بازگشتِ پول از درگاه زمان می‌برد و ممکن است شکست بخورد. اگر همان لحظه‌یِ
 * بازرسی «پرداخت شد» می‌زدیم، بدهی‌ای که هنوز پرداخت نشده از دفتر پاک می‌شد و
 * ترازِ بدهیِ مشتریان غلط می‌شد. با این دو مرحله، بدهی تا لحظه‌یِ واریز سرِ
 * جایش می‌ماند و در گزارشِ «بدهی به مشتریان» دیده می‌شود.
 */
export async function refundReturn(
  db: Database,
  input: {
    returnId: string;
    method: RefundMethod;
    actorId?: string | null;
    /** مبلغِ دستی (اگر با برآورد فرق دارد) — باید علت در یادداشت بیاید */
    amountRial?: Rial;
    note?: string | null;
  },
): Promise<{ id: string; status: ReturnStatus; refundRial: Rial }> {
  return db.transaction(async (tx) => {
    const current = await lockReturn(tx, input.returnId);
    assertTransition(current.status, 'refunded');

    const planned = BigInt(current.refund_rial);
    const amount = input.amountRial ?? planned;
    if (amount <= 0n) {
      throw new AppError('VALIDATION', { message: 'مبلغِ بازگشت باید بیش از صفر باشد.' });
    }
    if (input.amountRial !== undefined && input.amountRial > planned) {
      throw new AppError('VALIDATION', {
        message: `مبلغِ بازگشت (${input.amountRial}) نمی‌تواند از مبلغِ مصوبِ مرجوعی (${planned}) بیشتر باشد.`,
      });
    }

    const accounting = new AccountingService(db);
    await accounting.ensureAccountOn(tx, ACCOUNT.refundPayable, 'بدهیِ بازپرداخت به مشتریان', 'liability');

    // مقصد: پرداختِ آنلاین از بانک برمی‌گردد، فروشِ حضوری از صندوق
    const settlementCode = input.method === 'store_credit' || input.method === 'exchange'
      ? ACCOUNT.refundPayable
      : await settlementAccountFor(tx, current.order_id);

    const lines =
      input.method === 'store_credit' || input.method === 'exchange'
        ? [
            // تعویض یا اعتبار: پولی جابه‌جا نمی‌شود، تعهد از نوعی به نوعِ دیگر
            // می‌رود (بدهیِ بازپرداخت → اعتبارِ مشتری)
            {
              accountCode: ACCOUNT.refundPayable,
              debitRial: amount,
              creditRial: 0n,
              description: 'تسویه‌یِ تعهد از محلِ اعتبار/تعویض',
            },
            {
              accountCode: '2300',
              debitRial: 0n,
              creditRial: amount,
              description: 'تبدیل به اعتبارِ مشتری',
            },
          ]
        : [
            {
              accountCode: ACCOUNT.refundPayable,
              debitRial: amount,
              creditRial: 0n,
              description: 'پرداختِ وجهِ مرجوعی به مشتری',
            },
            {
              accountCode: settlementCode,
              debitRial: 0n,
              creditRial: amount,
              description: 'خروجِ وجه از صندوق/بانک',
            },
          ];

    await accounting.postJournalOn(tx, {
      description: `بازگشتِ وجهِ مرجوعیِ ${current.return_no} (${input.method})`,
      referenceType: 'customer_return_refund',
      referenceId: input.returnId,
      lines,
    });

    await tx.query(
      `UPDATE customer_returns
          SET status = 'refunded', refunded_at = now(), refunded_by = $2,
              refund_method = $3, refund_rial = $4, updated_at = now()
        WHERE id = $1`,
      [input.returnId, input.actorId ?? null, input.method, amount.toString()],
    );

    await recordEvent(tx, {
      returnId: input.returnId,
      eventType: 'refunded',
      from: current.status,
      to: 'refunded',
      actorId: input.actorId ?? null,
      note: input.note ?? `مبلغ ${amount.toString()} ریال از راهِ «${input.method}» برگشت داده شد`,
    });

    return { id: input.returnId, status: 'refunded', refundRial: amount };
  });
}

export async function cancelReturn(
  db: Database,
  input: { returnId: string; actorId?: string | null; note?: string | null },
): Promise<{ id: string; status: ReturnStatus }> {
  return db.transaction(async (tx) => {
    const current = await lockReturn(tx, input.returnId);
    assertTransition(current.status, 'cancelled');
    await tx.query(
      `UPDATE customer_returns SET status = 'cancelled', updated_at = now() WHERE id = $1`,
      [input.returnId],
    );
    await recordEvent(tx, {
      returnId: input.returnId,
      eventType: 'cancelled',
      from: current.status,
      to: 'cancelled',
      actorId: input.actorId ?? null,
      note: input.note ?? null,
    });
    return { id: input.returnId, status: 'cancelled' };
  });
}

// ===========================================================================
// خواندن
// ===========================================================================

export async function getReturn(
  db: Queryable,
  id: string,
): Promise<{ ret: ReturnRow; items: Array<ReturnItemRow & { title: string; sku: string | null }>; events: unknown[]; order: { order_no: string; paid_at: string | null; total_rial: string } }> {
  const { rows } = await db.query<ReturnRow & { order_no: string }>(
    `SELECT cr.*, o.order_no
       FROM customer_returns cr JOIN orders o ON o.id = cr.order_id
      WHERE cr.id = $1`,
    [id],
  );
  const ret = rows[0];
  if (!ret) throw new AppError('NOT_FOUND', { message: 'مرجوعی‌ای با این شناسه نیست.' });

  const items = await db.query<
    ReturnItemRow & { title: string; sku: string | null }
  >(
    `SELECT cri.*, p.title, v.sku
       FROM customer_return_items cri
       JOIN product_variants v ON v.id = cri.variant_id
       JOIN products p ON p.id = v.product_id
      WHERE cri.return_id = $1
      ORDER BY p.title`,
    [id],
  );

  const events = await db.query(
    `SELECT * FROM customer_return_events WHERE return_id = $1 ORDER BY created_at, id`,
    [id],
  );

  const order = await db.query<{ order_no: string; paid_at: string | null; total_rial: string }>(
    `SELECT order_no, paid_at::text, total_rial::text FROM orders WHERE id = $1`,
    [ret.order_id],
  );

  return { ret, items: items.rows, events: events.rows, order: order.rows[0]! };
}

export interface ListReturnsFilter {
  status?: ReturnStatus | 'open';
  kind?: ReturnKind;
  /** فقط مرجوعی‌هایِ این مشتری (برایِ «مرجوعی‌هایِ من») */
  customerId?: string;
  q?: string;
  limit?: number;
}

export async function listReturns(
  db: Queryable,
  filter: ListReturnsFilter = {},
): Promise<Array<ReturnRow & { order_no: string; customer_name: string | null; item_count: number }>> {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.status && filter.status !== 'open') {
    params.push(filter.status);
    clauses.push(`cr.status = $${params.length}`);
  }
  if (filter.kind) {
    params.push(filter.kind);
    clauses.push(`cr.kind = $${params.length}`);
  }
  if (filter.customerId) {
    params.push(filter.customerId);
    clauses.push(`cr.customer_id = $${params.length}`);
  }
  if (filter.q && filter.q.trim()) {
    params.push(`%${filter.q.trim()}%`);
    clauses.push(
      `(cr.return_no ILIKE $${params.length} OR o.order_no ILIKE $${params.length}
        OR o.customer_mobile ILIKE $${params.length} OR o.customer_name ILIKE $${params.length})`,
    );
  }
  params.push(Math.min(Math.max(filter.limit ?? 50, 1), 200));

  const { rows } = await db.query<
    ReturnRow & { order_no: string; customer_name: string | null; item_count: number }
  >(
    `SELECT cr.*, o.order_no, o.customer_name,
            (SELECT COUNT(*)::int FROM customer_return_items cri WHERE cri.return_id = cr.id) AS item_count
       FROM customer_returns cr
       JOIN orders o ON o.id = cr.order_id
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY cr.requested_at DESC
      LIMIT $${params.length}`,
    params,
  );

  const result = rows;
  if (filter.status === 'open') return result.filter((r) => isOpen(r.status));
  return result;
}

export async function returnSummary(db: Queryable): Promise<{
  awaitingDecision: number;
  awaitingRefund: number;
  refundedCount: number;
  refundedRial: string;
  openCount: number;
  averageDaysToRefund: number | null;
}> {
  const counts = await db.query<{ status: string; count: number }>(
    `SELECT status, COUNT(*)::int AS count FROM customer_returns GROUP BY status`,
  );
  const map = new Map(counts.rows.map((r) => [r.status, Number(r.count)]));
  const pick = (...keys: string[]) => keys.reduce((s, k) => s + (map.get(k) ?? 0), 0);

  const money = await db.query<{ total: string; count: string; days: string | null }>(
    `SELECT COALESCE(SUM(refund_rial),0)::text AS total,
            COUNT(*)::text AS count,
            ROUND(AVG(EXTRACT(EPOCH FROM (refunded_at - requested_at)) / 86400), 1)::text AS days
       FROM customer_returns
      WHERE status IN ('refunded','closed') AND refunded_at IS NOT NULL`,
  );

  return {
    awaitingDecision: pick('requested'),
    awaitingRefund: pick('refund_pending', 'inspecting', 'received', 'in_transit', 'approved'),
    refundedCount: pick('refunded', 'closed'),
    refundedRial: money.rows[0]?.total ?? '0',
    openCount: pick('requested', 'approved', 'in_transit', 'received', 'inspecting', 'refund_pending'),
    averageDaysToRefund: money.rows[0]?.days ? Number(money.rows[0].days) : null,
  };
}

// ===========================================================================
// ابزارها
// ===========================================================================

async function lockReturn(tx: Queryable, id: string): Promise<ReturnRow> {
  const { rows } = await tx.query<ReturnRow>(
    `SELECT * FROM customer_returns WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', { message: 'مرجوعی‌ای با این شناسه نیست.' });
  return row;
}

async function recordEvent(
  tx: Queryable,
  input: {
    returnId: string;
    eventType: string;
    from: ReturnStatus | null;
    to: ReturnStatus | null;
    actorId?: string | null;
    note?: string | null;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO customer_return_events (return_id, event_type, from_status, to_status, actor_id, note)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [input.returnId, input.eventType, input.from, input.to, input.actorId ?? null, input.note ?? null],
  );
}

async function defaultWarehouse(tx: Queryable): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(`SELECT id FROM warehouses ORDER BY id LIMIT 1`);
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', { message: 'هیچ انباری تعریف نشده است.' });
  return row.id;
}

/** مقصدِ پول: فروشِ حضوری از صندوق، فروشِ آنلاین از بانک */
async function settlementAccountFor(tx: Queryable, orderId: string): Promise<string> {
  const { rows } = await tx.query<{ channel: string }>(
    `SELECT channel FROM orders WHERE id = $1`,
    [orderId],
  );
  return rows[0]?.channel === 'pos' ? '1100' : '1200';
}
