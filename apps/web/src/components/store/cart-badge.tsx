'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IconCart } from './icons';

/**
 * شمارنده‌یِ سبد در هدر — سمتِ کاربر.
 *
 * چرا سمتِ کاربر؟ همان دلیلی که «پیوندِ حساب» را سمتِ کاربر برد: شمارنده از
 * کوکیِ سبد می‌آید، و خواندنِ کوکی در سرور یعنی **هر** برگه‌یِ فروشگاه به
 * خاطرِ یک عدد، پویا شود — یعنی هیچ برگه‌ای کش نشود و هر بازدید، رندرِ
 * دوباره از نو باشد. بهایش در آزمونِ بار اندازه گرفته شد: توان رویِ دو هسته
 * در حدودِ ۷۰ برگه در ثانیه قفل می‌شد در حالی که خودِ API در ۲ میلی‌ثانیه
 * پاسخ می‌داد.
 *
 * حالا برگه‌یِ کش‌شده برایِ همه یکی است (بدونِ شمارنده)، و این مؤلفه پس از
 * بارگذاری، سبدِ **همان** بیننده را می‌پرسد و عدد را می‌نشاند. برایِ خریدار
 * تفاوتی جز یک لحظه تأخیرِ کسری از ثانیه ندارد؛ برایِ سرور تفاوت میانِ
 * «رندر برایِ هر نفر» و «تحویلِ یک برگه‌یِ آماده» است.
 *
 * نشانی نسبی است (`/api/…`)، پس مرورگر کوکی را خودش می‌فرستد و سبدِ درست را
 * می‌گیرد — بی‌آنکه کدِ سمتِ کاربر نشانیِ میزبان را بداند.
 */
export function CartBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/cart', { credentials: 'include' });
        if (!res.ok) return;
        const data = (await res.json()) as { itemCount?: number; items?: unknown[] };
        if (!alive) return;
        setCount(data.itemCount ?? (Array.isArray(data.items) ? data.items.length : 0));
      } catch {
        // بی‌سبد هم فروشگاه کار می‌کند؛ شمارنده فقط یک راهنماست
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Link href="/cart" className="iconbtn iconbtn--cart" aria-label="سبدِ خرید">
      <IconCart size={20} />
      {count > 0 ? <span className="cartcount num">{count}</span> : null}
    </Link>
  );
}
