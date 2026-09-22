'use client';

import { useActionState, useState } from 'react';
import { adjustStockAction, type ActionState } from '@/lib/admin-actions';

/**
 * تعدیلِ موجودی در همان ردیفِ جدول.
 *
 * چرا در ردیف و نه در صفحه‌ای جدا؟ چون انباردار معمولاً چند کالا را پشتِ سرِ هم
 * تعدیل می‌کند؛ رفت‌وبرگشت به صفحه‌ای دیگر برای هر کالا، سرعتِ شمارش را
 * از بین می‌برد. فرمِ هر ردیف مستقل است و فقط همان ردیف را به‌روز می‌کند.
 */
export function StockAdjust({
  variantId,
  sku,
  available,
}: {
  variantId: string;
  sku: string;
  available: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(adjustStockAction, {});

  if (!open) {
    return (
      <button className="btn btn--ghost btn--xs" type="button" onClick={() => setOpen(true)}>
        تعدیل
      </button>
    );
  }

  return (
    <div className="adjust">
      <form action={action} className="adjust__form">
        <input type="hidden" name="variantId" value={variantId} />

        <input
          className="field__input field__input--xs num"
          name="delta"
          type="number"
          step="1"
          inputMode="numeric"
          aria-label={`مقدارِ تعدیل برای ${sku}`}
          placeholder="+/-"
          required
        />

        <select className="field__input field__input--xs" name="reason" defaultValue="count" aria-label="دلیل">
          <option value="count">شمـارش</option>
          <option value="purchase">خرید</option>
          <option value="return">برگشتی</option>
          <option value="adjust">اصلاح</option>
          <option value="transfer">انتقال</option>
        </select>

        <button className="btn btn--primary btn--xs" type="submit" disabled={pending}>
          {pending ? '…' : 'ثبت'}
        </button>
        <button className="btn btn--ghost btn--xs" type="button" onClick={() => setOpen(false)}>
          بستن
        </button>
      </form>

      {state.error ? <p className="adjust__msg adjust__msg--err">{state.error}</p> : null}
      {state.ok ? <p className="adjust__msg adjust__msg--ok">{state.ok}</p> : null}
      {available <= 3 ? (
        <p className="adjust__msg adjust__msg--warn">موجودیِ این کالا کم است.</p>
      ) : null}
    </div>
  );
}
