'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Device } from '@/lib/api';
import { IconChevronDown, IconGrid, IconPhone } from './icons';
import { faDigits } from '@/lib/format';

const toPersian = (n: number): string => faDigits(n);

/**
 * دسته‌ها از پایگاه می‌آیند، نه از کد.
 *
 * تا پیش از این پنج دسته در همین پرونده نوشته شده بود؛ یعنی برایِ افزودنِ
 * یک دسته باید کد عوض می‌شد. اکنون هرچه فروشنده در پنل بسازد، همین‌جا
 * می‌آید — و دسته‌ای که کالا ندارد نشان داده نمی‌شود.
 */
export interface MenuCategory {
  id: string;
  name: string;
  slug: string;
  totalCount: number;
  children: MenuCategory[];
}

/**
 * منویِ آبشاریِ دسته‌بندی.
 *
 * دو ستونِ معنا‌دار به‌جایِ یک فهرستِ بلند:
 *   • ستونِ نخست: نوعِ کالا (آنچه می‌خواهی بخری)
 *   • ستون‌هایِ بعد: مدلِ دقیقِ گوشی (آنچه داری) — این همان برتریِ ماست
 *     نسبت به فروشگاه‌هایِ عمومی: کاربر به‌جایِ پرسه‌زدن، گوشی‌اش را برمی‌گزیند
 *     و فقط کالاهایِ سازگار را می‌بیند.
 *
 * منو با هاور روی دسکتاپ باز می‌شود و با کلیک روی موبایل؛ هر دو با
 * یک منطق (state) مدیریت می‌شوند تا رفتار در دستگاه‌هایِ مختلف یکی باشد.
 */
export function MegaMenu({ devices, categories = [] }: { devices: Device[]; categories?: MenuCategory[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // گروه‌بندیِ مدل‌ها بر اساسِ برندِ گوشی
  const byBrand = devices.reduce<Record<string, Device[]>>((acc, d) => {
    (acc[d.brand] ??= []).push(d);
    return acc;
  }, {});

  return (
    <div
      className="mega"
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="navlink navlink--cats sf-btn-reset"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconGrid size={16} />
        دسته‌بندی کالاها
        <IconChevronDown size={14} />
      </button>

      {open ? (
        <div className="mega__panel mega__panel-rows" role="menu" >
          <div className="mega__col">
            <div className="mega__head">بر اساسِ نوعِ کالا</div>
            {categories.length === 0 ? (
              <span className="mega__empty">دسته‌ای هنوز ساخته نشده است</span>
            ) : (
              categories.map((category) => (
                <div key={category.id} className="mega__group">
                  <Link
                    className="mega__link mega__link--root"
                    href={`/c/${category.slug}`}
                    onClick={() => setOpen(false)}
                  >
                    {category.name}
                    <span className="mega__count num">{toPersian(category.totalCount)}</span>
                  </Link>
                  {category.children.length > 0 ? (
                    <div className="mega__sub">
                      {category.children.map((child) => (
                        <Link
                          key={child.id}
                          className="mega__link mega__link--sub"
                          href={`/c/${child.slug}`}
                          onClick={() => setOpen(false)}
                        >
                          {child.name}
                          <span className="mega__count num">{toPersian(child.totalCount)}</span>
                        </Link>
                      ))}
                      {/* «همه‌یِ کالاهایِ این دسته» — شاملِ خودش و همه‌یِ زیردسته‌ها */}
                      <Link
                        className="mega__link mega__link--all"
                        href={`/search?cat=${category.slug}`}
                        onClick={() => setOpen(false)}
                      >
                        همه‌یِ {category.name} ←
                      </Link>
                    </div>
                  ) : null}
                </div>
              ))
            )}
            <div className="mega__head sf-mt-2" >خریدِ ویژه</div>
            <Link className="mega__link" href="/search?q=شارژر" onClick={() => setOpen(false)}>
              پرفروش‌ترین‌ها
            </Link>
          </div>

          {Object.entries(byBrand).map(([brand, models]) => (
            <div className="mega__col" key={brand}>
              <div className="mega__head">
                <IconPhone size={13} /> {brand}
              </div>
              {models.slice(0, 7).map((m) => (
                <Link key={m.id} className="mega__link" href={`/device/${m.id}`} onClick={() => setOpen(false)}>
                  {m.model}
                </Link>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
