import { redirect } from 'next/navigation';
import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

interface Tag {
  id: string; name: string; color: string; description: string | null; customer_count: number;
}

export default async function TagsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  let items: Tag[] = [];
  try {
    const data = await adminGet<{ items: Tag[] }>('/admin/crm/tags', token);
    items = data.items ?? [];
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
  }

  return (
    <>
      <header className="head">
        <h1 className="head__title">برچسب‌های مشتری</h1>
        <p className="head__sub"><span className="num">{items.length}</span> برچسب</p>
      </header>

      <section className="panel panel--flush">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>برچسب</th><th>رنگ</th><th>توضیح</th><th className="ta-left">تعداد مشتری</th></tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: t.color, marginRight: '0.5rem' }} />
                    {t.name}
                  </td>
                  <td className="num muted">{t.color}</td>
                  <td>{t.description ?? '—'}</td>
                  <td className="num ta-left" style={{ fontWeight: 700 }}>{t.customer_count}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--c-400)' }}>برچسبی تعریف نشده</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}