import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createDatabase, applyMigrations, seedCatalog, type Database } from '@set/db';
import {
  createSupplier,
  createPurchaseRequest,
  decidePurchaseRequest,
  listPurchaseRequests,
  createInvoiceFromRequest,
  receiveGoods,
  listGoodsReceipts,
  createSupplierReturn,
} from './index.js';

/**
 * زنجیره‌ی تأمین — با ارقامِ واقعیِ سند:
 *   درخواستِ ۳۰ قاب + ۱۰ کابل  →  تأیید  →  فاکتور  →  رسید با کسر و معیوب
 *
 * چهار ادعایِ اصلی این آزمون:
 *   ۱) بدون رسید، موجودی تغییر نمی‌کند (BR-19)
 *   ۲) موجودی فقط به اندازه‌ی «سالمِ دریافتی» بالا می‌رود (BR-16)
 *   ۳) مغایرتِ مقدار و معیوبی ثبت می‌شود و پنهان نمی‌ماند (BR-18)
 *   ۴) میانگینِ موزون پس از رسید به‌روزرسانی می‌شود (BR-17)
 */

let db: Database;
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const t = (toman: number) => BigInt(toman) * 10n;

let supplierId = '';
let warehouseId = '';
let caseVariant = '';
let cableVariant = '';

async function makeProduct(title: string, slug: string, saleToman: number, qty: number) {
  const { rows: type } = await db.query<{ id: string }>(`SELECT id FROM product_types LIMIT 1`);
  const { rows: product } = await db.query<{ id: string }>(
    `INSERT INTO products (title, slug, type_id, status, reorder_point)
     VALUES ($1,$2,$3,'active', 10) RETURNING id`,
    [title, `${slug}-${RUN}`, type[0]!.id],
  );
  const { rows: variant } = await db.query<{ id: string }>(
    `INSERT INTO product_variants (product_id, sku, price_rial, attributes, is_active)
     VALUES ($1,$2,$3,$4::jsonb,true) RETURNING id`,
    [product[0]!.id, `${slug.toUpperCase()}-${RUN}`.slice(0, 32), t(saleToman).toString(), JSON.stringify({ color: 'مشکی' })],
  );
  await db.query(
    `INSERT INTO stock_items (variant_id, warehouse_id, on_hand, reserved)
     VALUES ($1,$2,$3,0)
     ON CONFLICT (variant_id, warehouse_id) DO UPDATE SET on_hand = EXCLUDED.on_hand`,
    [variant[0]!.id, warehouseId, qty],
  );
  return variant[0]!.id;
}

beforeAll(async () => {
  db = await createDatabase(
    process.env.DB_URL ?? 'postgres://setshop@/setshop?host=/tmp/setshop-pgrun&port=5433',
  );
  await applyMigrations(db);
  await seedCatalog(db);

  const { rows: wh } = await db.query<{ id: string }>(`SELECT id FROM warehouses LIMIT 1`);
  warehouseId = wh[0]!.id;

  const supplier = await createSupplier(db, {
    name: `تأمین‌کننده‌ی آزمون ${RUN}`,
    storeName: 'پخشِ آرین',
    nationalId: '10380284790', // شناسه‌ی حقوقیِ معتبر (نمونه‌ی مستندشده)
    economicCode: '123456789012',
    mobile: `0912${String(Date.now()).slice(-7)}`.slice(0, 11),
    city: 'تهران',
    postalCode: '1234567890',
    sheba: 'IR123456789012345678901234',
    settlementTerms: 'credit_30',
  });
  supplierId = supplier.id;

  caseVariant = await makeProduct('قاب آرک (تأمین)', 'sup-case', 149_000, 4);
  cableVariant = await makeProduct('کابل تایپ‌سی (تأمین)', 'sup-cable', 65_000, 2);
}, 120_000);

afterAll(async () => {
  await db.query(`DELETE FROM supplier_price_history WHERE supplier_id = $1`, [supplierId]);
  await db.query(`DELETE FROM supplier_returns WHERE supplier_id = $1`, [supplierId]);
  await db.query(`DELETE FROM goods_receipts WHERE supplier_id = $1`, [supplierId]);
  await db.query(`DELETE FROM stock_movements WHERE reference_type IN ('goods_receipt','supplier_return')`);
  await db.query(
    `DELETE FROM purchase_invoice_items WHERE invoice_id IN
       (SELECT id FROM purchase_invoices WHERE purchase_request_id IN
          (SELECT id FROM purchase_requests WHERE supplier_id = $1))`,
    [supplierId],
  );
  await db.query(
    `DELETE FROM purchase_invoices WHERE purchase_request_id IN
       (SELECT id FROM purchase_requests WHERE supplier_id = $1)`,
    [supplierId],
  );
  await db.query(
    `DELETE FROM purchase_request_items WHERE request_id IN
       (SELECT id FROM purchase_requests WHERE supplier_id = $1)`,
    [supplierId],
  );
  await db.query(`DELETE FROM purchase_requests WHERE supplier_id = $1`, [supplierId]);
  await db.query(`DELETE FROM suppliers WHERE id = $1`, [supplierId]);
  const variantFilter = `(SELECT id FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE slug LIKE $1))`;
  for (const table of ['inventory_valuation', 'stock_items', 'stock_movements', 'purchase_request_items', 'purchase_invoice_items']) {
    await db.query(`DELETE FROM ${table} WHERE variant_id IN ${variantFilter}`, [`%-${RUN}`]);
  }
  await db.query(`DELETE FROM products WHERE slug LIKE $1`, [`%-${RUN}`]);
  await db.close();
});

describe('تأمین‌کننده', () => {
  it('کدِ خودکار می‌گیرد و داده‌هایِ ایرانی را نگه می‌دارد (BR-24)', async () => {
    expect(supplierId).toBeTruthy();
    const { rows } = await db.query<{
      code: string;
      national_id: string;
      sheba: string;
      settlement_terms: string;
    }>(`SELECT code, national_id, sheba, settlement_terms FROM suppliers WHERE id = $1`, [supplierId]);
    expect(rows[0]!.code).toMatch(/^T-\d{4}$/);
    expect(rows[0]!.national_id).toBe('10380284790');
    expect(rows[0]!.sheba).toBe('IR123456789012345678901234');
    expect(rows[0]!.settlement_terms).toBe('credit_30');
  });

  it('شبای نادرست را نمی‌پذیرد', async () => {
    await expect(
      createSupplier(db, { name: 'شبای غلط', sheba: 'IR123', nationalId: '10380284790' }),
    ).rejects.toBeTruthy();
  });
});

describe('زنجیره‌ی درخواست تا رسید', () => {
  let requestNo = '';
  let invoiceId = '';

  it('درخواستِ خرید با شماره‌ی PR ساخته می‌شود', async () => {
    const request = await createPurchaseRequest(db, {
      items: [
        { variantId: caseVariant, quantity: 30 },
        { variantId: cableVariant, quantity: 10 },
      ],
      supplierId,
      priority: 'high',
      reason: 'موجودی زیرِ نقطه‌ی سفارش',
    });
    requestNo = request.request_no;
    expect(requestNo).toMatch(/^PR-\d{4}-\d{4}$/);
    expect(request.status).toBe('pending_approval');

    const list = await listPurchaseRequests(db, { status: 'pending_approval' });
    const found = list.find((r) => r.id === request.id);
    expect(found?.items).toHaveLength(2);
  });

  it('تأییدِ مدیر ثبت می‌شود', async () => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM purchase_requests WHERE request_no = $1`,
      [requestNo],
    );
    const approved = await decidePurchaseRequest(db, {
      requestId: rows[0]!.id,
      approve: true,
      note: 'قیمت مناسب است',
      supplierId,
    });
    expect(approved.status).toBe('approved');
    expect(approved.decision_note).toBe('قیمت مناسب است');

    // تأییدِ دوباره ممنوع
    await expect(
      decidePurchaseRequest(db, { requestId: rows[0]!.id, approve: true, note: '' }),
    ).rejects.toMatchObject({ key: 'CONFLICT' });
  });

  it('فاکتورِ خرید از درخواست صادر می‌شود بی‌آن‌که موجودی را بالا ببرد (BR-19)', async () => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM purchase_requests WHERE request_no = $1`,
      [requestNo],
    );
    const before = await db.query<{ on_hand: number }>(
      `SELECT on_hand FROM stock_items WHERE variant_id = $1 AND warehouse_id = $2`,
      [caseVariant, warehouseId],
    );

    const result = await createInvoiceFromRequest(db, {
      requestId: rows[0]!.id,
      supplierId,
      warehouseId,
      prices: { [caseVariant]: t(95_000), [cableVariant]: t(40_000) },
      extraCostRial: t(50_000), // هزینه‌ی حمل
      vatRial: t(320_500),
    });
    invoiceId = result.invoiceId;

    const after = await db.query<{ on_hand: number }>(
      `SELECT on_hand FROM stock_items WHERE variant_id = $1 AND warehouse_id = $2`,
      [caseVariant, warehouseId],
    );
    // مهم‌ترین ادعا: فاکتور موجودی را تغییر نداد
    expect(after.rows[0]!.on_hand).toBe(before.rows[0]!.on_hand);

    // اما سندِ مالی صادر شده است
    const { rows: inv } = await db.query<{ supplier_id: string; purchase_request_id: string }>(
      `SELECT supplier_id, purchase_request_id FROM purchase_invoices WHERE id = $1`,
      [invoiceId],
    );
    expect(inv[0]!.supplier_id).toBe(supplierId);
    expect(inv[0]!.purchase_request_id).toBe(rows[0]!.id);

    // و وضعیتِ درخواست پیش رفته است
    const { rows: req } = await db.query<{ status: string }>(
      `SELECT status FROM purchase_requests WHERE id = $1`,
      [rows[0]!.id],
    );
    expect(req[0]!.status).toBe('ordered');
  });

  it('رسیدِ انبار موجودی را بالا می‌برد، مغایرت را ثبت می‌کند و میانگین را به‌روز می‌کند', async () => {
    const before = await db.query<{ on_hand: number }>(
      `SELECT on_hand FROM stock_items WHERE variant_id = $1 AND warehouse_id = $2`,
      [caseVariant, warehouseId],
    );

    // از ۳۰ قابِ سفارشی، ۲۸ رسیده و ۲ تا معیوب؛ از کابل ۱۰ تا کامل
    const result = await receiveGoods(db, {
      purchaseInvoiceId: invoiceId,
      supplierId,
      warehouseId,
      items: [
        {
          variantId: caseVariant,
          expectedQuantity: 30,
          receivedQuantity: 28,
          damagedQuantity: 2,
          unitCostRial: t(95_000),
          note: 'دو عدد در حمل شکست',
        },
        { variantId: cableVariant, expectedQuantity: 10, receivedQuantity: 10, unitCostRial: t(40_000) },
      ],
    });

    expect(result.receiptNo).toMatch(/^KH-\d{4}-\d{4}$/);

    // ۱) موجودی فقط به اندازه‌ی سالم بالا رفت (۲۸ − ۲ = ۲۶)
    const after = await db.query<{ on_hand: number }>(
      `SELECT on_hand FROM stock_items WHERE variant_id = $1 AND warehouse_id = $2`,
      [caseVariant, warehouseId],
    );
    expect(after.rows[0]!.on_hand).toBe(before.rows[0]!.on_hand + 26);

    // ۲) مغایرت ثبت شد: کسرِ ۲ عدد + ۲ معیوب
    expect(result.status).toBe('discrepancy');
    expect(result.discrepancies.length).toBe(1);
    expect(result.discrepancies[0]!.kind).toBe('damaged');
    expect(result.discrepancies[0]!.quantityDiff).toBe(-2);
    expect(result.discrepancies[0]!.damaged).toBe(2);

    // ۳) رسید در فهرست با وضعیتِ مغایرت دیده می‌شود
    const list = await listGoodsReceipts(db, { status: 'discrepancy' });
    expect(list.some((r) => r.id === result.receiptId)).toBe(true);

    // ۴) میانگینِ موزون به‌روزرسانی شد (BR-17)
    const { rows: val } = await db.query<{ quantity: number; avg_cost_rial: string }>(
      `SELECT quantity, avg_cost_rial::text FROM inventory_valuation
        WHERE variant_id = $1 AND warehouse_id = $2`,
      [caseVariant, warehouseId],
    );
    expect(Number(val[0]!.quantity)).toBeGreaterThan(0);
    expect(BigInt(val[0]!.avg_cost_rial)).toBeGreaterThan(0n);

    // ۵) ضایعات در حرکت‌های انبار ثبت شد
    const { rows: waste } = await db.query<{ quantity: number }>(
      `SELECT quantity FROM stock_movements WHERE reference_id = $1 AND reason = 'waste'`,
      [result.receiptId],
    );
    expect(waste[0]!.quantity).toBe(2);
  });

  it('مغایرتِ قیمتی هم دیده می‌شود (رسید گران‌تر از فاکتور)', async () => {
    const result = await receiveGoods(db, {
      purchaseInvoiceId: invoiceId,
      supplierId,
      warehouseId,
      items: [
        { variantId: cableVariant, expectedQuantity: 5, receivedQuantity: 5, unitCostRial: t(48_000) },
      ],
    });
    const price = result.discrepancies.find((d) => d.kind === 'price');
    expect(price).toBeTruthy();
    expect(price!.priceDiffRial).toBe(t(8_000)); // ۴۸٬۰۰۰ − ۴۰٬۰۰۰
  });

  it('برگشت به تأمین‌کننده (BS) موجودی را کم می‌کند', async () => {
    const before = await db.query<{ on_hand: number }>(
      `SELECT on_hand FROM stock_items WHERE variant_id = $1 AND warehouse_id = $2`,
      [cableVariant, warehouseId],
    );

    const result = await createSupplierReturn(db, {
      supplierId,
      warehouseId,
      reason: 'عدم تطابق با سفارش',
      items: [{ variantId: cableVariant, quantity: 3, unitCostRial: t(40_000) }],
    });
    expect(result.returnNo).toMatch(/^BS-\d{4}-\d{4}$/);
    expect(result.totalRial).toBe(t(120_000));

    const after = await db.query<{ on_hand: number }>(
      `SELECT on_hand FROM stock_items WHERE variant_id = $1 AND warehouse_id = $2`,
      [cableVariant, warehouseId],
    );
    expect(after.rows[0]!.on_hand).toBe(before.rows[0]!.on_hand - 3);
  });

  it('برگشتِ بیش از موجودی رد می‌شود', async () => {
    await expect(
      createSupplierReturn(db, {
        supplierId,
        warehouseId,
        reason: 'تستِ بیش‌برگشت',
        items: [{ variantId: cableVariant, quantity: 999_999, unitCostRial: t(40_000) }],
      }),
    ).rejects.toMatchObject({ key: 'CONFLICT' });
  });
});
