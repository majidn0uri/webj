import { redirect } from 'next/navigation';
import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';
import Link from 'next/link';
import { FollowUpActions } from '@/components/admin/crm-followup-actions';

export const dynamic = 'force-dynamic';

interface FollowUp {
  id: string; title: string; description: string | null; due_at: string; status: string;
  customer_name: string; customer_phone: string; customer_id: string;
  assigned_to_name: string | null;
}

export default async function FollowUpsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  let items: FollowUp[] = [];
  try {
    const data = await adminGet<{ items: FollowUp[] }>('/admin/crm/follow-ups?status=pending', token);
    items = data.items ?? [];
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
  }

  const now = new Date();
  const overdue = items.filter((i) => new Date(i.due_at) < now);
  const upcoming = items.filter((i) => new Date(i.due_at) >= now);

  return (
    <>
      <header className="head">
        <h1 className="head__title">یادآوری‌های پیگیری</h1>
        <p className="head__sub">
          <span className="num" style={{ color: 'var(--c-danger)' }}>{overdue.length}</span> سررسیده ·{' '}
          <span className="num">{upcoming.length}</span> در انتظار
        </p>
      </header>

      {overdue.length > 0 && (
        <section className="panel" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--c-danger)' }}>
          <h2 style={{ marginBottom: '1rem', color: 'var(--c-danger)' }}>⚠️ سررسیده</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>مشتری</th><th>عنوان</th><th>سررسید</th><th>مسئول</th><th>عملیات</th></tr></thead>
              <tbody>
                {overdue.map((f) => (
                  <tr key={f.id}>
                    <td><Link href={`/admin/crm/customer/${f.customer_id}`} style={{ color: 'var(--c-brand)' }}>{f.customer_name}</Link></td>
                    <td>{f.title}</td>
                    <td className="num" style={{ color: 'var(--c-danger)' }}>{new Date(f.due_at).toLocaleDateString('fa-IR')}</td>
                    <td>{f.assigned_to_name ?? '—'}</td>
                    <td><FollowUpActions id={f.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel panel--flush">
        <h2 style={{ padding: '1rem 1rem 0' }}>در انتظار</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>مشتری</th><th>عنوان</th><th>سررسید</th><th>مسئول</th><th>عملیات</th></tr></thead>
            <tbody>
              {upcoming.map((f) => (
                <tr key={f.id}>
                  <td><Link href={`/admin/crm/customer/${f.customer_id}`} style={{ color: 'var(--c-brand)' }}>{f.customer_name}</Link></td>
                  <td>{f.title}</td>
                  <td className="num">{new Date(f.due_at).toLocaleDateString('fa-IR')}</td>
                  <td>{f.assigned_to_name ?? '—'}</td>
                  <td><FollowUpActions id={f.id} /></td>
                </tr>
              ))}
              {upcoming.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--c-400)' }}>یادآوری فعالی نیست</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}