'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { toman, faDigits } from '@/lib/format';
import { addToCart } from '@/lib/cart-actions';
import { useRouter } from 'next/navigation';

/**
 * نمایشِ سریع (Quick View) — جزئیاتِ کالا بدونِ ترکِ فهرست.
 *
 * چرا؟ چون خریدارِ فهرستِ «قاب» باید بتواند بدونِ بارگیریِ صفحهٔ کامل،
 * ببیند «آیا رنگِ آبی دارد؟» و «قیمتش چند؟». دیجی‌کالا این را دارد —
 * و بزرگ‌ترین تفاوتِ ظاهریِ فهرستِ ما بود.
 *
 * دو تصمیم:
 *  ۱) **داده لازم‌محور.** فقط وقتی modal باز شود، درخواست می‌رود — نه پیشاپیش
 *     برایِ همهٔ کارت‌ها. اینترنتِ موبایل را باید محترم شمرد.
 *  ۲) **بستن = ESC / ضربهٔ بیرون / ✕.** هر سه الگویِ آشنا. و وقتی modal
 *     باز است، body اسکرول نمی‌شود تا محتوا پشتِ modal گم نشود.
 */

interface QuickProduct {
  id: string;
  title: string;
  slug: string;
  brand: string | null;
  description: string | null;
  variants: Array<{
    id: string;
    sku: string;
    price_rial: string;
    is_active: boolean;
    available: number;
    attributes: Record<string, unknown>;
  }>;
  images: Array<{ url: string; alt?: string | null; role?: string | null }>;
  attributes?: Record<string, unknown>;
}

const SPEC_LABELS: Record<string, string> = {
  material: 'جنس', thickness_mm: 'ضخامت', power_watt: 'توان', port_type: 'درگاه',
  length_cm: 'طول', capacity_mah: 'ظرفیت', color: 'رنگ', weight_g: 'وزن',
  warranty_months: 'گارانتی', connector: 'کانکتور',
};

export function QuickView({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<QuickProduct | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!open || data) return;
    setLoading(true);
    fetch(`/api/catalog/products/${slug}`, { headers: { accept: 'application/json' } })
      .then((r) => r.json())
      .then((d: QuickProduct) => {
        setData(d);
        const firstActive = d.variants.find((v) => v.is_active && v.available > 0);
        setSelectedVariant(firstActive?.id ?? d.variants[0]?.id ?? null);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, slug, data]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setData(null); }
    };
    window.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handler);
    };
  }, [open]);

  const active = data?.variants.filter((v) => v.is_active) ?? [];
  const selected = active.find((v) => v.id === selectedVariant) ?? active[0] ?? null;
  const mainImage = data?.images.find((i) => i.role === 'main') ?? data?.images[0] ?? null;

  // مشخصاتِ کلیدی (حداکثر ۴ — فضای modal محدود است)
  const specs = Object.entries(data?.attributes ?? {})
    .filter(([, v]) => v != null && v !== '')
    .slice(0, 4)
    .map(([k, v]) => ({ label: SPEC_LABELS[k] ?? k, value: String(v) }));

  function handleAdd() {
    if (!selected) return;
    const fd = new FormData();
    fd.set('variantId', selected.id);
    fd.set('quantity', String(quantity));
    startTransition(async () => {
      await addToCart(fd);
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    });
  }

  return (
    <>
      <button
        type="button"
        className="card-p__qv"
        aria-label={`نمایشِ سریعِ ${slug}`}
        onClick={() => setOpen(true)}
      >
        {/* آیکونِ چشم — inline SVG (بدونِ وابستگی به کتابخانه) */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      {open ? (
        <div
          className="qv"
          role="dialog"
          aria-modal="true"
          aria-label="نمایشِ سریع"
          onClick={(e) => { if (e.target === e.currentTarget) { setOpen(false); setData(null); } }}
        >
          <div className="qv__card">
            {/* سربرگ */}
            <div className="qv__head">
              <span className="qv__title">{data?.title ?? '...'}</span>
              <button
                type="button"
                className="qv__close"
                aria-label="بستن"
                onClick={() => { setOpen(false); setData(null); }}
              >
                ✕
              </button>
            </div>

            {loading ? (
              <div className="qv__loading">در حالِ بارگیری…</div>
            ) : data ? (
              <div className="qv__body">
                {/* تصویر */}
                <div className="qv__img-wrap">
                  {mainImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mainImage.url} alt={data.title} width={300} height={300} className="qv__img" />
                  ) : (
                    <div className="card-p__ph">تصویر ندارد</div>
                  )}
                </div>

                {/* جزئیات */}
                <div className="qv__details">
                  {data.brand ? <span className="tag tag--brand">{data.brand}</span> : null}

                  {/* قیمت */}
                  {selected ? (
                    <div className="price sf-mt-1 sf-mb-1" >
                      <span className="price__value num">{toman(Number(selected.price_rial))}</span>
                      <span className="price__unit">تومان</span>
                    </div>
                  ) : null}

                  {/* تنوع‌ها */}
                  {active.length > 1 ? (
                    <div className="sf-flex sf-flex-wrap sf-gap-1 sf-mt-1 sf-mb-1">
                      {active.map((v) => {
                        const color = (v.attributes as { color?: string })?.color;
                        const isSel = v.id === selectedVariant;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            className={`chip${isSel ? ' chip--active' : ''}`}
                            style={color ? { borderColor: isSel ? 'var(--st-brand)' : undefined } : undefined}
                            onClick={() => { setSelectedVariant(v.id); setQuantity(1); }}
                          >
                            {color ?? v.sku}
                            {v.available <= 0 ? ' (ناموجود)' : ''}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {/* موجودی */}
                  {selected && selected.available > 0 ? (
                    <p className="sf-text-sm sf-color-500">
                      {selected.available <= 5
                        ? `تنها ${faDigits(selected.available)} عدد مانده`
                        : 'موجود'}
                    </p>
                  ) : (
                    <p className="sf-text-sm sf-color-err sf-mt-1 sf-mb-1">ناموجود</p>
                  )}

                  {/* مشخصاتِ کلیدی */}
                  {specs.length ? (
                    <div className="sf-mt-1 sf-mb-1 sf-text-sm sf-color-600">
                      {specs.map((s) => (
                        <span key={s.label} className="sf-inline-block-me-2">
                          <strong>{s.label}:</strong> {s.value}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {/* دکمه‌ها */}
                  <div className="sf-flex sf-flex-wrap sf-gap-1 sf-mt-2">
                    {selected && selected.available > 0 ? (
                      <button
                        type="button"
                        className="btn-p btn-p--primary sf-btn-flex"
                        disabled={pending}
                        onClick={handleAdd}
                        
                      >
                        {added ? '✓ افزوده شد' : pending ? '…' : 'افزودن به سبد'}
                      </button>
                    ) : null}
                    <Link
                      href={`/products/${data.slug}`}
                      className="btn-p btn-p--outline sf-btn-flex-center"
                      
                    >
                      صفحهٔ کامل
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <div className="qv__loading">خطا در بارگیری</div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}