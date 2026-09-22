'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * جعبه‌ی جستجو.
 *
 * چرا «تکمیلِ خودکارِ زنده» (suggest) ندارد؟ چون هر حرف که کاربر می‌زند،
 * یک پرس‌وجو به پایگاه‌داده است؛ روی موبایلِ ایرانی با اینترنتِ ناپایدار،
 * این یعنی کندی و مصرفِ بی‌دلیل. به‌جایش:
 *   • جستجو با زدنِ اینتر یا دکمه انجام می‌شود؛
 *   • چهار پیشنهادِ آماده («میانبر») کنارش هست که پرتکرارترین جستجوهااند؛
 *   • عبارت در نشانی می‌ماند، پس نتیجه قابلِ به‌اشتراک‌گذاری است.
 *
 * اگر بعداً لازم شد، تکمیلِ زنده را با «حداقل ۳ نویسه + تأخیرِ ۳۰۰ میلی‌ثانیه»
 * می‌توان اضافه کرد — همان‌جا که این کامنت هست.
 */
export function SearchBox({
  shortcuts = ['شارژر', 'قاب آیفون', 'هندزفری', 'پاوربانک'],
  autoFocus = false,
}: {
  shortcuts?: string[];
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(params.get('q') ?? '');

  // وقتی کاربر از یک نتیجه برمی‌گردد، همان عبارت در جعبه بماند
  useEffect(() => {
    setValue(params.get('q') ?? '');
  }, [params]);

  function go(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="sbox">
      <form
        className="sbox__form"
        onSubmit={(e) => {
          e.preventDefault();
          go(value);
        }}
        role="search"
      >
        <input
          ref={inputRef}
          className="sbox__input"
          type="search"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="چه می‌گردید؟ (مثال: شارژر آیفون، گلس سامسونگ)"
          aria-label="جستجو در فروشگاه"
          autoFocus={autoFocus}
          enterKeyHint="search"
          // صفحه‌کلیدِ فارسی: اصلاحِ خودکار و حروفِ بزرگِ خودکار خاموش
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          dir="rtl"
        />
        <button className="sbox__btn" type="submit" aria-label="جستجو">
          جستجو
        </button>
      </form>

      <div className="sbox__shortcuts">
        <span className="sbox__label">پرتکرار:</span>
        {shortcuts.map((s) => (
          <button key={s} type="button" className="sbox__chip" onClick={() => go(s)}>
            {s}
          </button>
        ))}
      </div>

      <style>{`
        .sbox { width: 100%; }
        .sbox__form { display: flex; gap: var(--s-2); }
        .sbox__input {
          flex: 1 1 auto; min-width: 0;
          padding: var(--s-3) var(--s-4);
          font-family: inherit; font-size: var(--fs-base);
          color: var(--c-text); background: var(--c-surface);
          border: 1px solid var(--c-border-strong); border-radius: var(--r-sm);
        }
        .sbox__input::placeholder { color: var(--c-text-3); }
        .sbox__input:focus-visible { outline: 2px solid var(--c-brand); outline-offset: 1px; border-color: var(--c-brand); }
        .sbox__btn {
          flex: 0 0 auto; padding: var(--s-3) var(--s-5);
          font-family: inherit; font-size: var(--fs-base); font-weight: 700;
          color: var(--c-text-invert); background: var(--c-brand);
          border: none; border-radius: var(--r-sm); cursor: pointer;
        }
        .sbox__btn:hover { background: var(--c-brand-hover); }
        .sbox__shortcuts {
          display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2);
          margin-top: var(--s-3);
        }
        .sbox__label { font-size: var(--fs-xs); color: var(--c-text-3); }
        .sbox__chip {
          font-family: inherit; font-size: var(--fs-xs); cursor: pointer;
          padding: 2px var(--s-3); color: var(--c-text-2);
          background: var(--c-surface); border: 1px solid var(--c-border);
          border-radius: var(--r-full);
        }
        .sbox__chip:hover { border-color: var(--c-brand); color: var(--c-brand); }
        @media (max-width: 480px) {
          .sbox__btn { padding: var(--s-3) var(--s-4); }
        }
      `}</style>
    </div>
  );
}
