'use client';

import { useActionState } from 'react';
import { ShamsiDatePicker } from '@/components/shamsi-date-picker';

type State = { error?: string; ok?: string } | null;

export function CrmFollowUpForm({ customerId }: { customerId: string }) {
  const [state, formAction, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    const body = {
      customerId,
      title: formData.get('title'),
      description: formData.get('description') || undefined,
      dueAt: formData.get('dueAt'),
    };
    const res = await fetch('/api/admin/crm/follow-ups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('admin_token') ?? ''}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const p = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      return { error: p?.error?.message ?? 'ثبت نشد.' };
    }
    return { ok: 'یادآوری ثبت شد.' };
  }, null);

  return (
    <form action={formAction} className="sf-grid sf-gap-1">
      <input name="title" required minLength={2} className="field" placeholder="عنوان یادآوری" />
      <input name="description" className="field" placeholder="توضیحات (اختیاری)" />
      <ShamsiDatePicker name="dueAt" format="iso" required />
      <button type="submit" className="btn btn--sm btn--primary" disabled={pending}>
        {pending ? '…' : 'افزودن یادآوری'}
      </button>
      {state?.ok && <p className="sf-text-xs sf-color-ok">{state.ok}</p>}
      {state?.error && <p className="sf-text-xs sf-color-danger">{state.error}</p>}
    </form>
  );
}