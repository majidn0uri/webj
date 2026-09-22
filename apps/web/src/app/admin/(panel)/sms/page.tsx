import { redirect } from 'next/navigation';
import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';

interface SmsOutboxItem {
  id: string;
  phone: string;
  template_key: string | null;
  body: string;
  status: string;
  provider_ref: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

export default async function SmsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  let items: SmsOutboxItem[] = [];
  try {
    const data = await adminGet<{ items: SmsOutboxItem[] }>('/settings/sms/outbox?limit=100', token);
    items = data.items ?? [];
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
  }

  const stats = {
    total: items.length,
    sent: items.filter((i) => i.status === 'sent').length,
    pending: items.filter((i) => i.status === 'pending').length,
    failed: items.filter((i) => i.status === 'failed').length,
  };

  const statusColor = (s: string) => {
    if (s === 'sent') return 'var(--c-ok)';
    if (s === 'pending') return 'var(--c-warn)';
    return 'var(--c-danger)';
  };

  return (
    <>
      <header className="head">
        <h1 className="head__title">پیامک‌ها</h1>
        <p className="head__sub">
          <span className="num">{stats.total}</span> کل ·{' '}
          <span className="num" style={{ color: 'var(--c-ok)' }}>{stats.sent}</span> ارسال‌شده ·{' '}
          <span className="num" style={{ color: 'var(--c-warn)' }}>{stats.pending}</span> در صف ·{' '}
          <span className="num" style={{ color: 'var(--c-danger)' }}>{stats.failed}</span> ناموفق
        </p>
      </header>

      <section className="panel panel--flush">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>شماره</th>
                <th>قالب</th>
                <th>متن</th>
                <th className="ta-left">وضعیت</th>
                <th className="ta-left">تلاش</th>
                <th className="ta-left">خطا</th>
                <th className="ta-left">تاریخ</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td className="num">{s.phone}</td>
                  <td>{s.template_key ?? '—'}</td>
                  <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.body}
                  </td>
                  <td className="ta-left">
                    <span className="pill" style={{ background: statusColor(s.status), color: '#fff' }}>
                      {s.status === 'sent' ? 'ارسال‌شده' : s.status === 'pending' ? 'در صف' : 'ناموفق'}
                    </span>
                  </td>
                  <td className="num ta-left">{s.attempts}</td>
                  <td className="ta-left" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-danger)' }}>
                    {s.last_error ?? '—'}
                  </td>
                  <td className="num ta-left" style={{ fontSize: '0.75rem' }}>
                    {s.sent_at ? new Date(s.sent_at).toLocaleDateString('fa-IR') : new Date(s.created_at).toLocaleDateString('fa-IR')}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--c-400)' }}>پیامکی ثبت نشده</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}