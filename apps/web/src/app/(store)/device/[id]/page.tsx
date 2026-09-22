import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import { ProductCard } from '@/components/store/product-card';
import { IconPhone } from '@/components/store/icons';

export const revalidate = 60;

/**
 * همان استدلالِ برگه‌یِ کالا: مسیرِ دارایِ پارامتر بی‌این تابع هرگز کش
 * نمی‌شود. مدل‌هایِ گوشی از فهرستِ دستگاه‌ها می‌آیند (تعدادشان محدود است).
 */
export async function generateStaticParams() {
  try {
    const res = await fetch(`${process.env.API_BASE ?? 'http://127.0.0.1:3000'}/catalog/devices`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { devices?: { id: string }[]; items?: { id: string }[] };
    const list = data.devices ?? data.items ?? [];
    return list.map((d) => ({ id: String(d.id) }));
  } catch {
    return [];
  }
}

/**
 * صفحه‌ی «کالاهای سازگار با گوشیِ من».
 *
 * این صفحه دلیلِ وجودیِ فروشگاه است: کاربر به‌جایِ جستجو، گوشی‌اش را برمی‌گزیند
 * و فقط چیزی را می‌بیند که واقعاً به آن می‌خورد. پس بالای صفحه باید دقیقاً
 * بگوید چه گوشی‌ای انتخاب شده و چطور آن را عوض کند — وگرنه کاربر میانِ
 * نتایج گم می‌شود و نمی‌فهمد چرا این فهرست کوتاه است.
 */
export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let device: { brand: string; model: string } | null = null;
  let items: Awaited<ReturnType<typeof api.compatible>>['items'] = [];
  let others: Array<{ id: string; brand: string; model: string }> = [];

  try {
    const [catalog, compat] = await Promise.all([api.devices(), api.compatible(id)]);
    device = catalog.devices.find((d) => d.id === id) ?? null;
    items = compat.items;
    others = catalog.devices.filter((d) => d.id !== id).slice(0, 14);
  } catch {
    return notFound();
  }

  return (
    <div className="container-x sf-pt-1" >
      <nav className="crumbs" aria-label="مسیر">
        <Link href="/">خانه</Link>
        <span className="crumbs__sep">/</span>
        <span className="sf-color-500">
          {device ? `${device.brand} ${device.model}` : 'مدل'}
        </span>
      </nav>

      <header
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--st-3)',
          margin: 'var(--st-4) 0 var(--st-5)', flexWrap: 'wrap',
        }}
      >
        <span
          className="trust__icon"
          style={{ width: 52, height: 52 }}
          aria-hidden
        >
          <IconPhone size={26} />
        </span>
        <div>
          <h1 className="sect__title sf-mb-0" >
            {device ? `کالاهای سازگار با ${device.brand} ${device.model}` : 'کالاهای سازگار'}
          </h1>
          <p style={{ margin: 0, color: 'var(--st-500)', fontSize: '1.3rem' }}>
            {items.length > 0
              ? `${items.length} کالا با این مدل سازگار است — بقیه نمایش داده نمی‌شوند تا وقت‌تان صرفِ کالایِ نامناسب نشود.`
              : 'برای این مدل هنوز کالایی ثبت نشده است.'}
          </p>
        </div>
      </header>

      {items.length ? (
        <div className="grid-p">
          {items.map((item) => (
            <ProductCard
              key={item.productId}
              item={{
                slug: item.slug,
                title: item.title,
                priceRial: item.priceRial,
                price: item.price,
                available: item.available,
                // تصویرِ استانداردِ کالا بر اساسِ نامکِ آن (خودمیزبان)
                imageUrl: `/products/${item.slug}.jpg`,
              }}
            />
          ))}
        </div>
      ) : (
        <div className="empty">
          <div className="empty__t">برای این مدل کالایی ثبت نشده است</div>
          <div>مدلِ دیگری را از فهرستِ زیر برگزینید.</div>
        </div>
      )}

      {others.length ? (
        <section className="sect">
          <h2 className="sect__title sf-text-17" >
            مدل‌هایِ دیگر
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--st-2)', marginTop: 'var(--st-3)' }}>
            {others.map((d) => (
              <Link key={d.id} href={`/device/${d.id}`} className="chip">
                {d.brand} {d.model}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
