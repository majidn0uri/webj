import type { Database, Queryable } from '@set/db';
import { AppError, type Rial } from '@set/shared-kernel';
import { OrderService, effectiveVatBasisPoints } from '@set/orders';

/**
 * سبدِ خرید.
 *
 * دو تصمیمِ مهم:
 *  ۱) سبد موجودی را رزرو نمی‌کند — رزرو فقط در لحظه‌ی پرداخت و اتمیک است.
 *  ۲) سبد قیمت را «در لحظه‌ی افزودن» نگه می‌دارد تا اگر قیمت تغییر کرد،
 *     مشتری پیش از پرداخت بفهمد. پنهان کردنِ این تغییر تا صفحه‌ی پرداخت،
 *     یکی از شکایت‌هایِ رایجِ خریداران است.
 */
export interface CartItemView {
  variantId: string;
  sku: string;
  title: string;
  productSlug: string;
  quantity: number;
  priceAtAddRial: string;
  currentPriceRial: string;
  priceChanged: boolean;
  lineTotalRial: string;
  available: number;
  enoughStock: boolean;
  volumeDiscount?: { type: string; value: string } | null;
}

export interface CartView {
  cartId: string;
  status: string;
  items: CartItemView[];
  subtotalRial: string;
  itemCount: number;
  hasPriceChanges: boolean;
  hasStockProblems: boolean;
  /**
   * نرخِ ارزش‌افزوده (درصد) که سرور حساب خواهد کرد.
   * چرا همراهِ سبد می‌آید؟ چون اگر مشتری نرخی را ببیند که سامانه حساب
   * نمی‌کند، برگه‌یِ سبد دارد دروغ می‌گوید — و این دروغ در همان نقطه‌ای
   * است که مشتری تصمیم به پرداخت می‌گیرد.
   */
  vatPercent: number;
}

export class CartService {
  private readonly orders: OrderService;

  constructor(private readonly db: Database) {
    this.orders = new OrderService(db);
  }

  async createCart(input: { userId?: string | null; channel?: string } = {}): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO carts (user_id, channel) VALUES ($1, $2) RETURNING id`,
      [input.userId ?? null, input.channel ?? 'web'],
    );
    return rows[0]!.id;
  }

  /** افزودن/به‌روزرسانیِ یک ردیف — با گرفتنِ قیمت از جدولِ تنوع، نه از ورودیِ کاربر */
  async addItem(input: {
    cartId: string;
    variantId: string;
    quantity: number;
    replace?: boolean;
  }): Promise<void> {
    if (input.quantity < 1 || input.quantity > 99) {
      throw new AppError('VALIDATION', { details: { quantity: 'تعداد باید بین ۱ تا ۹۹ باشد' } });
    }

    return this.db.transaction(async (tx) => {
      await this.assertActiveCart(tx, input.cartId);

      const { rows } = await tx.query<{ price_rial: string; is_active: boolean }>(
        `SELECT price_rial, is_active FROM product_variants WHERE id = $1`,
        [input.variantId],
      );
      const variant = rows[0];
      if (!variant) throw new AppError('NOT_FOUND', { details: { message: 'این تنوع وجود ندارد' } });
      if (!variant.is_active) {
        throw new AppError('VALIDATION', { details: { message: 'این تنوع دیگر فروخته نمی‌شود' } });
      }

      await tx.query(
        `INSERT INTO cart_items (cart_id, variant_id, quantity, price_at_add_rial)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (cart_id, variant_id)
         DO UPDATE SET
           quantity = CASE WHEN $5 THEN EXCLUDED.quantity
                           ELSE LEAST(cart_items.quantity + EXCLUDED.quantity, 99) END,
           updated_at = now()`,
        [input.cartId, input.variantId, input.quantity, variant.price_rial, input.replace ?? false],
      );

      await tx.query(`UPDATE carts SET updated_at = now() WHERE id = $1`, [input.cartId]);
    });
  }

  async removeItem(cartId: string, variantId: string): Promise<void> {
    const { affectedRows } = await this.db.query(
      `DELETE FROM cart_items WHERE cart_id = $1 AND variant_id = $2`,
      [cartId, variantId],
    );
    if (!affectedRows) throw new AppError('NOT_FOUND');
    await this.db.query(`UPDATE carts SET updated_at = now() WHERE id = $1`, [cartId]);
  }

  async clear(cartId: string): Promise<void> {
    await this.db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);
  }

  /** خواندنِ سبد با قیمتِ فعلی، موجودیِ واقعی و نشان‌گذاریِ تغییرات */
  async getCart(cartId: string): Promise<CartView> {
    const { rows: cartRows } = await this.db.query<{ id: string; status: string }>(
      `SELECT id, status FROM carts WHERE id = $1`, [cartId],
    );
    const cart = cartRows[0];
    if (!cart) throw new AppError('NOT_FOUND');

    const { rows } = await this.db.query<{
      variant_id: string; sku: string; title: string; slug: string;
      quantity: number; price_at_add_rial: string; price_rial: string; available: number;
    }>(
      `SELECT ci.variant_id, v.sku, p.title, p.slug,
              ci.quantity, ci.price_at_add_rial::text, v.price_rial::text,
              COALESCE(s.on_hand - s.reserved, 0) AS available
         FROM cart_items ci
         JOIN product_variants v ON v.id = ci.variant_id
         JOIN products p ON p.id = v.product_id
         LEFT JOIN stock_items s ON s.variant_id = ci.variant_id
        WHERE ci.cart_id = $1
        ORDER BY ci.added_at`,
      [cartId],
    );

    const items: CartItemView[] = rows.map((r) => {
      const atAdd = BigInt(r.price_at_add_rial);
      const current = BigInt(r.price_rial);
      return {
        variantId: r.variant_id,
        sku: r.sku,
        title: r.title,
        productSlug: r.slug,
        quantity: r.quantity,
        priceAtAddRial: atAdd.toString(),
        currentPriceRial: current.toString(),
        priceChanged: atAdd !== current,
        lineTotalRial: (current * BigInt(r.quantity)).toString(),
        available: r.available,
        enoughStock: r.available >= r.quantity,
      };
    });

    // تخفیف حجمی: اگر تعداد ≥ حداقل، تخفیف اعمال شود
    for (const item of items) {
      const { rows: vd } = await this.db.query<{ discount_type: string; discount_value: string }>(
        `SELECT discount_type, discount_value::text FROM volume_discounts
         WHERE product_id = (SELECT product_id FROM product_variants WHERE id = $1)
           AND min_quantity <= $2 AND is_active = true
         ORDER BY min_quantity DESC LIMIT 1`,
        [item.variantId, item.quantity],
      );
      if (vd[0]) {
        const unitPrice = BigInt(item.currentPriceRial);
        const discountRial = vd[0].discount_type === 'percent'
          ? (unitPrice * BigInt(vd[0].discount_value)) / 100n
          : BigInt(vd[0].discount_value);
        const discountedUnit = unitPrice - discountRial;
        item.currentPriceRial = discountedUnit.toString();
        item.lineTotalRial = (discountedUnit * BigInt(item.quantity)).toString();
        item.volumeDiscount = { type: vd[0].discount_type, value: vd[0].discount_value };
      }
    }

    const subtotal = items.reduce((sum, i) => sum + BigInt(i.lineTotalRial), 0n);

    return {
      cartId: cart.id,
      status: cart.status,
      items,
      subtotalRial: subtotal.toString(),
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      hasPriceChanges: items.some((i) => i.priceChanged),
      hasStockProblems: items.some((i) => !i.enoughStock),
      vatPercent: (await effectiveVatBasisPoints(this.db)) / 100,
    };
  }

  /**
   * تسویه‌حساب: سبد به سفارش تبدیل می‌شود.
   * رزروِ موجودی در همین‌جا و اتمیک انجام می‌گیرد (تفاوتِ اصلی با سیستم‌هایِ قالبی).
   * سبد پس از موفقیت بسته می‌شود تا دو بار تسویه نشود.
   */
  async checkout(input: {
    cartId: string;
    idempotencyKey: string;
    userId?: string | null;
    customerName?: string | null;
    customerMobile?: string | null;
    /** شناسه‌ی مشتری در صورتِ ورود — سفارش به «سفارش‌هایِ من» پیوند می‌خورد */
    customerId?: string | null;
    shippingAddress?: string | null;
    shippingRial?: Rial;
    vatBasisPoints?: number;
    reservationMinutes?: number;
    /** کدِ تخفیف — در همان تراکنشِ ثبتِ سفارش ارزیابی و مصرف می‌شود */
    couponCode?: string | null;
  }): Promise<{ orderId: string; orderNo: string; totalRial: string; duplicate: boolean }> {
    return this.db.transaction(async (tx) => {
      // قفلِ سبد: دو تب که هم‌زمان «پرداخت» بزنند، فقط یکی ادامه می‌یابد
      const { rows: cartRows } = await tx.query<{ id: string; status: string; user_id: string | null }>(
        `SELECT id, status, user_id FROM carts WHERE id = $1 FOR UPDATE`, [input.cartId],
      );
      const cart = cartRows[0];
      if (!cart) throw new AppError('NOT_FOUND');
      if (cart.status !== 'active') {
        throw new AppError('CONFLICT', { details: { message: 'این سبد قبلاً تسویه شده است' } });
      }

      const { rows } = await tx.query<{ variant_id: string; quantity: number }>(
        `SELECT variant_id, quantity FROM cart_items WHERE cart_id = $1 ORDER BY variant_id`,
        [input.cartId],
      );
      if (!rows.length) {
        throw new AppError('VALIDATION', { details: { message: 'سبد خالی است' } });
      }

      const order = await this.orders.createOrder({
        channel: 'web',
        userId: input.userId ?? cart.user_id ?? null,
        items: rows.map((r) => ({ variantId: r.variant_id, quantity: r.quantity })),
        idempotencyKey: input.idempotencyKey,
        customerName: input.customerName ?? null,
        customerMobile: input.customerMobile ?? null,
        customerId: input.customerId ?? null,
        // ستونِ shipping_address از نوع jsonb است؛ رشته‌ی ساده را ساختارمند می‌کنیم
        shippingAddress: input.shippingAddress ? { address: input.shippingAddress } : null,
        shippingRial: input.shippingRial ?? 0n,
        vatBasisPoints: input.vatBasisPoints,
        couponCode: input.couponCode ?? null,
        reservationMinutes: input.reservationMinutes ?? 15,
      }, tx);

      await tx.query(`UPDATE carts SET status = 'checked_out', updated_at = now() WHERE id = $1`, [
        input.cartId,
      ]);

      return {
        orderId: order.orderId,
        orderNo: order.orderNo,
        totalRial: order.totals.totalRial,
        duplicate: Boolean(order.duplicate),
      };
    });
  }

  private async assertActiveCart(tx: Queryable, cartId: string): Promise<void> {
    const { rows } = await tx.query<{ status: string; expires_at: string }>(
      `SELECT status, expires_at FROM carts WHERE id = $1`, [cartId],
    );
    const cart = rows[0];
    if (!cart) throw new AppError('NOT_FOUND', { details: { message: 'سبد یافت نشد' } });
    if (cart.status !== 'active') {
      throw new AppError('CONFLICT', { details: { message: 'این سبد بسته شده است' } });
    }
    if (new Date(cart.expires_at) < new Date()) {
      throw new AppError('CONFLICT', { details: { message: 'این سبد منقضی شده است' } });
    }
  }
}
