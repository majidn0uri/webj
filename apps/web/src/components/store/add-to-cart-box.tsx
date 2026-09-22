'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addToCart } from '@/lib/cart-actions';
import { toman } from '@/lib/format';
import { IconCart } from './icons';
import { ColourSwatches, type Swatch } from './colour-swatches';

interface V {
  id: string;
  sku: string;
  priceRial: number;
  available: number;
  color: string | null;
}

/**
 * جعبه‌ی خرید در صفحه‌ی کالا.
 *
 * سه تصمیمِ آگاهانه:
 *  ۱) اگر کالا یک تنوع دارد، انتخابگر نمایش داده نمی‌شود — پرسیدنِ
 *     «کدام رنگ؟» وقتی رنگی نیست، فقط تردید می‌سازد.
 *  ۲) تعداد با محدودیتِ موجودی است: بیشتر از موجودی را نمی‌توان خواست،
 *     تا جایی برای «پس از خرید تمام شد» باقی نماند.
 *  ۳) موجودیِ نمایش‌داده‌شده همان عددِ واقعیِ انبار است. رزرو در لحظه‌ی
 *     تسویه انجام می‌شود، نه اینجا؛ بنابراین این عدد ممکن است پیش از
 *     پرداخت تغییر کند — و سامانه در آن لحظه صادقانه اطلاع می‌دهد.
 */
/**
 * `swatches` از بیرون می‌آید (برگه آن را از کارساز می‌گیرد) چون رنگ‌ها را
 * باید بتوان بی‌بارگیریِ دوباره‌یِ کلِ برگه به‌روز کرد — مثلاً پس از آنکه
 * خریدار مدلِ گوشی‌اش را برگزید و تنوعِ هر رنگ عوض شد.
 *
 * `onVariantChange` به برگه می‌گوید تنوع عوض شده است تا تصویر و قیمت با رنگ
 * همراه شوند؛ بی‌آن، خریدار رنگی را می‌زند و عکسِ رنگِ دیگر را می‌بیند.
 */
export function AddToCartBox({
  variants,
  swatches = [],
  onVariantChange,
  value,
}: {
  variants: V[];
  swatches?: Swatch[];
  onVariantChange?: (variantId: string) => void;
  /** اگر داده شود، برگزیده از بیرون است (برایِ هماهنگی با نگاره) */
  value?: string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState(variants[0]?.id ?? '');
  const [qty, setQty] = useState(1);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  const chosen = value ?? picked;
  const current = variants.find((v) => v.id === chosen) ?? variants[0];
  if (!current) return <p className="tag tag--err">این کالا در حالِ حاضر قابلِ خرید نیست.</p>;

  const out = current.available <= 0;

  function add() {
    const data = new FormData();
    data.set('variantId', current.id);
    data.set('quantity', String(qty));
    startTransition(async () => {
      await addToCart(data);
      setDone(true);
      router.refresh();
      setTimeout(() => setDone(false), 2500);
    });
  }

  return (
    <div>
      {swatches.length > 1 ? (
        <div className="sf-mb-3">
          <ColourSwatches
            swatches={swatches}
            selectedVariantId={current.id}
            onSelect={(id) => {
              setPicked(id);
              setQty(1);
              onVariantChange?.(id);
            }}
          />
        </div>
      ) : variants.length > 1 ? (
        <div className="sf-mb-3">
          <div className="sf-text-base sf-font-bold sf-mb-1">
            تنوع را انتخاب کنید
          </div>
          <div className="sf-flex sf-flex-wrap sf-gap-1">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                className="chip"
                aria-pressed={v.id === current.id}
                onClick={() => {
                  setPicked(v.id);
                  setQty(1);
                  onVariantChange?.(v.id);
                }}
                disabled={v.available <= 0}
                style={v.available <= 0 ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
              >
                {v.color ?? v.sku} · <span className="num">{toman(v.priceRial)}</span> تومان
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="sf-flex sf-items-center sf-gap-1 sf-mb-1">
        <div className="qty-stepper">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="qty-btn"
            aria-label="کمتر"
          >
            −
          </button>
          <span className="num qty-num" >
            {qty}
          </span>
          <button
            type="button"
            onClick={() => setQty((q) => Math.min(Math.max(1, current.available), q + 1))}
            className="qty-btn"
            aria-label="بیشتر"
          >
            +
          </button>
        </div>
        <span style={{ fontSize: '1.25rem', color: out ? 'var(--st-err)' : 'var(--st-500)' }}>
          {out ? 'ناموجود' : `${current.available} عدد در انبار`}
        </span>
      </div>

      <button
        type="button"
        className="btn-p btn-p--primary btn-p--lg btn-p--block"
        onClick={add}
        disabled={pending || out}
      >
        <IconCart size={19} />
        {out ? 'ناموجود' : done ? 'به سبد افزوده شد ✓' : 'افزودن به سبدِ خرید'}
      </button>

      <p className="sf-text-sm sf-color-500 sf-line-height-2">
        موجودی هنگامِ تسویه به‌صورتِ اتمیک رزرو می‌شود؛ سفارشی که پرداخت شود،
        به‌دلیلِ اتمامِ کالا لغو نمی‌گردد.
      </p>
    </div>
  );
}
