/**
 * اظهارنامه‌یِ ارزش‌افزوده (فصلی).
 *
 * ماجرا از این قرار است: فروشنده ارزش‌افزوده را از مشتری می‌گیرد (مالیاتِ
 * برون‌داد) و هنگامِ خرید به تأمین‌کننده می‌پردازد (مالیاتِ درون‌داد). آنچه
 * به سازمان بدهکار است، تفاوتِ این دو است. اگر کسی فقط فروش را ببیند، فکر
 * می‌کند کلِ مالیاتِ گرفته‌شده بدهی است؛ و اگر فقط خرید را ببیند، خیال می‌کند
 * طلبکار است. گزارشِ درست، هر دو را در یک نگاه نشان می‌دهد و تفاوت را می‌گوید.
 *
 * دو نکته‌یِ عملی که اینجا رعایت شده:
 *   ۱) مالیاتِ فروش از **ردیف‌هایِ سفارش** جمع می‌شود، نه از ستونِ orders.tax_rial،
 *      چون نرخ ممکن است میانِ کالاها فرق کند و جمعِ ردیفی مبنایِ دارایی است.
 *      (ستونِ کلی برای نمایش است؛ ردیفی برای حساب.)
 *   ۲) بازه با تاریخِ **پرداخت** (paid_at) سنجیده می‌شود نه تاریخِ ایجاد،
 *      چون مالیات با پول‌گرفتن قطعی می‌شود، نه با سبدبستن. سفارشِ پرداخت‌نشده
 *      در دوره‌یِ بعد می‌آید.
 */

import type { Database } from '@set/db';
import { jalaliParts, AppError } from '@set/shared-kernel';

export interface VatPeriod {
  /** کلیدِ دوره، مانندِ «۱۴۰۵-۰۶» */
  key: string;
  fromIso: string;
  toIso: string;
}

export interface VatReturnLine {
  /** نرخِ مالیات به درصد (برای گروه‌بندیِ اظهارنامه) */
  ratePercent: string;
  /** جمعِ مبلغِ مشمول (پس از تخفیف) */
  taxableRial: string;
  /** جمعِ مالیات */
  vatRial: string;
  /** تعدادِ ردیف‌هایِ فروش */
  lines: number;
}

export interface VatWarning {
  kind: 'missing_sstid' | 'not_submitted' | 'buyer_id_missing';
  count: number;
  detail: string;
}

export interface VatReturn {
  period: VatPeriod;
  /** مالیاتِ برون‌داد: آنچه از مشتریان گرفته شده */
  output: {
    salesRial: string;
    vatRial: string;
    orderCount: number;
    byRate: VatReturnLine[];
    /** مرجوعیِ دوره: چقدر از فروشِ بالا برگشته است */
    returnedRial: string;
    /** ارزش‌افزوده‌یِ مرجوعیِ دوره */
    returnedVatRial: string;
  };
  /** مالیاتِ درون‌داد: آنچه به تأمین‌کنندگان پرداخت شده */
  input: {
    purchasesRial: string;
    vatRial: string;
    invoiceCount: number;
  };
  /** بدهیِ قابلِ پرداخت؛ منفی یعنی اعتبارِ قابلِ انتقال به دوره‌یِ بعد */
  netPayableRial: string;
  /** آیا بستانکاریم (اعتبار داریم) یا بدهکار */
  direction: 'payable' | 'credit';
  warnings: VatWarning[];
}

/** ساختِ کلیدِ دوره‌یِ شمسی از یک تاریخِ میلادی */
export function periodKeyOf(date: Date): string {
  const p = jalaliParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/** بازه‌یِ ماهِ جاریِ شمسی (برایِ حالتِ پیش‌فرضِ پنل) */
export function currentJalaliMonth(now = new Date()): VatPeriod {
  const p = jalaliParts(now);
  // مرزهایِ ماه: از نخستین روز تا آخرین روزِ همان ماهِ شمسی
  const from = new Date(now);
  // تبدیلِ ماهانه با همان کتابخانه‌یِ جلالیِ پروژه انجام می‌شود
  const fromDate = toJalaliStart(p.year, p.month);
  const toDate = toJalaliEnd(p.year, p.month);
  void from;
  return {
    key: `${p.year}-${String(p.month).padStart(2, '0')}`,
    fromIso: fromDate.toISOString(),
    toIso: toDate.toISOString(),
  };
}

function toJalaliStart(year: number, month: number): Date {
  // نخستین روزِ ماهِ شمسی در تقویمِ میلادی (با استفاده از توابعِ خودِ پروژه)
  return jalaliToGregorian(year, month, 1);
}

function toJalaliEnd(year: number, month: number): Date {
  const day = month <= 6 ? 31 : month <= 11 ? 30 : isLeapJalali(year) ? 30 : 29;
  const d = jalaliToGregorian(year, month, day);
  d.setHours(23, 59, 59, 999);
  return d;
}

function isLeapJalali(year: number): boolean {
  // دوره‌یِ ۳۳ساله‌یِ کبیسه‌هایِ شمسی (تقریبِ رایج در محاسباتِ مالی)
  const cycle = [1, 5, 9, 13, 17, 22, 26, 30];
  return cycle.includes(((year + 2346) % 33) + 1);
}

function jalaliToGregorian(year: number, month: number, day: number): Date {
  // الگوریتمِ استانداردِ تبدیلِ جلالی به میلادی (بر پایه‌یِ نسبتِ ۳۳ ساله)
  const gy = year + 621;
  // نخستین روزِ سالِ شمسی در میلادی
  const nowruz = new Date(Date.UTC(gy, 2, 21, 0, 0, 0));
  // جابه‌جاییِ سالِ کبیسه‌یِ میلادی
  const gLeap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const offset = gLeap ? 1 : 0;
  const daysBeforeMonth = month <= 7 ? (month - 1) * 31 : 186 + (month - 7) * 30;
  const total = daysBeforeMonth + day - 1;
  nowruz.setUTCDate(nowruz.getUTCDate() + offset + total);
  return nowruz;
}

/**
 * محاسبه‌یِ اظهارنامه در یک بازه.
 *
 * بازه با تاریخِ پرداختِ سفارش و تاریخِ صدورِ فاکتورِ خرید سنجیده می‌شود —
 * همان مبنایی که در ممیزی پذیرفته است.
 */
export async function vatReturn(
  db: Database,
  period: { fromIso: string; toIso: string; key: string },
): Promise<VatReturn> {
  // ── برون‌داد: فروش‌ها
  const sales = await db.query<{
    sales_rial: string;
    vat_rial: string;
    order_count: string;
    returned_rial: string;
    returned_vat_rial: string;
  }>(
    `WITH period_sales AS (
       SELECT COALESCE(SUM(oi.total_rial - oi.tax_rial), 0) AS sales_rial,
              COALESCE(SUM(oi.tax_rial), 0)                 AS vat_rial,
              COUNT(DISTINCT o.id)                          AS order_count
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
        WHERE o.status = 'paid'
          AND o.paid_at >= $1::timestamptz
          AND o.paid_at <= $2::timestamptz
     ),
     period_returns AS (
       SELECT COALESCE(SUM(cri.refund_rial - cri.refund_tax_rial), 0) AS sales_rial,
              COALESCE(SUM(cri.refund_tax_rial), 0)                   AS vat_rial
         FROM customer_returns cr
         JOIN customer_return_items cri ON cri.return_id = cr.id
        WHERE cr.status IN ('refunded', 'closed')
          AND cr.refunded_at >= $1::timestamptz
          AND cr.refunded_at <= $2::timestamptz
     )
     SELECT (period_sales.sales_rial - period_returns.sales_rial)::text AS sales_rial,
            (period_sales.vat_rial   - period_returns.vat_rial)::text   AS vat_rial,
            period_sales.order_count::text                              AS order_count,
            period_returns.sales_rial::text                             AS returned_rial,
            period_returns.vat_rial::text                               AS returned_vat_rial
       FROM period_sales, period_returns`,
    // مرجوعی در همین‌جا از فروشِ دوره کم می‌شود: مبنایِ محاسبه ردیف‌هایِ
    // سفارش است، و اگر مرجوعی کسر نشود اظهارنامه مالیاتِ فروشی را نشان
    // می‌دهد که انجام نشده است. مبنایِ زمانی «بازگشتِ وجه» است، چون تا پیش
    // از آن فروش پابرجا بوده است.
    [period.fromIso, period.toIso],
  );

  const byRate = await db.query<{
    rate: string;
    taxable_rial: string;
    vat_rial: string;
    lines: string;
  }>(
    `SELECT ROUND(100.0 * oi.tax_rial / NULLIF(oi.total_rial - oi.tax_rial, 0))::text AS rate,
            SUM(oi.total_rial - oi.tax_rial)::text AS taxable_rial,
            SUM(oi.tax_rial)::text                 AS vat_rial,
            COUNT(*)::text                          AS lines
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status = 'paid'
        AND o.paid_at >= $1::timestamptz
        AND o.paid_at <= $2::timestamptz
      GROUP BY 1
      ORDER BY 1`,
    [period.fromIso, period.toIso],
  );

  // مرجوعی به تفکیکِ نرخ — همان نسبتی که در فروش داشت، از فروش کم می‌شود
  const returnedByRate = await db.query<{ rate: string; taxable_rial: string; vat_rial: string }>(
    `SELECT ROUND(100.0 * oi.tax_rial / NULLIF(oi.total_rial - oi.tax_rial, 0))::text AS rate,
            SUM(cri.refund_rial - cri.refund_tax_rial)::text AS taxable_rial,
            SUM(cri.refund_tax_rial)::text                   AS vat_rial
       FROM customer_returns cr
       JOIN customer_return_items cri ON cri.return_id = cr.id
       JOIN orders o  ON o.id  = cr.order_id
       JOIN order_items oi ON oi.id = cri.order_item_id
      WHERE cr.status IN ('refunded', 'closed')
        AND cr.refunded_at >= $1::timestamptz
        AND cr.refunded_at <= $2::timestamptz
      GROUP BY 1`,
    [period.fromIso, period.toIso],
  );

  const rates = new Map(
    byRate.rows.map((r) => [
      r.rate,
      { rate: r.rate, taxableRial: BigInt(r.taxable_rial), vatRial: BigInt(r.vat_rial), lines: Number(r.lines) },
    ]),
  );
  for (const r of returnedByRate.rows) {
    const key = r.rate ?? '0';
    const current = rates.get(key);
    const taxable = BigInt(r.taxable_rial);
    const vat = BigInt(r.vat_rial);
    if (current) {
      current.taxableRial -= taxable;
      current.vatRial -= vat;
    } else if (taxable !== 0n || vat !== 0n) {
      // مرجوعی‌ای با نرخی که در فروشِ این دوره نمونه ندارد (سفارش مربوط به
      // دوره‌ی پیش بوده): ردیفِ منفی نشان داده می‌شود تا حساب جمع باشد.
      rates.set(key, { rate: key, taxableRial: -taxable, vatRial: -vat, lines: 0 });
    }
  }

  // ── درون‌داد: خریدها
  const purchases = await db.query<{
    purchases_rial: string;
    vat_rial: string;
    invoice_count: string;
  }>(
    `SELECT COALESCE(SUM(total_rial - vat_rial - extra_cost_rial), 0)::text AS purchases_rial,
            COALESCE(SUM(vat_rial), 0)::text                                AS vat_rial,
            COUNT(*)::text                                                   AS invoice_count
       FROM purchase_invoices
      WHERE status = 'posted'
        AND issued_at >= ($1::timestamptz)::date
        AND issued_at <= ($2::timestamptz)::date`,
    [period.fromIso, period.toIso],
  );

  const s = sales.rows[0] ?? {
    sales_rial: '0',
    vat_rial: '0',
    order_count: '0',
    returned_rial: '0',
    returned_vat_rial: '0',
  };
  const p = purchases.rows[0] ?? { purchases_rial: '0', vat_rial: '0', invoice_count: '0' };

  const outputVat = BigInt(s.vat_rial);
  const inputVat = BigInt(p.vat_rial);
  const net = outputVat - inputVat;

  // ── هشدارها: چیزهایی که اظهارنامه را در ممیزی به دردسر می‌اندازد
  const warnings: VatWarning[] = [];

  const notSubmitted = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM orders o
       LEFT JOIN tax_invoices t
              ON t.order_id = o.id AND t.status = 'accepted' AND t.invoice_kind = 'sale'
      WHERE o.status = 'paid'
        AND o.paid_at >= $1::timestamptz
        AND o.paid_at <= $2::timestamptz
        AND t.id IS NULL`,
    [period.fromIso, period.toIso],
  );
  const notSubmittedCount = Number(notSubmitted.rows[0]?.count ?? '0');
  if (notSubmittedCount > 0) {
    warnings.push({
      kind: 'not_submitted',
      count: notSubmittedCount,
      detail: `${notSubmittedCount} فروشِ پرداخت‌شده در این دوره هنوز صورتحسابِ تأییدشده ندارد.`,
    });
  }

  const missingSstid = await db.query<{ count: string; samples: string }>(
    `SELECT COUNT(DISTINCT p.id)::text AS count,
            COALESCE(STRING_AGG(DISTINCT p.title, '، '), '') AS samples
       FROM orders o
       JOIN order_items oi       ON oi.order_id = o.id
       JOIN product_variants v   ON v.id = oi.variant_id
       JOIN products p           ON p.id = v.product_id
      WHERE o.status = 'paid'
        AND o.paid_at >= $1::timestamptz
        AND o.paid_at <= $2::timestamptz
        AND (p.tax_sstid IS NULL OR p.tax_sstid = '')`,
    [period.fromIso, period.toIso],
  );
  const missingSstidCount = Number(missingSstid.rows[0]?.count ?? '0');
  if (missingSstidCount > 0) {
    warnings.push({
      kind: 'missing_sstid',
      count: missingSstidCount,
      detail: `${missingSstidCount} کالایِ فروخته‌شده در این دوره «شناسه‌یِ کالا/خدمت» ندارد: ${
        (missingSstid.rows[0]?.samples ?? '').split('، ').slice(0, 3).join('، ') || '—'
      }`,
    });
  }

  const noBuyerId = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.status = 'paid'
        AND o.paid_at >= $1::timestamptz
        AND o.paid_at <= $2::timestamptz
        AND (c.national_id IS NULL OR c.national_id = '')`,
    [period.fromIso, period.toIso],
  );
  const noBuyerIdCount = Number(noBuyerId.rows[0]?.count ?? '0');
  if (noBuyerIdCount > 0) {
    warnings.push({
      kind: 'buyer_id_missing',
      count: noBuyerIdCount,
      detail: `${noBuyerIdCount} فروش در این دوره بدونِ شناسه‌یِ ملیِ خریدار است (برایِ خریدارِ حقوقی الزامی است).`,
    });
  }

  const rateLines: VatReturnLine[] = [...rates.values()]
    .filter((r) => r.lines > 0 || r.taxableRial !== 0n || r.vatRial !== 0n)
    .sort((a, b) => Number(a.rate) - Number(b.rate))
    .map((r) => ({
      ratePercent: r.rate ?? '0',
      taxableRial: r.taxableRial.toString(),
      vatRial: r.vatRial.toString(),
      lines: r.lines,
    }));

  return {
    period: { key: period.key, fromIso: period.fromIso, toIso: period.toIso },
    output: {
      salesRial: s.sales_rial,
      vatRial: s.vat_rial,
      orderCount: Number(s.order_count),
      byRate: rateLines,
      returnedRial: s.returned_rial,
      returnedVatRial: s.returned_vat_rial,
    },
    input: {
      purchasesRial: p.purchases_rial,
      vatRial: p.vat_rial,
      invoiceCount: Number(p.invoice_count),
    },
    netPayableRial: (net < 0n ? -net : net).toString(),
    direction: net >= 0n ? 'payable' : 'credit',
    warnings,
  };
}

// ===========================================================================
// شناسه‌یِ کالا/خدمت
// ===========================================================================

export interface MissingSstidProduct {
  productId: string;
  title: string;
  sku: string | null;
}

/**
 * کالاهایی که بدونِ «شناسه‌یِ کالا/خدمت» مانده‌اند.
 *
 * این فهرست درِ خروجِ اظهارنامه است: تا این خالی نشود، هر صورتحسابی که از این
 * کالاها ساخته شود در همان بررسیِ محلی رد می‌شود. پس این گزارش تشریفاتی نیست،
 * بلکه فهرستِ کارِ امروزِ انباردار است.
 */
export async function productsMissingSstid(
  db: Database,
  limit = 50,
): Promise<MissingSstidProduct[]> {
  const { rows } = await db.query<MissingSstidProduct>(
    `SELECT p.id AS "productId", p.title, MIN(v.sku) AS sku
       FROM products p
       LEFT JOIN product_variants v ON v.product_id = p.id
      WHERE p.status = 'active'
        AND (p.tax_sstid IS NULL OR p.tax_sstid = '')
      GROUP BY p.id, p.title
      ORDER BY p.title
      LIMIT $1`,
    [limit],
  );
  return rows;
}

/** ثبتِ شناسه‌یِ کالا/خدمت از پنل (بدونِ نیاز به برنامه‌نویسی) */
export async function setProductSstid(
  db: Database,
  input: { productId: string; sstid: string; unit?: string | null },
): Promise<{ productId: string; sstid: string; unit: string | null }> {
  const sstid = (input.sstid ?? '').trim();
  // شناسه‌یِ کالا/خدمت فقط رقم است (در استانداردِ جدید تا ۱۹ رقم معتبر است)
  if (!/^\d{8,19}$/.test(sstid)) {
    throw new AppError('VALIDATION', {
      message: 'شناسه‌یِ کالا/خدمت باید بینِ ۸ تا ۱۹ رقم باشد (بدونِ خط‌تیره و فاصله).',
    });
  }
  if (input.unit !== undefined && input.unit !== null && input.unit.trim().length > 20) {
    throw new AppError('VALIDATION', { message: 'واحدِ اندازه‌گیری نمی‌تواند بلندتر از ۲۰ نویسه باشد.' });
  }

  const { rows } = await db.query<{ id: string; tax_sstid: string; tax_unit: string | null }>(
    `UPDATE products
        SET tax_sstid = $2,
            tax_unit  = COALESCE($3, tax_unit),
            updated_at = now()
      WHERE id = $1
      RETURNING id, tax_sstid, tax_unit`,
    [input.productId, sstid, input.unit?.trim() || null],
  );
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', { message: 'کالایی با این شناسه نیست.' });
  return { productId: row.id, sstid: row.tax_sstid, unit: row.tax_unit };
}
