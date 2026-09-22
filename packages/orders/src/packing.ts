/**
 * بسته‌بندی — گامی که تا امروز در چرخه نبود.
 *
 * چرا یک گامِ جدا؟ چون میانِ «تأییدِ سفارش» و «تحویل به پست» کاری انجام
 * می‌شود که هیچ‌جا ثبت نمی‌شد: کسی کالا را از قفسه برمی‌دارد، می‌شمارد،
 * می‌بندد و کنار می‌گذارد. اگر این کار ثبت نشود:
 *
 *   • پشتیبان نمی‌تواند بگوید «بسته شما امروز بسته‌بندی شد»؛
 *   • کسریِ کالا در همین نقطه کشف می‌شود، اما در سامانه جایی ندارد و با
 *     تلفن و کاغذ پیگیری می‌گردد؛
 *   • ارسال، بی‌آنکه بدانیم چه بسته شده، کدِ رهگیری می‌گیرد.
 *
 * سه تصمیم در این سرویس:
 *   ۱. بسته‌بندی «کسری» هم دارد: کالا کم است، بسته ناقص می‌ماند. این وضعیت
 *      باید ثبت شود تا پشتیبان پیش از تماس بداند.
 *   ۲. ثبتِ بسته‌بندی، کالاهایِ سفارش را یک‌جا می‌آورد: همان‌جاست که انبار
 *      می‌شمارد.
 *   ۳. هر تغییر در `order_status_history` می‌نشیند، تا بعداً بتوان پرسید
 *      «چه کسی و کی این را بست».
 */

import { AppError } from '@set/shared-kernel';
import type { Database, Queryable } from '@set/db';

import { assertTransition, STATUS_LABEL, type OrderStatus } from './cycle.js';

export interface PackingLine {
  variantId: string;
  sku: string | null;
  title: string;
  quantity: number;
  /** موجودیِ قابلِ فروش در لحظه‌یِ بسته‌بندی (on_hand - reserved) */
  available: number;
}

export interface PackedOrder {
  id: string;
  orderNo: string;
  status: OrderStatus;
  packedAt: Date | null;
  packedBy: string | null;
  packingComplete: boolean | null;
  packingNote: string | null;
}

export class PackingService {
  constructor(private readonly db: Database | Queryable) {}

  /**
   * ثبتِ بسته‌بندی.
   *
   * `complete: false` یعنی کسری داریم — سفارش در وضعیتِ «بسته‌بندی» می‌ماند
   * تا کسری برسد، نه اینکه ارسال شود و مشتری ناقص تحویل بگیرد.
   */
  async pack(input: {
    orderId: string;
    actorId: string;
    complete?: boolean;
    note?: string | null;
  }): Promise<{ order: PackedOrder; lines: PackingLine[]; shortages: PackingLine[] }> {
    const res = await this.db.query<{ id: string; order_no: string; status: string }>(
      `SELECT id, order_no, status FROM orders WHERE id = $1`,
      [input.orderId],
    );
    const order = res.rows[0];
    if (!order) throw new AppError('NOT_FOUND', { message: 'سفارش یافت نشد.' });

    assertTransition(order.status, 'packing');

    const lines = await this.lines(input.orderId);
    // کسری را از رویِ موجودی حساب می‌کنیم، نه از ادعایِ کاربر: انباردار
    // ممکن است «کامل» بزند در حالی که قفسه خالی است.
    const shortages = lines.filter((line) => line.available < line.quantity);
    const complete = input.complete === false ? false : shortages.length === 0;

    await this.db.query(
      `UPDATE orders
          SET status = 'packing',
              packed_at = now(),
              packed_by = $2,
              packing_complete = $3,
              packing_note = $4
        WHERE id = $1`,
      [input.orderId, input.actorId, complete, input.note?.slice(0, 500) ?? null],
    );
    await this.db.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, actor_user_id, reason)
       VALUES ($1,$2,'packing',$3,$4)`,
      [input.orderId, order.status, input.actorId, complete ? 'بسته‌بندیِ کامل' : `کسری: ${shortages.length} قلم`],
    );

    return { order: await this.get(input.orderId), lines, shortages };
  }

  /** برگرداندن به «تأییدشده» — مثلاً اگر کالایِ اشتباهی بسته شده باشد */
  async unpack(orderId: string, actorId: string, reason?: string | null): Promise<PackedOrder> {
    const res = await this.db.query<{ status: string }>(`SELECT status FROM orders WHERE id = $1`, [orderId]);
    const order = res.rows[0];
    if (!order) throw new AppError('NOT_FOUND', { message: 'سفارش یافت نشد.' });
    assertTransition(order.status, 'confirmed');

    await this.db.query(
      `UPDATE orders
          SET status = 'confirmed', packed_at = NULL, packed_by = NULL,
              packing_complete = NULL, packing_note = NULL
        WHERE id = $1`,
      [orderId],
    );
    await this.db.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, actor_user_id, reason)
       VALUES ($1,$2,'confirmed',$3,$4)`,
      [orderId, order.status, actorId, reason ?? 'بازگشت از بسته‌بندی'],
    );
    return this.get(orderId);
  }

  /**
   * فهرستِ اقلام برایِ بستن — با موجودیِ لحظه‌ای.
   *
   * انباردار باید همان‌جا ببیند کدام قلم کم است، نه اینکه پس از ثبت پیامِ
   * خطا بگیرد.
   */
  async lines(orderId: string): Promise<PackingLine[]> {
    const res = await this.db.query<{
      variant_id: string;
      sku: string | null;
      title: string;
      quantity: number;
      available: string;
    }>(
      `SELECT oi.variant_id,
              pv.sku,
              p.title,
              oi.quantity,
              COALESCE((SELECT SUM(s.on_hand - s.reserved)
                          FROM stock_items s WHERE s.variant_id = oi.variant_id), 0)::text AS available
         FROM order_items oi
         JOIN product_variants pv ON pv.id = oi.variant_id
         JOIN products p ON p.id = pv.product_id
        WHERE oi.order_id = $1
        ORDER BY p.title`,
      [orderId],
    );
    return res.rows.map((row) => ({
      variantId: row.variant_id,
      sku: row.sku,
      title: row.title,
      quantity: Number(row.quantity),
      available: Number(row.available),
    }));
  }

  /** سفارش‌هایی که در صفِ بسته‌بندی‌اند — صفِ کارِ انبار */
  async queue(options: { limit?: number; offset?: number } = {}): Promise<{ items: PackedOrder[]; total: number }> {
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);
    const res = await this.db.query<{
      id: string;
      order_no: string;
      status: string;
      packed_at: Date | null;
      packed_by: string | null;
      packing_complete: boolean | null;
      packing_note: string | null;
    }>(
      `SELECT id, order_no, status, packed_at, packed_by, packing_complete, packing_note
         FROM orders
        WHERE status IN ('confirmed', 'packing')
        ORDER BY (status = 'packing') ASC, created_at ASC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    const count = await this.db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM orders WHERE status IN ('confirmed','packing')`,
    );
    return {
      items: res.rows.map((row) => ({
        id: row.id,
        orderNo: row.order_no,
        status: row.status as OrderStatus,
        packedAt: row.packed_at ? new Date(row.packed_at) : null,
        packedBy: row.packed_by,
        packingComplete: row.packing_complete,
        packingNote: row.packing_note,
      })),
      total: Number(count.rows[0]?.n ?? 0),
    };
  }

  private async get(orderId: string): Promise<PackedOrder> {
    const res = await this.db.query<{
      id: string;
      order_no: string;
      status: string;
      packed_at: Date | null;
      packed_by: string | null;
      packing_complete: boolean | null;
      packing_note: string | null;
    }>(
      `SELECT id, order_no, status, packed_at, packed_by, packing_complete, packing_note
         FROM orders WHERE id = $1`,
      [orderId],
    );
    const row = res.rows[0];
    if (!row) throw new AppError('NOT_FOUND', { message: 'سفارش یافت نشد.' });
    return {
      id: row.id,
      orderNo: row.order_no,
      status: row.status as OrderStatus,
      packedAt: row.packed_at ? new Date(row.packed_at) : null,
      packedBy: row.packed_by,
      packingComplete: row.packing_complete,
      packingNote: row.packing_note,
    };
  }
}

/** برچسبِ فارسیِ وضعیت، برایِ رابط و پیام */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status as OrderStatus] ?? status;
}
