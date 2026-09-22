import { redirect } from 'next/navigation';
import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';
import { ExportsPanel, type ExportItem } from '@/components/admin/exports-panel';

export const dynamic = 'force-dynamic';

/**
 * خروجی‌هایِ رسمی.
 *
 * چرا این صفحه خودش نمی‌داند چند خروجی وجود دارد؟ چون فهرستِ خروجی‌ها را
 * (`manifest`) از سرور می‌گیرد. افزودنِ یک خروجیِ تازه در سرور کافی است تا
 * اینجا پیدا شود — بی‌آنکه کسی دست به این صفحه ببرد. این همان اصلی است که
 * بقیه‌یِ پنل هم بر آن بنا شده: **رابط از داده پیروی می‌کند، نه برعکس.**
 *
 * و چرا دسترسی جدا بررسی می‌شود؟ چون نبودِ دسترسی در اینجا دو حالت دارد که
 * نباید یکی دیده شود: «وارد نشده‌ای» (برو به ورود) و «اجازه نداری» (برو
 * از مدیرت بخواه). نشان دادنِ یک پیام برایِ هر دو، یعنی کاربرِ بی‌دسترسی
 * فکر می‌کند نشستش پریده و بی‌دلیل رمز عوض می‌کند.
 */
export default async function ExportsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  let items: ExportItem[] = [];
  try {
    const manifest = await adminGet<{ items: ExportItem[] }>('/admin/exports/manifest', token);
    items = manifest.items;
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
    if (err instanceof AdminApiError && err.status === 403) {
      return (
        <div className="alert alert--danger">
          شما اجازه‌ی خروجی گرفتن از گزارش‌ها را ندارید. از مدیرِ سامانه دسترسیِ
          <code className="code"> reports.export </code>
          را درخواست کنید. داده‌یِ فروش و سودِ شرکت در اختیارِ نقش‌هایِ مدیریتی و
          حسابداری است.
        </div>
      );
    }
    return <div className="alert alert--danger">فهرستِ خروجی‌ها در دسترس نیست: {String(err)}</div>;
  }

  return (
    <>
      <header className="head">
        <h1 className="head__title">خروجی‌ها</h1>
        <p className="head__sub">
          <span className="num">{items.length}</span> خروجیِ آماده — اکسل برایِ حسابداری، پی‌دی‌اف برایِ چاپ و
          ارسال
        </p>
      </header>

      <ExportsPanel items={items} />
    </>
  );
}
