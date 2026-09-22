'use client';

import { useActionState } from 'react';

type State = { error?: string; ok?: string } | null;

export function CrmInteractionForm({ customerId }: { customerId: string }) {
  const [state, formAction, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    const body = {
      customerId,
      type: formData.get('type'),
      subject: formData.get('subject'),
      body: formData.get('body') || undefined,
      outcome: formData.get('outcome') || undefined,
      priority: formData.get('priority') || 'normal',
      nextAction: formData.get('nextAction') || undefined,
    };
    const res = await fetch('/api/admin/crm/interactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('admin_token') ?? ''}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const p = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      return { error: p?.error?.message ?? 'ثبت نشد.' };
    }
    return { ok: 'تعامل ثبت شد.' };
  }, null);

  return (
    <section className="panel">
      <h2 style={{ marginBottom: '1rem' }}>ثبت تعامل جدید</h2>
      <form action={formAction} className="sf-grid sf-gap-1">
        <div className="sf-flex sf-gap-1" style={{ flexWrap: 'wrap' }}>
          <label className="sf-grid sf-gap-1" style={{ flex: '1 1 200px' }}>
            <span className="sf-text-sm">نوع</span>
            <select name="type" className="field" required>
              <option value="call_incoming">📞 تماس ورودی</option>
              <option value="call_outgoing">📞 تماس خروجی</option>
              <option value="meeting">🤝 جلسه</option>
              <option value="email">📧 ایمیل</option>
              <option value="whatsapp">💬 واتساپ</option>
              <option value="sms">📱 پیامک</option>
              <option value="note">📝 یادداشت</option>
              <option value="complaint">⚠️ شکایت</option>
              <option value="feedback">💡 بازخورد</option>
              <option value="follow_up">🔄 پیگیری</option>
            </select>
          </label>
          <label className="sf-grid sf-gap-1" style={{ flex: '1 1 120px' }}>
            <span className="sf-text-sm">اولویت</span>
            <select name="priority" className="field">
              <option value="low">پایین</option>
              <option value="normal" selected>عادی</option>
              <option value="high">بالا</option>
              <option value="urgent">فوری</option>
            </select>
          </label>
        </div>
        <label className="sf-grid sf-gap-1">
          <span className="sf-text-sm">موضوع</span>
          <input name="subject" required minLength={2} className="field" placeholder="موضوع تعامل" />
        </label>
        <label className="sf-grid sf-gap-1">
          <span className="sf-text-sm">توضیحات</span>
          <textarea name="body" rows={3} className="field" placeholder="جزئیات (اختیاری)" />
        </label>
        <label className="sf-grid sf-gap-1">
          <span className="sf-text-sm">نتیجه</span>
          <input name="outcome" className="field" placeholder="مثال: منتظر پاسخ، حل شد" />
        </label>
        <label className="sf-grid sf-gap-1">
          <span className="sf-text-sm">اقدام بعدی</span>
          <input name="nextAction" className="field" placeholder="مثال: تماس مجدد هفته آینده" />
        </label>
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? '…' : 'ثبت تعامل'}
        </button>
      </form>
      {state?.ok && <p className="sf-text-sm sf-color-ok" style={{ marginTop: '0.5rem' }}>{state.ok}</p>}
      {state?.error && <p className="sf-text-sm sf-color-danger" style={{ marginTop: '0.5rem' }}>{state.error}</p>}
    </section>
  );
}