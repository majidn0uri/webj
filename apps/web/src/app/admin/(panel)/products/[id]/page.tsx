import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';
import {
  ProductEditForm,
  type ProductDetail,
} from '@/components/admin/product-edit-form';
import type { ReferenceData } from '@/components/admin/product-form';

export const dynamic = 'force-dynamic';

/**
 * صفحه‌ی ویرایشِ کالا.
 *
 * چرا صفحه‌ای جدا و نه یک فرمِ بازشو در فهرست؟ چون ویرایشِ یک کالا کارِ
 * «یک‌باره» نیست: فروشنده قیمت را با فاکتورِ تأمین‌کننده مقایسه می‌کند،
 * گوشی‌هایِ سازگار را مرور می‌کند و تصویرها را می‌چیند. این کار به فضایِ
 * کاملِ صفحه و نشانیِ قابلِ نشان‌گذاری نیاز دارد.
 */
export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const [detailResult, referenceResult] = await Promise.allSettled([
    adminGet<ProductDetail>(`/catalog/products/${encodeURIComponent(id)}/edit`, token),
    adminGet<ReferenceData>('/admin/reference', token),
  ]);

  if (detailResult.status === 'rejected') {
    const err = detailResult.reason;
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
    return (
      <>
        <header className="head">
          <h1 className="head__title">ویرایشِ کالا</h1>
        </header>
        <div className="alert alert--danger">
          {err instanceof AdminApiError && err.status === 403
            ? 'اجازه‌ی ویرایشِ کالا ندارید (دسترسیِ product.write لازم است).'
            : 'این کالا در دسترس نیست.'}
        </div>
        <p style={{ marginTop: 'var(--s-4)' }}>
          <Link className="btn btn--ghost" href="/admin/products">
            بازگشت به فهرستِ کالاها
          </Link>
        </p>
      </>
    );
  }

  if (referenceResult.status === 'rejected') {
    return <div className="alert alert--danger">داده‌ی مرجع (برندها، نوع‌ها، مدل‌ها) در دسترس نیست.</div>;
  }

  const product = detailResult.value;
  const reference = referenceResult.value;

  return (
    <>
      <header className="head">
        <div>
          <h1 className="head__title">{product.title}</h1>
          <p className="head__sub">
            <span className="num">{product.slug}</span> ·{' '}
            <span className="num">{product.variants.length}</span> تنوع · وضعیت:{' '}
            {product.status === 'active' ? 'فعال' : product.status === 'draft' ? 'پیش‌نویس' : 'بایگانی'}
          </p>
        </div>
        <Link className="btn btn--ghost" href="/admin/products">
          بازگشت به فهرست
        </Link>
      </header>

      <section className="panel panel--pad">
        <ProductEditForm product={product} reference={reference} />
      </section>

      <p className="panel__note">
        هر تغییر در گزارشِ حسابرسی ثبت می‌شود؛ به‌ویژه تغییرِ قیمت (از چه مبلغی به چه مبلغی) تا
        اگر مشتری کالا را با قیمتِ پیشین در سبد داشت، بشود صادقانه به او اطلاع داد.
      </p>
    </>
  );
}
