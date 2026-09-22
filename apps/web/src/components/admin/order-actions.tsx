'use client';

import { useState } from 'react';

import { packOrder, shipOrder, unpackOrder, confirmOrder } from '@/lib/packing-actions';

/**
 * گامِ بعدیِ یک سفارش.
 *
 * چرا تنها یک دکمه، نه فهرستی از دکمه‌ها؟ چون مهارِ گذار در کارساز است و
 * نشان دادنِ گزینه‌ای که پذیرفته نمی‌شود، فروشنده را به خطایی می‌راند که
 * تقصیرِ او نیست. اینجا تنها همان گامی نشان داده می‌شود که اکنون رواست:
 *
 *   پرداخت‌شده → تأیید سفارش (توسط مدیر)
 *   تأییدشده → بسته‌بندی شد
 *   در حالِ بسته‌بندی → ارسال (با کدِ رهگیری) یا بازگشت
 *   ارسال‌شده → تحویل
 *
 * و اگر کسری ثبت شده باشد، همان‌جا گفته می‌شود — پیش از آنکه کسی کدِ
 * رهگیری بگیرد و بسته‌ای ناقص برود.
 */

type Status = { tone: 'ok' | 'bad'; text: string } | null;

export function OrderActions({
  id,
  status,
  packingComplete,
}: {
  id: string;
  status: string;
  packingComplete: boolean | null;
}) {
  const [busy, setBusy] = useState(false);
  const [status_, setStatus] = useState<Status>(null);
  const [tracking, setTracking] = useState('');
  const [askingTracking, setAskingTracking] = useState(false);

  async function confirm() {
    setBusy(true);
    const result = await confirmOrder(id);
    setBusy(false);
    setStatus(result.ok ? { tone: 'ok', text: result.data.message } : { tone: 'bad', text: result.message });
  }

  async function pack() {
    setBusy(true);
    const result = await packOrder(id);
    setBusy(false);
    setStatus(result.ok ? { tone: 'ok', text: result.data.message } : { tone: 'bad', text: result.message });
  }

  async function unpack() {
    setBusy(true);
    const result = await unpackOrder(id);
    setBusy(false);
    setStatus(result.ok ? { tone: 'ok', text: result.data.message } : { tone: 'bad', text: result.message });
  }

  async function ship() {
    setBusy(true);
    const result = await shipOrder(id, { trackingCode: tracking.trim(), carrier: 'پست' });
    setBusy(false);
    setAskingTracking(false);
    setTracking('');
    setStatus(result.ok ? { tone: 'ok', text: result.data.message } : { tone: 'bad', text: result.message });
  }

  return (
    <span className="row-actions" dir="rtl">
      {status === 'paid' ? (
        <button className="btn btn--xs" disabled={busy} onClick={() => void confirm()}>
          تأیید سفارش
        </button>
      ) : null}

      {status === 'confirmed' ? (
        <button className="btn btn--xs" disabled={busy} onClick={() => void pack()}>
          بسته‌بندی شد
        </button>
      ) : null}

      {status === 'packing' ? (
        <>
          {packingComplete === false ? (
            <span className="hint-cell text-warn" >
              کسری دارد — تا رسیدنِ کالا ارسال نمی‌شود
            </span>
          ) : null}
          {!askingTracking ? (
            <button className="btn btn--xs" disabled={busy} onClick={() => setAskingTracking(true)}>
              ثبتِ ارسال
            </button>
          ) : (
            <>
              <input
                className="field__input num u-w-10rem"
                
                placeholder="کدِ رهگیری"
                value={tracking}
                onChange={(event) => setTracking(event.target.value)}
              />
              <button
                className="btn btn--xs"
                disabled={busy || tracking.trim().length < 6}
                onClick={() => void ship()}
              >
                تأیید
              </button>
              <button className="btn btn--xs btn--ghost" onClick={() => setAskingTracking(false)}>
                انصراف
              </button>
            </>
          )}
          <button className="btn btn--xs btn--ghost" disabled={busy} onClick={() => void unpack()}>
            بازگشت
          </button>
        </>
      ) : null}

      {status_ ? (
        <span className={status_.tone === 'ok' ? 'hint-cell' : 'hint-cell'} style={{ color: status_.tone === 'ok' ? 'var(--ok-700, #15803d)' : 'var(--danger, #b91c1c)' }}>
          {status_.text}
        </span>
      ) : null}
    </span>
  );
}
