import type { Queryable } from '@set/db';
import { divRoundHalfUp, formatJalali } from '@set/shared-kernel';

/**
 * سودِ ناخالص — پاسخ به این پرسش: «از هر کالا (یا برند یا روز) چقدر سود
 * بردیم؟»
 *
 * سه تصمیمِ حسابداری در دلِ این گزارش است و باید روشن باشد، چون عددِ سود
 * بی‌این سه، گمراه‌کننده است:
 *
 *   ۱) درآمد، «خالصِ پس از تخفیف و بدونِ ارزش افزوده» است. ارزش افزوده پولِ
 *      دولت است، نه درآمدِ فروشگاه؛ اگر در محاسبه می‌ماند، حاشیه‌یِ سود به
 *      دروغ بالا نشان داده می‌شد (۹٪ روی هر فاکتور).
 *   ۲) بهایِ تمام‌شده از «عکسِ لحظه‌یِ فروش» می‌آید (ستونِ unit_cost_rial که
 *      در مهاجرتِ ۰۲۰ افزوده شد)، نه از میانگینِ امروز. میانگینِ موزون با هر
 *      خریدِ تازه عوض می‌شود؛ اگر سودِ فروردین را با بهایِ خریدِ تیر حساب
 *      کنیم، عددِ فروردین غلط است.
 *   ۳) مرجوعی‌ها کم می‌شوند: هم از درآمد، هم از بهایِ کالا. مرجوعی اگر از
 *      درآمد کم شود ولی از بها نه، سود به دروغ کم نشان داده می‌شود.
 *
 * و یک کنترلِ درونی در انتهایِ گزارش: «دفترکل با ردیف‌هایِ فروش هم‌خوان
 * است؟». انبار و دفترکل در یک تراکنش ثبت می‌شوند، پس این دو باید یکی باشند؛
 * اگر نباشند، یعنی سندی دستی یا فروشی بی‌سند در میان است و باید دیده شود،
 * نه اینکه پنهان بماند.
 */

export type GrossProfitGrouping = 'variant' | 'brand' | 'product_type' | 'day';

export const GROSS_PROFIT_GROUPINGS: Array<{ key: GrossProfitGrouping; label: string }> = [
  { key: 'variant', label: 'کالا' },
  { key: 'brand', label: 'برند' },
  { key: 'product_type', label: 'نوعِ کالا' },
  { key: 'day', label: 'روز' },
];

export interface GrossProfitInput {
  /** ابتدایِ دوره (شمالی/میلادی فرقی ندارد؛ شیءِ Date است) */
  from: Date;
  /** انتهایِ دوره (ناشمول: خودِ این لحظه در دوره نیست) */
  to: Date;
  groupBy?: GrossProfitGrouping;
  /** محدود به یک شعبه؛ ناتهی یعنی همه‌ی شعبه‌ها */
  branchId?: string | null;
  /** فقط فروشِ اینترنتی یا فقط حضوری */
  channel?: 'web' | 'pos' | null;
}

export interface GrossProfitRow {
  key: string;
  label: string;
  quantity: number;
  revenueRial: string;
  cogsRial: string;
  grossProfitRial: string;
  /** حاشیه‌یِ سود به درصد (مثلاً ۲۳٫۴) */
  marginPercent: number;
}

export interface GrossProfitTotals {
  quantity: number;
  revenueRial: string;
  cogsRial: string;
  grossProfitRial: string;
  marginPercent: number;
  /** درآمدِ ارسال: درآمد است اما سودِ ناخالصِ «کالا» نیست، جدا نشان داده می‌شود */
  shippingRial: string;
  /** تعدادِ واحدهایی که بهایِ تمام‌شده ندارند (فروش‌هایِ پیش از مهاجرتِ ۰۲۰) */
  uncostedQuantity: number;
}

export interface GrossProfitLedgerCheck {
  /** درآمدِ ثبت‌شده در حسابِ ۴۰۰۰ در همین دوره */
  revenueRial: string;
  /** تخفیفات (۴۱۰۰) */
  discountRial: string;
  /** بهایِ کالای فروخته‌شده در حسابِ ۵۰۰۰ */
  cogsRial: string;
  /** ارسالِ همین دوره (در دفترکل درونِ ۴۰۰۰ است، اینجا جدا می‌شود تا هم‌سنجی درست باشد) */
  shippingRial: string;
  /** آیا دفترکل با جمعِ ردیف‌هایِ فروش یکی است؟ */
  matches: boolean;
  /** اختلاف (اگر صفر نباشد، در پنل هشدار نشان داده می‌شود) */
  differenceRial: string;
}

export interface GrossProfitReport {
  from: Date;
  to: Date;
  fromJalali: string;
  toJalali: string;
  groupBy: GrossProfitGrouping;
  rows: GrossProfitRow[];
  totals: GrossProfitTotals;
  ledger: GrossProfitLedgerCheck;
  warnings: string[];
}

/** رشته‌یِ عددیِ پایگاه (numeric/int8 را pg رشته می‌دهد) → bigintِ ایمن */
function toBig(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'number') return BigInt(Math.round(value));
  const cleaned = value.includes('.') ? value.slice(0, value.indexOf('.')) : value;
  return cleaned === '' ? 0n : BigInt(cleaned);
}

function marginPercent(profit: bigint, revenue: bigint): number {
  if (revenue <= 0n) return 0;
  return Number(divRoundHalfUp(profit * 10_000n, revenue)) / 100;
}

interface Row {
  key: string;
  label: string;
  quantity: string;
  revenue_rial: string;
  cogs_rial: string;
  uncosted_quantity: string;
}

export async function grossProfit(
  db: Queryable,
  input: GrossProfitInput,
): Promise<GrossProfitReport> {
  const groupBy = input.groupBy ?? 'variant';
  const params: unknown[] = [
    input.from.toISOString(),
    input.to.toISOString(),
    input.branchId ?? null,
    groupBy,
    input.channel ?? null,
  ];

  const { rows } = await db.query<Row>(
    `
    WITH sales AS (
      SELECT oi.variant_id,
             to_char(date_trunc('day', COALESCE(o.paid_at, o.created_at) AT TIME ZONE 'Asia/Tehran'),
                     'YYYY-MM-DD') AS day_bucket,
             oi.quantity::bigint AS qty,
             (oi.unit_price_rial * oi.quantity - oi.discount_rial) AS revenue,
             (oi.unit_cost_rial * oi.quantity) AS cogs,
             CASE WHEN oi.unit_cost_rial = 0 THEN oi.quantity ELSE 0 END::bigint AS uncosted_qty
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
       WHERE o.status <> 'cancelled'
         AND COALESCE(o.paid_at, o.created_at) >= $1::timestamptz
         AND COALESCE(o.paid_at, o.created_at) <  $2::timestamptz
         AND ($3::uuid IS NULL OR o.branch_id = $3::uuid)
         AND ($5::text  IS NULL OR o.channel = $5::text)
    ),
    returned AS (
      SELECT ri.variant_id,
             to_char(date_trunc('day', COALESCE(r.decided_at, r.created_at) AT TIME ZONE 'Asia/Tehran'),
                     'YYYY-MM-DD') AS day_bucket,
             -ri.quantity::bigint AS qty,
             -(ri.unit_price_rial * ri.quantity) AS revenue,
             -(COALESCE(oi.unit_cost_rial, 0) * ri.quantity) AS cogs,
             0::bigint AS uncosted_qty
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        LEFT JOIN order_items oi
               ON oi.order_id = r.source_id AND oi.variant_id = ri.variant_id
       WHERE r.status IN ('approved', 'completed')
         AND COALESCE(r.decided_at, r.created_at) >= $1::timestamptz
         AND COALESCE(r.decided_at, r.created_at) <  $2::timestamptz
         AND ($3::uuid IS NULL OR EXISTS (
               SELECT 1 FROM orders o2 WHERE o2.id = r.source_id
                 AND ($3::uuid IS NULL OR o2.branch_id = $3::uuid)))
    ),
    lines AS (
      SELECT * FROM sales
      UNION ALL
      SELECT * FROM returned
    )
    SELECT
      CASE $4
        WHEN 'variant'       THEN pv.id::text
        WHEN 'brand'         THEN COALESCE(b.id::text, 'unknown')
        WHEN 'product_type'  THEN COALESCE(pt.id::text, 'unknown')
        ELSE lines.day_bucket
      END AS key,
      CASE $4
        WHEN 'variant'       THEN p.title || ' — ' || pv.sku
        WHEN 'brand'         THEN COALESCE(b.name, 'بدون برند')
        WHEN 'product_type'  THEN COALESCE(pt.name, 'بدون نوع')
        ELSE lines.day_bucket
      END AS label,
      SUM(lines.qty)::text            AS quantity,
      SUM(lines.revenue)::text        AS revenue_rial,
      SUM(lines.cogs)::text           AS cogs_rial,
      SUM(lines.uncosted_qty)::text   AS uncosted_quantity
      FROM lines
      JOIN product_variants pv ON pv.id = lines.variant_id
      JOIN products p          ON p.id = pv.product_id
      LEFT JOIN brands b       ON b.id = p.brand_id
      LEFT JOIN product_types pt ON pt.id = p.type_id
     GROUP BY 1, 2
     ORDER BY 1
    `,
    params,
  );

  const resultRows: GrossProfitRow[] = rows.map((r) => {
    const revenue = toBig(r.revenue_rial);
    const cogs = toBig(r.cogs_rial);
    const profit = revenue - cogs;
    return {
      key: r.key,
      label: groupBy === 'day' ? formatJalali(new Date(`${r.key}T12:00:00+03:30`)) : r.label,
      quantity: Number(r.quantity),
      revenueRial: revenue.toString(),
      cogsRial: cogs.toString(),
      grossProfitRial: profit.toString(),
      marginPercent: marginPercent(profit, revenue),
    };
  });

  // روزها باید به ترتیبِ زمان باشند؛ بقیه پرسودترین اول
  resultRows.sort((a, b) =>
    groupBy === 'day'
      ? a.key.localeCompare(b.key)
      : toBig(b.grossProfitRial) > toBig(a.grossProfitRial)
        ? 1
        : toBig(b.grossProfitRial) < toBig(a.grossProfitRial)
          ? -1
          : 0,
  );

  const totals = resultRows.reduce(
    (acc, r) => ({
      quantity: acc.quantity + r.quantity,
      revenue: acc.revenue + toBig(r.revenueRial),
      cogs: acc.cogs + toBig(r.cogsRial),
      uncosted: acc.uncosted + 0,
    }),
    { quantity: 0, revenue: 0n, cogs: 0n, uncosted: 0 },
  );

  const uncostedQuantity = rows.reduce((sum, r) => sum + Number(r.uncosted_quantity), 0);

  const { rows: shipRows } = await db.query<{ shipping: string }>(
    `SELECT COALESCE(SUM(shipping_rial), 0)::text AS shipping
       FROM orders
      WHERE status <> 'cancelled'
        AND COALESCE(paid_at, created_at) >= $1::timestamptz
        AND COALESCE(paid_at, created_at) <  $2::timestamptz
        AND ($3::uuid IS NULL OR branch_id = $3::uuid)
        AND ($4::text IS NULL OR channel = $4::text)`,
    [params[0], params[1], params[2], params[4]],
  );
  const shippingRial = toBig(shipRows[0]?.shipping);

  const { rows: ledgerRows } = await db.query<{
    revenue: string;
    discounts: string;
    cogs: string;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN a.code = '4000' THEN jl.credit_rial - jl.debit_rial ELSE 0 END), 0)::text AS revenue,
       COALESCE(SUM(CASE WHEN a.code = '4100' THEN jl.debit_rial  - jl.credit_rial ELSE 0 END), 0)::text AS discounts,
       COALESCE(SUM(CASE WHEN a.code = '5000' THEN jl.debit_rial  - jl.credit_rial ELSE 0 END), 0)::text AS cogs
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a         ON a.id = jl.account_id
      WHERE je.posted_at >= $1::timestamptz AND je.posted_at < $2::timestamptz`,
    [params[0], params[1]],
  );

  const ledgerRevenue = toBig(ledgerRows[0]?.revenue) - toBig(ledgerRows[0]?.discounts) - shippingRial;
  const ledgerCogs = toBig(ledgerRows[0]?.cogs);
  const difference = ledgerRevenue - totals.revenue + (ledgerCogs - totals.cogs);

  const warnings: string[] = [];
  if (uncostedQuantity > 0) {
    warnings.push(
      `بهایِ تمام‌شده برای ${uncostedQuantity} واحد ثبت نشده است (فروش‌هایِ پیش از مهاجرتِ ۰۲۰). سودِ واقعی از این عدد بیشتر است.`,
    );
  }
  if (difference !== 0n) {
    warnings.push(
      `جمعِ دفترکل با جمعِ ردیف‌هایِ فروش برابر نیست (${difference.toString()} ریال اختلاف). احتمالاً سندِ دستی یا فروشِ بی‌سند در این دوره هست.`,
    );
  }

  return {
    from: input.from,
    to: input.to,
    fromJalali: formatJalali(input.from),
    toJalali: formatJalali(input.to),
    groupBy,
    rows: resultRows,
    totals: {
      quantity: totals.quantity,
      revenueRial: totals.revenue.toString(),
      cogsRial: totals.cogs.toString(),
      grossProfitRial: (totals.revenue - totals.cogs).toString(),
      marginPercent: marginPercent(totals.revenue - totals.cogs, totals.revenue),
      shippingRial: shippingRial.toString(),
      uncostedQuantity,
    },
    ledger: {
      revenueRial: ledgerRevenue.toString(),
      discountRial: toBig(ledgerRows[0]?.discounts).toString(),
      cogsRial: ledgerCogs.toString(),
      shippingRial: shippingRial.toString(),
      matches: difference === 0n,
      differenceRial: difference.toString(),
    },
    warnings,
  };
}
