'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconCart, IconGrid, IconHome, IconUser } from './icons';

/**
 * نوارِ پایینِ موبایل.
 *
 * چرا؟ چون در موبایل، نوارِ بالا با اسکرول پنهان می‌شود و دسترسی به سبد
 * گران می‌گردد. چهار مقصدِ اصلی همیشه زیرِ شست می‌مانند:
 * خانه، دسته‌بندی، سبد، حساب.
 */
const ITEMS = [
  { href: '/', label: 'خانه', Icon: IconHome },
  { href: '/search', label: 'دسته‌بندی', Icon: IconGrid },
  { href: '/cart', label: 'سبد', Icon: IconCart },
  { href: '/admin/login', label: 'حساب', Icon: IconUser },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="tabbar" aria-label="ناوبریِ موبایل">
      {ITEMS.map(({ href, label, Icon }) => {
        const on = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link key={href} href={href} className="tabbar__item" data-on={on}>
            <Icon size={21} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
