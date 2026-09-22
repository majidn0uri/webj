import type { Queryable } from '@set/db';
import { AppError, type Rial } from '@set/shared-kernel';
import { nextDocumentNumber } from './numbering.js';
import { getNumber } from './settings.js';
import { changeCredit } from './customers.js';

/**
 * مرجوعی (MR) — BR-44 تا BR-47
 *
 * چهار کنترل پیش از هر چیز:
 *   ۱) مهلت: ۷ روز از تحویل (قابل تنظیم؛ BR-44)
 *   ۲) سلامت کالا و تصمیمِ انباردار با دلیل (BR-45)
 *   ۳) استرداد به همان روش پرداخت؛ اگر چک وصول‌نشده: ابطالِ چک، نه نقد (BR-46)
 *   ۴) سندِ برگشت از فروش: فروش و سودِ همان دوره کاهش می‌یابد و موجودی برمی‌گردد (BR-47)
 */

export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'completed';
export type RefundMethod =
  | 'cash'
  | 'pos_terminal'
  | 'card_to_card'
  | 'online'
  | 'check_void'
  | 'credit';

export interface ReturnRequestItem {
  variantId: string;
  quantity: number;
  /** قیمتی که مشتری پرداخته — BR-06: همان قیمتِ لحظه‌ی ثبت معتبر است */
  unitPriceRial: Rial;
  reason?: string | null;
}

export interface CreateReturnInput {
  sourceType: 'FS' | 'SO';
  sourceId: string;
  customerId?: string | null;
  items: ReturnRequestItem[];
  reason: string;
  requestedBy?: string | null;
}

export interface ReturnRecord {
  id: string;
  return_no: string;
  source_type: 'FS' | 'SO';
  source_id: string;
  customer_id: string | null;
  status: ReturnStatus;
  refund_method: RefundMethod | null;
  total_rial: string;
}

export async function requestReturn(
  db: Queryable,
  input: CreateReturnInput,
): Promise<ReturnRecord> {
  if (input.items.length === 0) {
    throw new AppError('VALIDATION', { message: 'دست‌کم یک قلم برای مرجوعی لازم است' });
  }

  const total = input.items.reduce(
    (sum, it) => sum + BigInt(it.unitPriceRial) * BigInt(it.quantity),
    0n,
  );

  const number = await nextDocumentNumber(db, 'MR');
  const { rows } = await db.query<ReturnRecord>(
    `INSERT INTO returns
       (return_no, source_type, source_id, customer_id, status, reason, total_rial, requested_by)
     VALUES ($1,$2,$3,$4,'requested',$5,$6,$7)
     RETURNING *`,
    [
      number.code,
      input.sourceType,
      input.sourceId,
      input.customerId ?? null,
      input.reason,
      total.toString(),
      input.requestedBy ?? null,
    ],
  );
  const record = rows[0]!;

  for (const it of input.items) {
    await db.query(
      `INSERT INTO return_items (return_id, variant_id, quantity, unit_price_rial, reason)
       VALUES ($1,$2,$3,$4,$5)`,
      [record.id, it.variantId, it.quantity, it.unitPriceRial.toString(), it.reason ?? null],
    );
  }

  return record;
}

/** بررسیِ مهلتِ مرجوعی: ۷ روز از تحویل (BR-44) */
export async function withinReturnWindow(
  db: Queryable,
  sourceType: 'FS' | 'SO',
  sourceId: string,
  at: Date = new Date(),
): Promise<{ ok: boolean; deliveredAt: Date | null; deadline: Date | null; days: number }> {
  const days = await getNumber(db, 'return_window_days');

  // مرجوعیِ فروشِ حضوری: از تاریخِ فاکتور | آنلاین: از تاریخِ تحویل
  const { rows } = await db.query<{ anchor: Date | null }>(
    sourceType === 'SO'
      ? `SELECT delivered_at AS anchor FROM shipments WHERE order_id = $1 AND status = 'delivered' ORDER BY delivered_at DESC LIMIT 1`
      : `SELECT created_at AS anchor FROM orders WHERE id = $1`,
    [sourceId],
  );
  const anchor = rows[0]?.anchor ? new Date(rows[0].anchor) : null;
  if (!anchor) return { ok: false, deliveredAt: null, deadline: null, days };

  const deadline = new Date(anchor.getTime() + days * 24 * 60 * 60 * 1000);
  return { ok: at <= deadline, deliveredAt: anchor, deadline, days };
}

/** تصمیمِ انباردار/مدیر با ثبتِ دلیل (BR-45 , BR-62) */
export async function decideReturn(
  db: Queryable,
  input: {
    returnId: string;
    approve: boolean;
    decisionNote: string;
    decidedBy: string;
    fates?: Array<{ variantId: string; fate: 'to_stock' | 'scrap' | 'to_supplier'; condition?: 'ok' | 'damaged' }>;
  },
): Promise<ReturnRecord> {
  const { rows: before } = await db.query<ReturnRecord>(`SELECT * FROM returns WHERE id = $1`, [
    input.returnId,
  ]);
  const record = before[0];
  if (!record) throw new AppError('NOT_FOUND', { message: 'درخواستِ مرجوعی یافت نشد' });
  if (record.status !== 'requested') {
    throw new AppError('CONFLICT', { message: 'این درخواست پیش‌تر بررسی شده است' });
  }

  if (input.approve) {
    const window = await withinReturnWindow(db, record.source_type, record.source_id);
    if (!window.ok) {
      throw new AppError('CONFLICT', {
        message: `مهلتِ ${window.days} روزه‌ی مرجوعی گذشته است (مبنای محاسبه: ${
          window.deliveredAt ? window.deliveredAt.toISOString().slice(0, 10) : 'نامشخص'
        })`,
      });
    }
  }

  const { rows } = await db.query<ReturnRecord>(
    `UPDATE returns
        SET status = $1, decision_note = $2, decided_by = $3, decided_at = now()
      WHERE id = $4 RETURNING *`,
    [input.approve ? 'approved' : 'rejected', input.decisionNote, input.decidedBy, input.returnId],
  );

  if (input.fates?.length) {
    for (const f of input.fates) {
      await db.query(
        `UPDATE return_items SET fate = $1, condition = $2
          WHERE return_id = $3 AND variant_id = $4`,
        [f.fate, f.condition ?? 'ok', input.returnId, f.variantId],
      );
    }
  }

  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity, entity_id, before_data, after_data)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [
      input.decidedBy,
      input.approve ? 'return.approved' : 'return.rejected',
      'returns',
      input.returnId,
      JSON.stringify({ status: record.status }),
      JSON.stringify({ status: input.approve ? 'approved' : 'rejected', note: input.decisionNote }),
    ],
  );

  // پیامک تأیید/رد مرجوعی
  try {
    const { enqueueSms } = await import('./sms.js');
    // پیدا کردن شماره موبایل مشتری از سفارش اصلی
    const { rows: orderInfo } = await db.query<{ customer_mobile: string | null; order_no: string }>(
      `SELECT o.customer_mobile, o.order_no FROM orders o WHERE o.id = $1`, [record.source_id],
    );
    if (orderInfo[0]?.customer_mobile) {
      const status = input.approve ? 'تأیید شد' : 'رد شد';
      const { rows: settings } = await db.query<{ value: string }>(
        `SELECT value FROM store_settings WHERE key = 'store_name'`,
      );
      const storeName = settings[0]?.value ?? 'فروشگاه';
      await enqueueSms(db, {
        phone: orderInfo[0].customer_mobile,
        templateKey: input.approve ? 'order_confirmed' : 'order_cancelled',
        vars: { order: orderInfo[0].order_no },
      });
    }
  } catch { /* پیامک نباید تصمیم مرجوعی را متوقف کند */ }

  return rows[0]!;
}

/**
 * تکمیلِ مرجوعی: موجودی برمی‌گردد، وجه مسترد یا اعتبار می‌شود، و سندِ
 * برگشت از فروش صادر می‌گردد (BR-46 , BR-47).
 *
 * موجودی: به انبارِ پیش‌فرض برمی‌گردد (سندِ اصلی از همان انبار کسر کرده بود).
 * سندِ حسابداری: برعکسِ سندِ فروش — بستانکار فروش، بدهکار برگشت از فروش.
 */
export async function completeReturn(
  db: Queryable,
  input: {
    returnId: string;
    refundMethod: RefundMethod;
    actorId: string;
    warehouseId?: string | null;
  },
): Promise<{ record: ReturnRecord; returnedRial: bigint; journalEntryId: string | null }> {
  const { rows: before } = await db.query<ReturnRecord>(`SELECT * FROM returns WHERE id = $1`, [
    input.returnId,
  ]);
  const record = before[0];
  if (!record) throw new AppError('NOT_FOUND', { message: 'درخواست یافت نشد' });
  if (record.status !== 'approved') {
    throw new AppError('CONFLICT', { message: 'مرجوعی باید پیش از تکمیل، تأیید شده باشد' });
  }

  const { rows: items } = await db.query<{
    variant_id: string;
    quantity: number;
    unit_price_rial: string;
    fate: string | null;
  }>(
    `SELECT variant_id, quantity, unit_price_rial::text, fate FROM return_items WHERE return_id = $1`,
    [input.returnId],
  );

  // انبارِ مقصد: همان انباری که سفارش از آن کسر شده بود
  const warehouseId =
    input.warehouseId ??
    (await db
      .query<{ warehouse_id: string }>(
        `SELECT warehouse_id FROM stock_items WHERE variant_id = $1 LIMIT 1`,
        [items[0]?.variant_id ?? ''],
      )
      .then((r) => r.rows[0]?.warehouse_id ?? null));

  let returnedRial = 0n;

  for (const it of items) {
    // BR-45: کالای سالم به موجودی برمی‌گردد؛ معیوب خیر
    if ((it.fate ?? 'to_stock') !== 'to_stock') continue;
    if (!warehouseId) continue;

    await db.query(
      `INSERT INTO stock_items (variant_id, warehouse_id, on_hand, reserved)
       VALUES ($1,$2,$3,0)
       ON CONFLICT (variant_id, warehouse_id)
       DO UPDATE SET on_hand = stock_items.on_hand + EXCLUDED.on_hand, updated_at = now()`,
      [it.variant_id, warehouseId, it.quantity],
    );
    await db.query(
      `INSERT INTO stock_movements (variant_id, warehouse_id, quantity, reason, reference_type, reference_id, actor_user_id)
       VALUES ($1,$2,$3,'return','return',$4,$5)`,
      [it.variant_id, warehouseId, it.quantity, input.returnId, input.actorId],
    );
    returnedRial += BigInt(it.unit_price_rial) * BigInt(it.quantity);
  }

  // BR-46: استرداد به همان روش؛ چکِ وصول‌نشده ابطال می‌شود نه نقد
  if (input.refundMethod === 'check_void') {
    const { rows: checks } = await db.query<{ id: string }>(
      `SELECT id FROM checks WHERE document_id = $1 AND status IN ('in_circulation','deposited')`,
      [record.source_id],
    );
    for (const c of checks) {
      await db.query(
        `UPDATE checks SET status = 'void', void_reason = $1, updated_at = now() WHERE id = $2`,
        [`ابطال به‌دلیل مرجوعی ${record.return_no}`, c.id],
      );
      await db.query(
        `INSERT INTO check_status_logs (check_id, to_status, reason, actor_id)
         VALUES ($1,'void',$2,$3)`,
        [c.id, `مرجوعی ${record.return_no}`, input.actorId],
      );
    }
  } else if (input.refundMethod === 'credit' && record.customer_id) {
    await changeCredit(db, {
      customerId: record.customer_id,
      deltaRial: returnedRial,
      actorId: input.actorId,
      note: `اعتبارِ مرجوعی ${record.return_no}`,
    });
  }

  // BR-47: سندِ برگشت از فروش
  const { rows: entries } = await db.query<{ id: string }>(
    `SELECT id FROM journal_entries WHERE reference_id = $1 AND reference_type IN ('sale','order','pos_sale') AND status = 'posted' LIMIT 1`,
    [record.source_id],
  );
  let journalEntryId: string | null = null;
  const original = entries[0];

  if (original && returnedRial > 0n) {
    const { rows: lines } = await db.query<{ account_id: string; debit_rial: string; credit_rial: string }>(
      `SELECT account_id, debit_rial::text, credit_rial::text FROM journal_lines WHERE entry_id = $1`,
      [original.id],
    );
    const number = await nextDocumentNumber(db, 'MR');
    const { rows: created } = await db.query<{ id: string }>(
      `INSERT INTO journal_entries (entry_no, description, reference_type, reference_id, status, posted_at, period)
       VALUES ($1,$2,'return',$3,'posted',now(),to_char(now(),'YYYY-MM'))
       RETURNING id`,
      [number.code, `برگشت از فروش — ${record.return_no}`, input.returnId],
    );
    journalEntryId = created[0]?.id ?? null;

    // معکوسِ سطرها: آنچه بستانکار بود بدهکار می‌شود و برعکس
    for (const l of lines) {
      await db.query(
        `INSERT INTO journal_lines (entry_id, account_id, debit_rial, credit_rial)
         VALUES ($1,$2,$3,$4)`,
        [journalEntryId, l.account_id, l.credit_rial, l.debit_rial],
      );
    }
  }

  const { rows: updated } = await db.query<ReturnRecord>(
    `UPDATE returns SET status = 'completed', refund_method = $1, journal_entry_id = $2
      WHERE id = $3 RETURNING *`,
    [input.refundMethod, journalEntryId, input.returnId],
  );

  return { record: updated[0]!, returnedRial, journalEntryId };
}
