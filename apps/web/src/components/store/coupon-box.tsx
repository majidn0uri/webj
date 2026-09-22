'use client';

import { useState } from 'react';

import { previewCouponAction } from '@/lib/coupon-actions';
import { faDigits, toman } from '@/lib/format';

/**
 * کادرِ کدِ تخفیف در سبد.
 *
 * سه چیز اینجا تعیین می‌کند که تجربه خوب است یا نه:
 *
 *   ۱. **بازخوردِ پیش از پرداخت**: مشتری باید پیش از رفتن به درگاه بداند
 *      چقدر تخفیف می‌گیرد. اگر نخستین جایی که می‌فهمد کد کار نکرده، صفحه‌یِ
 *      بازگشت از بانک باشد، دیگر برنمی‌گردد.
 *   ۲. **پیامِ راستین**: «کد نامعتبر است» هیچ نمی‌گوید. اینکه بگوییم «برایِ
 *      خریدهایِ بالایِ ۵۰۰ هزار تومان است» یعنی مشتری می‌فهمد چه کند — حتی
 *      گاهی بیشتر می‌خرد تا به کد برسد، که همان هدفِ کمپین است.
 *   ۳. **کد پنهان در فرم**: کدِ پذیرفته‌شده در یک فیلدِ پنهان می‌نشیند تا
 *      همراهِ تسویه برود؛ اگر به متغیرِ react اکتفا کنیم و صفحه بازخوانی
 *      شود، کد گم می‌شود و مشتری بی‌تخفیف می‌پردازد.
 */

interface Props {
  /** مبلغِ سبد به ریال، برایِ نمایشِ تخفیفِ برآوردی */
  subtotalRial: string | number;
}

type State =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'ok'; code: string; title: string; text: string }
  | { phase: 'error'; message: string };

export function CouponBox({ subtotalRial }: Props) {
  const [code, setCode] = useState('');
  const [state, setState] = useState<State>({ phase: 'idle' });

  const applied = state.phase === 'ok' ? state.code : '';

  async function check() {
    const value = code.trim();
    if (!value) {
      setState({ phase: 'error', message: 'کدِ تخفیف را بنویسید.' });
      return;
    }
    setState({ phase: 'checking' });
    const res = await previewCouponAction(value);
    if (!res.ok) {
      setState({ phase: 'error', message: res.message });
      return;
    }
    const data = res.data;
    // برآوردِ تخفیف برایِ نمایش (حسابِ قطعی در کارساز و رویِ ردیف‌هاست)
    const subtotal = BigInt(data.subtotalRial || '0');
    let estimate = 0n;
    if (data.kind === 'percent' && data.valueBp != null) {
      estimate = (subtotal * BigInt(data.valueBp)) / 10000n;
      if (data.maxDiscountRial && estimate > BigInt(data.maxDiscountRial)) {
        estimate = BigInt(data.maxDiscountRial);
      }
    } else if (data.kind === 'fixed' && data.valueRial) {
      estimate = BigInt(data.valueRial);
      if (estimate > subtotal) estimate = subtotal;
    }
    // کدِ دسته‌ای/کالایی ممکن است همه‌یِ سبد را نگیرد؛ پیام را محتاط نگه می‌داریم
    const text =
      estimate > 0n
        ? data.appliesTo === 'all'
          ? `تقریباً ${faDigits(toman(estimate.toString()))} تومان تخفیف`
          : 'کد پذیرفته شد؛ مبلغِ قطعی پس از بررسیِ کالاها در سفارش می‌آید'
        : 'کد پذیرفته شد';
    setState({ phase: 'ok', code: data.code, title: data.title, text });
  }

  return (
    <div className="coupon">
      {/* کدِ پذیرفته‌شده همراهِ فرمِ تسویه می‌رود (cart-actions از همین نام می‌خواند) */}
      <input type="hidden" name="couponCode" value={applied} />

      <div className="coupon__row">
        <input
          className="coupon__input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="کدِ تخفیف"
          dir="ltr"
          aria-label="کدِ تخفیف"
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void check();
            }
          }}
        />
        <button
          type="button"
          className="coupon__btn"
          onClick={() => void check()}
          disabled={state.phase === 'checking'}
        >
          {state.phase === 'checking' ? '…' : 'اعمال'}
        </button>
        {state.phase === 'ok' ? (
          <button
            type="button"
            className="coupon__clear"
            onClick={() => {
              setCode('');
              setState({ phase: 'idle' });
            }}
          >
            حذف
          </button>
        ) : null}
      </div>

      {state.phase === 'ok' ? (
        <p className="coupon__msg coupon__msg--ok">
          {state.title} — {state.text}
        </p>
      ) : null}
      {state.phase === 'error' ? (
        <p className="coupon__msg coupon__msg--err">{state.message}</p>
      ) : null}

      {/* زیرِ مبلغِ سبد نوشته می‌شود که تخفیف پایه‌یِ مالیات را هم می‌کاهد */}
      {Number(subtotalRial) > 0 && state.phase === 'ok' ? (
        <p className="coupon__hint">
          تخفیف پیش از مالیات اعمال می‌شود؛ پس ارزش‌افزوده هم کمتر می‌شود.
        </p>
      ) : null}
    </div>
  );
}
