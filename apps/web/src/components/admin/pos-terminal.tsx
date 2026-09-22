'use client';

import { useActionState, useState } from 'react';
import {
  openShiftAction,
  posSellAction,
  closeShiftAction,
  type ActionState,
} from '@/lib/admin-actions';

export interface ShiftInfo {
  id: string;
  status: string;
  openedAt: string;
  openedByName: string | null;
  salesCount: number;
  salesTotal: string;
  openingCash: string;
}

export interface StockOption {
  variant_id: string;
  sku: string;
  product_title: string;
  on_hand: number;
  reserved: number;
  available: number;
}

interface Line {
  variantId: string;
  label: string;
  quantity: number;
  available: number;
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'نقد',
  card: 'کارت‌خوان',
  card_to_card: 'کارت‌به‌کارت',
  cod: 'پرداخت در محل',
  cheque: 'چک',
};

/**
 * پایانه‌ی فروشِ حضوری.
 *
 * دو تصمیمِ آگاهانه:
 *  ۱) انتخابِ کالا از میانِ کالاهایِ «قابل‌فروش» است، نه همه‌ی کالاها؛
 *     فروشنده نباید بتواند چیزی را بفروشد که موجود نیست.
 *  ۲) هر فروش یک offlineId تازه می‌گیرد. اگر کاربر دوبار کلیک کند یا شبکه
 *     پس از قطعی برگردد، سرور فروشِ دوم را نمی‌پذیرد — مشتری دو بار charge نمی‌شود.
 */
export function PosTerminal({
  shift,
  stock,
  warehouses,
  canSell = true,
}: {
  shift: ShiftInfo | null;
  stock: StockOption[];
  warehouses: Array<{ id: string; name: string }>;
  /** نبودِ این توان یعنی «فقط مشاهده» — حسابدار می‌بیند، فروشنده می‌فروشد */
  canSell?: boolean;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('cash');

  const [openState, openAction, openPending] = useActionState<ActionState, FormData>(
    openShiftAction,
    {},
  );
  const [sellState, sellAction, sellPending] = useActionState<ActionState, FormData>(
    posSellAction,
    {},
  );
  const [closeState, closeAction, closePending] = useActionState<ActionState, FormData>(
    closeShiftAction,
    {},
  );

  const sellable = stock.filter((s) => s.available > 0);

  function addLine(variantId: string) {
    if (!variantId) return;
    const item = stock.find((s) => s.variant_id === variantId);
    if (!item) return;

    setLines((prev) => {
      const found = prev.find((l) => l.variantId === variantId);
      if (found) {
        return prev.map((l) =>
          l.variantId === variantId && l.quantity < item.available
            ? { ...l, quantity: l.quantity + 1 }
            : l,
        );
      }
      return [
        ...prev,
        {
          variantId,
          label: `${item.product_title} (${item.sku})`,
          quantity: 1,
          available: item.available,
        },
      ];
    });
  }

  function setQuantity(variantId: string, quantity: number) {
    setLines((prev) =>
      prev.map((l) =>
        l.variantId === variantId
          ? { ...l, quantity: Math.max(1, Math.min(quantity, l.available)) }
          : l,
      ),
    );
  }

  function removeLine(variantId: string) {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  }

  /* ---------- حالتِ بدون شیفتِ باز ---------- */
  if (!shift) {
    // بیننده (مثلاً حسابدار) شیفت نمی‌گشاید — فقط می‌بیند که شیفتی باز نیست
    if (!canSell) {
      return (
        <section className="panel panel--pad">
          <h2 className="panel__title">وضعیتِ صندوق</h2>
          <p className="empty">هیچ شیفتِ بازی نیست؛ گشایشِ شیفت با فروشنده است.</p>
        </section>
      );
    }

    return (
      <section className="panel panel--pad">
        <h2 className="panel__title">گشایشِ شیفت</h2>
        <p className="empty">هیچ شیفتِ بازی نیست. برای فروشِ حضوری باید شیفت را بگشایید.</p>

        <form action={openAction} className="form">
          <div className="form__grid">
            <label className="field">
              <span className="field__label">انبار</span>
              <select className="field__input" name="warehouseId" required defaultValue="">
                <option value="" disabled>
                  انتخاب کنید
                </option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">موجودیِ اولیه‌ی صندوق (تومان)</span>
              <input
                className="field__input num"
                name="openingCash"
                inputMode="numeric"
                defaultValue="0"
              />
            </label>
          </div>

          {openState.error ? <p className="alert alert--danger">{openState.error}</p> : null}
          {openState.ok ? <p className="adjust__msg adjust__msg--ok">{openState.ok}</p> : null}

          <div className="row-actions">
            <button className="btn btn--primary" type="submit" disabled={openPending}>
              {openPending ? 'در حالِ گشایش…' : 'گشایشِ شیفت'}
            </button>
          </div>
        </form>
      </section>
    );
  }

  /* ---------- حالتِ شیفتِ باز ---------- */
  return (
    <>
      <section className="stats">
        <article className="stat">
          <p className="stat__label">فروش‌هایِ این شیفت</p>
          <p className="stat__value num">{shift.salesCount}</p>
          <p className="stat__hint">تا این لحظه</p>
        </article>
        <article className="stat">
          <p className="stat__label">جمعِ فروش</p>
          <p className="stat__value num stat__value--money">{shift.salesTotal}</p>
          <p className="stat__hint">تومان</p>
        </article>
        <article className="stat">
          <p className="stat__label">موجودیِ اولیه</p>
          <p className="stat__value num">{shift.openingCash}</p>
          <p className="stat__hint">تومان</p>
        </article>
      </section>

      {!canSell ? (
        <section className="panel panel--pad">
          <h2 className="panel__title">فقط مشاهده</h2>
          <p className="field__help">
            شما ارقامِ این شیفت را می‌بینید تا نقد را مغایرت‌گیری کنید. ثبتِ فروش، گشایش و
            بستنِ شیفت نیازمندِ دسترسیِ
            <code className="code"> pos.sell </code>
            است.
          </p>
        </section>
      ) : (
      <section className="panel panel--pad">
        <div className="pos__head">
          <h2 className="panel__title">فروشِ تازه</h2>
          <span className="panel__count">شیفت گشوده توسط {shift.openedByName ?? '—'}</span>
        </div>

        <div className="pos__picker">
          <select
            className="field__input"
            aria-label="افزودنِ کالا"
            defaultValue=""
            onChange={(e) => {
              addLine(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="" disabled>
              کالا را انتخاب کنید…
            </option>
            {sellable.map((s) => (
              <option key={s.variant_id} value={s.variant_id}>
                {s.product_title} — {s.sku} (موجود: {s.available})
              </option>
            ))}
          </select>
        </div>

        {lines.length === 0 ? (
          <p className="empty">کالایی به این فروش اضافه نشده است.</p>
        ) : (
          <form action={sellAction} className="form">
            {/* شناسه‌ی یکتا برای جلوگیری از ثبتِ تکراریِ همان فروش */}
            <input type="hidden" name="offlineId" value={crypto.randomUUID()} />
            <input type="hidden" name="shiftId" value={shift.id} />
            <input type="hidden" name="paymentMethod" value={paymentMethod} />

            <table className="table">
              <thead>
                <tr>
                  <th>کالا</th>
                  <th className="ta-left">تعداد</th>
                  <th className="ta-left">حذف</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.variantId}>
                    <td>{l.label}</td>
                    <td className="ta-left">
                      <input type="hidden" name="variantId" value={l.variantId} />
                      <input
                        className="field__input field__input--xs num"
                        name="quantity"
                        type="number"
                        min={1}
                        max={l.available}
                        value={l.quantity}
                        onChange={(e) => setQuantity(l.variantId, Number(e.target.value))}
                      />
                    </td>
                    <td className="ta-left">
                      <button
                        className="btn btn--ghost btn--xs"
                        type="button"
                        onClick={() => removeLine(l.variantId)}
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="form__grid">
              <label className="field">
                <span className="field__label">شیوه‌ی پرداخت</span>
                <select
                  className="field__input"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                >
                  {Object.entries(PAYMENT_LABEL).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field__label">نامِ مشتری (اختیاری)</span>
                <input className="field__input" name="customerName" />
              </label>

              <label className="field">
                <span className="field__label">موبایل (اختیاری)</span>
                <input className="field__input num" name="customerMobile" inputMode="numeric" />
              </label>
            </div>

            {sellState.error ? <p className="alert alert--danger">{sellState.error}</p> : null}
            {sellState.ok ? <p className="adjust__msg adjust__msg--ok">{sellState.ok}</p> : null}
            {sellState.orderId ? (
              <div className="row-actions" style={{ marginBottom: '0.75rem' }}>
                <a
                  className="btn btn--ghost btn--xs"
                  href={`/api/exports/orders/${sellState.orderId}/invoice.pdf`}
                  target="_blank"
                  rel="noopener"
                >
                  🖨️ چاپ فاکتور
                </a>
              </div>
            ) : null}

            <div className="row-actions">
              <button className="btn btn--primary" type="submit" disabled={sellPending}>
                {sellPending ? 'در حالِ ثبت…' : `ثبتِ فروش (${PAYMENT_LABEL[paymentMethod]})`}
              </button>
              <button className="btn btn--ghost" type="button" onClick={() => setLines([])}>
                پاک‌کردن
              </button>
            </div>
          </form>
        )}
      </section>

      )}

      {canSell ? (
      <section className="panel panel--pad">
        <h2 className="panel__title">بستنِ شیفت</h2>
        <p className="field__help">
          مبلغِ نقدِ موجود در صندوق را بشمارید و وارد کنید. سامانه اختلاف را حساب و ثبت می‌کند؛
          مغایرت پنهان نمی‌شود.
        </p>

        <form action={closeAction} className="form">
          <input type="hidden" name="shiftId" value={shift.id} />
          <div className="form__grid">
            <label className="field">
              <span className="field__label">مبلغِ شمارش‌شده (تومان)</span>
              <input
                className="field__input num"
                name="countedCash"
                inputMode="numeric"
                required
              />
            </label>
            <label className="field">
              <span className="field__label">یادداشت (اختیاری)</span>
              <input className="field__input" name="note" />
            </label>
          </div>

          {closeState.error ? <p className="alert alert--danger">{closeState.error}</p> : null}
          {closeState.ok ? <p className="adjust__msg adjust__msg--ok">{closeState.ok}</p> : null}

          <div className="row-actions">
            <button className="btn btn--primary" type="submit" disabled={closePending}>
              {closePending ? 'در حالِ بستن…' : 'بستنِ شیفت'}
            </button>
          </div>
        </form>
      </section>
      ) : null}
    </>
  );
}
