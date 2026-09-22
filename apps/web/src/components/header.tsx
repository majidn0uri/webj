import Link from 'next/link';
import { getCart } from '@/lib/cart-actions';
import { AccountLink } from '@/components/storefront/account-link';

export async function Header() {
  return (
    <header
      className="sf-hdr-sticky"
    >
      <div className="page sf-flex sf-items-center sf-gap-4 sf-w-full" >
        <Link href="/" className="sf-hdr-brand">
          ست‌شاپ
        </Link>
        <nav className="sf-hdr-nav">
          <Link href="/">خانه</Link>
          <Link href="/#all">همه‌ی کالاها</Link>
        </nav>
        <div className="sf-flex sf-items-center sf-gap-2 sf-hdr-end" >
          <AccountLink />
          <CartIndicator />
        </div>
      </div>
    </header>
  );
}


/** نشانگرِ سبد — تعدادِ واقعی از سرور می‌آید، نه از حدسِ مرورگر */
async function CartIndicator() {
  let count = 0;
  try {
    const cart = await getCart();
    count = cart?.itemCount ?? 0;
  } catch {
    count = 0;
  }
  return (
    <Link href="/cart" className="badge badge--soft sf-badge-pill" >
      سبدِ خرید{count > 0 ? ` · ${count}` : ''}
    </Link>
  );
}
