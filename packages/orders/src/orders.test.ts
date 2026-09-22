import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, applyMigrations, seedCatalog, type Database } from '@set/db';
import { availableQuantity, releaseExpiredReservations } from '@set/inventory';
import { OrderService, effectiveVatBasisPoints } from './index.js';

let db: Database;
let orders: OrderService;
let warehouseId: string;
let caseVariantId: string; // قابِ آیفون ۱۳ پرو

beforeEach(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  await seedCatalog(db);
  orders = new OrderService(db);
  const { rows: w } = await db.query<{ id: string }>(`SELECT id FROM warehouses LIMIT 1`);
  warehouseId = w[0]!.id;
  const { rows: v } = await db.query<{ id: string }>(
    `SELECT id FROM product_variants WHERE sku = 'CS-13P-BLK'`,
  );
  caseVariantId = v[0]!.id;
  // موجودی را برای تست قطعی می‌کنیم
  await db.query(`UPDATE stock_items SET on_hand = 5, reserved = 0 WHERE variant_id = $1`, [caseVariantId]);
});

afterEach(async () => db.close());

describe('ایجاد سفارش', () => {
  it('جمع و مالیات درست محاسبه می‌شود (تخفیف پیش از مالیات)', async () => {
    const order = await orders.createOrder({
      items: [{ variantId: caseVariantId, quantity: 2 }],
      vatBasisPoints: 900,
      shippingRial: 50_000n,
    });

    // قیمتِ واحد ۲٬۵۵۰٬۰۰۰ ریال → ناخالص ۵٬۱۰۰٬۰۰۰
    expect(order.totals.subtotalRial).toBe('5100000');
    expect(order.totals.taxRial).toBe('459000'); // ۹٪
    expect(order.totals.shippingRial).toBe('50000');
    expect(order.totals.totalRial).toBe('5609000');
    expect(order.status).toBe('pending_payment');
  });

  it('شماره‌ی سفارش با سالِ شمسی صادر می‌شود', async () => {
    const order = await orders.createOrder({ items: [{ variantId: caseVariantId, quantity: 1 }] });
    expect(order.orderNo).toMatch(/^ORD-\d{4}-\d{6}$/);
  });

  it('رزرو، موجودیِ قابل فروش را کم می‌کند (بدون خروجِ واقعی از انبار)', async () => {
    const before = await availableQuantity(db, caseVariantId, warehouseId);
    await orders.createOrder({ items: [{ variantId: caseVariantId, quantity: 2 }] });
    const after = await availableQuantity(db, caseVariantId, warehouseId);
    expect(before).toBe(5);
    expect(after).toBe(3);

    const { rows } = await db.query<{ on_hand: number }>(
      `SELECT on_hand FROM stock_items WHERE variant_id = $1`, [caseVariantId],
    );
    expect(rows[0]!.on_hand).toBe(5); // هنوز از انبار خارج نشده
  });

  it('کلیدِ یکتایی از سفارشِ تکراری جلوگیری می‌کند', async () => {
    const first = await orders.createOrder({
      items: [{ variantId: caseVariantId, quantity: 1 }],
      idempotencyKey: 'checkout-abc-123',
    });
    const second = await orders.createOrder({
      items: [{ variantId: caseVariantId, quantity: 1 }],
      idempotencyKey: 'checkout-abc-123',
    });

    expect(second.duplicate).toBe(true);
    expect(second.orderId).toBe(first.orderId);
    expect(await availableQuantity(db, caseVariantId, warehouseId)).toBe(4); // فقط یک بار رزرو شد
  });
});

describe('جلوگیری از فروشِ بیش از موجودی (هدفِ U6)', () => {
  it('هشت سفارشِ همزمان برای موجودیِ ۵ عددی: فقط ۵ تا موفق می‌شوند', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        orders.createOrder({ items: [{ variantId: caseVariantId, quantity: 1 }] }),
      ),
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(ok).toHaveLength(5);
    expect(failed).toHaveLength(3);
    expect(await availableQuantity(db, caseVariantId, warehouseId)).toBe(0);

    const codes = failed.map(
      (f) => (f as PromiseRejectedResult).reason as { code?: string; details?: { available?: number } },
    );
    expect(codes.every((e) => e.code === 'ERR-006')).toBe(true);
    expect(codes.every((e) => e.details?.available === 0)).toBe(true);
  });

  it('موجودی هرگز منفی نمی‌شود، حتی زیر فشارِ همزمانِ بالا', async () => {
    await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        orders.createOrder({
          items: [{ variantId: caseVariantId, quantity: i % 3 === 0 ? 2 : 1 }],
        }),
      ),
    );
    const { rows } = await db.query<{ bad: number }>(
      `SELECT COUNT(*)::int AS bad FROM stock_items WHERE on_hand < 0 OR reserved > on_hand`,
    );
    expect(rows[0]!.bad).toBe(0);
  });
});

describe('انصراف و انقضا', () => {
  it('انصراف، رزرو را آزاد می‌کند تا کالا دوباره قابل فروش شود', async () => {
    const order = await orders.createOrder({ items: [{ variantId: caseVariantId, quantity: 5 }] });
    expect(await availableQuantity(db, caseVariantId, warehouseId)).toBe(0);

    await orders.cancel(order.orderId, 'customer_request');

    expect(await availableQuantity(db, caseVariantId, warehouseId)).toBe(5);
    const detail = await orders.getOrder(order.orderId);
    expect(detail!.status).toBe('cancelled');
    expect(detail!.cancel_reason).toBe('customer_request');
  });

  it('سفارش‌هایی که مهلتِ پرداختشان گذشته، خودکار آزاد می‌شوند', async () => {
    await orders.createOrder({
      items: [{ variantId: caseVariantId, quantity: 3 }],
      reservationMinutes: 0,
    });
    // مهلتِ صفر یعنی بلافاصله منقضی
    await db.query(`UPDATE orders SET reservation_expires_at = now() - interval '1 minute'`);

    const released = await releaseExpiredReservations(db, warehouseId);
    expect(released).toBe(1);
    expect(await availableQuantity(db, caseVariantId, warehouseId)).toBe(5);
  });
});

describe('نشتِ رزرو (بدهبستانِ موجودی در برابرِ سفارش‌هایِ باز)', () => {
  /**
   * چرا این آزمون اضافه شد؟ چون در آزمونِ بارِ نوشتن (۱٬۳۰۹ سفارش در ۴۰ ثانیه)
   * همان را با دست آزمودیم: «موجودیِ رزروشده» باید **دقیقاً** مجموعِ آرایه‌های
   * سفارش‌هایِ در انتظارِ پرداخت باشد. اگر روزی لغو/انقضا رزرو را آزاد نکند،
   * انبار قفل می‌ماند و هیچ خطایی هم نمی‌بینیم — کالا «هست» ولی «قابلِ فروش
   * نیست». هیچ آزمونِ دیگری این بدهبستان را نمی‌سنجید (فقط `reserved > on_hand`).
   */
  async function invariantHolds(): Promise<boolean> {
    const { rows } = await db.query<{ bad: number }>(
      `SELECT COUNT(*)::int AS bad
         FROM stock_items s
         JOIN LATERAL (
           SELECT COALESCE(SUM(oi.quantity), 0)::int AS open_qty
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
            WHERE o.status = 'pending_payment'
              AND o.reservation_expires_at > now()
              AND oi.variant_id = s.variant_id
         ) q ON true
        WHERE s.reserved IS DISTINCT FROM q.open_qty`,
    );
    return rows[0]!.bad === 0;
  }

  it('رزرو = مجموعِ سفارش‌هایِ باز؛ پس ازِ لغو و پس ازِ انقضا هم', async () => {
    const a = await orders.createOrder({ items: [{ variantId: caseVariantId, quantity: 2 }] });
    const b = await orders.createOrder({ items: [{ variantId: caseVariantId, quantity: 1 }] });
    expect(await invariantHolds()).toBe(true);
    expect(await availableQuantity(db, caseVariantId, warehouseId)).toBe(2);

    await orders.cancel(b.orderId, 'customer_request');
    expect(await invariantHolds()).toBe(true);
    expect(await availableQuantity(db, caseVariantId, warehouseId)).toBe(3);

    // مهلتِ «a» را می‌رسانیم و کارگرِ آزادسازی را اجرا می‌کنیم
    await db.query(`UPDATE orders SET reservation_expires_at = now() - interval '1 minute' WHERE id = $1`, [
      a.orderId,
    ]);
    const released = await releaseExpiredReservations(db, warehouseId);
    expect(released).toBe(1);
    expect(await invariantHolds()).toBe(true);
    expect(await availableQuantity(db, caseVariantId, warehouseId)).toBe(5);
  });

  it('زیرِ بارِ نوشتنِ همزمان، رزرو نه دو‌بار می‌شود نه گم', async () => {
    await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        orders.createOrder({ items: [{ variantId: caseVariantId, quantity: (i % 2) + 1 }] }),
      ),
    );
    expect(await invariantHolds()).toBe(true);
    // موجودیِ این تست ۵ است؛ پس حداکثر پنج «رزرو» نشسته، نه دوازده‌تا
    const { rows } = await db.query<{ reserved: number }>(
      `SELECT reserved FROM stock_items WHERE variant_id = $1`, [caseVariantId],
    );
    expect(rows[0]!.reserved).toBeLessThanOrEqual(5);
    expect(await availableQuantity(db, caseVariantId, warehouseId)).toBe(0);
  });
});

describe('تأیید پرداخت', () => {
  it('پس از پرداخت، کالا واقعاً از انبار خارج می‌شود و حرکت ثبت می‌گردد', async () => {
    const order = await orders.createOrder({ items: [{ variantId: caseVariantId, quantity: 2 }] });

    await orders.confirmPayment(order.orderId, { amountRial: BigInt(order.totals.totalRial) });

    const { rows } = await db.query<{ on_hand: number; reserved: number }>(
      `SELECT on_hand, reserved FROM stock_items WHERE variant_id = $1`, [caseVariantId],
    );
    expect(rows[0]!.on_hand).toBe(3);
    expect(rows[0]!.reserved).toBe(0);

    const { rows: movements } = await db.query<{ reason: string; quantity: number }>(
      `SELECT reason, quantity FROM stock_movements WHERE reference_id = $1`, [order.orderId],
    );
    expect(movements).toEqual([{ reason: 'sale', quantity: -2 }]);
  });

  it('مبلغِ پرداختی باید دقیقاً برابرِ مبلغِ سفارش باشد', async () => {
    const order = await orders.createOrder({ items: [{ variantId: caseVariantId, quantity: 1 }] });
    await expect(
      orders.confirmPayment(order.orderId, { amountRial: 1n }),
    ).rejects.toMatchObject({ code: 'ERR-007' });
  });

  it('تأییدِ دوباره پذیرفته نمی‌شود', async () => {
    const order = await orders.createOrder({ items: [{ variantId: caseVariantId, quantity: 1 }] });
    await orders.confirmPayment(order.orderId, { amountRial: BigInt(order.totals.totalRial) });
    await expect(
      orders.confirmPayment(order.orderId, { amountRial: BigInt(order.totals.totalRial) }),
    ).rejects.toMatchObject({ code: 'ERR-005' });
  });
});

describe('پیوندِ فروش با حسابداری', () => {
  it('با تأییدِ پرداخت، سندِ فروش به‌طورِ خودکار ثبت می‌شود', async () => {
    const order = await orders.createOrder({
      items: [{ variantId: caseVariantId, quantity: 2 }],
      vatBasisPoints: 900,
      shippingRial: 50_000n,
    });
    await orders.confirmPayment(order.orderId, { amountRial: BigInt(order.totals.totalRial) });

    const { rows } = await db.query<{ entry_no: string; description: string }>(
      `SELECT entry_no, description FROM journal_entries WHERE reference_id = $1`,
      [order.orderId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toContain(order.orderNo);
  });

  it('درآمد در دفترکل برابرِ خالصِ فروش است (مالیات جدا ثبت می‌شود)', async () => {
    const order = await orders.createOrder({
      items: [{ variantId: caseVariantId, quantity: 2 }],
      vatBasisPoints: 900,
      shippingRial: 50_000n,
    });
    await orders.confirmPayment(order.orderId, { amountRial: BigInt(order.totals.totalRial) });

    const { rows } = await db.query<{ code: string; debit: string; credit: string }>(
      `SELECT a.code, SUM(jl.debit_rial)::text AS debit, SUM(jl.credit_rial)::text AS credit
         FROM journal_lines jl
         JOIN accounts a ON a.id = jl.account_id
         JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.reference_id = $1
        GROUP BY a.code`,
      [order.orderId],
    );
    const by = (code: string) => rows.find((r) => r.code === code)!;

    // خالص ۵٬۱۰۰٬۰۰۰ + حمل ۵۰٬۰۰۰ = ۵٬۱۵۰٬۰۰۰ درآمد
    expect(by('4000').credit).toBe('5150000');
    expect(by('2100').credit).toBe('459000'); // ۹٪ ارزش افزوده
    expect(by('1200').debit).toBe('5609000'); // پرداختِ آنلاین به بانک
    // جمعِ بدهکار و بستانکارِ سند برابر است
    const debit = rows.reduce((a, r) => a + BigInt(r.debit), 0n);
    const credit = rows.reduce((a, r) => a + BigInt(r.credit), 0n);
    expect(debit).toBe(credit);
  });
});

describe('نرخِ ارزش‌افزوده', () => {
  /**
   * چرا این آزمون؟ چون نرخِ مالیات در سه جایِ کد ثابت نوشته شده بود (سبد،
   * سفارش، فروشِ حضوری) و تنظیمِ پنل رویِ هیچ‌کدام اثر نداشت. یعنی مشتری یک
   * عدد می‌دید و سامانه عددِ دیگری در فاکتورِ مؤدیان می‌نوشت. این آزمون
   * میخکوب می‌کند که تصمیم یک‌جاست: از تنظیمات.
   */
  it('نرخ از تنظیماتِ پنل می‌آید، نه از یک عددِ چسبانده‌شده در کد', async () => {
    await db.query(
      `INSERT INTO store_settings (key, value) VALUES ('vat_rate_percent', '10')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );

    const order = await orders.createOrder({ items: [{ variantId: caseVariantId, quantity: 2 }] });

    // ناخالص ۵٬۱۰۰٬۰۰۰ ریال → ۱۰٪ یعنی ۵۱۰٬۰۰۰ (نه ۴۵۹٬۰۰۰ که حاصلِ ۹٪ بود)
    expect(order.totals.subtotalRial).toBe('5100000');
    expect(order.totals.taxRial).toBe('510000');
  });

  it('بی‌تنظیم، پیش‌فرضِ ۹٪ برقرار است (قانونِ فعلی)', async () => {
    const order = await orders.createOrder({ items: [{ variantId: caseVariantId, quantity: 2 }] });
    expect(order.totals.taxRial).toBe('459000');
  });

  it('نرخِ صریح در درخواست بر تنظیمات مقدم است (برایِ سفارش‌هایِ بازسازی‌شده)', async () => {
    await db.query(
      `INSERT INTO store_settings (key, value) VALUES ('vat_rate_percent', '10')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    const order = await orders.createOrder({
      items: [{ variantId: caseVariantId, quantity: 2 }],
      vatBasisPoints: 900,
    });
    expect(order.totals.taxRial).toBe('459000');
  });

  it('مقدارِ نامعتبر در تنظیمات، سفارش را خراب نمی‌کند (پیش‌فرض)', async () => {
    await db.query(
      `INSERT INTO store_settings (key, value) VALUES ('vat_rate_percent', 'نه-عدد')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    expect(await effectiveVatBasisPoints(db)).toBe(900);
  });
});
