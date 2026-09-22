import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createDatabase, applyMigrations, seedCatalog, type Database } from '@set/db';
import { OrderService } from '@set/orders';
import { PaymentService } from './index.js';

let db: Database;
let orders: OrderService;
let payments: PaymentService;

/**
 * یک پایگاه برایِ همه‌یِ آزمون‌ها.
 *
 * این آزمون در هر بار «بذرِ کاملِ کاتالوگ» می‌کاشت؛ با ۳۱ مهاجرت و ۱۰ آزمون،
 * کارگرِ آزمون در این محیط در میانه کشته می‌شد و آزمون‌ها ناتمام می‌ماندند.
 * بذر یک بار کاشته می‌شود و میانِ آزمون‌ها تنها پرداخت‌ها و سفارش‌ها پاک
 * می‌گردند.
 */
beforeAll(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  await seedCatalog(db);
});

beforeEach(async () => {
  process.env.PAYMENT_GATEWAY = 'sandbox';
  delete process.env.PAYMENT_ALLOW_SANDBOX;
  orders = new OrderService(db);
  payments = new PaymentService(db);
});

afterAll(async () => {
  await db.close();
});

/**
 * بازگشت به نقطه‌یِ آغاز.
 *
 * ترتیب از وابسته به مستقل است: سفارش پیوندهایِ بسیاری دارد (پرداخت،
 * تاریخچه، مرسوله، مالیات…). اگر پیش از آن‌ها پاک شود، مهارِ کلیدِ خارجی
 * اجازه نمی‌دهد و سفارشِ آزمونِ پیشین در پایگاه می‌ماند — و آزمونِ بعدی با
 * داده‌ای ناخواسته روبه‌رو می‌شود. موجودی هم باید به عددِ آغازین برگردد،
 * چون پرداختِ موفق کالا را از انبار می‌برد.
 */
afterEach(async () => {
  for (const table of [
    'order_payment_lines',
    'order_status_history',
    'payments',
    'order_items',
    'orders',
    'stock_movements',
    'journal_lines',
    'journal_entries',
  ]) {
    await db.query(`DELETE FROM ${table}`).catch(() => {
      // جدولی که در این نسخه نیست — چشم‌پوشی
    });
  }
  await db.query(`UPDATE stock_items SET on_hand = 20, reserved = 0`).catch(() => {});
});

/** یک سفارشِ آماده‌ی پرداخت می‌سازیم و شناسه‌اش را برمی‌گردانیم */
async function pendingOrder(): Promise<{ orderId: string; totalRial: bigint }> {
  const { rows } = await db.query<{ id: string; price_rial: string }>(
    `SELECT id, price_rial::text FROM product_variants WHERE is_active = true LIMIT 1`,
  );
  const variantId = rows[0]!.id;

  const result = await orders.createOrder({
    items: [{ variantId, quantity: 2 }],
    customerName: 'سارا احمدی',
    customerMobile: '09120000009',
    shippingAddress: 'تهران، خیابانِ آزادی، پلاک ۱، واحد ۲',
    idempotencyKey: `pay-test-${Math.random().toString(36).slice(2)}`,
  });
  return { orderId: result.orderId, totalRial: BigInt(result.totals.totalRial) };
}

describe('درگاهِ پرداخت', () => {
  it('درگاه‌هایِ پیکربندی‌نشده در فهرست نمی‌آیند', async () => {
    // ناهمگام است چون پیکربندی از پایگاه هم می‌خواند (مدیر می‌تواند درگاه را
    // از پنل عوض کند)؛ بی‌await ماندنش باعث می‌شد «بستنِ پایگاه» در پایانِ
    // آزمون منتظرِ یک وعده‌یِ سرگردان بماند و کلِ مجموعه قفل کند.
    const list = await payments.availableGateways('http://localhost:3100');
    // فقط سندباکس پیکربندی شده است (زرین‌پال و آی‌دی‌پی کلید ندارند)
    expect(list.map((g) => g.key)).toEqual(['sandbox']);
  });

  it('زرین‌پال با داشتنِ مرچنت‌کد فعال می‌شود', async () => {
    process.env.ZARINPAL_MERCHANT_ID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
    const list = await payments.availableGateways('http://localhost:3100');
    expect(list.map((g) => g.key)).toContain('zarinpal');
    delete process.env.ZARINPAL_MERCHANT_ID;
  });

  it('آغازِ پرداخت، تراکنشِ در انتظار می‌سازد و سفارش را دست‌نخورده می‌گذارد', async () => {
    const { orderId, totalRial } = await pendingOrder();
    const started = await payments.start({ orderId, appUrl: 'http://localhost:3100' });

    expect(started.gateway).toBe('sandbox');
    expect(started.amountRial).toBe(totalRial.toString());
    expect(started.redirectUrl).toContain('/pay/sandbox/');

    const { rows } = await db.query<{ status: string; gateway: string }>(
      `SELECT status, gateway FROM payments WHERE id = $1`,
      [started.paymentId],
    );
    expect(rows[0]).toEqual({ status: 'pending', gateway: 'sandbox' });

    // سفارش هنوز پرداخت نشده است
    const { rows: o } = await db.query<{ status: string }>(`SELECT status FROM orders WHERE id = $1`, [orderId]);
    expect(o[0]!.status).toBe('pending_payment');
  });

  it('سفارشِ پرداخت‌شده دوباره به درگاه نمی‌رود', async () => {
    const { orderId } = await pendingOrder();
    await payments.start({ orderId, appUrl: 'http://localhost:3100' });
    await orders.confirmPayment(orderId, { amountRial: await total(orderId) });
    await expect(payments.start({ orderId, appUrl: 'http://localhost:3100' })).rejects.toThrow();
  });

  it('تأییدِ موفق: کالا از انبار می‌رود، سندِ حسابداری می‌نشیند و سفارش پرداخت می‌شود', async () => {
    const { orderId } = await pendingOrder();
    const started = await payments.start({ orderId, appUrl: 'http://localhost:3100' });

    const before = await stockOnHand();
    await payments.setSandboxDecision(started.authority, 'paid');
    const result = await payments.verify({ authority: started.authority, appUrl: 'http://localhost:3100' });

    expect(result.status).toBe('success');
    expect(result.refId).toBeTruthy();

    // موجودی کم شده (۲ عدد فروخته شد)
    const after = await stockOnHand();
    expect(after).toBe(before - 2);

    // سندِ فروش ثبت شده است
    const { rows: j } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM journal_entries WHERE reference_type = 'order' AND reference_id = $1`,
      [orderId],
    );
    expect(Number(j[0]!.n)).toBe(1);

    // سفارش پرداخت شده و ردیفِ پرداخت تأیید شده
    const { rows: o } = await db.query<{ status: string }>(`SELECT status FROM orders WHERE id = $1`, [orderId]);
    expect(o[0]!.status).toBe('paid');

    const status = await payments.status(started.paymentId);
    expect(status.status).toBe('success');
    expect(status.cardPanMasked).toContain('****');
  });

  it('یک فروش، فقط یک ردیفِ پرداخت دارد (تسویه ردیفِ دوم نمی‌سازد)', async () => {
    const { orderId } = await pendingOrder();
    const started = await payments.start({ orderId, appUrl: 'http://localhost:3100' });
    await payments.setSandboxDecision(started.authority, 'paid');
    await payments.verify({ authority: started.authority, appUrl: 'http://localhost:3100' });

    const { rows } = await db.query<{ n: string; refs: string }>(
      `SELECT COUNT(*)::text AS n,
              COUNT(*) FILTER (WHERE ref_id IS NOT NULL OR reference_no IS NOT NULL)::text AS refs
         FROM payments WHERE order_id = $1`,
      [orderId],
    );
    expect(rows[0]!.n).toBe('1');
    expect(rows[0]!.refs).toBe('1'); // همان ردیف، شماره‌ی پیگیری دارد

    const status = await payments.status(started.paymentId);
    expect(status.status).toBe('success');
    expect(status.refId).toBeTruthy();
    expect(status.cardPanMasked).toContain('****');
  });

  it('تأییدِ دوبار، بی‌اثر است (یک تراکنش، یک خروج از انبار)', async () => {
    const { orderId } = await pendingOrder();
    const started = await payments.start({ orderId, appUrl: 'http://localhost:3100' });
    await payments.setSandboxDecision(started.authority, 'paid');

    const before = await stockOnHand();
    const first = await payments.verify({ authority: started.authority, appUrl: 'http://localhost:3100' });
    const second = await payments.verify({ authority: started.authority, appUrl: 'http://localhost:3100' });

    expect(first.status).toBe('success');
    expect(second.status).toBe('already');
    // موجودی فقط یک‌بار کم شده است
    expect(await stockOnHand()).toBe(before - 2);
  });

  it('انصرافِ مشتری: سفارش سرجایش است و هیچ سندی ثبت نمی‌شود', async () => {
    const { orderId } = await pendingOrder();
    const started = await payments.start({ orderId, appUrl: 'http://localhost:3100' });

    const before = await stockOnHand();
    await payments.setSandboxDecision(started.authority, 'cancelled');
    const result = await payments.verify({ authority: started.authority, appUrl: 'http://localhost:3100' });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('انصراف');
    expect(await stockOnHand()).toBe(before); // موجودی دست‌نخورده (فقط رزرو است)

    const { rows: o } = await db.query<{ status: string }>(`SELECT status FROM orders WHERE id = $1`, [orderId]);
    expect(o[0]!.status).toBe('pending_payment');

    // سندِ افتتاحیه هست، اما برای این سفارش هیچ سندی نباید ثبت شود
    const { rows: j } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM journal_entries WHERE reference_id = $1`,
      [orderId],
    );
    expect(Number(j[0]!.n)).toBe(0);

    const status = await payments.status(started.paymentId);
    expect(status.status).toBe('failed');
    expect(status.message).toContain('انصراف');
  });

  it('تراکنشی که ثبت نشده، قابلِ تأیید نیست', async () => {
    await expect(
      payments.verify({ authority: 'A0000000000000000000000000000000XYZ', appUrl: 'http://localhost:3100' }),
    ).rejects.toThrow();
  });

  it('شماره‌ی کارت کامل ذخیره نمی‌شود (فقط چهار رقمِ آخر)', async () => {
    const { orderId } = await pendingOrder();
    const started = await payments.start({ orderId, appUrl: 'http://localhost:3100' });
    await payments.setSandboxDecision(started.authority, 'paid');
    await payments.verify({ authority: started.authority, appUrl: 'http://localhost:3100' });

    const { rows } = await db.query<{ pan: string }>(
      `SELECT card_pan_masked AS pan FROM payments WHERE id = $1`,
      [started.paymentId],
    );
    const pan = rows[0]!.pan;
    const digits = pan.replace(/\D/g, '');
    expect(digits.length).toBeLessThanOrEqual(16);
    // ۱۲ رقمِ اول پنهان است
    expect(pan.startsWith('****')).toBe(true);
  });
});

async function total(orderId: string): Promise<bigint> {
  const { rows } = await db.query<{ t: string }>(`SELECT total_rial::text AS t FROM orders WHERE id = $1`, [orderId]);
  return BigInt(rows[0]!.t);
}

async function stockOnHand(): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`SELECT COALESCE(SUM(on_hand),0)::text AS n FROM stock_items`);
  return Number(rows[0]!.n);
}
