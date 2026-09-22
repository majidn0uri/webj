import { AppError, type Rial } from '@set/shared-kernel';
import type { Database } from '@set/db';
import { AccountingService } from '@set/accounting';
import { changeCheckStatus } from '@set/commerce';

/**
 * تسویه‌یِ فاکتورِ خرید — بستنِ چرخه‌یِ «خرید تا پرداخت».
 *
 * تا پیش از این، فاکتورِ خرید بدهی می‌ساخت (بستانکارِ حسابِ ۲۰۰۰) اما راهی
 * برای پرداختش نبود؛ برای همین هر فاکتور تا ابد «باز» می‌ماند و گزارشِ سنِ
 * بدهی به تأمین‌کنندگان، عددی غلط نشان می‌داد. اینجا پرداخت ثبت می‌شود،
 * مانده کم می‌گردد، و سندِ حسابداری‌اش در همان تراکنش صادر می‌شود — اگر سند
 * شکست بخورد، پرداخت هم ثبت نمی‌شود و برعکس.
 *
 * یک نکته‌یِ حسابداریِ ایران که اینجا رعایت شده: پرداخت با **چک** با پرداختِ
 * نقدی فرق دارد. وقتی چک می‌دهیم هنوز پول از حساب نرفته است؛ بدهی فقط از جیبی
 * به جیبِ دیگر می‌رود: از «حساب‌های پرداختنی» (۲۰۰۰) به «اسنادِ پرداختنی»
 * (۲۰۵۰). روزی که چک پاس شود، آن وقت از حسابِ بانک (۱۲۰۰) خارج می‌گردد
 * (`clearSupplierCheck`). اگر این دو را یکی می‌گرفتیم، ترازِ بدهیِ شرکت در
 * فاصله‌یِ دادنِ چک تا وصولش دروغ می‌گفت.
 */

export type PaymentMethod = 'cash' | 'bank' | 'card' | 'check';

/** حسابی که در برابرِ کاهشِ بدهی، بستانکار می‌شود (آن‌سویِ سند) */
const CREDIT_ACCOUNT: Record<PaymentMethod, string> = {
  cash: '1100', // صندوق و نقد
  bank: '1200', // بانک
  card: '1200', // کارت‌خوان: وجه به همان حسابِ بانکی می‌رود
  check: '2050', // اسنادِ پرداختنی — تا روزِ وصول، بدهی از این حساب است
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'نقد',
  bank: 'حواله‌یِ بانکی',
  card: 'کارت‌خوان/پوز',
  check: 'چک',
};

export interface PayInvoiceInput {
  invoiceId: string;
  amountRial: Rial;
  method: PaymentMethod;
  /** زمانِ پرداخت (پیش‌فرض: اکنون) */
  paidAt?: Date;
  /** شماره‌یِ پیگیری/حواله یا شماره‌یِ چک */
  referenceNo?: string | null;
  /** برای پرداختِ چکی: شناسه‌یِ چکِ ثبت‌شده */
  checkId?: string | null;
  note?: string | null;
  actorUserId?: string | null;
}

export interface PaymentResult {
  paymentId: string;
  invoiceNo: string;
  supplierName: string;
  amountRial: string;
  /** مانده‌یِ فاکتور پس از این پرداخت */
  remainingRial: string;
  entryNo: string;
  settled: boolean;
}

interface InvoiceRow {
  id: string;
  invoice_no: string;
  supplier_name: string;
  payable_rial: string;
  total_rial: string;
}

export async function paySupplierInvoice(
  db: Database,
  input: PayInvoiceInput,
): Promise<PaymentResult> {
  if (input.amountRial <= 0n) {
    throw new AppError('VALIDATION', { message: 'مبلغِ پرداخت باید بیش از صفر باشد' });
  }
  if (input.method === 'check' && !input.checkId) {
    throw new AppError('VALIDATION', {
      message: 'برای پرداختِ چکی باید چک را پیش‌تر ثبت کرده باشید',
    });
  }

  const accounting = new AccountingService(db);

  return db.transaction(async (tx) => {
    // قفلِ ردیف: دو پرداختِ هم‌زمان نباید هر دو مانده‌یِ یکسان را بخوانند
    const { rows } = await tx.query<InvoiceRow>(
      `SELECT id, invoice_no, supplier_name, payable_rial::text, total_rial::text
         FROM purchase_invoices WHERE id = $1 FOR UPDATE`,
      [input.invoiceId],
    );
    const invoice = rows[0];
    if (!invoice) throw new AppError('NOT_FOUND', { message: 'فاکتورِ خرید یافت نشد' });

    const payable = BigInt(invoice.payable_rial);
    if (payable <= 0n) {
      throw new AppError('CONFLICT', {
        message: `فاکتورِ ${invoice.invoice_no} پیش‌تر تسویه شده است.`,
      });
    }
    if (input.amountRial > payable) {
      throw new AppError('VALIDATION', {
        message: `مبلغِ پرداخت از مانده‌یِ فاکتور بیشتر است. مانده: ${(
          payable / 10n
        ).toLocaleString('fa-IR')} تومان`,
      });
    }

    const paidAt = input.paidAt ?? new Date();
    const { rows: payRows } = await tx.query<{ id: string }>(
      `INSERT INTO supplier_payments
         (invoice_id, amount_rial, method, paid_at, reference_no, check_id, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        input.invoiceId,
        input.amountRial.toString(),
        input.method,
        paidAt.toISOString(),
        input.referenceNo ?? null,
        input.checkId ?? null,
        input.note ?? null,
        input.actorUserId ?? null,
      ],
    );
    const paymentId = payRows[0]!.id;

    // سند: بدهیِ تأمین‌کننده کم می‌شود، و در برابرش نقد یا بانک یا اسنادِ پرداختنی
    const entry = await accounting.postJournalOn(tx, {
      description: `پرداختِ فاکتورِ ${invoice.invoice_no} به ${invoice.supplier_name} (${
        PAYMENT_METHOD_LABEL[input.method]
      })`,
      referenceType: 'purchase_invoice',
      referenceId: input.invoiceId,
      postedAt: paidAt,
      lines: [
        { accountCode: '2000', debitRial: input.amountRial, description: 'کاهشِ بدهیِ تأمین‌کننده' },
        {
          accountCode: CREDIT_ACCOUNT[input.method],
          creditRial: input.amountRial,
          description: PAYMENT_METHOD_LABEL[input.method],
        },
      ],
    });

    await tx.query(`UPDATE supplier_payments SET journal_entry_id = $2 WHERE id = $1`, [
      paymentId,
      entry.entryId,
    ]);

    const remaining = payable - input.amountRial;
    await tx.query(`UPDATE purchase_invoices SET payable_rial = $2 WHERE id = $1`, [
      input.invoiceId,
      remaining.toString(),
    ]);

    return {
      paymentId,
      invoiceNo: invoice.invoice_no,
      supplierName: invoice.supplier_name,
      amountRial: input.amountRial.toString(),
      remainingRial: remaining.toString(),
      entryNo: entry.entryNo,
      settled: remaining === 0n,
    };
  });
}

/**
 * وصولِ چکِ پرداختی: از «اسنادِ پرداختنی» به «بانک».
 *
 * چرا یک تابعِ جدا؟ چون لحظه‌یِ پرداخت (دادنِ چک) با لحظه‌یِ خروجِ پول از حساب
 * یکی نیست — ممکن است هفته‌ها فاصله باشد. سندِ دوم باید همان روزی بخورد که
 * بانک پول را برداشت، وگرنه صورت‌حسابِ بانک با دفترکل جور درنمی‌آید.
 */
export async function clearSupplierCheck(
  db: Database,
  input: { paymentId: string; clearedAt?: Date; actorUserId?: string | null },
): Promise<{ entryNo: string; checkNo: string | null }> {
  const accounting = new AccountingService(db);

  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      amount_rial: string;
      method: string;
      check_id: string | null;
      cleared_at: string | null;
      invoice_id: string;
    }>(
      `SELECT id, amount_rial::text, method, check_id, cleared_at::text, invoice_id
         FROM supplier_payments WHERE id = $1 FOR UPDATE`,
      [input.paymentId],
    );
    const payment = rows[0];
    if (!payment) throw new AppError('NOT_FOUND', { message: 'پرداخت یافت نشد' });
    if (payment.method !== 'check') {
      throw new AppError('VALIDATION', { message: 'فقط پرداختِ چکی وصول دارد' });
    }
    if (payment.cleared_at) {
      throw new AppError('CONFLICT', { message: 'این چک پیش‌تر وصول شده است' });
    }

    const clearedAt = input.clearedAt ?? new Date();
    const amount = BigInt(payment.amount_rial);

    const entry = await accounting.postJournalOn(tx, {
      description: 'وصولِ چکِ پرداختی (خروج از حسابِ بانک)',
      referenceType: 'supplier_payment',
      referenceId: payment.id,
      postedAt: clearedAt,
      lines: [
        { accountCode: '2050', debitRial: amount, description: 'بستنِ اسنادِ پرداختنی' },
        { accountCode: '1200', creditRial: amount, description: 'پرداخت از حسابِ بانک' },
      ],
    });

    await tx.query(`UPDATE supplier_payments SET cleared_at = $2 WHERE id = $1`, [
      payment.id,
      clearedAt.toISOString(),
    ]);

    let checkNo: string | null = null;
    if (payment.check_id) {
      const updated = await changeCheckStatus(tx, {
        checkId: payment.check_id,
        toStatus: 'settled',
        actorId: input.actorUserId ?? null,
        reason: 'وصولِ چکِ پرداختی به تأمین‌کننده',
      });
      checkNo = updated.check_no;
    }

    return { entryNo: entry.entryNo, checkNo };
  });
}

/** فهرستِ پرداخت‌هایِ یک فاکتور (برایِ نمایشِ «چه پرداخت شد، چه مانده») */
export async function listInvoicePayments(
  db: Database,
  invoiceId: string,
): Promise<
  Array<{
    id: string;
    amountRial: string;
    method: PaymentMethod;
    paidAt: string;
    referenceNo: string | null;
    clearedAt: string | null;
    entryNo: string | null;
  }>
> {
  const { rows } = await db.query<{
    id: string;
    amount_rial: string;
    method: PaymentMethod;
    paid_at: string;
    reference_no: string | null;
    cleared_at: string | null;
    entry_no: string | null;
  }>(
    `SELECT p.id, p.amount_rial::text, p.method, p.paid_at::text, p.reference_no,
            p.cleared_at::text, je.entry_no
       FROM supplier_payments p
       LEFT JOIN journal_entries je ON je.id = p.journal_entry_id
      WHERE p.invoice_id = $1
      ORDER BY p.paid_at DESC, p.created_at DESC`,
    [invoiceId],
  );
  return rows.map((r) => ({
    id: r.id,
    amountRial: r.amount_rial,
    method: r.method,
    paidAt: r.paid_at,
    referenceNo: r.reference_no,
    clearedAt: r.cleared_at,
    entryNo: r.entry_no,
  }));
}
