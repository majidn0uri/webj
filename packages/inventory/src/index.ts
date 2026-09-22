import type { Database, Queryable } from '@set/db';
import { AppError } from '@set/shared-kernel';

/**
 * موجودی و رزرو — جایی که وعده‌ی «لغو نمی‌شود» ساخته می‌شود.
 *
 * سه عملِ اصلی، هر سه با UPDATEِ شرطیِ اتمیک (بدون خواندن و سپس نوشتن):
 *   • رزرو:    reserved را زیاد می‌کند فقط اگر موجودیِ آزاد کافی باشد
 *   • تأیید:   پس از پرداخت، on_hand و reserved را هم‌زمان کم می‌کند
 *   • آزادسازی: رزرو را برمی‌گرداند (انصراف یا انقضا)
 */

export interface ReserveItem {
  variantId: string;
  quantity: number;
}

export interface ReserveResult {
  ok: boolean;
  failedVariantId?: string;
  available?: number;
}

/** رزروِ اتمیک — یا همه یا هیچ (در تراکنش صدا زده می‌شود) */
export async function reserveStock(
  tx: Queryable,
  warehouseId: string,
  items: ReserveItem[],
): Promise<ReserveResult> {
  for (const item of items) {
    const { rows } = await tx.query<{ on_hand: number; reserved: number }>(
      `UPDATE stock_items
          SET reserved = reserved + $3, updated_at = now()
        WHERE variant_id = $1 AND warehouse_id = $2
          AND on_hand - reserved >= $3
        RETURNING on_hand, reserved`,
      [item.variantId, warehouseId, item.quantity],
    );

    if (rows.length === 0) {
      // برای پیامِ دقیق به مشتری، موجودیِ واقعی را می‌خوانیم (فقط برای نمایش)
      const { rows: current } = await tx.query<{ on_hand: number; reserved: number }>(
        `SELECT on_hand, reserved FROM stock_items WHERE variant_id = $1 AND warehouse_id = $2`,
        [item.variantId, warehouseId],
      );
      return {
        ok: false,
        failedVariantId: item.variantId,
        available: current[0] ? current[0].on_hand - current[0].reserved : 0,
      };
    }
  }
  return { ok: true };
}

/** بهایِ هر واحد در لحظه‌یِ خروج؛ گزارشِ سودِ ناخالص با همین عدد حساب می‌شود */
export interface ConfirmedCost {
  variantId: string;
  quantity: number;
  unitCostRial: bigint;
}

/**
 * تأییدِ نهایی پس از پرداخت: خروجِ واقعیِ کالا از انبار + ثبتِ حرکت.
 *
 * چرا بها را اینجا می‌خوانیم و برمی‌گردانیم؟ چون «بهایِ کالای فروخته‌شده»
 * باید در همان لحظه‌ای ثبت شود که کالا از انبار می‌رود؛ اگر بعداً از روی
 * میانگینِ امروز حساب شود، سودِ فروشِ سه ماهِ پیش با بهایِ خریدِ امروز مخلوط
 * می‌شود و حاشیه‌یِ سودِ هر دوره غلط درمی‌آید. عدد از همان جدولی خوانده
 * می‌شود که سندِ حسابداری می‌خواند (inventory_valuation) و در همان تراکنش —
 * پس انبار و دفترکل یک رقم را می‌بینند.
 */
export async function confirmStock(
  tx: Queryable,
  warehouseId: string,
  items: ReserveItem[],
  referenceId: string,
): Promise<ConfirmedCost[]> {
  const costs: ConfirmedCost[] = [];
  for (const item of items) {
    const { rows } = await tx.query(
      `UPDATE stock_items
          SET on_hand = on_hand - $3, reserved = reserved - $3, updated_at = now()
        WHERE variant_id = $1 AND warehouse_id = $2 AND reserved >= $3
        RETURNING id`,
      [item.variantId, warehouseId, item.quantity],
    );
    if (rows.length === 0) {
      throw new AppError('INVARIANT', {
        details: { message: 'رزرو برای تأیید کافی نیست', variantId: item.variantId },
      });
    }

    const { rows: val } = await tx.query<{ avg_cost_rial: string }>(
      `SELECT avg_cost_rial FROM inventory_valuation
        WHERE variant_id = $1 AND warehouse_id = $2 FOR UPDATE`,
      [item.variantId, warehouseId],
    );
    const unitCostRial = BigInt(val[0]?.avg_cost_rial ?? '0');

    await tx.query(
      `INSERT INTO stock_movements (variant_id, warehouse_id, quantity, reason, reference_type, reference_id, unit_cost_rial)
       VALUES ($1, $2, $3, 'sale', 'order', $4, $5)`,
      [item.variantId, warehouseId, -item.quantity, referenceId, unitCostRial.toString()],
    );

    costs.push({ variantId: item.variantId, quantity: item.quantity, unitCostRial });
  }
  return costs;
}

/** آزادسازیِ رزرو (انصراف یا انقضای مهلتِ پرداخت) */
export async function releaseStock(
  tx: Queryable,
  warehouseId: string,
  items: ReserveItem[],
  reason = 'release',
): Promise<void> {
  for (const item of items) {
    await tx.query(
      `UPDATE stock_items
          SET reserved = GREATEST(reserved - $3, 0), updated_at = now()
        WHERE variant_id = $1 AND warehouse_id = $2`,
      [item.variantId, warehouseId, item.quantity],
    );
  }
}

/** موجودیِ قابل فروشِ یک تنوع */
export async function availableQuantity(
  db: Queryable,
  variantId: string,
  warehouseId?: string,
): Promise<number> {
  const { rows } = await db.query<{ available: number }>(
    `SELECT COALESCE(SUM(on_hand - reserved), 0)::int AS available
       FROM stock_items
      WHERE variant_id = $1 AND ($2::uuid IS NULL OR warehouse_id = $2::uuid)`,
    [variantId, warehouseId ?? null],
  );
  return rows[0]?.available ?? 0;
}

/** پاک‌سازیِ رزروهای منقضی‌شده — توسط یک کارگرِ دوره‌ای اجرا می‌شود */
export async function releaseExpiredReservations(
  db: Database,
  warehouseId: string,
  limit = 200,
): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM orders
      WHERE status = 'pending_payment'
        AND paid_at IS NULL
        AND reservation_expires_at IS NOT NULL
        AND reservation_expires_at < now()
      ORDER BY reservation_expires_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  for (const order of rows) {
    await db.transaction(async (tx) => {
      const { rows: items } = await tx.query<{ variant_id: string; quantity: number }>(
        `SELECT variant_id, quantity FROM order_items WHERE order_id = $1`,
        [order.id],
      );
      await releaseStock(
        tx,
        warehouseId,
        items.map((i) => ({ variantId: i.variant_id, quantity: i.quantity })),
        'expired',
      );
      await tx.query(
        `UPDATE orders SET status = 'cancelled', cancelled_at = now(),
                cancel_reason = 'payment_timeout', reservation_expires_at = NULL
          WHERE id = $1`,
        [order.id],
      );
      await tx.query(
        `INSERT INTO order_status_history (order_id, from_status, to_status, reason)
         VALUES ($1, 'pending_payment', 'cancelled', 'payment_timeout')`,
        [order.id],
      );
    });
  }
  return rows.length;
}
