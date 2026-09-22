import type { Queryable } from '@set/db';
import { formatJalali } from '@set/shared-kernel';

/**
 * سنِ بدهی — پاسخ به پرسشِ «چه کسی، چقدر، چقدر دیر به ما بدهکار است؟»
 *
 * در بازارِ ایران بدهیِ مشتری دو شکل دارد و هر دو اینجا حساب می‌شوند
 * (یکی را دیدن و دیگری را ندیدن یعنی نیمی از طلب را ندیدن):
 *
 *   ۱) چک: مبلغ معلوم، سررسید معلوم. تا زمانی که پاس نشده
 *      (در جریان/نزدِ بانک) یا برگشت خورده، طلبِ ما باقی است. چکِ برگشتی
 *      بدترین حالت است: هم طلب پابرجاست و هم مشتری در خطرِ بدحسابی است.
 *   ۲) نسیه: سررسید در پایگاه نیست؛ پس مهلت را گزارش می‌گیرد
 *      (creditTermDays، پیش‌فرض ۳۰ روز) و از تاریخِ سفارش می‌شمارد.
 *
 * سطل‌ها (بر پایه‌یِ روزِ تأخیر از سررسید):
 *   سررسید‌نرسیده | ۱–۳۰ | ۳۱–۶۰ | ۶۱–۹۰ | بالای ۹۰
 * این سطل‌ها با رویه‌یِ پیگیریِ مطالباتِ شرکت‌ها هم‌خوان است: تا ۳۰ روز
 * طبیعی، ۳۱ تا ۶۰ یادآوری، ۶۱ تا ۹۰ پیگیریِ جدی، بالای ۹۰ حقوقی.
 *
 * و در انتها آینه‌یِ بدهی: «ما به تأمین‌کنندگان چقدر بدهکاریم و کدامش از
 * سررسید گذشته؟» چون تصمیمِ وصولِ طلب بدونِ دیدنِ بدهیِ خودمان، تصمیمِ
 * ناقصی است.
 */

export interface DebtorsInput {
  /** تاریخِ مبنا برای شمارشِ تأخیر (پیش‌فرض: اکنون) */
  asOf?: Date;
  /** مهلتِ نسیه (روز) وقتی سررسیدی ثبت نشده باشد */
  creditTermDays?: number;
  branchId?: string | null;
}

export interface DebtorRow {
  /** شناسه‌یِ مشتری؛ ناتهی یعنی خریدِ مهمان (بی‌حسابِ کاربری) */
  customerId: string | null;
  name: string;
  mobile: string | null;
  totalRial: string;
  notDueRial: string;
  bucket1Rial: string;
  bucket2Rial: string;
  bucket3Rial: string;
  bucket4Rial: string;
  /** تاریخِ کهن‌ترین سررسیدِ باز (جلالی) */
  oldestDueJalali: string | null;
  documents: number;
  bouncedChecks: number;
  /** none = سالم | watch = نیاز به پیگیری | high = خطرِ بدحسابی */
  risk: 'none' | 'watch' | 'high';
}

export interface PayableRow {
  invoiceNo: string;
  supplierName: string;
  totalRial: string;
  payableRial: string;
  dueJalali: string;
  daysPastDue: number;
  bucket: 'not_due' | 'b1' | 'b2' | 'b3' | 'b4';
}

export interface DebtorsReport {
  asOf: Date;
  asOfJalali: string;
  creditTermDays: number;
  rows: DebtorRow[];
  totals: {
    receivableRial: string;
    notDueRial: string;
    bucket1Rial: string;
    bucket2Rial: string;
    bucket3Rial: string;
    bucket4Rial: string;
    bouncedRial: string;
    highRiskCount: number;
    debtorsCount: number;
  };
  payables: {
    rows: PayableRow[];
    totalPayableRial: string;
    overduePayableRial: string;
  };
  warnings: string[];
}

function toBig(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'number') return BigInt(Math.round(value));
  const cleaned = value.includes('.') ? value.slice(0, value.indexOf('.')) : value;
  return cleaned === '' ? 0n : BigInt(cleaned);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

function bucketOf(daysPastDue: number): 'not_due' | 'b1' | 'b2' | 'b3' | 'b4' {
  if (daysPastDue <= 0) return 'not_due';
  if (daysPastDue <= 30) return 'b1';
  if (daysPastDue <= 60) return 'b2';
  if (daysPastDue <= 90) return 'b3';
  return 'b4';
}

interface CheckRow {
  customer_id: string | null;
  customer_name: string | null;
  customer_mobile: string | null;
  amount_rial: string;
  due_date: string;
  status: string;
}

interface CreditRow {
  customer_id: string | null;
  customer_name: string | null;
  customer_mobile: string | null;
  amount_rial: string;
  occurred_at: string;
}

export async function debtors(db: Queryable, input: DebtorsInput = {}): Promise<DebtorsReport> {
  const asOf = input.asOf ?? new Date();
  const creditTermDays = input.creditTermDays ?? 30;

  // ۱) چک‌هایی که از مشتری گرفته‌ایم و هنوز پاس نشده (یا برگشت خورده)
  const { rows: checks } = await db.query<CheckRow>(
    `SELECT o.customer_id,
            o.customer_name,
            o.customer_mobile,
            c.amount_rial::text,
            c.due_date::text,
            c.status
       FROM checks c
       JOIN order_payment_lines pl ON pl.check_id = c.id
       JOIN orders o ON o.id = pl.order_id
      WHERE c.status IN ('in_circulation', 'deposited', 'bounced')
        AND ($1::uuid IS NULL OR o.branch_id = $1::uuid)`,
    [input.branchId ?? null],
  );

  // ۲) فروشِ نسیه (بدونِ چک): سررسید ندارد، مهلت را از ورودی می‌گیریم
  const { rows: credits } = await db.query<CreditRow>(
    `SELECT o.customer_id,
            o.customer_name,
            o.customer_mobile,
            pl.amount_rial::text,
            COALESCE(o.paid_at, o.created_at)::text AS occurred_at
       FROM order_payment_lines pl
       JOIN orders o ON o.id = pl.order_id
      WHERE pl.method = 'credit'
        AND ($1::uuid IS NULL OR o.branch_id = $1::uuid)`,
    [input.branchId ?? null],
  );

  interface Debtor {
    customerId: string | null;
    name: string;
    mobile: string | null;
    amounts: { notDue: bigint; b1: bigint; b2: bigint; b3: bigint; b4: bigint };
    oldestDue: Date | null;
    documents: number;
    bouncedChecks: number;
  }

  const byKey = new Map<string, Debtor>();
  const empty = () => ({ notDue: 0n, b1: 0n, b2: 0n, b3: 0n, b4: 0n });

  function debtorFor(row: {
    customer_id: string | null;
    customer_name: string | null;
    customer_mobile: string | null;
  }): Debtor {
    const key = row.customer_id ?? `guest:${row.customer_mobile ?? 'بی‌نام'}`;
    const existing = byKey.get(key);
    if (existing) return existing;
    const created: Debtor = {
      customerId: row.customer_id,
      name: row.customer_name?.trim() || 'مشتریِ بی‌نام',
      mobile: row.customer_mobile,
      amounts: empty(),
      oldestDue: null,
      documents: 0,
      bouncedChecks: 0,
    };
    byKey.set(key, created);
    return created;
  }

  for (const row of checks) {
    const debtor = debtorFor(row);
    const amount = toBig(row.amount_rial);
    const due = new Date(`${row.due_date}T12:00:00+03:30`);
    const bucket = bucketOf(daysBetween(due, asOf));
    debtor.amounts[
      bucket === 'not_due' ? 'notDue' : bucket === 'b1' ? 'b1' : bucket === 'b2' ? 'b2' : bucket === 'b3' ? 'b3' : 'b4'
    ] += amount;
    if (row.status === 'bounced') debtor.bouncedChecks += 1;
    if (debtor.oldestDue === null || due < debtor.oldestDue) debtor.oldestDue = due;
    debtor.documents += 1;
  }

  for (const row of credits) {
    const debtor = debtorFor(row);
    const amount = toBig(row.amount_rial);
    const occurred = new Date(row.occurred_at);
    const due = new Date(occurred.getTime() + creditTermDays * DAY_MS);
    const bucket = bucketOf(daysBetween(due, asOf));
    debtor.amounts[
      bucket === 'not_due' ? 'notDue' : bucket === 'b1' ? 'b1' : bucket === 'b2' ? 'b2' : bucket === 'b3' ? 'b3' : 'b4'
    ] += amount;
    if (debtor.oldestDue === null || due < debtor.oldestDue) debtor.oldestDue = due;
    debtor.documents += 1;
  }

  const rows: DebtorRow[] = [...byKey.values()]
    .map((d) => {
      const total = d.amounts.notDue + d.amounts.b1 + d.amounts.b2 + d.amounts.b3 + d.amounts.b4;
      const risk: DebtorRow['risk'] =
        d.amounts.b4 > 0n || d.bouncedChecks > 0 ? 'high' : d.amounts.b3 > 0n ? 'watch' : 'none';
      return {
        customerId: d.customerId,
        name: d.name,
        mobile: d.mobile,
        totalRial: total.toString(),
        notDueRial: d.amounts.notDue.toString(),
        bucket1Rial: d.amounts.b1.toString(),
        bucket2Rial: d.amounts.b2.toString(),
        bucket3Rial: d.amounts.b3.toString(),
        bucket4Rial: d.amounts.b4.toString(),
        oldestDueJalali: d.oldestDue ? formatJalali(d.oldestDue) : null,
        documents: d.documents,
        bouncedChecks: d.bouncedChecks,
        risk,
      };
    })
    .filter((r) => toBig(r.totalRial) > 0n)
    // بدحساب‌ترین‌ها اول: آن‌ها که بالای ۹۰ روز دارند
    .sort((a, b) => {
      const aBig = toBig(a.bucket4Rial) + toBig(a.bucket3Rial);
      const bBig = toBig(b.bucket4Rial) + toBig(b.bucket3Rial);
      if (aBig !== bBig) return aBig > bBig ? -1 : 1;
      return toBig(b.totalRial) > toBig(a.totalRial) ? 1 : -1;
    });

  const sum = (pick: (r: DebtorRow) => bigint) => rows.reduce((acc, r) => acc + pick(r), 0n);
  const bouncedRial = [...byKey.values()]
    .filter((d) => d.bouncedChecks > 0)
    .reduce((acc, d) => acc + d.amounts.notDue + d.amounts.b1 + d.amounts.b2 + d.amounts.b3 + d.amounts.b4, 0n);

  // ۳) آینه: بدهیِ خودمان به تأمین‌کنندگان
  const { rows: invoices } = await db.query<{
    invoice_no: string;
    supplier_name: string;
    total_rial: string;
    payable_rial: string;
    due_at: string | null;
    issued_at: string | null;
    created_at: string;
  }>(
    `SELECT invoice_no, supplier_name, total_rial::text, payable_rial::text,
            due_at::text, issued_at::text, created_at::text
       FROM purchase_invoices
      WHERE payable_rial > 0 AND status <> 'cancelled'
      ORDER BY COALESCE(due_at, issued_at, created_at::date)`,
  );

  const payables: PayableRow[] = invoices.map((inv) => {
    const due = new Date(`${(inv.due_at ?? inv.issued_at ?? inv.created_at.slice(0, 10))}T12:00:00+03:30`);
    const days = daysBetween(due, asOf);
    return {
      invoiceNo: inv.invoice_no,
      supplierName: inv.supplier_name,
      totalRial: toBig(inv.total_rial).toString(),
      payableRial: toBig(inv.payable_rial).toString(),
      dueJalali: formatJalali(due),
      daysPastDue: days,
      bucket: bucketOf(days),
    };
  });

  const warnings: string[] = [];
  if (credits.length > 0) {
    warnings.push(
      `${credits.length} ردیفِ فروشِ نسیه بی‌سررسید است؛ مهلتِ ${creditTermDays} روزه برای شمارشِ تأخیر فرض شده است.`,
    );
  }
  warnings.push(
    'مبالغِ فاکتورهایِ خرید تا زمانی که پرداختی ثبت نشود، «باز» مانده است؛ پس سنِ بدهیِ تأمین‌کنندگان بر پایه‌یِ سررسیدِ فاکتور است.',
  );

  return {
    asOf,
    asOfJalali: formatJalali(asOf),
    creditTermDays,
    rows,
    totals: {
      receivableRial: sum((r) => toBig(r.totalRial)).toString(),
      notDueRial: sum((r) => toBig(r.notDueRial)).toString(),
      bucket1Rial: sum((r) => toBig(r.bucket1Rial)).toString(),
      bucket2Rial: sum((r) => toBig(r.bucket2Rial)).toString(),
      bucket3Rial: sum((r) => toBig(r.bucket3Rial)).toString(),
      bucket4Rial: sum((r) => toBig(r.bucket4Rial)).toString(),
      bouncedRial: bouncedRial.toString(),
      highRiskCount: rows.filter((r) => r.risk === 'high').length,
      debtorsCount: rows.length,
    },
    payables: {
      rows: payables,
      totalPayableRial: payables.reduce((acc, p) => acc + toBig(p.payableRial), 0n).toString(),
      overduePayableRial: payables
        .filter((p) => p.daysPastDue > 0)
        .reduce((acc, p) => acc + toBig(p.payableRial), 0n)
        .toString(),
    },
    warnings,
  };
}
