'use client';

import { useActionState } from 'react';
import { createInventoryCount, closeInventoryCount } from '@/lib/admin-actions';

type State = { error?: string; ok?: string; countId?: string; differences?: Array<{ sku: string; title: string; system_qty: number; counted_qty: number; diff_qty: number }> } | null;

export function InventoryCount({ warehouses }: { warehouses: Array<{ id: string; name: string }> }) {
  const [state, formAction, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    return await createInventoryCount(formData);
  }, null);

  return (
    <section className="panel" style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ marginBottom: '1rem' }}>شمارش فیزیکی انبار</h2>
      <form action={formAction} className="sf-flex sf-gap-1" style={{ alignItems: 'flex-end' }}>
        <label className="sf-grid sf-gap-1" style={{ flex: 1 }}>
          <span className="sf-text-sm">انبار</span>
          <select name="warehouseId" className="field" required>
            <option value="">انتخاب انبار…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? '…' : 'ایجاد شمارش'}
        </button>
      </form>
      {state?.ok && <p className="sf-text-sm sf-color-ok" style={{ marginTop: '0.5rem' }}>{state.ok}</p>}
      {state?.error && <p className="sf-text-sm sf-color-danger" style={{ marginTop: '0.5rem' }}>{state.error}</p>}
      {state?.countId && (
        <p className="sf-text-xs sf-color-400" style={{ marginTop: '0.25rem' }}>
          شناسه شمارش: <span className="num">{state.countId}</span> — آیتم‌ها در جدول زیر ثبت کنید
        </p>
      )}
    </section>
  );
}

export function InventoryCountClose({ countId }: { countId: string }) {
  const [state, formAction, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    return await closeInventoryCount(formData);
  }, null);

  return (
    <div style={{ marginTop: '1rem' }}>
      <form action={formAction}>
        <input type="hidden" name="countId" value={countId} />
        <label className="sf-grid sf-gap-1" style={{ marginBottom: '0.5rem' }}>
          <span className="sf-text-sm">یادداشت</span>
          <input name="note" className="field" placeholder="اختیاری" />
        </label>
        <button type="submit" className="btn btn--danger" disabled={pending}>
          {pending ? '…' : 'بستن شمارش + نمایش مغایرت'}
        </button>
      </form>
      {state?.ok && <p className="sf-text-sm sf-color-ok" style={{ marginTop: '0.5rem' }}>{state.ok}</p>}
      {state?.error && <p className="sf-text-sm sf-color-danger" style={{ marginTop: '0.5rem' }}>{state.error}</p>}
      {state?.differences && state.differences.length > 0 && (
        <table className="table" style={{ marginTop: '0.5rem' }}>
          <thead>
            <tr>
              <th>SKU</th>
              <th>کالا</th>
              <th className="ta-left">سیستم</th>
              <th className="ta-left">شمارش</th>
              <th className="ta-left">مغایرت</th>
            </tr>
          </thead>
          <tbody>
            {state.differences.map((d) => (
              <tr key={d.sku}>
                <td className="num muted">{d.sku}</td>
                <td>{d.title}</td>
                <td className="num ta-left">{d.system_qty}</td>
                <td className="num ta-left">{d.counted_qty}</td>
                <td className="num ta-left" style={{ color: d.diff_qty > 0 ? 'var(--c-ok)' : 'var(--c-danger)', fontWeight: 700 }}>
                  {d.diff_qty > 0 ? '+' : ''}{d.diff_qty}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}