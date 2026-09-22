import type { Database } from '@set/db';
import { nextNumber } from '@set/db';
import { AppError, type Rial } from '@set/shared-kernel';
import { OrderService } from '@set/orders';

/**
 * صندوقِ حضوری — همان موتورِ فروش، با سه تفاوت:
 *   ۱) کانالِ pos و پرداختِ همان‌لحظه‌ای (نیازی به انتظار برای پرداخت نیست)
 *   ۲) همه‌چیز به یک «شیفت» وابسته است (چه کسی، کِی، با چه صندوقی)
 *   ۳) فروشِ آفلاین: شناسه‌ی آفلاین + کلیدِ یکتایی، تا همگام‌سازی دوبار انجام نشود
 */
/** پنجره‌ی رزرو برای کانالِ حضوری (دقیقه) */
export const POS_RESERVATION_MINUTES = 15;

export interface OpenShiftInput {
  warehouseId: string;
  userId: string;
  branchId?: string | null;
  openingCashRial?: Rial;
}

export interface SellInput {
  shiftId: string;
  items: Array<{ variantId: string; quantity: number }>;
  paymentMethod: 'cash' | 'card' | 'card_to_card' | 'cod' | 'cheque';
  offlineId?: string | null;
  customerMobile?: string | null;
  customerName?: string | null;
  customerId?: string | null;
  vatBasisPoints?: number;
}

export class PosService {
  private readonly orders: OrderService;

  constructor(private readonly db: Database) {
    this.orders = new OrderService(db);
  }

  async openShift(input: OpenShiftInput): Promise<{ shiftId: string; openedAt: string }> {
    // جلوگیری از باز کردنِ شیفتِ دوم روی یک انبار
    const { rows: open } = await this.db.query<{ id: string }>(
      `SELECT id FROM pos_shifts WHERE warehouse_id = $1 AND status = 'open'`,
      [input.warehouseId],
    );
    if (open[0]) throw new AppError('CONFLICT', { details: { message: 'یک شیفت از قبل باز است' } });

    const { rows } = await this.db.query<{ id: string; opened_at: string }>(
      `INSERT INTO pos_shifts (branch_id, warehouse_id, opened_by, opening_cash_rial)
       VALUES ($1, $2, $3, $4) RETURNING id, opened_at`,
      [input.branchId ?? null, input.warehouseId, input.userId, (input.openingCashRial ?? 0n).toString()],
    );
    return { shiftId: rows[0]!.id, openedAt: rows[0]!.opened_at };
  }

  /**
   * فروشِ حضوری: ایجادِ سفارش + پرداختِ همان‌لحظه‌ای در یک جریان.
   * اگر دستگاه آفلاین بوده و بعداً همگام می‌کند، offlineId جلوی ثبتِ تکراری را می‌گیرد.
   */
  async sell(input: SellInput) {
    const { rows } = await this.db.query<{ status: string; branch_id: string | null; warehouse_id: string }>(
      `SELECT status, branch_id, warehouse_id FROM pos_shifts WHERE id = $1`,
      [input.shiftId],
    );
    const shift = rows[0];
    if (!shift) throw new AppError('NOT_FOUND', { details: { message: 'شیفت یافت نشد' } });
    if (shift.status !== 'open') {
      throw new AppError('CONFLICT', { details: { message: 'شیفت بسته است' } });
    }

    const idempotencyKey = input.offlineId ? `pos:${input.shiftId}:${input.offlineId}` : null;

    const order = await this.orders.createOrder({
      channel: 'pos',
      branchId: shift.branch_id,
      warehouseId: shift.warehouse_id,
      items: input.items,
      idempotencyKey,
      customerName: input.customerName ?? null,
      customerMobile: input.customerMobile ?? null,
      customerId: input.customerId ?? null,
      vatBasisPoints: input.vatBasisPoints,
      shippingRial: 0n,
      // فروشِ حضوری بی‌درنگ پرداخت می‌شود، اما پنجره‌ی رزرو را خیلی کوتاه نمی‌گذاریم:
      // اگر کارگرِ آزادسازیِ رزروها درست میانِ ایجاد و پرداخت اجرا شود،
      // نباید فروشی را که در جریان است لغو کند.
      reservationMinutes: POS_RESERVATION_MINUTES,
    });

    // اتصالِ سفارش به شیفت و ثبتِ روشِ پرداخت
    await this.db.query(
      `UPDATE orders SET shift_id = $2, offline_id = $3, payment_method = $4 WHERE id = $1`,
      [order.orderId, input.shiftId, input.offlineId ?? null, input.paymentMethod],
    );

    // اگر تکراریِ آفلاین بود، دوباره پرداخت نمی‌کنیم
    if (!order.duplicate) {
      await this.orders.confirmPayment(order.orderId, {
        amountRial: BigInt(order.totals.totalRial),
        method: input.paymentMethod,
        referenceNo: input.offlineId ? `OFFLINE-${input.offlineId}` : undefined,
      });
    }

    return {
      orderId: order.orderId,
      orderNo: order.orderNo,
      status: order.duplicate ? order.status : 'paid',
      totalRial: order.totals.totalRial,
      duplicate: order.duplicate,
      paymentMethod: input.paymentMethod,
    };
  }

  /** برداشت / خرج از صندوقِ شیفت (مثل پرداختِ هزینه‌ی خرد) */
  async addCashMovement(input: {
    shiftId: string;
    type: 'payout' | 'pickup' | 'expense' | 'float_in';
    amountRial: Rial;
    reason?: string | null;
    actorId?: string | null;
  }): Promise<void> {
    const { rows } = await this.db.query<{ status: string }>(
      `SELECT status FROM pos_shifts WHERE id = $1`, [input.shiftId],
    );
    if (!rows[0]) throw new AppError('NOT_FOUND');
    if (rows[0].status !== 'open') throw new AppError('CONFLICT', { details: { message: 'شیفت بسته است' } });

    await this.db.query(
      `INSERT INTO pos_shift_movements (shift_id, type, amount_rial, reason, actor_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [input.shiftId, input.type, input.amountRial.toString(), input.reason ?? null, input.actorId ?? null],
    );
  }

  /**
   * بستنِ شیفت: مغایرتِ نقدی محاسبه می‌شود.
   * مبلغِ مورد انتظار = موجودیِ اولیه + فروش‌های نقدی − برداشت‌ها
   */
  async closeShift(input: {
    shiftId: string;
    userId: string;
    countedCashRial: Rial;
    note?: string | null;
  }): Promise<{
    expectedCashRial: string;
    countedCashRial: string;
    differenceRial: string;
    salesCount: number;
    salesTotalRial: string;
  }> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ status: string; opening_cash_rial: string }>(
        `SELECT status, opening_cash_rial FROM pos_shifts WHERE id = $1 FOR UPDATE`,
        [input.shiftId],
      );
      const shift = rows[0];
      if (!shift) throw new AppError('NOT_FOUND');
      if (shift.status !== 'open') throw new AppError('CONFLICT', { details: { message: 'شیفت از قبل بسته شده' } });

      const { rows: sales } = await tx.query<{ cnt: string; total: string }>(
        `SELECT COUNT(*)::text AS cnt, COALESCE(SUM(total_rial), 0)::text AS total
           FROM orders WHERE shift_id = $1 AND status = 'paid' AND payment_method = 'cash'`,
        [input.shiftId],
      );
      const { rows: movements } = await tx.query<{ net: string }>(
        `SELECT COALESCE(SUM(CASE WHEN type IN ('payout','expense') THEN -amount_rial ELSE amount_rial END), 0)::text AS net
           FROM pos_shift_movements WHERE shift_id = $1`,
        [input.shiftId],
      );

      const opening = BigInt(shift.opening_cash_rial);
      const cashSales = BigInt(sales[0]?.total ?? '0');
      const netMovements = BigInt(movements[0]?.net ?? '0');
      const expected = opening + cashSales + netMovements;
      const counted = input.countedCashRial;

      await tx.query(
        `UPDATE pos_shifts
            SET status = 'closed', closed_by = $2, closed_at = now(),
                closing_cash_rial = $3, expected_cash_rial = $4, difference_rial = $5, note = $6
          WHERE id = $1`,
        [input.shiftId, input.userId, counted.toString(), expected.toString(), (counted - expected).toString(), input.note ?? null],
      );

      return {
        expectedCashRial: expected.toString(),
        countedCashRial: counted.toString(),
        differenceRial: (counted - expected).toString(),
        salesCount: Number(sales[0]?.cnt ?? '0'),
        salesTotalRial: cashSales.toString(),
      };
    });
  }

  async shiftSummary(shiftId: string) {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT s.*, u.full_name AS opened_by_name
         FROM pos_shifts s LEFT JOIN users u ON u.id = s.opened_by
        WHERE s.id = $1`, [shiftId],
    );
    const shift = rows[0];
    if (!shift) return null;

    const { rows: byMethod } = await this.db.query<{ payment_method: string; cnt: string; total: string }>(
      `SELECT payment_method, COUNT(*)::text AS cnt, COALESCE(SUM(total_rial),0)::text AS total
         FROM orders WHERE shift_id = $1 AND status = 'paid'
        GROUP BY payment_method`, [shiftId],
    );
    const { rows: movements } = await this.db.query<Record<string, unknown>>(
      `SELECT type, amount_rial, reason, created_at FROM pos_shift_movements
        WHERE shift_id = $1 ORDER BY created_at`, [shiftId],
    );
    return { ...shift, byMethod, movements };
  }
}
