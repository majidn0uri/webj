import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

interface CustomerRow {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  kind: string;
  isActive: boolean;
  isPartner: boolean;
  creditLimitToman: number | null;
  checkCeilingToman: number | null;
  orderCount: number;
  wishlistCount: number;
  spentToman: number;
  spentDisplay: string;
  lastOrderAt: string | null;
  lastLoginAt: string | null;
  registeredAt: string;
}

/**
 * فهرستِ مشتریان.
 *
 * چرا جستجو با فرمِ GET ساده است و نه جاوااسکریپت؟ چون کاربردِ اصلیِ این صفحه
 * «مشتری پشتِ خط است»: اپراتور شماره را می‌نویسد و enter می‌زند. جستجویِ
 * زنده نه لازم است و نه مفید (با هر رقم، درخواستِ تازه به پایگاه می‌فرستد)؛
 * و ماندنِ عبارت در نشانی این امتیاز را دارد که بتوان آن را برایِ همکار
 * فرستاد یا در تاریخچه‌ی مرورگر پیدا کرد.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const { q } = await searchParams;
  const query = (q ?? '').trim();

  let result: { items: CustomerRow[]; total: number } | null = null;
  let error: string | null = null;
  let forbidden = false;

  try {
    const qs = query ? `?q=${encodeURIComponent(query)}&limit=100` : '?limit=100';
    result = await adminGet<{ items: CustomerRow[]; total: number }>(`/admin/customers${qs}`, token);
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
    if (err instanceof AdminApiError && err.status === 403) forbidden = true;
    else error = err instanceof AdminApiError ? err.message : 'گزارش در دسترس نیست.';
  }

  if (forbidden) {
    return (
      <div className="alert alert--danger">
        شما اجازه‌ی دیدنِ فهرستِ مشتریان را ندارید. از مدیرِ سامانه دسترسیِ
        <code className="code"> customer.read </code>
        را درخواست کنید.
      </div>
    );
  }

  const items = result?.items ?? [];

  return (
    <>
      <header className="head">
        <h1 className="head__title">مشتریان</h1>
        <p className="head__sub">
          <span className="num">{result?.total ?? 0}</span> مشتری
          {query ? ` — جستجو: «${query}»` : ''}
        </p>
      </header>

      <section className="panel u-mb-4" >
        <form method="get" action="/admin/customers" className="u-flex u-gap-2">
          <input
            className="field__input"
            style={{ flex: 1, minWidth: 0 }}
            type="search"
            name="q"
            defaultValue={query}
            placeholder="جستجو با نام یا شماره‌ی همراه (مثلاً ۰۹۱۲۳۴۵۶۷۸۹)"
            aria-label="جستجوی مشتری"
          />
          <button className="btn btn--primary" type="submit">
            جستجو
          </button>
          {query && (
            <Link className="btn" href="/admin/customers">
              پاک کردن
            </Link>
          )}
        </form>
        <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          شماره را می‌توان با ارقامِ فارسی، با فاصله یا با ۰۹۱۲ نوشت؛ جستجو فقط رقم‌ها را می‌بیند.
        </p>
      </section>

      {error && <div className="alert alert--danger">{error}</div>}

      <section className="panel panel--flush panel--flush">
        {items.length === 0 ? (
          <p className="empty">
            {query
              ? 'مشتری‌ای با این مشخصات پیدا نشد. شماره را بدونِ صفر هم امتحان کنید.'
              : 'هنوز مشتری‌ای ثبت‌نام نکرده است.'}
          </p>
        ) : (
          <div className="u-overflow-x">
            <table className="table">
              <thead>
                <tr>
                  <th>مشتری</th>
                  <th>همراه</th>
                  <th className="ta-left">سفارش</th>
                  <th className="ta-left">خرید</th>
                  <th>آخرین خرید</th>
                  <th>وضعیت</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/admin/customers/${c.id}`} style={{ fontWeight: 600 }}>
                        {c.fullName}
                      </Link>
                      {c.isPartner && <span className="pill pill--ok" style={{ marginInlineStart: 6 }}>همکار</span>}
                      <div className="muted" style={{ fontSize: 12 }}>
                        عضویت: <span className="num">{c.registeredAt}</span>
                      </div>
                    </td>
                    <td className="num" dir="ltr">{c.phone ?? '—'}</td>
                    <td className="num ta-left">{c.orderCount}</td>
                    <td className="num ta-left">{c.spentDisplay}</td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {c.lastOrderAt ?? '—'}
                    </td>
                    <td>
                      {c.isActive ? (
                        <span className="pill pill--ok">فعال</span>
                      ) : (
                        <span className="pill pill--danger">مسدود</span>
                      )}
                    </td>
                    <td>
                      <Link className="btn btn--sm" href={`/admin/customers/${c.id}`}>
                        پرونده
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
