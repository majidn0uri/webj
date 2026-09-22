import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { sessionFromToken } from '@set/shopper';
import { AppError, formatToman } from '@set/shared-kernel';
import type { Database } from '@set/db';
import { CartService } from '@set/cart';
import { tariffFor, registerCheck } from '@set/commerce';
import { DB } from './tokens.js';

const AddItemDto = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  replace: z.boolean().nullish(),
});

const CheckoutDto = z.object({
  idempotencyKey: z.string().min(6),
  customerName: z.string().min(3).nullish(),
  customerMobile: z.string().min(10).nullish(),
  shippingAddress: z.string().min(10).nullish(),
  shippingRial: z.string().nullish(),
  shippingMethodKey: z.string().nullish(),
  vatBasisPoints: z.number().int().min(0).max(1000).nullish(),
  couponCode: z.string().min(2).max(64).nullish(),
  /** روش پرداخت: online (پیش‌فرض), credit (نسیه همکار), cheque (چک همکار) */
  paymentMethod: z.enum(['online', 'credit', 'cheque']).nullish(),
  /** اطلاعات چک — فقط اگر paymentMethod = cheque */
  checkNo: z.string().nullish(),
  checkBank: z.string().nullish(),
  checkSayadNo: z.string().regex(/^[0-9]{16}$/).nullish(),
  checkDueDate: z.string().nullish(),
});

@Controller('cart')
export class CartController {
  private readonly carts: CartService;

  constructor(@Inject(DB) private readonly db: Database) {
    this.carts = new CartService(db);
  }

  /**
   * ایجادِ سبد — مرورگر شناسه را در کوکی نگه می‌دارد.
   *
   * چرا `userId` از بدنه حذف شد؟ چون سبد «مالِ» کسی است که بعداً در
   * «سفارش‌هایِ من» دنبالش می‌گردد؛ اگر شناسه را خودِ درخواست تعیین می‌کرد،
   * هر کس می‌توانست سبد و سفارشش را به حسابِ دیگری بچسباند: هم تاریخچه‌یِ
   * آن مشتری را آلوده می‌کرد و هم با یک ایمیل/پیامکِ «سفارشِ شما ثبت شد»
   * راهِ فیشینگ را باز می‌کرد. مالک از نشانه‌یِ مشتری می‌آید یا اصلاً
   * وجود ندارد (میهمان).
   */
  @Post()
  async create(@Body() body: unknown, @Req() req?: { headers?: Record<string, string | undefined> }) {
    const input = z.object({ channel: z.string().nullish() }).parse(body ?? {});
    const shopper = await sessionFromToken(this.db, this.shopperToken(req));
    return {
      cartId: await this.carts.createCart({
        userId: shopper?.customerId ?? null,
        channel: input.channel ?? undefined,
      }),
    };
  }

  /**
   * خروجیِ سبد: مبالغِ نمایشی روی **همان ردیف‌ها** می‌آید، نه در آرایه‌ای جدا.
   * مصرف‌کننده نباید دو آرایه را با هم جفت کند — این منبعِ خطا است.
   */
  @Get(':id')
  async get(@Param('id') id: string) {
    const cart = await this.carts.getCart(id);
    return {
      ...cart,
      items: cart.items.map((i) => ({
        ...i,
        display: {
          lineTotal: formatToman(BigInt(i.lineTotalRial)),
          unitPrice: formatToman(BigInt(i.currentPriceRial)),
          priceAtAdd: formatToman(BigInt(i.priceAtAddRial)),
        },
      })),
      display: { subtotal: formatToman(BigInt(cart.subtotalRial)) },
    };
  }

  @Post(':id/items')
  async addItem(@Param('id') id: string, @Body() body: unknown) {
    const input = AddItemDto.parse(body);
    await this.carts.addItem({
      cartId: id,
      variantId: input.variantId,
      quantity: input.quantity,
      replace: input.replace ?? undefined,
    });
    return this.get(id);
  }

  @Delete(':id/items/:variantId')
  @HttpCode(200)
  async removeItem(@Param('id') id: string, @Param('variantId') variantId: string) {
    await this.carts.removeItem(id, variantId);
    return this.get(id);
  }

  /**
   * تسویه‌حساب: رزروِ اتمیکِ موجودی در همین‌جا انجام می‌شود.
   * مشتری تا پیش از این لحظه هیچ تعهدی ندارد و از این لحظه موجودی برایش نگه داشته می‌شود.
   */
  /** نشانه‌ی مشتری از کوکی (همان کلیدی که مسیرهایِ /shop می‌خوانند) */
  private shopperToken(req?: { headers?: Record<string, string | undefined> }): string | null {
    const cookie = req?.headers?.cookie ?? '';
    const found = /(?:^|;\s*)set_customer_token=([^;]+)/.exec(cookie);
    return found?.[1] ? decodeURIComponent(found[1]) : null;
  }

  @Post(':id/checkout')
  async checkout(@Param('id') id: string, @Body() body: unknown, @Req() req?: { headers?: Record<string, string | undefined> }) {
    const input = CheckoutDto.parse(body);
    // اگر مشتری واردِ حسابش باشد، سفارش به همان حساب پیوند می‌خورد (و بعداً در
    // «سفارش‌هایِ من» دیده می‌شود). شناسه از نشانه گرفته می‌شود، نه از بدنه‌ی
    // درخواست — وگرنه هر کس می‌توانست سفارشش را به حسابِ دیگری بچسباند.
    const shopper = await sessionFromToken(this.db, this.shopperToken(req));

    // بررسی اطلاعات مشتری (همکار بودن + سقف اعتبار)
    let cust: { is_partner: boolean; credit_rial: string | null; check_ceiling_rial: string | null } | null = null;
    if (shopper?.customerId) {
      const { rows } = await this.db.query<{ is_partner: boolean; credit_rial: string | null; check_ceiling_rial: string | null }>(
        `SELECT is_partner, credit_rial::text, check_ceiling_rial::text FROM customers WHERE id = $1`,
        [shopper.customerId],
      );
      cust = rows[0] ?? null;
      if (cust?.is_partner) {
        const { rows: debt } = await this.db.query<{ unpaid: string }>(
          `SELECT COALESCE(SUM(total_rial), 0)::text AS unpaid FROM orders
            WHERE customer_id = $1 AND status NOT IN ('paid','delivered','cancelled','refunded')`,
          [shopper.customerId],
        );
        const creditRial = BigInt(cust.credit_rial ?? '0');
        const unpaidRial = BigInt(debt[0]?.unpaid ?? '0');
        if (creditRial > 0n && unpaidRial >= creditRial) {
          throw new AppError('FORBIDDEN', { message: 'سقف اعتبار شما پر شده است. لطفاً بدهی قبلی را تسویه کنید.' });
        }
      }
    }

    // محاسبه هزینه ارسال از جدول تعرفه (اگر روش ارسال انتخاب شده)
    let shippingRial = input.shippingRial ? BigInt(input.shippingRial) : 0n;
    if (input.shippingMethodKey && input.shippingAddress) {
      const city = input.shippingAddress.split('،')[0]?.trim() ?? '';
      if (city) {
        const tariff = await tariffFor(this.db, input.shippingMethodKey, city);
        if (tariff) shippingRial = tariff.costRial;
      }
    }

    // پرداخت نسیه (فقط همکار)
    if (input.paymentMethod === 'credit') {
      if (!cust?.is_partner) {
        throw new AppError('FORBIDDEN', { message: 'خرید نسیه فقط برای همکاران مجاز است.' });
      }
    }

    // پرداخت با چک (فقط همکار)
    if (input.paymentMethod === 'cheque') {
      if (!cust?.is_partner) {
        throw new AppError('FORBIDDEN', { message: 'پرداخت با چک فقط برای همکاران مجاز است.' });
      }
      if (!input.checkNo || !input.checkBank || !input.checkDueDate || !input.checkSayadNo) {
        throw new AppError('VALIDATION', { message: 'اطلاعات چک (شماره، شناسه صیاد ۱۶ رقمی، بانک، سررسید) الزامی است.' });
      }
    }

    const result = await this.carts.checkout({
      cartId: id,
      idempotencyKey: input.idempotencyKey,
      userId: shopper?.customerId ?? null,
      customerName: input.customerName ?? shopper?.fullName ?? null,
      customerMobile: input.customerMobile ?? shopper?.phone ?? null,
      customerId: shopper?.customerId ?? null,
      shippingAddress: input.shippingAddress ?? null,
      shippingRial,
      vatBasisPoints: input.vatBasisPoints ?? undefined,
      couponCode: input.couponCode ?? null,
    });

    // پرداخت نسیه: سفارش مستقیم paid می‌شود (بدون درگاه)
    if (input.paymentMethod === 'credit' && result.orderId) {
      const { OrderService } = await import('@set/orders');
      const orderSvc = new OrderService(this.db);
      await orderSvc.confirmPayment(result.orderId, {
        amountRial: BigInt(result.totalRial),
        method: 'credit',
        referenceNo: `CREDIT-${result.orderNo}`,
      });
    }

    // پرداخت با چک: ثبت چک + سفارش paid
    if (input.paymentMethod === 'cheque' && result.orderId && shopper?.customerId) {
      await registerCheck(this.db, {
        drawerId: shopper.customerId,
        checkNo: input.checkNo!,
        sayadNo: input.checkSayadNo!,
        bank: input.checkBank!,
        amountRial: BigInt(result.totalRial),
        dueDate: new Date(input.checkDueDate!),
      });
      const { OrderService } = await import('@set/orders');
      const orderSvc = new OrderService(this.db);
      await orderSvc.confirmPayment(result.orderId, {
        amountRial: BigInt(result.totalRial),
        method: 'cheque',
        referenceNo: `CHECK-${input.checkNo}`,
      });
    }

    return {
      ...result,
      display: { total: formatToman(BigInt(result.totalRial)) },
      paymentMethod: input.paymentMethod ?? 'online',
    };
  }
}
