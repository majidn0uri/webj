import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { AppError, formatToman } from '@set/shared-kernel';
import type { Database } from '@set/db';
import { enqueueSms, shippingOptions, type ShippingOption } from '@set/commerce';
import {
  addToWishlist,
  createAddress,
  deleteAddress,
  getOrder,
  listAddresses,
  listOrders,
  listWishlist,
  loginWithPassword,
  logout,
  logoutEverywhere,
  removeFromWishlist,
  requestOtp,
  sessionFromToken,
  setPassword,
  updateAddress,
  updateProfile,
  verifyOtp,
  wishlistToCart,
  type ShopperSession,
} from '@set/shopper';
import { CONFIG, DB } from './tokens.js';
import { listReturns, listWarranties, requestReturn, quoteReturn } from '@set/returns';

/**
 * مسیرهایِ مشتری (فروشگاه) — زیرِ /shop
 *
 * دو تفاوتِ بنیادین با مسیرهایِ پنل (‎/admin/…):
 *
 *   ۱) اینجا «نقش» معنا ندارد؛ هر کس با نشانه‌ی خودش فقط به داده‌ی خودش
 *      می‌رسد. بررسیِ دسترسی با RBAC نیست، با مالکیت است: هر پرس‌وجو با
 *      customer_idِ گرفته‌شده از نشست محدود می‌شود، نه با شناسه‌ای که مرورگر
 *      بفرستد. برای همین در این کنترل‌کننده هیچ مسیری «شناسه‌ی مشتری» نمی‌گیرد.
 *
 *   ۲) نشستِ مشتری از نشستِ پنل جداست (جدول و کوکیِ جدا). چرا؟ چون نشانه‌ی پنل
 *      دسترسی‌هایِ سازمانی دارد و نشانه‌ی مشتری نباید هیچ‌کدام را به ارث ببرد؛
 *      و برعکس، بیرون انداختنِ مشتری از فروشگاه نباید نشستِ حسابدار را ببندد.
 */

/** آنچه از درخواستِ HTTP نیاز داریم — فقط سرآیندها (برای کوکی و نشانه) */
interface ShopRequest {
  headers: Record<string, string | undefined>;
}

const MobileDto = z.object({
  mobile: z.string().min(10).max(20),
  purpose: z.enum(['login', 'register', 'reset']).default('login'),
});

const VerifyDto = z.object({
  mobile: z.string().min(10).max(20),
  code: z.string().min(4).max(10),
  purpose: z.enum(['login', 'register', 'reset']).default('login'),
  fullName: z.string().max(120).nullish(),
});

const PasswordLoginDto = z.object({
  mobile: z.string().min(10).max(20),
  password: z.string().min(4).max(200),
});

const PasswordSetDto = z.object({ password: z.string().min(8).max(200) });

const ProfileDto = z.object({
  fullName: z.string().max(120).nullish(),
  nationalId: z.string().max(12).nullish(),
  email: z.string().email().max(160).nullish(),
});

const AddressDto = z.object({
  receiverName: z.string().min(3).max(120),
  phone: z.string().min(10).max(20),
  province: z.string().min(2).max(60),
  city: z.string().min(2).max(60),
  address: z.string().min(10).max(400),
  postalCode: z.string().min(8).max(12),
  isDefault: z.boolean().default(true),
});

const AddressPatchDto = AddressDto.partial();

@Controller('shop')
export class ShopperController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: { NODE_ENV: string },
  ) {}

  /** نشانه از کوکی (ترجیحاً) یا سرآیند — مرورگرِ مشتری نیازی به جابه‌جاییِ توکن ندارد */
  private tokenFrom(req?: { headers?: Record<string, string | undefined> }): string | null {
    const cookie = req?.headers?.cookie ?? '';
    const fromCookie = /(?:^|;\s*)set_customer_token=([^;]+)/.exec(cookie);
    if (fromCookie?.[1]) return decodeURIComponent(fromCookie[1]);
    const header = req?.headers?.['x-shopper-token'];
    if (header && header.startsWith('Bearer ')) return header.slice(7);
    return header ?? null;
  }

  private async current(
    req?: { headers?: Record<string, string | undefined> },
  ): Promise<ShopperSession> {
    const session = await sessionFromToken(this.db, this.tokenFrom(req));
    if (!session) {
      throw new AppError('UNAUTHENTICATED', { message: 'لطفاً وارد حساب خود شوید.' });
    }
    return session;
  }

  // ── احراز ────────────────────────────────────────────────────────────────

  @Post('auth/otp/request')
  async otpRequest(@Body() body: unknown) {
    const input = MobileDto.parse(body);
    return requestOtp(this.db, {
      mobile: input.mobile,
      purpose: input.purpose,
      storeName: 'ست‌شاپ',
    });
  }

  @Post('auth/otp/verify')
  async otpVerify(@Body() body: unknown, @Req() req: ShopRequest) {
    const input = VerifyDto.parse(body);
    const res = await verifyOtp(this.db, {
      mobile: input.mobile,
      code: input.code,
      purpose: input.purpose,
      fullName: input.fullName ?? null,
      userAgent: req?.headers?.['user-agent'] ?? null,
    });

    // پیامک خوش‌آمدگویی — فقط برای ثبت‌نام تازه
    if (res.isNew) {
      try {
        await enqueueSms(this.db, {
          phone: input.mobile,
          templateKey: 'welcome',
          vars: {},
        });
      } catch { /* پیامک نباید ورود را متوقف کند */ }
    }

    return {
      customerId: res.customerId,
      fullName: res.fullName,
      isNew: res.isNew,
      claimedOrders: res.claimedOrders,
      token: res.token,
      expiresAt: res.expiresAt,
    };
  }

  @Post('auth/password')
  async passwordLogin(@Body() body: unknown, @Req() req: ShopRequest) {
    const input = PasswordLoginDto.parse(body);
    const res = await loginWithPassword(this.db, {
      mobile: input.mobile,
      password: input.password,
      userAgent: req?.headers?.['user-agent'] ?? null,
    });
    return { customerId: res.customerId, fullName: res.fullName, token: res.token, expiresAt: res.expiresAt };
  }

  @Post('auth/logout')
  async logout(@Req() req: ShopRequest) {
    const token = this.tokenFrom(req);
    if (!token) return { ok: true };
    await logout(this.db, token);
    return { ok: true };
  }

  /** خروج از همه‌ی دستگاه‌ها — پس از تغییرِ رمز یا حس کردنِ خطر */
  @Post('auth/logout-all')
  async logoutAll(@Req() req: ShopRequest) {
    const me = await this.current(req);
    const closed = await logoutEverywhere(this.db, me.customerId);
    return { closed };
  }

  @Post('auth/password/set')
  async setPassword(@Body() body: unknown, @Req() req: ShopRequest) {
    const me = await this.current(req);
    const input = PasswordSetDto.parse(body);
    await setPassword(this.db, me.customerId, input.password);
    return { ok: true };
  }

  // ── پروفایل ──────────────────────────────────────────────────────────────

  @Get('me')
  async me(@Req() req: ShopRequest) {
    const me = await this.current(req);
    const [orders, addresses, wishlist] = await Promise.all([
      listOrders(this.db, me.customerId),
      listAddresses(this.db, me.customerId),
      listWishlist(this.db, me.customerId),
    ]);
    return {
      ...me,
      counts: {
        orders: orders.length,
        addresses: addresses.length,
        wishlist: wishlist.length,
      },
    };
  }

  @Patch('me')
  async updateMe(@Body() body: unknown, @Req() req: ShopRequest) {
    const me = await this.current(req);
    const patch = ProfileDto.parse(body);
    return updateProfile(this.db, me.customerId, {
      fullName: patch.fullName ?? null,
      nationalId: patch.nationalId ?? null,
      email: patch.email ?? null,
    });
  }

  // ── نشانی‌ها ─────────────────────────────────────────────────────────────

  @Get('addresses')
  async addresses(@Req() req: ShopRequest) {
    const me = await this.current(req);
    return { items: await listAddresses(this.db, me.customerId) };
  }

  @Post('addresses')
  async addAddress(@Body() body: unknown, @Req() req: ShopRequest) {
    const me = await this.current(req);
    const input = AddressDto.parse(body);
    return createAddress(this.db, me.customerId, input);
  }

  @Patch('addresses/:id')
  async editAddress(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: ShopRequest,
  ) {
    const me = await this.current(req);
    const patch = AddressPatchDto.parse(body);
    return updateAddress(this.db, me.customerId, id, patch);
  }

  @Delete('addresses/:id')
  async removeAddress(@Param('id') id: string, @Req() req: ShopRequest) {
    const me = await this.current(req);
    await deleteAddress(this.db, me.customerId, id);
    return { ok: true };
  }

  // ── علاقه‌مندی‌ها ────────────────────────────────────────────────────────

  @Get('wishlist')
  async wishlist(@Req() req: ShopRequest) {
    const me = await this.current(req);
    return { items: await listWishlist(this.db, me.customerId) };
  }

  @Post('wishlist')
  async wishlistAdd(@Body() body: unknown, @Req() req: ShopRequest) {
    const me = await this.current(req);
    const input = z.object({ variantId: z.string().uuid() }).parse(body);
    await addToWishlist(this.db, me.customerId, input.variantId);
    return { items: await listWishlist(this.db, me.customerId) };
  }

  @Delete('wishlist/:variantId')
  async wishlistRemove(@Param('variantId') variantId: string, @Req() req: ShopRequest) {
    const me = await this.current(req);
    await removeFromWishlist(this.db, me.customerId, variantId);
    return { items: await listWishlist(this.db, me.customerId) };
  }

  /** «همه را به سبد بریز» — ناموجودها جدا برمی‌گردند تا پنهان نشوند */
  @Post('wishlist/to-cart')
  async wishlistToCart(@Req() req: ShopRequest) {
    const me = await this.current(req);
    return wishlistToCart(this.db, me.customerId);
  }

  // ── سفارش‌ها ─────────────────────────────────────────────────────────────

  @Get('orders')
  async orders(@Req() req: ShopRequest) {
    const me = await this.current(req);
    return { items: await listOrders(this.db, me.customerId) };
  }

  @Get('orders/:orderNo')
  async order(@Param('orderNo') orderNo: string, @Req() req: ShopRequest) {
    const me = await this.current(req);
    const result = await getOrder(this.db, me.customerId, orderNo);
    const { rows: shipments } = await this.db.query(
      `SELECT id, shipment_no, carrier, tracking_code, status, shipped_at, delivered_at
       FROM shipments WHERE order_id = (SELECT id FROM orders WHERE order_no = $1 AND customer_id = $2) ORDER BY created_at DESC`,
      [orderNo, me.customerId],
    );
    return { ...result, shipments };
  }

  @Get('stats')
  async myStats(@Req() req: ShopRequest) {
    const me = await this.current(req);
    const { rows } = await this.db.query<{ total_orders: number; total_spent_rial: string; delivered: number; cancelled: number; active: number }>(
      `SELECT
         COUNT(*)::int AS total_orders,
         COALESCE(SUM(total_rial), 0)::text AS total_spent_rial,
         COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
         COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
         COUNT(*) FILTER (WHERE status NOT IN ('delivered','cancelled','refunded'))::int AS active
       FROM orders WHERE customer_id = $1`,
      [me.customerId],
    );
    const s = rows[0] ?? { total_orders: 0, total_spent_rial: '0', delivered: 0, cancelled: 0, active: 0 };
    return {
      totalOrders: s.total_orders,
      totalSpentToman: formatToman(BigInt(s.total_spent_rial)),
      delivered: s.delivered,
      cancelled: s.cancelled,
      activeOrders: s.active,
    };
  }

  // ── مرجوعی ──────────────────────────────────────────────────────────────
  //
  // مشتری خودش درخواست می‌دهد و خودش پیگیری می‌کند. دو قاعده اینجا حیاتی است:
  //   ۱) هر مسیر نخست بررسی می‌کند سفارش «مالِ همین مشتری» است — وگرنه با
  //      حدس‌زدنِ شناسه می‌شد سفارشِ دیگران را دید یا مرجوع کرد؛
  //   ۲) مشتری فقط می‌بیند؛ تعیینِ تکلیف و بازگشتِ وجه با کارمند است.

  /** مالکیتِ سفارش: درِ ورودِ همه‌ی مسیرهایِ مرجوعی */
  private async assertOwnOrder(orderId: string, customerId: string): Promise<{ id: string }> {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM orders WHERE id = $1 AND customer_id = $2`,
      [orderId, customerId],
    );
    const row = rows[0];
    if (!row) {
      throw new AppError('NOT_FOUND', { message: 'سفارشی با این شناسه برایِ شما نیست.' });
    }
    return row;
  }

  /** پیش‌نمایش: پیش از ثبت، مشتری دقیقاً می‌بیند چقدر برمی‌گردد */
  @Post('returns/quote')
  async returnQuote(
    @Body() body: { orderId?: string; items?: Array<{ orderItemId: string; quantity: number }>; kind?: string },
    @Req() req: ShopRequest,
  ) {
    const me = await this.current(req);
    if (!body?.orderId) throw new AppError('VALIDATION', { message: 'شناسه‌یِ سفارش لازم است.' });
    if (!body.items?.length) throw new AppError('VALIDATION', { message: 'دست‌کم یک کالا را انتخاب کنید.' });
    await this.assertOwnOrder(body.orderId, me.customerId);

    const quote = await quoteReturn(this.db, {
      orderId: body.orderId,
      items: body.items,
      kind: (body.kind as 'withdrawal' | 'defective' | 'warranty' | 'wrong_item') ?? 'withdrawal',
    });
    return {
      grossToman: formatToman(quote.grossRial),
      taxToman: formatToman(quote.taxRial),
      estimatedFeeToman: formatToman(quote.estimatedFeeRial),
      items: quote.items.map((i) => ({
        title: i.title,
        quantity: i.quantity,
        grossToman: formatToman(i.grossRial),
      })),
    };
  }

  @Post('returns')
  async createReturn(
    @Body()
    body: {
      orderId?: string;
      kind?: 'withdrawal' | 'defective' | 'warranty' | 'wrong_item';
      items?: Array<{ orderItemId: string; quantity: number }>;
      reason?: string;
      note?: string;
    },
    @Req() req: ShopRequest,
  ) {
    const me = await this.current(req);
    if (!body?.orderId) throw new AppError('VALIDATION', { message: 'شناسه‌یِ سفارش لازم است.' });
    if (!body.items?.length) throw new AppError('VALIDATION', { message: 'دست‌کم یک کالا را انتخاب کنید.' });
    await this.assertOwnOrder(body.orderId, me.customerId);

    const created = await requestReturn(this.db, {
      orderId: body.orderId,
      customerId: me.customerId,
      kind: body.kind ?? 'withdrawal',
      items: body.items,
      reason: body.reason ?? null,
      customerNote: body.note ?? null,
    });
    return {
      id: created.id,
      returnNo: created.returnNo,
      status: created.status,
      amountToman: formatToman(created.quote.grossRial),
    };
  }

  @Get('returns')
  async myReturns(@Req() req: ShopRequest) {
    const me = await this.current(req);
    const rows = await listReturns(this.db, { customerId: me.customerId, limit: 50 });
    return {
      items: rows.map((r) => ({
        id: r.id,
        returnNo: r.return_no,
        orderNo: r.order_no,
        kind: r.kind,
        status: r.status,
        itemCount: r.item_count,
        refundToman: formatToman(BigInt(r.refund_rial)),
        requestedAt: r.requested_at,
      })),
    };
  }

  @Get('shipping-options')
  async getShippingOptions(@Query('city') city?: string) {
    if (!city || city.trim().length < 2) {
      return { options: [], message: 'نام شهر را وارد کنید.' };
    }
    const options = await shippingOptions(this.db, city);
    return {
      options: options.map((o) => ({
        methodKey: o.methodKey,
        methodLabel: o.methodLabel,
        city: o.city,
        costRial: o.costRial.toString(),
        costToman: formatToman(o.costRial),
        etaDays: o.etaDays,
      })),
    };
  }

  @Get('warranties')
  async myWarranties(@Req() req: ShopRequest) {
    const me = await this.current(req);
    const rows = await listWarranties(this.db, { customerId: me.customerId, limit: 100 });
    return {
      items: rows.map((w) => ({
        id: w.id,
        title: w.title,
        sku: w.sku,
        serialNo: w.serial_no,
        startsAt: w.starts_at,
        endsAt: w.ends_at,
        months: w.months,
        status: w.status,
      })),
    };
  }
}
