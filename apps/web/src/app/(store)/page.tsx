import Link from 'next/link';
import { api } from '@/lib/api';
import { ProductCard } from '@/components/store/product-card';
import { DevicePicker } from '@/components/store/device-picker';
import { IconGrid, IconPay, IconReturn, IconShield, IconTruck } from '@/components/store/icons';
import { HeroBanners, MiddleBanners } from '@/components/store/hero-banners';
import { loadCategoryTree } from '@/lib/category-actions';
import { loadStorefrontBanners } from '@/lib/banner-actions';

export const revalidate = 60;

/** چهار وعده‌ای که در نوارِ اعتماد می‌آیند — هر کدام به یک رفتارِ واقعی گره خورده‌اند */
const TRUST = [
  {
    Icon: IconTruck,
    t: 'ارسالِ سریع',
    d: 'سفارش‌هایِ موجود، همان روز تحویلِ پست یا پیک می‌شوند.',
  },
  {
    Icon: IconShield,
    t: 'ضمانتِ اصالت',
    d: 'کالا با فاکتورِ رسمی و کدِ رهگیری ارسال می‌شود.',
  },
  {
    Icon: IconReturn,
    t: 'هفت روز بازگشت',
    d: 'تا هفت روز، بی‌دلیل و بی‌پرسش برگردانده می‌شود.',
  },
  {
    Icon: IconPay,
    t: 'پرداختِ امنِ ایرانی',
    d: 'درگاه‌هایِ داخلی؛ هیچ داده‌ای به خارج نمی‌رود.',
  },
];

export default async function HomePage() {
  // چرا این سه ریل جدا بارگیری می‌شوند؟
  // چون هر کدام پرس‌وجویِ متفاوتی است (پرفروش، تخفیف‌دار، فهرستِ برندها) و
  // شکستِ هر کدام نباید صفحه را زمین بزند: اگر ترند حساب نشد، بقیه‌ی صفحه
  // باید بالا بیاید. برای همین از allSettled استفاده شده، نه Promise.all.
  const [devicesRes, productsRes, trendRes, dealRes, brandsRes] = await Promise.allSettled([
    api.devices(),
    api.products('?limit=12'),
    api.products('?limit=8&sort=trending&available=1'),
    api.products('?limit=8&discounted=1&available=1'),
    api.brands(),
  ]);

  const devices = devicesRes.status === 'fulfilled' ? devicesRes.value.devices : [];
  const products = productsRes.status === 'fulfilled' ? productsRes.value : { items: [], total: 0 };
  const trend = trendRes.status === 'fulfilled' ? trendRes.value.items : [];
  const deals = dealRes.status === 'fulfilled' ? dealRes.value.items : [];
  const brands = brandsRes.status === 'fulfilled' ? brandsRes.value.brands : [];

  const toCard = (p: (typeof products.items)[number]) => ({
    slug: p.slug,
    title: p.title,
    priceRial: p.priceRial,
    price: p.price,
    brand: p.brand,
    variantCount: p.variantCount,
    availableQty: p.availableQty,
    discountPercent: p.discountPercent,
    isNew: p.isNew,
    colours: p.colours,
    imageUrl: p.imageUrl ?? null,
    imageCardUrl: p.imageCardUrl ?? null,
    imagePlaceholder: p.imagePlaceholder ?? null,
    // نامِ ویژگی در کارت «variantId» است: شناسه‌ای که «افزودن به سبدِ سریع» استفاده می‌کند
    variantId: p.defaultVariantId ?? null,
  });

  const cards = products.items.map(toCard);

  // ویترین: بنرهایی که فروشنده از پنل ساخته است. اگر نباشند، چیزی جایِ
  // آن‌ها خالی نمی‌ماند — صفحه همان است که بود.
  const [storefront, categories] = await Promise.all([loadStorefrontBanners(), loadCategoryTree()]);

  return (
    <div className="container-x">
      {/* ---------- بنرهایِ تبلیغاتی: آنچه فروشنده در پنل چیده ---------- */}
      <HeroBanners items={storefront.heroes} />

      {/* ---------- قهرمان: انتخابِ گوشی، پیش از هر چیز ---------- */}
      <section className="hero">
        <div className="hero__grid">
          <div>
            <span className="hero__kicker">دنیای لوازم جانبی، انتخابی دقیق‌تر</span>
            <h1 className="hero__title">برای گوشی شما،<br />دقیقاً همان چیزی که باید.</h1>
            <p className="hero__sub">
              مدلِ گوشی‌تان را انتخاب کنید. از این لحظه، فقط کالاهایی را می‌بینید که با
              همان مدل سازگارند؛ اگر چیزی نامشخص باشد، صادقانه «نامشخص» می‌نویسیم.
            </p>

            <div className="hero__panel">
              <div className="hero__label">گوشیِ شما کدام است؟</div>
              <DevicePicker devices={devices} />
            </div>
          </div>

          <div className="hero__visual" aria-hidden="true">
            <div className="hero__orbit" />
            <div className="hero__phone">
              {/* تصویر خودمیزبان؛ همان دارایی موجود در فروشگاه */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/products/case-silicon-matte.jpg" alt="" width={215} height={340} />
            </div>
            <div className="hero__float hero__float--one"><IconShield size={22} /><span>انتخاب مطمئن<small>سازگار با مدل گوشی شما</small></span></div>
            <div className="hero__float hero__float--two"><IconPay size={22} /><span>خرید آسان و امن<small>پرداخت از درگاه داخلی</small></span></div>
          </div>
        </div>

        <div className="hero__stat">
          {products.total.toLocaleString('fa-IR')} کالا · {devices.length.toLocaleString('fa-IR')} مدلِ گوشی · تطبیقِ دقیق
        </div>
      </section>

      {/* ---------- نوارِ اعتماد ---------- */}
      <MiddleBanners items={storefront.middles} />

      <section className="trust" id="trust">
        {TRUST.map(({ Icon, t, d }) => (
          <div className="trust__item" key={t}>
            <span className="trust__icon">
              <Icon size={20} />
            </span>
            <div>
              <div className="trust__t">{t}</div>
              <div className="trust__d">{d}</div>
            </div>
          </div>
        ))}
      </section>

      {categories.length > 0 && (
        <section className="sect" aria-labelledby="category-heading">
          <div className="sect__head"><h2 className="sect__title" id="category-heading">دسته‌بندی‌های فروشگاه</h2><Link className="sect__more" href="/search">همه کالاها ←</Link></div>
          <div className="category-grid">
            {categories.map((category) => (
              <Link className="category-tile" key={category.id} href={`/c/${encodeURIComponent(category.slug)}`}>
                <span className="category-tile__icon"><IconGrid size={24} /></span>
                <strong>{category.name}</strong><small>{category.totalCount.toLocaleString('fa-IR')} کالا</small>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ---------- ترند: آنچه دیگران می‌خرند ---------- */}
      {trend.length > 0 ? (
        <section className="sect" id="trend">
          <div className="sect__head">
            <h2 className="sect__title">پرفروشِ دو هفته‌یِ اخیر</h2>
            <span className="sect__more">بر اساسِ فروشِ واقعی، نه تبلیغ</span>
          </div>
          <div className="rail">
            {trend.map((p) => (
              <div className="rail__item" key={p.slug}>
                <ProductCard item={toCard(p)} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---------- تخفیف‌دار ---------- */}
      {deals.length > 0 ? (
        <section className="sect" id="deals">
          <div className="sect__head">
            <h2 className="sect__title">تخفیف‌دارِ همین امروز</h2>
            <Link href="/search?discounted=1" className="sect__more">
              همه‌ی تخفیف‌دارها ←
            </Link>
          </div>
          <div className="rail">
            {deals.map((p) => (
              <div className="rail__item" key={p.slug}>
                <ProductCard item={toCard(p)} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---------- برندها ---------- */}
      {brands.length > 0 ? (
        <section className="sect" id="brands">
          <div className="sect__head">
            <h2 className="sect__title">خرید بر اساسِ برند</h2>
            <span className="sect__more">{brands.length} برند</span>
          </div>
          <div className="brands">
            {brands.map((b) => (
              <Link key={b.slug} href={`/search?brand=${encodeURIComponent(b.slug)}`} className="brandcard">
                <span className="brandcard__name">{b.name}</span>
                <span className="brandcard__count num">{b.count} کالا</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---------- همه‌ی کالاها ---------- */}
      <section className="sect" id="all">
        <div className="sect__head">
          <h2 className="sect__title">همه‌ی کالاها</h2>
          <Link href="/search" className="sect__more">
            دیدنِ همه با فیلتر ←
          </Link>
        </div>
        {cards.length === 0 && <p className="store-empty" role="status">{productsRes.status === 'rejected' ? 'دریافت کالاها در حال حاضر ممکن نیست. لطفاً دوباره تلاش کنید.' : 'هنوز کالایی در این بخش ثبت نشده است.'}</p>}
        <div className="grid-p">
          {cards.map((c) => (
            <ProductCard key={c.slug} item={c} />
          ))}
        </div>
      </section>

      {/* ---------- خرید بر اساسِ مدل ---------- */}
      <section className="sect" id="devices">
        <div className="sect__head">
          <h2 className="sect__title">خرید بر اساسِ مدلِ گوشی</h2>
          <span className="sf-text-sm sf-color-500">
            {devices.length} مدل
          </span>
        </div>
        <div className="sf-flex sf-flex-wrap sf-gap-1">
          {devices.map((d) => (
            <Link key={d.id} href={`/device/${d.id}`} className="chip">
              {d.brand} {d.model}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
