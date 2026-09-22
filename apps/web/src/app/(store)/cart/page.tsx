import Link from 'next/link';
import { getCart, removeFromCart } from '@/lib/cart-actions';
import { api } from '@/lib/api';
import { faDigits, toman } from '@/lib/format';
import { currentShopper } from '@/lib/shopper-actions';
import { CheckoutForm } from '@/components/checkout-form';
import { CheckoutSteps } from '@/components/store/checkout-steps';
import { IconTrash } from '@/components/store/icons';

export const dynamic = 'force-dynamic';

/**
 * سبدِ خرید.
 *
 * یک قاعده‌ی مهم در این صفحه: هیچ چیز پنهان نمی‌شود. اگر قیمت از زمانِ
 * افزودن تغییر کرده باشد، همان‌جا با مبلغِ پیشین گفته می‌شود؛ اگر موجودی
 * کافی نباشد، پیش از پرداخت گفته می‌شود. پنهان‌کردنِ این دو، همان کاری
 * است که بیشترین شکایت را در فروشگاه‌هایِ بزرگ ساخته است.
 */
export default async function CartPage() {
  const cart = await getCart();
  const gateways = await api.gateways().then((r) => r.gateways).catch(() => []);
  const me = await currentShopper().catch(() => null);
  const items = cart?.items ?? [];
  const subtotal = Number(cart?.subtotalRial ?? 0);
  // نرخ از همان جایی می‌آید که سفارش با آن حساب می‌شود (تنظیماتِ پنل)، نه
  // از یک عددِ ثابتِ ۹٪ در این برگه. مدیر نرخ را در پنل عوض کند، همین‌جا هم
  // عوض می‌شود — و مهم‌تر: مبلغی که مشتری می‌بیند همان است که ثبت می‌شود.
  const vatPercent = cart?.vatPercent ?? 9;
  const tax = Math.round((subtotal * vatPercent) / 100);

  return (
    <div className="container-x sf-pt-1" >
      <nav className="crumbs" aria-label="مسیر">
        <Link href="/">خانه</Link>
        <span className="crumbs__sep">/</span>
        <span className="sf-color-500">سبدِ خرید</span>
      </nav>

      <h1 className="sect__title sf-mt-3 sf-mb-4" >
        سبدِ خرید
      </h1>

      {/* نوارِ مراحل: خریدار باید بداند کجاست و چقدر مانده. در راست‌چین،
          پیشروی از راست به چپ است — پس مرحله‌یِ «سبد» سمتِ راست می‌نشیند. */}
      <CheckoutSteps current="cart" />

      {items.length === 0 ? (
        <div
          className="empty sf-card-bordered"
          
        >
          <div className="empty__t">سبدِ شما خالی است</div>
          <p className="sf-mb-3">
            مدلِ گوشی‌تان را در صفحه‌ی نخست انتخاب کنید تا فقط کالاهایِ سازگار را ببینید.
          </p>
          <Link href="/" className="btn-p btn-p--primary">
            شروعِ خرید
          </Link>
        </div>
      ) : (
        <div className="sf-cart-grid">
          <div>
            {cart?.hasPriceChanges ? (
              <div
                style={{
                  padding: 'var(--st-3) var(--st-4)', marginBottom: 'var(--st-4)',
                  background: 'var(--st-accent-soft)', borderRadius: 'var(--st-r-sm)',
                  color: '#b45309', fontSize: '1.25rem', lineHeight: 2,
                  borderInlineStart: '3px solid var(--st-accent)',
                }}
              >
                قیمتِ برخی کالاها از زمانی که به سبد افزوده‌اید تغییر کرده است.
                مبلغِ تازه در زیر آمده؛ پیش از ثبت آن را بررسی کنید.
              </div>
            ) : null}

            {items.map((item) => (
              <div
                key={item.variantId}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--st-4)',
                  padding: 'var(--st-4) 0', borderBottom: '1px solid var(--st-100)',
                }}
              >
                <div>
                  <Link href={`/products/${item.productSlug}`} className="sf-font-semibold sf-text-md">
                    {item.title}
                  </Link>
                  <div className="sf-text-sm sf-color-500 sf-mt-1">
                    <span className="num">{item.sku}</span> · <span className="num">{item.quantity}</span> عدد
                  </div>

                  <div className="sf-flex sf-flex-wrap sf-gap-1 sf-mt-1">
                    {item.priceChanged ? (
                      <span className="tag tag--warn">
                        قیمت از <span className="num">{toman(item.priceAtAddRial)}</span> تغییر کرد
                      </span>
                    ) : null}
                    {!item.enoughStock ? (
                      <span className="tag tag--err">
                        فقط <span className="num">{item.available}</span> عدد موجود است
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="sf-grid sf-gap-1" style={{ justifyItems: 'start' }}>
                  <div className="price">
                    <span className="price__value num">{toman(item.lineTotalRial)}</span>
                    <span className="price__unit">تومان</span>
                  </div>
                  <form action={removeFromCart}>
                    <input type="hidden" name="variantId" value={item.variantId} />
                    <button type="submit" className="btn-p btn-p--ghost sf-btn-sm" >
                      <IconTrash size={15} /> حذف
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>

          <aside className="sf-grid sf-gap-1">
            <div
              style={{
                border: '1px solid var(--st-200)', borderRadius: 'var(--st-r-md)',
                padding: 'var(--st-5)', background: 'var(--st-0)', boxShadow: 'var(--st-shadow-1)',
              }}
            >
              <div className="sf-flex sf-justify-between sf-mb-1 sf-text-base sf-color-600">
                <span>جمعِ کالاها</span>
                <span className="num">{toman(String(subtotal))} تومان</span>
              </div>
              <div className="sf-flex sf-justify-between sf-mb-1 sf-text-base sf-color-600">
                <span>مالیات بر ارزش افزوده ({faDigits(String(vatPercent))}٪)</span>
                <span className="num">{toman(String(tax))} تومان</span>
              </div>
              <div className="sf-cart-summary">
                <span>هزینه‌ی ارسال</span>
                <span className="sf-color-500">در مرحله‌ی بعد</span>
              </div>
              <div
                style={{
                  borderTop: '1px solid var(--st-200)', marginTop: 'var(--st-3)', paddingTop: 'var(--st-3)',
                  display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1.5rem',
                }}
              >
                <span>قابلِ پرداخت</span>
                <span className="num">{toman(String(subtotal + tax))} تومان</span>
              </div>
            </div>

            <CheckoutForm gateways={gateways} subtotalRial={subtotal} isPartner={me?.isPartner ?? false} />
          </aside>
        </div>
      )}
    </div>
  );
}
