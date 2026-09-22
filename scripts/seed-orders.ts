/**
 * نشاندنِ «سفارش‌هایِ نمونه» — برایِ این که خروجی و پنل، چیزی برای نشان دادن داشته باشند.
 *
 * چرا این اسکریپت لازم است؟
 *   کاتالوگ به‌تنهایی کافی نیست: گزارشِ فروش، فاکتور، کارتِ مشتری و سودِ
 *   ناخالص همگی «پس از فروش» معنا پیدا می‌کنند. بی‌سفارش، همه‌یِ این صفحه‌ها
 *   تهی‌اند و کسی نمی‌تواند درستیِ خروجیِ اکسل و پی‌دی‌اف را بسنجد — که
 *   بدترین حالت است: کدی که به‌ظاهر کار می‌کند چون هیچ‌وقت با داده اجرا
 *   نشده است.
 *
 * چه می‌سازد؟
 *   • چند مشتری (با کدِ ملی و تلفن)،
 *   • سفارش‌هایی در چهل و پنج روزِ گذشته با وضعیت‌هایِ گوناگون،
 *   • اقلامِ هر سفارش با قیمتِ لحظه‌یِ خرید (نه قیمتِ امروزِ کالا)،
 *   • پرداختِ موفق برایِ سفارش‌هایِ پرداخت‌شده،
 *   • و کاهشِ موجودی به اندازه‌یِ فروخته‌شده، تا انبار با فروش نخواند.
 *
 * اجرا:
 *   DB_URL="postgres://setshop@/setshop?host=/tmp/setshop-pgrun&port=5433" \
 *     npx tsx scripts/seed-orders.ts
 *
 * بی‌خطر برای اجرایِ دوباره: پیش از نشاندن، سفارش‌هایِ نمونه پاک می‌شوند؛
 * هر بار اجرا همان نتیجه را می‌دهد (اعدادِ تصادفی با یک بذرِ ثابت، تا
 * گزارش‌ها در دو اجرا یکی باشند).
 */

import { createDatabase } from '@set/db';

/* --------------------------- تولیدِ عددِ یکنواخت -------------------------- */

/**
 * یک موتورِ عددِ تصادفیِ ساده با بذرِ ثابت.
 *
 * چرا بذرِ ثابت؟ چون با `Math.random` هر بار اجرا عددهایِ متفاوت می‌ساخت و
 * مقایسه‌یِ دو خروجی (مثلاً برایِ دیدنِ تفاوتِ یک اصلاح) ناممکن می‌شد.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // ضرب‌کننده و افزایشِ پیشنهادیِ Numerical Recipes
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const random = seededRandom(14050626);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
const between = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));

/* --------------------------------- داده ---------------------------------- */

const CUSTOMERS = [
  { phone: '09151001001', name: 'علی رضایی', nationalId: '0012345678', kind: 'online' },
  { phone: '09151001002', name: 'زهرا محمدی', nationalId: '0012345679', kind: 'online' },
  { phone: '09151001003', name: 'حسین کریمی', nationalId: '0012345680', kind: 'in_person' },
  { phone: '09151001004', name: 'سارا احمدی', nationalId: '0012345681', kind: 'online' },
  { phone: '09151001005', name: 'محمد رستمی', nationalId: '0012345682', kind: 'online' },
  { phone: '09151001006', name: 'فاطمه قاسمی', nationalId: '0012345683', kind: 'online' },
] as const;

/** وضعیت‌هایی که «پول گرفته شده» معنا می‌دهند */
const PAID_STATUSES = ['paid', 'processing', 'shipped', 'delivered'] as const;

const STATUS_PLAN: Array<{ status: string; share: number }> = [
  { status: 'delivered', share: 5 },
  { status: 'shipped', share: 3 },
  { status: 'processing', share: 3 },
  { status: 'paid', share: 3 },
  { status: 'pending_payment', share: 3 },
  { status: 'cancelled', share: 2 },
];

const VAT_PERCENT = 9;

/* --------------------------------- برنامه -------------------------------- */

async function main(): Promise<void> {
  const url = process.env.DB_URL ?? 'memory://';
  if (url === 'memory://') {
    console.error('DB_URL تعیین نشده است. نمونه: postgres://setshop@/setshop?host=/tmp/setshop-pgrun&port=5433');
    process.exit(2);
  }

  const db = createDatabase(url);

  try {
    /* ۰. پاک‌سازیِ نمونه‌هایِ پیشین — تا اجرایِ دوباره داده را دوبرابر نکند */
    await db.query(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE order_no LIKE 'SET-%')`);
    await db.query(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_no LIKE 'SET-%')`);
    await db.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE order_no LIKE 'SET-%')`);
    await db.query(`DELETE FROM orders WHERE order_no LIKE 'SET-%'`);
    await db.query(`DELETE FROM customers WHERE phone LIKE '09151001%'`);

    /* ۱. موجودیِ پایه — فروش از انبار کم می‌شود، پس نخست آن را پر می‌کنیم */
    await db.query(
      `UPDATE stock_items SET on_hand = GREATEST(on_hand, $1), reserved = 0, updated_at = now()`,
      [120],
    );

    /* ۲. مشتریان */
    for (const customer of CUSTOMERS) {
      await db.query(
        `INSERT INTO customers (phone, full_name, national_id, kind, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name, national_id = EXCLUDED.national_id`,
        [customer.phone, customer.name, customer.nationalId, customer.kind],
      );
    }
    console.log(`مشتریان: ${CUSTOMERS.length}`);

    /* ۳. کالاهایِ قابلِ فروش */
    const { rows: variants } = await db.query<{ id: string; sku: string; price_rial: string; title: string }>(
      `SELECT v.id, v.sku, v.price_rial::text, p.title
         FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.is_active = true
        ORDER BY v.sku`,
    );
    if (variants.length === 0) {
      console.error('هیچ تنوعِ فعالی در کاتالوگ نیست؛ نخست `npm run seed:showcase` را اجرا کنید.');
      process.exit(1);
    }

    /* ۴. سفارش‌ها در چهل و پنج روزِ گذشته */
    const statuses: string[] = [];
    for (const plan of STATUS_PLAN) {
      for (let i = 0; i < plan.share; i += 1) statuses.push(plan.status);
    }

    let orderSerial = 1000;
    let createdOrders = 0;
    let createdItems = 0;
    let revenueRial = 0n;

    for (const status of statuses) {
      orderSerial += 1;
      const daysAgo = between(0, 44);
      const createdAt = new Date(Date.now() - daysAgo * 24 * 3600 * 1000 - between(0, 23) * 3600 * 1000);
      const customer = pick(CUSTOMERS);
      const channel = status === 'pending_payment' ? 'web' : pick(['web', 'web', 'pos', 'phone'] as const);
      const paid = PAID_STATUSES.includes(status as (typeof PAID_STATUSES)[number]);

      const lineCount = between(1, 3);
      const lines = Array.from({ length: lineCount }, () => {
        const variant = pick(variants);
        const quantity = between(1, 3);
        const unitPrice = BigInt(variant.price_rial);
        const discount = random() < 0.35 ? (unitPrice * BigInt(quantity) * BigInt(between(5, 20))) / 100n : 0n;
        const net = unitPrice * BigInt(quantity) - discount;
        const tax = (net * BigInt(VAT_PERCENT)) / 100n;
        return {
          variantId: variant.id,
          title: variant.title,
          quantity,
          unitPrice,
          discount,
          tax,
          total: net + tax,
        };
      });

      const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * BigInt(line.quantity), 0n);
      const discount = lines.reduce((sum, line) => sum + line.discount, 0n);
      const tax = lines.reduce((sum, line) => sum + line.tax, 0n);
      const shipping = channel === 'web' ? BigInt(between(0, 1) === 1 ? 550000 : 0) : 0n;
      const total = subtotal - discount + tax + shipping;

      const orderNo = `SET-1405-${orderSerial}`;
      const { rows: inserted } = await db.query<{ id: string }>(
        `INSERT INTO orders
           (order_no, user_id, channel, status, subtotal_rial, discount_rial, tax_rial, shipping_rial,
            total_rial, created_at, paid_at, customer_name, customer_mobile, shipping_address)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [
          orderNo,
          channel,
          status,
          subtotal.toString(),
          discount.toString(),
          tax.toString(),
          shipping.toString(),
          total.toString(),
          createdAt.toISOString(),
          paid ? new Date(createdAt.getTime() + 6 * 60 * 1000).toISOString() : null,
          customer.name,
          customer.phone,
          JSON.stringify({
            province: 'تهران',
            city: 'تهران',
            address: 'خیابانِ نمونه، کوچه‌یِ ۱۲، پلاک ۳۴',
            postalCode: '1234567890',
            receiverName: customer.name,
            receiverPhone: customer.phone,
          }),
        ],
      );
      const orderId = inserted[0]!.id;

      for (const line of lines) {
        await db.query(
          `INSERT INTO order_items (order_id, variant_id, quantity, unit_price_rial, discount_rial, tax_rial, total_rial)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            orderId,
            line.variantId,
            line.quantity,
            line.unitPrice.toString(),
            line.discount.toString(),
            line.tax.toString(),
            line.total.toString(),
          ],
        );
        createdItems += 1;

        // موجودی: فروخته‌شده از انبار کم می‌شود (سفارشِ لغوشده نه)
        if (status !== 'cancelled') {
          await db.query(
            `UPDATE stock_items SET on_hand = GREATEST(on_hand - $2, 0), updated_at = now() WHERE variant_id = $1`,
            [line.variantId, line.quantity],
          );
        }
      }

      await db.query(
        `INSERT INTO order_status_history (order_id, from_status, to_status, reason)
         VALUES ($1, NULL, $2, $3)`,
        [orderId, status, 'داده‌یِ نمونه'],
      );

      if (paid) {
        await db.query(
          `INSERT INTO payments (order_id, amount_rial, method, status, reference_no, created_at)
           VALUES ($1, $2, $3, 'success', $4, $5)`,
          [
            orderId,
            total.toString(),
            channel === 'pos' ? 'cash' : 'sandbox',
            `PAY-${orderSerial}${between(100000, 999999)}`,
            new Date(createdAt.getTime() + 6 * 60 * 1000).toISOString(),
          ],
        );
        revenueRial += total;
      }

      createdOrders += 1;
    }

    /* ۵. گزارش */
    const { rows: totals } = await db.query<{ orders: string; items: string; revenue: string }>(
      `SELECT (SELECT COUNT(*) FROM orders)::text AS orders,
              (SELECT COUNT(*) FROM order_items)::text AS items,
              (SELECT COALESCE(SUM(total_rial), 0) FROM orders WHERE paid_at IS NOT NULL)::text AS revenue`,
    );

    console.log(
      `سفارش‌ها: ${createdOrders} (${createdItems} قلم) — درآمدِ پرداخت‌شده: ${totals[0]?.revenue ?? '0'} ریال`,
    );
    console.log(`پایگاه: ${totals[0]?.orders ?? '0'} سفارش و ${totals[0]?.items ?? '0'} قلم سفارش دارد.`);
  } finally {
    await db.close?.();
  }
}

void main();
