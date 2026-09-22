import Link from 'next/link';
import { getIdentity } from '@/lib/admin-me';
import { visibleAdminItems } from '@/lib/admin-navigation';
import { IconGrid, IconCart, IconPay, IconShield } from '@/components/store/icons';
import { redirect } from 'next/navigation';
import {
  adminGet,
  AdminApiError,
  type AdminSummary,
  type LowStockList,
} from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  // هر دو درخواست مستقل‌اند؛ هم‌زمان اجرا می‌شوند تا صفحه منتظرِ دو رفت‌وبرگشت نماند
  const [summaryResult, lowResult] = await Promise.allSettled([
    adminGet<AdminSummary>('/admin/summary', token),
    adminGet<LowStockList>('/admin/inventory/low?limit=5', token),
  ]);

  // ۴۰۱ یعنی نشست منقضی شده — کاربر باید دوباره وارد شود، نه اینکه خطا ببیند
  if (summaryResult.status === 'rejected') {
    const err = summaryResult.reason;
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
    if (err instanceof AdminApiError && err.status === 403) {
      return (
        <div className="alert alert--danger">
          شما اجازه‌ی دیدنِ گزارش‌ها را ندارید. از مدیرِ سامانه دسترسیِ
          <code className="code"> report.read </code>
          را درخواست کنید.
        </div>
      );
    }
    return <div className="alert alert--danger">گزارش در دسترس نیست: {String(err)}</div>;
  }

  const identity = await getIdentity();
  const quickPaths = ['/admin/orders', '/admin/products', '/admin/inventory', '/admin/reports'];
  const shortcuts = visibleAdminItems(identity?.permissions ?? []).filter((item) => quickPaths.includes(item.href));
  const s = summaryResult.value;
  const low = lowResult.status === 'fulfilled' ? lowResult.value.items : [];

  const cards = [
    { label: 'کالاها', value: s.products, hint: 'در کاتالوگ', Icon: IconGrid },
    { label: 'سفارش‌ها', value: s.orders.total, hint: `${s.orders.today} امروز`, Icon: IconCart },
    { label: 'پرداخت‌شده', value: s.orders.paid, hint: `${s.orders.pending} در انتظار`, Icon: IconPay },
    { label: 'کم‌موجود', value: s.inventory.lowStock, hint: `${s.inventory.outOfStock} تمام‌شده`, Icon: IconShield },
  ];

  return (
    <>
      <header className="head">
        <span className="admin-eyebrow">مرکز کنترل فروشگاه</span>
        <h1 className="head__title">پیشخوان مدیریت</h1>
        <p className="head__sub">خلاصه‌ی وضعیتِ فروشگاه در یک نگاه</p>
      </header>

      <section className="stats">
        {cards.map((c) => (
          <article key={c.label} className="stat">
            <div className="stat__top"><p className="stat__label">{c.label}</p><span className="stat__icon"><c.Icon size={20} /></span></div>
            <p className="stat__value num">{c.value.toLocaleString('fa-IR')}</p>
            <p className="stat__hint">{c.hint}</p>
          </article>
        ))}

        <article className="stat stat--wide">
          <p className="stat__label">درآمدِ پرداخت‌شده</p>
          <p className="stat__value num stat__value--money">{s.revenue.display}</p>
          <p className="stat__hint">تومان — مجموعِ سفارش‌های پرداخت‌شده</p>
        </article>
      </section>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel__head"><h2 className="panel__title">وضعیت سفارش‌ها</h2><span className="panel__note">از کل سفارش‌های ثبت‌شده</span></div>
          <div className="dashboard-status">
            {[
              { label: 'پرداخت‌شده', value: s.orders.paid, tone: 'paid' },
              { label: 'در انتظار پرداخت', value: s.orders.pending, tone: 'pending' },
              { label: 'ثبت‌شده امروز', value: s.orders.today, tone: 'today' },
            ].map((item) => (
              <div className={`dashboard-status__row dashboard-status__row--${item.tone}`} key={item.tone}>
                <div><span>{item.label}</span><strong className="num">{item.value.toLocaleString('fa-IR')}</strong></div>
                <meter min={0} max={Math.max(1, s.orders.total)} value={item.value} aria-label={item.label} />
              </div>
            ))}
            {s.orders.total === 0 && <p className="panel__note">هنوز سفارشی ثبت نشده است.</p>}
          </div>
        </section>
        {shortcuts.length > 0 && <section className="panel">
          <div className="panel__head"><h2 className="panel__title">دسترسی سریع</h2><span className="panel__note">کارهای روزانه</span></div>
          <div className="dashboard-shortcuts">
            {shortcuts.map((item) => <Link key={item.href} href={item.href} className="dashboard-shortcut"><span><strong>{item.label}</strong><small>{item.hint}</small></span><span aria-hidden>←</span></Link>)}
          </div>
        </section>}
      </div>

      <section className="panel panel--flush">
        <div className="panel__head">
          <h2 className="panel__title">کالاهای کم‌موجود</h2>
          <span className="panel__count num">{low.length}</span>
        </div>

        {lowResult.status === 'rejected' ? (
          <p className="empty" role="status">گزارش موجودی در دسترس نیست یا اجازه مشاهده آن را ندارید.</p>
        ) : low.length === 0 ? (
          <p className="empty">همه‌ی کالاها موجودیِ کافی دارند.</p>
        ) : (
          <div className="table-wrap" role="region" aria-label="کالاهای کم‌موجود" tabIndex={0}><table className="table">
            <thead>
              <tr>
                <th>کالا</th>
                <th>شناسه</th>
                <th className="ta-left">موجود</th>
                <th className="ta-left">رزرو</th>
                <th className="ta-left">قابل‌فروش</th>
              </tr>
            </thead>
            <tbody>
              {low.map((row) => (
                <tr key={row.variantId}>
                  <td>{row.product}</td>
                  <td className="num muted">{row.sku}</td>
                  <td className="num ta-left">{row.onHand}</td>
                  <td className="num ta-left">{row.reserved}</td>
                  <td className="num ta-left">
                    <span className={row.available <= 0 ? 'pill pill--danger' : 'pill pill--warn'}>
                      {row.available}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
