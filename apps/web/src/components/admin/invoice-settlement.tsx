'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { toman } from '@/lib/format';
import { ShamsiDatePicker } from '@/components/shamsi-date-picker';
import {
  clearSupplierCheckAction,
  loadInvoicePayments,
  paySupplierInvoiceAction,
  type InvoicePaymentsView,
} from '@/lib/procurement-actions';

/**
 * تسویه‌یِ یک فاکتورِ خرید — همان‌جا که مدیر فاکتور را می‌بیند.
 *
 * سه چیز در این قطعه رعایت شده:
 *
 *   ۱) مدیر به تومان می‌نویسد، پایگاه به ریال می‌خواهد؛ تبدیل در کنشِ سرور
 *      انجام می‌شود و اینجا تنها «نمایش» تومان است.
 *   ۲) پرداختِ چکی از پرداختِ نقدی جداست: تا وقتی چک وصول نشده، بدهی در
 *      «اسنادِ پرداختنی» است و دکمه‌یِ «وصول شد» کنارش می‌آید. بی‌این تفکیک،
 *      مدیر خیال می‌کرد پرداخت تمام شده است در حالی که چک برگشت می‌توانست
 *      بخورد.
 *   ۳) هر پرداخت شماره‌یِ سندِ حسابداری‌اش را نشان می‌دهد. اگر پولی جابه‌جا
 *      شود و سند نداشته باشد، یعنی دفتر از واقعیت عقب مانده — و این باید
 *      دیده شود، نه اینکه در یک جدولِ بی‌نام پنهان بماند.
 */

const METHODS: Array<{ key: 'cash' | 'bank' | 'card' | 'check'; label: string }> = [
  { key: 'cash', label: 'نقد (از صندوق)' },
  { key: 'bank', label: 'حواله‌یِ بانکی' },
  { key: 'card', label: 'کارت‌خوان' },
  { key: 'check', label: 'چک' },
];

export function InvoiceSettlement({
  invoiceId,
  payableRial,
}: {
  invoiceId: string;
  payableRial: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<InvoicePaymentsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'bank' | 'card' | 'check'>('cash');
  const [reference, setReference] = useState('');
  // تاریخِ خالی یعنی «امروز»؛ میلادِ آن در سرور ساخته می‌شود تا میانِ
  // رندرِ سرور و مرورگر هیچ اختلافی پیش نیاید
  const [paidAt, setPaidAt] = useState('');

  const refresh = useCallback(() => {
    startTransition(async () => {
      const res = await loadInvoicePayments(invoiceId);
      if (res.ok) {
        setView(res.data);
        setError(null);
      } else {
        setError(res.message);
      }
    });
  }, [invoiceId]);

  useEffect(() => {
    if (!open) return;
    // نخستین باز شدن: مبلغِ پیش‌فرض همان مانده است (تومان)
    if (!amount) setAmount(toman(payableRial));
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const remaining = BigInt(view?.invoice.payableRial ?? payableRial);

  function submit() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await paySupplierInvoiceAction({
        invoiceId,
        amountToman: amount,
        method,
        paidAtJalali: paidAt || null,
        referenceNo: reference || null,
      });
      if (res.ok) {
        setMessage(res.message ?? 'پرداخت ثبت شد.');
        setAmount('');
        setReference('');
        refresh();
      } else {
        setError(res.message);
      }
    });
  }

  function clearCheck(paymentId: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await clearSupplierCheckAction(paymentId, null);
      if (res.ok) {
        setMessage(res.message ?? 'وصولِ چک ثبت شد.');
        refresh();
      } else {
        setError(res.message);
      }
    });
  }

  const settled = remaining === 0n;

  return (
    <span className="settlement">
      <button
        type="button"
        className={`btn btn--xs ${settled ? 'btn--ghost' : 'btn--primary'}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {settled ? 'پرداخت‌ها' : 'تسویه'}
      </button>

      {open ? (
        <div className="settlement__panel">
          {pending && !view ? <p className="muted">در حالِ بارگیری…</p> : null}

          {error ? <div className="alert alert--danger">{error}</div> : null}
          {message ? <div className="alert alert--ok">{message}</div> : null}

          {view ? (
            <>
              <div className="settlement__head">
                <span>
                  کل: <b className="num">{toman(view.invoice.totalRial)}</b> تومان
                </span>
                <span>
                  پرداخت‌شده: <b className="num">{toman(view.invoice.paidRial)}</b>
                </span>
                <span>
                  مانده:{' '}
                  <b className={settled ? 'ok num' : 'bad num'}>
                    {toman(view.invoice.payableRial)}
                  </b>{' '}
                  تومان
                </span>
              </div>

              {view.payments.length > 0 ? (
                <table className="table table--inner">
                  <thead>
                    <tr>
                      <th className="ta-left">مبلغ (تومان)</th>
                      <th>روش</th>
                      <th>تاریخ</th>
                      <th>پیگیری</th>
                      <th>سند</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {view.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="num">{toman(p.amountRial)}</td>
                        <td>{p.methodLabel ?? p.method}</td>
                        <td className="num">{p.paidAtFa}</td>
                        <td className="muted">{p.referenceNo ?? '—'}</td>
                        <td className="num muted">{p.entryNo ?? 'بی‌سند'}</td>
                        <td>
                          {p.method === 'check' && !p.clearedAt ? (
                            <button
                              type="button"
                              className="btn btn--xs btn--ghost"
                              disabled={pending}
                              onClick={() => clearCheck(p.id)}
                              title="چک پاس شد و از حسابِ بانک رفت"
                            >
                              وصول شد
                            </button>
                          ) : p.clearedAt ? (
                            <span className="pill pill--ok">وصول‌شده</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">هنوز پرداختی برای این فاکتور ثبت نشده است.</p>
              )}
            </>
          ) : null}

          {!settled ? (
            <div className="settlement__form">
              <label className="field">
                <span className="field__label">مبلغ (تومان)</span>
                <input
                  className="field__input field__input--sm"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label className="field">
                <span className="field__label">روش</span>
                <select
                  className="field__input field__input--sm"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as typeof method)}
                >
                  {METHODS.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">تاریخ (شمسی)</span>
                <ShamsiDatePicker value={paidAt} onChange={setPaidAt} format="jalali" placeholder="امروز" />
              </label>
              <label className="field">
                <span className="field__label">شماره‌ی پیگیری</span>
                <input
                  className="field__input field__input--sm"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn btn--primary btn--xs"
                onClick={submit}
                disabled={pending}
              >
                {pending ? 'در حالِ ثبت…' : 'ثبتِ پرداخت'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
