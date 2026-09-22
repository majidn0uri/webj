import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { AppError, formatToman } from '@set/shared-kernel';
import type { Database, Queryable } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';
import { StockAlertService } from '@set/commerce';

/**
 * مسیرهای پنلِ مدیریت.
 *
 * اصلِ طراحی: هیچ مسیری بدون دو بررسی اجرا نمی‌شود —
 *   ۱) احراز هویت (توکن معتبر)،
 *   ۲) اجازه‌ی دانه‌ریز (منبع.عمل) از طریقِ RBAC/ABAC.
 * این بررسی‌ها در خودِ کنترل‌کننده‌اند، نه در یک میان‌افزارِ جدا،
 * تا «کدام مسیر به کدام دسترسی نیاز دارد» در کنارِ همان مسیر خوانده شود.
 */

const AdjustDto = z.object({
  variantId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  /** مثبت = ورود به انبار، منفی = خروج */
  delta: z.number().int().refine((n) => n !== 0, 'مقدارِ تعدیل نمی‌تواند صفر باشد'),
  reason: z.enum(['purchase', 'return', 'adjust', 'transfer', 'count']),
  note: z.string().max(500).nullish(),
});

const ListQuery = z.object({
  status: z.string().max(32).nullish(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

@Controller('admin')
export class AdminController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  /**
   * توکن را می‌خواند و دسترسی را وارسی می‌کند.
   * نبودِ توکن → ۴۰۱؛ نبودِ دسترسی → ۴۰۳ (با نامِ منبع و عمل در جزئیات، برای دیباگ).
   */
  private async requireUser(
    authorization: string | undefined,
    resource: string,
    action: string,
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');

    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');

    await this.access.assert({ userId: claims.sub, branchId: null }, resource, action);
    return claims;
  }

  /** خلاصه‌ی پیشخوان — آنچه مدیر باید در یک نگاه ببیند */
  @Get('summary')
  async summary(@Headers('authorization') authorization?: string) {
    await this.requireUser(authorization, 'report', 'read');

    const one = async (sql: string): Promise<number> => {
      const { rows } = await this.db.query<{ n: string }>(sql);
      return Number(rows[0]?.n ?? 0);
    };

    const [
      products,
      orders,
      paidOrders,
      pendingOrders,
      lowStock,
      outOfStock,
      revenueRial,
      todayOrders,
    ] = await Promise.all([
      one(`SELECT COUNT(*)::text AS n FROM products`),
      one(`SELECT COUNT(*)::text AS n FROM orders`),
      one(`SELECT COUNT(*)::text AS n FROM orders WHERE status = 'paid'`),
      one(`SELECT COUNT(*)::text AS n FROM orders WHERE status IN ('pending_payment','awaiting_payment')`),
      one(
        `SELECT COUNT(*)::text AS n FROM stock_items
          WHERE on_hand - reserved > 0 AND on_hand - reserved <= 3`,
      ),
      one(`SELECT COUNT(*)::text AS n FROM stock_items WHERE on_hand - reserved <= 0`),
      one(`SELECT COALESCE(SUM(total_rial),0)::text AS n FROM orders WHERE status = 'paid'`),
      one(`SELECT COUNT(*)::text AS n FROM orders WHERE created_at >= now() - interval '1 day'`),
    ]);

    return {
      products,
      orders: { total: orders, paid: paidOrders, pending: pendingOrders, today: todayOrders },
      inventory: { lowStock, outOfStock },
      revenue: {
        rial: revenueRial,
        display: formatToman(BigInt(revenueRial)),
      },
    };
  }

  /** فهرستِ سفارش‌ها با صفحه‌بندی و صافیِ وضعیت */
  @Get('orders')
  async orders(
    @Headers('authorization') authorization?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    await this.requireUser(authorization, 'order', 'read');

    const q = ListQuery.parse({ status, limit, offset });
    const params: unknown[] = [q.limit, q.offset];
    let where = '';

    if (q.status === 'packing') {
      // «در صفِ بسته‌بندی» یک وضعیت نیست، یک **صحنه** است: آنچه هنوز بسته
      // نشده (تأییدشده) همراهِ آنچه در دستِ بستن است. جدا کردنشان در فیلتر
      // یعنی انباردار باید دو بار بگردد تا کارش را پیدا کند.
      // و چون این شرط پارامتری نمی‌گیرد، نباید پارامتری هم بفرستیم — وگرنه
      // شمارِ پارامترها با نشانه‌هایِ پرس‌وجو جور نمی‌آید و کلِ فهرست خطا
      // می‌دهد (همان خطایی که یک‌بار رخ داد).
      where = `WHERE status IN ('confirmed','packing')`;
    } else if (q.status) {
      params.push(q.status);
      where = `WHERE status = $${params.length}`;
    }

    const { rows } = await this.db.query<{
      id: string;
      order_no: string;
      status: string;
      channel: string;
      total_rial: string;
      created_at: string;
      paid_at: string | null;
      customer_name: string | null;
      customer_mobile: string | null;
      packing_complete: boolean | null;
      packed_at: string | null;
    }>(
      `SELECT id, order_no, status, channel, total_rial, created_at, paid_at,
              customer_name, customer_mobile, packing_complete, packed_at
         FROM orders
         ${where}
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2`,
      params,
    );

    const { rows: totalRows } = await this.db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM orders ${where}`,
      // همان ترتیب: شرطِ بی‌پارامتر، پارامتر نمی‌خواهد
      q.status && q.status !== 'packing' ? [q.status] : [],
    );

    return {
      total: Number(totalRows[0]?.n ?? 0),
      count: rows.length,
      items: rows.map((o) => ({
        id: o.id,
        orderNo: o.order_no,
        status: o.status,
        channel: o.channel,
        totalRial: o.total_rial,
        total: formatToman(BigInt(o.total_rial)),
        createdAt: o.created_at,
        paidAt: o.paid_at,
        customerName: o.customer_name,
        customerMobile: o.customer_mobile,
        packingComplete: o.packing_complete,
        packedAt: o.packed_at,
      })),
    };
  }

  /** کالاهایی که موجودی‌شان کم یا تمام شده — برای سفارشِ خرید */
  @Get('inventory/low')
  async lowStock(@Headers('authorization') authorization?: string) {
    await this.requireUser(authorization, 'inventory', 'read');

    const { rows } = await this.db.query<{
      variant_id: string;
      sku: string;
      product_title: string;
      on_hand: number;
      reserved: number;
    }>(
      `SELECT si.variant_id, pv.sku, p.title AS product_title, si.on_hand, si.reserved
         FROM stock_items si
         JOIN product_variants pv ON pv.id = si.variant_id
         JOIN products p ON p.id = pv.product_id
        WHERE si.on_hand - si.reserved <= 3
        ORDER BY (si.on_hand - si.reserved) ASC, p.title
        LIMIT 100`,
    );

    return {
      count: rows.length,
      items: rows.map((r) => ({
        variantId: r.variant_id,
        sku: r.sku,
        product: r.product_title,
        onHand: r.on_hand,
        reserved: r.reserved,
        available: r.on_hand - r.reserved,
      })),
    };
  }

  /**
   * داده‌ی مرجعِ فرم‌ها: برندها، نوع‌های کالا، و مدل‌های گوشی.
   *
   * چرا یک مسیرِ واحد؟ چون فرمِ ثبتِ کالا به هر سه نیاز دارد؛
   * سه درخواستِ جدا یعنی سه بار رفت‌وبرگشت و سه حالتِ خطایِ جداگانه،
   * در حالی که این داده‌ها با هم مصرف می‌شوند و با هم تغییر می‌کنند.
   */
  @Get('reference')
  async reference(@Headers('authorization') authorization?: string) {
    await this.requireUser(authorization, 'product', 'write');

    const [brands, types, models] = await Promise.all([
      this.db.query<{ id: string; name: string; slug: string }>(
        `SELECT id, name, slug FROM brands WHERE is_active = true ORDER BY name`,
      ),
      this.db.query<{ key: string; name: string; spec_template: unknown }>(
        `SELECT key, name, spec_template FROM product_types ORDER BY name`,
      ),
      this.db.query<{ id: string; model: string; brand: string }>(
        `SELECT dm.id, dm.name AS model, db.name AS brand
           FROM device_models dm
           JOIN device_brands db ON db.id = dm.brand_id
          ORDER BY db.name, dm.name`,
      ),
    ]);

    return {
      brands: brands.rows,
      productTypes: types.rows.map((t) => ({
        key: t.key,
        name: t.name,
        specTemplate: t.spec_template ?? [],
      })),
      deviceModels: models.rows,
    };
  }

  /**
   * تعدیلِ موجودی — تنها نقطه‌ای که انباردار می‌تواند عددِ موجودی را تغییر دهد.
   *
   * چرا درون تراکنش با FOR UPDATE؟ چون دو تعدیلِ هم‌زمان روی یک کالا
   * بدون قفل، آخرین نفر برنده می‌شود و یکی از تغییرات گم می‌گردد
   * (lost update) — دقیقاً همان چیزی که موجودی را در عمل بی‌اعتبار می‌کند.
   */
  @Post('inventory/adjust')
  @HttpCode(200)
  async adjust(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    const claims = await this.requireUser(authorization, 'inventory', 'adjust');
    const input = AdjustDto.parse(body);

    return this.db.transaction(async (tx: Queryable) => {
      // انبار: اگر مشخص نشده، انبارِ پیش‌فرض
      let warehouseId = input.warehouseId;
      if (!warehouseId) {
        const { rows } = await tx.query<{ id: string }>(
          `SELECT id FROM warehouses WHERE is_default = true LIMIT 1`,
        );
        warehouseId = rows[0]?.id;
      }
      if (!warehouseId) throw new AppError('NOT_FOUND', { message: 'هیچ انباری تعریف نشده است.' });

      const { rows: stockRows } = await tx.query<{ on_hand: number; reserved: number }>(
        `SELECT on_hand, reserved FROM stock_items
          WHERE variant_id = $1 AND warehouse_id = $2
          FOR UPDATE`,
        [input.variantId, warehouseId],
      );

      const current = stockRows[0];
      if (!current) {
        throw new AppError('NOT_FOUND', { message: 'این کالا در این انبار موجود نیست.' });
      }

      const nextOnHand = current.on_hand + input.delta;

      if (nextOnHand < 0) {
        throw new AppError('INVARIANT', {
          message: 'موجودی نمی‌تواند منفی شود.',
          details: { current: current.on_hand, delta: input.delta },
        });
      }
      if (nextOnHand < current.reserved) {
        throw new AppError('INVARIANT', {
          message: 'موجودی نمی‌تواند از مقدارِ رزرو‌شده کمتر شود.',
          details: { reserved: current.reserved, after: nextOnHand },
        });
      }

      await tx.query(
        `UPDATE stock_items SET on_hand = $3, updated_at = now()
          WHERE variant_id = $1 AND warehouse_id = $2`,
        [input.variantId, warehouseId, nextOnHand],
      );

      // هر تغییرِ موجودی باید ردی از خود به‌جا بگذارد — قابلِ حسابرسی، با عاملِ تغییر
      await tx.query(
        `INSERT INTO stock_movements
           (variant_id, warehouse_id, quantity, reason, reference_type, reference_id,
            unit_cost_rial, actor_user_id)
         VALUES ($1, $2, $3, $4, 'manual_adjust', NULL, 0, $5)`,
        [input.variantId, warehouseId, input.delta, input.reason, claims.sub],
      );

      return {
        variantId: input.variantId,
        warehouseId,
        previousOnHand: current.on_hand,
        delta: input.delta,
        onHand: nextOnHand,
        reserved: current.reserved,
        available: nextOnHand - current.reserved,
        reason: input.reason,
        note: input.note ?? null,
      };
    });
  }

  /**
   * آگاه‌سازیِ منتظرانِ یک کالا — با آمدنِ موجودی.
   *
   * چرا اینجا و نه درونِ تراکنشِ تعدیل؟ چون اگر پیامکی به هر دلیلی
   * ثبت نشد، نباید موجودی — که واقعیتِ اصلی است — به عقب برگردد. موجودی
   * آمد، و این یک حقیقت است؛ آگاه‌سازی بر رویِ آن ساخته می‌شود و می‌تواند
   * لحظه‌ای بعد هم انجام شود.
   */
  @Post('inventory/notify-waiters')
  async notifyWaiters(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    await this.requireUser(authorization, 'orders', 'write');
    const input = z
      .object({ variantId: z.string().min(20).max(40).optional(), productId: z.string().min(20).max(40).optional() })
      .parse(body);
    const alerts = new StockAlertService(this.db);
    if (input.productId) return alerts.notifyForProduct(input.productId);
    if (input.variantId) return alerts.notifyWaiters(input.variantId);
    throw new AppError('VALIDATION', { message: 'کالا یا تنوع را نشانی کنید.' });
  }

  /** چند نفر منتظرِ این کالایند — برایِ اینکه انبار بداند چقدر بیاورد */
  @Get('inventory/waiters')
  async waiters(@Query('product') product: string, @Headers('authorization') authorization?: string) {
    await this.requireUser(authorization, 'orders', 'read');
    if (!product) throw new AppError('VALIDATION', { message: 'کالا را نشانی نکرده‌اید.' });
    const items = await new StockAlertService(this.db).listForProduct(String(product), 'waiting');
    return { items, total: items.length };
  }
}
