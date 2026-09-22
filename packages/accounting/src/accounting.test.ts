import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, applyMigrations, seedCatalog, type Database } from '@set/db';
import { AccountingService } from './index.js';
import { jalaliParts, jalaliMonth } from '@set/shared-kernel';

let db: Database;
let accounting: AccountingService;
let warehouseId: string;
let caseVariantId: string;

beforeEach(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  await seedCatalog(db, { openingInventory: false });
  accounting = new AccountingService(db);
  const { rows: w } = await db.query<{ id: string }>(`SELECT id FROM warehouses LIMIT 1`);
  warehouseId = w[0]!.id;
  const { rows: v } = await db.query<{ id: string }>(`SELECT id FROM product_variants WHERE sku = 'CS-13P-BLK'`);
  caseVariantId = v[0]!.id;
  await db.query(`UPDATE stock_items SET on_hand = 0, reserved = 0 WHERE variant_id = $1`, [caseVariantId]);
});

afterEach(async () => db.close());

describe('دفترکل', () => {
  it('سندِ تراز ثبت می‌شود و شماره می‌گیرد', async () => {
    const entry = await accounting.postJournal({
      description: 'سرمایه‌گذاری اولیه',
      lines: [
        { accountCode: '1100', debitRial: 100_000_000n },
        { accountCode: '4000', creditRial: 100_000_000n },
      ],
    });
    expect(entry.entryNo).toMatch(/^JV-\d{4}-\d{6}$/);
    const tb = await accounting.trialBalance();
    expect(tb.balanced).toBe(true);
  });

  it('سندِ غیرتراز هرگز ثبت نمی‌شود', async () => {
    await expect(
      accounting.postJournal({
        description: 'اشتباه',
        lines: [
          { accountCode: '1100', debitRial: 100n },
          { accountCode: '4000', creditRial: 90n },
        ],
      }),
    ).rejects.toMatchObject({ code: 'ERR-012' });
  });

  it('یک ردیف نمی‌تواند هم‌زمان بدهکار و بستانکار باشد', async () => {
    await expect(
      accounting.postJournal({
        description: 'اشتباه',
        lines: [
          { accountCode: '1100', debitRial: 100n, creditRial: 100n },
          { accountCode: '4000', creditRial: 100n },
        ],
      }),
    ).rejects.toMatchObject({ code: 'ERR-001' });
  });

  it('حسابِ تعریف‌نشده رد می‌شود', async () => {
    await expect(
      accounting.postJournal({
        description: 'حساب غلط',
        lines: [
          { accountCode: '9999', debitRial: 10n },
          { accountCode: '4000', creditRial: 10n },
        ],
      }),
    ).rejects.toMatchObject({ code: 'ERR-001' });
  });

  it('برگشتِ سند، حذف نمی‌کند بلکه معکوس ثبت می‌کند', async () => {
    const entry = await accounting.postJournal({
      description: 'فروش نقد',
      lines: [
        { accountCode: '1100', debitRial: 500_000n },
        { accountCode: '4000', creditRial: 500_000n },
      ],
    });
    const reversal = await accounting.reverseEntry(entry.entryId, 'اشتباه در مبلغ');

    const { rows } = await db.query<{ status: string; reversed_by: string | null }>(
      `SELECT status, reversed_by FROM journal_entries WHERE id = $1`, [entry.entryId],
    );
    expect(rows[0]!.status).toBe('reversed');
    expect(rows[0]!.reversed_by).toBe(reversal.entryId);

    const tb = await accounting.trialBalance();
    expect(tb.balanced).toBe(true);
    // اثرِ خالص صفر است
    const cash = tb.accounts.find((a) => a.code === '1100');
    expect(cash!.debit).toBe('500000');
    expect(cash!.credit).toBe('500000');
  });
});

describe('فاکتورِ خرید و بهای تمام‌شده', () => {
  it('ورودِ کالا، موجودی و بدهیِ تأمین‌کننده را ثبت می‌کند', async () => {
    const invoice = await accounting.postPurchaseInvoice({
      supplierName: 'تأمین‌کننده‌ی نمونه',
      warehouseId,
      items: [{ variantId: caseVariantId, quantity: 10, unitCostRial: 1_000_000n }],
    });

    expect(invoice.invoiceNo).toMatch(/^PINV-\d{4}-\d{6}$/);
    expect(invoice.totalCostRial).toBe('10000000');

    const { rows } = await db.query<{ on_hand: number }>(
      `SELECT on_hand FROM stock_items WHERE variant_id = $1`, [caseVariantId],
    );
    expect(rows[0]!.on_hand).toBe(10);

    const tb = await accounting.trialBalance();
    expect(tb.balanced).toBe(true);
    const inventory = tb.accounts.find((a) => a.code === '1000');
    const payable = tb.accounts.find((a) => a.code === '2000');
    expect(inventory!.debit).toBe('10000000');
    expect(payable!.credit).toBe('10000000');
  });

  it('هزینه‌های جانبی بین ردیف‌ها توزیع می‌شود و هیچ ریالی باقی نمی‌ماند', async () => {
    const invoice = await accounting.postPurchaseInvoice({
      supplierName: 'تأمین‌کننده',
      warehouseId,
      items: [{ variantId: caseVariantId, quantity: 3, unitCostRial: 1_000_000n }],
      extraCostRial: 1_000_000n,
    });

    expect(invoice.subtotalRial).toBe('3000000');
    expect(invoice.extraCostRial).toBe('1000000');
    expect(invoice.totalCostRial).toBe('4000000'); // ۳ میلیون کالا + ۱ میلیون حمل

    const { rows } = await db.query<{ total_cost_rial: string }>(
      `SELECT total_cost_rial FROM purchase_invoice_items WHERE invoice_id = $1`, [invoice.invoiceId],
    );
    // توجه: بسته به درایور، ستون‌های BIGINT ممکن است عدد یا رشته برگردند؛
    // مقایسه همیشه روی رشته انجام می‌شود تا وابسته به درایور نباشد.
    expect(String(rows[0]!.total_cost_rial)).toBe('4000000');
  });

  it('بهای میانگینِ موزون پس از خریدِ دوم به‌روز می‌شود', async () => {
    await accounting.postPurchaseInvoice({
      supplierName: 'تأمین‌کننده',
      warehouseId,
      items: [{ variantId: caseVariantId, quantity: 10, unitCostRial: 1_000_000n }],
    });
    const { rows: first } = await db.query<{ avg_cost_rial: string; quantity: number }>(
      `SELECT avg_cost_rial, quantity FROM inventory_valuation WHERE variant_id = $1`, [caseVariantId],
    );
    expect(first[0]!.quantity).toBe(10);
    expect(String(first[0]!.avg_cost_rial)).toBe('1000000');

    await accounting.postPurchaseInvoice({
      supplierName: 'تأمین‌کننده',
      warehouseId,
      items: [{ variantId: caseVariantId, quantity: 10, unitCostRial: 1_500_000n }],
    });
    const { rows: second } = await db.query<{ avg_cost_rial: string; quantity: number }>(
      `SELECT avg_cost_rial, quantity FROM inventory_valuation WHERE variant_id = $1`, [caseVariantId],
    );
    expect(second[0]!.quantity).toBe(20);
    expect(String(second[0]!.avg_cost_rial)).toBe('1250000'); // میانگینِ ۱ و ۱٫۵ میلیون
  });

  it('فاکتورِ خرید، حرکتِ انبار از نوع purchase ثبت می‌کند', async () => {
    const invoice = await accounting.postPurchaseInvoice({
      supplierName: 'تأمین‌کننده',
      warehouseId,
      items: [{ variantId: caseVariantId, quantity: 4, unitCostRial: 2_000_000n }],
    });
    const { rows } = await db.query<{ reason: string; quantity: number }>(
      `SELECT reason, quantity FROM stock_movements WHERE reference_id = $1`, [invoice.invoiceId],
    );
    expect(rows).toEqual([{ reason: 'purchase', quantity: 4 }]);
  });
});

describe('ارزش افزوده (ایران)', () => {
  it('ارزش افزوده به بهای کالا اضافه نمی‌شود، فقط به بدهی', async () => {
    const invoice = await accounting.postPurchaseInvoice({
      supplierName: 'تأمین‌کننده',
      warehouseId,
      items: [{ variantId: caseVariantId, quantity: 10, unitCostRial: 1_000_000n }],
      vatRial: 900_000n,
    });

    // بهای کالا همان ۱۰ میلیون است؛ قابلِ پرداخت ۱۰٫۹ میلیون
    expect(invoice.totalCostRial).toBe('10000000');
    expect(invoice.vatRial).toBe('900000');
    expect(invoice.payableRial).toBe('10900000');

    const tb = await accounting.trialBalance();
    expect(tb.balanced).toBe(true);
    const inventory = tb.accounts.find((a) => a.code === '1000');
    const payable = tb.accounts.find((a) => a.code === '2000');
    expect(inventory!.debit).toBe('10000000');
    expect(payable!.credit).toBe('10900000');
  });

  it('ارزش افزوده در حسابِ «اعتبارِ مالیاتی» (۱۳۰۰) بدهکار می‌شود', async () => {
    await accounting.postPurchaseInvoice({
      supplierName: 'تأمین‌کننده',
      warehouseId,
      items: [{ variantId: caseVariantId, quantity: 5, unitCostRial: 2_000_000n }],
      vatRial: 1_000_000n,
    });

    const tb = await accounting.trialBalance();
    const vatCredit = tb.accounts.find((a) => a.code === '1300');
    expect(vatCredit!.debit).toBe('1000000');
    expect(vatCredit!.credit).toBe('0');
  });

  it('ارزش افزوده، بهای میانگینِ موزون را تغییر نمی‌دهد', async () => {
    await accounting.postPurchaseInvoice({
      supplierName: 'تأمین‌کننده',
      warehouseId,
      items: [{ variantId: caseVariantId, quantity: 10, unitCostRial: 1_000_000n }],
      vatRial: 900_000n,
    });

    const { rows } = await db.query<{ avg_cost_rial: string }>(
      `SELECT avg_cost_rial FROM inventory_valuation WHERE variant_id = $1`, [caseVariantId],
    );
    // اگر ارزش افزوده در بها می‌نشست، میانگین ۱٬۰۹۰٬۰۰۰ می‌شد
    expect(String(rows[0]!.avg_cost_rial)).toBe('1000000');
  });

  it('ارزش افزوده بین ردیف‌ها توزیع می‌شود و هیچ ریالی از بین نمی‌رود', async () => {
    const other = (await db.query<{ id: string }>(
      `SELECT id FROM product_variants WHERE sku <> 'CS-13P-BLK' LIMIT 1`,
    )).rows[0]!.id;

    const invoice = await accounting.postPurchaseInvoice({
      supplierName: 'تأمین‌کننده',
      warehouseId,
      items: [
        { variantId: caseVariantId, quantity: 1, unitCostRial: 1_000_000n },
        { variantId: other, quantity: 2, unitCostRial: 1_000_000n },
      ],
      vatRial: 300_001n,
    });

    const sum = invoice.lines.reduce((a, l) => a + BigInt(l.vatRial), 0n);
    expect(sum).toBe(300_001n);
  });
});

describe('هویتِ ایرانیِ تأمین‌کننده و جلوگیری از ثبتِ تکراری', () => {
  const base = {
    warehouseId: '' as string,
    items: [] as Array<{ variantId: string; quantity: number; unitCostRial: bigint }>,
  };

  beforeEach(() => {
    base.warehouseId = warehouseId;
    base.items = [{ variantId: caseVariantId, quantity: 2, unitCostRial: 500_000n }];
  });

  it('شناسه‌ی ملیِ نامعتبر رد می‌شود', async () => {
    await expect(
      accounting.postPurchaseInvoice({
        ...base,
        supplierName: 'تأمین‌کننده',
        supplierNationalId: '12345678901', // رقمِ کنترل غلط
      }),
    ).rejects.toMatchObject({ code: 'ERR-001' });
  });

  it('شناسه‌ی ملیِ معتبر با ارقامِ فارسی هم پذیرفته می‌شود', async () => {
    const invoice = await accounting.postPurchaseInvoice({
      ...base,
      supplierName: 'تأمین‌کننده',
      supplierNationalId: '۰۰۱۳۵۴۲۴۱۹',
    });
    expect(invoice.invoiceNo).toMatch(/^PINV-\d{4}-\d{6}$/);
  });

  it('ثبتِ دوباره‌ی همان فاکتورِ تأمین‌کننده با ۴۰۹ رد می‌شود', async () => {
    const payload = {
      ...base,
      supplierName: 'تأمین‌کننده',
      supplierNationalId: '0013542419',
      supplierInvoiceNo: 'INV-7781',
    };
    await accounting.postPurchaseInvoice(payload);

    await expect(accounting.postPurchaseInvoice(payload)).rejects.toMatchObject({
      code: 'ERR-005',
    });
  });

  it('بدونِ شناسه‌ی ملی، ثبتِ تکراری محدود نمی‌شود اما فاکتور ثبت می‌گردد', async () => {
    const payload = { ...base, supplierName: 'تأمین‌کننده' };
    const first = await accounting.postPurchaseInvoice(payload);
    const second = await accounting.postPurchaseInvoice(payload);
    expect(first.invoiceNo).not.toBe(second.invoiceNo);
  });

  it('شماره‌ی فاکتور بدونِ شناسه‌ی ملی پذیرفته نیست', async () => {
    await expect(
      accounting.postPurchaseInvoice({
        ...base,
        supplierName: 'تأمین‌کننده',
        supplierInvoiceNo: 'INV-7781',
      }),
    ).rejects.toMatchObject({ code: 'ERR-001' });
  });
});

describe('سندِ فروش (پیوندِ انبار و دفترکل)', () => {
  it('فروش، درآمد + ارزش افزوده + بهای کالای فروخته‌شده ثبت می‌کند', async () => {
    // خریدِ ۱۰ عدد، هر کدام ۱ میلیون ریال → بهای میانگین ۱٬۰۰۰٬۰۰۰
    await accounting.postPurchaseInvoice({
      supplierName: 'تأمین‌کننده',
      warehouseId,
      items: [{ variantId: caseVariantId, quantity: 10, unitCostRial: 1_000_000n }],
    });

    const sale = await db.transaction(async (tx) =>
      accounting.postSaleOn(tx, {
        warehouseId,
        items: [{ variantId: caseVariantId, quantity: 3 }],
        subtotalRial: 5_000_000n,
        taxRial: 450_000n,
        shippingRial: 0n,
        totalRial: 5_450_000n,
        referenceType: 'order',
        referenceId: '00000000-0000-4000-8000-000000000001',
        description: 'فروشِ آزمایشی',
      }),
    );

    // بهای کالای فروخته‌شده: ۳ × ۱٬۰۰۰٬۰۰۰
    expect(sale.cogsRial).toBe('3000000');

    const tb = await accounting.trialBalance();
    expect(tb.balanced).toBe(true);
    const acc = (code: string) => tb.accounts.find((a) => a.code === code)!;

    // درآمد فقط خالصِ فروش است، نه مبلغِ دریافتی
    expect(acc('4000').credit).toBe('5000000');
    // ارزش افزوده‌ی فروش، بدهیِ مالیاتی است
    expect(acc('2100').credit).toBe('450000');
    // بهای کالای فروخته‌شده هزینه می‌شود و از موجودی خارج می‌گردد
    expect(acc('5000').debit).toBe('3000000');
    expect(acc('1000').credit).toBe('3000000');
    // نقد/بانک به مبلغِ دریافتی بدهکار می‌شود
    expect(acc('1100').debit).toBe('5450000');
  });

  it('ارزشِ موجودیِ حسابداری به اندازه‌ی فروش کم می‌شود', async () => {
    await accounting.postPurchaseInvoice({
      supplierName: 'تأمین‌کننده',
      warehouseId,
      items: [{ variantId: caseVariantId, quantity: 10, unitCostRial: 1_000_000n }],
    });

    await db.transaction(async (tx) =>
      accounting.postSaleOn(tx, {
        warehouseId,
        items: [{ variantId: caseVariantId, quantity: 4 }],
        subtotalRial: 6_000_000n,
        taxRial: 540_000n,
        totalRial: 6_540_000n,
        referenceType: 'order',
        referenceId: '00000000-0000-4000-8000-000000000002',
        description: 'فروشِ آزمایشی',
      }),
    );

    const { rows } = await db.query<{ quantity: number }>(
      `SELECT quantity FROM inventory_valuation WHERE variant_id = $1`, [caseVariantId],
    );
    expect(rows[0]!.quantity).toBe(6);
  });

  it('فروش، بهای میانگین را تغییر نمی‌دهد (فروش قیمتی ندارد)', async () => {
    await accounting.postPurchaseInvoice({
      supplierName: 'تأمین‌کننده',
      warehouseId,
      items: [{ variantId: caseVariantId, quantity: 10, unitCostRial: 1_200_000n }],
    });
    await db.transaction(async (tx) =>
      accounting.postSaleOn(tx, {
        warehouseId,
        items: [{ variantId: caseVariantId, quantity: 5 }],
        subtotalRial: 9_000_000n,
        taxRial: 810_000n,
        totalRial: 9_810_000n,
        referenceType: 'order',
        referenceId: '00000000-0000-4000-8000-000000000003',
        description: 'فروشِ آزمایشی',
      }),
    );

    const { rows } = await db.query<{ avg_cost_rial: string }>(
      `SELECT avg_cost_rial FROM inventory_valuation WHERE variant_id = $1`, [caseVariantId],
    );
    expect(String(rows[0]!.avg_cost_rial)).toBe('1200000');
  });
});

describe('سود و زیان', () => {
  it('بهای کالای فروخته‌شده فقط یک‌بار از درآمد کسر می‌شود', async () => {
    // خرید: ۱۰ عدد × ۱٬۰۰۰٬۰۰۰ ریال
    await accounting.postPurchaseInvoice({
      supplierName: 'تأمین‌کننده',
      warehouseId,
      items: [{ variantId: caseVariantId, quantity: 10, unitCostRial: 1_000_000n }],
    });
    // فروش: ۳ عدد × ۲٬۰۰۰٬۰۰۰ = ۶٬۰۰۰٬۰۰۰ (بهای کالا: ۳٬۰۰۰٬۰۰۰)
    await db.transaction(async (tx) =>
      accounting.postSaleOn(tx, {
        warehouseId,
        items: [{ variantId: caseVariantId, quantity: 3 }],
        subtotalRial: 6_000_000n,
        taxRial: 540_000n,
        totalRial: 6_540_000n,
        referenceType: 'order',
        referenceId: '00000000-0000-4000-8000-000000000010',
        description: 'فروشِ آزمایشی',
      }),
    );

    const pl = await accounting.profitLoss();
    expect(pl.revenue.rial).toBe('6000000');
    expect(pl.cogs.rial).toBe('3000000');
    expect(pl.grossProfit.rial).toBe('3000000');
    // هیچ هزینه‌ی عملیاتی نداریم → سودِ خالص همان سودِ ناخالص است،
    // نه «ناخالص منهایِ بهای کالا» (که منفیِ غلط می‌ساخت)
    expect(pl.expenses.rial).toBe('0');
    expect(pl.netProfit.rial).toBe('3000000');
  });

  it('هزینه‌ی عملیاتی از سودِ ناخالص کم می‌شود', async () => {
    await accounting.postJournal({
      description: 'اجاره‌ی فروشگاه',
      lines: [
        { accountCode: '5100', debitRial: 2_000_000n },
        { accountCode: '1100', creditRial: 2_000_000n },
      ],
    });
    const pl = await accounting.profitLoss();
    expect(pl.expenses.rial).toBe('2000000');
    expect(pl.netProfit.rial).toBe('-2000000');
  });

  it('گزارشِ دوره فقط اسنادِ همان دوره را می‌بیند', async () => {
    const old = new Date('2020-01-01T00:00:00Z');
    const oldPeriod = `${jalaliParts(old).year}${String(jalaliMonth(old)).padStart(2, '0')}`;
    await accounting.postJournal({
      description: 'درآمدِ دوره‌ی دیگر',
      postedAt: old,
      lines: [
        { accountCode: '1100', debitRial: 500_000n },
        { accountCode: '4000', creditRial: 500_000n },
      ],
    });
    const all = await accounting.profitLoss();
    expect(all.revenue.rial).toBe('500000');
    const thatPeriod = await accounting.profitLoss(oldPeriod);
    expect(thatPeriod.revenue.rial).toBe('500000');
    const now = await accounting.profitLoss(`${jalaliParts(new Date()).year}${String(jalaliMonth(new Date())).padStart(2, '0')}`);
    expect(now.revenue.rial).toBe('0');
  });
});
