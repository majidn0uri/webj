import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, applyMigrations, seedCatalog, type Database } from '@set/db';
import { availableQuantity } from '@set/inventory';
import { CartService } from './index.js';

let db: Database;
let cartService: CartService;
let warehouseId: string;
let caseVariantId: string;
let cableVariantId: string;

beforeEach(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  await seedCatalog(db);
  cartService = new CartService(db);

  const { rows: w } = await db.query<{ id: string }>(`SELECT id FROM warehouses LIMIT 1`);
  warehouseId = w[0]!.id;
  const { rows: v } = await db.query<{ id: string; sku: string }>(
    `SELECT id, sku FROM product_variants WHERE sku IN ('CS-13P-BLK','CB-LT-1M') ORDER BY sku`,
  );
  cableVariantId = v.find((r) => r.sku === 'CB-LT-1M')!.id;
  caseVariantId = v.find((r) => r.sku === 'CS-13P-BLK')!.id;
});

afterEach(async () => db.close());

async function newCart() {
  return cartService.createCart({ channel: 'web' });
}

describe('سبدِ خرید', () => {
  it('سبدِ تازه خالی است', async () => {
    const cart = await cartService.getCart(await newCart());
    expect(cart.items).toEqual([]);
    expect(cart.subtotalRial).toBe('0');
    expect(cart.itemCount).toBe(0);
  });

  it('افزودنِ کالا، قیمت را از جدولِ تنوع می‌گیرد نه از ورودیِ کاربر', async () => {
    const cartId = await newCart();
    await cartService.addItem({ cartId, variantId: caseVariantId, quantity: 2 });

    const cart = await cartService.getCart(cartId);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.quantity).toBe(2);
    // قیمتِ این تنوع در داده‌ی نمونه ۲٬۵۵۰٬۰۰۰ ریال است
    expect(cart.items[0]!.currentPriceRial).toBe('2550000');
    expect(cart.items[0]!.lineTotalRial).toBe('5100000');
    expect(cart.subtotalRial).toBe('5100000');
    expect(cart.itemCount).toBe(2);
  });

  it('افزودنِ دوباره‌ی همان کالا جمع می‌شود، نه تکرار', async () => {
    const cartId = await newCart();
    await cartService.addItem({ cartId, variantId: caseVariantId, quantity: 1 });
    await cartService.addItem({ cartId, variantId: caseVariantId, quantity: 2 });

    const cart = await cartService.getCart(cartId);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.quantity).toBe(3);
  });

  it('تعدادِ هر ردیف از ۹۹ بیشتر نمی‌شود', async () => {
    const cartId = await newCart();
    await cartService.addItem({ cartId, variantId: caseVariantId, quantity: 60 });
    await cartService.addItem({ cartId, variantId: caseVariantId, quantity: 60 });

    const cart = await cartService.getCart(cartId);
    expect(cart.items[0]!.quantity).toBe(99);
  });

  it('تعدادِ صفر یا بیش از ۹۹ رد می‌شود', async () => {
    const cartId = await newCart();
    await expect(cartService.addItem({ cartId, variantId: caseVariantId, quantity: 0 }))
      .rejects.toMatchObject({ code: 'ERR-001' });
    await expect(cartService.addItem({ cartId, variantId: caseVariantId, quantity: 100 }))
      .rejects.toMatchObject({ code: 'ERR-001' });
  });

  it('تنوعِ ناموجود یا غیرفعال پذیرفته نمی‌شود', async () => {
    const cartId = await newCart();
    await db.query(`UPDATE product_variants SET is_active = false WHERE id = $1`, [caseVariantId]);
    await expect(cartService.addItem({ cartId, variantId: caseVariantId, quantity: 1 }))
      .rejects.toMatchObject({ code: 'ERR-001' });
  });

  it('حذفِ ردیف', async () => {
    const cartId = await newCart();
    await cartService.addItem({ cartId, variantId: caseVariantId, quantity: 1 });
    await cartService.addItem({ cartId, variantId: cableVariantId, quantity: 1 });
    await cartService.removeItem(cartId, caseVariantId);

    const cart = await cartService.getCart(cartId);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.variantId).toBe(cableVariantId);
  });
});

describe('صداقت در نمایش', () => {
  it('تغییرِ قیمت پس از افزودن به سبد، به مشتری نشان داده می‌شود', async () => {
    const cartId = await newCart();
    await cartService.addItem({ cartId, variantId: caseVariantId, quantity: 1 });

    let cart = await cartService.getCart(cartId);
    expect(cart.items[0]!.priceChanged).toBe(false);
    expect(cart.hasPriceChanges).toBe(false);

    // فروشنده قیمت را بالا می‌برد
    await db.query(`UPDATE product_variants SET price_rial = 3000000 WHERE id = $1`, [caseVariantId]);

    cart = await cartService.getCart(cartId);
    expect(cart.items[0]!.priceChanged).toBe(true);
    expect(cart.items[0]!.priceAtAddRial).toBe('2550000');
    expect(cart.items[0]!.currentPriceRial).toBe('3000000');
    expect(cart.hasPriceChanges).toBe(true);
  });

  it('کمبودِ موجودی پیش از پرداخت معلوم می‌شود', async () => {
    const cartId = await newCart();
    await cartService.addItem({ cartId, variantId: caseVariantId, quantity: 99 });

    const cart = await cartService.getCart(cartId);
    expect(cart.items[0]!.enoughStock).toBe(false);
    expect(cart.hasStockProblems).toBe(true);
  });
});

describe('تسویه‌حساب', () => {
  it('سبد به سفارش تبدیل می‌شود و موجودی رزرو می‌گردد', async () => {
    const before = await availableQuantity(db, caseVariantId, warehouseId);

    const cartId = await newCart();
    await cartService.addItem({ cartId, variantId: caseVariantId, quantity: 2 });
    const result = await cartService.checkout({ cartId, idempotencyKey: 'cart-checkout-1' });

    expect(result.orderNo).toMatch(/^ORD-\d{4}-\d{6}$/);
    expect(await availableQuantity(db, caseVariantId, warehouseId)).toBe(before - 2);

    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM orders WHERE id = $1`, [result.orderId],
    );
    expect(rows[0]!.status).toBe('pending_payment');
  });

  it('سبدِ خالی تسویه نمی‌شود', async () => {
    const cartId = await newCart();
    await expect(cartService.checkout({ cartId, idempotencyKey: 'k1' }))
      .rejects.toMatchObject({ code: 'ERR-001' });
  });

  it('دو بار تسویهٔ هم‌زمانِ یک سبد فقط یک سفارش می‌سازد', async () => {
    const cartId = await newCart();
    await cartService.addItem({ cartId, variantId: caseVariantId, quantity: 1 });

    const results = await Promise.allSettled([
      cartService.checkout({ cartId, idempotencyKey: 'same-key' }),
      cartService.checkout({ cartId, idempotencyKey: 'same-key' }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // یا هر دو یک سفارشِ مشترک برمی‌گردانند (یکتایی)، یا دومی با تضاد رد می‌شود
    expect(fulfilled.length + rejected.length).toBe(2);
    if (fulfilled.length === 2) {
      const a = (fulfilled[0] as PromiseFulfilledResult<{ orderId: string }>).value;
      const b = (fulfilled[1] as PromiseFulfilledResult<{ orderId: string }>).value;
      expect(a.orderId).toBe(b.orderId);
    } else {
      expect(rejected).toHaveLength(1);
    }

    const { rows } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM orders`, [],
    );
    expect(rows[0]!.n).toBe('1');
    expect(await availableQuantity(db, caseVariantId, warehouseId)).toBe(
      (await db.query<{ on_hand: number; reserved: number }>(
        `SELECT on_hand, reserved FROM stock_items WHERE variant_id = $1`, [caseVariantId],
      )).rows[0]!.on_hand - 1,
    );
  });

  it('وقتی موجودی کافی نیست، تسویه با خطایِ روشن شکست می‌خورد', async () => {
    const cartId = await newCart();
    await cartService.addItem({ cartId, variantId: caseVariantId, quantity: 3 });

    // سبد در لحظه‌ی افزودن موجود بود، اما پیش از تسویه موجودی آب می‌رود
    await db.query(`UPDATE stock_items SET on_hand = 1, reserved = 0 WHERE variant_id = $1`, [
      caseVariantId,
    ]);

    await expect(cartService.checkout({ cartId, idempotencyKey: 'k2' })).rejects.toMatchObject({
      code: 'ERR-006',
    });

    // سبد نباید بسته شده باشد: مشتری می‌تواند تعداد را اصلاح کند
    const cart = await cartService.getCart(cartId);
    expect(cart.status).toBe('active');
    expect(cart.hasStockProblems).toBe(true);
  });
});
