'use server';

import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

/**
 * کنش‌هایِ گزارش‌هایِ مدیریتی — سمتِ سرور.
 *
 * چرا از مسیرِ سرور؟ دو دلیلِ جدا:
 *   ۱) نشانه‌یِ دسترسی در کوکیِ HttpOnly است؛ مرورگر نمی‌تواند آن را در
 *      سرآیند بفرستد و فراخوانیِ مستقیم با ۴۰۱ بی‌توضیح روبه‌رو می‌شد.
 *   ۲) این گزارش‌ها سنگین‌اند. اگر هر تغییرِ فیلتر، مرورگر را مستقیم به
 *      پایگاه می‌فرستاد، هر مدیر با چرخ‌دنده‌ای به نامِ «فیلتر» می‌توانست
 *      رویِ پایگاه بار بیندازد. اینجا گزارش از میانگیرِ سمتِ سرور می‌آید
 *      (report_cache) و درخواستِ تکراری هزینه‌ای ندارد.
 */

export type ReportResult<T> =
  | { ok: true; report: T; meta: { cached: boolean; generatedAt: string; buildMs: number } }
  | { ok: false; message: string };

async function fetchReport<T>(path: string): Promise<ReportResult<T>> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشستِ شما پایان یافته است؛ دوباره وارد شوید.' };

  try {
    const res = await adminGet<{
      report: T;
      meta: { cached: boolean; generatedAt: string; buildMs: number };
    }>(path, token);
    return { ok: true, report: res.report, meta: res.meta };
  } catch (err) {
    if (err instanceof AdminApiError) return { ok: false, message: err.message };
    if (err instanceof Error && err.message) return { ok: false, message: err.message };
    return { ok: false, message: 'گزارش در دسترس نیست؛ دوباره تلاش کنید.' };
  }
}

export interface GrossProfitQuery {
  from?: string;
  to?: string;
  groupBy?: string;
  channel?: string;
  rebuild?: boolean;
}

export interface GrossProfitReportView {
  fromJalali: string;
  toJalali: string;
  groupBy: string;
  rows: Array<{
    key: string;
    label: string;
    quantity: number;
    revenueRial: string;
    cogsRial: string;
    grossProfitRial: string;
    marginPercent: number;
  }>;
  totals: {
    quantity: number;
    revenueRial: string;
    cogsRial: string;
    grossProfitRial: string;
    marginPercent: number;
    shippingRial: string;
    uncostedQuantity: number;
  };
  ledger: {
    revenueRial: string;
    cogsRial: string;
    shippingRial: string;
    matches: boolean;
    differenceRial: string;
  };
  warnings: string[];
}

export async function loadGrossProfit(
  query: GrossProfitQuery,
): Promise<ReportResult<GrossProfitReportView>> {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.groupBy) params.set('groupBy', query.groupBy);
  if (query.channel) params.set('channel', query.channel);
  if (query.rebuild) params.set('rebuild', '1');
  return fetchReport<GrossProfitReportView>(`/admin/reports/gross-profit?${params.toString()}`);
}

export interface StockTurnoverReportView {
  windowDays: number;
  fromJalali: string;
  toJalali: string;
  rows: Array<{
    variantId: string;
    sku: string;
    title: string;
    soldQuantity: number;
    cogsRial: string;
    closingQuantity: number;
    closingValueRial: string;
    averageInventoryRial: string;
    turnoverPerYear: number | null;
    daysOfInventory: number | null;
    status: 'fast' | 'normal' | 'slow' | 'dead';
  }>;
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

export async function loadStockTurnover(input: {
  windowDays: number;
  rebuild?: boolean;
}): Promise<ReportResult<StockTurnoverReportView>> {
  const params = new URLSearchParams({ windowDays: String(input.windowDays) });
  if (input.rebuild) params.set('rebuild', '1');
  return fetchReport<StockTurnoverReportView>(`/admin/reports/stock-turnover?${params.toString()}`);
}

export interface DebtorsReportView {
  asOfJalali: string;
  creditTermDays: number;
  rows: Array<{
    customerId: string | null;
    name: string;
    mobile: string | null;
    totalRial: string;
    notDueRial: string;
    bucket1Rial: string;
    bucket2Rial: string;
    bucket3Rial: string;
    bucket4Rial: string;
    oldestDueJalali: string | null;
    documents: number;
    bouncedChecks: number;
    risk: 'none' | 'watch' | 'high';
  }>;
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
    rows: Array<{
      invoiceNo: string;
      supplierName: string;
      payableRial: string;
      dueJalali: string;
      daysPastDue: number;
      bucket: string;
    }>;
    totalPayableRial: string;
    overduePayableRial: string;
  };
  warnings: string[];
}

export async function loadDebtors(input: {
  creditTermDays: number;
  rebuild?: boolean;
}): Promise<ReportResult<DebtorsReportView>> {
  const params = new URLSearchParams({ creditTermDays: String(input.creditTermDays) });
  if (input.rebuild) params.set('rebuild', '1');
  return fetchReport<DebtorsReportView>(`/admin/reports/debtors?${params.toString()}`);
}
