'use client';

import { useEffect, useState } from 'react';

import type { Banner } from '@/lib/banner-actions';

/**
 * نوارِ اعلانِ بالایِ سایت.
 *
 * چرا این نوار با وجودِ سادگی‌اش اهمیت دارد؟ چون نخستین چیزی است که خریدار
 * می‌بیند و در عین حال چیزی است که در بیشتر فروشگاه‌ها **با کد عوض می‌شود**.
 * اینجا محتوایش از پنل می‌آید و فروشنده خودش آن را می‌نویسد و زمان‌دار
 * می‌کند — برایِ یک کمپینِ دو روزه نیازی به توسعه‌دهنده نیست.
 *
 * اگر بیش از یک پیامِ فعال باشد، پیام‌ها می‌چرخند (هر ۶ ثانیه):
 *   • چرخش با CSS انجام می‌شود، نه با کتاب‌خانه — هیچ وابستگی‌ای به اینترنت
 *     نمی‌خواهد (الزامِ «فقط ایران»)؛
 *   • با `prefers-reduced-motion` احترام به کسی که حرکت را دوست ندارد؛
 *   • پیامِ تکی اصلاً نمی‌چرخد (بی‌جهت تکان نخورد).
 */
export function AnnouncementBar({ items }: { items: Banner[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % items.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [items.length]);

  if (items.length === 0) return null;

  const item = items[Math.min(index, items.length - 1)]!;
  const content = (
    <span className="annbar__text">
      {item.title}
      {item.body ? <span className="annbar__body">{item.body}</span> : null}
    </span>
  );

  return (
    <div className={`annbar${item.tone ? ` annbar--${item.tone}` : ''}`} role="region" aria-label="اعلانِ فروشگاه">
      <div className="annbar__inner">
        {item.linkUrl ? (
          <a className="annbar__link" href={item.linkUrl}>
            {content}
          </a>
        ) : (
          content
        )}

        {items.length > 1 ? (
          <div className="annbar__dots" role="tablist" aria-label="پیام‌هایِ دیگر">
            {items.map((banner, dot) => (
              <button
                key={banner.id}
                type="button"
                role="tab"
                aria-selected={dot === index}
                aria-label={`پیامِ ${dot + 1}`}
                className={dot === index ? 'annbar__dot annbar__dot--on' : 'annbar__dot'}
                onClick={() => setIndex(dot)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
