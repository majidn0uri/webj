'use client';

import { useState } from 'react';

import { requestStockAlert } from '@/lib/packing-actions';

/**
 * «خبرم کن وقتی موجود شد».
 *
 * سه نکته که این دکمه را از یک دکمه‌یِ ساده فراتر می‌برد:
 *
 *  ۱. **تنها هنگامی که کالا نیست** دیده می‌شود. کالایِ موجود را «خبر بده»
 *     معنا ندارد.
 *  ۲. **بی‌حساب هم کار می‌کند**: کسی که وارد نشده شماره می‌نویسد. واداشتنِ
 *     خریدار به ساختنِ حساب در لحظه‌ای که می‌خواهد فقط یک خبر بگیرد، یعنی
 *     از دست دادنش.
 *  ۳. **پاسخ راست می‌گوید**: اگر کالا در فاصله‌یِ دیدنِ صفحه تا زدنِ دکمه
 *     موجود شده باشد، می‌گوید «موجود است»، نه «ثبت شد».
 */

export function StockAlertButton({ variantId }: { variantId: string }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [done, setDone] = useState(false);

  async function send() {
    if (!/^09\d{9}$/.test(phone.trim())) {
      setMessage({ tone: 'bad', text: 'شماره‌یِ همراه را درست بنویسید (مانندِ ۰۹۱۲۳۴۵۶۷۸۹).' });
      return;
    }
    setBusy(true);
    const result = await requestStockAlert(variantId, phone.trim());
    setBusy(false);
    if (result.ok) {
      setMessage({ tone: 'ok', text: result.data.message });
      if (!result.data.available) setDone(true);
    } else setMessage({ tone: 'bad', text: result.message });
  }

  if (done && message?.tone === 'ok') {
    return (
      <p className="stock-alert__ok" role="status">
        {message.text}
      </p>
    );
  }

  return (
    <div className="stock-alert">
      {!open ? (
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(true)}>
          خبرم کن وقتی موجود شد
        </button>
      ) : (
        <div className="stock-alert__form">
          <label className="field">
            <span className="field__label">شماره‌یِ همراه</span>
            <input
              className="field__input num"
              dir="ltr"
              inputMode="tel"
              placeholder="۰۹۱۲۳۴۵۶۷۸۹"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <div className="actions">
            <button className="btn" disabled={busy} onClick={() => void send()}>
              {busy ? 'در حالِ ثبت…' : 'ثبت'}
            </button>
            <button className="btn btn--ghost" onClick={() => setOpen(false)}>
              انصراف
            </button>
          </div>
        </div>
      )}
      {message ? (
        <p className={message.tone === 'ok' ? 'alert alert--ok' : 'alert alert--danger'}>{message.text}</p>
      ) : null}
    </div>
  );
}
