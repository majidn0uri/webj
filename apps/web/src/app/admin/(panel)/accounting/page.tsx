import { redirect } from 'next/navigation';
import {
  adminGet,
  AdminApiError,
  type AccountingReference,
  type AccountingSummary,
  type BalanceSheet,
  type InventoryValue,
  type JournalList,
  type ProfitLoss,
  type PurchaseList,
  type TrialBalance,
} from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';
import { formatJalali } from '@set/shared-kernel';
import { AccountingPanel } from '@/components/admin/accounting-panel';

export const dynamic = 'force-dynamic';

/**
 * صفحه‌ی حسابداری.
 *
 * همه‌ی داده در یک نوبت و به‌طورِ هم‌زمان خوانده می‌شود، اما با
 * `Promise.allSettled` نه `Promise.all`: اگر یکی از گزارش‌ها خطا بدهد
 * (مثلاً کاربر اجازه‌ی دیدنِ آن را نداشته باشد)، بقیه‌ی صفحه باید همچنان
 * کار کند — یک ۴۰۳ در یک گزارش نباید کلِ پنل را از کار بیندازد.
 */
export default async function AccountingPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const [summaryR, trialR, balanceR, profitR, journalR, purchasesR, stockR, refR] =
    await Promise.allSettled([
      adminGet<AccountingSummary>('/admin/accounting/summary', token),
      adminGet<TrialBalance>('/admin/accounting/trial-balance', token),
      adminGet<BalanceSheet>('/admin/accounting/balance-sheet', token),
      adminGet<ProfitLoss>('/admin/accounting/profit-loss', token),
      adminGet<JournalList>('/admin/accounting/journal?limit=50', token),
      adminGet<PurchaseList>('/admin/accounting/purchases?limit=30', token),
      adminGet<InventoryValue>('/admin/accounting/inventory-value', token),
      adminGet<AccountingReference>('/admin/accounting/reference', token),
    ]);

  // ۴۰۱ یعنی نشست منقضی شده؛ ۴۰۳ در «خلاصه» یعنی کاربر اصلاً حسابدار نیست
  const first = summaryR.status === 'rejected' ? summaryR.reason : null;
  if (first instanceof AdminApiError) {
    if (first.status === 401) redirect('/admin/login');
    if (first.status === 403) {
      return (
        <div className="alert alert--danger">
          شما اجازه‌ی دسترسی به حسابداری را ندارید. از مدیرِ سامانه دسترسیِ
          <code className="code"> accounting.read </code>
          را درخواست کنید.
        </div>
      );
    }
  }

  const value = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

  const journal = value(journalR);
  const purchases = value(purchasesR);

  // تاریخ‌ها در سرور به شمسی تبدیل می‌شوند: کتاب‌خانه‌ی تاریخ واردِ مرورگر نمی‌شود
  if (journal) {
    for (const entry of journal.items) {
      entry.postedAtFa = formatJalali(new Date(entry.postedAt), 'yyyy/MM/dd');
    }
  }
  if (purchases) {
    for (const p of purchases.items) {
      p.createdAtFa = formatJalali(new Date(p.createdAt), 'yyyy/MM/dd');
      if (p.issuedAt) p.issuedAtFa = formatJalali(new Date(p.issuedAt), 'yyyy/MM/dd');
    }
  }

  return (
    <>
      <header className="head">
        <h1 className="head__title">حسابداری</h1>
        <p className="head__sub">
          دفترکلِ دوبل · بهایِ تمام‌شده با میانگینِ موزون · ارزش افزوده و اعتبارِ مالیاتیِ ایران
          {value(summaryR)?.period ? (
            <>
              {' '}
              · دوره‌ی جاری <span className="num">{value(summaryR)!.period}</span>
            </>
          ) : null}
        </p>
      </header>

      <AccountingPanel
        data={{
          summary: value(summaryR),
          trialBalance: value(trialR),
          balanceSheet: value(balanceR),
          profitLoss: value(profitR),
          journal,
          purchases,
          stock: value(stockR),
          reference: value(refR),
        }}
      />
    </>
  );
}
