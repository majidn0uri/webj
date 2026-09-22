export * from './packing.js';
export * from './cycle.js';
import type { Database, Queryable } from '@set/db';
import { nextNumber, publishEvent } from '@set/db';
import { AppError, calcLine, sumLines, type Rial, getYear } from '@set/shared-kernel';
import { reserveStock, confirmStock, releaseStock } from '@set/inventory';
import { AccountingService } from '@set/accounting';
import {
  applyCouponRecord,
  redeemCoupon,
  releaseCoupon,
  validateCoupon,
  type CouponLine,
} from '@set/coupons';

/**
 * سفارش — جریانی که در آن «پول، موجودی و سند» با هم و در یک تراکنش تغییر می‌کنند.
 *
 * ترتیبِ دقیق (برای جلوگیری از بن‌بست و از نیمه‌کاره ماندن):
 *   ۱) بررسیِ کلیدِ یکتایی (اگر تکراری است، همان سفارشِ قبلی برگردانده می‌شود)
 *   ۲) گرفتنِ شماره‌ی سفارش (اتمیک، بدون MAX)
 *   ۳) عکس‌برداری از قیمت‌ها و محاسبه‌ی ردیف‌ها (تخفیف پیش از مالیات)
 *   ۴) رزروِ موجودی (Update شرطی)
 *   ۵) درجِ سفارش و ردیف‌ها
 *   ۶) ثبتِ رخداد در Outbox
 * اگر هر مرحله شکست بخورد، هیچ‌کدام اعمال نمی‌شوند.
 */

export interface OrderItemInput {
  variantId: string;
  quantity: number;
}

export interface CreateOrderInput {
  userId?: string | null;
  /**
   * مشتریِ صاحبِ حساب (جدولِ customers). اگر سفارش با حساب ثبت شود این شناسه
   * پر می‌شود و سفارش در «سفارش‌هایِ من» دیده می‌شود. برای خریدِ مهمان تهی
   * می‌ماند و فقط شمارهٔ همراه ثبت می‌گردد — بعداً اگر همان شماره حساب بسازد،
   * سفارش‌هایش به حساب پیوند می‌خورند (claimGuestOrders در بسته‌ی shopper).
   */
  customerId?: string | null;
  channel?: 'web' | 'pos' | 'phone';
  items: OrderItemInput[];
  idempotencyKey?: string | null;
  shippingAddress?: Record<string, unknown> | null;
  customerName?: string | null;
  customerMobile?: string | null;
  branchId?: string | null;
  warehouseId?: string | null;
  vatBasisPoints?: number;
  shippingRial?: Rial;
  /** کدِ تخفیف — در همین تراکنش ارزیابی و مصرف می‌شود */
  couponCode?: string | null;
  reservationMinutes?: number;
}

export interface OrderTotals {
  subtotalRial: string;
  discountRial: string;
  taxRial: string;
  shippingRial: string;
  totalRial: string;
}

export interface CreatedOrder {
  orderId: string;
  orderNo: string;
  status: string;
  totals: OrderTotals;
  duplicate: boolean;
  reservationExpiresAt: string | null;
}

/**
 * درختِ دسته‌یِ هر کالا: از دسته‌یِ خودِ کالا تا ریشه.
 *
 * چرا از پیش می‌خوانیم؟ چون کوپنِ دسته‌ای باید فرزندان را هم بگیرد: اگر رویِ
 * «لوازمِ جانبی» کوپن بدهیم، انتظار این است که کالاهایِ زیرشاخه هم مشمول
 * شوند. پیمایشِ درخت برایِ هر ردیف یعنی ده‌ها پرس‌وجو در هر سفارش؛ پس یک
 * پرس‌وجویِ بازگشتی می‌گیریم و در حافظه نگه می‌داریم.
 */
async function categoryTreesByProduct(
  tx: Queryable,
  productIds: readonly string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (productIds.length === 0) return map;

  const { rows } = await tx.query<{ product_id: string; cats: string[] | null }>(
    `WITH RECURSIVE tree AS (
       SELECT p.id AS product_id, p.type_id AS cat
         FROM products p
        WHERE p.id = ANY($1::uuid[]) AND p.type_id IS NOT NULL
       UNION ALL
       SELECT t.product_id, pt.parent_id
         FROM tree t
         JOIN product_types pt ON pt.id = t.cat
        WHERE pt.parent_id IS NOT NULL
     )
     SELECT product_id, array_agg(DISTINCT cat::text) AS cats
       FROM tree
      WHERE cat IS NOT NULL
      GROUP BY product_id`,
    [productIds as string[]],
  );
  for (const r of rows) map.set(String(r.product_id), (r.cats ?? []).map(String));
  return map;
}

interface VariantRow {
  id: string;
  price_rial: string;
  is_active: boolean;
  product_status: string;
}


/**
 * نرخِ ارزش‌افزوده‌یِ جاری — از تنظیماتِ پنل، وگرنه از پیش‌فرض.
 *
 * چرا این تابع وجود دارد؟ چون پیش از این، عددِ ۹٪ در سه جایِ جداگانه‌یِ کد
 * نوشته شده بود (سبد، سفارش، فروشِ حضوری). یعنی اگر مدیر در پنل نرخ را
 * تغییر می‌داد، هیچ‌کدام از آن‌ها نمی‌فهمیدند: مشتری یک عدد می‌دید و سامانه
 * عددِ دیگری حساب می‌کرد. در فروشگاهی که صورت‌حسابش قرار است به مؤدیان
 * برود، این فقط یک اشکالِ نمایشی نیست — مغایرتِ مالیاتی است.
 *
 * پس تصمیم یک‌جاست: نرخ از `store_settings` می‌آید و اگر تنظیم نشده باشد،
 * پیش‌فرضِ ۹٪ (همان که قانونِ فعلی است).
 */
const DEFAULT_VAT_BP = 900;

export async function effectiveVatBasisPoints(db: Queryable): Promise<number> {
  try {
    const { rows } = await db.query<{ value: string }>(
      `SELECT value FROM store_settings WHERE key = 'vat_rate_percent'`,
    );
    const raw = rows[0]?.value;
    if (raw != null && String(raw).trim() !== '') {
      const percent = Number(raw);
      // درصد → واحدِ پایه (۹٪ = ۹۰۰). گرد کردن چون ۹٫۵٪ هم ممکن است.
      if (Number.isFinite(percent) && percent >= 0 && percent <= 100) return Math.round(percent * 100);
    }
  } catch {
    // جدول نباشد (مثلاً در پایگاهِ تازه‌ساخت پیش از مهاجرت) یا دسترسی نباشد:
    // ثبتِ سفارش نباید به‌خاطرِ خواندنِ یک تنظیم شکست بخورد.
  }
  // تنظیمِ پنل نبود. دو پیش‌فرضِ دیگر هست و ترتیبشان باید روشن باشد، وگرنه
  // مدیر نمی‌فهمد کدام عدد را عوض کند: **پنل → محیطِ اجرا → قانونِ جاری**.
  const fromEnv = Number(process.env.VAT_RATE_BP);
  if (Number.isInteger(fromEnv) && fromEnv >= 0 && fromEnv <= 10_000) return fromEnv;
  return DEFAULT_VAT_BP;
}

export class OrderService {
  constructor(private readonly db: Database) {}

  /**
   * ایجادِ سفارش + رزروِ اتمیکِ موجودی.
   *
   * اگر `tx` داده شود، این عملیات **درون همان تراکنش** اجرا می‌شود و تراکنشِ
   * تازه‌ای باز نمی‌کند. این برای تسویه‌حسابِ سبد ضروری است: قفلِ سبد، رزروِ
   * موجودی و بسته شدنِ سبد باید در یک تراکنشِ واحد باشند، وگرنه ممکن است سبد
   * بسته شود در حالی که ساختِ سفارش شکست خورده است.
   */
  async createOrder(input: CreateOrderInput, tx?: Queryable): Promise<CreatedOrder> {
    if (!input.items.length) throw new AppError('VALIDATION', { details: { items: 'سبد خالی است' } });

    const vatBp = input.vatBasisPoints ?? (await effectiveVatBasisPoints(tx ?? this.db));
    const shipping = input.shippingRial ?? 0n;
    const reservationMinutes = input.reservationMinutes ?? 15;

    const run = async (tx: Queryable): Promise<CreatedOrder> => {
      // ۱) کلیدِ یکتایی — تلاشِ مجددِ شبکه یا دوبار کلیک، سفارشِ دومی نمی‌سازد
      if (input.idempotencyKey) {
        const { rows } = await tx.query<{ id: string; order_no: string; status: string; total_rial: string }>(
          `SELECT id, order_no, status, total_rial FROM orders WHERE idempotency_key = $1`,
          [input.idempotencyKey],
        );
        if (rows[0]) {
          return {
            orderId: rows[0].id,
            orderNo: rows[0].order_no,
            status: rows[0].status,
            totals: {
              subtotalRial: '0',
              discountRial: '0',
              taxRial: '0',
              shippingRial: '0',
              totalRial: rows[0].total_rial,
            },
            duplicate: true,
            reservationExpiresAt: null,
          };
        }
      }

      // ترتیبِ ثابت برای جلوگیری از بن‌بستِ قفل‌ها
      const items = [...input.items].sort((a, b) => a.variantId.localeCompare(b.variantId));

      // ۲) شماره‌ی سفارش
      const jalaliYear = getYear(new Date());
      const { value: orderSeq, formatted: orderNo } = await nextNumber(tx, 'order', {
        prefix: 'ORD',
        jalaliYear,
        pad: 6,
      });
      void orderSeq;

      // ۳) قیمت و محاسبه
      let lines: Array<ReturnType<typeof calcLine> & { variantId: string; quantity: number }> = [];
      for (const item of items) {
        if (item.quantity <= 0) throw new AppError('VALIDATION', { details: { quantity: 'تعداد نامعتبر' } });
        const { rows } = await tx.query<VariantRow>(
          `SELECT v.id, v.price_rial, v.is_active, p.status AS product_status
             FROM product_variants v JOIN products p ON p.id = v.product_id
            WHERE v.id = $1`,
          [item.variantId],
        );
        const variant = rows[0];
        if (!variant || !variant.is_active || variant.product_status !== 'active') {
          throw new AppError('NOT_FOUND', { details: { variantId: item.variantId } });
        }
        const line = calcLine({
          unitPrice: BigInt(variant.price_rial),
          quantity: item.quantity,
          taxBasisPoints: vatBp,
        });
        lines.push({ ...line, variantId: item.variantId, quantity: item.quantity });
      }
      let totals = sumLines(lines);

      // ۳/۱) کوپن — پیش از رزرو، چون باید بدانیم مبلغِ نهایی چیست
      //
      // چرا اینجا و نه پس از ثبت؟ چون تخفیف پایه‌یِ مالیات را عوض می‌کند:
      // مالیات باید بر «خالصِ پس از تخفیف» بسته شود. اگر نخست سفارش را با
      // مالیاتِ کامل بنویسیم و بعد تخفیف بدهیم، یا مالیات را زیاد گرفته‌ایم
      // یا باید تراکنشِ مالیاتی را ویرایش کنیم. پس ردیف‌ها را با تخفیفِ
      // هر کدام باز می‌سازیم و مالیات همان‌جا درست بسته می‌شود.
      let couponId: string | null = null;
      let couponCode: string | null = null;

      if (input.couponCode && input.couponCode.trim()) {
        const coupon = await validateCoupon(tx, input.couponCode, {
          customerId: input.customerId ?? null,
          at: new Date(),
        });

        // پایه‌یِ کمینه: بر مبلغِ کلِ سبد، نه بر مشمولِ کوپن — چون کمپین
        // می‌گوید «بالایِ ۵۰۰ هزار تومان»، و مشتری آن را از جمعِ سبد می‌فهمد
        if (totals.gross < coupon.minSubtotalRial) {
          throw new AppError('VALIDATION', {
            message: `این کد برایِ خریدهایِ بالاتر از ${coupon.minSubtotalRial.toLocaleString('fa-IR')} تومان است`,
            details: { coupon: 'min_subtotal', min: coupon.minSubtotalRial.toString() },
          });
        }

        // درختِ دسته‌یِ هر کالا (برایِ کوپنِ دسته‌ای): از دسته تا ریشه
        const productIds = Array.from(
          new Set(
            (
              await tx.query<{ product_id: string }>(
                `SELECT product_id FROM product_variants WHERE id = ANY($1::uuid[])`,
                [lines.map((l) => l.variantId)],
              )
            ).rows.map((r) => r.product_id),
          ),
        );
        const cats = await categoryTreesByProduct(tx, productIds);

        const couponLines: CouponLine[] = [];
        for (const l of lines) {
          const { rows: v } = await tx.query<{ product_id: string }>(
            `SELECT product_id FROM product_variants WHERE id = $1`,
            [l.variantId],
          );
          couponLines.push({
            variantId: l.variantId,
            productId: v[0]?.product_id ?? null,
            categoryIds: cats.get(v[0]?.product_id ?? '') ?? [],
            quantity: l.quantity,
            unitPriceRial: BigInt(l.gross) / BigInt(l.quantity),
          });
        }

        const applied = applyCouponRecord(coupon, couponLines);
        const byVariant = new Map(applied.lines.map((l) => [l.variantId, l.discountRial]));

        lines = lines.map((l) => ({
          ...calcLine({
            unitPrice: BigInt(l.gross) / BigInt(l.quantity),
            quantity: l.quantity,
            taxBasisPoints: vatBp,
            discount: byVariant.get(l.variantId) ?? 0n,
          }),
          variantId: l.variantId,
          quantity: l.quantity,
        }));
        totals = sumLines(lines);

        couponId = coupon.id;
        couponCode = coupon.code;
      }

      // ۴) رزروِ اتمیک
      const warehouseId = input.warehouseId ?? (await this.defaultWarehouse(tx));
      const reservation = await reserveStock(tx, warehouseId, items);
      if (!reservation.ok) {
        throw new AppError('OUT_OF_STOCK', {
          details: { variantId: reservation.failedVariantId, available: reservation.available },
        });
      }

      // ۵) درج
      const { rows: inserted } = await tx.query<{ id: string; reservation_expires_at: string }>(
        `INSERT INTO orders (
            order_no, user_id, branch_id, channel, status,
            subtotal_rial, discount_rial, tax_rial, shipping_rial, total_rial,
            idempotency_key, reservation_expires_at,
            shipping_address, customer_name, customer_mobile, customer_id,
            coupon_id, coupon_code)
         VALUES ($1,$2,$3,$4,'pending_payment',$5,$6,$7,$8,$9,$10,
                 now() + ($11 || ' minutes')::interval, $12::jsonb, $13, $14, $15,
                 $16, $17)
         RETURNING id, reservation_expires_at`,
        [
          orderNo,
          input.userId ?? null,
          input.branchId ?? null,
          input.channel ?? 'web',
          totals.net.toString(),
          totals.discount.toString(),
          totals.tax.toString(),
          shipping.toString(),
          (totals.total + shipping).toString(),
          input.idempotencyKey ?? null,
          String(reservationMinutes),
          input.shippingAddress ? JSON.stringify(input.shippingAddress) : null,
          input.customerName ?? null,
          input.customerMobile ?? null,
          input.customerId ?? null,
          couponId,
          couponCode,
        ],
      );
      const order = inserted[0]!;

      for (const line of lines) {
        await tx.query(
          `INSERT INTO order_items (order_id, variant_id, quantity, unit_price_rial, discount_rial, tax_rial, total_rial)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            order.id,
            line.variantId,
            line.quantity,
            (BigInt(line.gross) / BigInt(line.quantity)).toString(),
            line.discount.toString(),
            line.tax.toString(),
            line.total.toString(),
          ],
        );
      }

      await tx.query(
        `INSERT INTO order_status_history (order_id, to_status, actor_user_id) VALUES ($1,'pending_payment',$2)`,
        [order.id, input.userId ?? null],
      );

      // مصرفِ کوپن در همان تراکنش: اگر ثبتِ سفارش شکست بخورد (مثلاً رزرو)،
      // نوبتِ کوپن هم برمی‌گردد و مشتری کوپنش را از دست نمی‌دهد
      if (couponId != null) {
        await redeemCoupon(tx, couponId, order.id, BigInt(totals.discount), input.customerId ?? null);
      }

      // ۶) رخداد
      await publishEvent(tx, {
        aggregate: 'order',
        aggregateId: order.id,
        eventType: 'order.placed',
        payload: { orderNo, totalRial: (totals.total + shipping).toString() },
      });

      return {
        orderId: order.id,
        orderNo,
        status: 'pending_payment',
        totals: {
          subtotalRial: totals.net.toString(),
          discountRial: totals.discount.toString(),
          taxRial: totals.tax.toString(),
          shippingRial: shipping.toString(),
          totalRial: (totals.total + shipping).toString(),
        },
        duplicate: false,
        reservationExpiresAt: order.reservation_expires_at,
      };
    };

    // اگر تراکنشِ بیرونی داده شده، درونِ همان اجرا می‌شود؛ وگرنه یکی باز می‌کند
    return tx ? run(tx) : this.db.transaction(run);
  }

  /** تأییدِ پرداخت: رزرو به خروجِ واقعی تبدیل می‌شود */
  async confirmPayment(
    orderId: string,
    opts: { amountRial: Rial; method?: string; referenceNo?: string; actorUserId?: string | null },
  ): Promise<{ status: string }> {
    return this.db.transaction((tx) => this.confirmPaymentOn(tx, orderId, opts));
  }

  /**
   * همان confirmPayment، اما درونِ یک تراکنشِ موجود.
   *
   * چرا لازم شد؟ چون تأییدِ درگاهِ پرداخت باید با تسویه‌یِ سفارش یک واحدِ
   * اتمیک باشد: یا «تأییدِ درگاه + خروجِ کالا + سندِ حسابداری» با هم انجام
   * می‌شوند، یا هیچ‌کدام. اگر دو تراکنشِ جدا داشتیم، ممکن بود درگاه پول را
   * قطعی کند اما تراکنشِ دوم شکست بخورد — و آن‌وقت کالا در انبار می‌ماند.
   */
  async confirmPaymentOn(
    tx: Queryable,
    orderId: string,
    opts: {
      amountRial: Rial;
      method?: string;
      referenceNo?: string;
      actorUserId?: string | null;
      /**
       * ردیفِ پرداختی که درگاه ساخته است.
       * اگر داده شود، همان ردیف به‌روز می‌شود و ردیفِ دومی ساخته نمی‌شود؛
       * بدونِ آن، هر پرداختِ آنلاین دو سندِ پرداخت می‌ساخت (یکی از درگاه،
       * یکی از تسویه) و گزارش‌ها دو برابر نشان می‌دادند.
       */
      paymentId?: string;
      gateway?: string;
      cardPanMasked?: string | null;
    },
  ): Promise<{ status: string }> {
    {
      const { rows } = await tx.query<{
        id: string; order_no: string; status: string; channel: string;
        subtotal_rial: string; tax_rial: string; shipping_rial: string; total_rial: string;
        warehouse_hint: string | null;
      }>(
        `SELECT o.id, o.order_no, o.status, o.channel,
                o.subtotal_rial::text, o.tax_rial::text, o.shipping_rial::text, o.total_rial::text,
                (SELECT warehouse_id::text FROM stock_items LIMIT 1) AS warehouse_hint
           FROM orders o WHERE o.id = $1 FOR UPDATE`,
        [orderId],
      );
      const order = rows[0];
      if (!order) throw new AppError('NOT_FOUND');
      if (order.status !== 'pending_payment') {
        throw new AppError('CONFLICT', { details: { status: order.status } });
      }
      if (BigInt(order.total_rial) !== opts.amountRial) {
        throw new AppError('PRICE_CHANGED', {
          details: { expected: order.total_rial, received: opts.amountRial.toString() },
        });
      }

      const { rows: items } = await tx.query<{ variant_id: string; quantity: number }>(
        `SELECT variant_id, quantity FROM order_items WHERE order_id = $1`,
        [orderId],
      );

      const warehouseId = await this.defaultWarehouse(tx);
      // خروجِ کالا بهایِ هر واحد را از ارزش‌گذاریِ همان انبار برمی‌گرداند؛
      // این بها را روی ردیفِ سفارش می‌نشانیم تا سودِ ناخالصِ این فروش،
      // هر وقت گزارش گرفته شود، با بهایِ همین لحظه حساب شود — نه با
      // میانگینی که پس از خریدهایِ بعد عوض شده است.
      const confirmed = await confirmStock(
        tx,
        warehouseId,
        items.map((i) => ({ variantId: i.variant_id, quantity: i.quantity })),
        orderId,
      );
      for (const line of confirmed) {
        await tx.query(
          `UPDATE order_items SET unit_cost_rial = $3
            WHERE order_id = $1 AND variant_id = $2`,
          [orderId, line.variantId, line.unitCostRial.toString()],
        );
      }

      // --- سندِ فروش: درآمد، ارزش افزوده‌ی فروش و بهای کالای فروخته‌شده
      // در همان تراکنشِ خروجِ کالا از انبار؛ اگر اینجا شکست بخورد، هیچ‌کدام
      // اعمال نمی‌شوند — پس انبار و دفترکل هرگز از هم جدا نمی‌افتند.
      await new AccountingService(this.db).postSaleOn(tx, {
        warehouseId,
        items: items.map((i) => ({ variantId: i.variant_id, quantity: i.quantity })),
        subtotalRial: BigInt(order.subtotal_rial),
        taxRial: BigInt(order.tax_rial),
        shippingRial: BigInt(order.shipping_rial),
        totalRial: BigInt(order.total_rial),
        // حسابِ تسویه: نقد→صندوق (1100)، چک→اسناد دریافتنی (1400)، بقیه→بانک (1200)
        settlementAccountCode:
          opts.method === 'cash' ? '1100'
          : opts.method === 'cheque' ? '1400'
          : '1200',
        referenceType: 'order',
        referenceId: orderId,
        description: `فروش ${order.order_no}`,
      });

      if (opts.paymentId) {
        // ردیفِ درگاه همان ردیفِ قطعی است: فقط نتیجه روی آن می‌نشیند
        await tx.query(
          `UPDATE payments
              SET status = 'success', reference_no = COALESCE($2, reference_no),
                  card_pan_masked = COALESCE($3, card_pan_masked),
                  verified_at = now()
            WHERE id = $1`,
          [opts.paymentId, opts.referenceNo ?? null, opts.cardPanMasked ?? null],
        );
      } else {
        await tx.query(
          `INSERT INTO payments (order_id, amount_rial, method, status, reference_no)
           VALUES ($1,$2,$3,'success',$4)`,
          [orderId, opts.amountRial.toString(), opts.method ?? 'sandbox', opts.referenceNo ?? null],
        );
      }

      await tx.query(
        `UPDATE orders SET status = 'paid', paid_at = now(), reservation_expires_at = NULL WHERE id = $1`,
        [orderId],
      );
      await tx.query(
        `INSERT INTO order_status_history (order_id, from_status, to_status, actor_user_id)
         VALUES ($1,'pending_payment','paid',$2)`,
        [orderId, opts.actorUserId ?? null],
      );
      await publishEvent(tx, {
        aggregate: 'order',
        aggregateId: orderId,
        eventType: 'order.paid',
        payload: { amountRial: opts.amountRial.toString() },
      });

      return { status: 'paid' };
    }
  }

  /** انصراف: رزرو آزاد می‌شود تا کالا به فروش برسد */
  async cancel(orderId: string, reason: string, actorUserId?: string | null): Promise<{ status: string }> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM orders WHERE id = $1 FOR UPDATE`, [orderId],
      );
      const order = rows[0];
      if (!order) throw new AppError('NOT_FOUND');
      if (['cancelled', 'refunded'].includes(order.status)) {
        throw new AppError('CONFLICT', { details: { status: order.status } });
      }

      const { rows: items } = await tx.query<{ variant_id: string; quantity: number }>(
        `SELECT variant_id, quantity FROM order_items WHERE order_id = $1`, [orderId],
      );
      const warehouseId = await this.defaultWarehouse(tx);
      if (order.status === 'pending_payment') {
        await releaseStock(
          tx,
          warehouseId,
          items.map((i) => ({ variantId: i.variant_id, quantity: i.quantity })),
          'cancel',
        );
      }

      await tx.query(
        `UPDATE orders SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2 WHERE id = $1`,
        [orderId, reason],
      );
      await tx.query(
        `INSERT INTO order_status_history (order_id, from_status, to_status, actor_user_id, reason)
         VALUES ($1,$2,'cancelled',$3,$4)`,
        [orderId, order.status, actorUserId ?? null, reason],
      );
      // نوبتِ کوپن برمی‌گردد. اگر این را نکنیم، مشتری‌ای که سفارش را به‌هم
      // زده (شاید به تقصیرِ خودِ ما: کالا نبود، پرداخت نرفت) کوپنش را هم
      // از دست می‌دهد — و بدترین تبلیغِ یک فروشگاه همین است.
      await releaseCoupon(tx, orderId);

      await publishEvent(tx, {
        aggregate: 'order',
        aggregateId: orderId,
        eventType: 'order.cancelled',
        payload: { reason },
      });
      return { status: 'cancelled' };
    });
  }

  async getOrder(orderId: string): Promise<{
    id: string;
    order_no: string;
    status: string;
    channel: string;
    subtotal_rial: string;
    discount_rial: string;
    tax_rial: string;
    shipping_rial: string;
    total_rial: string;
    created_at: string;
    paid_at: string | null;
    cancelled_at: string | null;
    cancel_reason: string | null;
    reservation_expires_at: string | null;
    customer_name: string | null;
    customer_mobile: string | null;
    items: Record<string, unknown>[];
    history: Record<string, unknown>[];
    payments: Record<string, unknown>[];
  } | null> {
    const { rows } = await this.db.query<{
      id: string; order_no: string; status: string; channel: string;
      subtotal_rial: string; discount_rial: string; tax_rial: string; shipping_rial: string;
      total_rial: string; created_at: string; paid_at: string | null;
      cancelled_at: string | null; cancel_reason: string | null;
      reservation_expires_at: string | null; customer_name: string | null;
      customer_mobile: string | null;
    }>(
      `SELECT id, order_no, status, channel,
              subtotal_rial, discount_rial, tax_rial, shipping_rial, total_rial,
              created_at, paid_at, cancelled_at, cancel_reason, reservation_expires_at,
              customer_name, customer_mobile
         FROM orders WHERE id = $1`,
      [orderId],
    );
    const order = rows[0];
    if (!order) return null;

    const { rows: items } = await this.db.query<Record<string, unknown>>(
      `SELECT oi.variant_id, v.sku, p.title, oi.quantity, oi.unit_price_rial, oi.tax_rial, oi.total_rial
         FROM order_items oi
         JOIN product_variants v ON v.id = oi.variant_id
         JOIN products p ON p.id = v.product_id
        WHERE oi.order_id = $1`,
      [orderId],
    );
    const { rows: history } = await this.db.query<Record<string, unknown>>(
      `SELECT from_status, to_status, reason, created_at FROM order_status_history
        WHERE order_id = $1 ORDER BY created_at`, [orderId],
    );
    const { rows: payments } = await this.db.query<Record<string, unknown>>(
      `SELECT amount_rial, method, status, reference_no, created_at FROM payments WHERE order_id = $1`, [orderId],
    );

    return { ...order, items, history, payments };
  }

  private async defaultWarehouse(tx: Queryable): Promise<string> {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM warehouses ORDER BY is_default DESC, name LIMIT 1`,
    );
    const id = rows[0]?.id;
    if (!id) throw new AppError('INVARIANT', { details: { message: 'هیچ انباری تعریف نشده است' } });
    return id;
  }
}
