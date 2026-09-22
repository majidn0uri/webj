import type { ReactNode } from 'react';

/**
 * پوسته‌ی بسیار کم‌حجم برای همه‌ی صفحاتِ /admin.
 *
 * عمداً نوارِ کناری اینجا نیست: صفحه‌ی ورود هم زیرِ /admin است و نباید
 * پوسته‌ی پنل را بگیرد. پوسته‌ی اصلی در (panel)/layout.tsx قرار دارد.
 */
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return <div dir="rtl">{children}</div>;
}
