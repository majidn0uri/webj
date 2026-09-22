import { redirect } from 'next/navigation';
import {
  adminGet,
  AdminApiError,
  statusLabel,
  channelLabel,
  type AdminOrderList,
} from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';
import { OrderActions } from '@/components/admin/order-actions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

/** وضعیت‌هایی که در صافی ارائه می‌شوند — همان کلیدهایی که API می‌پذیرد */
const FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'همه' },
  { value: 'packing', label: 'در صفِ بسته‌بندی' },
  { value: 'confirmed', label: 'تأییدشده' },
  { value: 'paid', label: 'پرداخت‌شده' },
  { value: 'pending_payment', label: 'در انتظارِ پرداخت' },
  { value: 'cancelled', label: 'لغو شده' },
];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const params = await searchParams;
  const status = (params.status ?? '').trim();
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (status) query.set('status', status);

  let data: AdminOrderList;
  try {
    data = await adminGet<AdminOrderList>(`/admin/orders?${query.toString()}`, token);
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
    if (err instanceof AdminApiError && err.status === 403) {
      return <div className="alert alert--danger">شما اجازه‌ی دیدنِ سفارش‌ها را ندارید.</div>;
    }
    return <div className="alert alert--danger">سفارش‌ها در دسترس نیست: {String(err)}</div>;
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <>
      <header className="head">
        <h1 className="head__title">سفارش‌ها</h1>
        <p className="head__sub">
          <span className="num">{data.total}</span> سفارش — فروشِ آنلاین و حضوری
        </p>
      </header>

      <nav className="filters" aria-label="صافیِ وضعیت">
        {FILTERS.map((f) => {
          const qs = new URLSearchParams();
          if (f.value) qs.set('status', f.value);
          const href = qs.toString() ? `/admin/orders?${qs.toString()}` : '/admin/orders';
          const active = status === f.value;
          return (
            <a
              key={f.value || 'all'}
              href={href}
              className={`chip${active ? ' chip--active' : ''}`}
            >
              {f.label}
            </a>
          );
        })}
      </nav>

      <section className="panel panel--flush panel--flush">
        {data.items.length === 0 ? (
          <p className="empty">سفارشی با این صافی یافت نشد.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>شماره</th>
                <th>مشتری</th>
                <th>کانال</th>
                <th>وضعیت</th>
                <th className="ta-left">مبلغ</th>
                <th>فاکتور</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id}>
                  <td className="num">{o.orderNo}</td>
                  <td>
                    {o.customerName ?? '—'}
                    {o.customerMobile ? (
                      <span className="muted num"> · {o.customerMobile}</span>
                    ) : null}
                  </td>
                  <td>{channelLabel(o.channel)}</td>
                  <td>
                    <span className={`pill pill--${toneOf(o.status)}`}>
                      {statusLabel(o.status)}
                    </span>
                  </td>
                  <td className="num ta-left">{o.total} تومان</td>
                  <td>
                    {/*
                      پیوندِ فاکتور: چرا یک «پیوند» و نه یک کنشِ جاوااسکریپت؟
                      چون مسیرِ میانجی خودش توکنِ نشست را از کوکیِ httpOnly
                      می‌خواند؛ پس نیازی به فرستادنِ چیزی از مرورگر نیست و
                      پی‌دی‌اف با همان نامی که سرور ساخته ذخیره می‌شود.
                    */}
                    <a
                      className="btn btn--xs btn--ghost"
                      href={`/api/admin/exports/orders/${o.id}/invoice.pdf`}
                      title="دریافتِ فاکتورِ این سفارش"
                    >
                      فاکتور
                    </a>
                    {o.status === 'packing' || o.status === 'shipped' ? (
                      <a
                        className="btn btn--xs btn--ghost"
                        href={`/api/admin/orders/${o.id}/label/html`}
                        title="برگهٔ ارسال — قابل چاپ"
                        target="_blank"
                      >
                        🏷️ لیبل
                      </a>
                    ) : null}
                  </td>
                  <td>
                    <OrderActions
                      id={o.id}
                      status={o.status}
                      packingComplete={o.packingComplete ?? null}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {totalPages > 1 ? (
          <div className="pager">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
              const qs = new URLSearchParams({ page: String(p) });
              if (status) qs.set('status', status);
              return (
                <a
                  key={p}
                  href={`/admin/orders?${qs.toString()}`}
                  className={`pager__item num${p === page ? ' pager__item--active' : ''}`}
                >
                  {p}
                </a>
              );
            })}
          </div>
        ) : null}
      </section>
    </>
  );
}

/** رنگِ برچسبِ وضعیت — فقط ظاهر؛ منطقِ وضعیت در سمتِ سرور است */
function toneOf(status: string): string {
  if (status === 'paid' || status === 'delivered') return 'ok';
  if (status === 'cancelled' || status === 'expired') return 'danger';
  if (status === 'pending_payment' || status === 'awaiting_payment') return 'warn';
  return 'muted';
}
