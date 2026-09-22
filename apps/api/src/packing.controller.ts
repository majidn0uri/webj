import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from '@nestjs/common';

import { AppError } from '@set/shared-kernel';
import { PackingService, statusLabel, assertTransition } from '@set/orders';
import { StockAlertService, createShipment, markDelivered } from '@set/commerce';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import { sessionFromToken } from '@set/shopper';

import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * بسته‌بندی، و «خبرم کن وقتی موجود شد».
 *
 * دو دسته مسیرِ متفاوت با یک مرزِ روشن:
 *
 *   • **بسته‌بندی** در دستِ کارمند است (دسترسیِ orders.write) — گامی درونِ
 *     انبار که باید ثبت شود تا پشتیبان بتواند پاسخ بدهد.
 *   • **«خبرم کن»** در دستِ خریدار (نشستِ خریدار یا شماره برایِ مهمان) —
 *     درخواستی که با آمدنِ کالا، خودبه‌خود به پیام تبدیل می‌شود.
 */

function asText(value: unknown, field: string, max = 120): string {
  const text = String(value ?? '').trim();
  if (text.length === 0) throw new AppError('VALIDATION', { message: `${field} را بنویسید.` });
  return text.slice(0, max);
}

function optionalText(value: unknown, max = 500): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return String(value).slice(0, max);
}

/** شماره‌یِ همراهِ ایرانی — برایِ مهمانی که حساب ندارد */
function asPhone(value: unknown): string {
  const phone = String(value ?? '').replace(/[^\d]/g, '');
  if (!/^09\d{9}$/.test(phone)) {
    throw new AppError('VALIDATION', { message: 'شماره‌یِ همراه را درست بنویسید (مانندِ ۰۹۱۲۳۴۵۶۷۸۹).' });
  }
  return phone;
}

@Controller()
export class PackingController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  private readonly packing = (): PackingService => new PackingService(this.db);
  private readonly alerts = (): StockAlertService => new StockAlertService(this.db);

  private async require(
    authorization: string | undefined,
    permission: 'orders.read' | 'orders.write',
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    const [resource, action] = permission.split('.');
    await this.access.assert({ userId: claims.sub, branchId: null }, resource!, action!);
    return claims;
  }

  private async shopper(headers: Record<string, string | undefined>) {
    const cookie = headers?.cookie ?? '';
    const fromCookie = /(?:^|;\s*)set_customer_token=([^;]+)/.exec(cookie);
    const token = fromCookie?.[1]
      ? decodeURIComponent(fromCookie[1])
      : (headers?.['x-shopper-token'] ?? '').replace(/^Bearer\s+/, '') || null;
    return sessionFromToken(this.db, token);
  }

  /** ── بسته‌بندی (پنل) ──────────────────────────────────────────────── */

  /** صفِ کارِ انبار: سفارش‌هایی که باید بسته شوند */
  @Get('admin/orders/packing')
  async queue(
    @Headers('authorization') authorization: string | undefined,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    await this.require(authorization, 'orders.read');
    return this.packing().queue({
      limit: limit ? Number(limit) : 30,
      offset: offset ? Number(offset) : 0,
    });
  }

  /** اقلامِ یک سفارش با موجودیِ لحظه‌ای — برگه‌یِ بستن */
  @Get('admin/orders/:id/packing')
  async lines(@Param('id') id: string, @Headers('authorization') authorization: string | undefined) {
    await this.require(authorization, 'orders.read');
    const res = await this.db.query<{ status: string }>(`SELECT status FROM orders WHERE id = $1`, [id]);
    const order = res.rows[0];
    if (!order) throw new AppError('NOT_FOUND', { message: 'سفارش یافت نشد.' });
    const lines = await this.packing().lines(id);
    return { status: order.status, statusLabel: statusLabel(order.status), lines };
  }

  /** تأیید سفارش توسط مدیر — از paid به confirmed */
  @Post('admin/orders/:id/confirm')
  async confirm(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const claims = await this.require(authorization, 'orders.write');

    const { rows: before } = await this.db.query<{ status: string; order_no: string; customer_mobile: string | null }>(
      `SELECT status, order_no, customer_mobile FROM orders WHERE id = $1`, [id],
    );
    const order = before[0];
    if (!order) throw new AppError('NOT_FOUND', { message: 'سفارش یافت نشد.' });
    assertTransition(order.status, 'confirmed');

    await this.db.query(
      `UPDATE orders SET status = 'confirmed' WHERE id = $1`, [id],
    );
    await this.db.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, actor_user_id, reason)
       VALUES ($1,$2,'confirmed',$3,$4)`,
      [id, order.status, claims.sub, optionalText(body.reason) ?? null],
    );

    return { id, status: 'confirmed', statusLabel: statusLabel('confirmed') };
  }

  @Post('admin/orders/:id/pack')
  async pack(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const claims = await this.require(authorization, 'orders.write');
    const complete = body.complete === undefined ? undefined : body.complete === true || body.complete === 'true';
    return this.packing().pack({
      orderId: id,
      actorId: claims.sub,
      complete,
      note: optionalText(body.note),
    });
  }

  /** بازگشت از بسته‌بندی — اگر کالایِ اشتباهی بسته شده باشد */
  @Post('admin/orders/:id/unpack')
  async unpack(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const claims = await this.require(authorization, 'orders.write');
    return this.packing().unpack(id, claims.sub, optionalText(body.reason) ?? null);
  }

  /**
   * ارسال — تنها پس از بسته‌بندی.
   *
   * این مسیر تا امروز در کارساز نبود؛ یعنی هیچ راهی برایِ ثبتِ ارسال جز
   * تغییرِ مستقیمِ پایگاه وجود نداشت. اکنون ارسال از همان مهارِ بسته‌بندی
   * می‌گذرد: کدِ رهگیری برای بسته‌ای صادر می‌شود که می‌دانیم چه کسی و کی
   * آن را بسته است.
   */
  @Post('admin/orders/:id/ship')
  async ship(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const claims = await this.require(authorization, 'orders.write');
    return createShipment(this.db, {
      orderId: id,
      carrier: asText(body.carrier ?? 'پست', 'روشِ ارسال', 40),
      trackingCode: asText(body.trackingCode ?? '', 'کدِ رهگیری', 60),
      costRial: body.costRial ? BigInt(String(body.costRial)) : 0n,
      receiverName: optionalText(body.receiverName, 120) ?? null,
      actorId: claims.sub,
    });
  }

  /** تحویل — پایانِ راه برایِ سفارشِ ارسالی */
  @Post('admin/orders/:id/deliver')
  async deliver(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const claims = await this.require(authorization, 'orders.write');
    const shipmentId = optionalText(body.shipmentId, 40);
    if (!shipmentId) throw new AppError('VALIDATION', { message: 'مرسوله را نشانی نکرده‌اید.' });
    return markDelivered(this.db, shipmentId, claims.sub);
  }

  /** ── «خبرم کن وقتی موجود شد» (سایت) ───────────────────────────────── */

  /**
   * ثبتِ درخواست.
   *
   * اگر بیننده وارد باشد با شناسه‌اش ثبت می‌شود (و بعداً در حسابش می‌بیند)؛
   * وگرنه با شماره‌ای که می‌نویسد. بی‌هیچ‌کدام نمی‌شود — چون نمی‌دانیم به
   * که خبر بدهیم.
   */
  @Post('shop/stock-alerts')
  async subscribe(@Body() body: Record<string, unknown>, @Headers() headers: Record<string, string | undefined>) {
    const session = await this.shopper(headers);
    const variantId = asText(body.variantId ?? '', 'تنوعِ کالا', 40);
    const phone = body.phone ? asPhone(body.phone) : null;

    if (!session && !phone) {
      throw new AppError('UNAUTHENTICATED', { message: 'شماره‌یِ همراه را بنویسید تا خبرتان کنیم.' });
    }

    const result = await this.alerts().request({
      variantId,
      customerId: session?.customerId ?? null,
      phone,
      source: 'web',
    });
    return {
      available: result.available,
      alreadyWaiting: result.alreadyWaiting,
      // درخواستی که تازه ساخته نشده (کالا موجود بوده) شناسه ندارد
      notification: result.notification ?? null,
    };
  }

  @Get('shop/stock-alerts')
  async mine(@Headers() headers: Record<string, string | undefined>) {
    const session = await this.shopper(headers);
    if (!session) throw new AppError('UNAUTHENTICATED', { message: 'برایِ دیدنِ فهرست باید وارد شوید.' });
    const items = await this.alerts().listForCustomer(session.customerId);
    return { items };
  }

  @Post('shop/stock-alerts/:id/cancel')
  async cancel(@Param('id') id: string, @Headers() headers: Record<string, string | undefined>) {
    const session = await this.shopper(headers);
    if (!session) throw new AppError('UNAUTHENTICATED', { message: 'برایِ لغو باید وارد شوید.' });

    // تنها درخواستِ خودِ مشتری لغو می‌شود
    const items = await this.alerts().listForCustomer(session.customerId);
    if (!items.some((item: { id: string }) => item.id === id)) {
      throw new AppError('NOT_FOUND', { message: 'چنین درخواستی برایِ شما نیست.' });
    }
    const cancelled = await this.alerts().cancel(id);
    return { cancelled };
  }

  /** راهِ کوتاه برایِ سنجه‌ی سلامت: گذاری را بی‌اثر می‌آزماید */
  @Get('admin/orders/cycle')
  async cycle(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization, 'orders.read');
    const sample: Array<[string, string, boolean]> = [];
    const pairs: Array<{ from: string; to: string }> = [
      { from: 'confirmed', to: 'packing' },
      { from: 'packing', to: 'shipped' },
      { from: 'pending_payment', to: 'packing' },
      { from: 'shipped', to: 'packing' },
    ];
    for (const pair of pairs) {
      let allowed = true;
      try {
        assertTransition(pair.from, pair.to as 'packing' | 'shipped' | 'delivered');
      } catch {
        allowed = false;
      }
      sample.push([pair.from, pair.to, allowed]);
    }
    return { transitions: sample };
  }
}
