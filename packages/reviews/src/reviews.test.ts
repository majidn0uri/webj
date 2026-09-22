import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations, createDatabase, type Database } from '@set/db';

import { ReviewService } from './reviews.js';

/**
 * آزمونِ نظرات.
 *
 * موضوعِ اینجا «ذخیره و بازیابی» نیست. آنچه می‌سنجیم همان چیزی است که
 * اعتمادِ خریدار را می‌سازد یا می‌شکند:
 *
 *   • نظرِ تأییدنشده هرگز بیرون درز نکند؛
 *   • نشانِ «خریدِ تأیید‌شده» ادعا نباشد — کسی که کالا به دستش نرسیده
 *     نگیردش؛
 *   • یک تن نتواند با نظرهایِ پیاپی میانگین را بکشد؛
 *   • رأیِ تکراری بشمارد نشود؛
 *   • میانگین، همانی باشد که مشتری رویِ کالا می‌بیند.
 */

let db: Database;
let reviews: ReviewService;

// شناسه‌هایِ ثابت تا خواندنِ آزمون ساده باشد
const PRODUCT = '11111111-1111-4111-8111-111111111111';
const OTHER_PRODUCT = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';
const CUSTOMER_B = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';

/**
 * یک پایگاه برایِ همه‌یِ آزمون‌ها.
 *
 * هر نمونه‌یِ درون‌حافظه همه‌یِ مهاجرت‌ها را در خود دارد؛ با ۲۶ آزمون یعنی ۲۶
 * پایگاهِ کامل، و در این محیطِ ۲ گیگابایتی کارگر در میانه کشته می‌شد و
 * آزمون‌هایی بی‌تقصیر ناتمام می‌ماندند. پس یک بار می‌سازیم و میانِ آزمون‌ها
 * تنها «نظرها و سفارش‌ها» را پاک می‌کنیم — کالا و مشتری ثابت می‌مانند.
 */
beforeAll(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  reviews = new ReviewService(db);

  // پیش‌نیازهایِ کمینه: یک نوعِ کالا، دو کالا، دو مشتری، یک کارمند
  const type = await db.query<{ id: string }>(
    `INSERT INTO product_types (key, name) VALUES ('accessory', 'لوازم جانبی') RETURNING id`,
  );
  await db.query(
    `INSERT INTO products (id, slug, title, type_id) VALUES
       ($1, 'kala-ye-aval', 'کالایِ نخست', $3),
       ($2, 'kala-ye-dovom', 'کالایِ دوم', $3)`,
    [PRODUCT, OTHER_PRODUCT, type.rows[0].id],
  );
  await db.query(
    `INSERT INTO customers (id, full_name, phone) VALUES
       ($1, 'مریم احمدی', '09120000001'),
       ($2, 'رضا کریمی', '09120000002')`,
    [CUSTOMER, CUSTOMER_B],
  );
  await db.query(
    `INSERT INTO users (id, mobile, full_name) VALUES ($1, '09000000000', 'کارمند')`,
    [USER],
  );
});

afterAll(async () => {
  await db.close();
});

/** بازگشت به نقطه‌یِ آغاز — کالاها و مشتریان می‌مانند، نظرها می‌روند */
afterEach(async () => {
  // رأی‌ها پیش از خودِ نظرها (مهارِ کلیدِ خارجی)
  await db.query(`DELETE FROM product_review_votes`);
  await db.query(`DELETE FROM product_reviews`);
  await db.query(`DELETE FROM order_items`);
  await db.query(`DELETE FROM orders`);
});

/** یک تنوع برایِ کالا می‌سازد (سفارش به تنوع پیوند می‌خورد، نه به کالا) */
async function variant(productId: string, sku: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO product_variants (product_id, sku, price_rial) VALUES ($1, $2, 100000) RETURNING id`,
    [productId, sku],
  );
  return res.rows[0].id;
}

/** یک سفارشِ پرداخت‌شده یا تحویل‌شده برایِ مشتری می‌سازد */
async function order(customerId: string, variantId: string, status = 'delivered'): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO orders (order_no, customer_id, status, total_rial)
     VALUES ($1, $2, $3, 100000) RETURNING id`,
    [`S-${Math.random().toString(36).slice(2, 9)}`, customerId, status],
  );
  await db.query(
    `INSERT INTO order_items (order_id, variant_id, quantity, unit_price_rial, total_rial)
     VALUES ($1, $2, 1, 100000, 100000)`,
    [res.rows[0].id, variantId],
  );
  return res.rows[0].id;
}

/**
 * نوشتنِ نظر. چون تنظیمِ «فقط خریداران» پیش‌فرض است، پیش از نوشتن یک خریدِ
 * تحویل‌شده می‌سازیم — مگر آنکه خریدی از پیش باشد (مانندِ آزمونِ «پرداخت
 * شده ولی تحویل نه»، که نباید دستکاری شود).
 */
async function review(productId: string, customerId: string, rating: number, body = 'کیفیتِ ساخت خوب است و ارزشِ خرید دارد.') {
  // خرید اگر نباشد ساخته می‌شود؛ اگر از پیش باشد (حتی «پرداخت‌شده‌یِ
  // تحویل‌نشده») دست‌نخورده می‌ماند تا انتظارِ آزمون درست بماند.
  const bought = await reviews.hasPurchased(productId, customerId);
  if (!bought.orderId) {
    const v = await variant(productId, `SKU-${productId.slice(0, 4)}-${customerId.slice(0, 4)}-${Math.random().toString(36).slice(2, 7)}`);
    await order(customerId, v, 'delivered');
  }
  return reviews.create({ productId, customerId, authorName: 'خریدار', rating, body });
}

describe('نوشتنِ نظر', () => {
  it('نظرِ تازه «در انتظار» می‌نشیند تا پنل تأییدش کند', async () => {
    const created = await review(PRODUCT, CUSTOMER, 5);
    expect(created.status).toBe('pending');

    const list = await reviews.listPublic(PRODUCT);
    expect(list.items).toHaveLength(0); // بیرون دیده نمی‌شود
  });

  it('امتیازِ بیرونِ ۱ تا ۵ پذیرفته نمی‌شود', async () => {
    await expect(review(PRODUCT, CUSTOMER, 0)).rejects.toThrow(/۱ تا ۵/);
    await expect(review(PRODUCT, CUSTOMER, 6)).rejects.toThrow(/۱ تا ۵/);
    await expect(review(PRODUCT, CUSTOMER, 4.5)).rejects.toThrow(/۱ تا ۵/);
  });

  it('نظرِ کوتاه‌تر از ده نویسه پذیرفته نمی‌شود', async () => {
    await expect(review(PRODUCT, CUSTOMER, 5, 'خوب')).rejects.toThrow(/۱۰ نویسه/);
  });

  it('هر مشتری یک نظر برایِ یک کالا — دومی رد می‌شود', async () => {
    await review(PRODUCT, CUSTOMER, 5);
    await expect(review(PRODUCT, CUSTOMER, 3)).rejects.toThrow(/پیش از این/);
  });

  it('یک مشتری می‌تواند برایِ دو کالایِ متفاوت بنویسد', async () => {
    await review(PRODUCT, CUSTOMER, 5);
    await expect(review(OTHER_PRODUCT, CUSTOMER, 4)).resolves.toBeTruthy();
  });
});

describe('خریدِ تأیید‌شده', () => {
  it('کسی که نخریده نمی‌تواند بنویسد (تنظیمِ «فقط خریداران» پیش‌فرض است)', async () => {
    const allowed = await reviews.canReview(PRODUCT, CUSTOMER);
    expect(allowed.can).toBe(false);
    expect(allowed.reason).toMatch(/خریده‌اند/);
  });

  it('خریدِ پرداخت‌شده اجازه می‌دهد، اما نشانِ «تأیید‌شده» تنها پس از تحویل است', async () => {
    const v = await variant(PRODUCT, 'SKU-PAID');
    await order(CUSTOMER, v, 'paid');

    const allowed = await reviews.canReview(PRODUCT, CUSTOMER);
    expect(allowed.can).toBe(true);
    expect(allowed.orderId).toBeTruthy();

    const created = await review(PRODUCT, CUSTOMER, 4);
    expect(created.isVerifiedPurchase).toBe(false); // پرداخت شده، تحویل نه

    // همین کالا برایِ مشتریِ دیگر که تحویل گرفته است
    const v2 = await variant(PRODUCT, 'SKU-DELIVERED');
    await order(CUSTOMER_B, v2, 'delivered');
    const other = await review(PRODUCT, CUSTOMER_B, 5);
    expect(other.isVerifiedPurchase).toBe(true);
  });

  it('سفارشِ لغوشده یا در انتظارِ پرداخت، «خرید» نیست', async () => {
    const v = await variant(PRODUCT, 'SKU-CANCEL');
    await order(CUSTOMER, v, 'cancelled');
    await expect(reviews.canReview(PRODUCT, CUSTOMER)).resolves.toMatchObject({ can: false });
  });

  it('کالایِ خریداری‌شده از کالایِ دیگر جدا است', async () => {
    const v = await variant(PRODUCT, 'SKU-ONE');
    await order(CUSTOMER, v, 'delivered');
    await expect(reviews.canReview(PRODUCT, CUSTOMER)).resolves.toMatchObject({ can: true });
    await expect(reviews.canReview(OTHER_PRODUCT, CUSTOMER)).resolves.toMatchObject({ can: false });
  });
});

describe('میانگین و نمودار', () => {
  it('تنها نظرهایِ تأییدشده در میانگین می‌آیند', async () => {
    const r1 = await review(PRODUCT, CUSTOMER, 5);
    const r2 = await review(PRODUCT, CUSTOMER_B, 1);
    await reviews.moderate(r1.id, USER, 'approved');
    // r2 در انتظار مانده است

    const summary = await reviews.summary(PRODUCT);
    expect(summary.count).toBe(1);
    expect(summary.average).toBe(5);
    expect(summary.histogram[5]).toBe(1);
    expect(summary.histogram[1]).toBe(0);
  });

  it('میانگین درست گرد می‌شود و نمودار پنج خانه دارد', async () => {
    // ۵ و ۴ → میانگینِ ۴٫۵
    const r1 = await review(PRODUCT, CUSTOMER, 5);
    await reviews.moderate(r1.id, USER, 'approved');
    const r2 = await review(PRODUCT, CUSTOMER_B, 4);
    await reviews.moderate(r2.id, USER, 'approved');

    const summary = await reviews.summary(PRODUCT);
    expect(summary.average).toBe(4.5);
    expect(summary.count).toBe(2);
    expect(Object.keys(summary.histogram)).toHaveLength(5);
  });

  it('کالایِ بی‌نظر میانگینِ صفر دارد، نه «نامعلوم»', async () => {
    const summary = await reviews.summary(OTHER_PRODUCT);
    expect(summary.average).toBe(0);
    expect(summary.count).toBe(0);
  });

  it('میانگینِ چند کالا در یک رفت‌وبرگشت', async () => {
    const r1 = await review(PRODUCT, CUSTOMER, 5);
    await reviews.moderate(r1.id, USER, 'approved');
    const map = await reviews.summaries([PRODUCT, OTHER_PRODUCT]);
    expect(map.get(PRODUCT)?.average).toBe(5);
    expect(map.has(OTHER_PRODUCT)).toBe(false); // بی‌نظر است
  });
});

describe('رأیِ «مفید بود»', () => {
  it('رأیِ دومِ همان رأی‌دهنده جایگزین می‌شود، نه افزوده', async () => {
    const r = await review(PRODUCT, CUSTOMER, 5);
    await reviews.moderate(r.id, USER, 'approved');

    const first = await reviews.vote(r.id, { customerId: CUSTOMER_B }, true);
    expect(first.helpfulCount).toBe(1);

    const second = await reviews.vote(r.id, { customerId: CUSTOMER_B }, false);
    expect(second.helpfulCount).toBe(0);
    expect(second.unhelpfulCount).toBe(1);
  });

  it('رأیِ مهمان با نشانه پذیرفته و یکتا است', async () => {
    const r = await review(PRODUCT, CUSTOMER, 5);
    await reviews.moderate(r.id, USER, 'approved');

    await reviews.vote(r.id, { voterToken: 'tok-1' }, true);
    const again = await reviews.vote(r.id, { voterToken: 'tok-1' }, false);
    expect(again.helpfulCount).toBe(0);
    expect(again.unhelpfulCount).toBe(1);
  });

  it('به نظرِ تأییدنشده نمی‌توان رأی داد', async () => {
    const r = await review(PRODUCT, CUSTOMER, 5); // در انتظار
    await expect(reviews.vote(r.id, { customerId: CUSTOMER_B }, true)).rejects.toThrow(/منتشرشده/);
  });

  it('رأیِ بی‌هویت پذیرفته نمی‌شود', async () => {
    const r = await review(PRODUCT, CUSTOMER, 5);
    await reviews.moderate(r.id, USER, 'approved');
    await expect(reviews.vote(r.id, {}, true)).rejects.toThrow(/شناخته/);
  });
});

describe('مدیریت در پنل', () => {
  it('تأیید و رد وضعیت را عوض می‌کند و بازگشت به «در انتظار» بی‌معناست', async () => {
    const r = await review(PRODUCT, CUSTOMER, 3);
    const approved = await reviews.moderate(r.id, USER, 'approved');
    expect(approved.status).toBe('approved');
    const rejected = await reviews.moderate(r.id, USER, 'rejected', 'توهین‌آمیز');
    expect(rejected.status).toBe('rejected');
    await expect(reviews.moderate(r.id, USER, 'pending')).rejects.toThrow(/معنا ندارد/);
  });

  it('نظرِ ردشده در فهرستِ عمومی نمی‌آید', async () => {
    const r = await review(PRODUCT, CUSTOMER, 2);
    await reviews.moderate(r.id, USER, 'rejected');
    const list = await reviews.listPublic(PRODUCT);
    expect(list.items).toHaveLength(0);
  });

  it('پاسخ تنها به نظرِ منتشرشده داده می‌شود', async () => {
    const r = await review(PRODUCT, CUSTOMER, 4);
    await expect(reviews.reply(r.id, USER, 'سپاس از شما')).rejects.toThrow(/منتشرشده/);

    await reviews.moderate(r.id, USER, 'approved');
    const replied = await reviews.reply(r.id, USER, 'سپاس از شما');
    expect(replied.sellerReply).toBe('سپاس از شما');
    expect(replied.repliedAt).toBeInstanceOf(Date);
  });

  it('پاسخِ تهی پذیرفته نمی‌شود', async () => {
    const r = await review(PRODUCT, CUSTOMER, 4);
    await reviews.moderate(r.id, USER, 'approved');
    await expect(reviews.reply(r.id, USER, '   ')).rejects.toThrow(/بنویسید/);
  });

  it('فهرستِ پنل شمارشِ هر وضعیت را می‌دهد و در انتظارها نخست می‌آیند', async () => {
    const a = await review(PRODUCT, CUSTOMER, 5);
    const b = await review(PRODUCT, CUSTOMER_B, 4);
    await reviews.moderate(a.id, USER, 'approved');

    const list = await reviews.listForAdmin({});
    expect(list.counts.pending).toBe(1);
    expect(list.counts.approved).toBe(1);
    expect(list.items[0].id).toBe(b.id); // در انتظار، بالاتر
  });

  it('حذف، نظر را برمی‌دارد', async () => {
    const r = await review(PRODUCT, CUSTOMER, 5);
    expect(await reviews.remove(r.id)).toBe(true);
    expect(await reviews.remove(r.id)).toBe(false);
    await expect(reviews.summary(PRODUCT)).resolves.toMatchObject({ count: 0 });
  });
});

describe('ویرایشِ نظر', () => {
  it('ویرایش، نظر را دوباره به صفِ بررسی می‌برد', async () => {
    const r = await review(PRODUCT, CUSTOMER, 5);
    await reviews.moderate(r.id, USER, 'approved');
    const edited = await reviews.updateByOwner(r.id, CUSTOMER, { rating: 2 });
    expect(edited.status).toBe('pending');
    expect(edited.rating).toBe(2);
  });

  it('کسی نمی‌تواند نظرِ دیگری را ویرایش کند', async () => {
    const r = await review(PRODUCT, CUSTOMER, 5);
    await expect(reviews.updateByOwner(r.id, CUSTOMER_B, { body: 'دستکاری‌شده‌یِ بلند' })).rejects.toThrow(
      /برایِ شما نیست/,
    );
  });

  it('نظرِ ردشده ویرایش نمی‌شود', async () => {
    const r = await review(PRODUCT, CUSTOMER, 5);
    await reviews.moderate(r.id, USER, 'rejected');
    await expect(reviews.updateByOwner(r.id, CUSTOMER, { body: 'متنِ تازه و بلندتر' })).rejects.toThrow(/رد شده/);
  });
});
