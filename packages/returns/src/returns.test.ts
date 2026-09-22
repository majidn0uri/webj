import { randomUUID } from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabase, applyMigrations, seedCatalog, type Database } from '@set/db';
import { AccountingService } from '@set/accounting';
import {
  requestReturn,
  quoteReturn,
  decideReturn,
  markInTransit,
  receiveReturn,
  refundReturn,
  cancelReturn,
  getReturn,
  listReturns,
  returnSummary,
  readReturnSettings,
} from './service.js';
import { startWarranty, listWarranties, expiringWarranties, effectiveStatus } from './warranty.js';
import { evaluateEligibility } from './eligibility.js';
import { refundLine, restockFeeOf } from './refund.js';
import { canTransition, assertTransition } from './state.js';
import { trialBalanceOf } from './test-helpers.js';

/**
 * آزمون‌هایِ مرجوعی و گارانتی.
 *
 * چرا این آزمون‌ها نوشته شده‌اند؟ چون مرجوعی تنها جریانی است که در آن «پول از
 * جیبِ فروشگاه بیرون می‌رود» و همزمان «کالا به انبار برمی‌گردد» و «مالیات کم
 * می‌شود». اگر یکی از این سه جا بماند، ماه‌ها بعد به شکلِ اختلافِ انبار و
 * حسابداری بیرون می‌زند. هر آزمونِ اینجا یک لغزشِ ممکن را می‌بندد.
 */

let db: Database;
let accounting: AccountingService;
let warehouseId: string;
let variantId: string;
let orderId: string;
let orderItemId: string;
let userId: string;

/**
 * شماره‌یِ سفارش در این آزمون یکتا ساخته می‌شود، نه ثابت.
 * چرا؟ چون این پرونده بر پایگاهِ واقعی می‌رود و اگر شماره ثابت باشد و یک
 * اجرا ناتمام بماند (مثلاً کارگر کشته شود)، اجرایِ بعدی به یکتاییِ شماره‌ی
 * سفارش می‌خورد — بی‌آنکه هیچکس چیزی را شکسته باشد.
 */
let ORDER_NO = '';

beforeAll(async () => {
  db = createDatabase();
  await applyMigrations(db);
  await seedCatalog(db);
  accounting = new AccountingService(db);

  const { rows: wh } = await db.query<{ id: string }>(`SELECT id FROM warehouses ORDER BY id LIMIT 1`);
  warehouseId = wh[0]!.id;

  const { rows: v } = await db.query<{ id: string }>(
    `SELECT id FROM product_variants ORDER BY sku LIMIT 1`,
  );
  variantId = v[0]!.id;

  const { rows: u } = await db.query<{ id: string }>(`SELECT id FROM users LIMIT 1`);
  userId = u[0]?.id ?? null;

  // موجودی و سفارشِ پرداخت‌شده: زیربنایِ همه‌ی آزمون‌ها
  await db.query(
    `INSERT INTO stock_items (variant_id, warehouse_id, on_hand, reserved)
     VALUES ($1,$2,50,0)
     ON CONFLICT (variant_id, warehouse_id) DO UPDATE SET on_hand = 50`,
    [variantId, warehouseId],
  );
  await accounting.postPurchaseInvoice({
    supplierName: 'تأمین‌کننده‌ی آزمون',
    warehouseId,
    items: [{ variantId, quantity: 50, unitCostRial: 100_000n }],
  });

  ORDER_NO = `ORD-TEST-${randomUUID().slice(0, 8)}`;

  const { rows: o } = await db.query<{ id: string }>(
    `INSERT INTO orders (order_no, user_id, channel, status, subtotal_rial, tax_rial, total_rial, paid_at)
     VALUES ($2, $1, 'web', 'paid', 2_000_000, 180_000, 2_180_000, now())
     RETURNING id`,
    [userId, ORDER_NO],
  );
  orderId = o[0]!.id;

  // دو ردیف: یکی برایِ مرجوعیِ کامل، یکی برایِ مرجوعیِ جزئی
  const { rows: oi } = await db.query<{ id: string }>(
    `INSERT INTO order_items (order_id, variant_id, quantity, unit_price_rial, discount_rial, tax_rial, total_rial)
     VALUES ($1,$2,3,500_000,100_000,108_000,1_508_000)
     RETURNING id`,
    [orderId, variantId],
  );
  orderItemId = oi[0]!.id;
});

afterAll(async () => {
  await db.close();
});

/** سفارشِ تازه با یک ردیف — برایِ آزمون‌هایی که داده‌یِ دست‌نخورده می‌خواهند */
async function freshOrder(quantity: number, unitPrice: bigint, discount = 0n, paidDaysAgo = 0) {
  const { rows: o } = await db.query<{ id: string }>(
    `INSERT INTO orders (order_no, user_id, channel, status, subtotal_rial, tax_rial, total_rial, paid_at)
     VALUES ('ORD-' || substr(md5(random()::text),1,8), $1, 'web', 'paid',
             $2, $3, $4, now() - ($5 || ' days')::interval)
     RETURNING id`,
    [
      userId,
      (unitPrice * BigInt(quantity) - discount).toString(),
      (((unitPrice * BigInt(quantity) - discount) * 9n) / 100n).toString(),
      (unitPrice * BigInt(quantity) - discount + ((unitPrice * BigInt(quantity) - discount) * 9n) / 100n).toString(),
      paidDaysAgo,
    ],
  );
  const id = o[0]!.id;
  const tax = ((unitPrice * BigInt(quantity) - discount) * 9n) / 100n;
  const { rows: oi } = await db.query<{ id: string }>(
    `INSERT INTO order_items (order_id, variant_id, quantity, unit_price_rial, discount_rial, tax_rial, total_rial)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      id,
      variantId,
      quantity,
      unitPrice.toString(),
      discount.toString(),
      tax.toString(),
      (unitPrice * BigInt(quantity) - discount + tax).toString(),
    ],
  );
  return { orderId: id, orderItemId: oi[0]!.id };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('محاسبه‌یِ وجهِ بازگشتی', () => {
  it('برگشتِ کلِ ردیف، دقیقاً همان مبلغِ ثبت‌شده است (بدونِ رانشِ گردکردن)', () => {
    const line = refundLine({
      unitPriceRial: 500_000n,
      purchasedQuantity: 3,
      returnedQuantity: 3,
      lineDiscountRial: 100_000n,
      lineTaxRial: 108_000n,
    });
    // خالص: ۳×۵۰۰٬۰۰۰ − ۱۰۰٬۰۰۰ = ۱٬۴۰۰٬۰۰۰ | مالیات: ۱۰۸٬۰۰۰
    expect(line.netRial).toBe(1_400_000n);
    expect(line.taxRial).toBe(108_000n);
    expect(line.grossRial).toBe(1_508_000n);
  });

  it('برگشتِ جزئی، سهمِ همان تعداد است و از کلِ ردیف نمی‌گذرد', () => {
    const line = refundLine({
      unitPriceRial: 500_000n,
      purchasedQuantity: 3,
      returnedQuantity: 1,
      lineDiscountRial: 100_000n,
      lineTaxRial: 108_000n,
    });
    expect(line.netRial).toBe(466_667n); // ۱٬۴۰۰٬۰۰۰ ÷ ۳ با گردکردنِ نیم‌به‌بالا
    expect(line.taxRial).toBe(36_000n);
  });

  it('سه مرجوعیِ یک‌عددی رویِ هم، دقیقاً کلِ ردیف می‌شود — نه یک ریال بیشتر', () => {
    const base = {
      unitPriceRial: 500_000n,
      purchasedQuantity: 3,
      returnedQuantity: 1,
      lineDiscountRial: 100_000n,
      lineTaxRial: 108_000n,
    };
    const first = refundLine({ ...base, alreadyReturnedQuantity: 0 });
    const second = refundLine({ ...base, alreadyReturnedQuantity: 1 });
    const third = refundLine({ ...base, alreadyReturnedQuantity: 2 });
    expect(first.netRial + second.netRial + third.netRial).toBe(1_400_000n);
    expect(first.taxRial + second.taxRial + third.taxRial).toBe(108_000n);
  });

  it('کارمزدِ بازگشت فقط برایِ انصراف و فقط برایِ کالایِ ناسالم است', () => {
    const base = { netRial: 1_000_000n, feeBp: 500 };
    expect(restockFeeOf({ ...base, kind: 'withdrawal', condition: 'sellable' })).toBe(0n);
    expect(restockFeeOf({ ...base, kind: 'withdrawal', condition: 'damaged' })).toBe(50_000n);
    // تقصیر از فروشنده بوده: هرگز کارمزدی گرفته نمی‌شود
    expect(restockFeeOf({ ...base, kind: 'defective', condition: 'damaged' })).toBe(0n);
    expect(restockFeeOf({ ...base, kind: 'wrong_item', condition: 'opened' })).toBe(0n);
    expect(restockFeeOf({ ...base, kind: 'warranty', condition: 'damaged' })).toBe(0n);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('شایستگیِ مرجوعی', () => {
  const settings = { windowDays: 7, autoApproveWithdrawal: false, restockFeeBp: 0, warrantyDefaultMonths: 12 };

  it('انصراف در مهلت پذیرفته و پس از مهلت رد می‌شود', () => {
    const paidAt = new Date('2026-09-01T10:00:00Z');
    const inside = evaluateEligibility({
      kind: 'withdrawal',
      paidAt,
      orderStatus: 'paid',
      now: new Date('2026-09-05T10:00:00Z'),
      settings,
      purchasedQuantity: 2,
      alreadyReturned: 0,
      requestedQuantity: 1,
    });
    expect(inside.eligible).toBe(true);

    const outside = evaluateEligibility({
      kind: 'withdrawal',
      paidAt,
      orderStatus: 'paid',
      now: new Date('2026-09-20T10:00:00Z'),
      settings,
      purchasedQuantity: 2,
      alreadyReturned: 0,
      requestedQuantity: 1,
    });
    expect(outside.eligible).toBe(false);
    expect(outside.reasons[0]).toContain('مهلتِ انصراف');
  });

  it('کالایِ معیوب محدود به مهلتِ ۷ روز نیست (تقصیر از فروشنده بوده)', () => {
    const result = evaluateEligibility({
      kind: 'defective',
      paidAt: new Date('2025-01-01T10:00:00Z'),
      orderStatus: 'paid',
      now: new Date('2026-09-01T10:00:00Z'),
      settings,
      purchasedQuantity: 1,
      alreadyReturned: 0,
      requestedQuantity: 1,
    });
    expect(result.eligible).toBe(true);
    expect(result.deadlineAt).toBeNull();
  });

  it('ادعایِ گارانتی پس از پایانِ گارانتی پذیرفته نمی‌شود', () => {
    const result = evaluateEligibility({
      kind: 'warranty',
      paidAt: new Date('2024-01-01T10:00:00Z'),
      orderStatus: 'paid',
      now: new Date('2026-09-01T10:00:00Z'),
      settings,
      purchasedQuantity: 1,
      alreadyReturned: 0,
      requestedQuantity: 1,
      warrantyEndsAt: new Date('2025-01-01T00:00:00Z'),
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons.join(' ')).toContain('گارانتی');
  });

  it('بیش‌مرجوعی رد می‌شود و دلیلش دقیق گفته می‌شود', () => {
    const result = evaluateEligibility({
      kind: 'withdrawal',
      paidAt: new Date('2026-09-01T10:00:00Z'),
      orderStatus: 'paid',
      now: new Date('2026-09-02T10:00:00Z'),
      settings,
      purchasedQuantity: 2,
      alreadyReturned: 2,
      requestedQuantity: 1,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toContain('قابلِ مرجوعی است');
  });

  it('سفارشِ پرداخت‌نشده مرجوعی ندارد', () => {
    const result = evaluateEligibility({
      kind: 'withdrawal',
      paidAt: null,
      orderStatus: 'pending_payment',
      settings,
      purchasedQuantity: 1,
      alreadyReturned: 0,
      requestedQuantity: 1,
    });
    expect(result.eligible).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ماشینِ وضعیت', () => {
  it('وجه پیش از رسیدنِ کالا برنمی‌گردد', () => {
    expect(canTransition('approved', 'refunded')).toBe(false);
    expect(canTransition('refund_pending', 'refunded')).toBe(true);
    expect(() => assertTransition('approved', 'refunded')).toThrow();
  });

  it('مسیرِ کاملِ یک مرجوعی مجاز است', () => {
    const path = ['requested', 'approved', 'in_transit', 'received', 'inspecting', 'refund_pending', 'refunded'];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i] as never, path[i + 1] as never)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('فرآیندِ مرجوعی (پول، کالا و سند با هم)', () => {
  it('درخواست ثبت می‌شود، شماره می‌گیرد و در انتظارِ بررسی می‌ماند', async () => {
    const result = await requestReturn(db, {
      orderId,
      userId,
      kind: 'withdrawal',
      items: [{ orderItemId, quantity: 1 }],
      reason: 'پشیمان شدم',
    });

    expect(result.returnNo).toMatch(/^MR-\d{4}-\d{4}$/);
    expect(result.status).toBe('requested');

    const stored = await getReturn(db, result.id);
    expect(stored.ret.order_no).toBe(ORDER_NO);
    expect(stored.items).toHaveLength(1);
    expect(stored.events.length).toBeGreaterThanOrEqual(1);
  });

  it('بیش‌مرجوعی حتی با دسترسیِ مستقیم به پایگاه هم راه ندارد (قیدِ پایگاه)', async () => {
    const { orderId: oid, orderItemId: oiid } = await freshOrder(1, 400_000n);
    await requestReturn(db, { orderId: oid, userId, kind: 'withdrawal', items: [{ orderItemId: oiid, quantity: 1 }] });

    // بارِ دوم: دامنه‌یِ برنامه جلویش را می‌گیرد
    await expect(
      requestReturn(db, { orderId: oid, userId, kind: 'withdrawal', items: [{ orderItemId: oiid, quantity: 1 }] }),
    ).rejects.toThrow();

    // و اگر کسی از لایه‌یِ منطق هم بگذرد، تریگرِ پایگاه مانع است
    const { rows: rets } = await db.query<{ id: string }>(
      `SELECT id FROM customer_returns WHERE order_id = $1 LIMIT 1`,
      [oid],
    );
    await expect(
      db.query(
        `INSERT INTO customer_return_items (return_id, order_item_id, variant_id, quantity)
         VALUES ($1,$2,$3,5)`,
        [rets[0]!.id, oiid, variantId],
      ),
    ).rejects.toThrow(/بیش از مقدارِ خریداری‌شده/);
  });

  it('مرجوعیِ کالایِ سالم: کالا به انبار برمی‌گردد و سندِ برگشت از فروش ثبت می‌شود', async () => {
    const { orderId: oid, orderItemId: oiid } = await freshOrder(2, 500_000n, 0n);
    const before = await stockOf(variantId, warehouseId);

    const created = await requestReturn(db, {
      orderId: oid,
      userId,
      kind: 'withdrawal',
      items: [{ orderItemId: oiid, quantity: 2 }],
    });
    await decideReturn(db, { returnId: created.id, decision: 'approved', note: 'در مهلت' });
    await markInTransit(db, { returnId: created.id, trackingCode: 'TRACK-1' });

    const { rows: items } = await db.query<{ id: string }>(
      `SELECT id FROM customer_return_items WHERE return_id = $1`,
      [created.id],
    );

    const received = await receiveReturn(db, {
      returnId: created.id,
      items: [{ itemId: items[0]!.id, condition: 'sellable', restock: true }],
      warehouseId,
    });

    expect(received.restocked).toBe(2);
    expect(received.status).toBe('refund_pending');

    const after = await stockOf(variantId, warehouseId);
    expect(after).toBe(before + 2);

    // سند ثبت شده و دفتر تراز است
    const stored = await getReturn(db, created.id);
    expect(stored.ret.entry_id).not.toBeNull();
    expect(await trialBalanceOf(db)).toBe(true);
  });

  it('کالایِ آسیب‌دیده به موجودی برنمی‌گردد (بهایش در بهایِ فروش می‌ماند)', async () => {
    const { orderId: oid, orderItemId: oiid } = await freshOrder(1, 300_000n, 0n);
    const before = await stockOf(variantId, warehouseId);

    const created = await requestReturn(db, {
      orderId: oid,
      userId,
      kind: 'withdrawal',
      items: [{ orderItemId: oiid, quantity: 1 }],
    });
    await decideReturn(db, { returnId: created.id, decision: 'approved' });
    const { rows: items } = await db.query<{ id: string }>(
      `SELECT id FROM customer_return_items WHERE return_id = $1`,
      [created.id],
    );
    const received = await receiveReturn(db, {
      returnId: created.id,
      items: [{ itemId: items[0]!.id, condition: 'damaged', restock: true }],
      warehouseId,
    });

    expect(received.restocked).toBe(0);
    const after = await stockOf(variantId, warehouseId);
    expect(after).toBe(before);
  });

  it('بازگشتِ وجه، تعهد را می‌بندد و دفتر هم‌چنان تراز است', async () => {
    const { orderId: oid, orderItemId: oiid } = await freshOrder(1, 600_000n, 0n);
    const created = await requestReturn(db, {
      orderId: oid,
      userId,
      kind: 'defective',
      items: [{ orderItemId: oiid, quantity: 1 }],
    });
    await decideReturn(db, { returnId: created.id, decision: 'approved' });
    const { rows: items } = await db.query<{ id: string }>(
      `SELECT id FROM customer_return_items WHERE return_id = $1`,
      [created.id],
    );
    const received = await receiveReturn(db, {
      returnId: created.id,
      items: [{ itemId: items[0]!.id, condition: 'defective', restock: false }],
      warehouseId,
    });

    const refunded = await refundReturn(db, {
      returnId: created.id,
      method: 'bank_transfer',
      actorId: userId,
    });
    expect(refunded.status).toBe('refunded');
    expect(refunded.refundRial).toBe(received.refundRial);

    // دوباره نتوان بازگشت داد: وضعیتِ پایانی است
    await expect(
      refundReturn(db, { returnId: created.id, method: 'bank_transfer' }),
    ).rejects.toThrow();

    const stored = await getReturn(db, created.id);
    expect(stored.ret.refunded_at).not.toBeNull();
    expect(await trialBalanceOf(db)).toBe(true);
  });

  it('بیش از مبلغِ مصوب نمی‌توان برگرداند', async () => {
    const { orderId: oid, orderItemId: oiid } = await freshOrder(1, 200_000n, 0n);
    const created = await requestReturn(db, {
      orderId: oid,
      userId,
      kind: 'withdrawal',
      items: [{ orderItemId: oiid, quantity: 1 }],
    });
    await decideReturn(db, { returnId: created.id, decision: 'approved' });
    const { rows: items } = await db.query<{ id: string }>(
      `SELECT id FROM customer_return_items WHERE return_id = $1`,
      [created.id],
    );
    await receiveReturn(db, {
      returnId: created.id,
      items: [{ itemId: items[0]!.id, condition: 'sellable' }],
      warehouseId,
    });
    await expect(
      refundReturn(db, { returnId: created.id, method: 'bank_transfer', amountRial: 99_999_999n }),
    ).rejects.toThrow();
  });

  it('برآورد، پیش از ثبت، همان عددی را می‌گوید که بعداً ثبت می‌شود', async () => {
    const { orderId: oid, orderItemId: oiid } = await freshOrder(4, 250_000n, 100_000n);
    const quote = await quoteReturn(db, { orderId: oid, items: [{ orderItemId: oiid, quantity: 2 }] });
    const created = await requestReturn(db, {
      orderId: oid,
      userId,
      kind: 'withdrawal',
      items: [{ orderItemId: oiid, quantity: 2 }],
    });
    expect(created.quote.grossRial).toBe(quote.grossRial);
  });

  it('درخواستِ ردشده دیگر نمی‌تواند دریافت یا بازگشت بخورد', async () => {
    const { orderId: oid, orderItemId: oiid } = await freshOrder(1, 150_000n, 0n);
    const created = await requestReturn(db, {
      orderId: oid,
      userId,
      kind: 'withdrawal',
      items: [{ orderItemId: oiid, quantity: 1 }],
    });
    await decideReturn(db, { returnId: created.id, decision: 'rejected', note: 'مهلت گذشته' });
    await expect(markInTransit(db, { returnId: created.id })).rejects.toThrow();
  });

  it('لغو، درخواست را بی‌اثر می‌کند و کالا دوباره قابلِ مرجوعی می‌شود', async () => {
    const { orderId: oid, orderItemId: oiid } = await freshOrder(3, 120_000n, 0n);
    const first = await requestReturn(db, {
      orderId: oid,
      userId,
      kind: 'withdrawal',
      items: [{ orderItemId: oiid, quantity: 3 }],
    });
    await cancelReturn(db, { returnId: first.id, note: 'مشتری منصرف شد' });

    // پس از لغو، همان کالا دوباره قابلِ مرجوعی است (قید، مرجوعیِ لغوشده را
    // از حساب نمی‌آورد)
    const second = await requestReturn(db, {
      orderId: oid,
      userId,
      kind: 'withdrawal',
      items: [{ orderItemId: oiid, quantity: 3 }],
    });
    expect(second.status).toBe('requested');
  });

  it('فهرست و خلاصه، وضعیتِ کارتابل را درست نشان می‌دهند', async () => {
    const summary = await returnSummary(db);
    expect(summary.openCount).toBeGreaterThan(0);
    expect(summary.refundedCount).toBeGreaterThan(0);
    expect(BigInt(summary.refundedRial)).toBeGreaterThan(0n);

    const open = await listReturns(db, { status: 'open', limit: 100 });
    expect(open.every((r) => ['requested','approved','in_transit','received','inspecting','refund_pending'].includes(r.status))).toBe(true);

    const rejected = await listReturns(db, { status: 'rejected', limit: 100 });
    expect(rejected.every((r) => r.status === 'rejected')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('گارانتی', () => {
  it('گارانتی از پرداخت شروع می‌شود و پایانش با مدت هم‌خوان است', async () => {
    const { orderItemId: oiid } = await freshOrder(1, 900_000n, 0n, 10);
    const w = await startWarranty(db, { orderItemId: oiid, months: 18 });

    const { rows } = await db.query<{ starts_at: string; ends_at: string; months: number }>(
      `SELECT starts_at::text, ends_at::text, months FROM warranties WHERE id = $1`,
      [w.id],
    );
    expect(rows[0]!.months).toBe(18);
    const start = new Date(`${rows[0]!.starts_at}T00:00:00Z`);
    const end = new Date(`${rows[0]!.ends_at}T00:00:00Z`);
    const monthsDiff =
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
    expect(monthsDiff).toBe(18);
  });

  it('پایگاه نمی‌گذارد تاریخِ پایان با مدت ناهم‌خوان شود', async () => {
    const { orderItemId: oiid } = await freshOrder(1, 100_000n, 0n);
    const w = await startWarranty(db, { orderItemId: oiid, months: 12 });
    await expect(
      db.query(`UPDATE warranties SET ends_at = ends_at + 30 WHERE id = $1`, [w.id]),
    ).rejects.toThrow();
  });

  it('گارانتیِ رو به پایان پیدا می‌شود و ادعایِ رویِ آن ثبت می‌گردد', async () => {
    // گارانتی‌ای که ۵ روز دیگر تمام می‌شود
    const { orderId: oid, orderItemId: oiid } = await freshOrder(1, 700_000n, 0n);
    const created = await startWarranty(db, { orderItemId: oiid, months: 12 });
    // پایانِ گارانتی را نمی‌توان دستی عوض کرد (قیدِ پایگاه اجازه نمی‌دهد)؛
    // پس آغاز را جابه‌جا می‌کنیم تا پایانش ۵ روز دیگر شود
    await db.query(
      `UPDATE warranties
          SET starts_at = CURRENT_DATE + 5 - make_interval(months => months),
              ends_at   = CURRENT_DATE + 5
        WHERE id = $1`,
      [created.id],
    );

    const soon = await expiringWarranties(db, 30);
    expect(soon.some((w) => w.id === created.id)).toBe(true);

    const active = await listWarranties(db, { status: 'active', limit: 200 });
    expect(active.some((w) => w.id === created.id)).toBe(true);

    // ادعایِ گارانتی: مهلت تا پایانِ گارانتی است، نه ۷ روز
    const eligibility = await quoteReturn(db, { orderId: oid, items: [{ orderItemId: oiid, quantity: 1 }], kind: 'warranty' });
    expect(BigInt(eligibility.grossRial)).toBeGreaterThan(0n);

    const claimed = await requestReturn(db, {
      orderId: oid,
      userId,
      kind: 'warranty',
      items: [{ orderItemId: oiid, quantity: 1 }],
    });
    expect(claimed.status).toBe('requested');
  });

  it('وضعیتِ واقعیِ یک گارانتیِ گذشته «پایان‌یافته» است', () => {
    const row = {
      id: 'x', order_item_id: 'y', order_id: 'z', variant_id: 'v', user_id: null,
      serial_no: null, provider: 'manufacturer', starts_at: '2020-01-01',
      months: 12, ends_at: '2021-01-01', status: 'active',
      notes: null, created_at: '2020-01-01',
    } as never;
    expect(effectiveStatus(row, new Date('2026-09-01'))).toBe('expired');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('تنظیمات', () => {
  it('مهلتِ انصراف از پایگاه خوانده می‌شود', async () => {
    const s = await readReturnSettings(db);
    expect(s.windowDays).toBe(7);
    expect(s.warrantyDefaultMonths).toBe(12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
async function stockOf(variant: string, warehouse: string): Promise<number> {
  const { rows } = await db.query<{ on_hand: number }>(
    `SELECT on_hand FROM stock_items WHERE variant_id = $1 AND warehouse_id = $2`,
    [variant, warehouse],
  );
  return Number(rows[0]?.on_hand ?? 0);
}
