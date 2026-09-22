/**
 * ارتباطِ پنلِ مدیریت با API.
 *
 * دو تفاوتِ مهم با lib/api.ts (سایتِ عمومی):
 *  ۱) این فراخوانی‌ها همیشه سمتِ سرورند و توکنِ مدیر را می‌فرستند —
 *     بنابراین هیچ کشِ مشترکی ندارند (no-store)؛ داده‌ی پنل باید تازه باشد.
 *  ۲) خطا به‌جای پرتابِ استثنایِ بی‌نام، کدِ خطایِ API را منتقل می‌کند
 *     تا صفحه بتواند «۴۰۱ یعنی دوباره وارد شو» را از «۴۰۳ یعنی اجازه نداری» تشخیص دهد.
 */
const API_ORIGIN = process.env.API_BASE ?? 'http://127.0.0.1:3000';

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

function requestDelete<T>(path: string, token: string): Promise<T> {
  return request<T>('DELETE', path, token);
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  token: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        // سربرگِ content-type را تنها آن‌گاه می‌فرستیم که بدنه‌ای هست.
        // فرستادنِ آن با بدنه‌یِ تهی (مثلاً حذف) خطاست و fetch در نود
        // آن را با «Body cannot be empty…» پس می‌زند — یعنی هیچ حذفی
        // در پنل کار نمی‌کرد.
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // سامانه پاسخ نمی‌دهد (شبکه/فرآیندِ خاموش) — این با «نشست تمام شده» فرق دارد؛
    // نباید کاربر را به صفحه‌ی ورود فرستاد.
    throw new AdminApiError(503, 'SERVICE_UNAVAILABLE', 'سامانه در دسترس نیست؛ چند لحظه دیگر دوباره تلاش کنید.');
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new AdminApiError(
      res.status,
      payload?.error?.code ?? 'UNKNOWN',
      payload?.error?.message ?? `خطا در ارتباط با سامانه (${res.status})`,
    );
  }

  return res.json() as Promise<T>;
}

export function adminGet<T>(path: string, token: string): Promise<T> {
  return request<T>('GET', path, token);
}

export function adminPost<T>(path: string, token: string, body: unknown): Promise<T> {
  return request<T>('POST', path, token, body);
}

export function adminPatch<T>(path: string, token: string, body: unknown): Promise<T> {
  return request<T>('PATCH', path, token, body);
}
export function adminDelete<T = unknown>(path: string, token: string): Promise<T> {
  return requestDelete<T>(path, token);
}

/* ---------- قالب‌های داده — مطابقِ پاسخِ واقعیِ سرور ---------- */

export interface AdminSummary {
  products: number;
  orders: { total: number; paid: number; pending: number; today: number };
  inventory: { lowStock: number; outOfStock: number };
  revenue: { rial: number; display: string };
}

export interface AdminOrder {
  id: string;
  orderNo: string;
  status: string;
  channel: string;
  totalRial: string;
  total: string;
  createdAt: string;
  paidAt: string | null;
  customerName: string | null;
  customerMobile: string | null;
  /** بسته‌بندی — تهی یعنی هنوز بسته نشده است */
  packingComplete?: boolean | null;
  packedAt?: string | null;
}

export interface AdminOrderList {
  total: number;
  count: number;
  items: AdminOrder[];
}

export interface LowStockItem {
  variantId: string;
  sku: string;
  product: string;
  onHand: number;
  reserved: number;
  available: number;
}

export interface LowStockList {
  count: number;
  items: LowStockItem[];
}

export interface StockRow {
  variant_id: string;
  sku: string;
  product_title: string;
  on_hand: number;
  reserved: number;
  available: number;
}

export interface StockList {
  items: StockRow[];
}

/** برچسبِ فارسیِ وضعیتِ سفارش — ترجمه در یک‌جا انجام می‌شود، نه در هر صفحه */
const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'در انتظارِ پرداخت',
  awaiting_payment: 'در انتظارِ پرداخت',
  paid: 'پرداخت‌شده',
  confirmed: 'تأییدشده',
  packing: 'در حالِ بسته‌بندی',
  processing: 'در حالِ آماده‌سازی',
  shipped: 'ارسال‌شده',
  delivered: 'تحویل‌شده',
  cancelled: 'لغو شده',
  expired: 'منقضی شده',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

const CHANNEL_LABEL: Record<string, string> = {
  web: 'آنلاین',
  pos: 'حضوری',
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABEL[channel] ?? channel;
}

/* ==================== حسابداری ==================== */
/* قالب‌های داده دقیقاً مطابقِ پاسخِ کنترل‌کننده‌ی حسابداری‌اند؛
   اگر قراردادِ سرور تغییر کند، اینجا تنها جایی است که باید به‌روز شود. */

export interface MoneyDisplay {
  rial?: string;
  display?: string;
}

export interface AccountingSummary {
  period: string;
  entries: number;
  lastEntryNo: string | null;
  totals: { debit: string; credit: string };
  balances: {
    cash: string; bank: string; inventory: string; vatCredit: string;
    payables: string; revenue: string; cogs: string; expenses: string; net: string;
  };
  display: {
    cash: string; bank: string; inventory: string; vatCredit: string;
    payables: string; revenue: string; net: string;
  };
  stock: { quantity: number; valueRial: string; display: string };
}

export interface AccountRow {
  code: string;
  name: string;
  type: string;
  debitRial: string;
  creditRial: string;
  balanceRial: string;
  display: { debit: string; credit: string; balance: string };
}

export interface AccountList {
  count: number;
  items: AccountRow[];
}

export interface TrialBalance {
  accounts: Array<{ code: string; name: string; type: string; debit: string; credit: string }>;
  totals: { debit: string; credit: string };
  balanced: boolean;
  display: { debit: string; credit: string };
}

export interface BalanceSheetGroup {
  items: Array<{ code: string; name: string; balanceRial: string; display: string }>;
  totalRial: string;
  display: string;
  periodNetRial?: string;
  periodNetDisplay?: string;
}

export interface BalanceSheet {
  assets: BalanceSheetGroup;
  liabilities: BalanceSheetGroup;
  equity: BalanceSheetGroup;
  totalLiabilitiesAndEquity: { totalRial: string; display: string };
  balanced: boolean;
  differenceRial: string;
}

export interface ProfitLoss {
  period: string;
  revenue: { rial: string; display: string };
  cogs: { rial: string; display: string };
  grossProfit: { rial: string; display: string };
  expenses: { rial: string; display: string };
  netProfit: { rial: string; display: string };
  marginPercent: number;
  lines: Array<{ code: string; type: string; amountRial: string; display: string }>;
}

export interface JournalLineView {
  accountCode: string;
  accountName: string;
  debitRial: string;
  creditRial: string;
  debit: string;
  credit: string;
  description: string | null;
}

export interface JournalEntryView {
  id: string;
  entryNo: string;
  description: string;
  referenceType: string | null;
  status: string;
  postedAt: string;
  /** تاریخِ شمسی — در سرور ساخته می‌شود تا کتاب‌خانه‌ی تاریخ واردِ مرورگر نشود */
  postedAtFa?: string;
  period: string | null;
  lines: JournalLineView[];
  totalRial: string;
  display: { total: string };
}

export interface JournalList {
  total: number;
  count: number;
  items: JournalEntryView[];
}

export interface PurchaseInvoiceView {
  id: string;
  invoiceNo: string;
  supplierName: string;
  supplierNationalId: string | null;
  supplierInvoiceNo: string | null;
  issuedAt: string | null;
  createdAt: string;
  /** معادل‌هایِ شمسی — در سرور ساخته می‌شوند */
  issuedAtFa?: string;
  createdAtFa?: string;
  warehouse: string | null;
  subtotalRial: string;
  extraCostRial: string;
  vatRial: string;
  totalRial: string;
  payableRial: string;
  display: {
    subtotal: string; extraCost: string; vat: string; total: string; payable: string;
  };
}

export interface PurchaseList {
  total: number;
  count: number;
  items: PurchaseInvoiceView[];
}

export interface InventoryValueItem {
  variantId: string;
  sku: string;
  product: string;
  quantity: number;
  avgCostRial: string;
  valueRial: string;
  display: { avgCost: string; value: string };
}

export interface InventoryValue {
  count: number;
  totalQuantity: number;
  totalValueRial: string;
  display: { total: string };
  items: InventoryValueItem[];
}

export interface AccountingReference {
  accounts: Array<{ code: string; name: string; type: string }>;
  variants: Array<{ id: string; sku: string; product: string; price_rial: string; on_hand: number }>;
  warehouses: Array<{ id: string; name: string; is_default: boolean }>;
}

/** برچسبِ فارسیِ نوعِ حساب — در همه‌ی جدول‌هایِ حسابداری یکسان است */
const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  asset: 'دارایی',
  liability: 'بدهی',
  equity: 'حقوقِ صاحبانِ سهام',
  revenue: 'درآمد',
  expense: 'هزینه',
};

export function accountTypeLabel(type: string): string {
  return ACCOUNT_TYPE_LABEL[type] ?? type;
}

/** برچسبِ فارسیِ منشأِ سند */
const REFERENCE_LABEL: Record<string, string> = {
  purchase_invoice: 'فاکتورِ خرید',
  reversal: 'برگشت',
  order: 'سفارش',
  payment: 'پرداخت',
  manual: 'دستی',
};

export function referenceLabel(reference: string | null): string {
  if (!reference) return 'دستی';
  return REFERENCE_LABEL[reference] ?? reference;
}
