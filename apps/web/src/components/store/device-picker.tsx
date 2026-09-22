'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Device } from '@/lib/api';

/**
 * انتخابگرِ گوشی در صفحه‌ی نخست.
 *
 * دو مرحله به‌جایِ یک فهرستِ بلند: نخست برند، سپس مدل. چرا؟
 * چون با بیست مدل، یک فهرستِ تک‌مرحله‌ای روی موبایل سه برابرِ صفحه
 * قد می‌کشد و کاربر پیش از رسیدن به مدلش خسته می‌شود. با دو مرحله،
 * هر مرحله حداکثر پنج انتخاب دارد — و مدل‌ها بر اساسِ برندِ انتخاب‌شده
 * فیلتر می‌شوند، نه با جستجو.
 */
export function DevicePicker({ devices }: { devices: Device[] }) {
  const router = useRouter();
  const [brand, setBrand] = useState<string | null>(null);

  const brands = useMemo(() => Array.from(new Set(devices.map((d) => d.brand))), [devices]);
  const models = useMemo(
    () => (brand ? devices.filter((d) => d.brand === brand) : []),
    [brand, devices],
  );

  return (
    <div>
      <div className="hero__chips">
        {brands.map((b) => (
          <button
            key={b}
            type="button"
            className="hero__chip"
            aria-pressed={brand === b}
            onClick={() => setBrand((cur) => (cur === b ? null : b))}
            style={brand === b ? { background: 'var(--st-900)', color: '#fff' } : undefined}
          >
            {b}
          </button>
        ))}
      </div>

      {brand ? (
        <div className="hero__chips sf-mt-2" >
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              className="hero__chip"
              onClick={() => router.push(`/device/${m.id}`)}
            >
              {m.model}
            </button>
          ))}
        </div>
      ) : (
        <div className="sf-mt-2 sf-text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>
          برندِ گوشی را انتخاب کنید تا مدل‌ها بیایند.
        </div>
      )}
    </div>
  );
}
