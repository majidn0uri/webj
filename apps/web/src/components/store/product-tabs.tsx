'use client';

import { useId, useState, type ReactNode } from 'react';

/**
 * تب‌هایِ برگه‌یِ کالا: توضیحات / مشخصات / سازگاری / نظرات.
 *
 * چرا تب، و نه چیدنِ همه چیز زیرِ هم؟ چون برگه‌یِ کالا در موبایل بی‌نهایت
 * بلند می‌شود و خریدار برای رسیدن به «آیا به گوشیِ من می‌خورد؟» باید از
 * میانِ سه صفحه توضیح بگذرد. پاسخِ آن پرسش باید یک لمس فاصله داشته باشد.
 *
 * سه ملاحظه‌یِ ریز اما تعیین‌کننده:
 *
 *   ۱. **دسترس‌پذیریِ درست**: نقش‌هایِ `tab`/`tabpanel` و پیوندِ آن‌ها با
 *      `aria-controls` — وگرنه صفحه‌خوان چهار بخش را بی‌هیچ نشانی می‌خواند.
 *   ۲. **جهتِ کلیدها**: در راست‌چین، «بعدی» به معنایِ چپ است؛ با کلیدِ
 *      جهت‌نما باید همان‌طور حرکت کند که چشم می‌خواند.
 *   ۳. **نشانی**: تبِ برگزیده در نشانی می‌نشیند (`#tab-specs`) تا بشود
 *      پیوندِ یک بخشِ خاص را فرستاد — و اگر کسی با آن نشانی وارد شد، همان
 *      تب باز شود.
 */

export interface TabDef {
  id: string;
  label: string;
  content: ReactNode;
}

export function ProductTabs({ tabs, initial }: { tabs: TabDef[]; initial?: string }) {
  const base = useId();
  const [active, setActive] = useState(() => {
    if (initial && tabs.some((t) => t.id === initial)) return initial;
    // نشانی هم می‌تواند تب را برگزیند (پیوندِ فرستاده‌شده)
    if (typeof window !== 'undefined' && window.location.hash.startsWith('#tab-')) {
      const fromHash = window.location.hash.slice(5);
      if (tabs.some((t) => t.id === fromHash)) return fromHash;
    }
    return tabs[0]?.id ?? '';
  });

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    // راست‌چین: «بعدی» یعنی یک به چپ در آرایه (نمایش از راست به چپ است)
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setActive(tabs[(index + 1) % tabs.length]!.id);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setActive(tabs[(index - 1 + tabs.length) % tabs.length]!.id);
    }
  }

  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist" aria-label="جزئیاتِ کالا">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`${base}-tab-${tab.id}`}
            type="button"
            role="tab"
            className="tabs__tab"
            aria-selected={active === tab.id}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => {
              setActive(tab.id);
              // نشانی را بی‌پرشِ صفحه به‌روز می‌کنیم تا پیوند قابلِ فرستادن باشد
              if (typeof window !== 'undefined') {
                window.history.replaceState(null, '', `#tab-${tab.id}`);
              }
            }}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${base}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${tab.id}`}
          className="tabs__panel"
          hidden={active !== tab.id}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
