import { redirect } from 'next/navigation';
import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

interface Segment {
  id: string; name: string; description: string | null; rules: string; is_active: boolean; created_at: string;
}

export default async function SegmentsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  let items: Segment[] = [];
  try {
    const data = await adminGet<{ items: Segment[] }>('/admin/crm/segments', token);
    items = data.items ?? [];
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
  }

  return (
    <>
      <header className="head">
        <h1 className="head__title">بخش‌بندی مشتریان</h1>
        <p className="head__sub"><span className="num">{items.length}</span> بخش</p>
      </header>

      <section className="panel panel--flush">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>نام</th><th>توضیح</th><th>قوانین</th><th className="ta-left">وضعیت</th></tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>{s.description ?? '—'}</td>
                  <td><code style={{ fontSize: '0.7rem' }}>{s.rules}</code></td>
                  <td className="ta-left">
                    <span className={`pill pill--${s.is_active ? 'ok' : 'muted'}`}>
                      {s.is_active ? 'فعال' : 'غیرفعال'}
                    </span>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--c-400)' }}>بخشی تعریف نشده</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}