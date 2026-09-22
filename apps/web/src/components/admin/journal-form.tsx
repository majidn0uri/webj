'use client';

import { useActionState, useMemo, useState } from 'react';
import { postJournalAction, type ActionState } from '@/lib/admin-actions';

/**
 * ثبتِ سندِ حسابداریِ دستی.
 *
 * دو تصمیمِ آگاهانه در این فرم:
 *
 *  ۱) «تراز بودن» زنده نمایش داده می‌شود و تا وقتی جمعِ بدهکار و بستانکار
 *     برابر نباشد، دکمه‌ی ثبت غیرفعال است. حسابدار نباید بتواند سندِ کج
 *     بفرستد تا سرور آن را رد کند — این اتلافِ یک رفت‌وبرگشت و یک پیامِ
 *     خطایِ دیرهنگام است.
 *
 *  ۲) هر ردیف یا بدهکار است یا بستانکار؛ پر کردنِ یکی، دیگری را خالی می‌کند،
 *     چون ردیفی که هر دو طرف را داشته باشد از نظرِ حسابداری بی‌معناست
 *     (و پایگاه‌داده هم آن را نمی‌پذیرد).
 */

interface Line {
  key: number;
  accountCode: string;
  debit: string;
  credit: string;
  description: string;
}

interface Account {
  code: string;
  name: string;
  type: string;
}

let nextKey = 1;
function newLine(): Line {
  return { key: nextKey++, accountCode: '', debit: '', credit: '', description: '' };
}

/** اعداد را با جداکننده‌ی هزارگانِ فارسی نشان می‌دهد — ورودی همچنان خام می‌ماند */
function fa(n: number): string {
  return new Intl.NumberFormat('fa-IR').format(Math.round(n));
}

function parseAmount(raw: string): number {
  const n = Number(String(raw).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function JournalForm({ accounts }: { accounts: Account[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(postJournalAction, {});
  const [lines, setLines] = useState<Line[]>(() => [newLine(), newLine()]);

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const l of lines) {
      debit += parseAmount(l.debit);
      credit += parseAmount(l.credit);
    }
    return { debit, credit, diff: debit - credit };
  }, [lines]);

  const balanced = totals.debit > 0 && totals.debit === totals.credit;

  function update(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  return (
    <form action={action} className="form">
      <div className="field">
        <label className="field__label" htmlFor="journal-description">
          شرحِ سند
        </label>
        <input
          id="journal-description"
          className="field__input"
          name="description"
          placeholder="مثال: پرداختِ اجاره‌ی فروشگاه — شهریور ۱۴۰۵"
          maxLength={200}
          required
        />
      </div>

      <div className="lines">
        <div className="lines__head">
          <span>حساب</span>
          <span>بدهکار (تومان)</span>
          <span>بستانکار (تومان)</span>
          <span>شرح</span>
          <span />
        </div>

        {lines.map((line, index) => (
          <div className="lines__row" key={line.key}>
            <select
              className="field__input field__input--sm"
              name="accountCode"
              aria-label={`حسابِ ردیفِ ${index + 1}`}
              value={line.accountCode}
              onChange={(e) => update(line.key, { accountCode: e.target.value })}
              required
            >
              <option value="">انتخابِ حساب…</option>
              {accounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>

            <input
              className="field__input field__input--sm num"
              name="debit"
              inputMode="numeric"
              placeholder="۰"
              aria-label={`بدهکارِ ردیفِ ${index + 1}`}
              value={line.debit}
              onChange={(e) =>
                update(line.key, { debit: e.target.value, credit: e.target.value ? '' : line.credit })
              }
            />

            <input
              className="field__input field__input--sm num"
              name="credit"
              inputMode="numeric"
              placeholder="۰"
              aria-label={`بستانکارِ ردیفِ ${index + 1}`}
              value={line.credit}
              onChange={(e) =>
                update(line.key, { credit: e.target.value, debit: e.target.value ? '' : line.debit })
              }
            />

            <input
              className="field__input field__input--sm"
              name="lineDescription"
              placeholder="شرحِ ردیف (اختیاری)"
              aria-label={`شرحِ ردیفِ ${index + 1}`}
              value={line.description}
              onChange={(e) => update(line.key, { description: e.target.value })}
            />

            <button
              type="button"
              className="btn btn--ghost btn--xs"
              onClick={() => setLines((prev) => (prev.length > 2 ? prev.filter((l) => l.key !== line.key) : prev))}
              disabled={lines.length <= 2}
              aria-label="حذفِ ردیف"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="lines__actions">
        <button type="button" className="btn btn--ghost btn--xs" onClick={() => setLines((p) => [...p, newLine()])}>
          + ردیفِ تازه
        </button>
      </div>

      {/* ترازسنج: اختلاف زنده نشان داده می‌شود، نه بعد از ارسال */}
      <div className={`balance-meter${balanced ? ' balance-meter--ok' : ''}`}>
        <div className="balance-meter__row">
          <span>جمعِ بدهکار</span>
          <b className="num">{fa(totals.debit)}</b>
        </div>
        <div className="balance-meter__row">
          <span>جمعِ بستانکار</span>
          <b className="num">{fa(totals.credit)}</b>
        </div>
        <div className="balance-meter__row balance-meter__row--total">
          <span>اختلاف</span>
          <b className={`num ${totals.diff === 0 ? 'ok' : 'bad'}`}>{fa(totals.diff)}</b>
        </div>
        <p className="balance-meter__hint">
          {balanced
            ? 'سند تراز است و آماده‌ی ثبت.'
            : 'تا وقتی جمعِ بدهکار و بستانکار برابر نباشد، ثبت ممکن نیست.'}
        </p>
      </div>

      <button className="btn btn--primary btn--block" type="submit" disabled={pending || !balanced}>
        {pending ? 'در حالِ ثبت…' : 'ثبتِ سند'}
      </button>

      {state.error ? <p className="alert alert--danger">{state.error}</p> : null}
      {state.ok ? <p className="alert alert--ok">{state.ok}</p> : null}
    </form>
  );
}
