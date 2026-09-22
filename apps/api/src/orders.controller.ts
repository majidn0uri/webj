import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, formatToman } from '@set/shared-kernel';
import type { Database } from '@set/db';
import { publishEvent } from '@set/db';
import { OrderService } from '@set/orders';
import { enqueueSms } from '@set/commerce';
import { DB, TOKEN_SERVICE } from './tokens.js';
import type { TokenService } from '@set/auth';

const CreateOrderDto = z.object({
  items: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().positive() })).min(1),
  idempotencyKey: z.string().min(6).nullish(),
  customerName: z.string().min(3).nullish(),
  customerMobile: z.string().min(10).nullish(),
  shippingAddress: z.record(z.unknown()).nullish(),
  shippingRial: z.string().nullish(),
  reservationMinutes: z.number().int().min(1).max(120).nullish(),
  // کدِ تخفیف — اختیاری؛ اگر نامعتبر باشد، کلِ ثبت با پیامِ فارسی رد می‌شود
  couponCode: z.string().min(2).max(64).nullish(),
});

const PayDto = z.object({ referenceNo: z.string().nullish() });

@Controller('orders')
export class OrdersController {
  private readonly orders: OrderService;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
  ) {
    this.orders = new OrderService(db);
  }

  /**
   * مشتریِ متناظر با این خریدار.
   *
   * چرا از موبایل و نه از شناسه‌یِ کاربر؟ چون در این پروژه جدولِ مشتریان
   * ستونی برایِ پیوند به کاربر ندارد و شماره‌یِ تلفن همان چیزی است که
   * سفارش‌هایِ مهمان و حساب‌دار را به هم می‌دوزد. اگر مشتری‌ای نباشد،
   * تهی برمی‌گردانیم — کوپنِ بی‌مشتری همچنان کار می‌کند، بی‌سهمیه.
   */
  private async resolveCustomerId(
    mobile: string | null,
    claimMobile: string | null,
  ): Promise<string | null> {
    const phone = (mobile ?? claimMobile)?.trim();
    if (!phone) return null;
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM customers WHERE phone = $1 ORDER BY created_at ASC LIMIT 1`,
      [phone],
    );
    return rows[0]?.id ?? null;
  }

  @Post()
  async create(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    const claims = await this.optionalUser(authorization);
    const input = CreateOrderDto.parse(body);

    // مشتری با شماره‌یِ تلفن شناخته می‌شود (جدولِ customers ستونِ پیوند به
    // کاربر ندارد): اگر خریدار حساب دارد، مشتریِ هم‌موبایلش را می‌یابیم تا
    // سهمیه‌یِ کوپن درست حساب شود و سفارش در «سفارش‌هایِ من» بنشیند.
    const customerId = await this.resolveCustomerId(
      input.customerMobile ?? null,
      claims?.mobile ?? null,
    );

    const order = await this.orders.createOrder({
      userId: claims?.sub ?? null,
      customerId,
      couponCode: input.couponCode ?? null,
      items: input.items,
      idempotencyKey: input.idempotencyKey ?? null,
      customerName: input.customerName ?? null,
      customerMobile: input.customerMobile ?? null,
      shippingAddress: input.shippingAddress ?? null,
      shippingRial: input.shippingRial ? BigInt(input.shippingRial) : 0n,
      reservationMinutes: input.reservationMinutes ?? 15,
    });

    return {
      ...order,
      display: {
        subtotal: formatToman(BigInt(order.totals.subtotalRial)),
        discount: formatToman(BigInt(order.totals.discountRial)),
        tax: formatToman(BigInt(order.totals.taxRial)),
        shipping: formatToman(BigInt(order.totals.shippingRial)),
        total: formatToman(BigInt(order.totals.totalRial)),
      },
    };
  }

  /** پرداختِ آزمایشی (sandbox) — در فاز بعد به درگاهِ ایرانی وصل می‌شود */
  @Post(':id/pay')
  @HttpCode(200)
  async pay(@Param('id') id: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    const { referenceNo } = PayDto.parse(body ?? {});
    const order = await this.orders.getOrder(id);
    if (!order) throw new AppError('NOT_FOUND');

    const result = await this.orders.confirmPayment(id, {
      amountRial: BigInt(order.total_rial as string),
      method: 'sandbox',
      referenceNo: referenceNo ?? `SANDBOX-${Date.now()}`,
    });

    await publishEvent(this.db, {
      aggregate: 'order',
      aggregateId: id,
      eventType: 'order.paid.sandbox',
      payload: { referenceNo: referenceNo ?? null, ip: req.ip ?? null },
    });

    return {
      ...result,
      paidAmount: formatToman(BigInt(order.total_rial as string)),
      referenceNo: referenceNo ?? null,
    };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Body() body: unknown) {
    const reason = (body as { reason?: string } | null)?.reason ?? 'customer_request';
    // اطلاعاتِ سفارش پیش از لغو (برای پیامک)
    const orderBefore = await this.orders.getOrder(id);
    const result = await this.orders.cancel(id, reason);
    // پیامکِ لغو
    try {
      if (orderBefore?.customer_mobile) {
        await enqueueSms(this.db, {
          phone: orderBefore.customer_mobile,
          templateKey: 'order_cancelled',
          vars: { order: orderBefore.order_no, amount: formatToman(BigInt(orderBefore.total_rial)) },
        });
      }
    } catch { /* پیامک نباید لغو را متوقف کند */ }
    return result;
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const order = await this.orders.getOrder(id);
    if (!order) throw new AppError('NOT_FOUND');
    return {
      ...order,
      display: {
        total: formatToman(BigInt(order.total_rial as string)),
        tax: formatToman(BigInt(order.tax_rial as string)),
      },
    };
  }

  /** کاربرِ احتمالی — سبدِ مهمان هم باید بتواند سفارش بسازد */
  private async optionalUser(authorization?: string) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) return null;
    return this.tokens.verifyAccess(token);
  }
}
