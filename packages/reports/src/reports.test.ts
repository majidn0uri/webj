import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabase, applyMigrations, seedCatalog, type Database } from '@set/db';
import { AccountingService } from '@set/accounting';
import { OrderService } from '@set/orders';
import { grossProfit, stockTurnover, debtors, cachedReport } from './index.js';

/**
 * آزمون‌هایِ گزارش‌هایِ مدیریتی.
 *
 * چرا همه‌ی آزمون‌ها روی یک پایگاهِ مشترکند (beforeAll به‌جای beforeEach)؟
 * چون پایگاهِ حافظه‌ایِ آزمون یک نمونه‌یِ کاملِ Postgres روی وب‌اسمبلی است و
 * هر نمونه صدها مگابایت حافظه می‌گیرد؛ ساختنِ یک نمونه به‌ازایِ هر آزمون،
 * روی دستگاهِ کم‌حافظه آزمون‌ها را می‌کشد. در عوض، هر آزمون فقط «می‌خواند»
 * و داده‌ی مشترک در beforeAll یک‌بار ساخته می‌شود — به‌جز دو آزمونی که
 * ناچارند داده را دستکاری کنند؛ آن‌ها تغییرشان را در پایان برمی‌گردانند تا
 * آزمون‌هایِ دیگر بی‌اثر بمانند.
 */

let db: Database;
let accounting: AccountingService;
let orders: OrderService;
let warehouseId: string;
let caseVariantId: string;
let cableVariantId: string;

/** بهایِ خریدی که خودمان در آزمون روی کالا می‌نشانیم (ریال) */
const CASE_PURCHASE_COST = 1_000_000n;

let caseOrderId: string;
let cableOrderId: string;
let caseUnitCost = 0n;
let caseUnitPrice = 0n;
let cableUnitPrice = 0n;

beforeAll(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  await seedCatalog(db);
  accounting = new AccountingService(db);
  orders = new OrderService(db);

  const { rows: w } = await db.query<{ id: string }>(`SELECT id FROM warehouses LIMIT 1`);
  warehouseId = w[0]!.id;

  const { rows: v } = await db.query<{ id: string; sku: string; price_rial: string }>(
    `SELECT id, sku, price_rial::text FROM product_variants WHERE sku IN ('CS-13P-BLK','CB-LT-1M')`,
  );
  caseVariantId = v.find((r) => r.sku === 'CS-13P-BLK')!.id;
  cableVariantId = v.find((r) => r.sku === 'CB-LT-1M')!.id;
  caseUnitPrice = BigInt(v.find((r) => r.sku === 'CS-13P-BLK')!.price_rial);
  cableUnitPrice = BigInt(v.find((r) => r.sku === 'CB-LT-1M')!.price_rial);

  // ۱) خرید: بهایِ میانگینِ موزون را روشن می‌کند (مبنایِ سودِ ناخالص)
  await accounting.postPurchaseInvoice({
    supplierName: 'تأمین‌کننده‌ی نمونه',
    warehouseId,
    items: [{ variantId: caseVariantId, quantity: 10, unitCostRial: CASE_PURCHASE_COST }],
  });

  const { rows: val } = await db.query<{ avg_cost_rial: string }>(
    `SELECT avg_cost_rial::text FROM inventory_valuation WHERE variant_id = $1 LIMIT 1`,
    [caseVariantId],
  );
  caseUnitCost = BigInt(val[0]!.avg_cost_rial);

  // ۲) دو فروش: یکی اینترنتی (قاب)، یکی حضوری (کابل)
  const a = await orders.createOrder({
    items: [{ variantId: caseVariantId, quantity: 2 }],
    customerName: 'سارا احمدی',
    customerMobile: '09120000001',
    shippingAddress: { city: 'تهران', address: 'خیابان آزادی، پلاک ۱' },
    idempotencyKey: 'rep-a',
  });
  await orders.confirmPayment(a.orderId, { amountRial: BigInt(a.totals.totalRial) });
  caseOrderId = a.orderId;

  const b = await orders.createOrder({
    items: [{ variantId: cableVariantId, quantity: 3 }],
    channel: 'pos',
    customerName: 'رضا کریمی',
    customerMobile: '09120000002',
    idempotencyKey: 'rep-b',
  });
  await orders.confirmPayment(b.orderId, { amountRial: BigInt(b.totals.totalRial), method: 'cash' });
  cableOrderId = b.orderId;
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('ثبتِ بهایِ تمام‌شده در لحظه‌یِ فروش', () => {
  it('بهایِ هر واحد روی ردیفِ سفارش و روی حرکتِ انبار می‌نشیند', async () => {
    const { rows: items } = await db.query<{ unit_cost_rial: string }>(
      `SELECT unit_cost_rial::text FROM order_items WHERE order_id = $1 AND variant_id = $2`,
      [caseOrderId, caseVariantId],
    );
    const { rows: moves } = await db.query<{ unit_cost_rial: string; quantity: number }>(
      `SELECT unit_cost_rial::text, quantity FROM stock_movements
        WHERE reason = 'sale' AND reference_id = $1 AND variant_id = $2`,
      [caseOrderId, caseVariantId],
    );

    // پیش از مهاجرتِ ۰۲۰، هر دو صفر بودند و سودِ ناخالصِ هر کالا ناممکن بود
    expect(BigInt(items[0]!.unit_cost_rial)).toBeGreaterThan(0n);
    expect(BigInt(moves[0]!.unit_cost_rial)).toBeGreaterThan(0n);
    // ردیف و حرکت باید یک بها را بگویند: هر دو از یک خواندن در یک تراکنش آمده‌اند
    expect(items[0]!.unit_cost_rial).toBe(moves[0]!.unit_cost_rial);
  });

  it('بهایِ ثبت‌شده همان بهایِ میانگینِ موزونِ انبار در لحظه‌یِ فروش است', async () => {
    const { rows } = await db.query<{ unit_cost_rial: string }>(
      `SELECT unit_cost_rial::text FROM order_items WHERE order_id = $1`,
      [caseOrderId],
    );
    expect(BigInt(rows[0]!.unit_cost_rial)).toBe(caseUnitCost);
  });
});

describe('گزارشِ سودِ ناخالص', () => {
  it('سود = فروشِ خالص − بهایِ کالا، بی‌ارزش افزوده', async () => {
    const report = await grossProfit(db, {
      from: new Date(Date.now() - 2 * 24 * 3600_000),
      to: new Date(Date.now() + 3600_000),
      groupBy: 'variant',
    });

    const row = report.rows.find((r) => r.key === caseVariantId);
    expect(row).toBeTruthy();

    // فروشِ خالص: ۲ عدد × قیمت، بی‌تخفیف (در این آزمون تخفیفی نداریم)
    expect(BigInt(row!.revenueRial)).toBe(caseUnitPrice * 2n);
    // بهایِ کالا: ۲ × بهایِ میانگینِ موزونِ لحظه‌یِ فروش
    expect(BigInt(row!.cogsRial)).toBe(caseUnitCost * 2n);
    expect(BigInt(row!.grossProfitRial)).toBe((caseUnitPrice - caseUnitCost) * 2n);
    // حاشیه‌یِ سود: (فروش − بها) / فروش
    const expected = Number((((caseUnitPrice - caseUnitCost) * 10_000n) / caseUnitPrice)) / 100;
    expect(row!.marginPercent).toBeCloseTo(expected, 1);
  });

  it('دفترکل با جمعِ ردیف‌هایِ فروش هم‌خوان است (سندی جا نمانده)', async () => {
    const report = await grossProfit(db, {
      from: new Date(Date.now() - 2 * 24 * 3600_000),
      to: new Date(Date.now() + 3600_000),
    });
    // انبار و دفترکل در یک تراکنش ثبت می‌شوند؛ اگر این دو یکی نباشند،
    // یعنی فروشی بی‌سند یا سندی دستی در دوره هست و باید هشدار بدهیم.
    expect(report.ledger.matches).toBe(true);
    expect(BigInt(report.ledger.differenceRial)).toBe(0n);
    expect(report.warnings.some((w) => w.includes('دفترکل'))).toBe(false);
  });

  it('مرجوعی هم از درآمد کم می‌شود و هم از بهایِ کالا', async () => {
    const before = await grossProfit(db, {
      from: new Date(Date.now() - 2 * 24 * 3600_000),
      to: new Date(Date.now() + 3600_000),
      groupBy: 'variant',
    });
    const beforeRow = before.rows.find((r) => r.key === caseVariantId)!;

    // مرجوعیِ یک واحد + سندِ برگشت از فروشِ متناظر (تا ترازِ دفترکل به هم نخورد)
    const { rows: ret } = await db.query<{ id: string }>(
      `INSERT INTO returns (return_no, source_type, source_id, status, reason, total_rial, decided_at)
       VALUES ('MR-TEST-1', 'FS', $1, 'approved', 'پشیمانی', $2, now())
       RETURNING id`,
      [caseOrderId, caseUnitPrice.toString()],
    );
    await db.query(
      `INSERT INTO return_items (return_id, variant_id, quantity, unit_price_rial, condition, fate)
       VALUES ($1, $2, 1, $3, 'ok', 'to_stock')`,
      [ret[0]!.id, caseVariantId, caseUnitPrice.toString()],
    );
    await accounting.postJournal({
      description: 'برگشت از فروش (آزمون)',
      lines: [
        { accountCode: '4000', debitRial: caseUnitPrice },
        { accountCode: '1000', debitRial: caseUnitCost },
        { accountCode: '1100', creditRial: caseUnitPrice },
        { accountCode: '5000', creditRial: caseUnitCost },
      ],
    });

    const after = await grossProfit(db, {
      from: new Date(Date.now() - 2 * 24 * 3600_000),
      to: new Date(Date.now() + 3600_000),
      groupBy: 'variant',
    });
    const afterRow = after.rows.find((r) => r.key === caseVariantId)!;

    expect(BigInt(beforeRow.revenueRial) - BigInt(afterRow.revenueRial)).toBe(caseUnitPrice);
    expect(BigInt(beforeRow.cogsRial) - BigInt(afterRow.cogsRial)).toBe(caseUnitCost);
    // با مرجوعی، سندِ برگشت هم ثبت شده؛ پس دفترکل همچنان هم‌خوان است
    expect(after.ledger.matches).toBe(true);
  });

  it('گروه‌بندیِ برند: جمعِ ردیف‌ها برابرِ کلِ دوره است', async () => {
    const byBrand = await grossProfit(db, {
      from: new Date(Date.now() - 2 * 24 * 3600_000),
      to: new Date(Date.now() + 3600_000),
      groupBy: 'brand',
    });
    const byVariant = await grossProfit(db, {
      from: new Date(Date.now() - 2 * 24 * 3600_000),
      to: new Date(Date.now() + 3600_000),
      groupBy: 'variant',
    });

    const brandSum = byBrand.rows.reduce((sum, r) => sum + BigInt(r.revenueRial), 0n);
    expect(brandSum).toBe(BigInt(byVariant.totals.revenueRial));
    expect(byBrand.rows.length).toBeGreaterThan(0);
    expect(byBrand.rows.every((r) => r.label.length > 0)).toBe(true);
  });

  it('گروه‌بندیِ روز: ردیف‌ها به ترتیبِ زمان‌اند', async () => {
    const byDay = await grossProfit(db, {
      from: new Date(Date.now() - 2 * 24 * 3600_000),
      to: new Date(Date.now() + 3600_000),
      groupBy: 'day',
    });
    expect(byDay.rows.length).toBeGreaterThan(0);
    const keys = byDay.rows.map((r) => r.key);
    expect([...keys].sort()).toEqual(keys);
    // برچسبِ هر ردیف تاریخِ جلالی است، نه میلادی
    expect(byDay.rows[0]!.label).toMatch(/^۱۴[۰-۹]{2}\/[۰-۹]{2}\/[۰-۹]{2}$/);
  });

  it('وقتی بهایِ یک ردیف ثبت نشده، گزارش هشدار می‌دهد (پنهان نمی‌کند)', async () => {
    const { rows: original } = await db.query<{ id: string; unit_cost_rial: string }>(
      `SELECT id, unit_cost_rial::text FROM order_items WHERE order_id = $1`,
      [caseOrderId],
    );
    const saved = original[0]!.unit_cost_rial;
    await db.query(`UPDATE order_items SET unit_cost_rial = 0 WHERE id = $1`, [original[0]!.id]);
    try {
      const report = await grossProfit(db, {
        from: new Date(Date.now() - 2 * 24 * 3600_000),
        to: new Date(Date.now() + 3600_000),
      });
      expect(report.totals.uncostedQuantity).toBe(2);
      expect(report.warnings.some((w) => w.includes('بهایِ تمام‌شده برای'))).toBe(true);
    } finally {
      // داده را برمی‌گردانیم تا آزمون‌هایِ دیگر بی‌اثر بمانند
      await db.query(`UPDATE order_items SET unit_cost_rial = $2 WHERE id = $1`, [
        original[0]!.id,
        saved,
      ]);
    }
  });
});

describe('گزارشِ گردشِ موجودی', () => {
  it('کالایِ فروخته‌شده گردش دارد و کالایِ نفروخته راکد است', async () => {
    const report = await stockTurnover(db, { windowDays: 90 });

    const sold = report.rows.find((r) => r.variantId === caseVariantId)!;
    expect(sold.soldQuantity).toBeGreaterThan(0);
    expect(sold.daysOfInventory).not.toBeNull();
    expect(sold.turnoverPerYear).not.toBeNull();
    expect(['fast', 'normal', 'slow']).toContain(sold.status);

    const unsold = report.rows.find((r) => r.soldQuantity === 0 && Number(r.closingValueRial) > 0);
    expect(unsold?.status).toBe('dead');
    expect(unsold!.daysOfInventory).toBeNull();
  });

  it('سرمایه‌یِ خوابیده در کالایِ راکد جدا نشان داده می‌شود', async () => {
    const report = await stockTurnover(db, { windowDays: 90 });
    const deadValue = report.rows
      .filter((r) => r.status === 'dead')
      .reduce((sum, r) => sum + BigInt(r.closingValueRial), 0n);

    expect(BigInt(report.totals.deadStockValueRial)).toBe(deadValue);
    expect(report.totals.deadStockCount).toBe(report.rows.filter((r) => r.status === 'dead').length);
    // ارزشِ کلِ موجودی برابر است با جمعِ ارزشِ ردیف‌ها
    const sum = report.rows.reduce((acc, r) => acc + BigInt(r.closingValueRial), 0n);
    expect(BigInt(report.totals.inventoryValueRial)).toBe(sum);
  });
});

describe('گزارشِ سنِ بدهی', () => {
  beforeAll(async () => {
    // چک باید صادرکننده داشته باشد (ستون به جدولِ مشتریان اشاره می‌کند)
    const { rows: cust } = await db.query<{ id: string; phone: string }>(
      `INSERT INTO customers (phone, full_name, kind) VALUES ($1,$2,'online'), ($3,$4,'in_person')
       RETURNING id, phone`,
      ['09120000001', 'سارا احمدی', '09120000002', 'رضا کریمی'],
    );
    const drawerId = cust.find((c) => c.phone === '09120000001')!.id;

    // یک چکِ سررسید‌گذشته برایِ مشتریِ سارا (روی همان سفارش)
    const { rows: chk } = await db.query<{ id: string }>(
      `INSERT INTO checks (check_no, sayad_no, bank, amount_rial, due_date, drawer_id, status, document_type, document_id)
       VALUES ('۱۲۳۴۵۶', '۱۲۳۴۵۶۷۸۹۰۱۲۳۴', 'ملی', $1, (now() - interval '10 days')::date, $2, 'in_circulation', 'FS', $3)
       RETURNING id`,
      [(caseUnitPrice * 2n).toString(), drawerId, caseOrderId],
    );
    await db.query(
      `INSERT INTO order_payment_lines (order_id, method, amount_rial, check_id)
       VALUES ($1, 'check', $2, $3)`,
      [caseOrderId, (caseUnitPrice * 2n).toString(), chk[0]!.id],
    );

    // یک فروشِ نسیه برایِ مشتریِ دوم (۵ روز پیش؛ تا سنِ بدهی معنا پیدا کند)
    await db.query(
      `INSERT INTO order_payment_lines (order_id, method, amount_rial)
       VALUES ($1, 'credit', $2)`,
      [cableOrderId, (cableUnitPrice * 3n).toString()],
    );
    await db.query(`UPDATE orders SET paid_at = now() - interval '5 days' WHERE id = $1`, [
      cableOrderId,
    ]);
  });

  it('چکِ سررسید‌گذشته در سطلِ ۱ تا ۳۰ روز می‌افتد', async () => {
    const report = await debtors(db, { creditTermDays: 30 });
    const sara = report.rows.find((r) => r.mobile === '09120000001');
    expect(sara).toBeTruthy();
    expect(BigInt(sara!.bucket1Rial)).toBe(caseUnitPrice * 2n);
    expect(BigInt(sara!.totalRial)).toBe(caseUnitPrice * 2n);
    expect(BigInt(report.totals.bucket1Rial)).toBe(caseUnitPrice * 2n);
  });

  it('نسیه با مهلتِ فرضی پیر می‌شود و در سطلِ درست می‌افتد', async () => {
    // سفارشِ همین امروز است؛ با مهلتِ ۳۰ روز هنوز سررسید نرسیده
    const fresh = await debtors(db, { creditTermDays: 30 });
    const reza = fresh.rows.find((r) => r.mobile === '09120000002');
    expect(BigInt(reza!.notDueRial)).toBe(cableUnitPrice * 3n);

    // با مهلتِ صفر‌روزه، همان مبلغ از دیروز سررسید گذشته است
    const strict = await debtors(db, { creditTermDays: 0 });
    const rezaStrict = strict.rows.find((r) => r.mobile === '09120000002');
    expect(BigInt(rezaStrict!.bucket1Rial)).toBe(cableUnitPrice * 3n);
  });

  it('چکِ برگشتی پرخطر نشان داده می‌شود', async () => {
    await db.query(
      `UPDATE checks SET status = 'bounced' WHERE document_id = $1`,
      [caseOrderId],
    );
    const report = await debtors(db, { creditTermDays: 30 });
    const sara = report.rows.find((r) => r.mobile === '09120000001')!;
    expect(sara.bouncedChecks).toBe(1);
    expect(sara.risk).toBe('high');
    expect(report.totals.highRiskCount).toBeGreaterThanOrEqual(1);
    expect(BigInt(report.totals.bouncedRial)).toBe(caseUnitPrice * 2n);

    await db.query(`UPDATE checks SET status = 'in_circulation' WHERE document_id = $1`, [
      caseOrderId,
    ]);
  });

  it('بدهی به تأمین‌کننده: از سررسید گذشته جدا می‌شود', async () => {
    const report = await debtors(db, { creditTermDays: 30 });
    expect(report.payables.rows.length).toBeGreaterThan(0);

    const { rows: overdue } = await db.query<{ count: string }>(
      `SELECT count(*)::text FROM purchase_invoices
        WHERE payable_rial > 0 AND COALESCE(due_at, issued_at, created_at::date) < CURRENT_DATE`,
    );
    const expectedOverdue = Number(overdue[0]!.count);
    expect(report.payables.rows.filter((r) => r.daysPastDue > 0).length).toBe(expectedOverdue);
    expect(BigInt(report.payables.totalPayableRial)).toBeGreaterThan(0n);
  });
});

describe('میانگیرِ گزارش‌ها', () => {
  it('بارِ دوم از میانگیر می‌آید و «بازسازی» آن را دور می‌اندازد', async () => {
    const build = async () => ({
      payload: { total: (await grossProfit(db, {
        from: new Date(Date.now() - 2 * 24 * 3600_000),
        to: new Date(Date.now() + 3600_000),
      })).totals.revenueRial },
      rowCount: 1,
    });

    const first = await cachedReport(db, {
      reportKey: 'gross_profit',
      periodKey: 'test-a',
      build,
    });
    expect(first.cached).toBe(false);

    const second = await cachedReport(db, {
      reportKey: 'gross_profit',
      periodKey: 'test-a',
      build,
    });
    expect(second.cached).toBe(true);
    expect(second.payload).toEqual(first.payload);

    const rebuilt = await cachedReport(db, {
      reportKey: 'gross_profit',
      periodKey: 'test-a',
      rebuild: true,
      build,
    });
    expect(rebuilt.cached).toBe(false);

    // کلیدِ تازه (دوره‌یِ دیگر) نباید نتیجه‌یِ کهنه را بدهد
    const other = await cachedReport(db, {
      reportKey: 'gross_profit',
      periodKey: 'test-b',
      build,
    });
    expect(other.cached).toBe(false);
  });
});
