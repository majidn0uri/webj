import { redirect } from 'next/navigation';
import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';
import { jalaliToday } from '@set/shared-kernel';
import { ReportsPanel } from '@/components/admin/reports-panel';
import type {
  DebtorsReportView,
  GrossProfitReportView,
  StockTurnoverReportView,
} from '@/lib/report-actions';

export const dynamic = 'force-dynamic';

/**
 * گزارش‌هایِ مدیریتی.
 *
 * چرا هر سه گزارش در یک بارگیریِ نخست می‌آیند؟ چون مدیری که برایِ تصمیمِ
 * ماهانه می‌آید، هم‌زمان به هر سه نیاز دارد: سودِ ناخالص می‌گوید «چه فروختیم»،
 * گردش می‌گوید «چه خوابیده»، سنِ بدهی می‌گوید «پول در راه است یا نه». سه
 * بارگیریِ جدا یعنی سه بار انتظار برای یک تصمیم.
 *
 * و چرا «همه یا هیچ» نیست؟ چون اگر یکی از این سه (مثلاً سنِ بدهی) خطا بدهد،
 * دو تایِ دیگر را از دست نمی‌دهیم: هر کدام جداگانه خوانده می‌شوند و هر کدام
 * که رسید نشان داده می‌شود.
 */
export default async function ReportsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const [profitRes, turnoverRes, debtorsRes] = await Promise.allSettled([
    adminGet<{ report: GrossProfitReportView }>('/admin/reports/gross-profit', token),
    adminGet<{ report: StockTurnoverReportView }>('/admin/reports/stock-turnover?windowDays=90', token),
    adminGet<{ report: DebtorsReportView }>('/admin/reports/debtors', token),
  ]);

  // اگر کاربر اصلاً دسترسی ندارد، نباید چارچوبِ صفحه را ببیند
  const denied = [profitRes, turnoverRes, debtorsRes].find(
    (r) => r.status === 'rejected' && r.reason instanceof AdminApiError && r.reason.status === 403,
  );
  if (denied) {
    return (
      <div className="alert alert--danger">
        شما اجازه‌ی دیدنِ گزارش‌هایِ مدیریتی را ندارید. از مدیرِ سامانه دسترسیِ
        <code className="code"> reports.read </code>
        را درخواست کنید. حاشیه‌یِ سود و سنِ بدهیِ مشتریان در اختیارِ نقش‌هایِ
        مدیریتی و حسابداری است.
      </div>
    );
  }

  if (
    profitRes.status === 'rejected' &&
    profitRes.reason instanceof AdminApiError &&
    profitRes.reason.status === 401
  ) {
    redirect('/admin/login');
  }

  return (
    <ReportsPanel
      initialProfit={profitRes.status === 'fulfilled' ? profitRes.value.report : null}
      initialTurnover={turnoverRes.status === 'fulfilled' ? turnoverRes.value.report : null}
      initialDebtors={debtorsRes.status === 'fulfilled' ? debtorsRes.value.report : null}
      todayJalali={jalaliToday()}
    />
  );
}
