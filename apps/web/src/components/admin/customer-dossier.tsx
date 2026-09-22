'use client';

import { useState } from 'react';
import { setCustomerStatus, updateCustomer } from '@/lib/customer-actions';

/**
 * پرونده‌ی مشتری.
 *
 * چرا این صفحه «همه چیز در یک نگاه» است؟ چون کاربردش پاسخ به تلفن است:
 * مشتری زنگ می‌زند، اپراتور شماره را جستجو می‌کند و باید بی‌درنگ ببیند آیا
 * حساب دارد، آخرین سفارشش چه بوده، کجا باید برود و چقدر تا کنون خریده. اگر
 * هر کدام صفحه‌ای جدا باشد، مشتری پشتِ خط معطل می‌ماند — و معطل ماندن در
 * تلفن، مستقیماً به از دست رفتنِ فروش ترجمه می‌شود.
 *
 * ویرایش‌ها با کنشِ سرور انجام می‌شوند (نشانه‌ی دسترسی در کوکیِ HttpOnly است
 * و از مرورگر خواندنی نیست).
 */

/* inputStyle removed — use className="field__input" instead */

const ORDER_STATUS: Record<string, string> = {
  pending_payment: 'در انتظارِ پرداخت',
  paid: 'پرداخت‌شده',
  processing: 'در حالِ آماده‌سازی',
  shipped: 'ارسال‌شده',
  delivered: 'تحویل‌شده',
  cancelled: 'لغو شده',
  refunded: 'بازگشتِ وجه',
};

interface Dossier {
  customer: {
    id: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    kind: string;
    isActive: boolean;
    deactivatedReason: string | null;
    note: string | null;
    isPartner: boolean;
    nationalId: string | null;
    creditLimitToman: number | null;
    checkCeilingToman: number | null;
    mobileVerifiedAt: string | null;
    lastLoginAt: string | null;
    registeredAt: string;
  };
  stats: {
    orderCount: number;
    spentToman: number;
    spentDisplay: string;
    addressCount: number;
    wishlistCount: number;
  };
  orders: Array<{
    id: string;
    orderNo: string;
    status: string;
    totalToman: number;
    totalDisplay: string;
    at: string;
  }>;
  addresses: Array<{
    id: string;
    receiver_name: string | null;
    phone: string | null;
    province: string | null;
    city: string | null;
    address: string | null;
    postal_code: string | null;
    is_default: boolean;
  }>;
  wishlist: Array<{ variant_id: string; title: string; sku: string | null; created_at: string }>;
}

export function CustomerDossier({ dossier }: { dossier: Dossier }) {
  const c = dossier.customer;
  const [fullName, setFullName] = useState(c.fullName);
  const [email, setEmail] = useState(c.email ?? '');
  const [note, setNote] = useState(c.note ?? '');
  const [credit, setCredit] = useState(String(c.creditLimitToman ?? 0));
  const [ceiling, setCeiling] = useState(String(c.checkCeilingToman ?? 0));
  const [partner, setPartner] = useState(c.isPartner);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [blockReason, setBlockReason] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const out = await updateCustomer(c.id, {
      fullName: fullName.trim() || undefined,
      email: email.trim() || null,
      note: note.trim() || null,
      creditLimitToman: Number(credit) || 0,
      checkCeilingToman: Number(ceiling) || 0,
      isPartner: partner,
    });
    setBusy(false);
    setMessage(out.ok ? { kind: 'ok', text: out.message ?? 'ذخیره شد.' } : { kind: 'err', text: out.message });
  }

  async function toggleBlock() {
    setBusy(true);
    setMessage(null);
    const out = await setCustomerStatus(c.id, c.isActive, blockReason.trim() || undefined);
    setBusy(false);
    setMessage(out.ok ? { kind: 'ok', text: out.message ?? 'انجام شد.' } : { kind: 'err', text: out.message });
    setBlockReason('');
  }

  return (
    <>
      <header className="head">
        <h1 className="head__title">{c.fullName}</h1>
        <p className="head__sub">
          <span className="num" dir="ltr">{c.phone ?? '—'}</span> · عضویت <span className="num">{c.registeredAt}</span> ·{' '}
          {c.isActive ? (
            <span className="pill pill--ok">فعال</span>
          ) : (
            <span className="pill pill--danger">مسدود{c.deactivatedReason ? ` — ${c.deactivatedReason}` : ''}</span>
          )}
          {c.isPartner && <span className="pill pill--ok pill-inline" >همکار</span>}
        </p>
      </header>

      <section className="stats">
        <article className="stat">
          <p className="stat__label">سفارش‌ها</p>
          <p className="stat__value num">{dossier.stats.orderCount}</p>
          <p className="stat__hint">در این سامانه</p>
        </article>
        <article className="stat">
          <p className="stat__label">خریدِ کل</p>
          <p className="stat__value num stat__value--money">{dossier.stats.spentDisplay}</p>
          <p className="stat__hint">تومان</p>
        </article>
        <article className="stat">
          <p className="stat__label">آدرس‌ها</p>
          <p className="stat__value num">{dossier.stats.addressCount}</p>
          <p className="stat__hint">ذخیره‌شده</p>
        </article>
        <article className="stat">
          <p className="stat__label">علاقه‌مندی‌ها</p>
          <p className="stat__value num">{dossier.stats.wishlistCount}</p>
          <p className="stat__hint">در لیست</p>
        </article>
      </section>

      {message && (
        <div className={message.kind === 'ok' ? 'alert alert--ok' : 'alert alert--danger'}>{message.text}</div>
      )}

      <div className="grid dossier-grid" >
        <section className="panel">
          <h2 className="panel__title">ویرایشِ پرونده</h2>
          <form onSubmit={save} className="u-grid u-gap-3">
            <label className="field">
              <span className="field__label">نام</span>
              <input className="field__input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">رایانامه</span>
              <input className="field__input" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">سقفِ اعتبار (تومان)</span>
              <input className="field__input" type="number" min={0} value={credit} onChange={(e) => setCredit(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">سقفِ چک (تومان)</span>
              <input className="field__input" type="number" min={0} value={ceiling} onChange={(e) => setCeiling(e.target.value)} />
              <span className="muted u-text-xs" >
                برایِ فروشِ عمده/شرکتی؛ در فروشِ عادی بی‌استفاده است.
              </span>
            </label>
            <label className="field">
              <span className="field__label">یادداشتِ داخلی</span>
              <textarea
                className="field__input u-min-h-70" 
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="مثلاً: مشتریِ عمده؛ همیشه با هماهنگی ارسال شود."
              />
            </label>
            <label className="field u-flex u-gap-2 u-items-center" >
              <input type="checkbox" checked={partner} onChange={(e) => setPartner(e.target.checked)} />
              <span>مشتریِ همکار (قیمتِ عمده)</span>
            </label>
            <button className="btn btn--primary" type="submit" disabled={busy}>
              {busy ? 'در حالِ ذخیره…' : 'ذخیره'}
            </button>
          </form>

          <hr className="hr-divider" />

          <h2 className="panel__title">{c.isActive ? 'مسدود کردنِ حساب' : 'فعال کردنِ حساب'}</h2>
          {c.isActive && (
            <label className="field u-mb-2" >
              <span className="field__label">دلیلِ مسدودسازی</span>
              <input
                className="field__input"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="مثلاً: درخواستِ خودِ مشتری"
              />
            </label>
          )}
          <button
            className={c.isActive ? 'btn btn--danger' : 'btn btn--primary'}
            type="button"
            disabled={busy}
            onClick={toggleBlock}
          >
            {busy ? 'در حالِ انجام…' : c.isActive ? 'مسدود کن و نشست‌ها را باطل کن' : 'دوباره فعال کن'}
          </button>
          <p className="muted u-text-xs u-mt-2" >
            حساب حذف نمی‌شود — سفارش‌ها و اسنادِ مالیِ مشتری می‌مانند؛ فقط ورود
            بسته می‌شود و نشست‌هایِ باز در همان لحظه باطل می‌شوند.
          </p>
        </section>

        <div className="u-grid u-gap-5">
          <section className="panel panel--flush panel--flush">
            <div className="panel__head">
              <h2 className="panel__title">سفارش‌ها</h2>
              <span className="panel__count num">{dossier.orders.length}</span>
            </div>
            {dossier.orders.length === 0 ? (
              <p className="empty">این مشتری هنوز سفارشی ثبت نکرده است.</p>
            ) : (
              <div className="u-overflow-x">
                <table className="table">
                  <thead>
                    <tr>
                      <th>شماره</th>
                      <th>تاریخ</th>
                      <th>وضعیت</th>
                      <th className="ta-left">مبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dossier.orders.map((o) => (
                      <tr key={o.id}>
                        <td className="num" dir="ltr">{o.orderNo}</td>
                        <td className="muted u-text-xs" >{o.at}</td>
                        <td>
                          <span className={o.status === 'cancelled' ? 'pill pill--danger' : 'pill'}>
                            {ORDER_STATUS[o.status] ?? o.status}
                          </span>
                        </td>
                        <td className="num ta-left">{o.totalDisplay}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel panel--flush panel--flush">
            <div className="panel__head">
              <h2 className="panel__title">آدرس‌ها</h2>
              <span className="panel__count num">{dossier.addresses.length}</span>
            </div>
            {dossier.addresses.length === 0 ? (
              <p className="empty">آدرسی ثبت نشده است.</p>
            ) : (
              <div className="u-overflow-x">
                <table className="table">
                  <thead>
                    <tr>
                      <th>گیرنده</th>
                      <th>شهر</th>
                      <th>نشانی</th>
                      <th>کدِ پستی</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dossier.addresses.map((a) => (
                      <tr key={a.id}>
                        <td>
                          {a.receiver_name ?? '—'}
                          <div className="muted num u-text-xs"  dir="ltr">{a.phone ?? ''}</div>
                        </td>
                        <td>{[a.province, a.city].filter(Boolean).join('، ') || '—'}</td>
                        <td className="u-max-w-320">{a.address ?? '—'}</td>
                        <td className="num" dir="ltr">
                          {a.is_default && <span className="pill pill--ok pill-inline" >پیش‌فرض</span>}
                          {a.postal_code ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {dossier.wishlist.length > 0 && (
            <section className="panel">
              <div className="panel__head">
                <h2 className="panel__title">علاقه‌مندی‌ها</h2>
                <span className="panel__count num">{dossier.wishlist.length}</span>
              </div>
              <ul className="u-text-sm u-leading-2 dossier-list">
                {dossier.wishlist.map((w) => (
                  <li key={w.variant_id}>
                    {w.title} <span className="muted num" dir="ltr">· {w.sku ?? ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
