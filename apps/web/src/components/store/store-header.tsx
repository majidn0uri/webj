import { AnnouncementBar } from './announcement-bar';
import { loadStorefrontBanners } from '@/lib/banner-actions';
import { loadCategoryTree } from '@/lib/category-actions';
import Link from 'next/link';
import { CartBadge } from './cart-badge';
import { api } from '@/lib/api';
import { SearchSuggest } from './search-suggest';
import { MegaMenu } from './mega-menu';
import { AccountLink } from '@/components/storefront/account-link';

/** پیوندهایِ ردیفِ دوم — کوتاه و دست‌چین‌شده، نه فهرستِ همه‌چیز */
const QUICK = [
  { href: '/search?q=شارژر', label: 'شارژر' },
  { href: '/search?q=قاب', label: 'قاب' },
  { href: '/search?q=کابل', label: 'کابل' },
  { href: '/search?q=گلس', label: 'گلس' },
  { href: '/search?q=پاوربانک', label: 'پاوربانک' },
];

/**
 * نوارِ بالای فروشگاه — دو ردیف، مانندِ فروشگاه‌هایِ بزرگ:
 *
 *   ردیفِ ۱: نشان · جستجو · حساب · سبد
 *   ردیفِ ۲: دسته‌بندی (با منویِ آبشاری) و میانبرهایِ پرفروش
 *
 * چرا جستجو در نوارِ بالاست و نه در وسطِ صفحه؟ چون در یک فروشگاهِ
 * قطعه‌فروشی، بیشترِ خریداران می‌دانند چه می‌خواهند؛ جستجو باید در
 * دسترس‌ترین نقطه باشد، نه در یک صفحه‌ی جدا.
 *
 * شمارنده‌ی سبد سمتِ کاربر است (`CartBadge`): برگه کش می‌شود و عدد پس از
 * بارگذاری از سبدِ واقعیِ همان بیننده می‌آید. اگر این عدد را در اینجا (در
 * سرور) می‌خواندیم، خواندنِ کوکی همه‌یِ برگه‌هایِ فروشگاه را پویا می‌کرد و
 * کش از دست می‌رفت.
 */
export async function StoreHeader() {
  let devices: Awaited<ReturnType<typeof api.devices>>['devices'] = [];
  try {
    devices = (await api.devices()).devices;
  } catch {
    devices = [];
  }

  // نوارِ اعلان اینجا می‌آید، نه در صفحه‌یِ نخست: سند می‌گوید «در همه‌یِ
  // صفحات». آوردنش در هدر یعنی یک بار نوشتن و همه‌جا دیده شدن — و اگر
  // کارسازِ بنرها در دسترس نبود، صفحه بی‌نوار بالا می‌آید، نه بی‌هدر.
  const storefront = await loadStorefrontBanners();

  // درختِ دسته‌ها برایِ منو — از پنل می‌آید و در هدرِ همه‌یِ صفحات است
  const categories = await loadCategoryTree();

  return (
    <>
      <AnnouncementBar items={storefront.announcements} />
      <header className="hdr">
      <div className="container-x">
        <div className="hdr__row">
          <Link href="/" className="hdr__logo" aria-label="ست‌شاپ — صفحه‌ی نخست">
            <span className="hdr__logo-mark" aria-hidden>
              ست
            </span>
            <span>ست‌شاپ<small className="hdr__tagline">انتخاب هوشمند لوازم جانبی</small></span>
          </Link>

          <div className="hdr__search">
            <SearchSuggest />
          </div>

          <div className="hdr__actions">
            {/* حسابِ مشتری. پیش از این این دکمه به «ورودِ همکاران» می‌رفت —
                یعنی مشتری از صفحه‌ی نخست هیچ راهی به سفارش‌هایِ خودش نداشت و
                ناچار بود آدرس را دستی بنویسد. مؤلفه سمتِ کاربر است تا صفحه‌های
                فروشگاه ایستا بمانند (کش‌شدنی) و با این حال نامِ مشتری درست
                نشان داده شود. ورودِ همکاران در پانوشت مانده است. */}
            <AccountLink />
            {/* شمارنده سمتِ کاربر است تا این هدر — و هر برگه‌ای که آن را دارد —
                کش‌شدنی بماند. */}
            <CartBadge />
          </div>
        </div>

        <nav className="hdr__nav" aria-label="دسته‌بندی‌ها">
          <MegaMenu devices={devices} categories={categories} />
          <span className="navsep" aria-hidden />
          {QUICK.map((q) => (
            <Link key={q.href} className="navlink" href={q.href}>
              {q.label}
            </Link>
          ))}
          <span className="navsep" aria-hidden />
          <Link className="navlink" href="/#devices">
            انتخاب بر اساسِ گوشی
          </Link>
          <Link className="navlink navlink--deals" href="/search?discounted=1">پیشنهادهای ویژه ✦</Link>
        </nav>
      </div>
      </header>
    </>
  );
}
