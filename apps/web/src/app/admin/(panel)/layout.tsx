import type { ReactNode } from 'react';
import Link from 'next/link';
import { IconGrid, IconUser } from '@/components/store/icons';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/admin-session';
import { getIdentity } from '@/lib/admin-me';
import { logoutAction } from '@/lib/admin-actions';
import { AdminNav } from '@/components/admin/admin-nav';

export const metadata = {
  robots: { index: false, follow: false },
};

/** برچسبِ فارسیِ نقش — ترجمه در یک‌جا، نه در هر صفحه */
const ROLE_LABEL: Record<string, string> = {
  super_admin: 'مدیر کل',
  branch_manager: 'مدیر شعبه',
  seller: 'فروشنده',
  warehouse_keeper: 'انباردار',
  accountant: 'حسابدار',
  support: 'پشتیبان',
};

/**
 * پوسته‌ی بخشِ مدیریت.
 *
 * بررسیِ نشست اینجا انجام می‌شود، نه در هر صفحه،
 * تا هیچ مسیری از نگاهِ تصادفی بیرون نماند.
 *
 * تازه‌سازیِ توکن اینجا نیست چون کامپوننتِ سروری اجازه‌ی نوشتنِ کوکی ندارد؛
 * آن کار در `src/middleware.ts` انجام می‌شود که پیش از هر درخواست اجرا است.
 */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  // اگر سامانه پاسخ ندهد، میان‌افزار این را به ما می‌گوید تا به‌جایِ پرتابِ
  // کاربر به صفحه‌یِ ورود (که معنایش «نشست تمام شده» است) حقیقت را بگوییم.
  const apiDown = (await headers()).get('x-set-api-down') === '1';

  // هویت برایِ این‌که ناوبری فقط بخش‌هایِ مجاز را نشان دهد و کاربر بداند با
  // کدام نقش وارد شده است. شکستِ این فراخوانی هرگز صفحه را خراب نمی‌کند.
  const identity = await getIdentity();
  const roleLabel = identity?.roles.map((r) => ROLE_LABEL[r] ?? r).join('، ') ?? '';

  return (
    <div className="shell">
      <a href="#admin-content" className="skip-link">رفتن به محتوای مدیریت</a>
      <aside className="shell__side">
        <div className="shell__brand">
          <span className="shell__mark">ست</span>
          <span className="shell__brandText">ست‌شاپ<small>مدیریت یکپارچه فروشگاه</small></span>
        </div>

        {identity ? (
          <div className="shell__who" title={`شماره: ${identity.mobile}`}>
            <span className="shell__whoName">{identity.fullName ?? identity.mobile}</span>
            <span className="shell__whoRole">{roleLabel || 'بدون نقش'}</span>
          </div>
        ) : null}

        <AdminNav permissions={identity?.permissions ?? []} />

        <form action={logoutAction} className="shell__logout">
          <button className="btn btn--ghost btn--block" type="submit">
            خروج
          </button>
        </form>
      </aside>

      <div className="shell__workspace">
        <header className="admin-topbar">
          <div className="admin-topbar__title"><IconGrid size={20} /><span>فضای مدیریت <small>ست‌شاپ / پنل همکاران</small></span></div>
          <div className="admin-topbar__actions">
            <span className="admin-topbar__identity"><IconUser size={17} />{roleLabel || 'حساب همکار'}</span>
            <Link href="/" className="btn btn--ghost">مشاهده فروشگاه ↗</Link>
          </div>
        </header>
        <main className="shell__main" id="admin-content">
        {apiDown ? (
          <p className="alert alert--warn" role="status">
            سامانه در این لحظه پاسخ نمی‌دهد. نشستِ شما پابرجاست — چند لحظه دیگر
            دوباره تلاش کنید.
          </p>
        ) : null}

        {children}
      </main>
      </div>
    </div>
  );
}
