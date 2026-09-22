'use server';

import { revalidatePath } from 'next/cache';
import { adminGet, adminPost, adminPatch, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';
import { formatJalali, parseJalali, toEnglishDigits } from '@set/shared-kernel';

/**
 * کنش‌هایِ تأمین و خرید — سمتِ سرور.
 *
 * چرا اینجا و نه در مرورگر؟ چون نشانه‌یِ دسترسیِ پنل در یک کوکیِ HttpOnly است
 * (تا جاوااسکریپتِ صفحه نتواند آن را بخواند)؛ پس مرورگر نمی‌تواند آن را در
 * سرآیندِ Authorization بفرستد و هر فراخوانیِ مستقیم از مرورگر با ۴۰۱ روبه‌رو
 * می‌شد — بی‌آنکه در ظاهر چیزی بگوید. اینجا نشانه در سرور خوانده می‌شود و
 * مرورگر فقط «نتیجه» را می‌بیند.
 *
 * یک قاعده در همه‌ی این کنش‌ها: خطا پنهان نمی‌شود. پیامِ سامانه (مثلاً
 * «موجودی کافی نیست برای برگشت به تأمین‌کننده») همان‌طور به کاربر می‌رسد،
 * چون در تأمین، دلیلِ شکست به اندازه‌یِ خودِ شکست مهم است.
 */

export type ActionResult<T = null> =
  | { ok: true; data: T; message?: string }
  | { ok: false; message: string };

async function run<T>(fn: (token: string) => Promise<T>, successMessage?: string): Promise<ActionResult<T>> {
  const token = await getSessionToken();
  if (!token) {
    return { ok: false, message: 'نشستِ شما پایان یافته است؛ دوباره وارد شوید.' };
  }
  try {
    const data = await fn(token);
    // فهرست‌ها در صفحه سمتِ سرور ساخته می‌شوند؛ باید به نکست گفته شود دوباره بسازد
    revalidatePath('/admin/procurement');
    return successMessage ? { ok: true, data, message: successMessage } : { ok: true, data };
  } catch (err) {
    if (err instanceof AdminApiError) return { ok: false, message: err.message };
    if (err instanceof Error && err.message) return { ok: false, message: err.message };
    return { ok: false, message: 'خطایِ پیش‌بینی‌نشده؛ دوباره تلاش کنید.' };
  }
}

/* ---------- درخواستِ خرید ---------- */

export interface CreateRequestInput {
  items: Array<{ variantId: string; quantity: number; note?: string | null }>;
  supplierId?: string | null;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  source?: 'manual' | 'reorder_alert' | 'customer_order';
  reason?: string | null;
}

export async function createPurchaseRequest(
  input: CreateRequestInput,
): Promise<ActionResult<{ request?: { request_no?: string } }>> {
  return run(
    (token) => adminPost<{ request?: { request_no?: string } }>('/admin/procurement/requests', token, input),
    'درخواست ثبت شد؛ باید به تأییدِ مدیر برسد.',
  );
}

/** تأیید یا رد — تصمیمِ دوم روی یک درخواستِ تصمیم‌گرفته‌شده خطا می‌دهد (CONFLICT) */
export async function decidePurchaseRequest(
  id: string,
  approve: boolean,
  note?: string,
): Promise<ActionResult<unknown>> {
  return run(
    (token) =>
      adminPatch(`/admin/procurement/requests/${id}/decision`, token, {
        approve,
        note: note ?? (approve ? 'تأیید از پنل' : 'رد از پنل'),
      }),
    approve ? 'درخواست تأیید شد.' : 'درخواست رد شد.',
  );
}

/** ساختِ فاکتورِ خرید از روی درخواستِ تأییدشده (فقط سندِ مالی؛ موجودی را بالا نمی‌برد) */
export async function createPurchaseInvoiceFromRequest(input: {
  requestId: string;
  supplierId?: string | null;
  warehouseId: string;
  pricesToman: Record<string, number>;
  supplierInvoiceNo?: string | null;
}): Promise<ActionResult<{ invoice?: { invoice_no?: string } }>> {
  return run((token) =>
    adminPost<{ invoice?: { invoice_no?: string } }>(
      `/admin/procurement/requests/${input.requestId}/invoice`,
      token,
      input,
    ),
  );
}

/* ---------- رسیدِ انبار ---------- */

export interface CreateReceiptInput {
  supplierId?: string | null;
  purchaseInvoiceId?: string | null;
  purchaseRequestId?: string | null;
  warehouseId: string;
  trackingNo?: string | null;
  carrier?: string | null;
  supplierInvoiceNo?: string | null;
  discrepancyNote?: string | null;
  items: Array<{
    variantId: string;
    expectedQuantity: number;
    receivedQuantity: number;
    damagedQuantity: number;
    unitCostToman: number;
    note?: string | null;
  }>;
}

/**
 * ثبتِ رسید. این تنها جایی است که موجودیِ تأمین بالا می‌رود (BR-19) — فاکتور
 * به‌تنهایی موجودی را تغییر نمی‌دهد. مغایرتِ مقدار/قیمت در پاسخ برمی‌گردد تا
 * در همان لحظه دیده شود، نه در گزارشِ ماهانه.
 */
export async function createGoodsReceipt(
  input: CreateReceiptInput,
): Promise<
  ActionResult<{
    receiptNo?: string;
    status?: string;
    discrepancies?: Array<{
      title: string;
      sku: string | null;
      expected: number;
      received: number;
      damaged: number;
      kind: string | null;
      priceDiffToman: number | null;
    }>;
  }>
> {
  return run((token) => adminPost<never>('/admin/procurement/receipts', token, input));
}

/* ---------- تأمین‌کننده ---------- */

export interface CreateSupplierInput {
  name: string;
  storeName?: string | null;
  kind?: 'company' | 'person';
  nationalId?: string | null;
  economicCode?: string | null;
  contactName?: string | null;
  phone?: string | null;
  mobile?: string | null;
  province?: string | null;
  city?: string | null;
  address?: string | null;
  postalCode?: string | null;
  sheba?: string | null;
  settlementTerms?: 'cash' | 'credit_15' | 'credit_30' | 'cheque';
  leadTimeDays?: number;
  note?: string | null;
}

export async function createSupplier(
  input: CreateSupplierInput,
): Promise<ActionResult<{ supplier?: { code?: string; name?: string } }>> {
  return run(
    (token) => adminPost<{ supplier?: { code?: string; name?: string } }>('/admin/procurement/suppliers', token, input),
    'تأمین‌کننده ثبت شد.',
  );
}

/* ---------- برگشت به تأمین‌کننده ---------- */

export interface CreateSupplierReturnInput {
  supplierId: string;
  goodsReceiptId?: string | null;
  warehouseId?: string | null;
  reason: string;
  items: Array<{ variantId: string; quantity: number; unitCostToman?: number; note?: string | null }>;
}

export async function createSupplierReturn(
  input: CreateSupplierReturnInput,
): Promise<ActionResult<{ returnNo?: string; totalRial?: string; totalToman?: number }>> {
  return run(
    (token) =>
      adminPost<{ returnNo?: string; totalRial?: string; totalToman?: number }>(
        '/admin/procurement/supplier-returns',
        token,
        input,
      ),
    'برگشت ثبت شد.',
  );
}

/* ---------- تسویه‌یِ فاکتورِ خرید ---------- */

/**
 * چرا مبالغ در اینجا به ریال برگردانده می‌شوند؟ چون مدیر به تومان فکر می‌کند
 * و تومان می‌نویسد، اما پایگاه — و هر سندِ حسابداری — ریال است. تبدیل باید در
 * یک‌جا و یک‌بار انجام شود (اینجا) تا هیچ مسیری عددِ تومان را به‌اشتباه در
 * ستونِ ریال ننشاند. تاریخ هم همین‌طور: مدیر شمسی می‌نویسد، پایگاه میلادی
 * می‌خواهد.
 */
function tomanToRialString(amountToman: string | number): string {
  const cleaned = toEnglishDigits(String(amountToman)).replace(/[^\d]/g, '');
  if (!cleaned) throw new Error('مبلغ را به تومان وارد کنید');
  return (BigInt(cleaned) * 10n).toString();
}

export interface InvoicePaymentsView {
  invoice: {
    id: string;
    invoiceNo: string;
    supplierName: string;
    totalRial: string;
    payableRial: string;
    paidRial: string;
  };
  payments: Array<{
    id: string;
    amountRial: string;
    method: string;
    methodLabel: string;
    paidAt: string;
    /** تاریخِ شمسی — در سرور ساخته می‌شود تا مرورگر نیازی به کتابخانه نداشته باشد */
    paidAtFa: string;
    referenceNo: string | null;
    clearedAt: string | null;
    entryNo: string | null;
  }>;
}

export async function loadInvoicePayments(
  invoiceId: string,
): Promise<ActionResult<InvoicePaymentsView>> {
  return run(async (token) => {
    const raw = await adminGet<{
      invoice: InvoicePaymentsView['invoice'];
      payments: Array<Omit<InvoicePaymentsView['payments'][number], 'paidAtFa'>>;
    }>(`/admin/procurement/invoices/${invoiceId}/payments`, token);
    return {
      invoice: raw.invoice,
      payments: raw.payments.map((p) => ({
        ...p,
        paidAtFa: formatJalali(new Date(p.paidAt)),
      })),
    };
  });
}

export interface PayInvoiceInput {
  invoiceId: string;
  /** مبلغ به تومان (آنچه مدیر می‌نویسد) */
  amountToman: string | number;
  method: 'cash' | 'bank' | 'card' | 'check';
  /** تاریخِ شمسی؛ ناتهی یعنی امروز */
  paidAtJalali?: string | null;
  referenceNo?: string | null;
  note?: string | null;
  checkId?: string | null;
}

export async function paySupplierInvoiceAction(
  input: PayInvoiceInput,
): Promise<ActionResult<{ settled?: boolean; remainingRial?: string }>> {
  const paidAt = input.paidAtJalali ? parseJalali(input.paidAtJalali) : null;
  if (input.paidAtJalali && !paidAt) {
    return { ok: false, message: 'تاریخ را شمسی و درست وارد کنید، مثلِ ۱۴۰۵/۰۶/۲۰' };
  }

  return run(
    (token) =>
      adminPost<{ settled?: boolean; remainingRial?: string }>(
        `/admin/procurement/invoices/${input.invoiceId}/payments`,
        token,
        {
          amountRial: tomanToRialString(input.amountToman),
          method: input.method,
          paidAt: paidAt?.toISOString() ?? null,
          referenceNo: input.referenceNo ?? null,
          note: input.note ?? null,
          checkId: input.checkId ?? null,
        },
      ),
    'پرداخت ثبت شد.',
  );
}

export async function clearSupplierCheckAction(
  paymentId: string,
  clearedAtJalali?: string | null,
): Promise<ActionResult<{ entryNo?: string }>> {
  const clearedAt = clearedAtJalali ? parseJalali(clearedAtJalali) : null;
  if (clearedAtJalali && !clearedAt) {
    return { ok: false, message: 'تاریخِ وصول را شمسی و درست وارد کنید' };
  }
  return run(
    (token) =>
      adminPost<{ entryNo?: string }>(`/admin/procurement/payments/${paymentId}/clear`, token, {
        clearedAt: clearedAt?.toISOString() ?? null,
      }),
    'وصولِ چک ثبت شد.',
  );
}
