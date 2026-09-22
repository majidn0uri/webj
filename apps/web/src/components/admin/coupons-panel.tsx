'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  couponRedemptionsAction,
  createCouponAction,
  listCouponsAction,
  setCouponActiveAction,
  updateCouponAction,
  type CouponRow,
  type RedemptionRow,
} from '@/lib/coupon-actions';
import { faDigits, toman } from '@/lib/format';
import { ShamsiDatePicker } from '@/components/shamsi-date-picker';

/**
 * پنلِ کوپن.
 *
 * آنچه اینجا اهمیت دارد، فرم نیست — **فهمِ نتیجه** است. فروشنده‌ای که
 * کدی می‌سازد می‌خواهد بداند: این کد چند بار مصرف شد؟ چه کسانی برداشتند؟
 * چند نوبت مانده؟ پس جدول، کنارِ هر کد، «مصرف/سقف» را نشان می‌دهد و با یک
 * کلیک فهرستِ مصرف‌کنندگان را می‌آورد.
 *
 * دو تصمیمِ ریز اما مهم در فرم:
 *   • درصد با **ده‌هزار** فرستاده می‌شود (۱۲٫۵٪ → ۱۲۵۰) تا نیم‌درصدها هم
 *     درست باشند؛ رابط همان درصدِ معمولی را نشان می‌دهد.
 *   • مبلغ‌ها **تومان** گرفته می‌شوند (چون فروشنده به تومان فکر می‌کند) و
 *     پیش از فرستادن به ریال برگردانده می‌شوند (چون سامانه ریال نگه
 *     می‌دارد). این تبدیل اگر در فرم نباشد، در پایگاه است — و همان‌جا پنهان
 *     می‌ماند تا روزی که تراز جور درنیاید.
 */

interface Draft {
  code: string;
  title: string;
  description: string;
  kind: 'percent' | 'fixed';
  percent: string;
  amountToman: string;
  minToman: string;
  capToman: string;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  perCustomerLimit: string;
  appliesTo: 'all' | 'product' | 'category';
  productId: string;
  categoryId: string;
  isActive: boolean;
}

const EMPTY: Draft = {
  code: '',
  title: '',
  description: '',
  kind: 'percent',
  percent: '10',
  amountToman: '',
  minToman: '',
  capToman: '',
  startsAt: '',
  endsAt: '',
  usageLimit: '',
  perCustomerLimit: '1',
  appliesTo: 'all',
  productId: '',
  categoryId: '',
  isActive: true,
};

/** رشته‌یِ پولی را پاک می‌کند: جداکننده‌یِ هزارگان و رقم‌هایِ فارسی */
function digits(raw: string): string {
  return raw.replace(/[^\d]/g, '').replace(/^[۰-۹]+$/, (m) =>
    m.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))),
  );
}

function tomanToRial(raw: string): string | null {
  const d = digits(raw);
  if (!d) return null;
  return (BigInt(d) * 10n).toString();
}

function rialToToman(raw: string | null): string {
  if (!raw) return '';
  try {
    return (BigInt(raw) / 10n).toString();
  } catch {
    return '';
  }
}

function basisPoints(percent: string): number {
  const n = Number(percent.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function faDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return faDigits(
      new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeZone: 'Asia/Tehran' }).format(d),
    );
  } catch {
    return '—';
  }
}

export function CouponsPanel() {
  const [rows, setRows] = useState<CouponRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openRedemptions, setOpenRedemptions] = useState<string | null>(null);
  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listCouponsAction();
    if (res.ok) setRows(res.data);
    else setMessage({ kind: 'err', text: res.message });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.isActive).length;
    const used = rows.reduce((a, r) => a + r.usageCount, 0);
    const discount = rows.reduce((a, r) => a + BigInt(r.usageCount) * kindValue(r), 0n);
    return { total: rows.length, active, used, discount };
  }, [rows]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function submit() {
    setSaving(true);
    setMessage(null);

    const payload = {
      code: draft.code.trim(),
      title: draft.title.trim(),
      description: draft.description.trim() || undefined,
      kind: draft.kind,
      valueBp: draft.kind === 'percent' ? basisPoints(draft.percent) : undefined,
      valueRial: draft.kind === 'fixed' ? tomanToRial(draft.amountToman) : undefined,
      minSubtotalRial: tomanToRial(draft.minToman) ?? '0',
      maxDiscountRial: tomanToRial(draft.capToman),
      // ورودیِ تاریخ-زمانِ محلی را همان‌طور می‌فرستیم؛ مرورگر به وقتِ تهران
      // تفسیرش می‌کند و کارساز به UTC می‌نویسد
      startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
      endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
      usageLimit: draft.usageLimit ? Number(digits(draft.usageLimit)) : null,
      perCustomerLimit: Number(digits(draft.perCustomerLimit) || '1'),
      appliesTo: draft.appliesTo,
      productId: draft.appliesTo === 'product' ? draft.productId || null : null,
      categoryId: draft.appliesTo === 'category' ? draft.categoryId || null : null,
      isActive: draft.isActive,
    };

    const res = editingId
      ? await updateCouponAction(editingId, payload)
      : await createCouponAction(payload);

    setSaving(false);
    if (res.ok) {
      setMessage({
        kind: 'ok',
        text: editingId ? 'کوپن به‌روزرسانی شد.' : `کوپنِ «${res.data.code}» ساخته شد.`,
      });
      setDraft(EMPTY);
      setEditingId(null);
      void load();
    } else {
      setMessage({ kind: 'err', text: res.message });
    }
  }

  async function toggle(row: CouponRow) {
    const res = await setCouponActiveAction(row.id, !row.isActive);
    if (res.ok) void load();
    else setMessage({ kind: 'err', text: res.message });
  }

  async function showRedemptions(id: string) {
    if (openRedemptions === id) {
      setOpenRedemptions(null);
      return;
    }
    setOpenRedemptions(id);
    setRedemptions([]);
    const res = await couponRedemptionsAction(id);
    if (res.ok) setRedemptions(res.data.rows ?? []);
    else setMessage({ kind: 'err', text: res.message });
  }

  function startEdit(row: CouponRow) {
    setEditingId(row.id);
    setDraft({
      code: row.code,
      title: row.title,
      description: row.description ?? '',
      kind: row.kind,
      percent: row.valueBp != null ? String(row.valueBp / 100) : '10',
      amountToman: rialToToman(row.valueRial),
      minToman: rialToToman(row.minSubtotalRial),
      capToman: rialToToman(row.maxDiscountRial),
      startsAt: row.startsAt ? row.startsAt.slice(0, 16) : '',
      endsAt: row.endsAt ? row.endsAt.slice(0, 16) : '',
      usageLimit: row.usageLimit != null ? String(row.usageLimit) : '',
      perCustomerLimit: String(row.perCustomerLimit),
      appliesTo: row.appliesTo,
      productId: row.productId ?? '',
      categoryId: row.categoryId ?? '',
      isActive: row.isActive,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="stack">
      <div className="cards cards--3">
        <div className="card card--stat">
          <span className="card__k">کوپن‌ها</span>
          <strong className="card__v">{faDigits(String(stats.total))}</strong>
          <span className="card__h">{faDigits(String(stats.active))} فعال</span>
        </div>
        <div className="card card--stat">
          <span className="card__k">دفعاتِ مصرف</span>
          <strong className="card__v">{faDigits(String(stats.used))}</strong>
          <span className="card__h">در همه‌یِ کمپین‌ها</span>
        </div>
        <div className="card card--stat">
          <span className="card__k">برآوردِ تخفیفِ داده‌شده</span>
          <strong className="card__v">{faDigits(toman(stats.discount.toString()))}</strong>
          <span className="card__h">تومان</span>
        </div>
      </div>

      {message ? (
        <div className={message.kind === 'ok' ? 'notice notice--ok' : 'notice notice--err'}>
          {message.text}
        </div>
      ) : null}

      <section className="card">
        <h2 className="card__title">{editingId ? 'ویرایشِ کوپن' : 'کوپنِ تازه'}</h2>

        <div className="grid grid--2">
          <label className="field">
            <span className="field__label">کدِ تخفیف</span>
            <input
              className="field__input"
              value={draft.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              placeholder="NOWRUZ1405"
              dir="ltr"
              disabled={editingId !== null}
            />
            <span className="field__hint">
              انگلیسی و بی‌فاصله. کوچک یا بزرگ نوشتنش تفاوتی ندارد.
            </span>
          </label>

          <label className="field">
            <span className="field__label">عنوان (برایِ خودتان)</span>
            <input
              className="field__input"
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="کمپینِ عیدانه"
            />
          </label>

          <label className="field">
            <span className="field__label">گونه‌یِ تخفیف</span>
            <select
              className="field__input"
              value={draft.kind}
              onChange={(e) => set('kind', e.target.value as Draft['kind'])}
            >
              <option value="percent">درصدی</option>
              <option value="fixed">مبلغِ ثابت</option>
            </select>
          </label>

          {draft.kind === 'percent' ? (
            <label className="field">
              <span className="field__label">درصدِ تخفیف</span>
              <input
                className="field__input"
                value={draft.percent}
                inputMode="decimal"
                onChange={(e) => set('percent', e.target.value)}
                placeholder="10"
                dir="ltr"
              />
              <span className="field__hint">می‌تواند اعشاری باشد، مانندِ ۱۲٫۵</span>
            </label>
          ) : (
            <label className="field">
              <span className="field__label">مبلغِ تخفیف (تومان)</span>
              <input
                className="field__input"
                value={draft.amountToman}
                inputMode="numeric"
                onChange={(e) => set('amountToman', e.target.value)}
                placeholder="50000"
                dir="ltr"
              />
            </label>
          )}

          <label className="field">
            <span className="field__label">سقفِ تخفیف (تومان)</span>
            <input
              className="field__input"
              value={draft.capToman}
              inputMode="numeric"
              onChange={(e) => set('capToman', e.target.value)}
              placeholder="خالی یعنی بی‌سقف"
              dir="ltr"
            />
            <span className="field__hint">برایِ درصدی: بیشینه‌یِ تخفیفِ این کد</span>
          </label>

          <label className="field">
            <span className="field__label">کمینه‌یِ خرید (تومان)</span>
            <input
              className="field__input"
              value={draft.minToman}
              inputMode="numeric"
              onChange={(e) => set('minToman', e.target.value)}
              placeholder="خالی یعنی بی‌شرط"
              dir="ltr"
            />
          </label>

          <label className="field">
            <span className="field__label">آغاز</span>
            <ShamsiDatePicker value={draft.startsAt} onChange={(v) => set('startsAt', v)} format="iso" withTime />
          </label>

          <label className="field">
            <span className="field__label">پایان</span>
            <ShamsiDatePicker value={draft.endsAt} onChange={(v) => set('endsAt', v)} format="iso" withTime />
          </label>

          <label className="field">
            <span className="field__label">سقفِ مصرفِ کل</span>
            <input
              className="field__input"
              value={draft.usageLimit}
              inputMode="numeric"
              onChange={(e) => set('usageLimit', e.target.value)}
              placeholder="خالی یعنی بی‌پایان"
              dir="ltr"
            />
          </label>

          <label className="field">
            <span className="field__label">سهمیه‌یِ هر مشتری</span>
            <input
              className="field__input"
              value={draft.perCustomerLimit}
              inputMode="numeric"
              onChange={(e) => set('perCustomerLimit', e.target.value)}
              dir="ltr"
            />
          </label>

          <label className="field">
            <span className="field__label">محدوده</span>
            <select
              className="field__input"
              value={draft.appliesTo}
              onChange={(e) => set('appliesTo', e.target.value as Draft['appliesTo'])}
            >
              <option value="all">همه‌یِ کالاها</option>
              <option value="category">یک دسته (با زیردسته‌ها)</option>
              <option value="product">یک کالا</option>
            </select>
          </label>

          {draft.appliesTo === 'product' ? (
            <label className="field">
              <span className="field__label">شناسه‌یِ کالا</span>
              <input
                className="field__input"
                value={draft.productId}
                onChange={(e) => set('productId', e.target.value)}
                placeholder="از صفحه‌یِ کالا کپی کنید"
                dir="ltr"
              />
            </label>
          ) : null}

          {draft.appliesTo === 'category' ? (
            <label className="field">
              <span className="field__label">شناسه‌یِ دسته</span>
              <input
                className="field__input"
                value={draft.categoryId}
                onChange={(e) => set('categoryId', e.target.value)}
                placeholder="از صفحه‌یِ دسته‌بندی"
                dir="ltr"
              />
            </label>
          ) : null}

          <label className="field field--check">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
            />
            <span>فعال باشد</span>
          </label>
        </div>

        <div className="row row--end">
          {editingId ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setEditingId(null);
                setDraft(EMPTY);
              }}
            >
              انصراف
            </button>
          ) : null}
          <button type="button" className="btn btn--primary" onClick={() => void submit()} disabled={saving}>
            {saving ? 'کمی صبر…' : editingId ? 'ذخیره‌یِ تغییرات' : 'ساختِ کوپن'}
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">کوپن‌ها</h2>
        {loading ? (
          <p className="muted">در حالِ بارگیری…</p>
        ) : rows.length === 0 ? (
          <p className="muted">هنوز کوپنی نساخته‌اید.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>کد</th>
                  <th>عنوان</th>
                  <th>تخفیف</th>
                  <th>محدوده</th>
                  <th>مصرف</th>
                  <th>پایان</th>
                  <th>وضعیت</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={row.isActive ? '' : 'is-muted'}>
                    <td dir="ltr" className="mono">
                      {row.code}
                    </td>
                    <td>{row.title}</td>
                    <td>{discountText(row)}</td>
                    <td>{scopeText(row)}</td>
                    <td>
                      <button
                        type="button"
                        className="link"
                        onClick={() => void showRedemptions(row.id)}
                      >
                        {faDigits(String(row.usageCount))}
                        {row.usageLimit != null ? ` / ${faDigits(String(row.usageLimit))}` : ''}
                      </button>
                    </td>
                    <td>{faDate(row.endsAt)}</td>
                    <td>
                      <button
                        type="button"
                        className={row.isActive ? 'chip chip--ok' : 'chip'}
                        onClick={() => void toggle(row)}
                      >
                        {row.isActive ? 'فعال' : 'خاموش'}
                      </button>
                    </td>
                    <td>
                      <button type="button" className="link" onClick={() => startEdit(row)}>
                        ویرایش
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {openRedemptions ? (
          <div className="subcard">
            <h3 className="subcard__title">مصرف‌هایِ این کوپن</h3>
            {redemptions.length === 0 ? (
              <p className="muted">هنوز مصرف نشده است.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>سفارش</th>
                      <th>خریدار</th>
                      <th>تخفیف</th>
                      <th>زمان</th>
                    </tr>
                  </thead>
                  <tbody>
                    {redemptions.map((r) => (
                      <tr key={r.id}>
                        <td dir="ltr" className="mono">
                          {r.orderNo ?? '—'}
                        </td>
                        <td>{r.customerName ?? 'مهمان'}</td>
                        <td>{faDigits(toman(r.discountRial))} تومان</td>
                        <td>{faDate(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function kindValue(row: CouponRow): bigint {
  return row.kind === 'fixed' ? BigInt(row.valueRial ?? '0') : 0n;
}

function discountText(row: CouponRow): string {
  if (row.kind === 'fixed') {
    return `${faDigits(rialToToman(row.valueRial))} تومان`;
  }
  const pct = row.valueBp != null ? row.valueBp / 100 : 0;
  const base = `${faDigits(String(pct))}٪`;
  if (row.maxDiscountRial) {
    return `${base} (تا ${faDigits(rialToToman(row.maxDiscountRial))} تومان)`;
  }
  return base;
}

function scopeText(row: CouponRow): string {
  if (row.appliesTo === 'all') return 'همه';
  if (row.appliesTo === 'product') return 'یک کالا';
  return 'یک دسته';
}
