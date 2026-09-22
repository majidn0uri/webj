import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import { toman, faDigits } from '@/lib/format';
import { AddToCartBox } from '@/components/store/add-to-cart-box';
import { ProductCard } from '@/components/store/product-card';
import { IconCheck, IconPhone, IconShield, IconTruck } from '@/components/store/icons';
import { ProductReviews } from '@/components/store/product-reviews';
import { ProductQa } from '@/components/store/product-qa';
import { loadProductReviews } from '@/lib/review-actions';
import { loadCategoryDetail } from '@/lib/category-actions';
import { StockAlertButton } from '@/components/store/stock-alert-button';
import { loadColourSwatches } from '@/lib/colour-actions';
import { ProductTabs } from '@/components/store/product-tabs';
import { ImageLightbox } from '@/components/store/image-lightbox';
import { RecentlyViewed } from '@/components/store/recently-viewed';

export const revalidate = 60;

/**
 * پیش‌ساختنِ برگه‌یِ کالاها در زمانِ ساخت.
 *
 * چرا این تابع لازم است؟ چون در نکست، یک مسیرِ دارایِ پارامتر بی‌این تابع
 * «کاملاً پویا» به‌شمار می‌رود و **هرگز** کش نمی‌شود — حتی با `revalidate`.
 * این را اندازه گرفتیم: برگه‌یِ کالا، که پربازدیدترین برگه‌یِ فروشگاه است،
 * برایِ هر بازدید از نو رندر می‌شد و توان را همان‌جا قفل می‌کرد. با این
 * تابع، برگه‌هایِ فهرست‌شده آماده‌اند و آن‌هایی که در فهرست نیستند هم پس از
 * نخستین درخواست کش می‌شوند (رفتارِ «در صورتِ نیاز بساز و نگه دار»).
 *
 * چرا سقف؟ چون در یک فروشگاهِ بزرگ هزاران کالاست و پیش‌ساختنِ همه، زمانِ
 * استقرار را از دقیقه به ساعت می‌برد. سقف یعنی پرطرفدارها (که در آغازِ
 * فهرست می‌آیند) آماده‌اند و بقیه در نخستین بازدید ساخته می‌شوند.
 *
 * یک هشدارِ استقرار: این تابع در **زمانِ ساخت** اجرا می‌شود و به API نیاز
 * دارد. اگر نسخه‌یِ تولیدی را جایی بسازید که به پایگاه دسترسی ندارد، خروجی
 * تهی می‌شود و کشِ برگه‌ها از دست می‌رود — بی‌هیچ خطا. برای همین
 * `deploy/install.sh` ساخت را رویِ همان ماشین و با همان تنظیمات انجام
 * می‌دهد، نه در اجرایِ خودکار.
 */
const PRERENDER_LIMIT = 300;

export async function generateStaticParams() {
  try {
    const res = await fetch(`${process.env.API_BASE ?? 'http://127.0.0.1:3000'}/catalog/products?limit=${PRERENDER_LIMIT}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: { slug: string }[] };
    return (data.items ?? []).map((item) => ({ slug: item.slug })).filter((p) => Boolean(p.slug));
  } catch {
    return [];
  }
}

/**
 * صفحه‌ی کالا.
 *
 * چیدمان بر اساسِ ترتیبِ پرسش‌هایِ خریدار:
 *   ۱) این چیست و چند؟ (تصویر + عنوان + قیمت)
 *   ۲) به گوشیِ من می‌خورد؟ (بلوکِ سازگاری — برتریِ ما)
 *   ۳) الان موجود است؟ (موجودیِ واقعی، نه «موجود»)
 *   ۴) بعد از خرید چه می‌شود؟ (ارسال، بازگشت، ضمانت)
 *
 * جعبه‌ی خرید در دسکتاپ چسبنده (sticky) است: با اسکرول کردن در توضیحات،
 * دکمه‌ی خرید از دسترس خارج نمی‌شود.
 */
/**
 * برچسبِ فارسی برای کلیدهایِ ویژگی.
 *
 * چرا این نگاشت اینجاست؟ چون ویژگی‌ها در پایگاه با کلیدِ انگلیسی‌اند
 * (`material`, `power_watt`) و نمایشِ همان کلید به خریدار یعنی نشان دادنِ
 * زبانِ برنامه‌نویس به کسی که آمده خرید کند. کلیدی که اینجا نباشد، همان‌طور
 * که هست نمایش داده می‌شود — بدتر از این، پنهان کردنش است: خریدار باید
 * بتواند هرچه فروشنده ثبت کرده ببیند.
 */
const SPEC_LABELS: Record<string, string> = {
  material: 'جنس',
  thickness_mm: 'ضخامت (میلی‌متر)',
  power_watt: 'توان (وات)',
  port_type: 'نوعِ درگاه',
  length_cm: 'طول (سانتی‌متر)',
  capacity_mah: 'ظرفیت (میلی‌آمپر)',
  color: 'رنگ',
  weight_g: 'وزن (گرم)',
  warranty_months: 'گارانتی (ماه)',
};

function SpecsTable({ product }: { product: Awaited<ReturnType<typeof api.product>> }) {
  const attrs = (product.attributes ?? {}) as Record<string, unknown>;
  // ویژگی‌هایِ تنوع‌ها را هم می‌آوریم: گاهی چیزی (مانندِ رنگ) رویِ تنوع است
  // و نه رویِ کالا، و خریدار فرقشان را نمی‌داند — و نباید هم بداند.
  const variantAttrs: Record<string, Set<string>> = {};
  for (const v of product.variants ?? []) {
    const va = (v.attributes ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(va)) {
      if (value == null || value === '') continue;
      (variantAttrs[key] ??= new Set()).add(String(value));
    }
  }

  const rows: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === '') continue;
    rows.push({ label: SPEC_LABELS[key] ?? key, value: String(value) });
  }
  for (const [key, values] of Object.entries(variantAttrs)) {
    if (rows.some((r) => r.label === (SPEC_LABELS[key] ?? key))) continue;
    rows.push({ label: SPEC_LABELS[key] ?? key, value: [...values].join('، ') });
  }
  if ((product.variants?.length ?? 0) > 0) {
    rows.push({ label: 'تعدادِ مدل‌ها', value: faDigits(String(product.variants!.length)) });
  }

  if (rows.length === 0) {
    return <p className="muted">مشخصاتی برای این کالا ثبت نشده است.</p>;
  }

  return (
    <table className="specs">
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td dir="auto">{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let product: Awaited<ReturnType<typeof api.product>>;
  try {
    product = await api.product(slug);
  } catch {
    return notFound();
  }

  const active = product.variants.filter((v) => v.is_active);

  const soldOut = active.filter((v) => v.available <= 0);  const images = product.images.length ? product.images : [];
  const mainImage = images.find((i) => i.role === 'main') ?? images[0] ?? null;
  const prices = active.map((v) => Number(v.price_rial));
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  const totalAvailable = active.reduce((s, v) => s + v.available, 0);

  // کالاهایِ هم‌خانواده (همان نوع) برای پیشنهاد در پایینِ صفحه
  let related: Awaited<ReturnType<typeof api.products>>['items'] = [];
  try {
    const res = await api.products(`?type=${product.type}&limit=6`);
    related = res.items.filter((p) => p.slug !== product.slug).slice(0, 5);
  } catch {
    related = [];
  }

  // تاریخچهٔ قیمت — اگر بیش از یک نقطه باشد، نشانش می‌دهیم
  let priceHist: { points: Array<{ date: string; priceRial: number }>; total: number } = { points: [], total: 0 };
  try {
    priceHist = await api.priceHistory(product.slug);
  } catch {
    priceHist = { points: [], total: 0 };
  }

  const TYPE_LABEL: Record<string, string> = {
    charger: 'شارژر',
    cable: 'کابل',
    case: 'قاب',
    glass: 'گلس',
    powerbank: 'پاوربانک',
  };

  // سواچ‌هایِ رنگ — همان که خریدار پیش از هر واژه‌ای می‌بیند
  const swatches = await loadColourSwatches(product.slug);

  // نانِ راهنما: جایِ کالا در درختِ دسته‌ها (از پایگاه، نه از یک برچسبِ ثابت)
  const trail = product.type ? await loadCategoryDetail(String(product.type)).catch(() => null) : null;
  // نظرات یک‌بار خوانده می‌شود و به تب سپرده می‌شود؛ اگر درونِ تب صدا زده
  // می‌شد، مؤلفه ناهمگام می‌شد و همه‌یِ تب‌ها منتظرِ آن می‌ماندند.
  // نظرها بی‌کوکی خوانده می‌شوند — یعنی برایِ همه یکی‌اند و کش می‌شوند.
  //
  // چرا این تغییر؟ چون پیش از این، کوکیِ بیننده به کارسازِ نظرها داده می‌شد
  // تا «آیا من رأی داده‌ام؟» و «می‌توانم نظر بنویسم؟» درست برگردد. اما کوکی
  // خواندن یعنی این برگه پویا شود: برایِ هر بازدید، رندر از نو. بهایش در
  // آزمونِ بار اندازه گرفته شد — توان در جایی قفل می‌شد که پردازنده هنوز خلوت
  // بود، زیرا هزینه از رندر می‌آمد، نه از داده.
  //
  // آنچه راستی به بیننده وابسته است (می‌توانم نظر بنویسم؟) حالا در مرورگر
  // پرسیده می‌شود (نگاه کن به `product-reviews.tsx`)؛ آنچه برایِ همه یکی است
  // (متنِ نظرها، شمارشِ رأی‌ها) در سرور می‌ماند و کش می‌شود.
  const reviews = await loadProductReviews(product.slug);

  return (
    <div className="container-x sf-pt-1" >
      <nav className="crumbs" aria-label="مسیر">
        <Link href="/">خانه</Link>
        <span className="crumbs__sep">/</span>
        <Link href={`/search?q=${encodeURIComponent(TYPE_LABEL[product.type] ?? product.type)}`}>
          {TYPE_LABEL[product.type] ?? product.type}
        </Link>
        <span className="crumbs__sep">/</span>
        <span className="sf-color-500">{product.title}</span>
      </nav>

      <div className="pdp sf-mt-3" >
        {/* ---------- گالری ---------- */}
        <div className="pdp__gallery">
          <div className="pdp__main">
            {mainImage ? (
              <ImageLightbox
                images={images.map((img) => ({ url: img.url, alt: img.alt }))}
                mainUrl={mainImage.url}
                title={product.title}
              />
            ) : (
              <div className="card-p__ph">تصویر ندارد</div>
            )}
          </div>
          {images.length > 1 ? (
            <div className="pdp__thumbs">
              {images.map((img, i) => (
                <button
                  key={img.url}
                  type="button"
                  className="pdp__thumb"
                  aria-current={i === 0}
                  aria-label={`تصویرِ ${i + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" width={76} height={76} style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
                </button>
              ))}
            </div>
          ) : null}

          {/* ---------- تب‌ها: توضیحات / مشخصات / سازگاری / نظرات ----------
              برگه‌یِ کالا در موبایل بی‌نهایت بلند می‌شد و خریدار برایِ رسیدن
              به «به گوشیِ من می‌خورد؟» از میانِ چند صفحه می‌گذشت. حالا هر
              پرسش یک لمس فاصله دارد. */}
          <ProductTabs
            tabs={[
              {
                id: 'about',
                label: 'درباره‌ی کالا',
                content: product.description ? (
                  <p className="sf-pdp-desc">
                    {product.description}
                  </p>
                ) : (
                  <p className="muted">توضیحی برای این کالا نوشته نشده است.</p>
                ),
              },
              {
                id: 'specs',
                label: 'مشخصات',
                content: <SpecsTable product={product} />,
              },
              {
                id: 'compat',
                label: 'سازگاری',
                content: product.compatibleDevices?.length ? (
                  <div className="sf-flex sf-flex-wrap sf-gap-1">
                    {product.compatibleDevices.map((d) => (
                      <Link key={d.id} href={`/device/${d.id}`} className="chip">
                        <IconPhone size={13} />
                        {d.brand} {d.model}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="muted">
                    برایِ این کالا سازگاری با گوشیِ ویژه‌ای ثبت نشده است.
                  </p>
                ),
              },
              {
                id: 'reviews',
                label: `نظرات (${faDigits(reviews.total)})`,
                content: (
                  <ProductReviews
                    productId={product.id}
                    productSlug={product.slug}
                    initial={reviews}
                  />
                ),
              },
              {
                id: 'qa',
                label: 'پرسش و پاسخ',
                content: <ProductQa productId={product.id} />,
              },
            ]}
          />
        </div>

        {/* ---------- جعبه‌ی خرید ---------- */}
        {trail?.category ? (
          <nav className="crumbs sf-mb-2" aria-label="مسیر" >
            <Link href="/" className="crumbs__item">
              فروشگاه
            </Link>
            {trail.ancestors.map((item) => (
              <span key={item.id} className="crumbs__sep">
                <Link href={`/c/${item.slug}`} className="crumbs__item">
                  {item.name}
                </Link>
              </span>
            ))}
            <span className="crumbs__sep">
              <Link href={`/c/${trail.category.slug}`} className="crumbs__item">
                {trail.category.name}
              </Link>
            </span>
            <span className="crumbs__sep">
              <span className="crumbs__current" aria-current="page">
                {product.title}
              </span>
            </span>
          </nav>
        ) : null}

        <aside className="pdp__buy">
          <div className="sf-flex sf-items-center sf-gap-1 sf-mb-1">
            <span className="tag tag--brand">{product.brand ?? 'بدون برند'}</span>
            <span className="tag tag--ok">
              <IconCheck size={12} /> اصالتِ کالا
            </span>
          </div>

          <h1 className="sf-pdp-title">
            {product.title}
          </h1>

          <div className="price price--lg sf-mb-1" >
            <span className="price__value num">
              {min === max ? toman(min) : `${toman(min)} – ${toman(max)}`}
            </span>
            <span className="price__unit">تومان</span>
          </div>
          <div className="sf-pdp-sku">
            {active.length > 1 ? `${active.length} تنوع (رنگ/مدل)` : 'یک تنوع'} · ارزش افزوده طبقِ فاکتور
          </div>

          <AddToCartBox
            swatches={swatches}
            variants={active.map((v) => ({
              id: v.id,
              sku: v.sku,
              priceRial: Number(v.price_rial),
              available: v.available,
              color: (v.attributes as { color?: string } | null)?.color ?? null,
            }))}
          />

          {/* «خبرم کن» برایِ هر تنوعی که تمام شده است — نه فقط هنگامی که
              همه تمام شده باشند. خریدارِ قابِ مشکیِ S23 را کاری نیست با
              اینکه قابِ مشکیِ ۱۳ موجود باشد؛ او مدلِ خودش را می‌خواهد. */}
          {soldOut.length > 0 ? (
            <div className="stock-alert">
              <p className="stock-alert__lead">این کالا در این مدل‌ها تمام شده است:</p>
              {soldOut.map((v) => (
                <div className="stock-alert__row" key={v.id}>
                  <span className="stock-alert__label">
                    {(v.attributes as { color?: string } | null)?.color ?? v.sku ?? 'این مدل'}
                  </span>
                  <StockAlertButton variantId={v.id} />
                </div>
              ))}
            </div>
          ) : null}

          <div className="sf-pdp-attrs">
            <div className="sf-pdp-attr">
              <IconTruck size={17} /> ارسالِ سریع به سراسرِ ایران
            </div>
            <div className="sf-flex sf-items-center sf-gap-1 sf-text-sm sf-color-600">
              <IconShield size={17} /> ضمانتِ اصالت و فاکتورِ رسمی
            </div>
            <div className="sf-flex sf-items-center sf-gap-1 sf-text-sm sf-color-600">
              <IconCheck size={17} /> هفت روز بازگشتِ بی‌قیدوشرط
            </div>
          </div>

          {/* تاریخچهٔ قیمت — اگر بیش از یک نقطه باشد، نشانش می‌دهیم */}
          {priceHist.points.length > 1 ? (
            <div className="sf-pdp-prices">
              <p className="sf-pdp-prices__title">
                تاریخچهٔ قیمت
              </p>
              <div className="sf-pdp-prices__list">
                {priceHist.points.slice(-7).map((p) => (
                  <span key={p.date} className="sf-pdp-prices__item">
                    {p.date.slice(5)}: {toman(p.priceRial)}
                  </span>
                ))}
              </div>
              <p className="sf-pdp-prices__note">
                {priceHist.points.length} روز داده — قیمتِ فعلی {min === Math.min(...priceHist.points.map((p) => p.priceRial)) ? 'ارزان‌ترین' : 'ارزان‌ترین نیست'}
              </p>
            </div>
          ) : null}

          {/* مقایسه: این کالا با هم‌خانواده‌هاش، در یک نگاه — پیوند در نشانی،
              پس قابلِ فرستادن است و با کلیدِ بازگشت درست کار می‌کند. */}
          {related.length > 0 ? (
            <Link
              href={`/compare?slugs=${[product.slug, ...related.slice(0, 3).map((r) => r.slug)].join(',')}`}
              className="btn-p btn-p--ghost sf-pdp-swatch-btn"
              
            >
              مقایسه با کالاهایِ هم‌خانواده
            </Link>
          ) : null}
        </aside>
      </div>

      {/* ---------- دیده‌شده‌هایِ اخیر ---------- */}
      <RecentlyViewed
        currentSlug={product.slug}
        currentTitle={product.title}
        currentImageUrl={mainImage?.url ?? null}
      />

      {/* ---------- کالاهایِ مرتبط ---------- */}
      {related.length ? (
        <section className="sect">
          <div className="sect__head">
            <h2 className="sect__title">کالاهایِ هم‌خانواده</h2>
            <Link href={`/search?q=${encodeURIComponent(TYPE_LABEL[product.type] ?? product.type)}`} className="sect__more">
              دیدنِ همه ←
            </Link>
          </div>
          <div className="grid-p">
            {related.map((p) => (
              <ProductCard
                key={p.id}
                item={{
                  slug: p.slug,
                  title: p.title,
                  priceRial: p.priceRial,
                  price: p.price,
                  brand: p.brand,
                  imageUrl: p.imageUrl ?? null,
                  variantId: p.defaultVariantId ?? null,
                  isNew: p.isNew ?? false,
                  discountPercent: p.discountPercent ?? null,
                  availableQty: p.availableQty ?? 0,
                  colours: p.colours ?? [],
                }}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
