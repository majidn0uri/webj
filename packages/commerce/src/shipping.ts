import type { Queryable } from '@set/db';
import { AppError } from '@set/shared-kernel';
import { getSetting } from './settings.js';
import { STATUS_LABEL, type OrderStatus } from '@set/orders';
import { nextDocumentNumber } from './numbering.js';

/**
 * مرسوله (MS) و تعرفه‌ی ارسال — BR-42 , BR-43
 *
 * BR-42: وضعیتِ «ارسال‌شده» بدون کد رهگیری ثبت نمی‌شود — این یک کنترلِ
 *        ساده روی یک رشته نیست؛ نبودِ کد رهگیری یعنی مشتری نمی‌تواند پیگیری
 *        کند و بارِ پشتیبانی به تماسِ تلفنی منتقل می‌شود.
 * BR-43: هزینه از جدولِ تعرفه (روش × شهر) می‌آید و در سفارش «عکس‌برداری»
 *        می‌شود؛ تغییرِ تعرفه، سفارش‌های ثبت‌شده را تغییر نمی‌دهد.
 */

export interface ShippingOption {
  methodKey: string;
  methodLabel: string;
  city: string;
  costRial: bigint;
  etaDays: number;
}

export async function shippingOptions(db: Queryable, city: string): Promise<ShippingOption[]> {
  const { rows } = await db.query<{
    method_key: string;
    method_label: string;
    city: string;
    cost_rial: string;
    eta_days: number;
  }>(
    `SELECT method_key, method_label, city, cost_rial::text, eta_days
       FROM shipping_tariffs
      WHERE is_active = true AND city = $1
      ORDER BY cost_rial`,
    [city.trim()],
  );
  return rows.map((r) => ({
    methodKey: r.method_key,
    methodLabel: r.method_label,
    city: r.city,
    costRial: BigInt(r.cost_rial),
    etaDays: r.eta_days,
  }));
}

export async function tariffFor(
  db: Queryable,
  methodKey: string,
  city: string,
): Promise<ShippingOption | null> {
  const { rows } = await db.query<{
    method_key: string;
    method_label: string;
    city: string;
    cost_rial: string;
    eta_days: number;
  }>(
    `SELECT method_key, method_label, city, cost_rial::text, eta_days
       FROM shipping_tariffs
      WHERE is_active = true AND method_key = $1 AND city = $2`,
    [methodKey, city.trim()],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    methodKey: r.method_key,
    methodLabel: r.method_label,
    city: r.city,
    costRial: BigInt(r.cost_rial),
    etaDays: r.eta_days,
  };
}

export async function setTariff(
  db: Queryable,
  input: {
    methodKey: string;
    methodLabel: string;
    city: string;
    costRial: bigint;
    etaDays?: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO shipping_tariffs (method_key, method_label, city, cost_rial, eta_days)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (method_key, city)
     DO UPDATE SET cost_rial = EXCLUDED.cost_rial,
                   eta_days = EXCLUDED.eta_days,
                   method_label = EXCLUDED.method_label,
                   is_active = true`,
    [
      input.methodKey,
      input.methodLabel,
      input.city.trim(),
      input.costRial.toString(),
      input.etaDays ?? 3,
    ],
  );
}

export interface CreateShipmentInput {
  orderId: string;
  carrier: string;
  trackingCode: string;
  costRial?: bigint;
  receiverName?: string | null;
  actorId?: string | null;
}

export interface Shipment {
  id: string;
  shipment_no: string;
  order_id: string;
  carrier: string;
  tracking_code: string;
  cost_rial: string;
  status: 'sent' | 'delivered' | 'returned' | 'lost';
}

export async function createShipment(
  db: Queryable,
  input: CreateShipmentInput,
): Promise<Shipment> {
  // BR-42: کد رهگیری الزامی
  const tracking = (input.trackingCode ?? '').trim();
  if (tracking.length < 6) {
    throw new AppError('VALIDATION', {
      message: 'ثبتِ ارسال بدون کد رهگیری مجاز نیست (کد باید دست‌کم ۶ کاراکتر باشد)',
    });
  }

  // سفارش باید در وضعیتی باشد که بتوان ارسالش کرد (BR-40 , BR-41)
  const { rows: order } = await db.query<{ status: string }>(
    `SELECT status FROM orders WHERE id = $1`,
    [input.orderId],
  );
  const status = order[0]?.status;
  if (!status) throw new AppError('NOT_FOUND', { message: 'سفارش یافت نشد' });
  // ارسال، تنها پس از بسته‌بندی. چرا این قدر سخت‌گیر؟ چون کدِ رهگیری یعنی
  // «بسته از انبار رفت»، و اگر بسته‌بندی ثبت نشده باشد، پشتیبان نمی‌تواند
  // بگوید چه چیزی در بسته بود و چه کسی آن را بست — نخستین پرسش در هر
  // اختلافِ «کالا نرسید» یا «کالا کم بود».
  // راهِ میان‌بُر برایِ فروشِ حضوری لازم نیست: آن‌جا سفارش از «پرداخت‌شده»
  // یک‌راست «تحویل‌شده» می‌شود و اصلاً از این مسیر نمی‌گذرد.
  if (status !== 'packing') {
    const required = (await getSetting(db, 'packing_required_before_ship')) !== 'false';
    if (required) {
      throw new AppError('CONFLICT', {
        message: `سفارش در وضعیتِ «${STATUS_LABEL[status as OrderStatus] ?? status}» است؛ پیش از ارسال باید بسته‌بندیِ آن ثبت شود.`,
      });
    }
    if (!['confirmed', 'processing'].includes(status)) {
      throw new AppError('CONFLICT', {
        message: `سفارش در وضعیتِ «${STATUS_LABEL[status as OrderStatus] ?? status}» است و نمی‌توان آن را ارسال کرد.`,
      });
    }
  }

  const number = await nextDocumentNumber(db, 'MS');

  const { rows } = await db.query<Shipment>(
    `INSERT INTO shipments
       (shipment_no, order_id, carrier, tracking_code, cost_rial, receiver_name, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      number.code,
      input.orderId,
      input.carrier,
      tracking,
      (input.costRial ?? 0n).toString(),
      input.receiverName ?? null,
      input.actorId ?? null,
    ],
  );

  await db.query(
    `UPDATE orders SET status = 'shipped' WHERE id = $1`,
    [input.orderId],
  );
  await db.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, actor_user_id, reason)
     VALUES ($1,$2,'shipped',$3,$4)`,
    [input.orderId, status, input.actorId ?? null, `مرسوله ${number.code}`],
  );

  // پیامکِ ارسال
  try {
    const { enqueueSms } = await import('./sms.js');
    const { rows: orderInfo } = await db.query<{ customer_mobile: string | null; order_no: string }>(
      `SELECT customer_mobile, order_no FROM orders WHERE id = $1`, [input.orderId],
    );
    if (orderInfo[0]?.customer_mobile) {
      await enqueueSms(db, {
        phone: orderInfo[0].customer_mobile,
        templateKey: 'order_shipped',
        vars: { order: orderInfo[0].order_no, tracking: tracking },
      });
    }
  } catch { /* پیامک نباید ارسال را متوقف کند */ }

  return rows[0]!;
}

export async function markDelivered(
  db: Queryable,
  shipmentId: string,
  actorId?: string | null,
): Promise<Shipment> {
  const { rows: before } = await db.query<Shipment>(`SELECT * FROM shipments WHERE id = $1`, [
    shipmentId,
  ]);
  const s = before[0];
  if (!s) throw new AppError('NOT_FOUND', { message: 'مرسوله یافت نشد' });
  if (s.status !== 'sent') {
    throw new AppError('CONFLICT', { message: 'تنها مرسوله‌ی ارسال‌شده قابل تحویل است' });
  }

  const { rows } = await db.query<Shipment>(
    `UPDATE shipments SET status = 'delivered', delivered_at = now() WHERE id = $1 RETURNING *`,
    [shipmentId],
  );
  await db.query(
    `UPDATE orders SET status = 'delivered' WHERE id = $1`,
    [s.order_id],
  );
  await db.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, actor_user_id, reason)
     VALUES ($1,'shipped','delivered',$2,$3)`,
    [s.order_id, actorId ?? null, `تحویلِ مرسوله ${s.shipment_no}`],
  );

  // پیامکِ تحویل
  try {
    const { enqueueSms } = await import('./sms.js');
    const { rows: orderInfo } = await db.query<{ customer_mobile: string | null; order_no: string }>(
      `SELECT customer_mobile, order_no FROM orders WHERE id = $1`, [s.order_id],
    );
    if (orderInfo[0]?.customer_mobile) {
      await enqueueSms(db, {
        phone: orderInfo[0].customer_mobile,
        templateKey: 'order_delivered',
        vars: { order: orderInfo[0].order_no },
      });
    }
  } catch { /* پیامک نباید تحویل را متوقف کند */ }

  return rows[0]!;
}

/** گم‌شدن یا برگشتِ مرسوله (بخش ۴: «مرسوله گم شد») */
export async function markShipmentIssue(
  db: Queryable,
  input: {
    shipmentId: string;
    status: 'returned' | 'lost';
    note?: string | null;
    actorId?: string | null;
  },
): Promise<Shipment> {
  const { rows: before } = await db.query<Shipment>(`SELECT * FROM shipments WHERE id = $1`, [input.shipmentId]);
  const current = before[0];
  if (!current) throw new AppError('NOT_FOUND', { message: 'مرسوله یافت نشد' });
  if (current.status !== 'sent') {
    throw new AppError('CONFLICT', { message: 'فقط مرسوله‌ی ارسال‌شده قابل برگشت یا ثبتِ گم‌شدگی است' });
  }
  const { rows } = await db.query<Shipment>(
    `UPDATE shipments SET status = $1 WHERE id = $2 AND status = 'sent' RETURNING *`,
    [input.status, input.shipmentId],
  );
  const s = rows[0];
  if (!s) throw new AppError('NOT_FOUND', { message: 'مرسوله یافت نشد' });
  await db.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, actor_user_id, reason)
     VALUES ($1,'shipped',$2,$3,$4)`,
    [
      s.order_id,
      input.status,
      input.actorId ?? null,
      input.note ?? (input.status === 'lost' ? 'گم‌شدگی — در حال پیگیری' : 'مرسوله برگشت خورد'),
    ],
  );
  return s;
}
