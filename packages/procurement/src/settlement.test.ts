import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabase, applyMigrations, seedCatalog, type Database } from '@set/db';
import { AccountingService } from '@set/accounting';
import { paySupplierInvoice, clearSupplierCheck, listInvoicePayments } from './settlement.js';

/**
 * آزمون‌هایِ تسویه‌یِ فاکتورِ خرید.
 *
 * همان قاعده‌یِ همیشگی: یک پایگاه برایِ همه (ساختِ هر نمونه صدها مگابایت
 * حافظه می‌گیرد) و هر آزمون فقط می‌خواند یا داده‌یِ تازه‌ای می‌سازد که به
 * آزمون‌هایِ دیگر آسیب نمی‌زند.
 *
 * چرا این آزمون‌ها مهم‌اند؟ چون در تسویه، اشتباهِ محاسباتی یعنی «به تأمین‌کننده
 * کمتر یا بیشتر پرداخت کردن» و اشتباهِ حسابداری یعنی «ترازِ بدهیِ غلط در
 * پایانِ ماه». هر دو از آن خطاهایی‌اند که تا ماه‌ها کسی نمی‌بیند.
 */

let db: Database;
let accounting: AccountingService;
let warehouseId: string;
let variantId: string;

/** یک فاکتورِ خریدِ باز می‌سازد و شناسه‌اش را برمی‌گرداند */
async function openInvoice(quantity: number, unitCost: bigint, extra: bigint = 0n) {
  const invoice = await accounting.postPurchaseInvoice({
    supplierName: 'تأمین‌کننده‌ی نمونه',
    warehouseId,
    items: [{ variantId, quantity, unitCostRial: unitCost }],
    extraCostRial: extra,
  });
  const { rows } = await db.query<{ payable_rial: string }>(
    `SELECT payable_rial::text FROM purchase_invoices WHERE id = $1`,
    [invoice.invoiceId],
  );
  return { id: invoice.invoiceId, no: invoice.invoiceNo, payable: BigInt(rows[0]!.payable_rial) };
}

/** مشتری و چکی می‌سازد که بشود با آن پرداخت کرد */
async function registerCheck(amountRial: bigint, dueInDays: number): Promise<string> {
  const { rows: cust } = await db.query<{ id: string }>(
    `INSERT INTO customers (phone, full_name, kind) VALUES ($1, $2, 'online')
     ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`,
    ['09120000099', 'شرکتِ نمونه'],
  );
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO checks (check_no, sayad_no, bank, amount_rial, due_date, drawer_id, status)
     VALUES ($1, $2, 'ملی', $3, (now() + ($4 || ' days')::interval)::date, $5, 'in_circulation')
     RETURNING id`,
    [
      `CHK-${Math.random().toString(36).slice(2, 8)}`,
      `8${Math.random().toString().slice(2, 15)}`,
      amountRial.toString(),
      String(dueInDays),
      cust[0]!.id,
    ],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  await seedCatalog(db, { openingInventory: false });
  accounting = new AccountingService(db);

  const { rows: w } = await db.query<{ id: string }>(`SELECT id FROM warehouses LIMIT 1`);
  warehouseId = w[0]!.id;
  const { rows: v } = await db.query<{ id: string }>(
    `SELECT id FROM product_variants WHERE sku = 'CS-13P-BLK'`,
  );
  variantId = v[0]!.id;
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('تسویه‌یِ فاکتورِ خرید', () => {
  it('پرداخت، مانده‌یِ فاکتور را کم می‌کند و سند می‌سازد', async () => {
    const invoice = await openInvoice(10, 1_000_000n); // ۱۰ میلیون ریال
    const paid = await paySupplierInvoice(db, {
      invoiceId: invoice.id,
      amountRial: 4_000_000n,
      method: 'cash',
      referenceNo: 'رسیدِ ۱۲۳',
    });

    expect(paid.remainingRial).toBe((invoice.payable - 4_000_000n).toString());
    expect(paid.settled).toBe(false);

    const { rows } = await db.query<{ payable_rial: string }>(
      `SELECT payable_rial::text FROM purchase_invoices WHERE id = $1`,
      [invoice.id],
    );
    expect(BigInt(rows[0]!.payable_rial)).toBe(invoice.payable - 4_000_000n);

    // سند: بدهکارِ حساب‌های پرداختنی (۲۰۰۰)، بستانکارِ صندوق (۱۱۰۰)
    const { rows: lines } = await db.query<{
      code: string;
      debit: string;
      credit: string;
    }>(
      `SELECT a.code, jl.debit_rial::text AS debit, jl.credit_rial::text AS credit
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.entry_no = $1`,
      [paid.entryNo],
    );
    expect(lines.find((l) => l.code === '2000')?.debit).toBe('4000000');
    expect(lines.find((l) => l.code === '1100')?.credit).toBe('4000000');
  });

  it('پرداختِ چندمرحله‌ای تا تسویه پیش می‌رود و فاکتور دیگر پرداخت نمی‌پذیرد', async () => {
    const invoice = await openInvoice(3, 2_000_000n); // ۶ میلیون ریال
    await paySupplierInvoice(db, { invoiceId: invoice.id, amountRial: 2_000_000n, method: 'bank' });

    const second = await paySupplierInvoice(db, {
      invoiceId: invoice.id,
      amountRial: invoice.payable - 2_000_000n,
      method: 'card',
    });
    expect(second.remainingRial).toBe('0');
    expect(second.settled).toBe(true);

    await expect(
      paySupplierInvoice(db, { invoiceId: invoice.id, amountRial: 1n, method: 'cash' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('پیش‌تر تسویه شده') });
  });

  it('پرداختِ بیش از مانده پذیرفته نیست (با پیامِ روشن)', async () => {
    const invoice = await openInvoice(1, 500_000n);
    await expect(
      paySupplierInvoice(db, {
        invoiceId: invoice.id,
        amountRial: invoice.payable + 1n,
        method: 'cash',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('بیشتر است') });
  });

  it('پرداختِ چکی بدهی را به «اسنادِ پرداختنی» می‌برد، نه به بانک', async () => {
    const invoice = await openInvoice(4, 1_000_000n);
    const checkId = await registerCheck(2_000_000n, 15);

    const paid = await paySupplierInvoice(db, {
      invoiceId: invoice.id,
      amountRial: 2_000_000n,
      method: 'check',
      checkId,
    });

    const { rows } = await db.query<{ code: string; debit: string; credit: string }>(
      `SELECT a.code, jl.debit_rial::text AS debit, jl.credit_rial::text AS credit
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.entry_no = $1`,
      [paid.entryNo],
    );
    // چک هنوز پولی از حساب نبرده است: بستانکار اسنادِ پرداختنی است، نه بانک
    expect(rows.find((r) => r.code === '2050')?.credit).toBe('2000000');
    expect(rows.find((r) => r.code === '1200')).toBeUndefined();
  });

  it('وصولِ چک: از اسنادِ پرداختنی به بانک منتقل می‌شود و چک «پاس‌شده» می‌گردد', async () => {
    const invoice = await openInvoice(2, 1_000_000n);
    const checkId = await registerCheck(1_500_000n, 10);
    const paid = await paySupplierInvoice(db, {
      invoiceId: invoice.id,
      amountRial: 1_500_000n,
      method: 'check',
      checkId,
    });

    const cleared = await clearSupplierCheck(db, { paymentId: paid.paymentId });
    expect(cleared.checkNo).toBeTruthy();

    const { rows } = await db.query<{ code: string; debit: string; credit: string }>(
      `SELECT a.code, jl.debit_rial::text AS debit, jl.credit_rial::text AS credit
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.entry_no = $1`,
      [cleared.entryNo],
    );
    expect(rows.find((r) => r.code === '2050')?.debit).toBe('1500000');
    expect(rows.find((r) => r.code === '1200')?.credit).toBe('1500000');

    const { rows: chk } = await db.query<{ status: string }>(
      `SELECT status FROM checks WHERE id = $1`,
      [checkId],
    );
    expect(chk[0]!.status).toBe('settled');

    // وصولِ دوباره بی‌معناست
    await expect(clearSupplierCheck(db, { paymentId: paid.paymentId })).rejects.toMatchObject({
      message: expect.stringContaining('پیش‌تر وصول'),
    });
  });

  it('پرداختِ چکی بی‌چک پذیرفته نیست', async () => {
    const invoice = await openInvoice(1, 100_000n);
    await expect(
      paySupplierInvoice(db, { invoiceId: invoice.id, amountRial: 100_000n, method: 'check' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('چک') });
  });

  it('فهرستِ پرداخت‌ها برایِ مدیر قابلِ ردیابی است', async () => {
    const invoice = await openInvoice(5, 1_000_000n);
    await paySupplierInvoice(db, {
      invoiceId: invoice.id,
      amountRial: 1_000_000n,
      method: 'cash',
      referenceNo: 'رسیدِ الف',
    });

    const list = await listInvoicePayments(db, invoice.id);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.referenceNo).toBe('رسیدِ الف');
    // هر پرداخت باید سند داشته باشد؛ بی‌سند یعنی پولی رد و بدل شده که در دفتر نیست
    expect(list[0]!.entryNo).toBeTruthy();
  });

  it('ترازِ آزمایشی پس از پرداخت‌ها همچنان برقرار است', async () => {
    const tb = await accounting.trialBalance();
    expect(tb.balanced).toBe(true);
  });
});
