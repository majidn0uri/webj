'use client';

import { useEffect, useState } from 'react';

import type { Banner } from '@/lib/banner-actions';

/**
 * بنرِ اصلیِ صفحه‌یِ نخست.
 *
 * سه تصمیمِ کوچک که روی هم تجربه‌یِ خرید را عوض می‌کنند:
 *
 *  ۱) **بدون کتاب‌خانه:** اسلایدر با جابه‌جاییِ یک ردیفِ افقی ساخته شده
 *     (`transform`) — نه وابستگیِ خارجی دارد و نه روی اینترنتِ کند کم
 *     می‌آورد. الزامِ «بدونِ اینترنتِ بین‌الملل» یعنی هیچ کتاب‌خانه‌ای از
 *     شبکه‌یِ تحویلِ محتوا نیاید.
 *  ۲) **پیش‌نمایشِ تار:** تا تصویرِ اصلی نیامده، همان زمینه‌یِ تارِ ساخته‌شده
 *     در سامانه نشان داده می‌شود؛ صفحه نمی‌پرد و کاربر فضایِ خالی نمی‌بیند.
 *  ۳) **کشیدن با انگشت:** رویِ موبایل (که بیشترِ خریداران از آن می‌آیند)
 *     بنر را با انگشت می‌کشند، نه با کلیک رویِ فلش.
 */
export function HeroBanners({ items }: { items: Banner[] }) {
  const [index, setIndex] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);

  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % items.length);
    }, 7000);
    return () => clearInterval(timer);
  }, [items.length]);

  if (items.length === 0) return null;
  const current = Math.min(index, items.length - 1);

  return (
    <section className="promo" aria-label="بنرهایِ فروشگاه">
      <div
        className="promo__viewport"
        onTouchStart={(event) => setTouchStart(event.touches[0]?.clientX ?? null)}
        onTouchEnd={(event) => {
          const end = event.changedTouches[0]?.clientX ?? null;
          if (touchStart === null || end === null) return;
          const delta = end - touchStart;
          if (Math.abs(delta) < 40) return; // تکانِ کوچک = کلیک، نه کشیدن
          // راست‌چین: کشیدن به چپ یعنی بنرِ بعدی
          setIndex((i) => (delta < 0 ? (i + 1) % items.length : (i - 1 + items.length) % items.length));
          setTouchStart(null);
        }}
      >
        <div className="promo__track" style={{ transform: `translateX(${current * 100}%)` }}>
          {items.map((banner, position) => (
            <div className="promo__slide" key={banner.id} aria-hidden={position !== current}>
              {banner.linkUrl ? (
                <a href={banner.linkUrl} className="promo__link">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="promo__img"
                    src={banner.imageUrl ?? ''}
                    alt={banner.title}
                    width={1600}
                    height={520}
                    loading={position === 0 ? 'eager' : 'lazy'}
                    style={
                      banner.placeholder
                        ? { backgroundImage: `url(${banner.placeholder})`, backgroundSize: 'cover' }
                        : undefined
                    }
                  />
                  {banner.title ? <span className="promo__caption">{banner.title}</span> : null}
                </a>
              ) : (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="promo__img"
                    src={banner.imageUrl ?? ''}
                    alt={banner.title}
                    width={1600}
                    height={520}
                    loading={position === 0 ? 'eager' : 'lazy'}
                    style={
                      banner.placeholder
                        ? { backgroundImage: `url(${banner.placeholder})`, backgroundSize: 'cover' }
                        : undefined
                    }
                  />
                  {banner.title ? <span className="promo__caption">{banner.title}</span> : null}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {items.length > 1 ? (
        <>
          <button
            className="promo__nav promo__nav--prev"
            type="button"
            aria-label="بنرِ پیشین"
            onClick={() => setIndex((i) => (i - 1 + items.length) % items.length)}
          >
            ‹
          </button>
          <button
            className="promo__nav promo__nav--next"
            type="button"
            aria-label="بنرِ پسین"
            onClick={() => setIndex((i) => (i + 1) % items.length)}
          >
            ›
          </button>
          <div className="promo__dots">
            {items.map((banner, dot) => (
              <button
                key={banner.id}
                type="button"
                aria-label={`بنرِ ${dot + 1}`}
                aria-current={dot === current}
                className={dot === current ? 'promo__dot promo__dot--on' : 'promo__dot'}
                onClick={() => setIndex(dot)}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** بنرهایِ میانیِ صفحه‌یِ نخست — میانِ ردیف‌هایِ کالا */
export function MiddleBanners({ items }: { items: Banner[] }) {
  if (items.length === 0) return null;
  return (
    <section className="midbanners" aria-label="پیشنهادهایِ ویژه">
      {items.map((banner) => {
        const inner = (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="midbanner__img"
              src={banner.imageUrl ?? ''}
              alt={banner.title}
              width={800}
              height={260}
              loading="lazy"
              style={
                banner.placeholder
                  ? { backgroundImage: `url(${banner.placeholder})`, backgroundSize: 'cover' }
                  : undefined
              }
            />
            {banner.title ? <span className="midbanner__caption">{banner.title}</span> : null}
          </>
        );
        return (
          <div className="midbanner" key={banner.id}>
            {banner.linkUrl ? (
              <a className="midbanner__link" href={banner.linkUrl}>
                {inner}
              </a>
            ) : (
              inner
            )}
          </div>
        );
      })}
    </section>
  );
}
