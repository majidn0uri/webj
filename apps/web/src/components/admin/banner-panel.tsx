'use client';

import { useEffect, useState } from 'react';

import { ShamsiDatePicker } from '@/components/shamsi-date-picker';
import {
  createBanner,
  deleteBanner,
  loadAllBanners,
  updateBanner,
  type Banner,
} from '@/lib/banner-actions';

/**
 * پنلِ ویترین.
 *
 * این صفحه همان نقطه‌ای را می‌بندد که تا دیروز باز بود: برایِ نوشتنِ یک
 * پیامِ تبلیغاتی بالایِ سایت باید کد عوض می‌شد. اکنون فروشنده متن را
 * می‌نویسد، تاریخ می‌دهد، و خاموش/روشن می‌کند — و تغییر همان لحظه روی سایت
 * می‌آید.
 *
 * سه چیز در اینجا بیشتر از «امکانِ ساخت» اهمیت دارد:
 *
 *   • **وضعیتِ نمایش روشن است**: روبه‌روی هر بنر نوشته شده که «اکنون روی
 *     سایت هست» یا «خاموش است» یا «در بازه نیست» — چون پرسشِ همیشگیِ
 *     فروشنده همین است؛
 *   • **خاموش کردن به‌جایِ حذف**: بنری که هر سال تکرار می‌شود را کسی پاک
 *     نمی‌کند؛ فقط خاموش می‌شود تا سالِ بعد دوباره روشن شود؛
 *   • **بازه‌یِ زمانی اختیاری است**: نخواستنِ تاریخ یعنی «همیشه»، و این
 *     پیش‌فرضِ درست برایِ بیشترِ پیام‌هاست.
 */

type Status = { tone: 'ok' | 'bad'; text: string } | null;

const KINDS: Array<{ key: Banner['kind']; label: string; hint: string }> = [
  { key: 'announcement', label: 'نوارِ اعلان', hint: 'یک خط متن در بالایِ همه‌یِ صفحات' },
  { key: 'hero', label: 'بنرِ اصلی', hint: 'بالایِ صفحه‌یِ نخست، با تصویر' },
  { key: 'middle', label: 'بنرِ میانی', hint: 'میانِ ردیف‌هایِ کالا، با تصویر' },
];

/** وضعیتِ نمایش را همان‌طور که سایت می‌بیند نشان می‌دهد */
function visibility(banner: Banner): { label: string; tone: string } {
  if (!banner.isActive) return { label: 'خاموش', tone: 'muted' };
  const now = Date.now();
  const start = banner.startsAt ? Date.parse(banner.startsAt) : null;
  const end = banner.endsAt ? Date.parse(banner.endsAt) : null;
  if (start !== null && now < start) return { label: 'در انتظار', tone: 'warn' };
  if (end !== null && now > end) return { label: 'پایان‌یافته', tone: 'warn' };
  return { label: 'رویِ سایت', tone: 'ok' };
}

export function BannerPanel() {
  const [items, setItems] = useState<Banner[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const [kind, setKind] = useState<Banner['kind']>('announcement');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');

  useEffect(() => {
    void loadAllBanners().then((result) => {
      if (result.ok) setItems(result.data);
      else setStatus({ tone: 'bad', text: result.message });
    });
  }, []);

  async function add() {
    if (!title.trim()) {
      setStatus({ tone: 'bad', text: 'عنوان را بنویسید.' });
      return;
    }
    setBusy(true);
    const result = await createBanner({
      kind,
      title: title.trim(),
      body: body.trim() || undefined,
      linkUrl: linkUrl.trim() || undefined,
      imageUrl: kind === 'announcement' ? null : imageUrl.trim() || undefined,
      startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
    });
    setBusy(false);
    if (result.ok) {
      setItems((prev) => [...prev, result.data]);
      setTitle('');
      setBody('');
      setLinkUrl('');
      setImageUrl('');
      setStartsAt('');
      setEndsAt('');
      setStatus({ tone: 'ok', text: 'بنر ساخته شد و رویِ سایت رفت.' });
    } else setStatus({ tone: 'bad', text: result.message });
  }

  async function toggle(banner: Banner) {
    setBusy(true);
    const result = await updateBanner(banner.id, { isActive: !banner.isActive });
    setBusy(false);
    if (result.ok) {
      setItems((prev) => prev.map((b) => (b.id === banner.id ? result.data : b)));
    } else setStatus({ tone: 'bad', text: result.message });
  }

  async function remove(banner: Banner) {
    setBusy(true);
    const result = await deleteBanner(banner.id);
    setBusy(false);
    if (result.ok) setItems((prev) => prev.filter((b) => b.id !== banner.id));
    else setStatus({ tone: 'bad', text: result.message });
  }

  return (
    <div className="stack">
      {status ? (
        <div className={status.tone === 'ok' ? 'alert alert--ok' : 'alert alert--danger'}>{status.text}</div>
      ) : null}

      {/* ── ساخت ──────────────────────────────────────────────────────── */}
      <div className="card">
        <h3 className="card__title">بنر یا پیامِ تازه</h3>

        <div className="actions">
          {KINDS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={kind === option.key ? 'btn btn--sm' : 'btn btn--sm btn--ghost'}
              onClick={() => setKind(option.key)}
            >
              {option.label}
            </button>
          ))}
          <span className="hint-cell">{KINDS.find((k) => k.key === kind)?.hint}</span>
        </div>

        <div className="grid-2">
          <label className="field">
            <span className="field__label">عنوان</span>
            <input
              className="field__input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="ارسال رایگان بالای ۵۰۰ هزار تومان"
            />
          </label>

          <label className="field">
            <span className="field__label">پیوند (اختیاری)</span>
            <input
              className="field__input num"
              dir="ltr"
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="/search?q=قاب"
            />
          </label>
        </div>

        <label className="field">
          <span className="field__label">توضیح (اختیاری)</span>
          <textarea
            className="field__input"
            rows={2}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>

        {kind !== 'announcement' ? (
          <label className="field">
            <span className="field__label">نشانیِ تصویر</span>
            <input
              className="field__input num"
              dir="ltr"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder="/media/…-full.jpg"
            />
            <span className="field__help">
              تصویر را در صفحه‌یِ کالاها بار بگذارید و نشانی‌اش را اینجا بیاورید.
            </span>
          </label>
        ) : null}

        <div className="grid-2">
          <label className="field">
            <span className="field__label">آغازِ نمایش (اختیاری)</span>
            <ShamsiDatePicker value={startsAt} onChange={setStartsAt} format="iso" placeholder="۱۴۰۵/۰۱/۰۱" />
          </label>
          <label className="field">
            <span className="field__label">پایانِ نمایش (اختیاری)</span>
            <ShamsiDatePicker value={endsAt} onChange={setEndsAt} format="iso" placeholder="۱۴۰۵/۱۲/۳۰" />
          </label>
        </div>
        <p className="hint-cell">
          تاریخ را خالی بگذارید یعنی «همیشه»؛ روزِ پایان هم بنر دیده می‌شود.
        </p>

        <div className="actions">
          <button className="btn" disabled={busy} onClick={() => void add()}>
            انتشار
          </button>
        </div>
      </div>

      {/* ── فهرست ─────────────────────────────────────────────────────── */}
      <div className="card">
        <h3 className="card__title">ویترینِ کنونی ({items.length})</h3>
        {items.length === 0 ? (
          <p className="empty">هنوز بنری ندارید.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>جایگاه</th>
                <th>عنوان</th>
                <th>بازه</th>
                <th>وضعیت</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((banner) => {
                const state = visibility(banner);
                return (
                  <tr key={banner.id}>
                    <td>{KINDS.find((k) => k.key === banner.kind)?.label ?? banner.kind}</td>
                    <td>
                      {banner.title}
                      {banner.body ? <div className="hint-cell">{banner.body}</div> : null}
                    </td>
                    <td className="num u-text-xs" >
                      {banner.startsAt || banner.endsAt
                        ? `${banner.startsAt ? banner.startsAt.slice(0, 10) : '…'} ← ${banner.endsAt ? banner.endsAt.slice(0, 10) : '…'}`
                        : 'همیشه'}
                    </td>
                    <td>
                      <span className={`pill pill--${state.tone}`}>{state.label}</span>
                    </td>
                    <td className="row-actions">
                      <button
                        className="btn btn--xs btn--ghost"
                        disabled={busy}
                        onClick={() => void toggle(banner)}
                      >
                        {banner.isActive ? 'خاموش کن' : 'روشن کن'}
                      </button>
                      <button
                        className="btn btn--xs btn--danger"
                        disabled={busy}
                        onClick={() => void remove(banner)}
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
