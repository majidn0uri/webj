import { Body, Controller, Get, Headers, Inject, Param, Patch, Post } from '@nestjs/common';

import { AppError } from '@set/shared-kernel';
import {
  createCoupon,
  getCouponById,
  listCoupons,
  listRedemptions,
  releaseCoupon,
  setCouponActive,
  updateCoupon,
  validateCoupon,
  type CouponKind,
  type CouponScope,
} from '@set/coupons';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';

import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * کوپن و کدِ تخفیف.
 *
 * سه دسته مسیر اینجاست و مرزِ میانشان مهم است:
 *
 *   • **ارزیابیِ عمومی** (`POST /shop/coupons/validate`) — مشتری در تسویه
 *     کد را می‌زند و باید بداند چقدر تخفیف می‌گیرد. پس مبلغِ تخفیف را
 *     می‌گوید، ولی هرگز نمی‌گوید «چرا نامعتبر است» به‌شکلی که راهِ حدس زدن
 *     باز کند؛ پیام همان است که پنل می‌گوید، چون پنهان‌کاری اینجا سودی
 *     ندارد و تنها خشم می‌آفریند.
 *   • **مدیریت** (`/admin/coupons`) — با `coupons.read` و `coupons.write`.
 *     برخلافِ مسیرِ عمومی، کوپن‌هایِ خاموش و منقضی را هم می‌آورد، چون
 *     فروشنده باید بتواند کمپینِ تمام‌شده را ببیند و تکرارش کند.
 *   • **گزارشِ مصرف** (`/admin/coupons/:id/redemptions`) — پرسشِ واقعیِ
 *     پس از هر کمپین: «این کد چند بار مصرف شد و چه کسانی برداشتند؟»
 */

const KINDS: CouponKind[] = ['percent', 'fixed'];
const SCOPES: CouponScope[] = ['all', 'product', 'category'];

function asKind(value: unknown): CouponKind | undefined {
  if (value === undefined) return undefined;
  if (!KINDS.includes(value as CouponKind)) {
    throw new AppError('VALIDATION', { message: `نوعِ کوپن نامعتبر است: ${String(value)}` });
  }
  return value as CouponKind;
}

function asScope(value: unknown): CouponScope | undefined {
  if (value === undefined) return undefined;
  if (!SCOPES.includes(value as CouponScope)) {
    throw new AppError('VALIDATION', { message: `محدوده‌یِ کوپن نامعتبر است: ${String(value)}` });
  }
  return value as CouponScope;
}

function asDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new AppError('VALIDATION', { message: `تاریخ نامعتبر است: ${String(value)}` });
  }
  return date;
}

/** ریال از رابط رشته است (بیگ‌اینِت در JSON نیست) */
function asRial(value: unknown): bigint | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = BigInt(String(value));
  if (n < 0n) throw new AppError('VALIDATION', { message: 'مبلغ نمی‌تواند منفی باشد' });
  return n;
}

function asInt(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new AppError('VALIDATION', { message: 'عدد نامعتبر است' });
  return Math.trunc(n);
}

function asBool(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return value === true || value === 'true' || value === '1';
}

function asUuid(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return String(value);
}

@Controller()
export class AdminCouponsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  /**
   * نشست + دسترسی.
   *
   * چرا دسترسی اینجا (در کارساز) سنجیده می‌شود و نه فقط در پنل؟ چون پنهان
   * کردنِ دکمه در رابط، سد نیست — پنل یک رابط است و هر کس می‌تواند همان
   * درخواست را دستی بفرستد. سد باید در کارساز باشد.
   */
  private async require(
    authorization: string | undefined,
    permission: 'coupons.read' | 'coupons.write',
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    const [resource, action] = permission.split('.');
    await this.access.assert({ userId: claims.sub, branchId: null }, resource!, action!);
    return claims;
  }

  private async read(authorization: string | undefined): Promise<AccessClaims> {
    return this.require(authorization, 'coupons.read');
  }

  private async write(authorization: string | undefined): Promise<AccessClaims> {
    return this.require(authorization, 'coupons.write');
  }

  // ── ارزیابی برایِ مشتری (تسویه) ───────────────────────────────────────────

  /**
   * ارزیابیِ یک کد پیش از ثبتِ سفارش.
   *
   * چرا جدا از ثبت؟ چون مشتری باید بتواند ببیند «این کد چقدر کم می‌کند»
   * بی‌آنکه سفارشی ثبت شود. و چرا مبلغ را برمی‌گردانیم و نه فقط «معتبر
   * است»؟ چون پرسشِ واقعیِ خریدار عدد است، نه بله/خیر.
   */
  @Post('shop/coupons/validate')
  async validate(@Body() body: unknown) {
    const input = (body ?? {}) as {
      code?: string;
      items?: Array<{ variantId: string; quantity: number }>;
    };
    const code = String(input.code ?? '').trim();
    if (!code) throw new AppError('VALIDATION', { message: 'کدِ تخفیف را بنویسید' });

    const items = Array.isArray(input.items) ? input.items : [];
    const coupon = await validateCoupon(this.db, code);

    // مبلغِ سبد را از پایگاه می‌خوانیم، نه از رابط — ورودیِ مشتری قابلِ
    // اعتماد نیست و قیمت را باید سرور بگوید
    let subtotal = 0n;
    if (items.length > 0) {
      const ids = items.map((i) => String(i.variantId));
      const { rows } = await this.db.query<{ id: string; price_rial: string }>(
        `SELECT id, price_rial FROM product_variants WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      const priceById = new Map(rows.map((r) => [r.id, BigInt(r.price_rial)]));
      for (const item of items) {
        const price = priceById.get(String(item.variantId));
        if (price == null) continue;
        subtotal += price * BigInt(Math.max(Number(item.quantity) || 1, 1));
      }
    }

    const shortBy = coupon.minSubtotalRial > subtotal ? coupon.minSubtotalRial - subtotal : 0n;

    return {
      code: coupon.code,
      title: coupon.title,
      kind: coupon.kind,
      /** برایِ نمایش: «۱۰٪» یا مبلغ به تومان */
      valueBp: coupon.valueBp,
      valueRial: coupon.valueRial?.toString() ?? null,
      minSubtotalRial: coupon.minSubtotalRial.toString(),
      maxDiscountRial: coupon.maxDiscountRial?.toString() ?? null,
      subtotalRial: subtotal.toString(),
      shortByRial: shortBy.toString(),
      appliesTo: coupon.appliesTo,
      endsAt: coupon.endsAt?.toISOString() ?? null,
      valid: shortBy === 0n,
      message: shortBy === 0n ? 'کدِ تخفیف اعمال شد' : null,
    };
  }

  // ── پنل ──────────────────────────────────────────────────────────────────

  @Get('admin/coupons')
  async list(@Headers('authorization') authorization?: string) {
    await this.read(authorization);
    const { rows } = await listCoupons(this.db, { includeInactive: true, limit: 200 });
    return {
      rows: rows.map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        description: c.description,
        kind: c.kind,
        valueBp: c.valueBp,
        valueRial: c.valueRial?.toString() ?? null,
        minSubtotalRial: c.minSubtotalRial.toString(),
        maxDiscountRial: c.maxDiscountRial?.toString() ?? null,
        startsAt: c.startsAt?.toISOString() ?? null,
        endsAt: c.endsAt?.toISOString() ?? null,
        usageLimit: c.usageLimit,
        usageCount: c.usageCount,
        perCustomerLimit: c.perCustomerLimit,
        appliesTo: c.appliesTo,
        productId: c.productId,
        categoryId: c.categoryId,
        isActive: c.isActive,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  @Post('admin/coupons')
  async create(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    const claims = await this.write(authorization);
    const input = (body ?? {}) as Record<string, unknown>;

    const code = String(input.code ?? '').trim();
    const title = String(input.title ?? '').trim();
    if (!code) throw new AppError('VALIDATION', { message: 'کدِ تخفیف لازم است' });
    if (!title) throw new AppError('VALIDATION', { message: 'عنوانِ کوپن لازم است' });

    const coupon = await createCoupon(this.db, {
      code,
      title,
      description: input.description == null ? null : String(input.description),
      kind: asKind(input.kind ?? 'percent') ?? 'percent',
      valueBp: asInt(input.valueBp) ?? undefined,
      valueRial: asRial(input.valueRial),
      minSubtotalRial: asRial(input.minSubtotalRial) ?? 0n,
      maxDiscountRial: asRial(input.maxDiscountRial) ?? null,
      startsAt: asDate(input.startsAt),
      endsAt: asDate(input.endsAt),
      usageLimit: asInt(input.usageLimit) ?? null,
      perCustomerLimit: asInt(input.perCustomerLimit) ?? 1,
      appliesTo: asScope(input.appliesTo) ?? 'all',
      productId: asUuid(input.productId) ?? null,
      categoryId: asUuid(input.categoryId) ?? null,
      isActive: asBool(input.isActive) ?? true,
      createdBy: claims.sub,
    });

    return { id: coupon.id, code: coupon.code };
  }

  @Patch('admin/coupons/:id')
  async update(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    await this.write(authorization);
    const input = (body ?? {}) as Record<string, unknown>;

    const coupon = await updateCoupon(this.db, id, {
      title: input.title === undefined ? undefined : String(input.title).trim(),
      description: input.description === undefined ? undefined : input.description == null ? null : String(input.description),
      kind: asKind(input.kind),
      valueBp: asInt(input.valueBp),
      valueRial: asRial(input.valueRial),
      // کمینه «تهی» نمی‌شود؛ اگر چیزی نفرستادند، صفر است (بی‌شرط)
      minSubtotalRial: asRial(input.minSubtotalRial) ?? undefined,
      maxDiscountRial: asRial(input.maxDiscountRial),
      startsAt: asDate(input.startsAt),
      endsAt: asDate(input.endsAt),
      usageLimit: asInt(input.usageLimit),
      // سهمیه هم تهی نمی‌شود: دست‌کم یک بار
      perCustomerLimit: asInt(input.perCustomerLimit) ?? undefined,
      isActive: asBool(input.isActive),
    });
    if (!coupon) throw new AppError('NOT_FOUND', { message: 'کوپن پیدا نشد' });
    return { id: coupon.id, ok: true };
  }

  /** روشن/خاموش کردن، جدا از ویرایش: رایج‌ترین کارِ پس از پایانِ کمپین */
  @Patch('admin/coupons/:id/active')
  async setActive(@Param('id') id: string, @Body() body: unknown, @Headers('authorization') authorization?: string) {
    await this.write(authorization);
    const isActive = asBool((body as { isActive?: unknown } | null)?.isActive) ?? false;
    const coupon = await setCouponActive(this.db, id, isActive);
    if (!coupon) throw new AppError('NOT_FOUND', { message: 'کوپن پیدا نشد' });
    return { id: coupon.id, isActive: coupon.isActive };
  }

  @Get('admin/coupons/:id/redemptions')
  async redemptions(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    await this.read(authorization);
    const coupon = await getCouponById(this.db, id);
    if (!coupon) throw new AppError('NOT_FOUND', { message: 'کوپن پیدا نشد' });
    const rows = await listRedemptions(this.db, id, 200);
    return {
      coupon: { id: coupon.id, code: coupon.code, title: coupon.title, usageCount: coupon.usageCount },
      rows: rows.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        orderNo: r.orderNo,
        customerName: r.customerName,
        discountRial: r.discountRial.toString(),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * پس دادنِ نوبتِ یک کوپن (سفارشِ لغو شده).
   *
   * چرا مسیر دارد، با اینکه لغوِ سفارش خودش آزاد می‌کند؟ چون گاهی لغو از
   * راهی می‌آید که از بسته‌یِ سفارش نمی‌گذرد (تلفنی، یا درست کردنِ داده‌یِ
   * قدیمی). این مسیر همان کاری را می‌کند که لغو می‌کند — و بس.
   */
  @Post('admin/coupons/release')
  async release(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    await this.write(authorization);
    const orderId = String((body as { orderId?: unknown } | null)?.orderId ?? '').trim();
    if (!orderId) throw new AppError('VALIDATION', { message: 'شناسه‌یِ سفارش لازم است' });
    const done = await releaseCoupon(this.db, orderId);
    return { released: done };
  }
}
