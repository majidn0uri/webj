'use client';

import { useEffect, useState } from 'react';

/**
 * سواچِ رنگ.
 *
 * چهار چیز اینجا از ظاهر مهم‌تر است:
 *
 *  ۱. **گردیِ رنگ تنها نشانه نیست، نشانی است**: اگر رنگی تصویرِ خودش را
 *     داشته باشد (عکسِ همان رنگ از همان کالا)، تصویر درونِ گردی می‌آید —
 *     چون «سرمه‌ایِ این قاب» را هیچ واژه‌ای به‌خوبیِ خودش نمی‌گوید.
 *  ۲. **رنگِ تمام‌شده پنهان نمی‌شود**: خط می‌خورد و می‌ماند. پنهان کردن یعنی
 *     خریدار گمان می‌برد آن رنگ اصلاً نیست؛ و از کسی که نداند چیزی هست،
 *     انتظارِ «خبرم کن» هم نمی‌توان داشت.
 *  ۳. **رنگِ برگزیده نامش را می‌گوید**: نوشتنِ «مشکی» زیرِ گردی، تردیدِ «این
 *     دقیقاً کدام رنگ است؟» را می‌بندد — و اشتباه در همین یک واژه است که
 *     کالا را برمی‌گرداند.
 *  ۴. **بی‌رنگ یعنی بی‌سواچ**: کالایی که رنگ ندارد (پاوربانک، گلس) نباید
 *     ردیفی از گردی‌هایِ خاکستری نشان دهد؛ همان فهرستِ ساده کافی است.
 */

export interface Swatch {
  name: string;
  hex: string;
  variantId: string;
  variantIds: string[];
  sku: string | null;
  priceRial: number;
  available: number;
  imageUrl: string | null;
  imageCardUrl: string | null;
  imageThumbUrl: string | null;
  placeholder: string | null;
  hasOwnImage: boolean;
  outOfStock: boolean;
}

/** آیا این رنگ روشن است؟ (برایِ رنگِ نوشته‌یِ رویِ گردی) */
function isLight(hex: string): boolean {
  const value = hex.replace('#', '');
  if (value.length !== 6) return false;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

export function ColourSwatches({
  swatches,
  selectedVariantId,
  onSelect,
}: {
  swatches: Swatch[];
  selectedVariantId: string;
  onSelect: (variantId: string) => void;
}) {
  const [active, setActive] = useState<string>(selectedVariantId);

  // اگر برگه از بیرون تغییر کرد (مثلاً پس از برگزیدنِ گوشی)، پیروی می‌کنیم
  useEffect(() => {
    setActive(selectedVariantId);
  }, [selectedVariantId]);

  if (swatches.length === 0) return null;

  // سواچِ برگزیده را از رویِ تنوع می‌سنجم، نه برعکس. چرا؟ چون یک رنگ می‌تواند
  // چند تنوع داشته باشد (مشکی برایِ S23 و برایِ ۱۳)، و سواچ تنها یکی از
  // آن‌ها را پیشنهاد می‌کند. اگر از سواچ به تنوع برویم، جعبه‌یِ خرید ممکن
  // است تنوعِ دیگری را نشان دهد و رنگِ برگزیده بی‌نام بماند — دقیقاً همان
  // ناهماهنگی‌ای که خریدار را به شک می‌اندازد.
  const activeSwatch =
    swatches.find((s) => s.variantId === active) ??
    swatches.find((s) => s.variantIds.includes(active)) ??
    swatches[0];
  const activeId = activeSwatch?.variantId ?? active;

  // کالایی که رنگ ندارد: سواچ بی‌معناست
  const onlyNameless = swatches.length === 1 && swatches[0]!.name === 'بدونِ رنگ';
  if (onlyNameless) return null;

  return (
    <div className="swatches" role="radiogroup" aria-label="رنگ">
      <div className="swatches__lead">
        رنگ:
        <span className="swatches__current">{activeSwatch?.name ?? ''}</span>
      </div>
      <div className="swatches__row">
        {swatches.map((swatch) => {
          const selected = swatch.variantId === activeId;
          return (
            <button
              key={swatch.name}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${swatch.name}${swatch.outOfStock ? ' (ناموجود)' : ''}`}
              title={`${swatch.name}${swatch.outOfStock ? ' — ناموجود' : ''}`}
              className={`swatch${selected ? ' swatch--on' : ''}${swatch.outOfStock ? ' swatch--out' : ''}`}
              onClick={() => {
                setActive(swatch.variantId);
                onSelect(swatch.variantId);
              }}
            >
              <span className="swatch__chip" style={{ background: swatch.hex }}>
                {swatch.imageThumbUrl || swatch.imageCardUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    className="swatch__img"
                    src={swatch.imageThumbUrl ?? swatch.imageCardUrl ?? ''}
                    alt=""
                    loading="lazy"
                    style={swatch.placeholder ? { backgroundImage: `url(${swatch.placeholder})` } : undefined}
                  />
                ) : null}
                {/* خطِ مورب برایِ رنگِ تمام‌شده — نه پنهان، که نشانه‌گذاری */}
                {swatch.outOfStock ? <span className="swatch__strike" aria-hidden /> : null}
              </span>
              <span className="swatch__name">{swatch.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** گردیِ تنهاِ رنگ — برایِ کارتِ کالا در فهرست‌ها */
export function ColourDots({ swatches, limit = 4 }: { swatches: Swatch[]; limit?: number }) {
  const usable = swatches.filter((s) => s.name !== 'بدونِ رنگ').slice(0, limit);
  if (usable.length === 0) return null;
  return (
    <span className="dots" aria-label={`${swatches.length} رنگ`}>
      {usable.map((swatch) => (
        <span
          key={swatch.name}
          className="dots__dot"
          style={{ background: swatch.hex }}
          title={swatch.name}
        />
      ))}
      {swatches.length > limit ? <span className="dots__more">+{swatches.length - limit}</span> : null}
    </span>
  );
}

void isLight;
