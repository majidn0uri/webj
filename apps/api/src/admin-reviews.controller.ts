import { Body, Controller, Delete, Get, Headers, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';

import { AppError } from '@set/shared-kernel';
import { ReviewService, type ReviewSort, type ReviewStatus } from '@set/reviews';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import { sessionFromToken } from '@set/shopper';

import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * نظرات و امتیازِ مشتریان.
 *
 * سه دسته مسیر اینجا کنار هم نشسته‌اند، و مرزِ میانشان همان مرزِ اعتماد است:
 *
 *   • **عمومی** (`GET /reviews`) — بی‌نشست. تنها نظرهایِ تأییدشده را
 *     می‌دهد؛ نشانیِ مستقیم یا تغییرِ پارامتر نمی‌تواند نظرِ در انتظار یا
 *     ردشده را بیرون بکشد، چون پالایش در خودِ پرس‌وجو است نه در رابط.
 *   • **خریدار** (`/shop/reviews`) — با نشستِ خریدار. نوشتن نیازمندِ خرید
 *     است (مگر تنظیم خلافش را بگوید)، و رأی دادن نیازمندِ شناسه — که یا
 *     حساب است یا یک نشانه‌یِ ناشناس تا مهمان هم بتواند بگوید «مفید بود».
 *   • **پنل** (`/admin/reviews`) — با دسترسیِ `reviews.read`/`reviews.write`
 *     برایِ تأیید، رد، پاسخ و حذف.
 *
 * چرا نشانه‌یِ مهمان برایِ رأی؟ چون رأی دادن نباید نیازمندِ ساختنِ حساب
 * باشد — خریداری که تازه آمده و می‌خواهد بگوید «این نظر به دردم خورد»،
 * اگر مجبورش کنیم ثبت‌نام کند، ساده رأی نمی‌دهد و شمارنده بی‌معنا می‌ماند.
 */

const SORTS: ReviewSort[] = ['newest', 'helpful', 'highest', 'lowest'];
const STATUSES: ReviewStatus[] = ['pending', 'approved', 'rejected'];

function asSort(value: unknown): ReviewSort {
  const sort = String(value ?? 'newest') as ReviewSort;
  if (!SORTS.includes(sort)) {
    throw new AppError('VALIDATION', { message: `ترتیبِ نمایش نامعتبر است: ${String(value)}` });
  }
  return sort;
}

function asStatus(value: unknown): ReviewStatus {
  const status = String(value ?? '') as ReviewStatus;
  if (!STATUSES.includes(status)) {
    throw new AppError('VALIDATION', { message: `وضعیت نامعتبر است: ${String(value)}` });
  }
  return status;
}

function asRating(value: unknown): number {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AppError('VALIDATION', { message: 'امتیاز باید عددی درست از ۱ تا ۵ باشد.' });
  }
  return rating;
}

function asText(value: unknown, field: string, max = 2000): string {
  const text = String(value ?? '').trim();
  if (text.length === 0) throw new AppError('VALIDATION', { message: `${field} را بنویسید.` });
  return text.slice(0, max);
}

/** شمارنده‌یِ صفحه — برایِ اینکه هیچ درخواستی نتواند هزار ردیف بکشد */
function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

interface ShopRequest {
  headers: Record<string, string | undefined>;
}

@Controller()
export class AdminReviewsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  private readonly reviews = (): ReviewService => new ReviewService(this.db);

  private async require(
    authorization: string | undefined,
    permission: 'reviews.read' | 'reviews.write',
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    const [resource, action] = permission.split('.');
    await this.access.assert({ userId: claims.sub, branchId: null }, resource!, action!);
    return claims;
  }

  /** نشستِ خریدار — از کوکی یا سربرگ (همان شیوه‌یِ کنترلرِ خریدار) */
  private async shopper(req?: ShopRequest) {
    const cookie = req?.headers?.cookie ?? '';
    const fromCookie = /(?:^|;\s*)set_customer_token=([^;]+)/.exec(cookie);
    const token = fromCookie?.[1]
      ? decodeURIComponent(fromCookie[1])
      : (req?.headers?.['x-shopper-token'] ?? '').replace(/^Bearer\s+/, '') || null;
    const session = await sessionFromToken(this.db, token);
    if (!session) {
      throw new AppError('UNAUTHENTICATED', { message: 'برایِ این کار باید واردِ حسابِ خود شوید.' });
    }
    return session;
  }

  /** حل کردنِ «کالا» از شناسه یا نامک — صفحه‌یِ کالا نامک دارد، پنل شناسه */
  private async resolveProduct(ref: string): Promise<string> {
    if (isUuid(ref)) return ref;
    const res = await this.db.query<{ id: string }>(`SELECT id FROM products WHERE slug = $1`, [ref]);
    const id = res.rows[0]?.id;
    if (!id) throw new AppError('NOT_FOUND', { message: 'کالا یافت نشد.' });
    return id;
  }

  /** ── مسیرهایِ عمومی ───────────────────────────────────────────────── */

  @Get('reviews')
  async list(
    @Query('product') product: string,
    @Query('sort') sort?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Req() req?: ShopRequest,
  ) {
    if (!product) throw new AppError('VALIDATION', { message: 'کالا را نشانی نکرده‌اید.' });
    const productId = await this.resolveProduct(String(product));

    // بیننده اگر خریدار باشد، رأی‌هایِ خودش را هم می‌گیرد تا دکمه‌ها روشن
    // بمانند؛ اگر نباشد، تنها شمارنده‌ها را می‌بیند. خطا در نشست نباید
    // نمایشِ نظرها را خراب کند — پس بی‌صدا می‌گذریم.
    let viewer: { customerId?: string | null; viewerToken?: string | null } = {};
    try {
      const session = await this.shopper(req);
      viewer = { customerId: session.customerId };
    } catch {
      viewer = { viewerToken: this.guestToken(req) };
    }

    return this.reviews().listPublic(productId, {
      sort: asSort(sort),
      limit: asInt(limit, 10, 1, 50),
      offset: asInt(offset, 0, 0, 100_000),
      viewerCustomerId: viewer.customerId ?? null,
      viewerToken: viewer.viewerToken ?? null,
    });
  }

  /** میانگینِ چند کالا در یک رفت‌وبرگشت — برایِ کارت‌هایِ فهرست */
  @Get('reviews/summary')
  async summary(@Query('products') products?: string) {
    const refs = String(products ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (refs.length === 0) return { items: {} };

    // نامک‌ها را به شناسه برمی‌گردانیم (کارتِ کالا نامک دارد)
    const res = await this.db.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM products WHERE slug = ANY($1::text[]) OR id = ANY($2::uuid[])`,
      [refs, refs.filter(isUuid)],
    );
    const map = new Map<string, string>();
    for (const row of res.rows) {
      map.set(row.id, row.id);
      map.set(row.slug, row.id);
    }
    const ids = [...new Set(refs.map((ref) => map.get(ref)).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return { items: {} };

    const summaries = await this.reviews().summaries(ids);
    const items: Record<string, { average: number; count: number }> = {};
    for (const [key, id] of map) {
      const found = summaries.get(id);
      if (found) items[key] = { average: found.average, count: found.count };
    }
    return { items };
  }

  /** ── مسیرهایِ خریدار ──────────────────────────────────────────────── */

  /** آیا این خریدار می‌تواند بنویسد؟ (پیش از نشان دادنِ فرم پرسیده می‌شود) */
  @Get('shop/reviews/can')
  async can(@Query('product') product: string, @Req() req?: ShopRequest) {
    const session = await this.shopper(req);
    const productId = await this.resolveProduct(String(product ?? ''));
    return { canReview: await this.reviews().canReview(productId, session.customerId) };
  }

  @Post('shop/reviews')
  async create(@Body() body: Record<string, unknown>, @Req() req?: ShopRequest) {
    const session = await this.shopper(req);
    const productId = await this.resolveProduct(String(body.productId ?? ''));
    const item = await this.reviews().create({
      productId,
      customerId: session.customerId,
      authorName: asText(body.authorName ?? session.fullName, 'نام', 80),
      rating: asRating(body.rating),
      body: String(body.body ?? ''),
    });
    return { item };
  }

  @Patch('shop/reviews/:id')
  async updateByOwner(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req?: ShopRequest) {
    const session = await this.shopper(req);
    const patch: { rating?: number; body?: string } = {};
    if (body.rating !== undefined) patch.rating = asRating(body.rating);
    if (body.body !== undefined) patch.body = String(body.body);
    const item = await this.reviews().updateByOwner(id, session.customerId, patch);
    return { item };
  }

  /**
   * رأیِ «مفید بود / نبود».
   *
   * اگر خریدار وارد باشد با شناسه‌اش رأی می‌دهد؛ وگرنه با یک نشانه‌یِ تصادفی
   * که در کوکی می‌نشیند (تا رأیِ تکراری شمرده نشود).
   */
  @Post('shop/reviews/:id/vote')
  async vote(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req?: ShopRequest) {
    const isHelpful = body.isHelpful === true || body.isHelpful === 'true';
    let customerId: string | null = null;
    try {
      const session = await this.shopper(req);
      customerId = session.customerId;
    } catch {
      customerId = null; // مهمان: با نشانه رأی می‌دهد
    }
    const voterToken = customerId ? null : String(body.voterToken ?? this.guestToken(req) ?? '');
    if (!customerId && !voterToken) {
      throw new AppError('VALIDATION', { message: 'برایِ رأی دادن باید شناخته باشید.' });
    }
    return this.reviews().vote(id, { customerId, voterToken }, isHelpful);
  }

  private guestToken(req?: ShopRequest): string | null {
    const cookie = req?.headers?.cookie ?? '';
    const found = /(?:^|;\s*)set_guest_token=([^;]+)/.exec(cookie);
    return found?.[1] ? decodeURIComponent(found[1]) : null;
  }

  /** ── مسیرهایِ پنل ─────────────────────────────────────────────────── */

  @Get('admin/reviews')
  async listAdmin(
    @Headers('authorization') authorization: string | undefined,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('productId') productId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    await this.require(authorization, 'reviews.read');
    const filter = status && status !== 'all' ? asStatus(status) : 'all';
    return this.reviews().listForAdmin({
      status: filter,
      q: q ? String(q) : undefined,
      productId: productId ? String(productId) : undefined,
      limit: asInt(limit, 20, 1, 100),
      offset: asInt(offset, 0, 0, 100_000),
    });
  }

  /** تأیید یا رد — با یادداشتی که چرا (برایِ مرورِ بعدیِ خودِ فروشنده) */
  @Patch('admin/reviews/:id')
  async moderate(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const claims = await this.require(authorization, 'reviews.write');
    const item = await this.reviews().moderate(
      id,
      claims.sub,
      asStatus(body.status),
      body.note == null ? null : String(body.note).slice(0, 500),
    );
    return { item };
  }

  /** پاسخِ فروشنده — زیرِ نظر، برایِ همه دیدنی */
  @Post('admin/reviews/:id/reply')
  async reply(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const claims = await this.require(authorization, 'reviews.write');
    const item = await this.reviews().reply(id, claims.sub, String(body.body ?? ''));
    return { item };
  }

  @Delete('admin/reviews/:id')
  async remove(@Param('id') id: string, @Headers('authorization') authorization: string | undefined) {
    await this.require(authorization, 'reviews.write');
    const removed = await this.reviews().remove(id);
    if (!removed) throw new AppError('NOT_FOUND', { message: 'نظر یافت نشد.' });
    return { removed: true };
  }
}
