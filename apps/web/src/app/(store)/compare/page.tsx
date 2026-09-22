import type { Metadata } from 'next';
import Link from 'next/link';

import { api } from '@/lib/api';
import { toman, faDigits } from '@/lib/format';
import { QuickAdd } from '@/components/store/quick-add';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'مقایسه‌یِ کالاها — ست‌شاپ' };

/**
 * مقایسه‌یِ کالا — دو تا چهار ستون در کنارِ هم.
 *
 * چرا همه‌چیز در نشانی است (`?slugs=…`)? چون همین قاعده‌یِ فیلترها اینجا هم
 * حرف می‌زند: پیوندِ «مقایسهٔ این سه شارژر» قابلِ فرستادن است، با کلیدِ
 * بازگشت درست کار می‌کند، و هیچ وضعیتِ مرورگری که در رفرش از بین برود
 * وجود ندارد. جدول هم کاملاً در سرور ساخته می‌شود — خریدار حتی با جاوااسکریپتِ
 * خاموش جدولِ کامل را می‌بیند.
 *
 * ترتیبِ ستون‌ها = ترتیبِ نشانی. ستونِ نخست انتخابِ خریدار است؛ «ارزان‌ترین»
 * را با رنگِ برند نشان می‌دهیم (نه با برچسب — عدد خودش حرف می‌زند).
 */

function specValue(v: string | number | null): string {
  if (v === null) return '—';
  const s = String(v);
  // اعدادِ خالص به رقمِ فارسی (۲۰ ← توان ۲۰ وات)
  return /^[0-9.]+$/.test(s) ? faDigits(s) : s;
}

/**
 * در نکستِ ۱۵، `searchParams` یک Promise است — `next build` صفحه را با قاعدهٔ
 * `PageProps` می‌سنجد و شکلِ سینکرون را رد می‌کند (tscِ ساده این را نمی‌بیند).
 */
export default async function ComparePage({ searchParams }: { searchParams: Promise<{ slugs?: string }> }) {
  const { slugs: slugsParam } = await searchParams;
  const slugs = (slugsParam ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (slugs.length < 2) {
    return (
      <div className="container-x sf-text-center sf-py-hero"  >
        <h1 className="sect__title sf-text-xl"  style={{ margin: '0 auto var(--st-3)' }}>
          برایِ مقایسه، دست‌کم دو کالا انتخاب کنید
        </h1>
        <p className="sf-text-md sf-color-500 sf-text-narrow" style={{ margin: '0 auto var(--st-5)' }}>
          از صفحه‌یِ هر کالا، «مقایسه» را بزنید — کالاها اینجا در کنارِ هم می‌نشینند:
          قیمت، مشخصات، امتیاز و سازگاری با گوشی.
        </p>
        <Link href="/" className="btn-p btn-p--primary sf-flex-0" >
          رفتن به فروشگاه
        </Link>
      </div>
    );
  }

  let data;
  try {
    data = await api.compare(slugs.join(','));
  } catch {
    data = null;
  }
  const products = data?.products ?? [];

  if (products.length < 2) {
    return (
      <div className="container-x sf-text-center sf-py-hero"  >
        <h1 className="sect__title sf-text-xl"  style={{ margin: '0 auto var(--st-3)' }}>
          برایِ مقایسه، دست‌کم دو کالایِ فعال لازم است
        </h1>
        <p className="sf-text-sm sf-color-500">
          یکی یا چند کالایِ پیوند حذف شده یا دیگر فعال نیست.
        </p>
        <Link href="/" className="btn-p btn-p--primary sf-flex-0" >
          رفتن به فروشگاه
        </Link>
      </div>
    );
  }

  const prices = products.map((p) => p.minPriceRial);
  const cheapest = Math.min(...prices);

  const stockLine = (n: number) =>
    n <= 0
      ? { text: 'ناموجود', cls: 'is-out' }
      : n <= 5
        ? { text: `تنها ${faDigits(n)} عدد مانده`, cls: 'is-low' }
        : { text: 'موجود', cls: 'is-in' };

  return (
    <div className="container-x sf-py-section" >
      <nav className="crumbs" aria-label="مسیر">
        <Link href="/">خانه</Link>
        <span className="crumbs__sep">/</span>
        <span className="sf-color-500">مقایسه</span>
      </nav>

      <div className="sect__head sf-mt-3" >
        <h1 className="sect__title sf-text-2rem" >
          مقایسه‌یِ {faDigits(products.length)} کالا
        </h1>
        <span className="sf-text-sm sf-color-500">
          ارزان‌ترین با رنگِ برند نشان داده شده
        </span>
      </div>

      <div className="cmp" role="region" aria-label="جدولِ مقایسه" tabIndex={0}>
        <table className="cmp__table">
          <thead>
            <tr>
              <th className="cmp__corner" scope="col" />
              {products.map((p, i) => (
                <th key={p.slug} scope="col" className={`cmp__head${p.minPriceRial === cheapest ? ' is-best' : ''}`}>
                  {p.imageUrl ? (
                    // تصویرِ محلی: هیچ درخواستی به دامنه‌ی خارجی (الزامِ «فقط ایران»)
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="cmp__head-img" src={p.imageUrl} alt="" width={120} height={120} />
                  ) : null}
                  <Link href={`/products/${p.slug}`} className="cmp__head-title">
                    {p.title}
                  </Link>
                  {p.brand ? <span className="cmp__head-brand">{p.brand}</span> : null}
                  <div className="cmp__price">
                    <span className="num">{toman(p.minPriceRial)}</span>
                    <span className="cmp__unit">تومان</span>
                  </div>
                  {p.discountPercent ? (
                    <span className="tag sf-tag-deal" >
                      {faDigits(p.discountPercent)}٪ تخفیف
                    </span>
                  ) : null}
                  <div className={`card-p__stock ${stockLine(p.available).cls}`}>{stockLine(p.available).text}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="cmp__rowhead">امتیاز خریداران</th>
              {products.map((p) => (
                <td key={p.slug} className="cmp__cell">
                  {p.rating !== null ? (
                    <span className="num">
                      {'★'.repeat(Math.round(p.rating))}
                      {'☆'.repeat(Math.max(0, 5 - Math.round(p.rating)))}
                      <span className="sf-color-500 sf-text-xs">
                        {' '}
                        {faDigits(p.rating)} ({faDigits(p.reviewCount)} نظر)
                      </span>
                    </span>
                  ) : (
                    <span className="sf-color-400">هنوز نظری ثبت نشده</span>
                  )}
                </td>
              ))}
            </tr>
            {data?.specRows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="cmp__rowhead">
                  {row.key.replaceAll('_', ' ')}
                </th>
                {row.values.map((v, i) => (
                  <td key={products[i].slug} className="cmp__cell">
                    {specValue(v)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" className="cmp__rowhead">سازگاری با گوشی</th>
              {products.map((p, i) => (
                <td key={p.slug} className="cmp__cell">
                  {(data?.deviceModels[i]?.length ?? 0) ? (
                    <ul className="cmp__models">
                      {(data?.deviceModels[i] ?? []).slice(0, 6).map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                      {(data?.deviceModels[i] ?? []).length > 6 ? (
                        <li className="sf-color-500">
                          +{faDigits((data?.deviceModels[i] ?? []).length - 6)} مدلِ دیگر
                        </li>
                      ) : null}
                    </ul>
                  ) : (
                    <span className="sf-color-400">همه‌یِ دستگاه‌ها</span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="cmp__rowhead" aria-hidden="true" />
              {products.map((p) => (
                <td key={p.slug} className="cmp__cell sf-grid sf-gap-1"  style={{ justifyContent: 'start' }}>
                  {p.defaultVariantId && p.available > 0 ? (
                    <QuickAdd variantId={p.defaultVariantId} title={p.title} />
                  ) : null}
                  <Link href={`/products/${p.slug}`} className="btn-p btn-p--outline sf-btn-md" >
                    مشاهده‌یِ کامل
                  </Link>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="sf-text-sm sf-color-400 sf-mt-3">
        قیمت همان عددی است که رویِ صفحه‌یِ کالا دیده می‌شود؛ تخفیفِ فعال در مرحله‌یِ سبد اعمال می‌شود.
      </p>
    </div>
  );
}
