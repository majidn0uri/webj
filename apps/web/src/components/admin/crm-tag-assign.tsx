'use client';

import { useActionState, useState } from 'react';

type State = { error?: string; ok?: string } | null;

export function CrmTagAssign({
  customerId,
  currentTags,
}: {
  customerId: string;
  currentTags: Array<{ id: string; name: string; color: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState('#6b7280');

  const [state, formAction, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    const name = String(formData.get('name') ?? '').trim();
    const color = String(formData.get('color') ?? '#6b7280');
    if (!name) return { error: 'نام برچسب الزامی است.' };

    // ایجاد برچسب
    const createRes = await fetch('/api/admin/crm/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('admin_token') ?? ''}` },
      body: JSON.stringify({ name, color }),
    });
    if (!createRes.ok) {
      const p = await createRes.json().catch(() => null) as { error?: { message?: string } } | null;
      return { error: p?.error?.message ?? 'ایجاد برچسب ناموفق.' };
    }
    const { id: tagId } = (await createRes.json()) as { id: string };

    // اتصال به مشتری
    const assignRes = await fetch('/api/admin/crm/tags/assign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('admin_token') ?? ''}` },
      body: JSON.stringify({ customerId, tagId }),
    });
    if (!assignRes.ok) return { error: 'اتصال برچسب ناموفق.' };

    setOpen(false);
    setTagName('');
    return { ok: `برچسب «${name}» اعمال شد.` };
  }, null);

  return (
    <>
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setOpen(!open)}>
        + برچسب
      </button>
      {open && (
        <form action={formAction} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
          <input name="name" value={tagName} onChange={(e) => setTagName(e.target.value)}
            className="field" placeholder="نام برچسب" style={{ width: 120 }} required />
          <input name="color" type="color" value={tagColor} onChange={(e) => setTagColor(e.target.value)}
            style={{ width: 32, height: 32, border: 'none', cursor: 'pointer' }} />
          <button type="submit" className="btn btn--sm btn--primary" disabled={pending}>
            {pending ? '…' : 'اعمال'}
          </button>
        </form>
      )}
      {state?.ok && <span className="sf-text-xs sf-color-ok" style={{ marginRight: '0.5rem' }}>{state.ok}</span>}
      {state?.error && <span className="sf-text-xs sf-color-danger" style={{ marginRight: '0.5rem' }}>{state.error}</span>}
    </>
  );
}