import { Controller, Get, Headers, HttpCode, Inject, Param, Post, Body } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@set/shared-kernel';
import type { Database } from '@set/db';
import { publishEvent } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import { availableQuantity } from '@set/inventory';
import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * انبارها و موجودی.
 *
 * این مسیرها پیش‌تر بی‌هیچ احرازِ هویتی باز بودند: هر کسی با یک درخواست می‌توانست
 * موجودیِ تک‌تکِ کالاها و — بدتر — جدولِ ارزش‌گذاری (بهایِ خرید و میانگینِ موزون)
 * را بخواند. ارقامِ موجودی و بهایِ تمام‌شده داده‌یِ محرمانه‌یِ کسب‌وکارند،
 * بنابراین اکنون همه‌ی مسیرها توکنِ معتبر (۴۰۱) و دسترسیِ `inventory.read` (۴۰۳) می‌خواهند.
 */
@Controller('inventory')
export class InventoryController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  private requireReader(authorization: string | undefined): Promise<AccessClaims> {
    return this.requireAccess(authorization, 'inventory', 'read');
  }

  private async requireAccess(authorization: string | undefined, resource: 'inventory', action: 'read' | 'write'): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');

    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');

    await this.access.assert({ userId: claims.sub, branchId: null }, resource, action);
    return claims;
  }

  @Get('warehouses')
  async warehouses(@Headers('authorization') authorization?: string) {
    await this.requireReader(authorization);

    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, name, branch_id, is_default FROM warehouses ORDER BY is_default DESC, name`,
    );
    return { warehouses: rows };
  }

  @Get('stock')
  async stock(@Headers('authorization') authorization?: string) {
    await this.requireReader(authorization);

    const { rows } = await this.db.query<{
      variant_id: string; sku: string; product_title: string; on_hand: number; reserved: number;
      warehouse_id: string; warehouse_name: string | null;
    }>(
      // چرا «انبار» در خروجی هست؟ چون موجودی در این سامانه به‌ازایِ هر انبار
      // است، نه یک عدد برایِ کلِ کسب‌وکار. اگر انبار را نفرستیم، پنل نمی‌فهمد
      // این ۲۰ تا در کدام انبار است و ناچار می‌شود برگشت/رسید را به انباری
      // بفرستد که شاید اصلاً کالا نداشته باشد — خطایی که برایِ کاربر به شکلِ
      // «موجودی کافی نیست» دیده می‌شود، در حالی که موجودی هست، فقط جایش فرق دارد.
      `SELECT v.id AS variant_id, v.sku, p.title AS product_title,
              s.on_hand, s.reserved,
              s.warehouse_id, w.name AS warehouse_name
         FROM stock_items s
         JOIN product_variants v ON v.id = s.variant_id
         JOIN products p ON p.id = v.product_id
         LEFT JOIN warehouses w ON w.id = s.warehouse_id
        ORDER BY w.name NULLS LAST, v.sku`,
    );
    return {
      items: rows.map((r) => ({
        ...r,
        available: r.on_hand - r.reserved,
      })),
    };
  }

  @Post('available')
  @HttpCode(200)
  async available(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    await this.requireReader(authorization);

    const input = z.object({ variantId: z.string().uuid(), warehouseId: z.string().uuid() }).parse(body);
    const quantity = await availableQuantity(this.db, input.variantId, input.warehouseId);
    return { variantId: input.variantId, available: quantity };
  }

  @Get('valuation')
  async valuation(@Headers('authorization') authorization?: string) {
    await this.requireReader(authorization);

    const { rows } = await this.db.query<{
      sku: string; product_title: string; quantity: number; avg_cost_rial: string; value_rial: string;
    }>(
      `SELECT v.sku, p.title AS product_title, iv.quantity, iv.avg_cost_rial,
              (iv.quantity * iv.avg_cost_rial)::text AS value_rial
         FROM inventory_valuation iv
         JOIN product_variants v ON v.id = iv.variant_id
         JOIN products p ON p.id = v.product_id
        ORDER BY v.sku`,
    );
    if (!rows.length) throw new AppError('NOT_FOUND');
    return { items: rows };
  }

  /* ── شمارشِ فیزیکیِ انبار ──────────────────────────────────────────────── */

  @Post('counts')
  async createCount(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ) {
    const claims = await this.requireAccess(authorization, 'inventory', 'write');
    const warehouseId = String(body.warehouseId ?? '');
    if (!warehouseId) throw new AppError('VALIDATION', { message: 'انبار را انتخاب کنید.' });

    const { rows: existing } = await this.db.query<{ id: string }>(
      `SELECT id FROM inventory_counts WHERE warehouse_id = $1 AND status = 'open'`, [warehouseId],
    );
    if (existing[0]) throw new AppError('CONFLICT', { message: 'یک شمارش باز روی این انبار وجود دارد.' });

    const { rows: countRows } = await this.db.query<{ id: string }>(
      `INSERT INTO inventory_counts (warehouse_id, counted_by) VALUES ($1, $2) RETURNING id`,
      [warehouseId, claims.sub],
    );
    const countId = countRows[0]!.id;

    await this.db.query(
      `INSERT INTO inventory_count_items (count_id, variant_id, system_qty)
       SELECT $1, si.variant_id, si.on_hand FROM stock_items si WHERE si.warehouse_id = $2`,
      [countId, warehouseId],
    );

    return { countId, message: 'شمارش ایجاد شد. موجودی فعلی سیستم ثبت شد.' };
  }

  @Post('counts/:id/record')
  async recordCount(
    @Param('id') countId: string,
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ) {
    await this.requireAccess(authorization, 'inventory', 'write');
    const items = body.items as Array<{ variantId: string; countedQty: number }> | undefined;
    if (!items?.length) throw new AppError('VALIDATION', { message: 'آیتمی ارسال نشد.' });

    for (const item of items) {
      await this.db.query(
        `UPDATE inventory_count_items SET counted_qty = $1 WHERE count_id = $2 AND variant_id = $3`,
        [item.countedQty, countId, item.variantId],
      );
    }
    return { message: `${items.length} آیتم ثبت شد.` };
  }

  @Post('counts/:id/close')
  async closeCount(
    @Param('id') countId: string,
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ) {
    await this.requireAccess(authorization, 'inventory', 'write');

    const { rows: countRows } = await this.db.query<{ status: string }>(
      `SELECT status FROM inventory_counts WHERE id = $1`, [countId],
    );
    if (!countRows[0]) throw new AppError('NOT_FOUND');
    if (countRows[0].status !== 'open') throw new AppError('CONFLICT', { message: 'این شمارش قبلاً بسته شده.' });

    await this.db.query(
      `UPDATE inventory_counts SET status = 'closed', closed_at = now(), note = $2 WHERE id = $1`,
      [countId, String(body.note ?? '') || null],
    );

    const { rows: diffs } = await this.db.query(
      `SELECT v.sku, p.title, ici.system_qty, ici.counted_qty, ici.diff_qty
         FROM inventory_count_items ici
         JOIN product_variants v ON v.id = ici.variant_id
         JOIN products p ON p.id = v.product_id
        WHERE ici.count_id = $1 AND ici.diff_qty != 0
        ORDER BY ABS(ici.diff_qty) DESC`,
      [countId],
    );

    return { closed: true, differences: diffs, total: diffs.length };
  }

  @Get('counts')
  async listCounts(@Headers('authorization') authorization?: string) {
    await this.requireAccess(authorization, 'inventory', 'read');
    const { rows } = await this.db.query(
      `SELECT ic.id, w.name AS warehouse, ic.status, ic.created_at, ic.closed_at
         FROM inventory_counts ic JOIN warehouses w ON w.id = ic.warehouse_id
        ORDER BY ic.created_at DESC LIMIT 20`,
    );
    return { counts: rows };
  }

  /* ── انتقالِ بینِ انبارها ──────────────────────────────────────────────── */

  @Post('transfer')
  async transfer(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ) {
    const claims = await this.requireAccess(authorization, 'inventory', 'write');
    const fromWarehouseId = String(body.fromWarehouseId ?? '');
    const toWarehouseId = String(body.toWarehouseId ?? '');
    const variantId = String(body.variantId ?? '');
    const quantity = Number(body.quantity ?? 0);

    if (!fromWarehouseId || !toWarehouseId || !variantId || quantity <= 0) {
      throw new AppError('VALIDATION', { message: 'اطلاعات ناقص است.' });
    }
    if (fromWarehouseId === toWarehouseId) {
      throw new AppError('VALIDATION', { message: 'انبار مبدأ و مقصد یکی است.' });
    }

    return this.db.transaction(async (tx) => {
      const { rows: srcRows } = await tx.query<{ on_hand: number }>(
        `SELECT on_hand FROM stock_items WHERE variant_id = $1 AND warehouse_id = $2 FOR UPDATE`,
        [variantId, fromWarehouseId],
      );
      const src = srcRows[0];
      if (!src || src.on_hand < quantity) {
        throw new AppError('OUT_OF_STOCK', { message: `موجودی مبدأ کافی نیست (${src?.on_hand ?? 0}).` });
      }

      await tx.query(
        `UPDATE stock_items SET on_hand = on_hand - $1, updated_at = now()
          WHERE variant_id = $2 AND warehouse_id = $3`,
        [quantity, variantId, fromWarehouseId],
      );

      await tx.query(
        `INSERT INTO stock_items (variant_id, warehouse_id, on_hand, reserved)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (variant_id, warehouse_id)
         DO UPDATE SET on_hand = stock_items.on_hand + $3, updated_at = now()`,
        [variantId, toWarehouseId, quantity],
      );

      await tx.query(
        `INSERT INTO stock_movements (variant_id, warehouse_id, quantity, reason, reference_type, actor_user_id)
         VALUES ($1, $2, $3, 'انتقال به انبار مقصد', 'transfer_out', $4)`,
        [variantId, fromWarehouseId, -quantity, claims.sub],
      );
      await tx.query(
        `INSERT INTO stock_movements (variant_id, warehouse_id, quantity, reason, reference_type, actor_user_id)
         VALUES ($1, $2, $3, 'انتقال از انبار مبدأ', 'transfer_in', $4)`,
        [variantId, toWarehouseId, quantity, claims.sub],
      );

      return { message: `${quantity} عدد با موفقیت منتقل شد.` };
    });
  }
}
