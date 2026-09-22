'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * فیلترهایِ فهرست: رنگ، «فقط تخفیف‌دار»، «فقط موجود».
 *
 * چرا این فیلترها در **نشانی** می‌نشینند (و نه در متغیرِ react)؟ سه دلیل:
 *
 *   ۱. فهرست در کارساز رندر می‌شود (RSC)؛ اگر فیلتر در حافظه‌یِ مرورگر
 *      بماند، باید همه‌یِ کالاها را یک‌جا به مرورگر بفرستیم و آنجا فیلتر
 *      کنیم — یعنی فهرستِ ۵۰۰ تایی برای نشان دادنِ ۲۰ تا.
 *   ۲. نشانی قابلِ فرستادن است: فروشنده می‌تواند پیوندِ «همه‌یِ قاب‌هایِ
 *      مشکیِ تخفیف‌دار» را در کانال بگذارد.
 *   ۳. با کلیدِ «بازگشت» درست رفتار می‌کند؛ فیلتری که در حافظه باشد،
 *      بازگشت را می‌شکند.
 *
 * و چرا «فقط تخفیف‌دار» را به کارساز می‌سپاریم نه مرورگر؟ چون تشخیصِ
 * تخفیفِ جاری وابسته به «اکنون» است؛ اگر مرورگر از رویِ داده‌یِ دریافتی
 * حساب کند، تا رسیدنِ پاسخ زمان گذشته و فهرست دروغ می‌گوید.
 */

const CARD_COLOURS: Record<string, string> = {
  مشکی: '#1a1a1a', سفید: '#f5f5f5', خاکستری: '#9e9e9e', نقره‌ای: '#c0c0c0',
  سرمه‌ای: '#1e2a5a', آبی: '#1565c0', فیروزه‌ای: '#26c6da', سبز: '#2e7d32',
  قرمز: '#c62828', صورتی: '#ec407a', بنفش: '#6a1b9a', زرد: '#f9a825',
  نارنجی: '#ef6c00', قهوه‌ای: '#6d4c41', طلایی: '#d4af37', کرمی: '#f0e6d2',
};

export function FilterChips({ colours }: { colours: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const activeColours = (params.get('colour') ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const discounted = params.get('discounted') === '1';
  const available = params.get('available') === '1';

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    // فیلتر عوض می‌شود → باید از صفحه‌یِ نخست دید
    next.delete('page');
    startTransition(() => router.push(`?${next.toString()}`, { scroll: false }));
  }

  function toggleColour(colour: string) {
    const next = activeColours.includes(colour)
      ? activeColours.filter((c) => c !== colour)
      : [...activeColours, colour];
    setParam('colour', next.join(','));
  }

  return (
    <div className="chips" aria-busy={pending}>
      {colours.length > 0 ? (
        <>
          <span className="sf-text-sm sf-color-500">رنگ:</span>
          {colours.map((c) => (
            <button
              key={c}
              type="button"
              className="chip-f"
              aria-pressed={activeColours.includes(c)}
              onClick={() => toggleColour(c)}
            >
              <span
                className="chip-f__dot"
                style={{ background: CARD_COLOURS[c] ?? '#ddd' }}
                aria-hidden="true"
              />
              {c}
            </button>
          ))}
        </>
      ) : null}

      <button
        type="button"
        className="chip-f"
        aria-pressed={discounted}
        onClick={() => setParam('discounted', discounted ? null : '1')}
      >
        فقط تخفیف‌دار
      </button>
      <button
        type="button"
        className="chip-f"
        aria-pressed={available}
        onClick={() => setParam('available', available ? null : '1')}
      >
        فقط موجود
      </button>

      {activeColours.length > 0 || discounted || available ? (
        <button
          type="button"
          className="chip-f"
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            next.delete('colour');
            next.delete('discounted');
            next.delete('available');
            startTransition(() => router.push(`?${next.toString()}`, { scroll: false }));
          }}
        >
          ✕ پاک کردنِ فیلترها
        </button>
      ) : null}
    </div>
  );
}
