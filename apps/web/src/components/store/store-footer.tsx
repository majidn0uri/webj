import Link from 'next/link';
import { IconPay, IconReturn, IconShield, IconTruck } from './icons';

/** ستون‌هایِ پانوشت — پیوندها واقعی‌اند، نه نمایشی */
const COLS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  {
    title: 'راهنمایِ خرید',
    links: [
      { href: '/search?q=قاب', label: 'انتخابِ قاب بر اساسِ گوشی' },
      { href: '/#devices', label: 'پیدا کردنِ مدلِ گوشی' },
      { href: '/cart', label: 'پیگیریِ سبد و تسویه' },
    ],
  },
  {
    title: 'خدمات',
    links: [
      { href: '/#trust', label: 'ضمانتِ اصالتِ کالا' },
      { href: '/#trust', label: 'هفت روز بازگشت' },
      { href: '/#trust', label: 'ارسال به سراسرِ ایران' },
    ],
  },
  {
    title: 'ست‌شاپ',
    links: [
      { href: '/#all', label: 'همه‌ی کالاها' },
      { href: '/admin/login', label: 'ورودِ همکاران' },
      { href: '/search?q=شارژر', label: 'پرفروش‌ترین‌ها' },
    ],
  },
];

/**
 * پانوشت.
 *
 * چرا «نمادهایِ اعتماد» اینجا تکرار شده‌اند؟ چون کاربرِ ایرانی در پایانِ
 * صفحه می‌خواهد بداند پولش برگشت‌پذیر است؛ پاسخ را همان‌جا می‌گیرد و
 * نیازی به رفتن به یک صفحه‌ی دیگر نیست.
 */
export function StoreFooter() {
  return (
    <footer className="ftr">
      <div className="container-x">
        <div className="ftr__top">
          <div>
            <div className="hdr__logo sf-mb-2" >
              <span className="hdr__logo-mark" aria-hidden>
                ست
              </span>
              ست‌شاپ
            </div>
            <p className="sf-text-sm sf-color-600 sf-line-height-2">
              فروشگاهِ تخصصیِ لوازمِ جانبیِ موبایل. هر کالا با مدلِ دقیقِ گوشی شما
              تطبیق داده می‌شود؛ چیزی که سازگار نباشد، اصلاً نشان داده نمی‌شود.
            </p>
          </div>

          {COLS.map((col) => (
            <div key={col.title}>
              <div className="ftr__h">{col.title}</div>
              <div className="ftr__list">
                {col.links.map((l) => (
                  <Link key={l.href + l.label} href={l.href}>
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="ftr__bottom">
          <span>همه‌ی مبالغ به تومان نمایش و به ریال ذخیره می‌شوند · تاریخ‌ها شمسی است.</span>
          <div className="ftr__badges">
            <span className="ftr__badge">
              <IconTruck size={16} /> ارسالِ سریع
            </span>
            <span className="ftr__badge">
              <IconShield size={16} /> ضمانتِ اصالت
            </span>
            <span className="ftr__badge">
              <IconReturn size={16} /> بازگشتِ هفت‌روزه
            </span>
            <span className="ftr__badge">
              <IconPay size={16} /> پرداختِ امنِ ایرانی
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
