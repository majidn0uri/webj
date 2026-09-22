'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconSearch } from './icons';

interface Suggestion {
  id: string;
  title: string;
  brand?: string | null;
  price?: string | null;
  slug: string;
}

/**
 * جعبه‌ی جستجو با پیشنهادِ زنده.
 *
 * چرا اینجا «پیشنهادِ زنده» داریم اما نسخه‌ی ساده نداشت؟ چون هزینه‌اش را
 * مدیریت کرده‌ایم:
 *   • دست‌کم ۲ نویسه،
 *   • تأخیرِ ۲۸۰ میلی‌ثانیه پس از توقفِ تایپ کردن،
 *   • لغوِ درخواستِ پیشین (AbortController) — روی اینترنتِ موبایل،
 *     پاسخِ کندِ درخواستِ قبلی نباید پاسخِ تازه را خراب کند،
 *   • حداکثر ۶ پیشنهاد،
 *   • و مسیرِ کیبورد (بالا/پایین/اینتر) برایِ کسی که تایپ نمی‌خواهد بایستد.
 */
export function SearchSuggest({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // میانبرِ Ctrl+K / ⌘K — همان رفتاری که کاربر در فروشگاه‌هایِ بزرگ دیده است
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // بستن با کلیکِ بیرون
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}&limit=6`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items?: Suggestion[] };
        setItems(data.items ?? []);
        setOpen(true);
        setActive(-1);
      } catch {
        /* درخواست لغو شد یا شبکه قطع بود — چیزی نشان نمی‌دهیم */
      }
    }, 280);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  function go(to?: string) {
    const target = to ?? items[active]?.slug;
    if (target) {
      router.push(`/products/${target}`);
      setOpen(false);
      return;
    }
    if (value.trim()) {
      router.push(`/search?q=${encodeURIComponent(value.trim())}`);
      setOpen(false);
    }
  }

  return (
    <div className="searchbox" ref={boxRef}>
      <span className="searchbox__icon">
        <IconSearch size={19} />
      </span>
      <input
        ref={inputRef}
        className="searchbox__input"
        type="search"
        value={value}
        autoFocus={autoFocus}
        placeholder="جستجو در ست‌شاپ…"
        aria-label="جستجو"
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => items.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, items.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, -1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            go();
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      <span className="searchbox__hint num">Ctrl+K</span>

      {open && items.length > 0 ? (
        <div className="sugg" role="listbox">
          {items.map((it, i) => (
            <div
              key={it.id}
              className="sugg__item"
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(it.slug)}
            >
              <IconSearch size={15} />
              <span>{it.title}</span>
              <span className="sugg__meta num">{it.price ? `${it.price} تومان` : ''}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
