import Link from 'next/link';
import { currentShopper, shopperOrder } from '@/lib/shopper-actions';
import { AccountShell } from '@/components/store/account-shell';
import { toman } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function OrderDetailPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;

  return (
    <AccountShell active="orders" next={`/account/orders/${orderNo}`}>
      <OrderContent orderNo={orderNo} />
    </AccountShell>
  );
}

async function OrderContent({ orderNo }: { orderNo: string }) {
  const order = await shopperOrder(orderNo);

  if (!order) {
    return (
      <div className="acct__empty">
        <div className="acct__empty-icon" aria-hidden>🔍</div>
        <div className="acct__empty-title">این سفارش در حسابِ شما نیست</div>
        <p className="acct__empty-desc">سفارشی با این شماره پیدا نشد یا متعلق به حسابِ دیگری است.</p>
        <Link href="/account/orders" className="btn-p btn-p--outline">بازگشت به سفارش‌ها</Link>
      </div>
    );
  }

  const addr = (order.shippingAddress ?? {}) as Record<string, string | undefined>;
  const steps = order.timeline.length
    ? order.timeline
    : [{ fromStatus: null, toStatus: order.status, label: order.statusLabel, reason: null, createdAt: order.createdAt }];

  return (
    <>
      {/* نان */}
      <nav className="acct__crumbs" aria-label="مسیر">
        <Link href="/">خانه</Link>
        <span className="acct__crumbs-sep">/</span>
        <Link href="/account">حسابِ من</Link>
        <span className="acct__crumbs-sep">/</span>
        <Link href="/account/orders">سفارش‌ها</Link>
        <span className="acct__crumbs-sep">/</span>
        <span className="acct__crumbs-current num">{order.orderNo}</span>
      </nav>

      <div className="acct__head">
        <h1 className="acct__title">سفارش <span className="num">{order.orderNo}</span></h1>
        <p className="acct__sub">
          ثبت‌شده در {order.createdAtShamsi} · {order.statusLabel}
        </p>
      </div>

      {/* رهگیری */}
      <section className="acct__section">
        <h2 className="acct__section-title">
          <span className="acct__section-icon" aria-hidden>📍</span>
          رهگیریِ سفارش
        </h2>
        <ol className="acct__timeline">
          {steps.map((s, i) => {
            const isLast = i === steps.length - 1;
            return (
              <li key={`${s.toStatus}-${i}`} className="acct__timeline-item">
                <div className={`acct__timeline-dot${isLast ? ' acct__timeline-dot--current' : ''}`} />
                <div>
                  <div className="acct__timeline-label">{s.label}</div>
                  <div className="acct__timeline-time">
                    {new Date(s.createdAt).toLocaleString('fa-IR')}
                    {s.reason ? ` · ${s.reason}` : ''}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* اقلام */}
      <section className="acct__section">
        <h2 className="acct__section-title">
          <span className="acct__section-icon" aria-hidden>📦</span>
          کالاها
        </h2>
        <div className="acct__items">
          {order.items.map((it) => (
            <div key={it.variantId} className="acct__item">
              <span className="acct__item-title">{it.title || 'کالا'}</span>
              <span className="acct__item-price num">
                {it.quantity} × {toman(it.unitPriceRial)}
              </span>
            </div>
          ))}
        </div>
        <div className="acct__summary">
          <div className="acct__summary-row">
            <span className="acct__summary-label">جمعِ کالاها</span>
            <span className="num">{toman(order.subtotalRial)}</span>
          </div>
          {Number(order.discountRial) > 0 ? (
            <div className="acct__summary-row">
              <span className="acct__summary-label">تخفیف</span>
              <span className="acct__summary-discount num">− {toman(order.discountRial)}</span>
            </div>
          ) : null}
          <div className="acct__summary-row">
            <span className="acct__summary-label">مالیات بر ارزشِ افزوده</span>
            <span className="num">{toman(order.taxRial)}</span>
          </div>
          <div className="acct__summary-row">
            <span className="acct__summary-label">هزینه‌ی ارسال</span>
            <span className="num">{toman(order.shippingRial)}</span>
          </div>
          <div className="acct__summary-row acct__summary-row--total">
            <span>پرداختی</span>
            <span className="num">{toman(order.totalRial)} تومان</span>
          </div>
        </div>
      </section>

      {/* نشانی */}
      {addr.address || addr.city ? (
        <section className="acct__section">
          <h2 className="acct__section-title">
            <span className="acct__section-icon" aria-hidden>🏠</span>
            نشانیِ ارسال
          </h2>
          <div className="acct__address">
            {addr.receiverName ? (
              <div className="acct__address-name">
                {addr.receiverName}
                {addr.phone ? <> · <span className="num">{addr.phone}</span></> : null}
              </div>
            ) : null}
            <div>
              {[addr.province, addr.city, addr.address].filter(Boolean).join('، ') || '—'}
            </div>
            {addr.postalCode ? (
              <div className="acct__addr-meta">کدِ پستی: <span className="num">{addr.postalCode}</span></div>
            ) : null}
          </div>
          {order.customerNote ? (
            <p style={{ marginTop: 'var(--st-3)', color: 'var(--st-500)', fontSize: '1.2rem' }}>
              یادداشت: {order.customerNote}
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}