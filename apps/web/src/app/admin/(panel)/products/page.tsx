import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';
import { ProductForm, type ReferenceData } from '@/components/admin/product-form';

export const dynamic = 'force-dynamic';

interface ProductRow {
  id: string;
  title: string;
  slug: string;
  brand: string | null;
  type: string;
  price: string | null;
  priceRial: number;
  variantCount: number;
  imageUrl?: string | null;
}

interface ProductList {
  total: number;
  count: number;
  items: ProductRow[];
}

export default async function ProductsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  // داده‌ی مرجع فقط با دسترسیِ product.write در دسترس است؛
  // نبودِ اجازه یک خطایِ معنادار است، نه یک فرمِ نیمه‌کار.
  const [productsResult, referenceResult] = await Promise.allSettled([
    adminGet<ProductList>('/catalog/products?limit=100', token),
    adminGet<ReferenceData>('/admin/reference', token),
  ]);

  if (productsResult.status === 'rejected') {
    const err = productsResult.reason;
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
    return <div className="alert alert--danger">کالاها در دسترس نیست: {String(err)}</div>;
  }

  const products = productsResult.value;
  const reference =
    referenceResult.status === 'fulfilled'
      ? referenceResult.value
      : { brands: [], productTypes: [], deviceModels: [] };

  const canCreate = referenceResult.status === 'fulfilled';

  return (
    <>
      <header className="head">
        <h1 className="head__title">کالاها</h1>
        <p className="head__sub">
          <span className="num">{products.total}</span> کالا در کاتالوگ
        </p>
      </header>

      {canCreate ? (
        <section className="panel panel--pad">
          <ProductForm reference={reference} />
        </section>
      ) : (
        <div className="alert alert--danger">
          شما اجازه‌ی ثبتِ کالا ندارید. دسترسیِ
          <code className="code"> product.write </code>
          لازم است.
        </div>
      )}

      <section className="panel panel--flush panel--flush">
        {products.items.length === 0 ? (
          <p className="empty">هنوز کالایی ثبت نشده است.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>کالا</th>
                <th>برند</th>
                <th>نوع</th>
                <th className="ta-left">تنوع</th>
                <th className="ta-left">قیمت</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {products.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="cell__title">{p.title}</span>
                    <span className="muted num"> · {p.slug}</span>
                  </td>
                  <td>{p.brand ?? '—'}</td>
                  <td>{p.type}</td>
                  <td className="num ta-left">{p.variantCount}</td>
                  <td className="num ta-left">
                    {p.price ? `${p.price} تومان` : '—'}
                  </td>
                  <td className="ta-left">
                    <Link className="btn btn--ghost btn--xs" href={`/admin/products/${p.id}`}>
                      ویرایش
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
