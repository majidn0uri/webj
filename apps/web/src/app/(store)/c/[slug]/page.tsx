import Link from 'next/link';
import { notFound } from 'next/navigation';

import { loadCategoryDetail } from '@/lib/category-actions';
import { ProductCard } from '@/components/store/product-card';

export const revalidate = 60;

/**
 * تنها سه اسلاگ — به‌عمد، برای یک آزمایش: اگر برگه‌یِ دسته‌ای که اینجا
 * **نامش نیست** هم پس از نخستین درخواست کش شود، یعنی کشِ درخواستی کار
 * می‌کند و این تابع فقط برایِ گرم‌بودنِ آغازِ کار است، نه برایِ اصلِ کش.
 */
export async function generateStaticParams() {
  try {
    const { loadCategoryTree } = await import('@/lib/category-actions');
    const tree = await loadCategoryTree();
    return tree.map((c: { slug: string }) => ({ slug: c.slug }));
  } catch {
    // بی‌دسترسی به API (مثلاً در اجرایِ خودکار که پایگاه ندارد) ساخت نباید
    // بشکند. برگه‌ها در زمانِ درخواست ساخته و سپس کش می‌شوند؛ فقط نخستین
    // بازدیدِ هر برگه کمی گران‌تر است.
    return [];
  }
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { category, ancestors, children, products, total } = await loadCategoryDetail(slug);

  if (!category) notFound();

  return (
    <div className="container-x">
      {/* ---------- نانِ راهنما ---------- */}
      <nav className="crumbs" aria-label="مسیر">
        <Link href="/" className="crumbs__item">
          فروشگاه
        </Link>
        {ancestors.map((item) => (
          <span key={item.id} className="crumbs__sep">
            <Link href={`/c/${item.slug}`} className="crumbs__item">
              {item.name}
            </Link>
          </span>
        ))}
        <span className="crumbs__sep">
          <span className="crumbs__current" aria-current="page">
            {category.name}
          </span>
        </span>
      </nav>

      <header className="cathead">
        <h1 className="cathead__title">{category.name}</h1>
        <p className="cathead__sub">
          {total > 0 ? `${total} کالا در این دسته و زیردسته‌هایش` : 'هنوز کالایی در این دسته نیست'}
        </p>
        {category.description ? <p className="cathead__desc">{category.description}</p> : null}
      </header>

      {/* ---------- زیردسته‌ها ---------- */}
      {children.length > 0 ? (
        <section className="subcats" aria-label="زیردسته‌ها">
          {children.map((child) => (
            <Link key={child.id} href={`/c/${child.slug}`} className="subcat">
              <span className="subcat__name">{child.name}</span>
              <span className="subcat__count num">{child.totalCount} کالا</span>
            </Link>
          ))}
        </section>
      ) : null}

      {/* ---------- کالاها ---------- */}
      {products.length > 0 ? (
        <section className="sect">
          <div className="sect__head">
            <h2 className="sect__title">کالاهایِ این دسته</h2>
            <Link href={`/search?cat=${category.slug}`} className="sect__more">
              دیدنِ همه ←
            </Link>
          </div>
          <div className="grid-p">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                item={{
                  slug: product.slug,
                  title: product.title,
                  priceRial: product.priceRial,
                  price: product.price,
                  brand: product.brand,
                  imageUrl: product.imageUrl ?? null,
                  imageCardUrl: product.imageCardUrl ?? null,
                  imagePlaceholder: product.imagePlaceholder ?? null,
                  variantId: product.variantId ?? null,
                }}
              />
            ))}
          </div>
        </section>
      ) : (
        <p className="empty">در این دسته هنوز کالایی نیست.</p>
      )}
    </div>
  );
}
