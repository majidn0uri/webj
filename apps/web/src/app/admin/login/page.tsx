import type { Metadata } from 'next';
import { LoginForm } from '@/components/admin/login-form';

export const metadata: Metadata = {
  title: 'ورود به پنل — ست‌شاپ',
  robots: { index: false, follow: false },
};

/** مقصد باید درونِ پنل باشد؛ نشانیِ بیرونی پذیرفته نمی‌شود (باز-هدایتِ باز) */
function safeNext(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  if (!value.startsWith('/admin') || value.startsWith('/admin/login') || value.startsWith('//')) {
    return '/admin';
  }
  return value;
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  // «?next=» یعنی کاربر از میانه‌ی کار بیرون انداخته شده است — باید گفته شود چرا
  const expired = typeof params.next === 'string' && params.next.length > 0;

  return (
    <main className="login">
      <div className="login__card">
        <div className="login__brand">
          <span className="login__mark">ست</span>
          <div>
            <h1 className="login__title">پنلِ مدیریت</h1>
            <p className="login__subtitle">فروشگاهِ لوازمِ جانبیِ موبایل</p>
          </div>
        </div>

        {expired ? (
          <p className="alert alert--warn" role="status">
            نشستِ شما پایان یافته است. دوباره وارد شوید تا همان‌جا که بودید برگردید.
          </p>
        ) : null}

        <LoginForm next={next} />

        <div className="login__hint">
          <p className="login__hint-title">حساب‌های نمونه (محیطِ توسعه)</p>
          <ul className="login__list">
            <li>
              <span className="num">۰۹۱۲۰۰۰۰۰۰۰</span> — مدیر کل
            </li>
            <li>
              <span className="num">۰۹۱۲۰۰۰۰۰۰۱</span> — فروشنده
            </li>
            <li>
              <span className="num">۰۹۱۲۰۰۰۰۰۰۲</span> — انباردار
            </li>
          </ul>
          <p className="login__hint-note">رمزِ همه: SetShop@1404</p>
        </div>
      </div>
    </main>
  );
}
