'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * بزرگ‌نماییِ تصویر — نورباکسِ تمام‌صفحه با مسیریابیِ افقی.
 *
 * چرا «client»؟ چون تعاملی است (لمس، کلید، نگه‌داشتنِ صفحه) و هیچ‌کدام
 * از SSR نمی‌آید. اما کلِ ساختارِ گالری (تصویرِ اصلی + بندانگشتی‌ها) از
 * سرور می‌آید — فقط رفتارِ کلیک/لمس اینجا بسته می‌شود.
 *
 * تصمیم‌ها:
 *  • ضربه‌یِ آهسته = باز شدن، لغزشِ انگشت = جابه‌جایی. بزرگ‌نماییِ لمسی
 *    (pinch-to-zoom) را به مرورگر می‌سپاریم — جعل‌کردنش بدتر از نبودنش است.
 *  • بندانگشتی‌ها در پایین می‌مانند: خریدار باید بداند «چند عکس دارم و
 *    کجایم» بدون اینکه بخشی از تصویر را ببندد.
 *  • ESC + ضربه روی پس‌زمینه = بستن — هر دو الگوی آشنا.
 */

interface LightboxImage {
  url: string;
  alt?: string | null;
}

export function ImageLightbox({
  images,
  mainUrl,
  title,
}: {
  images: LightboxImage[];
  /** تصویرِ نمایش‌داده‌شده در حالِ عادی — نقطه‌یِ آغازِ نورباکس */
  mainUrl?: string | null;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [fade, setFade] = useState(true);
  const thumbRef = useRef<HTMLDivElement>(null);
  const touchX = useRef(0);

  // نخستین تصویرِ فعال = آنچه به عنوانِ main معرفی شده
  const startIdx = mainUrl ? Math.max(0, images.findIndex((img) => img.url === mainUrl)) : 0;

  const go = useCallback(
    (next: number) => {
      const clamped = ((next % images.length) + images.length) % images.length;
      setFade(false);
      setTimeout(() => {
        setIdx(clamped);
        setFade(true);
      }, 150);
      // بندانگشتیِ فعال به چشم بیاید
      thumbRef.current?.children[clamped]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    },
    [images.length],
  );

  const openAt = useCallback(() => {
    setIdx(startIdx);
    setOpen(true);
  }, [startIdx]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') go(idx + 1);
      if (e.key === 'ArrowLeft') go(idx - 1);
    };
    window.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handler);
    };
  }, [open, idx, close, go]);

  if (images.length === 0) return null;

  return (
    <>
      {/* پوششِ تصویرِ اصلی — ضربه = باز کردنِ نورباکس */}
      <button
        type="button"
        className="pdp__zoom-cover"
        aria-label="بزرگ‌نماییِ تصویر"
        onClick={openAt}
      >
        <img src={images[startIdx].url} alt={title} width={900} height={900} />
      </button>

      {/* نورباکس */}
      {open ? (
        <div
          className="lb"
          role="dialog"
          aria-modal="true"
          aria-label="گالریِ تصاویر"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          {/* سربرگ: عنوان + دکمهٔ بستن */}
          <div className="lb__bar">
            <span className="lb__pos">{idx + 1} / {images.length}</span>
            <button type="button" className="lb__close" aria-label="بستن" onClick={close}>
              ✕
            </button>
          </div>

          {/* دکمه‌هایِ چپ/راست — فقط در موبایل بزرگ یا دسکتاپ */}
          {images.length > 1 ? (
            <>
              <button type="button" className="lb__arrow lb__arrow--right" aria-label="بعدی" onClick={() => go(idx + 1)}>
                ‹
              </button>
              <button type="button" className="lb__arrow lb__arrow--left" aria-label="قبلی" onClick={() => go(idx - 1)}>
                ›
              </button>
            </>
          ) : null}

          {/* تصویرِ بزرگ — pinch-to-zoom را به مرورگر می‌سپاریم */}
          <div
            className={`lb__img-wrap${fade ? ' is-show' : ''}`}
            onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              const dx = e.changedTouches[0].clientX - touchX.current;
              if (Math.abs(dx) > 50) go(idx + (dx < 0 ? 1 : -1));
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={images[idx].url}
              alt={images[idx].alt || title}
              width={1200}
              height={1200}
              className="lb__img"
            />
          </div>

          {/* بندانگشتی‌ها — نوارِ پایین */}
          {images.length > 1 ? (
            <div className="lb__thumbs" ref={thumbRef}>
              {images.map((img, i) => (
                <button
                  key={img.url}
                  type="button"
                  className={`lb__thumb${i === idx ? ' is-active' : ''}`}
                  aria-label={`تصویرِ ${i + 1}`}
                  onClick={() => go(i)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" width={64} height={64} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}