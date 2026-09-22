import Link from 'next/link';
import { toman } from '@/lib/format';
import { IconPlus, IconStar } from './icons';
import { QuickAdd } from './quick-add';
import { QuickView } from './quick-view';
import { WishlistButton } from './wishlist-button';

/** تا چند عدد «آخرین موجودی» به‌شمار می‌آید */
const LOW_STOCK_AT = 5;

/** نامِ رنگ → کدِ رنگ (همان نگاشتِ سواچِ کالا، کوچک‌تر برایِ کارت) */
const CARD_COLOURS: Record<string, string> = {
  مشکی: '#1a1a1a', سفید: '#f5f5f5', خاکستری: '#9e9e9e', نقره‌ای: '#c0c0c0',
  سرمه‌ای: '#1e2a5a', آبی: '#1565c0', فیروزه‌ای: '#26c6da', سبز: '#2e7d32',
  قرمز: '#c62828', صورتی: '#ec407a', بنفش: '#6a1b9a', زرد: '#f9a825',
  نارنجی: '#ef6c00', قهوه‌ای: '#6d4c41', طلایی: '#d4af37', کرمی: '#f0e6d2',
};

export interface CardItem {
  slug: string;
  title: string;
  priceRial: number | string;
  price?: string | null;
  oldPriceRial?: number | string | null;
  available?: number;
  brand?: string | null;
  imageUrl?: string | null;
  imageCardUrl?: string | null;
  imagePlaceholder?: string | null;
  variantId?: string | null;
  rating?: number | null;
  isNew?: boolean;
  discountPercent?: number | null;
  availableQty?: number;
  colours?: string[];
}

export function ProductCard({ item }: { item: CardItem }) {
  const rial = Number(item.priceRial);
  const oldRial = item.oldPriceRial ? Number(item.oldPriceRial) : 0;
  const off = oldRial > rial ? Math.round(((oldRial - rial) / oldRial) * 100) : 0;
  const out = (item.available ?? item.availableQty ?? 0) === 0;
  const offPercent = off > 0 ? off : item.discountPercent && item.discountPercent > 0 ? item.discountPercent : 0;
  const qty = item.availableQty ?? item.available;
  const lowStock = qty != null && qty > 0 && qty <= LOW_STOCK_AT;

  return (
    <div className="card-p">
      <Link href={`/products/${item.slug}`} aria-label={item.title}>
        <div className="card-p__media">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="card-p__img"
              src={item.imageCardUrl ?? item.imageUrl ?? ''}
              alt={item.title}
              loading="lazy"
              width={400}
              height={400}
              style={
                item.imagePlaceholder
                  ? { background: `center/cover no-repeat url(${item.imagePlaceholder})` }
                  : undefined
              }
            />
          ) : (
            <div className="card-p__ph">تصویر ندارد</div>
          )}
          <div className="card-p__badges">
            {offPercent > 0 ? <span className="card-p__badge num">{offPercent}٪</span> : null}
            {item.isNew ? <span className="card-p__badge card-p__badge--new">جدید</span> : null}
          </div>
        </div>
      </Link>

      <div className="card-p__body">
        <Link href={`/products/${item.slug}`}>
          <div className="card-p__title">{item.title}</div>
        </Link>

        <div className="card-p__meta">
          {item.rating ? (
            <span className="stars" aria-label={`امتیاز ${item.rating} از ۵`}>
              {[1, 2, 3, 4, 5].map((i) => (
                <IconStar key={i} size={11} filled={i <= Math.round(item.rating ?? 0)} />
              ))}
            </span>
          ) : <span className="card-p__meta-ph" aria-hidden>—</span>}
          {item.brand ? <span className="card-p__brand">{item.brand}</span> : <span className="card-p__brand card-p__brand--empty" aria-hidden>—</span>}
        </div>

        <div className="card-p__foot">
          <div className="card-p__price">
            <div className="price">
              <span className="price__value num">{item.price ?? toman(rial)}</span>
              <span className="price__unit">تومان</span>
              {oldRial > rial ? <span className="price__old num">{toman(oldRial)}</span> : null}
            </div>
            <div className={`card-p__stock ${out ? 'card-p__stock--out' : lowStock ? 'card-p__stock--low' : 'card-p__stock--ok'}`}>
              {out ? 'ناموجود' : lowStock ? `تنها ${qty} عدد` : qty !== undefined ? `${qty} عدد` : '\u00A0'}
            </div>
          </div>

          <div className="card-p__actions">
            {item.colours && item.colours.length > 0 ? (
              <div className="card-p__dots" aria-label={`رنگ‌ها: ${item.colours.join('، ')}`}>
                {item.colours.slice(0, 4).map((c) => (
                  <span key={c} className="card-p__dot" style={{ background: CARD_COLOURS[c] ?? '#e8e4dd' }} title={c} />
                ))}
                {item.colours.length > 4 ? <span className="card-p__dot-more">+{item.colours.length - 4}</span> : null}
              </div>
            ) : null}
            <div className="card-p__btns">
              {item.variantId && !out ? <QuickAdd variantId={item.variantId} title={item.title} /> : <QuickView slug={item.slug} />}
              {item.variantId ? <WishlistButton variantId={item.variantId} /> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
