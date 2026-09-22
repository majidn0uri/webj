import Link from 'next/link';
import { api } from '@/lib/api';
import { tomanRial } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * نتیجه‌ی پرداخت.
 *
 * سه اصل در این صفحه رعایت شده:
 *  ۱) شماره‌ی پیگیری و مبلغ دقیق نشان داده می‌شود — چیزی که مشتری برای پیگیری
 *     لازم دارد، نه فقط یک «موفق بود»؛
 *  ۲) اگر پرداخت ناموفق بود، سفارش از بین نرفته: موجودی هنوز رزرو است و راهِ
 *     دوم (درگاهِ دیگر) پیشنهاد می‌شود؛
 *  ۳) اگر مبلغی کسر شده باشد، صریحاً گفته می‌شود که برمی‌گردد و چه زمانی.
 */
export default async function PaymentResultPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; order?: string; outcome?: string; error?: string; cancelled?: string }>;
}) {
  const { id, order, outcome, error, cancelled } = await searchParams;

  const payment = id ? await api.paymentStatus(id).catch(() => null) : null;
  const failed = outcome === 'failed' || !!error || cancelled === '1';
  const success = outcome === 'success' || outcome === 'already' || payment?.status === 'success';

  return (
    <div className="page sf-centered-page" >
      <div className="card" style={{ padding: 'var(--s-7) var(--s-5)' }}>
        <div className="mark" data-kind={success ? 'ok' : 'bad'}>
          {success ? '✓' : '!'}
        </div>

        <h1 style={{ margin: 'var(--s-4) 0 var(--s-2)', fontSize: 'var(--fs-2xl)' }}>
          {success ? 'پرداخت با موفقیت انجام شد' : failed ? 'پرداخت انجام نشد' : 'در حالِ بررسیِ پرداخت'}
        </h1>

        {payment ? (
          <p className="sf-mb-4 sf-color-600 sf-text-sm">
            سفارشِ <span className="num">{payment.orderNo}</span> · مبلغ{' '}
            <b>{tomanRial(payment.amountRial)} تومان</b>
          </p>
        ) : order ? (
          <p className="sf-mb-4 sf-color-600 sf-text-sm">
            سفارشِ <span className="num">{order}</span>
          </p>
        ) : null}

        {success ? (
          <dl className="facts">
            {payment?.refId ? (
              <div className="facts__row">
                <dt>شماره‌ی پیگیری</dt>
                <dd className="num">{payment.refId}</dd>
              </div>
            ) : null}
            {payment?.cardPanMasked ? (
              <div className="facts__row">
                <dt>کارتِ پرداخت‌کننده</dt>
                <dd className="num">{payment.cardPanMasked}</dd>
              </div>
            ) : null}
            <div className="facts__row">
              <dt>وضعیت</dt>
              <dd>{payment?.status === 'success' ? 'تأیید شده' : 'در انتظارِ تأیید'}</dd>
            </div>
          </dl>
        ) : (
          <p className="sf-mb-4 sf-color-600 sf-text-sm sf-line-height-2">
            {payment?.message
              ? // پیامِ دقیقِ درگاه (مثلاً «انصراف از پرداخت» یا «موجودی کافی نیست»)
                // از کلماتِ کلی بهتر است: مشتری می‌فهمد دقیقاً چه شده
                payment.message
              : cancelled === '1'
                ? 'شما از پرداخت انصراف دادید. سفارش شما لغو نشده و موجودیِ آن همچنان برای‌تان نگه داشته شده است.'
                : 'پرداخت قطعی نشد. هیچ مبلغی از حساب شما کسر نشده است؛ اگر کسر شده باشد، بانک آن را تا پایانِ روزِ کاری برمی‌گرداند.'}
            <br />
            می‌توانید دوباره تلاش کنید یا با درگاهِ دیگر پرداخت کنید.
          </p>
        )}

        <div className="sf-flex sf-flex-wrap sf-gap-1 sf-text-center">
          <Link className="btn btn--primary" href="/">
            بازگشت به فروشگاه
          </Link>
          {!success ? <Link className="btn btn--ghost" href="/cart">تلاشِ دوباره</Link> : null}
        </div>
      </div>

      <style>{`
        .mark {
          width: 64px; height: 64px; margin: 0 auto;
          border-radius: 50%; display: grid; place-items: center;
          font-size: 30px; font-weight: 700; color: #fff;
        }
        .mark[data-kind='ok'] { background: var(--c-success, #1f9254); }
        .mark[data-kind='bad'] { background: var(--c-danger, #b3261e); }
        .facts {
          margin: 0 auto var(--s-5); max-width: 420px; text-align: right;
          border: 1px solid var(--c-border); border-radius: var(--r-sm); overflow: hidden;
        }
        .facts__row { display: flex; justify-content: space-between; gap: var(--s-3);
                      padding: var(--s-3) var(--s-4); font-size: var(--fs-sm); }
        .facts__row + .facts__row { border-top: 1px solid var(--c-border); }
        .facts dt { color: var(--c-text-3); }
        .facts dd { margin: 0; font-weight: 600; }
      `}</style>
    </div>
  );
}
