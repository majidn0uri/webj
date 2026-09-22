'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { faDigits } from '@/lib/format';
import {
  clearSearchCache,
  deleteSynonymAction,
  loadSuggestions,
  loadSynonyms,
  saveSynonym,
  toggleSynonym,
  type Synonym,
  type SynonymSuggestion,
} from '@/lib/synonyms-actions';

/**
 * فرهنگِ مترادف‌ها و کشِ جستجو.
 *
 * چرا این صفحه هست؟ چون جدولِ `search_synonyms` از مهاجرتِ ۰۰۹ در پایگاه بود
 * و موتورِ جستجو از همان روز آن را می‌خواند — ولی نوشتن در آن یعنی `psql`.
 * «مردم «شارجر» می‌نویسند، ما «شارژر» نوشته‌ایم» را فقط فروشنده می‌داند، پس
 * فقط فروشنده باید بتواند آن را ثبت کند.
 *
 * سه تصمیمِ ظریف که عمداً این‌جا هستند:
 *
 *  • **کلیدِ نرمال‌شده نمایش داده می‌شود.** نیمی ازِ «چرا مترادفم اثر نکرد؟»ها
 *    با دیدنِ همین دو خط جواب می‌گیرد: اگر دو طرفِ جدول یک کلید داشته باشند،
 *    آن‌ها از نگاهِ سامانه یکی‌اند و مترادفی لازم نیست.
 *  • **«چی کم داریم؟» کنارِ فرم است، نه در یک گزارشِ جدا.** پرتکرارترینِ
 *    جستجوهایِ بی‌نتیجه با یک کلیک داخلِ فرم می‌آیند؛ یعنی درمان درست
 *    روبه‌رویِ درد است.
 *  • **خاموش‌کردن به‌جایِ حذف.** مترادفی که یک‌شبه نتیجه‌ها را شلوغ می‌کند
 *    پاک نمی‌شود؛ خاموش می‌شود تا فردا بشود درباره‌اش تصمیم گرفت.
 */

type Status = { tone: 'ok' | 'bad'; text: string } | null;

/** زمانِ نسبیِ فارسی — برایِ «چند وقته این جستجو تکرار شده؟» */
function ago(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '—';
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 60) return `${faDigits(Math.max(1, minutes))} دقیقه پیش`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${faDigits(hours)} ساعت پیش`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${faDigits(days)} روز پیش`;
  return `${faDigits(Math.round(days / 30))} ماه پیش`;
}

export function SynonymsPanel() {
  const [rows, setRows] = useState<Synonym[]>([]);
  const [total, setTotal] = useState(0);
  const [suggestions, setSuggestions] = useState<SynonymSuggestion[]>([]);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [canonical, setCanonical] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [onlyInactive, setOnlyInactive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [list, sugs] = await Promise.all([loadSynonyms(q, onlyInactive), loadSuggestions(30)]);
    if (list.ok) {
      setRows(list.data.rows);
      setTotal(list.data.total);
    } else {
      setStatus({ tone: 'bad', text: list.message });
    }
    if (sugs.ok) setSuggestions(sugs.data.rows);
  }, [q, onlyInactive]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyInactive]);

  const filtered = useMemo(() => rows, [rows]);

  async function add() {
    if (!term.trim() || !canonical.trim()) {
      setStatus({ tone: 'bad', text: 'هر دو خانه لازم است: واژه‌ای که مردم می‌نویسند، و واژه‌ای که در کالاها هست.' });
      return;
    }
    setBusy(true);
    const result = await saveSynonym({ term: term.trim(), canonical: canonical.trim() });
    setBusy(false);
    if (!result.ok) {
      setStatus({ tone: 'bad', text: result.message });
      return;
    }
    setTerm('');
    setCanonical('');
    setStatus({
      tone: 'ok',
      text: `«${result.data.term}» به «${result.data.canonical}» وصل شد — از این پس جستجویِ اولی، دومی را هم می‌آورد.`,
    });
    await refresh();
  }

  async function flip(item: Synonym) {
    setBusy(true);
    const result = await toggleSynonym(item.id, !item.isActive, { term: item.term, canonical: item.canonical });
    setBusy(false);
    if (!result.ok) {
      setStatus({ tone: 'bad', text: result.message });
      return;
    }
    setStatus({ tone: 'ok', text: item.isActive ? `«${item.term}» خاموش شد.` : `«${item.term}» روشن شد.` });
    await refresh();
  }

  async function remove(item: Synonym) {
    setBusy(true);
    const result = await deleteSynonymAction(item.id);
    setBusy(false);
    setConfirmDelete(null);
    if (!result.ok) {
      setStatus({ tone: 'bad', text: result.message });
      return;
    }
    setStatus({ tone: 'ok', text: `«${item.term} → ${item.canonical}» حذف شد.` });
    await refresh();
  }

  async function emptyCache() {
    setBusy(true);
    const result = await clearSearchCache();
    setBusy(false);
    setStatus(
      result.ok
        ? { tone: 'ok', text: 'کشِ پاسخِ جستجو خالی شد؛ پرسشِ بعدی از نو از پایگاه می‌پرسدش.' }
        : { tone: 'bad', text: result.message },
    );
  }

  function fillFrom(suggestion: SynonymSuggestion) {
    setTerm(suggestion.sample || suggestion.normalized);
    setStatus({
      tone: 'ok',
      text: `واژه پر شد. در خانهٔ دوم بنویس چه چیزی در کالاهایت داری که باید به‌جایش بیاید.`,
    });
  }

  const unmapped = suggestions.filter((s) => !s.mapped);

  return (
    <div className="stack">
      {status ? (
        <div className={status.tone === 'ok' ? 'alert alert--ok' : 'alert alert--danger'}>{status.text}</div>
      ) : null}

      <div className="card">
        <h3 className="card__title">مترادفِ تازه</h3>
        <p className="hint-cell u-mb-0" >
          واژه‌ای که مشتری می‌نویسد ← واژه‌ای که در نام یا مشخصاتِ کالای تو آمده. هر دو طرف
          بی‌حساسیت به نیم‌فاصله، ارقامِ فارسی/عربی و حروفِ «ي/ی» و «ك/ک» یکسان می‌شوند.
        </p>
        <p className="hint-cell u-mb-0" >
          دو قاعده، که دانستن‌شان جلویِ «ثبت کردم ولی اثر نکرد» را می‌گیرد:
          <strong> تک‌واژه </strong>
          به گروهِ مترادف‌ها <strong>افزوده</strong> می‌شود (جستجو زیاد می‌شود، کم نیست)؛
          اما <strong>عبارتِ چندواژه</strong> در خودِ پرسش <strong>جایگزین</strong> می‌شود —
          یعنی «کابل شارژر سریع ← مبدل فوری» همان کاری را می‌کند که «شارژر سریع» نمی‌تواند بکند.
        </p>
        <div className="grid-2">
          <label className="field">
            <span className="field__label">آنچه مردم می‌نویسند</span>
            <input
              className="field__input"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="شارجر، موبایل، كابل"
              maxLength={80}
            />
          </label>
          <label className="field">
            <span className="field__label">آنچه در کالاها نوشته‌ای</span>
            <input
              className="field__input"
              value={canonical}
              onChange={(e) => setCanonical(e.target.value)}
              placeholder="شارژر، گوشی، کابل"
              maxLength={80}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add();
              }}
            />
          </label>
        </div>
        <div className="actions">
          <button className="btn btn--primary btn--sm" disabled={busy} type="button" onClick={() => void add()}>
            افزودن
          </button>
          <span className="hint-cell">
            اگر هر دو واژه از نگاهِ سامانه یکی باشند، ثبت نمی‌شود — چون مترادفی که چیزی را وصل
            نکند فقط فهرست را شلوغ می‌کند.
          </span>
        </div>
      </div>

      {unmapped.length > 0 ? (
        <div className="card">
          <h3 className="card__title">مردم این‌ها را جستجو کردند و چیزی پیدا نشد</h3>
          <p className="hint-cell u-mb-0" >
            سی روزِ اخیر، پرکاربردترینِ عبارت‌هایِ بی‌نتیجه. رویِ هرکدام بزنی داخلِ فرم بالا
            می‌آید؛ اگر کالایش را داری و فقط نامش فرق دارد، مترادف بساز — اگر نداری، این فهرست
            لیستِ خریدِ بعدیِ توست.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>عبارت</th>
                <th>تکرار</th>
                <th>آخرین بار</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {unmapped.map((s) => (
                <tr key={s.normalized}>
                  <td>{s.sample || s.normalized}</td>
                  <td className="num">{faDigits(s.searches)} بار</td>
                  <td className="hint-cell">{ago(s.lastSeenAt)}</td>
                  <td>
                    <button className="btn btn--xs btn--ghost" type="button" onClick={() => fillFrom(s)}>
                      مترادف بساز
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="card">
        <div className="actions actions-between" >
          <h3 className="card__title u-mb-0" >
            فرهنگِ مترادف‌ها ({faDigits(total)})
          </h3>
          <div className="u-flex u-flex-wrap u-items-center u-gap-2">
            <input
              className="field__input u-min-w-200"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void refresh();
              }}
              placeholder="جستجو در خودِ مترادف‌ها"
            />
            <button
              className={onlyInactive ? 'btn btn--sm' : 'btn btn--sm btn--ghost'}
              type="button"
              onClick={() => setOnlyInactive((v) => !v)}
            >
              فقط خاموش‌ها
            </button>
            <button className="btn btn--sm btn--ghost" type="button" disabled={busy} onClick={() => void emptyCache()}>
              خالی‌کردنِ کشِ خوانش‌ها (جستجو + فهرست‌ها)
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="hint-cell">
            {q.trim() || onlyInactive
              ? 'موردی با این فیلتر پیدا نشد.'
              : 'هنوز هیچ مترادفی ثبت نشده — با فرمِ بالا شروع کن.'}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>مردم می‌نویسند</th>
                <th>منظور</th>
                <th>کلیدِ نرمال‌شده</th>
                <th>وضعیت</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>{item.term}</td>
                  <td>{item.canonical}</td>
                  <td className="hint-cell u-text-xs" dir="ltr" >
                    {item.termKey} → {item.canonicalKey}
                  </td>
                  <td>
                    <span className={`${item.isActive ? 'pill pill--ok' : 'pill'} u-text-xs`}>
                      {item.isActive ? 'فعال' : 'خاموش'}
                    </span>
                  </td>
                  <td>
                    <div className="u-flex u-gap-1">
                      <button
                        className="btn btn--xs btn--ghost"
                        type="button"
                        disabled={busy}
                        onClick={() => void flip(item)}
                      >
                        {item.isActive ? 'خاموش کن' : 'روشن کن'}
                      </button>
                      {confirmDelete === item.id ? (
                        <>
                          <button className="btn btn--xs btn--danger" type="button" disabled={busy} onClick={() => void remove(item)}>
                            قطعی حذف کن
                          </button>
                          <button className="btn btn--xs btn--ghost" type="button" onClick={() => setConfirmDelete(null)}>
                            ولش کن
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn--xs btn--ghost"
                          type="button"
                          onClick={() => setConfirmDelete(item.id)}
                        >
                          حذف
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint-cell u-mb-0" >
          مترادف‌ها رویِ «جستجو» اثر می‌گذارند، نه رویِ نامِ کالا — هیچ چیزی در کاتالوگ عوض
          نمی‌شود. اگر می‌خواهی قیمت یا عنوان را درست کنی، جایش «کالاها» است.
        </p>
      </div>
    </div>
  );
}
