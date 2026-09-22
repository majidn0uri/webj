'use client';

import { useRouter, useSearchParams } from 'next/navigation';

/**
 * پنلِ فیلترِ کنارِ نتایج.
 *
 * چرا فیلترها در نشانی (URL) می‌مانند؟ چون نتیجه‌ی فیلترشده باید قابلِ
 * به‌اشتراک‌گذاری و بازگشت با دکمه‌ی «بازگشتِ مرورگر» باشد — در غیر این صورت
 * کاربر با زدنِ دکمه‌ی بازگشت، همه‌ی فیلترهایش را از دست می‌دهد.
 */
export function SearchFilters({
  devices,
  active,
}: {
  devices: Array<{ id: string; brand: string; model: string }>;
  active?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function withDevice(id?: string) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set('device', id);
    else next.delete('device');
    router.push(`/search?${next.toString()}`);
  }

  const byBrand = devices.reduce<Record<string, typeof devices>>((acc, d) => {
    (acc[d.brand] ??= []).push(d);
    return acc;
  }, {});

  return (
    <aside className="filters__side">
      <div
        className="sf-card-bordered" style={{ padding: 'var(--st-4)', background: 'var(--st-0)' }}
      >
        <div className="filter-group" style={{ borderBottom: 'none', paddingTop: 0 }}>
          <div className="filter-group__t">فیلتر بر اساسِ گوشی</div>
          <div className="sf-flex sf-flex-wrap sf-gap-1">
            <button
              type="button"
              className="chip"
              aria-pressed={!active}
              onClick={() => withDevice(undefined)}
            >
              همه
            </button>
          </div>
        </div>

        {Object.entries(byBrand).map(([brand, models]) => (
          <div className="filter-group" key={brand}>
            <div className="filter-group__t">{brand}</div>
            <div className="filter-list" style={{ maxHeight: 200 }}>
              {models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="filter-item"
                  onClick={() => withDevice(m.id === active ? undefined : m.id)}
                  style={{
                    // حداقلِ ۳۴ پیکسلِ ارتفاع: انگشت رویِ موبایل به هدفِ
                    // کوچک‌تر از این خطا می‌زند و فیلتری را باز می‌کند که
                    // کاربر نخواسته بود (اندازه‌گیریِ ممیزی: ۲۲ پیکسل بود).
                    background: 'none', border: 'none',
                    padding: '7px 2px', minHeight: 34, textAlign: 'right',
                    fontFamily: 'inherit', cursor: 'pointer',
                    color: m.id === active ? 'var(--st-brand)' : undefined,
                    fontWeight: m.id === active ? 700 : 400,
                  }}
                >
                  <input type="checkbox" readOnly checked={m.id === active} />
                  {m.model}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
