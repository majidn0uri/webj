import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations, createDatabase, type Database } from '@set/db';

import { StockAlertService } from './stock-alerts.js';
import { pendingSms } from './sms.js';

/**
 * آزمونِ «خبرم کن وقتی موجود شد».
 *
 * دو خطرِ اصلی اینجا:
 *   ۱. **تکرار**: یک نفر نباید ده‌بار در صف بنشیند و ده پیام بگیرد؛
 *   ۲. **پیامِ بی‌جا**: اگر کالا همین حالا موجود است، یا اگر هنوز موجود
 *      نشده، پیامی نباید برود. آگاه‌سازیِ دروغ، بدتر از ناآگاهی است.
 */

let db: Database;
let alerts: StockAlertService;

let typeId = '';
let productId = '';
let variantA = '';
let variantB = '';
let warehouseId = '';
let customerA = '';
let customerB = '';

beforeAll(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  alerts = new StockAlertService(db);

  const type = await db.query<{ id: string }>(
    `INSERT INTO product_types (key, name) VALUES ('case', 'قاب')
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  typeId = type.rows[0]!.id;

  const product = await db.query<{ id: string }>(
    `INSERT INTO products (type_id, title, slug, status) VALUES ($1, 'قابِ مشکی', 'case-black', 'active') RETURNING id`,
    [typeId],
  );
  productId = product.rows[0]!.id;

  const a = await db.query<{ id: string }>(
    `INSERT INTO product_variants (product_id, sku, price_rial) VALUES ($1, 'A-1', 100000) RETURNING id`,
    [productId],
  );
  variantA = a.rows[0]!.id;
  const b = await db.query<{ id: string }>(
    `INSERT INTO product_variants (product_id, sku, price_rial) VALUES ($1, 'B-1', 100000) RETURNING id`,
    [productId],
  );
  variantB = b.rows[0]!.id;

  const wh = await db.query<{ id: string }>(
    `INSERT INTO warehouses (name, is_default) VALUES ('انبارِ آزمون', true) RETURNING id`,
  );
  warehouseId = wh.rows[0]!.id;

  const ca = await db.query<{ id: string }>(
    `INSERT INTO customers (full_name, phone) VALUES ('مریم', '09121110001') RETURNING id`,
  );
  customerA = ca.rows[0]!.id;
  const cb = await db.query<{ id: string }>(
    `INSERT INTO customers (full_name, phone) VALUES ('رضا', '09121110002') RETURNING id`,
  );
  customerB = cb.rows[0]!.id;
});

afterAll(async () => {
  await db.close();
});

afterEach(async () => {
  await db.query(`DELETE FROM stock_notifications`);
  await db.query(`DELETE FROM stock_items`);
  await db.query(`DELETE FROM sms_outbox`);
});

async function setStock(variantId: string, onHand: number): Promise<void> {
  await db.query(`DELETE FROM stock_items WHERE variant_id = $1`, [variantId]);
  await db.query(`INSERT INTO stock_items (variant_id, warehouse_id, on_hand, reserved) VALUES ($1,$2,$3,0)`, [
    variantId,
    warehouseId || null,
    onHand,
  ]);
}

describe('درخواست', () => {
  it('کالایِ ناموجود در صف می‌نشیند', async () => {
    await setStock(variantA, 0);
    const result = await alerts.request({ variantId: variantA, customerId: customerA });

    expect(result.available).toBe(false);
    expect(result.alreadyWaiting).toBe(false);
    expect(result.notification.status).toBe('waiting');
  });

  it('کالایِ موجود را در صف نمی‌نشاند — می‌گوید همین حالا بخر', async () => {
    await setStock(variantA, 5);
    const result = await alerts.request({ variantId: variantA, customerId: customerA });
    expect(result.available).toBe(true);
  });

  it('درخواستِ دوم، همان درخواستِ نخست است — نه صفِ دو نفره', async () => {
    await setStock(variantA, 0);
    await alerts.request({ variantId: variantA, customerId: customerA });
    const again = await alerts.request({ variantId: variantA, customerId: customerA });

    expect(again.alreadyWaiting).toBe(true);
    const list = await alerts.listForProduct(productId, 'waiting');
    expect(list).toHaveLength(1);
  });

  it('دو مشتری جداگانه در صف می‌نشینند', async () => {
    await setStock(variantA, 0);
    await alerts.request({ variantId: variantA, customerId: customerA });
    await alerts.request({ variantId: variantA, customerId: customerB });

    const counts = await alerts.waitingFor([variantA]);
    expect(counts.get(variantA)).toBe(2);
  });

  it('تنوع‌ها از هم جدایند — انتظار برایِ مشکی یعنی فقط مشکی', async () => {
    await setStock(variantA, 0);
    await setStock(variantB, 0);
    await alerts.request({ variantId: variantA, customerId: customerA });

    const a = await alerts.waitingFor([variantA, variantB]);
    expect(a.get(variantA)).toBe(1);
    expect(a.get(variantB)).toBeUndefined();
  });

  it('بی‌هیچ راهِ ارتباطی پذیرفته نمی‌شود', async () => {
    await setStock(variantA, 0);
    await expect(alerts.request({ variantId: variantA })).rejects.toThrow();
  });

  it('مهمان با شماره هم می‌تواند در صف بنشیند', async () => {
    await setStock(variantA, 0);
    const result = await alerts.request({ variantId: variantA, phone: '09123330003' });
    expect(result.notification.phone).toBe('09123330003');
  });
});

describe('آگاه‌سازی', () => {
  it('تا کالا موجود نشود، پیامی نمی‌رود', async () => {
    await setStock(variantA, 0);
    await alerts.request({ variantId: variantA, customerId: customerA });

    const result = await alerts.notifyWaiters(variantA);
    expect(result.notified).toBe(0);

    const list = await alerts.listForProduct(productId, 'waiting');
    expect(list).toHaveLength(1);
  });

  it('با رسیدنِ کالا، پیام می‌رود و درخواست بسته می‌شود', async () => {
    await setStock(variantA, 0);
    const requested = await alerts.request({ variantId: variantA, customerId: customerA });
    await setStock(variantA, 10);

    const result = await alerts.notifyWaiters(variantA);
    expect(result.notified).toBe(1);

    const sms = await pendingSms(db, 10);
    expect(sms.length).toBeGreaterThan(0);
    expect(sms[0]?.body).toContain('قابِ مشکی');

    const waiting = await alerts.listForProduct(productId, 'waiting');
    expect(waiting).toHaveLength(0);
    void requested;
  });

  it('پیامِ دوم برایِ همان درخواست نمی‌رود', async () => {
    await setStock(variantA, 0);
    await alerts.request({ variantId: variantA, customerId: customerA });
    await setStock(variantA, 10);

    await alerts.notifyWaiters(variantA);
    const second = await alerts.notifyWaiters(variantA);
    expect(second.notified).toBe(0);
  });

  it('موجودیِ رزروشده «موجود» نیست — پس پیام نمی‌رود', async () => {
    await setStock(variantA, 0);
    await alerts.request({ variantId: variantA, customerId: customerA });

    // ۵ عدد هست، اما همه رزرو شده
    await db.query(`DELETE FROM stock_items WHERE variant_id = $1`, [variantA]);
    await db.query(
      `INSERT INTO stock_items (variant_id, warehouse_id, on_hand, reserved) VALUES ($1,$2,5,5)`,
      [variantA, warehouseId],
    );
    const result = await alerts.notifyWaiters(variantA);
    expect(result.notified).toBe(0);
  });

  it('کسی که تنها رایانامه داده، پیامکی نمی‌گیرد — و در صف می‌ماند', async () => {
    await setStock(variantA, 0);
    // مشتری همواره شماره دارد (ستونِ phone اجازه‌ی تهی نمی‌دهد)، پس تنها
    // راهِ «بی‌شماره» درخواستی است که فقط رایانامه داده است.
    await db.query(
      `INSERT INTO stock_notifications (variant_id, product_id, email, channel, source)
       VALUES ($1, $2, 'a@b.com', 'email', 'web')`,
      [variantA, productId],
    );
    await setStock(variantA, 3);

    const result = await alerts.notifyWaiters(variantA);
    expect(result.notified).toBe(0); // پیامکی ندارد

    // و هنوز در صف است: نباید «آگاه شد» بخورد در حالی که پیامی نرفته
    const waiting = await alerts.listForProduct(productId, 'waiting');
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.email).toBe('a@b.com');
  });

  it('آگاه‌سازی در سطحِ کالا، همه‌یِ تنوع‌ها را می‌پوشاند', async () => {
    await setStock(variantA, 0);
    await setStock(variantB, 0);
    await alerts.request({ variantId: variantA, customerId: customerA });
    await alerts.request({ variantId: variantB, customerId: customerB });

    await setStock(variantA, 4);
    await setStock(variantB, 4);

    const result = await alerts.notifyForProduct(productId);
    expect(result.notified).toBe(2);
  });
});

describe('لغو', () => {
  it('درخواست لغو می‌شود', async () => {
    await setStock(variantA, 0);
    const requested = await alerts.request({ variantId: variantA, customerId: customerA });

    expect(await alerts.cancel(requested.notification.id)).toBe(true);
    const list = await alerts.listForProduct(productId, 'waiting');
    expect(list).toHaveLength(0);
  });

  it('لغوِ دوباره بی‌اثر است', async () => {
    await setStock(variantA, 0);
    const requested = await alerts.request({ variantId: variantA, customerId: customerA });
    await alerts.cancel(requested.notification.id);
    expect(await alerts.cancel(requested.notification.id)).toBe(false);
  });

  it('فهرستِ انتظارهایِ مشتری', async () => {
    await setStock(variantA, 0);
    await setStock(variantB, 0);
    await alerts.request({ variantId: variantA, customerId: customerA });
    await alerts.request({ variantId: variantB, customerId: customerA });

    const mine = await alerts.listForCustomer(customerA);
    expect(mine).toHaveLength(2);
    expect(mine[0]?.productTitle).toBe('قابِ مشکی');
  });
});
