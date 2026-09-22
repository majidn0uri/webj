import Link from 'next/link';
import type { ReactNode } from 'react';
import { currentShopper, logoutShopper } from '@/lib/shopper-actions';
import { AccountLoginForm } from '@/components/storefront/account-login-form';

/** آیکون‌های ساده برای نوارِ کناری */
const Icons = {
  user: '👤',
  orders: '📦',
  addresses: '📍',
  wishlist: '❤️',
  logout: '🚪',
};

interface AccountShellProps {
  /** صفحه‌ی فعال در نوارِ کناری */
  active: 'dashboard' | 'orders' | 'addresses' | 'wishlist';
  /** آدرسِ بازگشت بعد از ورود */
  next?: string;
  children: ReactNode;
}

/**
 * پوسته‌ی مشترکِ صفحاتِ حساب.
 *
 * چرا این مؤلفه؟ چون هر صفحه‌ی حساب باید:
 *   ۱) بررسی کند کاربر وارد شده (وگرنه فرمِ ورود بیاورد)
 *   ۲) نوارِ کناری با پیوندها نشان دهد
 *   ۳) ناحیه‌ی محتوا داشته باشد
 *
 * تکرارِ این سه در هر صفحه یعنی ۴ بار کدِ یکسان — این مؤلفه آن را یک‌جا می‌کند.
 */
export async function AccountShell({ active, next = '/account', children }: AccountShellProps) {
  const me = await currentShopper();

  if (!me) {
    return (
      <div className="container-x">
        <div className="acct__login">
          <div className="acct__login-card">
            <div className="acct__login-icon" aria-hidden>👤</div>
            <AccountLoginForm next={next} />
          </div>
        </div>
      </div>
    );
  }

  const navItems = [
    { key: 'dashboard' as const, href: '/account', label: 'پیشخوان', icon: Icons.user },
    { key: 'orders' as const, href: '/account/orders', label: 'سفارش‌ها', icon: Icons.orders, count: me.counts.orders },
    { key: 'addresses' as const, href: '/account/addresses', label: 'نشانی‌ها', icon: Icons.addresses, count: me.counts.addresses },
    { key: 'wishlist' as const, href: '/account/wishlist', label: 'علاقه‌مندی‌ها', icon: Icons.wishlist, count: me.counts.wishlist },
  ];

  const initial = me.fullName ? me.fullName.charAt(0) : me.phone.charAt(3);

  return (
    <div className="container-x">
      <div className="acct">
        {/* ── نوارِ کناری ── */}
        <aside className="acct__side">
          {/* شناسه‌ی کاربر */}
          <div className="acct__user">
            <span className="acct__avatar" aria-hidden>{initial}</span>
            <div>
              <div className="acct__name">{me.fullName || 'کاربر'}</div>
              <div className="acct__phone num">{me.phone}</div>
              {me.mobileVerified ? (
                <span className="acct__badge acct__badge--verified">✓ تأیید شده</span>
              ) : null}
            </div>
          </div>

          {/* پیوندها */}
          <nav className="acct__nav" aria-label="حسابِ من">
            {navItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={`acct__link${active === item.key ? ' acct__link--active' : ''}`}
              >
                <span className="acct__link-icon" aria-hidden>{item.icon}</span>
                {item.label}
                {item.count != null && item.count > 0 ? (
                  <span className="acct__link-count num">{item.count}</span>
                ) : null}
              </Link>
            ))}

            <div className="acct__logout">
              <form action={logoutShopper}>
                <button
                  type="submit"
                  className="acct__link sf-btn-reset sf-w-full"
                   style={{ textAlign: 'right' }}
                >
                  <span className="acct__link-icon" aria-hidden>{Icons.logout}</span>
                  خروج
                </button>
              </form>
            </div>
          </nav>
        </aside>

        {/* ── محتوا ── */}
        <div className="acct__main">
          {children}
        </div>
      </div>
    </div>
  );
}