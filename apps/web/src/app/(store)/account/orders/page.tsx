import Link from 'next/link';
import { currentShopper, shopperOrders } from '@/lib/shopper-actions';
import { AccountShell } from '@/components/store/account-shell';
import { toman } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** کلاسِ وضعیت بر اساسِ گروه */
function statusClass(status: string): string {
  if (['paid', 'confirmed', 'delivered'].includes(status)) return 'acct__order-status--paid';
  if (['processing', 'shipped'].includes(status)) return 'acct__order-status--processing';
  if (['cancelled', 'refunded'].includes(status)) return 'acct__order-status--cancelled';
  return 'acct__order-status--pending';
}

export default async function OrdersPage() {
  const me = await currentShopper();
  const orders = me ? await shopperOrders() : [];

  return (
    <AccountShell active="orders" next="/account/orders">
      <div className="acct__head">
        <h1 className="acct__title">سفارش‌ها</h1>
        <p className="acct__sub">رهگیری و تاریخچه‌ی خریدهایتان</p>
      </div>

      {orders.length === 0 ? (
        <div className="acct__empty">
          <div className="acct__empty-icon" aria-hidden>📦</div>
          <div className="acct__empty-title">هنوز سفارشی ثبت نکرده‌اید</div>
          <p className="acct__empty-desc">
            اگر پیش از ساختنِ حساب خرید کرده‌اید، سفارش‌هایی که با همین شماره ثبت شده‌اند اینجا دیده می‌شوند.
          </p>
          <Link href="/" className="btn-p btn-p--primary">شروعِ خرید</Link>
        </div>
      ) : (
        <div className="sf-grid sf-gap-1">
          {orders.map((o) => (
            <Link key={o.orderNo} href={`/account/orders/${o.orderNo}`} className="acct__order">
              <div className="acct__order-top">
                <div>
                  <span className="acct__order-no num">{o.orderNo}</span>
                  <span className="acct__order-date" style={{ marginInlineStart: 10 }}>
                    {o.createdAtShamsi}
                  </span>
                </div>
                <span className={`acct__order-status ${statusClass(o.status)}`}>
                  {o.statusLabel}
                </span>
              </div>
              <div className="acct__order-bottom">
                <span><span className="num">{o.itemCount}</span> کالا</span>
                <span className="acct__order-total num">{toman(o.totalRial)} تومان</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AccountShell>
  );
}