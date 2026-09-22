import { redirect } from 'next/navigation';
import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface CrmStats {
  totalCustomers: number;
  totalInteractions: number;
  pendingFollowUps: number;
  overdueFollowUps: number;
  activePartners: number;
  vipCount: number;
  complaintCount: number;
  recentInteractions: Array<{
    id: string; type: string; subject: string; priority: string; created_at: string;
    customer_name: string; customer_phone: string;
  }>;
  overdueItems: Array<{
    id: string; title: string; due_at: string;
    customer_name: string; customer_phone: string; customer_id: string;
  }>;
  topCustomers: Array<{
    id: string; full_name: string; phone: string; interaction_count: number;
  }>;
}

const typeLabel: Record<string, string> = {
  call_incoming: '📞 تماس ورودی',
  call_outgoing: '📞 تماس خروجی',
  meeting: '🤝 جلسه',
  email: '📧 ایمیل',
  whatsapp: '💬 واتساپ',
  sms: '📱 پیامک',
  note: '📝 یادداشت',
  complaint: '⚠️ شکایت',
  feedback: '💡 بازخورد',
  follow_up: '🔄 پیگیری',
};

const priorityColor: Record<string, string> = {
  low: 'var(--c-400)',
  normal: 'var(--c-text)',
  high: 'var(--c-warn)',
  urgent: 'var(--c-danger)',
};

export default async function CrmDashboardPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  let stats: CrmStats;
  try {
    stats = await adminGet<CrmStats>('/admin/crm/stats', token);
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
    return <div className="alert alert--danger">خطا: {String(err)}</div>;
  }

  return (
    <>
      <header className="head">
        <h1 className="head__title">CRM — مدیریت ارتباط با مشتری</h1>
      </header>

      {/* آمار کلیدی */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'مشتریان فعال', value: stats.totalCustomers, color: 'var(--c-brand)' },
          { label: 'تعاملات ثبت‌شده', value: stats.totalInteractions, color: 'var(--c-brand)' },
          { label: 'یادآوری در انتظار', value: stats.pendingFollowUps, color: 'var(--c-warn)' },
          { label: 'یادآوری سررسیده', value: stats.overdueFollowUps, color: 'var(--c-danger)' },
          { label: 'همکاران فعال', value: stats.activePartners, color: 'var(--c-ok)' },
          { label: 'مشتریان VIP', value: stats.vipCount, color: '#f59e0b' },
          { label: 'شکایات', value: stats.complaintCount, color: 'var(--c-danger)' },
        ].map((s) => (
          <div key={s.label} className="panel" style={{ padding: '1rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: s.color }}>{s.value.toLocaleString('fa-IR')}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--c-400)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* یادآوری‌های سررسیده */}
      {stats.overdueItems.length > 0 && (
        <section className="panel" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--c-danger)' }}>
          <h2 style={{ marginBottom: '1rem', color: 'var(--c-danger)' }}>⚠️ یادآوری‌های سررسیده</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>مشتری</th><th>عنوان</th><th>سررسید</th><th>عملیات</th></tr>
              </thead>
              <tbody>
                {stats.overdueItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link href={`/admin/crm/customer/${item.customer_id}`} style={{ color: 'var(--c-brand)' }}>
                        {item.customer_name}
                      </Link>
                      <span className="num muted" style={{ marginRight: '0.5rem' }}>{item.customer_phone}</span>
                    </td>
                    <td>{item.title}</td>
                    <td className="num" style={{ color: 'var(--c-danger)' }}>
                      {new Date(item.due_at).toLocaleDateString('fa-IR')}
                    </td>
                    <td>
                      <Link href={`/admin/crm/customer/${item.customer_id}`} className="btn btn--sm btn--ghost">
                        مشاهده
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* آخرین تعاملات */}
        <section className="panel">
          <h2 style={{ marginBottom: '1rem' }}>آخرین تعاملات</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>مشتری</th><th>نوع</th><th>موضوع</th><th>تاریخ</th></tr>
              </thead>
              <tbody>
                {stats.recentInteractions.map((i) => (
                  <tr key={i.id}>
                    <td>{i.customer_name}</td>
                    <td>{typeLabel[i.type] ?? i.type}</td>
                    <td style={{ color: priorityColor[i.priority] }}>{i.subject}</td>
                    <td className="num" style={{ fontSize: '0.75rem' }}>
                      {new Date(i.created_at).toLocaleDateString('fa-IR')}
                    </td>
                  </tr>
                ))}
                {stats.recentInteractions.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: '1rem', color: 'var(--c-400)' }}>تعاملی ثبت نشده</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* مشتریان پرتعامل */}
        <section className="panel">
          <h2 style={{ marginBottom: '1rem' }}>مشتریان پرتعامل (۳۰ روز اخیر)</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>مشتری</th><th>تلفن</th><th>تعداد تعامل</th></tr>
              </thead>
              <tbody>
                {stats.topCustomers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/admin/crm/customer/${c.id}`} style={{ color: 'var(--c-brand)' }}>
                        {c.full_name}
                      </Link>
                    </td>
                    <td className="num">{c.phone}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{c.interaction_count}</td>
                  </tr>
                ))}
                {stats.topCustomers.length === 0 && (
                  <tr><td colSpan={3} style={{ textAlign: 'center', padding: '1rem', color: 'var(--c-400)' }}>داده‌ای نیست</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* لینک‌های سریع */}
      <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
        <Link href="/admin/crm/follow-ups" className="btn btn--ghost">📋 یادآوری‌ها</Link>
        <Link href="/admin/crm/tags" className="btn btn--ghost">🏷️ برچسب‌ها</Link>
        <Link href="/admin/crm/segments" className="btn btn--ghost">👥 بخش‌بندی</Link>
        <Link href="/admin/customers" className="btn btn--ghost">👤 لیست مشتریان</Link>
      </div>
    </>
  );
}