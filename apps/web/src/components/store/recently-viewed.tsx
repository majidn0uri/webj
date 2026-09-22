'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * «دیده‌شده‌هایِ اخیر» — نواری در پایینِ صفحه‌یِ کالا.
 *
 * خریداری که سه کیس را بازدید می‌کند، باید بتواند بی‌آنکه «برگردد»،
 * دوباره یکی را ببیند. دیجی‌کالا این را «بازدیدهای اخیر» می‌گوید و در
 * صفحه‌یِ خانه نشان می‌دهد. ما آن را در صفحه‌یِ کالا هم می‌گذاریم — چون
 * «در حالِ مقایسه بودم، این یکی را هم ببینم، و بعد بین اینها تصمیم بگیرم»
 * جریانِ طبیعیِ خریدار است و نباید به خانه برگردد.
 *
 * دو تصمیم:
 *  ۱) **داده فقط در مرورگر.** localStorage — بدونِ سرور، بدونِ سوکت، بدونِ
 *     حالتِ رندر. خریدارِ بی‌اکانت هم دیده‌شده‌هایش هست.
 *  ۲) **نه رتبه، نه قیمت — فقط تصویر و نام.** این نوار «کمکِ بازگشت» است،
 *     نه «کارتِ کالا». قیمت و تخفیف و موجودی ممکن است در سی ثانیه عوض شود —
 *     اگر اینجا نشانشان دهیم و قدیمی باشند، بیشتر گمراه می‌کنند تا راهنما.
 */

const STORAGE_KEY = 'setshop_rv';
const MAX_ITEMS = 8;

interface ViewedItem {
  s: string; // slug
  t: string; // title
  i: string; // imageUrl
}

function read(): ViewedItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ViewedItem[];
  } catch {
    return [];
  }
}

function save(items: ViewedItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // localStorage پر یا غیرفعال — ساکت عبور می‌کنیم
  }
}

/**
 * این مؤلفه باید در صفحه‌یِ کالا صدا زده شود. `slug` و `title` و `imageUrl`
 * مالِ کالایِ **جاری** هستند — مؤلفه خودش آن‌ها را در localStorage
 * ثبت می‌کند و نوار را نشان می‌دهد.
 */
export function RecentlyViewed({
  currentSlug,
  currentTitle,
  currentImageUrl,
}: {
  currentSlug: string;
  currentTitle: string;
  currentImageUrl?: string | null;
}) {
  const [items, setItems] = useState<ViewedItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const prev = read().filter((item) => item.s !== currentSlug);
    const next = [{ s: currentSlug, t: currentTitle, i: currentImageUrl ?? '' }, ...prev].slice(0, MAX_ITEMS);
    save(next);
    // از بینِ بقیه نشان بده، نه کالایِ جاری
    setItems(next.filter((item) => item.s !== currentSlug));
    setReady(true);
  }, [currentSlug, currentTitle, currentImageUrl]);

  if (!ready || items.length === 0) return null;

  return (
    <section className="sect sf-mt-3" >
      <div className="sect__head">
        <h2 className="sect__title sf-text-17" >
          دیده‌شده‌هایِ اخیر
        </h2>
      </div>
      <div className="rv__strip">
        {items.map((item) => (
          <Link key={item.s} href={`/products/${item.s}`} className="rv__card" title={item.t}>
            {item.i ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="rv__img" src={item.i} alt="" width={80} height={80} />
            ) : (
              <div className="rv__img rv__ph" />
            )}
            <span className="rv__title">{item.t}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}