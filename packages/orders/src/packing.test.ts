import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations, createDatabase, type Database } from '@set/db';

import { PackingService } from './packing.js';
import {
  assertTransition,
  canTransition,
  STATUS_LABEL,
  STATUS_LABEL as CYCLE_LABEL,
  trackingStep,
} from './cycle.js';

/**
 * آزمونِ بسته‌بندی و ماشینِ وضعیت.
 *
 * آنچه اینجا می‌سنجد، ثبتِ یک ردیف نیست؛ «گذارِ درست» است. ارسالِ سفارشی
 * که بسته‌بندی نشده، یعنی کدِ رهگیری برای بسته‌ای که معلوم نیست چه دارد —
 * و نخستین پرسش در هر اختلاف («کالا کم بود»، «نرسید») بی‌پاسخ می‌ماند.
 */

let db: Database;
let packing: PackingService;

let typeId = '';
let variantId = '';
let userId = '';
let branchId = '';
let warehouseId = '';

beforeAll(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  packing = new PackingService(db);

  const type = await db.query<{ id: string }>(
    `INSERT INTO product_types (key, name) VALUES ('case', 'قاب')
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  typeId = type.rows[0]!.id;

  const user = await db.query<{ id: string }>(
    `INSERT INTO users (mobile, full_name) VALUES ('09000000001', 'انباردار') RETURNING id`,
  );
  userId = user.rows[0]!.id;

  const branch = await db.query<{ id: string }>(`SELECT id FROM branches LIMIT 1`);
  branchId = branch.rows[0]?.id ?? '';

  // موجودی بی‌انبار معنا ندارد (warehouse_id اجازه‌ی تهی نمی‌دهد)، پس یک
  // انبارِ آزمونی می‌سازیم.
  const warehouse = await db.query<{ id: string }>(
    `INSERT INTO warehouses (name, is_default) VALUES ('انبارِ آزمون', true) RETURNING id`,
  );
  warehouseId = warehouse.rows[0]!.id;
});

afterAll(async () => {
  await db.close();
});

afterEach(async () => {
  await db.query(`DELETE FROM order_status_history`);
  await db.query(`DELETE FROM orders`);
  await db.query(`DELETE FROM stock_items`);
  await db.query(`DELETE FROM product_variants`);
  await db.query(`DELETE FROM products`);
});

/** یک سفارش با یک قلم می‌سازد و موجودی می‌گذارد */
async function order(opts: { status?: string; quantity?: number; stock?: number } = {}): Promise<string> {
  const product = await db.query<{ id: string }>(
    `INSERT INTO products (type_id, title, slug, status) VALUES ($1, 'قاب سیلیکونی', $2, 'active') RETURNING id`,
    [typeId, `p-${Math.random().toString(36).slice(2, 9)}`],
  );
  const variant = await db.query<{ id: string }>(
    `INSERT INTO product_variants (product_id, sku, price_rial) VALUES ($1, $2, 100000) RETURNING id`,
    [product.rows[0]!.id, `SKU-${Math.random().toString(36).slice(2, 9)}`],
  );
  variantId = variant.rows[0]!.id;

  const created = await db.query<{ id: string }>(
    `INSERT INTO orders (order_no, branch_id, channel, status, total_rial)
     VALUES ($1, $2, 'web', $3, 100000) RETURNING id`,
    [`SO-${Math.random().toString(36).slice(2, 8)}`, branchId || null, opts.status ?? 'confirmed'],
  );
  const orderId = created.rows[0]!.id;
  await db.query(
    `INSERT INTO order_items (order_id, variant_id, quantity, unit_price_rial, total_rial)
     VALUES ($1, $2, $3, 100000, 100000)`,
    [orderId, variantId, opts.quantity ?? 2],
  );
  if ((opts.stock ?? 0) > 0) {
    await db.query(
      `INSERT INTO stock_items (variant_id, warehouse_id, on_hand, reserved) VALUES ($1, $2, $3, 0)`,
      [variantId, warehouseId, opts.stock ?? 0],
    );
  }
  return orderId;
}

describe('ماشینِ وضعیت', () => {
  it('چرخه‌یِ درست را می‌شناسد', () => {
    expect(canTransition('confirmed', 'packing')).toBe(true);
    expect(canTransition('packing', 'shipped')).toBe(true);
    expect(canTransition('shipped', 'delivered')).toBe(true);
  });

  it('گذارِ ناروا را نمی‌پذیرد', () => {
    expect(canTransition('pending_payment', 'packing')).toBe(false);
    expect(canTransition('shipped', 'packing')).toBe(false);
    expect(canTransition('delivered', 'shipped')).toBe(false);
  });

  it('رد کردن، نامِ هر دو وضعیت را می‌گوید — نه یک پیامِ بی‌ربط', () => {
    expect(() => assertTransition('pending_payment', 'packing')).toThrow(/در انتظارِ پرداخت/);
    expect(() => assertTransition('pending_payment', 'packing')).toThrow(/بسته‌بندی/);
  });

  it('برچسبِ فارسی برایِ همه‌یِ وضعیت‌ها هست', () => {
    expect(STATUS_LABEL.packing).toBe('در حالِ بسته‌بندی');
    expect(CYCLE_LABEL.packing).toBe(STATUS_LABEL.packing);
  });

  it('جایِ هر وضعیت در ردیفِ پیگیری معلوم است', () => {
    expect(trackingStep('packing')).toBeGreaterThan(trackingStep('confirmed'));
    expect(trackingStep('packing')).toBeLessThan(trackingStep('shipped'));
    expect(trackingStep('cancelled')).toBe(-1); // پایانِ راه، نه گامی از آن
  });
});

describe('ثبتِ بسته‌بندی', () => {
  it('سفارشِ تأییدشده بسته‌بندی می‌شود و زمان و بسته‌بند می‌گیرد', async () => {
    const id = await order({ status: 'confirmed', stock: 5 });
    const result = await packing.pack({ orderId: id, actorId: userId });

    expect(result.order.status).toBe('packing');
    expect(result.order.packedAt).toBeInstanceOf(Date);
    expect(result.order.packedBy).toBe(userId);
    expect(result.order.packingComplete).toBe(true);
  });

  it('کسری را خودش از موجودی می‌فهمد، نه از ادعایِ کاربر', async () => {
    const id = await order({ status: 'confirmed', quantity: 5, stock: 2 });
    const result = await packing.pack({ orderId: id, actorId: userId });

    expect(result.shortages).toHaveLength(1);
    expect(result.order.packingComplete).toBe(false);
    expect(result.lines[0]?.available).toBe(2);
  });

  it('در گذار، تاریخچه می‌نویسد — چه کسی و چرا', async () => {
    const id = await order({ status: 'confirmed', stock: 9 });
    await packing.pack({ orderId: id, actorId: userId, note: 'بسته‌بندیِ ویژه' });

    const history = await db.query<{ to_status: string; reason: string | null; actor_user_id: string | null }>(
      `SELECT to_status, reason, actor_user_id FROM order_status_history WHERE order_id = $1`,
      [id],
    );
    expect(history.rows[0]?.to_status).toBe('packing');
    expect(history.rows[0]?.actor_user_id).toBe(userId);
    expect(history.rows[0]?.reason).toContain('بسته‌بندی');
  });

  it('سفارشِ پرداخت‌نشده را نمی‌توان بست', async () => {
    const id = await order({ status: 'pending_payment', stock: 5 });
    await expect(packing.pack({ orderId: id, actorId: userId })).rejects.toThrow(/در انتظارِ پرداخت/);
  });

  it('بسته‌بندیِ دوباره رد می‌شود (از packing به packing راهی نیست)', async () => {
    const id = await order({ status: 'confirmed', stock: 5 });
    await packing.pack({ orderId: id, actorId: userId });
    await expect(packing.pack({ orderId: id, actorId: userId })).rejects.toThrow();
  });

  it('می‌توان از بسته‌بندی بازگشت — اگر کالایِ اشتباهی بسته شده باشد', async () => {
    const id = await order({ status: 'confirmed', stock: 5 });
    await packing.pack({ orderId: id, actorId: userId });
    const back = await packing.unpack(id, userId, 'اشتباه بسته شد');

    expect(back.status).toBe('confirmed');
    expect(back.packedAt).toBeNull();
    expect(back.packingComplete).toBeNull();
  });

  it('سفارشِ ناشناس خطا می‌دهد', async () => {
    await expect(packing.pack({ orderId: '00000000-0000-4000-8000-000000000000', actorId: userId })).rejects.toThrow(
      /یافت نشد/,
    );
  });
});

describe('صفِ کارِ انبار', () => {
  it('سفارش‌هایِ در انتظارِ بسته‌بندی را می‌آورد، بسته‌نشده‌ها نخست', async () => {
    const packed = await order({ status: 'confirmed', stock: 3 });
    await packing.pack({ orderId: packed, actorId: userId });
    const waiting = await order({ status: 'confirmed', stock: 3 });

    const queue = await packing.queue({});
    expect(queue.total).toBe(2);
    expect(queue.items[0]?.id).toBe(waiting);
    expect(queue.items[1]?.id).toBe(packed);
  });

  it('سفارشِ تحویل‌شده در صفِ انبار نیست', async () => {
    await order({ status: 'delivered', stock: 3 });
    const queue = await packing.queue({});
    expect(queue.total).toBe(0);
  });
});
