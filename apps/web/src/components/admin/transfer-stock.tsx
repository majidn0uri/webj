'use client';

import { useActionState } from 'react';
import { transferStock } from '@/lib/admin-actions';

type State = { error?: string; ok?: string } | null;

export function TransferStock({
  warehouses,
  variants,
}: {
  warehouses: Array<{ id: string; name: string }>;
  variants: Array<{ id: string; sku: string; title: string }>;
}) {
  const [state, formAction, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    return await transferStock(formData);
  }, null);

  return (
    <section className="panel" style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ marginBottom: '1rem' }}>انتقال بین انبارها</h2>
      <form action={formAction} className="sf-grid sf-gap-1">
        <div className="sf-flex sf-gap-1" style={{ flexWrap: 'wrap' }}>
          <label className="sf-grid sf-gap-1" style={{ flex: '1 1 200px' }}>
            <span className="sf-text-sm">انبار مبدأ</span>
            <select name="fromWarehouseId" className="field" required>
              <option value="">انتخاب…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="sf-grid sf-gap-1" style={{ flex: '1 1 200px' }}>
            <span className="sf-text-sm">انبار مقصد</span>
            <select name="toWarehouseId" className="field" required>
              <option value="">انتخاب…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </div>
        <label className="sf-grid sf-gap-1">
          <span className="sf-text-sm">کالا</span>
          <select name="variantId" className="field" required>
            <option value="">انتخاب کالا…</option>
            {variants.map((v) => <option key={v.id} value={v.id}>{v.sku} — {v.title}</option>)}
          </select>
        </label>
        <label className="sf-grid sf-gap-1">
          <span className="sf-text-sm">تعداد</span>
          <input name="quantity" type="number" min={1} className="field num" required placeholder="1" />
        </label>
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? '…' : 'انتقال'}
        </button>
      </form>
      {state?.ok && <p className="sf-text-sm sf-color-ok" style={{ marginTop: '0.5rem' }}>{state.ok}</p>}
      {state?.error && <p className="sf-text-sm sf-color-danger" style={{ marginTop: '0.5rem' }}>{state.error}</p>}
    </section>
  );
}