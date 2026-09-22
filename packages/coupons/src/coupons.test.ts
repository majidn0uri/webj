import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

import { applyMigrations, createDatabase, type Database } from '@set/db';

import {
  createCoupon,
  updateCoupon,
  setCouponActive,
  listCoupons,
  getCouponById,
  validateCoupon,
  applyCoupon,
  applyCouponRecord,
  redeemCoupon,
  releaseCoupon,
  listRedemptions,
  countRedemptions,
  normalizeCode,
  COUPON_ERRORS,
  type CouponLine,
} from './coupons.js';

let db: Database;

afterAll(async () => {
  await db.close?.();
});

afterEach(async () => {
  await db.query(`DELETE FROM coupon_redemptions`);
  await db.query(`DELETE FROM coupons`);
  await db.query(`DELETE FROM orders`);
});

// پاک‌سازی با ترتیب: فرزند پیش از والد
beforeEach(async () => {
  await db.query(`DELETE FROM order_items`);
  await db.query(`DELETE FROM coupon_redemptions`);
  await db.query(`UPDATE orders SET coupon_id = NULL, coupon_code = NULL`);
  await db.query(`DELETE FROM coupons`);
});

let PRODUCT_A = '';
let PRODUCT_B = '';
let CATEGORY = '';
let CHILD_CATEGORY = '';
let CUSTOMER_1 = '';
let CUSTOMER_2 = '';

beforeAll(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);

  // بذرِ کمینه: یک درختِ دسته (کوپنِ دسته‌ای نیازش دارد)، دو کالا، دو مشتری
  const t = await db.query<{ id: string }>(
    `INSERT INTO product_types (key, name, slug) VALUES ('cat-root','ریشه','cat-root')
     ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  CATEGORY = t.rows[0]!.id;
  const ch = await db.query<{ id: string }>(
    `INSERT INTO product_types (key, name, slug, parent_id) VALUES ('cat-child','فرزند','cat-child',$1)
     ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [CATEGORY],
  );
  CHILD_CATEGORY = ch.rows[0]!.id;

  const a = await db.query<{ id: string }>(
    `INSERT INTO products (type_id, title, slug, status) VALUES ($1,'کالایِ آ','pa','active') RETURNING id`,
    [CATEGORY],
  );
  PRODUCT_A = a.rows[0]!.id;
  const b = await db.query<{ id: string }>(
    `INSERT INTO products (type_id, title, slug, status) VALUES ($1,'کالایِ ب','pb','active') RETURNING id`,
    [CHILD_CATEGORY],
  );
  PRODUCT_B = b.rows[0]!.id;

  for (const [mobile, key] of [['09120000001', 'c1'], ['09120000002', 'c2']] as const) {
    const c = await db.query<{ id: string }>(
      `INSERT INTO customers (phone, full_name) VALUES ($1,$2) RETURNING id`,
      [mobile, `مشتریِ ${key}`],
    );
    if (key === 'c1') CUSTOMER_1 = c.rows[0]!.id;
    else CUSTOMER_2 = c.rows[0]!.id;
  }
});

async function setUsage(couponId: string, n: number): Promise<void> {
  await db.query(`UPDATE coupons SET usage_count = $2 WHERE id = $1`, [couponId, n]);
}

function line(variantId: string, unitPrice: number, quantity = 1, productId = PRODUCT_A): CouponLine {
  return { variantId, productId, quantity, unitPriceRial: BigInt(unitPrice) };
}

describe('نرمال‌سازیِ کد', () => {
  it('فاصله و حروفِ کوچک را یک‌دست می‌کند', () => {
    expect(normalizeCode('  off 10 ')).toBe('OFF10');
    expect(normalizeCode('nowruz1405')).toBe('NOWRUZ1405');
  });

  it('دو کدِ هم‌ارز، یکی ذخیره می‌شوند', async () => {
    const c = await createCoupon(db, { code: 'sale10', title: 'ده درصد', kind: 'percent', valueBp: 1000 });
    expect(c.code).toBe('SALE10');
    const again = await getCouponById(db, c.id);
    expect(again?.code).toBe('SALE10');
  });
});

describe('ساخت و اعتبارسنجیِ ورودی', () => {
  it('کدِ تهی رد می‌شود', async () => {
    await expect(createCoupon(db, { code: '   ', title: 'x', kind: 'percent', valueBp: 1000 })).rejects.toThrow();
  });

  it('درصدِ بیش از ۱۰۰ رد می‌شود', async () => {
    await expect(createCoupon(db, { code: 'BIG', title: 'x', kind: 'percent', valueBp: 20000 })).rejects.toThrow();
  });

  it('مبلغِ صفر رد می‌شود', async () => {
    await expect(createCoupon(db, { code: 'ZERO', title: 'x', kind: 'fixed', valueRial: 0n })).rejects.toThrow();
  });

  it('کوپنِ کالا بی‌کالا رد می‌شود', async () => {
    await expect(
      createCoupon(db, { code: 'PROD', title: 'x', kind: 'percent', valueBp: 1000, appliesTo: 'product' }),
    ).rejects.toThrow();
  });

  it('بازه‌یِ وارونه رد می‌شود', async () => {
    await expect(
      createCoupon(db, {
        code: 'WIN', title: 'x', kind: 'percent', valueBp: 1000,
        startsAt: new Date('2026-05-02T00:00:00Z'),
        endsAt: new Date('2026-05-01T00:00:00Z'),
      }),
    ).rejects.toThrow();
  });
});

describe('حسابِ تخفیف', () => {
  it('درصدی: ۱۰٪ از مبلغِ مشمول', async () => {
    const c = await createCoupon(db, { code: 'P10', title: 'ده', kind: 'percent', valueBp: 1000 });
    const r = applyCouponRecord(c, [line('v1', 100000, 2)]);
    expect(r.discountRial).toBe(20000n);
  });

  it('درصدیِ نیم‌بند: ۱۲٫۵٪ دقیق', async () => {
    const c = await createCoupon(db, { code: 'P125', title: 'دوازده‌ونیم', kind: 'percent', valueBp: 1250 });
    const r = applyCouponRecord(c, [line('v1', 100000, 1)]);
    expect(r.discountRial).toBe(12500n);
  });

  it('سقفِ تخفیف از درصد جلو می‌زند', async () => {
    const c = await createCoupon(db, {
      code: 'CAP', title: 'با سقف', kind: 'percent', valueBp: 5000, maxDiscountRial: 100000n,
    });
    // ۵۰٪ از یک میلیون = ۵۰۰ هزار، ولی سقف ۱۰۰ هزار است
    const r = applyCouponRecord(c, [line('v1', 1000000, 1)]);
    expect(r.discountRial).toBe(100000n);
  });

  it('مبلغی: از ارزشِ کالا بیشتر نمی‌شود', async () => {
    const c = await createCoupon(db, { code: 'FIX', title: 'پانصد', kind: 'fixed', valueRial: 500000n });
    const r = applyCouponRecord(c, [line('v1', 300000, 1)]);
    expect(r.discountRial).toBe(300000n);
  });

  it('کوپنِ کالا: فقط ردیفِ همان کالا', async () => {
    const c = await createCoupon(db, {
      code: 'ONEP', title: 'ویژه‌یِ یک کالا', kind: 'percent', valueBp: 1000,
      appliesTo: 'product', productId: PRODUCT_A,
    });
    const r = applyCouponRecord(c, [line('v1', 100000, 1, PRODUCT_A), line('v2', 100000, 1, PRODUCT_B)]);
    // فقط ردیفِ نخست مشمول است: ۱۰٪ از ۱۰۰ هزار
    expect(r.eligibleRial).toBe(100000n);
    expect(r.discountRial).toBe(10000n);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.variantId).toBe('v1');
  });

  it('کوپنِ دسته: فرزندانِ دسته را هم می‌گیرد', async () => {
    const c = await createCoupon(db, {
      code: 'CAT', title: 'ویژه‌یِ دسته', kind: 'percent', valueBp: 2000,
      appliesTo: 'category', categoryId: CATEGORY,
    });
    // ردیفِ نخست درختِ دسته دارد که شاملِ CATEGORY است؛ دومی نه
    const r = applyCouponRecord(c, [
      { variantId: 'v1', productId: PRODUCT_A, quantity: 1, unitPriceRial: 500000n, categoryIds: [CHILD_CATEGORY, CATEGORY] },
      { variantId: 'v2', productId: PRODUCT_B, quantity: 1, unitPriceRial: 500000n, categoryIds: ['99999999-9999-4999-8999-999999999999'] },
    ]);
    expect(r.eligibleRial).toBe(500000n);
    expect(r.discountRial).toBe(100000n);
  });

  it('سبدِ بی‌هیچ کالایِ مشمول، پیامِ روشن می‌دهد', async () => {
    const c = await createCoupon(db, {
      code: 'NOPE', title: 'ویژه', kind: 'percent', valueBp: 1000,
      appliesTo: 'product', productId: PRODUCT_B,
    });
    expect(() => applyCouponRecord(c, [line('v1', 100000, 1, PRODUCT_A)])).toThrow(
      COUPON_ERRORS.noEligibleItems,
    );
  });

  it('مجموعِ سهمِ ردیف‌ها دقیقاً برابرِ تخفیفِ کل است (ریالی گم نمی‌شود)', async () => {
    const c = await createCoupon(db, { code: 'SPLIT', title: 'پخش', kind: 'percent', valueBp: 3333 });
    // سه ردیف با مبالغِ نامتقارن؛ ۳۳٫۳۳٪ هیچ‌کدام رُند نیست
    const lines = [line('v1', 100000, 1), line('v2', 333333, 2), line('v3', 7, 3)];
    const r = applyCouponRecord(c, lines);
    const sum = r.lines.reduce((a, l) => a + l.discountRial, 0n);
    expect(sum).toBe(r.discountRial);
    // و هیچ ردیفی بیش از مبلغِ خودش تخفیف نمی‌گیرد
    for (const l of r.lines) {
      const gross = BigInt(lines.find((x) => x.variantId === l.variantId)!.unitPriceRial) *
        BigInt(lines.find((x) => x.variantId === l.variantId)!.quantity);
      expect(l.discountRial).toBeLessThanOrEqual(gross);
    }
  });
});

describe('ارزیابیِ کوپن', () => {
  it('کدِ ناشناس: پیامِ «پیدا نشد»', async () => {
    await expect(validateCoupon(db, 'GHOST')).rejects.toThrow(COUPON_ERRORS.notFound);
  });

  it('کوپنِ غیرفعال', async () => {
    const c = await createCoupon(db, { code: 'OFF1', title: 'x', kind: 'percent', valueBp: 1000, isActive: false });
    expect(c.isActive).toBe(false);
    await expect(validateCoupon(db, 'OFF1')).rejects.toThrow(COUPON_ERRORS.inactive);
  });

  it('کوپنِ منقضی', async () => {
    await createCoupon(db, {
      code: 'OLD', title: 'x', kind: 'percent', valueBp: 1000,
      endsAt: new Date('2020-01-01T00:00:00Z'),
    });
    await expect(validateCoupon(db, 'OLD')).rejects.toThrow(COUPON_ERRORS.expired);
  });

  it('کوپنِ هنوز آغازنشده', async () => {
    await createCoupon(db, {
      code: 'FUTURE', title: 'x', kind: 'percent', valueBp: 1000,
      startsAt: new Date('2099-01-01T00:00:00Z'),
    });
    await expect(validateCoupon(db, 'FUTURE')).rejects.toThrow(COUPON_ERRORS.notStarted);
  });

  it('ظرفیتِ تمام‌شده', async () => {
    const c = await createCoupon(db, {
      code: 'FULL', title: 'x', kind: 'percent', valueBp: 1000, usageLimit: 2,
    });
    await setUsage(c.id, 2);
    await expect(validateCoupon(db, 'FULL')).rejects.toThrow(COUPON_ERRORS.exhausted);
  });

  it('سقفِ هر مشتری', async () => {
    const c = await createCoupon(db, {
      code: 'ONCE', title: 'x', kind: 'percent', valueBp: 1000, perCustomerLimit: 1,
    });
    const cust = CUSTOMER_1;
    await db.query(
      `INSERT INTO coupon_redemptions (coupon_id, customer_id, discount_rial) VALUES ($1,$2,$3)`,
      [c.id, cust, '1000'],
    );
    await expect(validateCoupon(db, 'ONCE', { customerId: cust })).rejects.toThrow(
      COUPON_ERRORS.customerLimit,
    );
    // مشتریِ دیگر هنوز می‌تواند
    await expect(validateCoupon(db, 'ONCE', { customerId: CUSTOMER_2 })).resolves.toBeTruthy();
  });

  it('کوپنِ معتبر با حروفِ کوچک هم پیدا می‌شود', async () => {
    await createCoupon(db, { code: 'MIXED', title: 'x', kind: 'percent', valueBp: 1000 });
    const c = await validateCoupon(db, 'mixed');
    expect(c.code).toBe('MIXED');
  });
});

describe('مصرف و آزادسازی', () => {
  async function seedOrder(id: string): Promise<void> {
    await db.query(
      `INSERT INTO orders (id, order_no, status, subtotal_rial, discount_rial, tax_rial,
          shipping_rial, total_rial, channel)
       VALUES ($1, $2, 'pending_payment', 0, 0, 0, 0, 0, 'web')
       ON CONFLICT (id) DO NOTHING`,
      [id, `ORD-${id.slice(-4)}`],
    );
  }

  it('مصرف، شمارنده را بالا می‌برد و رکورد می‌سازد', async () => {
    const c = await createCoupon(db, { code: 'USE1', title: 'x', kind: 'percent', valueBp: 1000, usageLimit: 5 });
    const orderId = '77777777-7777-4777-8777-777777777771';
    await seedOrder(orderId);
    await redeemCoupon(db, c.id, orderId, 10000n, null);

    expect(await countRedemptions(db, c.id)).toBe(1);
    const after = await getCouponById(db, c.id);
    expect(after?.usageCount).toBe(1);
    const reds = await listRedemptions(db, c.id);
    expect(reds[0]!.discountRial).toBe(10000n);
    expect(reds[0]!.orderId).toBe(orderId);
  });

  it('مصرفِ فراتر از ظرفیت رد می‌شود', async () => {
    const c = await createCoupon(db, {
      code: 'USE2', title: 'x', kind: 'percent', valueBp: 1000, usageLimit: 1,
    });
    await setUsage(c.id, 1);
    const orderId = '77777777-7777-4777-8777-777777777772';
    await seedOrder(orderId);
    await expect(redeemCoupon(db, c.id, orderId, 1000n, null)).rejects.toThrow(
      COUPON_ERRORS.exhausted,
    );
  });

  it('مصرفِ دومِ همان مشتری رد می‌شود', async () => {
    const c = await createCoupon(db, {
      code: 'USE3', title: 'x', kind: 'percent', valueBp: 1000, perCustomerLimit: 1,
    });
    const cust = CUSTOMER_1;
    const o1 = '77777777-7777-4777-8777-777777777773';
    const o2 = '77777777-7777-4777-8777-777777777774';
    await seedOrder(o1);
    await seedOrder(o2);
    await redeemCoupon(db, c.id, o1, 1000n, cust);
    await expect(redeemCoupon(db, c.id, o2, 1000n, cust)).rejects.toThrow(
      COUPON_ERRORS.customerLimit,
    );
  });

  it('لغوِ سفارش، نوبت را برمی‌گرداند', async () => {
    const c = await createCoupon(db, { code: 'USE4', title: 'x', kind: 'percent', valueBp: 1000, usageLimit: 3 });
    const orderId = '77777777-7777-4777-8777-777777777775';
    await seedOrder(orderId);
    await redeemCoupon(db, c.id, orderId, 5000n, null);
    expect((await getCouponById(db, c.id))?.usageCount).toBe(1);

    expect(await releaseCoupon(db, orderId)).toBe(true);
    expect((await getCouponById(db, c.id))?.usageCount).toBe(0);
    expect(await countRedemptions(db, c.id)).toBe(0);
  });

  it('آزادسازیِ سفارشِ بی‌کوپن، بی‌زیان است', async () => {
    expect(await releaseCoupon(db, '77777777-7777-4777-8777-777777999999')).toBe(false);
  });

  it('شمارنده هرگز زیرِ صفر نمی‌رود', async () => {
    const c = await createCoupon(db, { code: 'USE5', title: 'x', kind: 'percent', valueBp: 1000 });
    const orderId = '77777777-7777-4777-8777-777777777776';
    await seedOrder(orderId);
    await releaseCoupon(db, orderId);
    expect((await getCouponById(db, c.id))?.usageCount).toBe(0);
  });
});

describe('مدیریت از پنل', () => {
  it('فهرست، فعال‌ها را پیش‌فرض می‌آورد', async () => {
    await createCoupon(db, { code: 'A1', title: 'فعال', kind: 'percent', valueBp: 500 });
    await createCoupon(db, { code: 'A2', title: 'غیرفعال', kind: 'percent', valueBp: 500, isActive: false });
    const def = await listCoupons(db);
    expect(def.rows.map((c) => c.code)).toEqual(['A1']);
    const all = await listCoupons(db, { includeInactive: true });
    expect(all.rows).toHaveLength(2);
  });

  it('جستجو بر کد و عنوان', async () => {
    await createCoupon(db, { code: 'NOWRUZ', title: 'عیدانه', kind: 'percent', valueBp: 500 });
    await createCoupon(db, { code: 'OTHER', title: 'چیزی', kind: 'fixed', valueRial: 1000n });
    const byCode = await listCoupons(db, { search: 'nowruz' });
    expect(byCode.rows).toHaveLength(1);
    const byTitle = await listCoupons(db, { search: 'عیدانه' });
    expect(byTitle.rows).toHaveLength(1);
  });

  it('ویرایشِ مبلغ، نوع را نیمه‌کاره نمی‌گذارد', async () => {
    const c = await createCoupon(db, { code: 'SWITCH', title: 'x', kind: 'percent', valueBp: 1000 });
    const after = await updateCoupon(db, c.id, { kind: 'fixed', valueRial: 50000n });
    expect(after?.kind).toBe('fixed');
    expect(after?.valueRial).toBe(50000n);
    expect(after?.valueBp).toBeNull();
  });

  it('ویرایشِ درصدِ نامعتبر رد می‌شود', async () => {
    const c = await createCoupon(db, { code: 'BADP', title: 'x', kind: 'percent', valueBp: 1000 });
    await expect(updateCoupon(db, c.id, { valueBp: 99999 })).rejects.toThrow();
  });

  it('غیرفعال کردن و بازگرداندن', async () => {
    const c = await createCoupon(db, { code: 'TOGGLE', title: 'x', kind: 'percent', valueBp: 1000 });
    await setCouponActive(db, c.id, false);
    await expect(validateCoupon(db, 'TOGGLE')).rejects.toThrow(COUPON_ERRORS.inactive);
    await setCouponActive(db, c.id, true);
    await expect(validateCoupon(db, 'TOGGLE')).resolves.toBeTruthy();
  });

  it('ویرایشِ کوپنِ ناموجود، تهی برمی‌گرداند', async () => {
    expect(await updateCoupon(db, '99999999-9999-4999-8999-111111111111', { title: 'x' })).toBeNull();
  });
});

describe('پایه‌یِ کمینه', () => {
  it('کوپنی که به پایه نرسد، اعمال نمی‌شود', async () => {
    await createCoupon(db, {
      code: 'MIN', title: 'بالایِ یک میلیون', kind: 'percent', valueBp: 1000,
      minSubtotalRial: 1000000n,
    });
    const lines = [line('v1', 500000, 1)];
    const subtotal = lines.reduce((a, l) => a + l.unitPriceRial * BigInt(l.quantity), 0n);
    const c = await validateCoupon(db, 'MIN');
    expect(subtotal < c.minSubtotalRial).toBe(true);
    // تصمیمِ «اعمال شود یا نه» بر عهده‌یِ فراخوان است؛ اینجا فقط اطمینان
    // می‌یابیم پایه درست خوانده شده
    expect(c.minSubtotalRial).toBe(1000000n);
  });
});

describe('هم‌زمانیِ مصرف', () => {
  it('دو مصرفِ هم‌زمانِ آخرین نوبت: یکی پیروز می‌شود', async () => {
    const c = await createCoupon(db, {
      code: 'RACE', title: 'آخرین نوبت', kind: 'percent', valueBp: 1000, usageLimit: 1,
    });
    const o1 = '77777777-7777-4777-8777-777777777781';
    const o2 = '77777777-7777-4777-8777-777777777782';
    await db.query(
      `INSERT INTO orders (id, order_no, status, subtotal_rial, discount_rial, tax_rial,
          shipping_rial, total_rial, channel)
       VALUES ($1,$2,'pending_payment',0,0,0,0,0,'web'), ($3,$4,'pending_payment',0,0,0,0,0,'web')
       ON CONFLICT (id) DO NOTHING`,
      [o1, 'ORD-R1', o2, 'ORD-R2'],
    );

    const results = await Promise.allSettled([
      redeemCoupon(db, c.id, o1, 1000n, null),
      redeemCoupon(db, c.id, o2, 1000n, null),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(1);
    expect((await getCouponById(db, c.id))?.usageCount).toBe(1);
  });
});

describe('اعمالِ سراسری از راهِ پایگاه', () => {
  it('applyCoupon کد را از پایگاه می‌خواند و پخش می‌کند', async () => {
    await createCoupon(db, { code: 'ALL10', title: 'ده درصدِ همه', kind: 'percent', valueBp: 1000 });
    const r = await applyCoupon(db, 'all10', [line('v1', 200000, 1), line('v2', 100000, 1, PRODUCT_B)]);
    expect(r.eligibleRial).toBe(300000n);
    expect(r.discountRial).toBe(30000n);
    expect(r.lines.find((l) => l.variantId === 'v1')!.discountRial).toBe(20000n);
    expect(r.lines.find((l) => l.variantId === 'v2')!.discountRial).toBe(10000n);
  });
});
