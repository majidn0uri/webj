'use client';

import { useActionState, useState, useEffect } from 'react';
import { checkout } from '@/lib/cart-actions';
import type { GatewayOption } from '@/lib/api';
import { CouponBox } from '@/components/store/coupon-box';
import { CheckoutSteps } from '@/components/store/checkout-steps';
import { ShamsiDatePicker } from '@/components/shamsi-date-picker';

type State = { error?: string; orderNo?: string; orderId?: string } | null;

interface ShippingOpt {
  methodKey: string;
  methodLabel: string;
  city: string;
  costRial: string;
  costToman: string;
  etaDays: number;
}

export function CheckoutForm({
  gateways = [],
  subtotalRial = 0,
  isPartner = false,
}: {
  gateways?: GatewayOption[];
  subtotalRial?: string | number;
  isPartner?: boolean;
}) {
  const [selected, setSelected] = useState<string>(
    gateways.find((g) => g.recommended)?.key ?? gateways[0]?.key ?? 'sandbox',
  );
  const [shippingOpts, setShippingOpts] = useState<ShippingOpt[]>([]);
  const [selectedShipping, setSelectedShipping] = useState<string>('');
  const [cityInput, setCityInput] = useState('');
  const [shippingLoading, setShippingLoading] = useState(false);
  const [paymentType, setPaymentType] = useState<string>('online');

  const [state, formAction, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    formData.set('shippingMethodKey', selectedShipping);
    const opt = shippingOpts.find((o) => o.methodKey === selectedShipping);
    if (opt) formData.set('shippingRial', opt.costRial);
    formData.set('paymentMethod', paymentType);
    return await checkout(formData, selected);
  }, null);

  // جستجوی روش ارسال وقتی شهر وارد شد
  useEffect(() => {
    if (cityInput.trim().length < 2) { setShippingOpts([]); return; }
    const timer = setTimeout(async () => {
      setShippingLoading(true);
      try {
        const res = await fetch(`/api/shop/shipping-options?city=${encodeURIComponent(cityInput)}`);
        const data = await res.json();
        setShippingOpts(data.options ?? []);
        if (data.options?.length && !selectedShipping) {
          setSelectedShipping(data.options[0].methodKey);
        }
      } catch { /* */ }
      setShippingLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [cityInput]);

  // پس از موفقیت: لینک فاکتور
  if (state?.orderNo) {
    return (
      <div className="card sf-p-4">
        <h2 className="sf-mb-1 sf-text-lg sf-color-ok">سفارش ثبت شد</h2>
        <p className="sf-mb-3 sf-color-600">
          شماره‌ی سفارشِ شما <span className="num">{state.orderNo}</span> است.
          موجودیِ این سفارش برای شما نگه داشته شده تا پرداخت را انجام دهید.
        </p>
        {state.error ? (
          <p className="sf-mb-3 sf-color-danger sf-text-sm">{state.error}</p>
        ) : null}
        <div className="sf-flex sf-flex-wrap sf-gap-1">
          <a className="btn btn--primary" href="/account/orders">مشاهده‌ی سفارش‌ها</a>
          {state.orderId ? (
            <a
              className="btn btn--ghost"
              href={`/api/exports/orders/${state.orderId}/invoice.pdf`}
              target="_blank"
            >
              📄 دانلود فاکتور
            </a>
          ) : null}
          <a className="btn btn--ghost" href="/">بازگشت به فروشگاه</a>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="card sf-card-grid">
      <CheckoutSteps current="info" />

      <h2 className="sf-mb-0 sf-text-lg">تکمیلِ اطلاعات</h2>

      {isPartner ? (
        <fieldset className="sf-grid sf-gap-1" style={{ margin: 0, padding: 0, border: 'none' }}>
          <legend className="sf-text-sm sf-mb-1">نحوه پرداخت (همکار)</legend>
          {[
            { key: 'online', label: 'پرداخت آنلاین' },
            { key: 'credit', label: 'خرید نسیه (به حساب بدهکار)' },
            { key: 'cheque', label: 'پرداخت با چک' },
          ].map((p) => (
            <label
              key={p.key}
              className="card sf-checkout-label-card"
              style={{ borderColor: paymentType === p.key ? 'var(--c-brand)' : 'var(--c-border)', background: paymentType === p.key ? 'var(--c-surface-2)' : 'var(--c-surface)' }}
            >
              <input
                type="radio"
                name="paymentTypeRadio"
                value={p.key}
                checked={paymentType === p.key}
                onChange={() => setPaymentType(p.key)}
                style={{ accentColor: 'var(--c-brand)' }}
              />
              <span className="sf-text-sm">{p.label}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {isPartner && paymentType === 'cheque' ? (
        <div className="sf-grid sf-gap-1" style={{ border: '1px solid var(--c-border)', borderRadius: '0.5rem', padding: '1rem' }}>
          <label className="sf-grid sf-gap-1">
            <span className="sf-text-sm">شماره چک</span>
            <input name="checkNo" required className="field num" placeholder="شماره چک" />
          </label>
          <label className="sf-grid sf-gap-1">
            <span className="sf-text-sm">شناسه صیاد (۱۶ رقم انگلیسی)</span>
            <input name="checkSayadNo" required inputMode="numeric" pattern="[0-9]{16}" minLength={16} maxLength={16} className="field num" />
          </label>
          <label className="sf-grid sf-gap-1">
            <span className="sf-text-sm">بانک</span>
            <input name="checkBank" required className="field" placeholder="نام بانک" />
          </label>
          <label className="sf-grid sf-gap-1">
            <span className="sf-text-sm">تاریخ سررسید</span>
            <ShamsiDatePicker variant="store" name="checkDueDate" format="iso" required />
          </label>
        </div>
      ) : null}

      {gateways.length > 1 && paymentType === 'online' ? (
        <fieldset className="sf-grid sf-gap-1" style={{ margin: 0, padding: 0, border: 'none' }}>
          <legend className="sf-text-sm sf-mb-1">روشِ پرداخت</legend>
          {gateways.map((g) => (
            <label
              key={g.key}
              className="card sf-checkout-label-card"
              style={{ borderColor: selected === g.key ? 'var(--c-brand)' : 'var(--c-border)', background: selected === g.key ? 'var(--c-surface-2)' : 'var(--c-surface)' }}
            >
              <input
                type="radio"
                name="gateway"
                value={g.key}
                checked={selected === g.key}
                onChange={() => setSelected(g.key)}
                style={{ accentColor: 'var(--c-brand)' }}
              />
              <span className="sf-text-sm">
                {g.label}
                {g.key === 'sandbox' ? (
                  <span className="sf-checkout-hint">فقط برای آزمایش؛ پولی جابه‌جا نمی‌شود</span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <CouponBox subtotalRial={subtotalRial ?? 0} />

      <label className="sf-grid sf-gap-1">
        <span className="sf-text-sm">نامِ گیرنده</span>
        <input name="customerName" required minLength={3} className="field" placeholder="مثال: سارا احمدی" />
      </label>

      <label className="sf-grid sf-gap-1">
        <span className="sf-text-sm">شماره‌ی موبایل</span>
        <input
          name="customerMobile" required inputMode="numeric" pattern="09[0-9]{9}"
          className="field num" placeholder="۰۹۱۲۳۴۵۶۷۸۹"
        />
      </label>

      <label className="sf-grid sf-gap-1">
        <span className="sf-text-sm">شهر</span>
        <input
          name="city"
          className="field"
          placeholder="مثال: تهران"
          value={cityInput}
          onChange={(e) => setCityInput(e.target.value)}
        />
      </label>

      {/* انتخاب روش ارسال */}
      {cityInput.trim().length >= 2 ? (
        <fieldset className="sf-grid sf-gap-1" style={{ margin: 0, padding: 0, border: 'none' }}>
          <legend className="sf-text-sm sf-mb-1">
            روش ارسال {shippingLoading ? '…' : ''}
          </legend>
          {shippingOpts.length === 0 && !shippingLoading ? (
            <p className="sf-text-xs sf-color-400">برای این شهر تعرفه‌ای تعریف نشده. هزینه ارسال جداگانه محاسبه می‌شود.</p>
          ) : null}
          {shippingOpts.map((o) => (
            <label
              key={o.methodKey}
              className="card sf-checkout-label-card"
              style={{ borderColor: selectedShipping === o.methodKey ? 'var(--c-brand)' : 'var(--c-border)', background: selectedShipping === o.methodKey ? 'var(--c-surface-2)' : 'var(--c-surface)' }}
            >
              <input
                type="radio"
                name="shippingMethod"
                value={o.methodKey}
                checked={selectedShipping === o.methodKey}
                onChange={() => setSelectedShipping(o.methodKey)}
                style={{ accentColor: 'var(--c-brand)' }}
              />
              <span className="sf-text-sm">
                {o.methodLabel} — <span className="num">{o.costToman}</span> تومان
                <span className="sf-checkout-hint">تحویل {o.etaDays} روزه</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <input type="hidden" name="shippingMethodKey" value={selectedShipping} />
      <input type="hidden" name="shippingRial" value={shippingOpts.find((o) => o.methodKey === selectedShipping)?.costRial ?? '0'} />

      <label className="sf-grid sf-gap-1">
        <span className="sf-text-sm">نشانی</span>
        <textarea name="shippingAddress" required minLength={10} rows={3} className="field" placeholder="خیابان، پلاک، واحد" />
      </label>

      {state?.error ? (
        <p className="sf-mb-0 sf-color-danger sf-text-sm">{state.error}</p>
      ) : null}

      <button type="submit" className="btn btn--primary btn--block" disabled={pending}>
        {pending ? 'در حالِ ثبت…' : 'ثبتِ سفارش و رفتن به پرداخت'}
      </button>

      <p className="sf-mb-0 sf-text-xs sf-color-400">
        تا پیش از ثبتِ سفارش هیچ مبلغی از شما کسر نمی‌شود. پس از ثبت، موجودیِ کالا برای
        شما رزرو می‌شود و دیگر به دلیلِ «تمام شدنِ کالا» لغو نخواهد شد.
      </p>
    </form>
  );
}