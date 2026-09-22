'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Device } from '@/lib/api';

/**
 * انتخابگرِ «گوشی شما چیست؟» — نقطه‌ی ورودِ اصلیِ خرید.
 *
 * چرا این مهم‌ترین بخش است؟
 * مشتریِ لوازم جانبی با «مدلِ گوشی‌اش» فکر می‌کند، نه با نامِ کالا.
 * سیستم‌های قالبی (مثل ووکامرس) فقط فیلترِ ویژگی دارند و نمی‌توانند
 * «این کالا با این مدل سازگار است» را به‌صورتِ تضمین‌شده و چندبه‌چند نگه دارند؛
 * در اینجا این رابطه در جدولِ product_compatibility با سطحِ اطمینان ذخیره شده است.
 */
export function DeviceSelector({ devices }: { devices: Device[] }) {
  const router = useRouter();
  const [brand, setBrand] = useState<string>(devices[0]?.brand ?? '');
  const [query, setQuery] = useState('');

  const brands = useMemo(() => {
    const set = new Set<string>();
    for (const d of devices) set.add(d.brand);
    return [...set].sort((a, b) => a.localeCompare(b, 'fa'));
  }, [devices]);

  const models = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices
      .filter((d) => (brand ? d.brand === brand : true))
      .filter((d) => (q ? d.model.toLowerCase().includes(q) : true))
      .sort((a, b) => a.model.localeCompare(b.model, 'en'));
  }, [devices, brand, query]);

  function go(device: Device) {
    router.push(`/device/${device.id}`);
  }

  return (
    <section aria-labelledby="device-picker-title">
      <style>{`
        .dp { display: grid; gap: var(--s-4); }
        .dp__chips { display: flex; flex-wrap: wrap; gap: var(--s-2); }
        .dp__chip {
          border: 1px solid var(--c-border-strong); background: var(--c-surface);
          border-radius: var(--r-full); padding: 6px var(--s-4);
          font-size: var(--fs-sm); color: var(--c-text-2);
          transition: all var(--dur) var(--ease);
        }
        .dp__chip[aria-pressed='true'] {
          background: var(--c-brand); border-color: var(--c-brand); color: var(--c-text-invert);
        }
        .dp__search {
          height: 44px; border: 1px solid var(--c-border-strong); border-radius: var(--r-md);
          padding: 0 var(--s-4); font-size: var(--fs-base); font-family: inherit;
          background: var(--c-surface); color: var(--c-text); width: 100%;
        }
        .dp__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: var(--s-2); }
        .dp__model {
          display: flex; align-items: center; justify-content: space-between; gap: var(--s-2);
          border: 1px solid var(--c-border); background: var(--c-surface);
          border-radius: var(--r-md); padding: var(--s-3) var(--s-4);
          font-size: var(--fs-sm); text-align: right;
          transition: all var(--dur) var(--ease);
        }
        .dp__model:hover { border-color: var(--c-brand); background: var(--c-brand-soft); }
        .dp__empty { color: var(--c-text-3); font-size: var(--fs-sm); padding: var(--s-4) 0; }
      `}</style>

      <div className="dp">
        <h2 id="device-picker-title" style={{ fontSize: 'var(--fs-xl)', margin: 0 }}>
          گوشی شما چیست؟
        </h2>
        <p className="sf-mb-0 sf-color-600 sf-text-sm">
          مدل را انتخاب کنید تا فقط کالاهایی را ببینید که با گوشیِ شما سازگارند.
        </p>

        <div className="dp__chips" role="group" aria-label="برندِ گوشی">
          {brands.map((b) => (
            <button
              key={b}
              type="button"
              className="dp__chip"
              aria-pressed={b === brand}
              onClick={() => setBrand(b)}
            >
              {b}
            </button>
          ))}
        </div>

        <input
          className="dp__search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="جستجوی مدل… (مثال: 13 Pro)"
          aria-label="جستجوی مدلِ گوشی"
        />

        <div className="dp__grid">
          {models.map((d) => (
            <button key={d.id} type="button" className="dp__model" onClick={() => go(d)}>
              <span>{d.model}</span>
              <span aria-hidden="true" style={{ color: 'var(--c-text-3)' }}>‹</span>
            </button>
          ))}
        </div>

        {models.length === 0 ? (
          <p className="dp__empty">مدلی با این مشخصات یافت نشد.</p>
        ) : null}
      </div>
    </section>
  );
}
