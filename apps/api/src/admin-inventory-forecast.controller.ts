import { Controller, Get, Headers, Inject, Query } from '@nestjs/common';

import { AppError } from '@set/shared-kernel';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';

import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * پیش‌بینی موجودی — تحلیل ABC و کالاهای کم‌فروش
 *
 * فروشنده بداند کدام کالاها را باید زودتر تأمین کند
 * و کدام‌ها را باید حراج بزند یا حذف کند.
 */

@Controller('admin/inventory-forecast')
export class AdminInventoryForecastController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  private async require(authorization: string | undefined): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    await this.access.assert({ userId: claims.sub, branchId: null }, 'inventory', 'read');
    return claims;
  }

  /**
   * GET /admin/inventory-forecast/abc
   *
   * تحلیل ABC: A = ۸۰٪ فروش، B = ۱۵٪، C = ۵٪
   * بر اساس ۹۰ روز اخیر
   */
  @Get('abc')
  async abcAnalysis(
    @Headers('authorization') authorization: string | undefined,
    @Query('days') days?: string,
  ) {
    await this.require(authorization);
    const period = Math.min(Math.max(Number(days ?? '90'), 7), 365);

    const { rows } = await this.db.query<{
      product_id: string;
      title: string;
      total_qty: string;
      total_revenue: string;
      cumsum_pct: string;
    }>(
      `WITH sales AS (
         SELECT oi.variant_id, SUM(oi.quantity) AS qty, SUM(oi.total_rial) AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.created_at > now() - interval '${period} days'
           AND o.status NOT IN ('cancelled', 'expired', 'pending_payment')
         GROUP BY oi.variant_id
       ),
       product_sales AS (
         SELECT v.product_id, p.title,
                COALESCE(SUM(s.qty), 0) AS total_qty,
                COALESCE(SUM(s.revenue), 0) AS total_revenue
         FROM products p
         LEFT JOIN product_variants v ON v.product_id = p.id
         LEFT JOIN sales s ON s.variant_id = v.id
         GROUP BY v.product_id, p.title
       ),
       ranked AS (
         SELECT *,
                SUM(total_revenue) OVER (ORDER BY total_revenue DESC) AS cumsum,
                SUM(total_revenue) OVER () AS grand_total
         FROM product_sales
         WHERE total_revenue > 0
       )
       SELECT product_id, title, total_qty::text, total_revenue::text,
              CASE WHEN grand_total > 0
                THEN ROUND(100.0 * cumsum / grand_total, 1)::text
                ELSE '0' END AS cumsum_pct
       FROM ranked
       ORDER BY total_revenue DESC
       LIMIT 200`,
    );

    const items = rows.map((r) => {
      const cumPct = Number(r.cumsum_pct);
      const category = cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C';
      return {
        productId: r.product_id,
        title: r.title,
        totalQty: Number(r.total_qty),
        totalRevenue: Number(r.total_revenue),
        cumsumPct: cumPct,
        category,
      };
    });

    const summary = {
      A: items.filter((i) => i.category === 'A').length,
      B: items.filter((i) => i.category === 'B').length,
      C: items.filter((i) => i.category === 'C').length,
    };

    return { period, summary, items };
  }

  /**
   * GET /admin/inventory-forecast/slow-movers
   *
   * کالاهایی که در ۶۰ روز اخیر فروش نداشته‌اند اما موجودی دارند
   */
  @Get('slow-movers')
  async slowMovers(
    @Headers('authorization') authorization: string | undefined,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    await this.require(authorization);
    const period = Math.min(Math.max(Number(days ?? '60'), 7), 365);
    const lim = Math.min(Number(limit ?? '50'), 200);

    const { rows } = await this.db.query<{
      product_id: string;
      title: string;
      stock: string;
      last_sale: string | null;
      price_rial: string;
    }>(
      `WITH stock AS (
         SELECT v.product_id, SUM(i.quantity) AS qty
         FROM inventory i
         JOIN product_variants v ON v.id = i.variant_id
         GROUP BY v.product_id
         HAVING SUM(i.quantity) > 0
       ),
       last_sales AS (
         SELECT v.product_id, MAX(o.created_at) AS last_sale
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN product_variants v ON v.id = oi.variant_id
         WHERE o.status NOT IN ('cancelled', 'expired')
         GROUP BY v.product_id
       )
       SELECT p.id AS product_id, p.title,
              s.qty::text AS stock,
              ls.last_sale::text,
              COALESCE(
                (SELECT pv.price_rial FROM product_variants pv WHERE pv.product_id = p.id ORDER BY pv.price_rial LIMIT 1),
                0
              )::text AS price_rial
       FROM products p
       JOIN stock s ON s.product_id = p.id
       LEFT JOIN last_sales ls ON ls.product_id = p.id
       WHERE ls.last_sale IS NULL OR ls.last_sale < now() - interval '${period} days'
       ORDER BY ls.last_sale ASC NULLS FIRST
       LIMIT $1`,
      [lim],
    );

    return {
      period,
      items: rows.map((r) => ({
        productId: r.product_id,
        title: r.title,
        stock: Number(r.stock),
        lastSale: r.last_sale,
        price: Number(r.price_rial),
        daysSinceLastSale: r.last_sale
          ? Math.floor((Date.now() - new Date(r.last_sale).getTime()) / 86400000)
          : null,
      })),
    };
  }

  /**
   * GET /admin/inventory-forecast/reorder
   *
   * کالاهایی که موجودی‌شان زیر نقطه سفارش است
   */
  @Get('reorder')
  async reorderNeeded(
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.require(authorization);

    const { rows } = await this.db.query<{
      product_id: string;
      title: string;
      sku: string;
      current_stock: string;
      reorder_point: string;
      avg_daily_sales: string;
      days_of_stock: string | null;
    }>(
      `WITH daily_sales AS (
         SELECT v.id AS variant_id,
                COALESCE(SUM(oi.quantity), 0)::float / 90.0 AS avg_daily
         FROM product_variants v
         LEFT JOIN order_items oi ON oi.variant_id = v.id
         LEFT JOIN orders o ON o.id = oi.order_id
           AND o.created_at > now() - interval '90 days'
           AND o.status NOT IN ('cancelled', 'expired')
         GROUP BY v.id
       ),
       variant_stock AS (
         SELECT v.id AS variant_id, v.product_id, v.sku, v.reorder_point,
                COALESCE(SUM(i.quantity), 0) AS current_stock,
                ds.avg_daily
         FROM product_variants v
         LEFT JOIN inventory i ON i.variant_id = v.id
         LEFT JOIN daily_sales ds ON ds.variant_id = v.id
         GROUP BY v.id, v.product_id, v.sku, v.reorder_point, ds.avg_daily
       )
       SELECT p.id AS product_id, p.title, vs.sku,
              vs.current_stock::text, vs.reorder_point::text,
              ROUND(vs.avg_daily, 2)::text AS avg_daily_sales,
              CASE WHEN vs.avg_daily > 0
                THEN ROUND(vs.current_stock / vs.avg_daily, 0)::text
                ELSE NULL END AS days_of_stock
       FROM variant_stock vs
       JOIN products p ON p.id = vs.product_id
       WHERE vs.current_stock <= vs.reorder_point
         AND vs.reorder_point > 0
       ORDER BY
         CASE WHEN vs.avg_daily > 0 THEN vs.current_stock / vs.avg_daily ELSE 999999 END ASC
       LIMIT 100`,
    );

    return {
      items: rows.map((r) => ({
        productId: r.product_id,
        title: r.title,
        sku: r.sku,
        currentStock: Number(r.current_stock),
        reorderPoint: Number(r.reorder_point),
        avgDailySales: Number(r.avg_daily_sales),
        daysOfStock: r.days_of_stock ? Number(r.days_of_stock) : null,
        urgency: r.days_of_stock
          ? Number(r.days_of_stock) <= 3 ? 'critical' : Number(r.days_of_stock) <= 7 ? 'warning' : 'normal'
          : 'unknown',
      })),
    };
  }

  /* ── پیش‌بینی تقاضا (Moving Average + Safety Stock) ─────────────────── */

  @Get('demand-forecast')
  async demandForecast(
    @Query('days') daysParam?: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.require(authorization);

    const days = Math.min(Math.max(Number(daysParam ?? 30) || 30, 7), 180);

    const { rows } = await this.db.query(
      `WITH daily_sales AS (
         SELECT oi.variant_id, DATE(o.paid_at) AS sale_date, SUM(oi.quantity) AS qty
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.paid_at IS NOT NULL AND o.paid_at > now() - interval '1 day' * $1
           AND o.status NOT IN ('cancelled','refunded')
         GROUP BY oi.variant_id, DATE(o.paid_at)
       ), stats AS (
         SELECT variant_id, COUNT(*)::int AS sale_days, SUM(qty)::int AS total_sold,
                ROUND(AVG(qty),1)::numeric AS avg_daily, MAX(qty)::int AS max_daily,
                ROUND(STDDEV(qty),1)::numeric AS stddev_daily
         FROM daily_sales GROUP BY variant_id
       )
       SELECT v.id AS variant_id, v.sku, p.title,
              COALESCE(s.on_hand - s.reserved, 0)::int AS available,
              st.sale_days, st.total_sold, st.avg_daily, st.max_daily,
              ROUND(st.avg_daily * 7)::int AS forecast_7d,
              ROUND(st.avg_daily * 30)::int AS forecast_30d,
              CASE WHEN st.avg_daily > 0
                THEN ROUND((COALESCE(s.on_hand - s.reserved, 0))::numeric / st.avg_daily)::int
                ELSE NULL END AS days_of_stock,
              ROUND(st.avg_daily * 7 + COALESCE(st.stddev_daily, 0) * 1.65 * SQRT(7))::int AS reorder_point
       FROM stats st
       JOIN product_variants v ON v.id = st.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN stock_items s ON s.variant_id = v.id
       ORDER BY st.avg_daily DESC`,
      [days],
    );

    return {
      period: `${days} روز اخیر`,
      items: rows.map((r: Record<string, unknown>) => ({
        variantId: r.variant_id, sku: r.sku, title: r.title, available: r.available,
        totalSold: r.total_sold, avgDailyQty: Number(r.avg_daily),
        forecast7d: r.forecast_7d, forecast30d: r.forecast_30d,
        daysOfStock: r.days_of_stock, reorderPoint: r.reorder_point,
        urgency: r.days_of_stock != null
          ? (r.days_of_stock as number) <= 3 ? 'critical' : (r.days_of_stock as number) <= 7 ? 'warning' : 'ok'
          : 'unknown',
      })),
    };
  }
}