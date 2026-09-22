'use client';

import { useState } from 'react';
import { tomanRial } from '@/lib/format';

/**
 * صفحه‌ی شبیه‌سازی‌شده‌ی بانک.
 *
 * طراحی‌اش عمداً شبیهِ درگاه‌های ایرانی است (مبلغ، شماره کارت، رمز، دکمه‌های
 * پرداخت/انصراف) تا تجربه برای توسعه‌دهنده واقعی باشد، اما هیچ تماسی با شبکه‌ی
 * بانکی نمی‌گیرد. رنگ و فونت همه از متغیرهایِ خودِ قالب می‌آیند تا با بقیه‌یِ
 * سامانه یک‌دست باشد.
 */
export function SandboxBankForm({
  authority,
  amountRial,
  orderNo,
  status,
}: {
  authority: string;
  amountRial: string | null;
  orderNo: string | null;
  /** وضعیتِ فعلیِ ردیفِ پرداخت — اگر «در انتظار» نباشد، دکمه‌ها بی‌اثرند */
  status: string | null;
}) {
  const settled = status !== null && status !== 'pending';
  const [busy, setBusy] = useState<null | 'paid' | 'cancelled' | 'failed'>(null);
  const [card, setCard] = useState('6037991234561234');
  const [pin, setPin] = useState('');

  async function decide(decision: 'paid' | 'cancelled' | 'failed') {
    setBusy(decision);
    const res = await fetch(`/api/payments/sandbox/${encodeURIComponent(authority)}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    }).catch(() => null);

    if (!res || !res.ok) {
      setBusy(null);
      alert('ثبتِ نتیجه ناموفق بود؛ دوباره تلاش کنید.');
      return;
    }

    // دقیقاً همان کاری را می‌کنیم که بانک می‌کند: مشتری را به نشانیِ بازگشت
    // می‌فرستیم، با همان پارامترها
    window.location.href = `/pay/callback?Authority=${encodeURIComponent(authority)}&Status=${
      decision === 'paid' ? 'OK' : 'NOK'
    }`;
  }

  return (
    <div className="page" style={{ maxWidth: 460, marginInline: 'auto' }}>
      <div className="sbank">
        <div className="sbank__head">
          <span className="sbank__logo" aria-hidden>
            🏦
          </span>
          <div>
            <p className="sbank__title">درگاهِ آزمایشیِ ست‌شاپ</p>
            <p className="sbank__note">
              این یک شبیه‌ساز است؛ هیچ پولی جابه‌جا نمی‌شود و هیچ ارتباطی با شبکه‌ی بانکی برقرار نمی‌گردد.
            </p>
          </div>
        </div>

        <dl className="sbank__facts">
          <div>
            <dt>مبلغ</dt>
            <dd>{amountRial ? `${tomanRial(amountRial)} تومان` : '—'}</dd>
          </div>
          {orderNo ? (
            <div>
              <dt>شماره‌ی سفارش</dt>
              <dd className="num">{orderNo}</dd>
            </div>
          ) : null}
          <div>
            <dt>شناسه‌ی تراکنش</dt>
            <dd className="num sf-text-xs" >{authority}</dd>
          </div>
        </dl>

        <label className="sbank__field">
          <span>شماره کارت</span>
          <input
            className="field num"
            inputMode="numeric"
            value={card}
            onChange={(e) => setCard(e.target.value.replace(/\D/g, '').slice(0, 16))}
            dir="ltr"
          />
        </label>

        <label className="sbank__field">
          <span>رمزِ دوم</span>
          <input
            className="field num"
            inputMode="numeric"
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
            dir="ltr"
          />
        </label>

        {settled ? (
          <p className="sbank__settled">
            این تراکنش پیش‌تر با وضعیتِ «{status === 'success' ? 'موفق' : 'ناموفق'}» ثبت شده است؛
            تغییرِ نتیجه دیگر ممکن نیست (تأییدِ دوباره بی‌اثر است).
          </p>
        ) : null}

        <div className="sbank__actions">
          <button
            className="btn btn--primary btn--block"
            disabled={busy !== null || settled}
            onClick={() => void decide('paid')}
          >
            {busy === 'paid' ? 'در حالِ انتقال…' : 'پرداختِ موفق'}
          </button>
          <button className="btn btn--ghost btn--block" disabled={busy !== null || settled} onClick={() => void decide('failed')}>
            شبیه‌سازیِ خطا
          </button>
          <button className="btn btn--ghost btn--block" disabled={busy !== null || settled} onClick={() => void decide('cancelled')}>
            انصراف
          </button>
        </div>
      </div>

      <style>{`
        .sbank { border: 1px solid var(--c-border); border-radius: var(--r-md); background: var(--c-surface); padding: var(--s-5); }
        .sbank__head { display: flex; gap: var(--s-3); align-items: flex-start; padding-bottom: var(--s-4); border-bottom: 1px dashed var(--c-border-strong); }
        .sbank__logo { font-size: 28px; line-height: 1; }
        .sbank__title { margin: 0 0 4px; font-weight: 700; }
        .sbank__note { margin: 0; font-size: var(--fs-xs); color: var(--c-text-3); line-height: 1.9; }
        .sbank__facts { margin: var(--s-4) 0; display: grid; gap: var(--s-2); }
        .sbank__facts > div { display: flex; justify-content: space-between; gap: var(--s-3); font-size: var(--fs-sm); }
        .sbank__facts dt { color: var(--c-text-3); }
        .sbank__facts dd { margin: 0; font-weight: 600; }
        .sbank__field { display: grid; gap: var(--s-2); margin-bottom: var(--s-4); font-size: var(--fs-sm); }
        .sbank__actions { display: grid; gap: var(--s-2); margin-top: var(--s-2); }
        .sbank__settled { margin: var(--s-3) 0 0; padding: var(--s-3); font-size: var(--fs-xs); line-height: 1.9;
                          border: 1px dashed var(--c-border-strong); border-radius: var(--r-sm);
                          color: var(--c-text-3); background: var(--c-surface-2, transparent); }
      `}</style>
    </div>
  );
}
