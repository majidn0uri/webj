import Link from 'next/link';
import { Suspense } from 'react';
import { api } from '@/lib/api';
import { toman } from '@/lib/format';
import { ProductCard } from '@/components/store/product-card';
import { SearchSuggest } from '@/components/store/search-suggest';
import { SearchFilters } from '@/components/store/search-filters';
import { FilterChips } from '@/components/store/filter-chips';

/**
 * چرا این صفحه کش می‌شود و چرا `force-dynamic` برداشته شد؟
 *
 * جستجو در هر بارِ اندازه‌گیری، کُندترینِ گامِ خریدار بود: ۳۴۶ میلی‌ثانیه در بارِ
 * ۳۰۰ نفرِ هم‌زمان، در برابرِ ~۷۰ برایِ بقیهٔ صفحه‌ها (docs/bar-va-tavan.md).
 * علتش «جست‌وجو‌کردن» نبود؛ ساختارِ صفحه بود: سه خواندنیِ پشتِ سرِ هم —
 * فهرستِ دستگاه‌ها، فهرستِ **صد کالا** تنها برایِ دروکردنِ نامِ رنگ‌ها، و خودِ
 * نتیجه — و `force-dynamic` همه‌شان را از کشِ بی‌رونبد می‌کرد. پس:
 *
 *   • رنگ‌ها مسیرِ خودشان را گرفتند (`GET /catalog/colours`، کشِ ده‌دقیقه‌ای)؛
 *     دیگر برایِ هفت نامِ رنگ، صد کالا خوانده نمی‌شود
 *   • دو خواندنیِ باقی‌مانده موازی شدند (`Promise.all`)
 *   • و `revalidate = 15` نشست تا دستگاه‌ها و رنگ‌ها و نتیجه‌یِ پرتکرار،
 *     در هر بازدید دوباره از API نگذرند.
 *
 * اندازه‌گیریِ همین تغییر رویِ همان بارِ ۳۰۰ نفره (var/load-search-cached.json):
 * جستجو ۳۴۵٫۸ ← ۸۰٫۴ میلی‌ثانیه، بقیهٔ گام‌ها ~۷۰ ← ~۱۸، و ۹۵٪ِ پاسخ
 * ۴۲۶ ← ۱۱۶ میلی‌ثانیه؛ در ثانیه ۲۹۵ → ۳۴۱ درخواست، با صفر خطا.
 *
 * دو چیزی که راست می‌گوییم، نه آرزو:
 *   ۱. خودِ **پاسخِ HTTP** کش نمی‌شود (`Cache-Control: private, no-store`)، چون
 *      صفحه از `searchParams` می‌خواند و نشانیِ پرس‌وجو جزوِ کلیدِ خروجی است —
 *      این را پس ازِ ساختِ واقعی با curl دیدیم، نه از روِ راهنما. چیزی که کش
 *      می‌شود «داده» است؛ بنابراین سودِ اصلی همین‌جاست و هر بارِ رندر هم سبک‌تر.
 *   ۲. ثبتِ «عبارتِ بی‌نتیجه» نمی‌شکند: آن در **API** و هنگامِ اجرایِ واقعیِ
 *      پرس‌وجو نوشته می‌شود، پس تا وقتی نتیجه‌یِ تازه‌ای تولید می‌شود، آمارِ
 *      جستجو هم نوشته می‌شود (کشیدنِ پاسخ یعنی کمتر نوشته شدنِ تکرارِ یک
 *      عبارتِ یکسان در یک بازهٔ ۱۵ ثانیه‌ای — که برایِ «پرتکرارترینِ واژه‌ها»
 *      درست‌تر است، نه غلط).
 *
 * موجودیِ انبار با این ۱۵ ثانیه گمراه نمی‌شود: برگه‌یِ کالا هم ۶۰ ثانیه کش
 * می‌شود و سبدِ خرید و پرداخت هرگز کش نمی‌شوند.
 */
export const revalidate = 15;

/** میانبرهایِ پرتکرار — اگر کاربر عبارتی ننوشته باشد */
const SHORTCUTS = ['شارژر', 'قاب آیفون', 'کابل تایپ‌سی', 'گلس', 'پاوربانک'];

/**
 * صفحه‌ی نتایجِ جستجو.
 *
 * سه وضعیتی که بیشتر فروشگاه‌ها درست انجام نمی‌دهند و اینجا انجام شده:
 *  ۱) نمایشِ «منظورتان چه بود» — اگر مترادفی اعمال شده باشد، کاربر می‌فهمد
 *     چرا این نتیجه‌ها را می‌بیند و می‌تواند آن را اصلاح کند؛
 *  ۲) «بی‌نتیجه» بن‌بست نیست — هم پیشنهادِ اصلاح داده می‌شود و هم کالاهایِ
 *     جایگزین؛ و ردّش در پایگاه‌داده ثبت می‌شود تا بشود کالایش را تأمین کرد؛
 *  ۳) مدتِ جستجو نمایش داده می‌شود — اگر کند شود، خودمان پیش از مشتری می‌فهمیم.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; device?: string; colour?: string; discounted?: string; available?: string }>;
}) {
  const { q, device, colour, discounted, available } = await searchParams;
  const query = (q ?? '').trim();

  // هر دو داده «مستقل ازِ عبارت»اند — پس هیچ دلیلی ندارد یکی پس ازِ دیگری
  // بخوانده شوند: در زمانِ بارِ زیاد، همین ترتیبِ بی‌دلیل دو سفرِ شبکه‌ای را
  // به مسیرِ پاسخ اضافه می‌کرد.
  //
  // رنگ‌ها از کلِ فروشگاه می‌آیند (نه از نتیجه‌یِ جستجو) تا فیلتر با هر جستجو
  // ناپدید نشود — و از مسیرِ مخصوصِ خودشان، نه از یک فهرستِ صدتایی.
  const [devices, { colours: allColours }] = await Promise.all([
    api.devices().catch(() => ({ devices: [] as Awaited<ReturnType<typeof api.devices>>['devices'] })),
    api.colours().catch(() => ({ colours: [] as string[] })),
  ]);

  return (
    <div className="container-x sf-pt-1" >
      <nav className="crumbs" aria-label="مسیر">
        <Link href="/">خانه</Link>
        <span className="crumbs__sep">/</span>
        <span className="sf-color-500">{query ? `جستجویِ «${query}»` : 'جستجو'}</span>
      </nav>

      <div className="sf-mt-3 sf-mb-4 sf-max-w-720" >
        <SearchSuggest autoFocus />
      </div>

      {!query ? (
        <div className="sf-flex sf-flex-wrap sf-gap-1">
          {SHORTCUTS.map((s) => (
            <Link key={s} href={`/search?q=${encodeURIComponent(s)}`} className="chip">
              {s}
            </Link>
          ))}
        </div>
      ) : null}

      {/* فیلترها بیرون از Suspense اند تا هنگامِ بارگیریِ نتیجه‌ها هم
          در دسترس بمانند و جهشِ چیدمان (layout shift) نیافرینند */}
      {query ? (
        <>
          <div className="sf-mb-3">
            <FilterChips colours={allColours} />
          </div>

          <Suspense key={query + (device ?? '') + (colour ?? '') + (discounted ?? '')} fallback={<ResultsSkeleton />}>
            <Results
              query={query}
              device={device}
              devices={devices.devices}
              colour={colour}
              discounted={discounted}
              available={available}
            />
          </Suspense>
        </>
      ) : null}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="grid-p sf-mt-3" >
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="card-p sf-p-0" >
          <div className="skel" style={{ aspectRatio: '1 / 1' }} />
          <div className="sf-p-3">
            <div className="skel" style={{ height: 14, marginBottom: 8 }} />
            <div className="skel" style={{ height: 14, width: '60%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

async function Results({
  query,
  device,
  devices,
  colour,
  discounted,
  available,
}: {
  query: string;
  device?: string;
  devices: Array<{ id: string; brand: string; model: string }>;
  colour?: string;
  discounted?: string;
  available?: string;
}) {
  let data: Awaited<ReturnType<typeof api.search>>;
  try {
    // فیلترها در نشانی‌اند و در کارساز اعمال می‌شوند؛ مرورگر تنها آن‌ها را
    // می‌فرستد. تشخیصِ «تخفیفِ جاری» وابسته به اکنون است و اگر اینجا در
    // مرورگر انجام می‌شد، تا رسیدنِ پاسخ تاریخش می‌گذشت.
    const extra =
      (device ? `&device=${encodeURIComponent(device)}` : '') +
      (colour ? `&colour=${encodeURIComponent(colour)}` : '') +
      (discounted === '1' ? '&discounted=1' : '') +
      (available === '1' ? '&available=1' : '');
    data = await api.search(query, extra);
  } catch {
    return (
      <div className="empty">
        <div className="empty__t">جستجو در این لحظه در دسترس نیست</div>
        <div>چند لحظه دیگر دوباره تلاش کنید.</div>
      </div>
    );
  }

  if (data.total === 0) {
    // «بی‌نتیجه» را ثبت می‌کنیم (سمتِ سرور در API انجام شده) و اینجا
    // پیشنهادِ عملی می‌دهیم، نه یک صفحه‌ی بن‌بست.
    const alternatives = await api.products('?limit=8').catch(() => ({ items: [], total: 0 }));

    return (
      <>
        <div
          className="empty sf-card-dashed"
          
        >
          <div className="empty__t">کالایی با این عبارت پیدا نشد</div>
          <p className="sf-line-height-2 sf-text-narrow" >
            {data.applied.length
              ? `ما «${data.applied.map((a) => a.input).join('، ')}» را به واژه‌یِ هم‌معنایش گسترش دادیم، اما باز هم نتیجه‌ای نبود. این درخواست ثبت شد تا کالایش تأمین شود.`
              : 'این درخواست ثبت شد؛ اگر تکرار شود، کالایش را به موجودی اضافه می‌کنیم.'}
          </p>
          <div className="sf-flex sf-gap-1 sf-text-center">
            <Link className="btn-p btn-p--primary" href="/">
              بازگشت به فروشگاه
            </Link>
            <Link className="btn-p btn-p--outline" href="/admin/login">
              ثبتِ کالا در پنل
            </Link>
          </div>
        </div>

        {alternatives.items.length ? (
          <section className="sect">
            <h2 className="sect__title">شاید این‌ها به‌کارتان بیاید</h2>
            <div className="grid-p sf-mt-3" >
              {alternatives.items.map((p) => (
                <ProductCard
                  key={p.id}
                  item={{
                    slug: p.slug,
                    title: p.title,
                    priceRial: p.priceRial,
                    price: p.price,
                    brand: p.brand,
                    imageUrl: p.imageUrl ?? null,
                    imageCardUrl: p.imageCardUrl ?? null,
                    imagePlaceholder: p.imagePlaceholder ?? null,
                    variantId: p.defaultVariantId ?? null,
                    // برچسب‌ها و رنگ‌ها: همان چیزی که کارساز حساب کرده
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
      </>
    );
  }

  return (
    <>
      {/*
        چرا اینجا یک h1 لازم است؟ چون صفحه‌ی نتایج، در عمل یک «صفحه‌ی فرود»
        برایِ هزاران عبارتِ جستجو است: موتورهایِ جستجو و صفحه‌خوان‌ها باید
        بدانند این صفحه درباره‌ی چیست. بدونِ تیتر، صفحه از نظرِ سئو بی‌هویت
        می‌ماند (اندازه‌گیریِ ما هم همین را نشان داد: صفر تیتر در صفحه).
      */}
      <h1 className="sf-text-2xl-bold">
        نتایجِ جستجویِ «{query}»
      </h1>

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--st-2)',
          fontSize: '1.25rem', color: 'var(--st-500)', marginBottom: 'var(--st-4)', flexWrap: 'wrap',
        }}
      >
        <span className="num sf-color-900 sf-font-bold" >
          {data.total}
        </span>
        کالا در <span className="num">{data.tookMs}</span> میلی‌ثانیه
        {data.applied.length ? (
          <>
            {' · '}منظورتان:{' '}
            {data.applied.slice(0, 3).map((a, i) => (
              <span key={a.input}>
                {i > 0 ? '، ' : ''}
                <b className="sf-color-900">{a.input}</b> ← {a.matched.slice(0, 2).join(' / ')}
              </span>
            ))}
          </>
        ) : null}
      </div>

      {data.relaxed ? (
        <div
          style={{
            margin: '0 0 var(--st-4)', padding: 'var(--st-3) var(--st-4)',
            fontSize: '1.25rem', color: '#b45309', background: 'var(--st-accent-soft)',
            borderRadius: 'var(--st-r-xs)', lineHeight: 2,
            borderInlineStart: '3px solid var(--st-accent)',
          }}
        >
          کالایی که <b>همه‌ی</b> واژه‌هایِ شما را یک‌جا داشته باشد نداریم؛ این‌ها بخشی از
          عبارت را دارند. نزدیک‌ترین‌ها بالاتر آمده‌اند.
        </div>
      ) : null}

      <div className="sf-search-grid">
        <div className="grid-p">
          {data.items.map((p) => (
            <ProductCard
              key={p.id}
              item={{
                slug: p.slug,
                title: p.title,
                priceRial: Number(p.minPriceRial),
                price: toman(Number(p.minPriceRial)),
                brand: p.brand,
                imageUrl: p.imageUrl,
                imageCardUrl: p.imageCardUrl ?? null,
                imagePlaceholder: p.imagePlaceholder ?? null,
                isNew: p.isNew ?? false,
                discountPercent: p.discountPercent ?? null,
                availableQty: p.availableQty ?? 0,
                colours: p.colours ?? [],
              }}
            />
          ))}
        </div>

        <SearchFilters devices={devices} active={device} />
      </div>
    </>
  );
}
