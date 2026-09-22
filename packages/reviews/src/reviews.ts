/**
 * نظرات و امتیازِ مشتریان.
 *
 * سه تصمیم در اینجا بیشتر از بقیه اثر دارد، و هر سه از یک پرسش می‌آیند:
 * «چه چیزی نظر را از یک متنِ تبلیغاتی جدا می‌کند؟»
 *
 *  ۱. **خریدِ تأیید‌شده، نه ادعا**. نظر به سفارش پیوند می‌خورد؛ اگر کسی
 *     کالا را از این فروشگاه نخریده باشد، یا نمی‌نویسد، یا می‌نویسد اما
 *     بی‌نشان می‌ماند. نشانی که نتوانی اثباتش کنی، ارزشش از نبودنش کمتر
 *     است — مشتری خیلی زود یاد می‌گیرد به آن اطمینان نکند.
 *
 *  ۲. **میانگین فقط از نظرهایِ تأییدشده**. آمیختنِ نظرِ در انتظار با
 *     تأییدشده یعنی امتیازی که فروشنده می‌بیند با آنچه مشتری می‌بیند یکی
 *     نیست. یک منبعِ حقیقت: «نمایش = تأییدشده».
 *
 *  ۳. **یک نظر برایِ هر مشتری برایِ هر کالا**. بی‌این مهار، یک تن با ده
 *     نظرِ پشتِ‌هم میانگین را می‌کشد بالا یا پایین. مهار در پایگاه داده
 *     است (ایندکسِ یکتا) و در اینجا هم بازگو می‌شود، تا خطایِ پایگاه
 *     به پیامی فارسی برگردد نه به «duplicate key value».
 */

import { AppError, toPersianDigits } from '@set/shared-kernel';
import type { Database } from '@set/db';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export type ReviewSort = 'newest' | 'helpful' | 'highest' | 'lowest';

/** کمینه و بیشینه‌یِ طولِ نظر — کوتاه‌تر از این بی‌فایده، بلندتر از این ناخوانده */
export const BODY_MIN = 10;
export const BODY_MAX = 2000;

export interface Review {
  id: string;
  productId: string;
  customerId: string | null;
  authorName: string;
  rating: number;
  body: string;
  status: ReviewStatus;
  isVerifiedPurchase: boolean;
  sellerReply: string | null;
  repliedAt: Date | null;
  helpfulCount: number;
  unhelpfulCount: number;
  /** رأیِ خودِ بیننده (اگر رأی داده باشد) — برایِ اینکه دکمه‌ها وضعیتشان را نشان دهند */
  viewerVote: boolean | null;
  createdAt: Date;
}

export interface RatingSummary {
  productId: string;
  /** میانگین با یک رقمِ اعشار؛ صفر اگر نظری نباشد */
  average: number;
  count: number;
  /** شمارِ نظرها برایِ هر ستاره، از ۵ تا ۱ — نمودارِ ستونیِ بالایِ صفحه */
  histogram: Record<1 | 2 | 3 | 4 | 5, number>;
  verifiedCount: number;
}

export interface ReviewList {
  items: Review[];
  summary: RatingSummary;
  total: number;
  /** آیا بیننده می‌تواند نظر بنویسد؟ (و چرا نه، اگر نمی‌تواند) */
  canReview: { can: boolean; reason: string | null; orderId: string | null };
}

const EMPTY_HISTOGRAM = (): RatingSummary['histogram'] => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

function emptySummary(productId: string): RatingSummary {
  return { productId, average: 0, count: 0, histogram: EMPTY_HISTOGRAM(), verifiedCount: 0 };
}

/**
 * نخستین ردیف، یا خطا اگر نباشد.
 *
 * با `noUncheckedIndexedAccess`، `rows[0]` می‌تواند تهی باشد؛ این یعنی
 * هر بار که چیزی را «RETURNING» می‌گیریم باید بیازماییم که واقعاً برگشته
 * است — وگرنه ردیفی نبوده، یعنی یا شناسه اشتباه بوده یا ردیف در میانه پاک
 * شده، که هر دو پاسخِ روشن می‌خواهند نه «undefined»‌ای که بعداً خراب کند.
 */
function firstRow(rows: Row[], message: string): Row {
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', { message });
  return row;
}

/** ردیفِ خامِ پایگاه (نام‌ها snake_case) به قالبِ بیرونی */
interface Row {
  id: string;
  product_id: string;
  customer_id: string | null;
  author_name: string;
  rating: number;
  body: string;
  status: string;
  is_verified_purchase: boolean;
  seller_reply: string | null;
  replied_at: Date | string | null;
  helpful_count: string | number | null;
  unhelpful_count: string | number | null;
  viewer_vote: boolean | null;
  created_at: Date | string;
}

function toReview(row: Row): Review {
  return {
    id: row.id,
    productId: row.product_id,
    customerId: row.customer_id,
    authorName: row.author_name,
    rating: Number(row.rating),
    body: row.body,
    status: row.status as ReviewStatus,
    isVerifiedPurchase: Boolean(row.is_verified_purchase),
    sellerReply: row.seller_reply,
    repliedAt: row.replied_at ? new Date(row.replied_at) : null,
    helpfulCount: Number(row.helpful_count ?? 0),
    unhelpfulCount: Number(row.unhelpful_count ?? 0),
    viewerVote: row.viewer_vote === null ? null : Boolean(row.viewer_vote),
    createdAt: new Date(row.created_at),
  };
}

/** ترتیبِ نمایش — هر کدام پاسخِ یک نیازِ متفاوت */
function orderBy(sort: ReviewSort): string {
  switch (sort) {
    case 'helpful':
      // «مفیدترین» یعنی بیشترین رأیِ مثبت؛ رأیِ منفی کم نمی‌کند، چون نظرِ
      // بحث‌برانگیز هم دیدنی است و سرکوبش با رأیِ منفی راهِ حذفِ پنهان است.
      return 'helpful_count DESC, r.created_at DESC';
    case 'highest':
      return 'r.rating DESC, r.created_at DESC';
    case 'lowest':
      return 'r.rating ASC, r.created_at DESC';
    default:
      return 'r.created_at DESC';
  }
}

export class ReviewService {
  constructor(private readonly db: Database) {}

  // ─────────────────────────────────────────────────────────────────────────
  // خواندنِ عمومی
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * میانگین و نمودارِ امتیازها — فقط از نظرهایِ تأییدشده.
   *
   * چرا جدا از فهرست؟ چون کارتِ کالا در صفحه‌یِ فهرست هم امتیاز می‌خواهد،
   * و کشیدنِ متنِ همه‌یِ نظرها برایِ یک ستاره، بیهوده گران است.
   */
  async summary(productId: string): Promise<RatingSummary> {
    const res = await this.db.query<{ rating: number; n: string; verified: string }>(
      `SELECT r.rating AS rating,
              COUNT(*)::text AS n,
              COUNT(*) FILTER (WHERE r.is_verified_purchase)::text AS verified
         FROM product_reviews r
        WHERE r.product_id = $1 AND r.status = 'approved'
        GROUP BY r.rating`,
      [productId],
    );

    const histogram = EMPTY_HISTOGRAM();
    let total = 0;
    let weighted = 0;
    let verifiedCount = 0;
    for (const row of res.rows) {
      const stars = Number(row.rating) as 1 | 2 | 3 | 4 | 5;
      const n = Number(row.n);
      histogram[stars] = n;
      total += n;
      weighted += stars * n;
      verifiedCount += Number(row.verified);
    }
    if (total === 0) return emptySummary(productId);

    return {
      productId,
      // گرد کردن به یک رقمِ اعشار: ۴٫۲۵ را ۴٫۳ نشان می‌دهیم، چون «۴٫۲۵» در
      // ذهنِ خریدار دقتِ علمی القا می‌کند که از چند نظر به‌دست نیامده است.
      average: Math.round((weighted / total) * 10) / 10,
      count: total,
      histogram,
      verifiedCount,
    };
  }

  /** میانگین برایِ چند کالا در یک رفت‌وبرگشت (کارت‌هایِ فهرست) */
  async summaries(productIds: string[]): Promise<Map<string, RatingSummary>> {
    const map = new Map<string, RatingSummary>();
    if (productIds.length === 0) return map;
    const res = await this.db.query<{ product_id: string; avg: string | null; n: string; verified: string }>(
      `SELECT r.product_id,
              ROUND(AVG(r.rating)::numeric, 1)::text AS avg,
              COUNT(*)::text AS n,
              COUNT(*) FILTER (WHERE r.is_verified_purchase)::text AS verified
         FROM product_reviews r
        WHERE r.product_id = ANY($1::uuid[]) AND r.status = 'approved'
        GROUP BY r.product_id`,
      [productIds],
    );
    for (const row of res.rows) {
      const item: RatingSummary = {
        productId: row.product_id,
        average: row.avg ? Number(row.avg) : 0,
        count: Number(row.n),
        histogram: EMPTY_HISTOGRAM(), // نمودار در فهرست لازم نیست؛ فقط میانگین
        verifiedCount: Number(row.verified),
      };
      map.set(row.product_id, item);
    }
    return map;
  }

  /**
   * فهرستِ نظرهایِ یک کالا برایِ نمایشِ عمومی.
   *
   * تنها «تأییدشده»ها می‌آیند — نظرِ در انتظار یا ردشده هرگز به بیرون
   * درز نمی‌کند، حتی اگر نشانی مستقیم صدا زده شود.
   */
  async listPublic(
    productId: string,
    options: { sort?: ReviewSort; limit?: number; offset?: number; viewerCustomerId?: string | null; viewerToken?: string | null } = {},
  ): Promise<ReviewList> {
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
    const offset = Math.max(options.offset ?? 0, 0);
    const sort = options.sort ?? 'newest';

    const res = await this.db.query<Row>(
      `SELECT r.id, r.product_id, r.customer_id, r.author_name, r.rating, r.body,
              r.status, r.is_verified_purchase, r.seller_reply, r.replied_at,
              COALESCE(v.helpful_count, 0)   AS helpful_count,
              COALESCE(v.unhelpful_count, 0) AS unhelpful_count,
              mine.is_helpful AS viewer_vote,
              r.created_at
         FROM product_reviews r
         LEFT JOIN LATERAL (
              SELECT COUNT(*) FILTER (WHERE v.is_helpful)     AS helpful_count,
                     COUNT(*) FILTER (WHERE NOT v.is_helpful) AS unhelpful_count
                FROM product_review_votes v WHERE v.review_id = r.id
         ) v ON TRUE
         LEFT JOIN LATERAL (
              SELECT v.is_helpful
                FROM product_review_votes v
               WHERE v.review_id = r.id
                 AND (   ($2::uuid IS NOT NULL AND v.customer_id = $2::uuid)
                      OR ($3::text IS NOT NULL AND v.voter_token = $3::text) )
               LIMIT 1
         ) mine ON TRUE
        WHERE r.product_id = $1 AND r.status = 'approved'
        ORDER BY ${orderBy(sort)}
        LIMIT ${limit} OFFSET ${offset}`,
      [productId, options.viewerCustomerId ?? null, options.viewerToken ?? null],
    );

    const countRes = await this.db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM product_reviews WHERE product_id = $1 AND status = 'approved'`,
      [productId],
    );

    return {
      items: res.rows.map(toReview),
      summary: await this.summary(productId),
      total: Number(countRes.rows[0]?.n ?? 0),
      canReview: options.viewerCustomerId
        ? await this.canReview(productId, options.viewerCustomerId)
        : { can: false, reason: 'برایِ نوشتنِ نظر باید وارد شوید.', orderId: null },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // توانستن یا نتوانستن
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * آیا این مشتری می‌تواند درباره‌یِ این کالا نظر بنویسد؟
   *
   * سه مانع: پیش از این نوشته باشد؛ کالا را نخریده باشد (اگر تنظیم
   * «فقط خریداران» روشن باشد)؛ سفارش هنوز به دستش نرسیده باشد. مانعِ سوم
   * ظریف است: کسی که هنوز کالا را لمس نکرده، درباره‌یِ «کیفیتِ ساخت»
   * چه می‌تواند بگوید؟ اجازه می‌دهیم بنویسد، اما نشانِ «خریدِ تأیید‌شده»
   * تنها پس از تحویل است.
   */
  async canReview(
    productId: string,
    customerId: string,
  ): Promise<{ can: boolean; reason: string | null; orderId: string | null }> {
    const onlyBuyers = (await this.setting('reviews_only_buyers')) !== 'false';

    const dupe = await this.db.query<{ id: string }>(
      `SELECT id FROM product_reviews WHERE product_id = $1 AND customer_id = $2`,
      [productId, customerId],
    );
    if (dupe.rows.length > 0) {
      return { can: false, reason: 'شما پیش از این درباره‌یِ این کالا نوشته‌اید؛ همان نظر را می‌توانید ویرایش کنید.', orderId: null };
    }

    const purchase = await this.findPurchase(productId, customerId);
    if (onlyBuyers && !purchase) {
      return { can: false, reason: 'تنها کسانی که این کالا را از فروشگاه خریده‌اند می‌توانند نظر بنویسند.', orderId: null };
    }
    return { can: true, reason: null, orderId: purchase?.orderId ?? null };
  }

  /**
   * یافتنِ سفارشی که این کالا را برایِ این مشتری برده است.
   *
   * «خرید» یعنی سفارشی که پولش ردیف شده باشد — نه سبدِ رها‌شده و نه
   * سفارشِ لغوشده. تحویل (delivered) جداگانه نگه داشته می‌شود چون نشانِ
   * «خریدِ تأیید‌شده» برایِ کسی است که کالا به دستش رسیده.
   */
  /**
   * آیا این مشتری این کالا را خریده است؟
   *
   * جدا از canReview است چون معنایش فرق دارد: اینجا «خرید» را می‌پرسیم،
   * نه «توانستن». صفحه‌یِ کالا با همین می‌تواند بنویسد «شما این کالا را
   * خریده‌اید» بی‌آنکه نظر نوشته باشید.
   */
  async hasPurchased(
    productId: string,
    customerId: string,
  ): Promise<{ orderId: string | null; delivered: boolean }> {
    return (await this.findPurchase(productId, customerId)) ?? { orderId: null, delivered: false };
  }

  private async findPurchase(
    productId: string,
    customerId: string,
  ): Promise<{ orderId: string; delivered: boolean } | null> {
    const res = await this.db.query<{ order_id: string; status: string }>(
      `SELECT o.id AS order_id, o.status
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE o.customer_id = $1
          AND pv.product_id = $2
          AND o.status IN ('paid', 'confirmed', 'shipped', 'delivered')
        ORDER BY (o.status = 'delivered') DESC, o.created_at DESC
        LIMIT 1`,
      [customerId, productId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return { orderId: row.order_id, delivered: row.status === 'delivered' };
  }

  private async setting(key: string): Promise<string | null> {
    try {
      const res = await this.db.query<{ value: string }>(`SELECT value FROM store_settings WHERE key = $1`, [key]);
      return res.rows[0]?.value ?? null;
    } catch {
      return null; // اگر جدولِ تنظیمات نبود، پیش‌فرضِ خودِ تابع برقرار است
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // نوشتن
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * ثبتِ نظرِ تازه.
   *
   * وضعیتِ آغازین وابسته به تنظیمِ «نیاز به تأیید» است؛ اگر تأیید لازم
   * نباشد، نظر همان لحظه «تأییدشده» می‌شود تا فروشگاهِ پرسروصدا در صفِ
   * بررسی نماند.
   */
  async create(input: {
    productId: string;
    customerId: string;
    authorName: string;
    rating: number;
    body: string;
  }): Promise<Review> {
    const rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new AppError('VALIDATION', { message: 'امتیاز باید عددی درست از ۱ تا ۵ باشد.' });
    }
    const body = (input.body ?? '').trim();
    if (body.length < BODY_MIN) {
      throw new AppError('VALIDATION', { message: `نظر باید دست‌کم ${toPersianDigits(String(BODY_MIN))} نویسه باشد؛ کوتاه‌تر از این به دردِ خریدارِ بعدی نمی‌خورد.` });
    }
    if (body.length > BODY_MAX) {
      throw new AppError('VALIDATION', { message: `نظر نمی‌تواند بلندتر از ${toPersianDigits(String(BODY_MAX))} نویسه باشد.` });
    }
    const name = (input.authorName ?? '').trim();
    if (name.length === 0) {
      throw new AppError('VALIDATION', { message: 'نام را بنویسید.' });
    }

    const allowed = await this.canReview(input.productId, input.customerId);
    if (!allowed.can) {
      throw new AppError('VALIDATION', { message: allowed.reason ?? 'نمی‌توانید نظر بنویسید.' });
    }

    const purchase = allowed.orderId
      ? await this.findPurchase(input.productId, input.customerId)
      : null;
    const verified = Boolean(purchase?.delivered);
    const requireApproval = (await this.setting('reviews_require_approval')) !== 'false';

    // درج را در تابعی جدا می‌کنیم تا خروجی‌اش نوعی روشن داشته باشد (یک
    // متغیرِ «let» بی‌نوع، برای تایپ‌اسکریپت «هر چیزی ممکن است» معنا می‌دهد).
    const insert = async (): Promise<Row[]> => {
      try {
        const result = await this.db.query<Row>(
          `INSERT INTO product_reviews
             (product_id, customer_id, author_name, rating, body, status,
              order_id, is_verified_purchase, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           RETURNING id, product_id, customer_id, author_name, rating, body, status,
                     is_verified_purchase, seller_reply, replied_at, created_at`,
          [
            input.productId,
            input.customerId,
            name.slice(0, 80),
            rating,
            body,
            requireApproval ? 'pending' : 'approved',
            purchase?.orderId ?? null,
            verified,
          ],
        );
        return result.rows;
      } catch (error) {
        // ایندکسِ یکتا: هم‌زمانیِ دو درخواست یا نظرِ تکراری
        const message = error instanceof Error ? error.message : '';
        if (message.includes('uq_reviews_customer_product') || message.includes('duplicate key')) {
          throw new AppError('VALIDATION', { message: 'شما پیش از این درباره‌یِ این کالا نوشته‌اید.' });
        }
        throw error;
      }
    };

    const rows = await insert();
    const row = rows[0];
    if (!row) throw new AppError('INTERNAL', { message: 'نظر ثبت نشد؛ دوباره تلاش کنید.' });
    return toReview({ ...row, helpful_count: '0', unhelpful_count: '0', viewer_vote: null });  }

  /** ویرایشِ نظرِ خودِ مشتری (فقط تا وقتی تأیید نشده یا رد نشده باشد مطرح است) */
  async updateByOwner(
    reviewId: string,
    customerId: string,
    patch: { rating?: number; body?: string },
  ): Promise<Review> {
    const own = await this.db.query<{ id: string; status: string }>(
      `SELECT id, status FROM product_reviews WHERE id = $1 AND customer_id = $2`,
      [reviewId, customerId],
    );
    const row = own.rows[0];
    if (!row) throw new AppError('NOT_FOUND', { message: 'نظری با این شناسه برایِ شما نیست.' });
    if (row.status === 'rejected') {
      throw new AppError('VALIDATION', { message: 'این نظر رد شده است؛ نظرِ تازه بنویسید.' });
    }

    const rating = patch.rating === undefined ? null : Number(patch.rating);
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      throw new AppError('VALIDATION', { message: 'امتیاز باید عددی درست از ۱ تا ۵ باشد.' });
    }
    const body = patch.body === undefined ? null : patch.body.trim();
    if (body !== null && (body.length < BODY_MIN || body.length > BODY_MAX)) {
      throw new AppError('VALIDATION', { message: `نظر باید بینِ ${toPersianDigits(String(BODY_MIN))} تا ${toPersianDigits(String(BODY_MAX))} نویسه باشد.` });
    }

    // پس از ویرایش، نظر دوباره به صفِ بررسی می‌رود: متن عوض شده، پس تأییدِ
    // پیشین درباره‌یِ متنِ پیشین بوده است.
    const requireApproval = (await this.setting('reviews_require_approval')) !== 'false';

    const res = await this.db.query<Row>(
      `UPDATE product_reviews
          SET rating     = COALESCE($3, rating),
              body       = COALESCE($4, body),
              status     = CASE WHEN $5::boolean THEN 'pending' ELSE status END,
              updated_at = now()
        WHERE id = $1 AND customer_id = $2
        RETURNING id, product_id, customer_id, author_name, rating, body, status,
                  is_verified_purchase, seller_reply, replied_at, created_at`,
      [reviewId, customerId, rating, body, requireApproval],
    );
    return toReview({ ...firstRow(res.rows, 'نظر یافت نشد.'), helpful_count: '0', unhelpful_count: '0', viewer_vote: null });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // رأیِ «مفید بود»
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * رأی دادن. رأیِ دومِ همان رأی‌دهنده، رأیِ پیشین را جایگزین می‌کند
   * (نه اینکه افزوده شود) — وگرنه با زدنِ پیاپی می‌شد شمارنده را باد کرد.
   */
  async vote(
    reviewId: string,
    voter: { customerId?: string | null; voterToken?: string | null },
    isHelpful: boolean,
  ): Promise<{ helpfulCount: number; unhelpfulCount: number }> {
    const customerId = voter.customerId ?? null;
    const token = voter.voterToken ?? null;
    if (!customerId && !token) {
      throw new AppError('VALIDATION', { message: 'برایِ رأی دادن باید شناخته باشید.' });
    }

    const exists = await this.db.query<{ id: string; status: string }>(
      `SELECT id, status FROM product_reviews WHERE id = $1`,
      [reviewId],
    );
    const review = exists.rows[0];
    if (!review) throw new AppError('NOT_FOUND', { message: 'نظر یافت نشد.' });
    if (review.status !== 'approved') {
      throw new AppError('VALIDATION', { message: 'تنها به نظرهایِ منتشرشده می‌توان رأی داد.' });
    }

    await this.db.query(
      `INSERT INTO product_review_votes (review_id, customer_id, voter_token, is_helpful)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (review_id, COALESCE(customer_id::text, voter_token))
       DO UPDATE SET is_helpful = EXCLUDED.is_helpful, created_at = now()`,
      [reviewId, customerId, token, isHelpful],
    );

    const counts = await this.db.query<{ helpful: string; unhelpful: string }>(
      `SELECT COUNT(*) FILTER (WHERE is_helpful)::text     AS helpful,
              COUNT(*) FILTER (WHERE NOT is_helpful)::text AS unhelpful
         FROM product_review_votes WHERE review_id = $1`,
      [reviewId],
    );
    return {
      helpfulCount: Number(counts.rows[0]?.helpful ?? 0),
      unhelpfulCount: Number(counts.rows[0]?.unhelpful ?? 0),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // مدیریت (پنل)
  // ─────────────────────────────────────────────────────────────────────────

  /** فهرست برایِ پنل — با بازنماییِ وضعیت و جست‌وجو در متن */
  async listForAdmin(options: {
    status?: ReviewStatus | 'all';
    q?: string;
    productId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: Review[]; total: number; counts: Record<ReviewStatus, number> }> {
    const status = options.status ?? 'all';
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);
    const q = (options.q ?? '').trim();

    const where: string[] = [];
    const params: unknown[] = [];
    if (status !== 'all') {
      params.push(status);
      where.push(`r.status = $${params.length}`);
    }
    if (options.productId) {
      params.push(options.productId);
      where.push(`r.product_id = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(r.body ILIKE $${params.length} OR r.author_name ILIKE $${params.length})`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const res = await this.db.query<Row & { product_title: string | null }>(
      `SELECT r.id, r.product_id, r.customer_id, r.author_name, r.rating, r.body,
              r.status, r.is_verified_purchase, r.seller_reply, r.replied_at,
              COALESCE(v.helpful_count, 0)   AS helpful_count,
              COALESCE(v.unhelpful_count, 0) AS unhelpful_count,
              NULL::boolean AS viewer_vote,
              r.created_at
         FROM product_reviews r
         LEFT JOIN LATERAL (
              SELECT COUNT(*) FILTER (WHERE v.is_helpful)     AS helpful_count,
                     COUNT(*) FILTER (WHERE NOT v.is_helpful) AS unhelpful_count
                FROM product_review_votes v WHERE v.review_id = r.id
         ) v ON TRUE
         ${clause}
        ORDER BY (r.status = 'pending') DESC, r.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    const totalRes = await this.db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM product_reviews r ${clause}`,
      params,
    );
    const countsRes = await this.db.query<{ status: string; n: string }>(
      `SELECT status, COUNT(*)::text AS n FROM product_reviews GROUP BY status`,
    );
    const counts: Record<ReviewStatus, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const row of countsRes.rows) counts[row.status as ReviewStatus] = Number(row.n);

    return {
      items: res.rows.map(toReview),
      total: Number(totalRes.rows[0]?.n ?? 0),
      counts,
    };
  }

  /** تأیید یا رد — با نویسنده و زمان، تا بدانیم چه کسی و کی تصمیم گرفته است */
  async moderate(reviewId: string, userId: string, status: ReviewStatus, note?: string | null): Promise<Review> {
    if (status === 'pending') {
      throw new AppError('VALIDATION', { message: 'بازگرداندن به «در انتظار» معنا ندارد؛ تأیید یا رد کنید.' });
    }
    const res = await this.db.query<Row>(
      `UPDATE product_reviews
          SET status = $3, moderated_by = $2, moderated_at = now(),
              moderation_note = $4, updated_at = now()
        WHERE id = $1
        RETURNING id, product_id, customer_id, author_name, rating, body, status,
                  is_verified_purchase, seller_reply, replied_at, created_at`,
      [reviewId, userId, status, note ?? null],
    );
    return toReview({ ...firstRow(res.rows, 'نظر یافت نشد.'), helpful_count: '0', unhelpful_count: '0', viewer_vote: null });
  }

  /**
   * پاسخِ فروشنده.
   *
   * پاسخ تنها برایِ نظرِ تأییدشده معنا دارد: پاسخ دادن به نظری که منتشر
   * نشده، گفت‌وگویِ خصوصی است و جایش در پیامک است نه زیرِ کالا.
   */
  async reply(reviewId: string, userId: string, body: string): Promise<Review> {
    const text = (body ?? '').trim();
    if (text.length === 0) throw new AppError('VALIDATION', { message: 'متنِ پاسخ را بنویسید.' });
    if (text.length > BODY_MAX) {
      throw new AppError('VALIDATION', { message: `پاسخ نمی‌تواند بلندتر از ${toPersianDigits(String(BODY_MAX))} نویسه باشد.` });
    }
    const current = await this.db.query<{ status: string }>(
      `SELECT status FROM product_reviews WHERE id = $1`,
      [reviewId],
    );
    const existing = current.rows[0];
    if (!existing) throw new AppError('NOT_FOUND', { message: 'نظر یافت نشد.' });
    if (existing.status !== 'approved') {
      throw new AppError('VALIDATION', { message: 'پاسخ تنها به نظرِ منتشرشده داده می‌شود؛ نخست آن را تأیید کنید.' });
    }

    const res = await this.db.query<Row>(
      `UPDATE product_reviews
          SET seller_reply = $3, replied_by = $2, replied_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING id, product_id, customer_id, author_name, rating, body, status,
                  is_verified_purchase, seller_reply, replied_at, created_at`,
      [reviewId, userId, text],
    );
    return toReview({ ...firstRow(res.rows, 'نظر یافت نشد.'), helpful_count: '0', unhelpful_count: '0', viewer_vote: null });
  }

  async remove(reviewId: string): Promise<boolean> {
    const res = await this.db.query<{ id: string }>(
      `DELETE FROM product_reviews WHERE id = $1 RETURNING id`,
      [reviewId],
    );
    return res.rows.length > 0;
  }
}
