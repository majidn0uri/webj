import Link from 'next/link';
import { toman } from '@/lib/format';
import { ImagePlaceholder } from './placeholder';

export interface CardItem {
  slug: string;
  title: string;
  priceRial: number;
  price?: string | null;
  available?: number;
  badge?: string | null;
  hint?: string | null;
  imageUrl?: string | null;
  /** اندازه‌یِ کارت (۶۰۰ پیکسل) — برایِ فهرست‌ها */
  imageCardUrl?: string | null;
  /** پیش‌نمایشِ تار — پیش از رسیدنِ تصویرِ اصلی، جایش را نگه می‌دارد */
  imagePlaceholder?: string | null;
}

export function ProductCard({ item }: { item: CardItem }) {
  const priceText = item.price ?? toman(item.priceRial);
  const outOfStock = item.available === 0;

  return (
    <Link href={`/products/${item.slug}`} className="pcard">
      <style>{`
        .pcard {
          display: flex; flex-direction: column; gap: var(--s-2);
          padding: var(--s-3); background: var(--c-surface);
          border: 1px solid var(--c-border); border-radius: var(--r-sm);
          transition: box-shadow var(--dur) var(--ease), border-color var(--dur) var(--ease);
          height: 100%;
        }
        .pcard:hover { box-shadow: var(--shadow-md); border-color: var(--c-border-strong); }
        .pcard:hover .pcard__img { transform: scale(1.03); }
        .pcard__media { overflow: hidden; border-radius: var(--r-xs); }
        .pcard__img { transition: transform 320ms var(--ease); }
        .pcard__title {
          font-size: var(--fs-sm); font-weight: 400; line-height: 1.7;
          color: var(--c-text-2);
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
          min-height: 4.2rem;
        }
        .pcard__price { font-size: var(--fs-md); font-weight: 700; color: var(--c-text); }
        .pcard__row { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); }
      `}</style>

      <div className="pcard__media">
        {item.imageUrl ? (
          <img
            className="pcard__img"
            /* در فهرست، اندازه‌یِ «کارت» کافی است: تصویرِ ۱۶۰۰ پیکسلی برایِ
               یک کارتِ ۲۵۰ پیکسلی یعنی چند برابر حجمِ بی‌فایده رویِ اینترنتِ
               همراهِ مشتری */
            src={item.imageCardUrl ?? item.imageUrl}
            alt={item.title}
            loading="lazy"
            width={400}
            height={400}
            style={{
              display: 'block', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover',
              borderRadius: 'var(--r-xs)',
              /* نمایشِ بی‌پرش: تا نرسیدنِ تصویر، همان تارِ رنگی پیداست و
                 صفحه نمی‌پرد */
              background: item.imagePlaceholder
                ? `center/cover no-repeat url(${item.imagePlaceholder})`
                : 'var(--c-surface-2)',
            }}
          />
        ) : (
          <ImagePlaceholder label={item.title} />
        )}
      </div>

      <div className="pcard__title">{item.title}</div>

      <div className="pcard__row">
        <span className="pcard__price num">{priceText} تومان</span>
        {item.badge ? <span className="badge badge--brand">{item.badge}</span> : null}
      </div>

      <div className="pcard__row">
        <span style={{ fontSize: 'var(--fs-xs)', color: outOfStock ? 'var(--c-danger)' : 'var(--c-text-3)' }}>
          {outOfStock
            ? 'ناموجود'
            : item.available !== undefined
              ? `${item.available} عدد در انبار`
              : (item.hint ?? '')}
        </span>
      </div>
    </Link>
  );
}
