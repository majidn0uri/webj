import { redirect, notFound } from 'next/navigation';
import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';
import Link from 'next/link';
import { CrmInteractionForm } from '@/components/admin/crm-interaction-form';
import { CrmFollowUpForm } from '@/components/admin/crm-follow-up-form';
import { CrmTagAssign } from '@/components/admin/crm-tag-assign';

export const dynamic = 'force-dynamic';

const typeLabel: Record<string, string> = {
  call_incoming: '📞 تماس ورودی', call_outgoing: '📞 تماس خروجی', meeting: '🤝 جلسه',
  email: '📧 ایمیل', whatsapp: '💬 واتساپ', sms: '📱 پیامک', note: '📝 یادداشت',
  complaint: '⚠️ شکایت', feedback: '💡 بازخورد', follow_up: '🔄 پیگیری',
};

const activityLabel: Record<string, string> = {
  view_product: '👁️ مشاهده محصول', add_to_cart: '🛒 افزودن به سبد',
  checkout: '💳 تسویه‌حساب', purchase: '✅ خرید', return_request: '↩️ مرجوعی', login: '🔑 ورود',
};

export default async function Customer360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  let data: Record<string, unknown>;
  try {
    data = await adminGet<Record<string, unknown>>(`/crm/customer/${id}/360`, token);
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
    if (err instanceof AdminApiError && err.status === 404) notFound();
    return <div className="alert alert--danger">خطا: {String(err)}</div>;
  }

  const c = data.customer as Record<string, unknown>;
  const tags = data.tags as Array<{ id: string; name: string; color: string }>;
  const stats = data.stats as Record<string, number>;
  const interactions = data.interactions as Array<Record<string, unknown>>;
  const activities = data.activities as Array<Record<string, unknown>>;
  const followUps = data.followUps as Array<Record<string, unknown>>;
  const orders = data.orders as Array<Record<string, unknown>>;
  const addresses = data.addresses as Array<Record<string, unknown>>;

  return (
    <>
      <header className="head">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="head__title">{c.fullName as string}</h1>
            <p className="head__sub">
              <span className="num">{c.phone as string}</span>
              {c.isPartner ? ' · همکار' : ''}
              {c.isActive === false ? ' · غیرفعال' : ''}
            </p>
          </div>
          <Link href="/admin/crm" className="btn btn--ghost">بازگشت</Link>
        </div>
      </header>

      {/* برچسب‌ها */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {tags.map((t) => (
          <span key={t.id} style={{ background: t.color, color: '#fff', padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem' }}>
            {t.name}
          </span>
        ))}
        <CrmTagAssign customerId={id} currentTags={tags} />
      </div>

      {/* آمار */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="panel" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{(stats.totalOrders as number).toLocaleString('fa-IR')}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--c-400)' }}>کل سفارشات</div>
        </div>
        <div className="panel" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{(stats.totalSpentToman as number).toLocaleString('fa-IR')}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--c-400)' }}>کل خرید (تومان)</div>
        </div>
        <div className="panel" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--c-ok)' }}>{(stats.delivered as number).toLocaleString('fa-IR')}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--c-400)' }}>تحویل‌شده</div>
        </div>
        <div className="panel" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--c-danger)' }}>{(stats.cancelled as number).toLocaleString('fa-IR')}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--c-400)' }}>لغو‌شده</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
        {/* ستون اصلی */}
        <div>
          {/* ثبت تعامل جدید */}
          <CrmInteractionForm customerId={id} />

          {/* لیست تعاملات */}
          <section className="panel" style={{ marginTop: '1.5rem' }}>
            <h2 style={{ marginBottom: '1rem' }}>تعاملات</h2>
            {interactions.length === 0 ? (
              <p style={{ color: 'var(--c-400)', textAlign: 'center', padding: '1rem' }}>تعاملی ثبت نشده</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {interactions.map((i) => (
                  <div key={i.id as string} style={{ border: '1px solid var(--c-border)', borderRadius: '0.5rem', padding: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                      <span style={{ fontWeight: 600 }}>{typeLabel[i.type as string] ?? i.type as string}</span>
                      <span className="num" style={{ fontSize: '0.75rem', color: 'var(--c-400)' }}>
                        {new Date(i.created_at as string).toLocaleDateString('fa-IR')}
                      </span>
                    </div>
                    <div style={{ fontWeight: 500 }}>{i.subject as string}</div>
                    {i.body ? <div style={{ fontSize: '0.85rem', color: 'var(--c-600)', marginTop: '0.25rem' }}>{i.body as string}</div> : null}
                    {i.outcome ? <div style={{ fontSize: '0.8rem', color: 'var(--c-ok)', marginTop: '0.25rem' }}>نتیجه: {i.outcome as string}</div> : null}
                    {i.next_action ? <div style={{ fontSize: '0.8rem', color: 'var(--c-warn)', marginTop: '0.25rem' }}>اقدام بعدی: {i.next_action as string}</div> : null}
                    <div style={{ fontSize: '0.7rem', color: 'var(--c-400)', marginTop: '0.25rem' }}>
                      توسط: {i.created_by_name as string ?? '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* سفارشات */}
          <section className="panel" style={{ marginTop: '1.5rem' }}>
            <h2 style={{ marginBottom: '1rem' }}>سفارشات اخیر</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>شماره</th><th>وضعیت</th><th>مبلغ</th><th>تاریخ</th></tr></thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id as string}>
                      <td><Link href={`/admin/orders/${o.id as string}`} className="num" style={{ color: 'var(--c-brand)' }}>{o.orderNo as string}</Link></td>
                      <td>{o.status as string}</td>
                      <td className="num">{(o.totalToman as number).toLocaleString('fa-IR')} ت</td>
                      <td className="num" style={{ fontSize: '0.75rem' }}>{new Date(o.createdAt as string).toLocaleDateString('fa-IR')}</td>
                    </tr>
                  ))}
                  {orders.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: '1rem', color: 'var(--c-400)' }}>سفارشی نیست</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* ستون جانبی */}
        <div>
          {/* یادآوری‌ها */}
          <section className="panel">
            <h2 style={{ marginBottom: '1rem' }}>یادآوری پیگیری</h2>
            <CrmFollowUpForm customerId={id} />
            {followUps.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                {followUps.map((f) => (
                  <div key={f.id as string} style={{ border: '1px solid var(--c-border)', borderRadius: '0.5rem', padding: '0.5rem', marginBottom: '0.5rem' }}>
                    <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{f.title as string}</div>
                    <div className="num" style={{ fontSize: '0.75rem', color: 'var(--c-warn)' }}>
                      سررسید: {new Date(f.due_at as string).toLocaleDateString('fa-IR')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* آدرس‌ها */}
          <section className="panel" style={{ marginTop: '1rem' }}>
            <h2 style={{ marginBottom: '0.5rem' }}>آدرس‌ها</h2>
            {addresses.map((a) => (
              <div key={a.id as string} style={{ fontSize: '0.8rem', marginBottom: '0.5rem', padding: '0.5rem', background: 'var(--c-surface-2)', borderRadius: '0.25rem' }}>
                <div style={{ fontWeight: 500 }}>{a.receiver_name as string} — {a.phone as string}</div>
                <div>{a.city as string}، {a.address as string}</div>
                {a.is_default ? <span style={{ fontSize: '0.7rem', color: 'var(--c-ok)' }}>پیش‌فرض</span> : null}
              </div>
            ))}
            {addresses.length === 0 && <p style={{ color: 'var(--c-400)', fontSize: '0.8rem' }}>آدرسی ثبت نشده</p>}
          </section>

          {/* فعالیت‌ها */}
          <section className="panel" style={{ marginTop: '1rem' }}>
            <h2 style={{ marginBottom: '0.5rem' }}>فعالیت‌ها</h2>
            {activities.slice(0, 10).map((a) => (
              <div key={a.id as string} style={{ fontSize: '0.75rem', marginBottom: '0.25rem', color: 'var(--c-600)' }}>
                {activityLabel[a.activity_type as string] ?? a.activity_type as string}
                <span className="num" style={{ marginRight: '0.5rem', color: 'var(--c-400)' }}>
                  {new Date(a.created_at as string).toLocaleDateString('fa-IR')}
                </span>
              </div>
            ))}
            {activities.length === 0 && <p style={{ color: 'var(--c-400)', fontSize: '0.8rem' }}>فعالیتی ثبت نشده</p>}
          </section>
        </div>
      </div>
    </>
  );
}