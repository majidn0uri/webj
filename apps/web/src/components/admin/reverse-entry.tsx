'use client';

import { useActionState, useState } from 'react';
import { reverseJournalAction, type ActionState } from '@/lib/admin-actions';

/**
 * برگشتِ سند.
 *
 * چرا دکمه‌ای جدا و نه بخشی از جدول؟ چون برگشت یک عملِ «کم اما مهم» است:
 * هر کلیک یک سندِ معکوس در دفتر می‌سازد و تا ابد می‌ماند. پس باید
 * یک گامِ تأیید داشته باشد و دلیلِ آن ثبت شود — نه اینکه با یک کلیکِ
 * اشتباهی کلِ دفتر را شلوغ کند.
 */
export function ReverseEntry({ entryId, entryNo }: { entryId: string; entryNo: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(reverseJournalAction, {});

  if (state.ok) {
    return <p className="row-ok">{state.ok}</p>;
  }

  if (!open) {
    return (
      <button className="btn btn--ghost btn--xs" type="button" onClick={() => setOpen(true)}>
        برگشت
      </button>
    );
  }

  return (
    <div className="reverse">
      <form action={action} className="reverse__form">
        <input type="hidden" name="entryId" value={entryId} />
        <input
          className="field__input field__input--xs"
          name="reason"
          placeholder={`دلیلِ برگشتِ ${entryNo}`}
          aria-label={`دلیلِ برگشتِ سندِ ${entryNo}`}
          minLength={3}
          required
        />
        <button className="btn btn--primary btn--xs" type="submit" disabled={pending}>
          {pending ? '…' : 'ثبتِ برگشت'}
        </button>
        <button className="btn btn--ghost btn--xs" type="button" onClick={() => setOpen(false)}>
          انصراف
        </button>
      </form>
      {state.error ? <p className="row-err">{state.error}</p> : null}
    </div>
  );
}
