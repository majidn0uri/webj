/**
 * چیدمانِ ریشه: فقط پوسته‌یِ سند.
 *
 * یک قانون برایِ این پرونده: **هیچ چیزی از درخواست نخواند** — نه سرآیند، نه
 * کوکی، نه پارامترِ جستجو. دلیلش در بالایِ `(store)/layout.tsx` نوشته شده:
 * یک `headers()` در اینجا، کشِ همه‌یِ فروشگاه را خاموش می‌کند و هزینه‌اش در
 * شلوغی — نه در توسعه — دیده می‌شود.
 *
 * آنچه به درخواست وابسته است (پوسته‌یِ فروشگاه در برابرِ پوسته‌یِ پنل) با
 * ساختارِ پوشه‌ها تعیین می‌شود، نه با شرط در زمانِ اجرا.
 */

import type { Metadata } from 'next';
import './globals.css';
import './storefront.css';
import './account.css';
import './premium.css';

export const metadata: Metadata = {
  title: 'ست‌شاپ — لوازم جانبی موبایل با تضمینِ سازگاری',
  description:
    'فروشگاه تخصصیِ لوازم جانبی موبایل؛ کالاها بر اساسِ مدلِ دقیقِ گوشی شما فیلتر می‌شوند.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="st">{children}</body>
    </html>
  );
}
