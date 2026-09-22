import type { Queryable } from '@set/db';
import { formatJalali } from '@set/shared-kernel';

/**
 * گردشِ موجودی — پاسخ به دو پرسشِ پول‌ساز:
 *   «کدام کالا پولِ شرکت را خوابانده؟» و «کدام کالا را باید بیشتر بخریم؟»
 *
 * عددِ اصلی این است: موجودیِ هر کالا چند روز دوام می‌آورد؟ (روزهایِ گردش)
 * که از دو چیز ساخته می‌شود:
 *
 *   میانگینِ ارزشِ موجودی در دوره  ÷  بهایِ کالای فروخته‌شده‌یِ هر روز
 *
 * دو نکته‌یِ مهم که اگر نادیده گرفته شوند، عدد غلط از آب درمی‌آید:
 *
 *   ۱) «میانگینِ موجودی» در پایگاه ذخیره نمی‌شود (ما عکسِ لحظه‌یِ روزانه
 *      نداریم)؛ پس آن را بازسازی می‌کنیم:
 *         موجودیِ آغازِ دوره = موجودیِ پایان + بهایِ کالای فروخته‌شده
 *                             − کالای دریافتی در دوره
 *      و میانگین را میانگینِ آغاز و پایان می‌گیریم. این تقریب در فایل
 *      مستند شده و در خروجی هم با یک هشدار گفته می‌شود تا مدیر بداند این
 *      عدد «حسابداریِ دقیقِ روزانه» نیست.
 *   ۲) مرجوعیِ مشتری از فروش کم می‌شود (وگرنه گردشِ کالایی که برگشته،
 *      دروغی بالا نشان داده می‌شد).
 *
 * طبقه‌بندی بر پایه‌یِ روزهایِ گردش (ثابت‌ها در TURNOVER_THRESHOLDS):
 *   • تند‌گردش: تا ۴۵ روز        → کالایِ پرفروش؛ کمبودش یعنی فروشِ از دست‌رفته
 *   • عادی:     ۴۶ تا ۱۲۰ روز    → وضعِ سالم
 *   • کند‌گردش: ۱۲۱ تا ۳۶۵ روز   → باید سفارش را کم کرد
 *   • راکد:     بی‌فروش در دوره  → سرمایه‌یِ خوابیده؛ باید تخفیف یا مرجوعی
 */

export const TURNOVER_THRESHOLDS = {
  /** تا این اندازه روز، کالا تند‌گردش است */
  fastDays: 45,
  /** تا این اندازه روز، کالا در وضعِ عادی است */
  normalDays: 120,
  /** بیش از این اندازه روز، کالا کند‌گردش است */
  slowDays: 365,
} as const;

export type StockStatus = 'fast' | 'normal' | 'slow' | 'dead';

export interface StockTurnoverInput {
  /** پنجره‌یِ بررسی (پیش‌فرض ۹۰ روز) */
  windowDays?: number;
  warehouseId?: string | null;
  /** انتهایِ پنجره (پیش‌فرض: اکنون) */
  asOf?: Date;
  /** فقط کالاهایِ فعال؟ (پیش‌فرض: بله) */
  activeOnly?: boolean;
}

export interface StockTurnoverRow {
  variantId: string;
  sku: string;
  title: string;
  soldQuantity: number;
  cogsRial: string;
  closingQuantity: number;
  closingValueRial: string;
  openingValueRial: string;
  averageInventoryRial: string;
  /** گردش در سال (چند بار در سال موجودی خالی و پُر می‌شود)؛ ناتهی یعنی بی‌معنا */
  turnoverPerYear: number | null;
  /** چند روز موجودی دوام می‌آورد؛ ناتهی یعنی فروشی نبوده */
  daysOfInventory: number | null;
  status: StockStatus;
}

export interface StockTurnoverReport {
  windowDays: number;
  from: Date;
  to: Date;
  fromJalali: string;
  toJalali: string;
  rows: StockTurnoverRow[];
  totals: {
    inventoryValueRial: string;
    cogsRial: string;
    turnoverPerYear: number | null;
    daysOfInventory: number | null;
    deadStockValueRial: string;
    deadStockCount: number;
    slowStockValueRial: string;
  };
  warnings: string[];
}

function toBig(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'number') return BigInt(Math.round(value));
  const cleaned = value.includes('.') ? value.slice(0, value.indexOf('.')) : value;
  return cleaned === '' ? 0n : BigInt(cleaned);
}

/** نسبت‌هایِ گزارش با یک رقمِ اعشار گرد می‌شوند (۲۳٫۴ بار در سال) */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

interface Row {
  variant_id: string;
  sku: string;
  title: string;
  sold_qty: string;
  cogs: string;
  closing_qty: string;
  closing_value: string;
  purchases: string;
}

/**
 * نام‌گذاریِ وضعیت. یک نکته‌یِ ظریف و مهم: «راکد» فقط یعنی «در این پنجره
 * هیچ فروشی نداشته». کالایی که فروش رفته ولی گردشش از یک سال کندتر است،
 * «کند‌گردش» است نه «راکد» — فرقِ این دو در تصمیم است: راکد یعنی سرمایه‌ی
 * بی‌حرکت (باید تخفیف یا مرجوعی داد)، کند‌گردش یعنی باید از خریدِ دوباره
 * دست کشید. یکی گرفتنِ این دو، مدیر را به تصمیمِ غلط می‌برد.
 */
function classify(soldQty: number, daysOfInventory: number | null): StockStatus {
  if (soldQty <= 0) return 'dead';
  // فروش رفته اما میانگینِ موجودی صفر بوده: یعنی هرچه آمده رفته است
  if (daysOfInventory === null) return 'fast';
  if (daysOfInventory <= TURNOVER_THRESHOLDS.fastDays) return 'fast';
  if (daysOfInventory <= TURNOVER_THRESHOLDS.normalDays) return 'normal';
  if (daysOfInventory <= TURNOVER_THRESHOLDS.slowDays) return 'slow';
  return 'slow';
}

export async function stockTurnover(
  db: Queryable,
  input: StockTurnoverInput = {},
): Promise<StockTurnoverReport> {
  const windowDays = input.windowDays ?? 90;
  const asOf = input.asOf ?? new Date();
  const from = new Date(asOf.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const activeOnly = input.activeOnly ?? true;

  const { rows } = await db.query<Row>(
    `
    WITH sales AS (
      SELECT oi.variant_id,
             SUM(oi.quantity)::bigint AS qty,
             SUM(oi.unit_cost_rial * oi.quantity) AS cogs
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
       WHERE o.status <> 'cancelled'
         AND COALESCE(o.paid_at, o.created_at) >= $1::timestamptz
         AND COALESCE(o.paid_at, o.created_at) <  $2::timestamptz
       GROUP BY oi.variant_id
    ),
    returned AS (
      SELECT ri.variant_id,
             SUM(ri.quantity)::bigint AS qty,
             SUM(COALESCE(oi.unit_cost_rial, 0) * ri.quantity) AS cogs
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        LEFT JOIN order_items oi
               ON oi.order_id = r.source_id AND oi.variant_id = ri.variant_id
       WHERE r.status IN ('approved', 'completed')
         AND COALESCE(r.decided_at, r.created_at) >= $1::timestamptz
         AND COALESCE(r.decided_at, r.created_at) <  $2::timestamptz
       GROUP BY ri.variant_id
    ),
    purchases AS (
      SELECT sm.variant_id,
             SUM(sm.quantity * sm.unit_cost_rial) AS received
        FROM stock_movements sm
       WHERE sm.reason = 'purchase'
         AND sm.created_at >= $1::timestamptz
         AND sm.created_at <  $2::timestamptz
         AND ($3::uuid IS NULL OR sm.warehouse_id = $3::uuid)
       GROUP BY sm.variant_id
    ),
    stock AS (
      SELECT iv.variant_id,
             SUM(iv.quantity)::bigint AS qty,
             SUM(iv.quantity * iv.avg_cost_rial) AS value
        FROM inventory_valuation iv
       WHERE ($3::uuid IS NULL OR iv.warehouse_id = $3::uuid)
       GROUP BY iv.variant_id
    )
    SELECT pv.id AS variant_id,
           pv.sku,
           p.title,
           (COALESCE(s.qty, 0) - COALESCE(rt.qty, 0))::text AS sold_qty,
           (COALESCE(s.cogs, 0) - COALESCE(rt.cogs, 0))::text AS cogs,
           COALESCE(st.qty, 0)::text AS closing_qty,
           COALESCE(st.value, 0)::text AS closing_value,
           COALESCE(pr.received, 0)::text AS purchases
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN sales s     ON s.variant_id  = pv.id
      LEFT JOIN returned rt ON rt.variant_id = pv.id
      LEFT JOIN purchases pr ON pr.variant_id = pv.id
      LEFT JOIN stock st    ON st.variant_id = pv.id
     WHERE ($4::boolean = false OR pv.is_active = true)
     ORDER BY (COALESCE(st.value, 0)) DESC, pv.sku
    `,
    [from.toISOString(), asOf.toISOString(), input.warehouseId ?? null, activeOnly],
  );

  const warnings: string[] = [];
  const resultRows: StockTurnoverRow[] = rows.map((r) => {
    const soldQuantity = Number(r.sold_qty);
    const cogs = toBig(r.cogs);
    const closingValue = toBig(r.closing_value);
    const purchases = toBig(r.purchases);

    // بازسازیِ موجودیِ آغازِ دوره (توضیح در بالایِ فایل)
    let openingValue = closingValue + cogs - purchases;
    if (openingValue < 0n) {
      openingValue = closingValue; // داده ناسازگار است؛ با احتیاط ادامه می‌دهیم
      warnings.push(
        `برای ${r.sku} موجودیِ آغازِ دوره منفی به دست آمد؛ عدد با فرضِ برابر بودنِ آغاز و پایان حساب شد.`,
      );
    }
    const averageInventory = (openingValue + closingValue) / 2n;

    const daysOfInventory =
      cogs > 0n && averageInventory > 0n
        ? Number(averageInventory * BigInt(windowDays)) / Number(cogs)
        : null;
    const turnoverPerYear =
      daysOfInventory !== null && daysOfInventory > 0
        ? 365 / daysOfInventory
        : cogs > 0n && averageInventory === 0n
          ? null
          : 0;

    return {
      variantId: r.variant_id,
      sku: r.sku,
      title: r.title,
      soldQuantity,
      cogsRial: cogs.toString(),
      closingQuantity: Number(r.closing_qty),
      closingValueRial: closingValue.toString(),
      openingValueRial: openingValue.toString(),
      averageInventoryRial: averageInventory.toString(),
      turnoverPerYear: turnoverPerYear === null ? null : round1(turnoverPerYear),
      daysOfInventory: daysOfInventory === null ? null : round1(daysOfInventory),
      status: classify(soldQuantity, daysOfInventory),
    };
  });

  const inventoryValue = resultRows.reduce((sum, r) => sum + toBig(r.closingValueRial), 0n);
  const totalCogs = resultRows.reduce((sum, r) => sum + toBig(r.cogsRial), 0n);
  const avgInventory = resultRows.reduce((sum, r) => sum + toBig(r.averageInventoryRial), 0n);
  const dead = resultRows.filter((r) => r.status === 'dead');
  const slow = resultRows.filter((r) => r.status === 'slow');

  const totals = {
    inventoryValueRial: inventoryValue.toString(),
    cogsRial: totalCogs.toString(),
    turnoverPerYear:
      avgInventory > 0n ? round1((Number(totalCogs) / Number(avgInventory)) * (365 / windowDays)) : null,
    daysOfInventory:
      totalCogs > 0n && avgInventory > 0n
        ? round1((Number(avgInventory) * windowDays) / Number(totalCogs))
        : null,
    deadStockValueRial: dead.reduce((sum, r) => sum + toBig(r.closingValueRial), 0n).toString(),
    deadStockCount: dead.length,
    slowStockValueRial: slow.reduce((sum, r) => sum + toBig(r.closingValueRial), 0n).toString(),
  };

  if (rows.length > 0 && totalCogs === 0n) {
    warnings.push('در این پنجره هیچ فروشی ثبت نشده است؛ گردشِ موجودی قابلِ محاسبه نیست.');
  }
  warnings.push(
    'میانگینِ موجودی از رویِ «آغاز و پایانِ دوره» برآورد شده است (عکسِ لحظه‌یِ روزانه در پایگاه نیست).',
  );

  return {
    windowDays,
    from,
    to: asOf,
    fromJalali: formatJalali(from),
    toJalali: formatJalali(asOf),
    rows: resultRows,
    totals,
    warnings,
  };
}
