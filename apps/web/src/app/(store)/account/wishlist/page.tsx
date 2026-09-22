import Link from 'next/link';
import { currentShopper, shopperWishlist, removeFromWishlist } from '@/lib/shopper-actions';
import { AccountShell } from '@/components/store/account-shell';
import { toman } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function WishlistPage() {
  return (
    <AccountShell active="wishlist" next="/account/wishlist">
      <WishlistContent />
    </AccountShell>
  );
}

async function WishlistContent() {
  const items = await shopperWishlist();

  return (
    <>
      <div className="acct__head">
        <h1 className="acct__title">علاقه‌مندی‌ها</h1>
        <p className="acct__sub">کالاهایی که نشان کرده‌اید</p>
      </div>

      {items.length === 0 ? (
        <div className="acct__empty">
          <div className="acct__empty-icon" aria-hidden>❤️</div>
          <div className="acct__empty-title">چیزی نشان نکرده‌اید</div>
          <p className="acct__empty-desc">
            در صفحه‌ی هر کالا، «نشان کردن» را بزنید تا اینجا بماند.
          </p>
          <Link href="/" className="btn-p btn-p--primary">رفتن به فروشگاه</Link>
        </div>
      ) : (
        <div className="acct__wishlist-grid">
          {items.map((it) => (
            <div key={it.variantId} className="acct__wish-card">
              <Link href={`/products/${it.slug}`}>
                {it.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="acct__wish-img" src={it.imageUrl} alt={it.title} loading="lazy" />
                ) : (
                  <div className="acct__wish-img" style={{ display: 'grid', placeItems: 'center', color: 'var(--st-400)', fontSize: '1.2rem' }}>
                    تصویر ندارد
                  </div>
                )}
              </Link>
              <div className="acct__wish-body">
                <Link href={`/products/${it.slug}`} className="acct__wish-title">
                  {it.title}
                </Link>
                {it.variantTitle ? (
                  <div className="acct__wish-variant">{it.variantTitle}</div>
                ) : null}
                <div className="acct__wish-foot">
                  <span className="acct__wish-price num">
                    {it.priceRial ? toman(it.priceRial) : '—'}
                    <span style={{ fontSize: '1.1rem', fontWeight: 500, color: 'var(--st-500)', marginInlineStart: 4 }}>تومان</span>
                  </span>
                  <span className={`acct__wish-stock ${it.inStock ? 'acct__wish-stock--in' : 'acct__wish-stock--out'}`}>
                    {it.inStock ? '✓ موجود' : '✕ ناموجود'}
                  </span>
                </div>
                <form action={removeFromWishlist} className="sf-mt-1">
                  <input type="hidden" name="variantId" value={it.variantId} />
                  <button className="btn-p btn-p--outline" type="submit" style={{ width: '100%', fontSize: '1.2rem', height: 38 }}>
                    حذف از علاقه‌مندی‌ها
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}