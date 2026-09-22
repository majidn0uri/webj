'use client';

import { useActionState, useMemo, useState } from 'react';
import { postPurchaseInvoiceAction, type ActionState } from '@/lib/admin-actions';

/**
 * فاکتورِ خرید — تنها راهِ ورودِ کالا به انبار (و در نتیجه، شارژِ فروشگاه).
 *
 * سه نکته که این فرم را از یک «فرمِ ساده» جدا می‌کند:
 *
 *  ۱) ارزش افزوده جداگانه وارد می‌شود و در «بهای کالا» نمی‌نشیند؛ در غیر این
 *     صورت بهای میانگینِ موزونِ کالا به‌اندازه‌ی مالیات بالا می‌رفت و سودِ
 *     فروش به‌غلط کم نشان داده می‌شد. نتیجه‌ی کار در «قابلِ پرداخت» دیده می‌شود.
 *
 *  ۲) شناسه‌ی ملیِ تأمین‌کننده در همان‌جا با الگوریتمِ رسمی بررسی می‌شود؛
 *     فاکتورِ بی‌هویت در سامانه‌ی مؤدیان اعتبار ندارد و بعداً رد می‌شود.
 *
 *  ۳) تاریخ را کاربر شمسی می‌نویسد (۱۴۰۵/۰۶/۲۰) — نه میلادی، و نه با یک
 *     انتخاب‌گرِ بیگانه با کاربرِ ایرانی.
 */

interface Item {
  key: number;
  variantId: string;
  quantity: string;
  unitCost: string;
}

interface Variant {
  id: string;
  sku: string;
  product: string;
  price_rial: string;
  on_hand: number;
}

interface Warehouse {
  id: string;
  name: string;
  is_default: boolean;
}

let itemKey = 1;
function newItem(): Item {
  return { key: itemKey++, variantId: '', quantity: '1', unitCost: '' };
}

function fa(n: number): string {
  return new Intl.NumberFormat('fa-IR').format(Math.round(n));
}

function parseAmount(raw: string): number {
  const n = Number(String(raw).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * ارزش افزوده‌ی پیشنهادی: ۹٪ِ ارزشِ کالا.
 * کاربر می‌تواند تغییرش دهد؛ پیشنهاد فقط برای سرعت است، نه برای تحمیل.
 */
const VAT_RATE = 0.09;

export function PurchaseForm({
  variants,
  warehouses,
}: {
  variants: Variant[];
  warehouses: Warehouse[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(postPurchaseInvoiceAction, {});
  const [items, setItems] = useState<Item[]>(() => [newItem()]);

  const [extraCost, setExtraCost] = useState('');
  const [vat, setVat] = useState('');
  const [vatTouched, setVatTouched] = useState(false);
  const [nationalId, setNationalId] = useState('');

  const subtotal = useMemo(
    () =>
      items.reduce(
        (sum, it) => sum + parseAmount(it.unitCost) * (Number(it.quantity) || 0),
        0,
      ),
    [items],
  );

  // تا وقتی کاربر خودش عددی ننوشته، ارزش افزوده با نرخِ رایج پیشنهاد می‌شود
  const vatValue = vatTouched ? parseAmount(vat) : Math.round(subtotal * VAT_RATE);
  const extraValue = parseAmount(extraCost);
  const goodsCost = subtotal + extraValue;
  const payable = goodsCost + vatValue;

  const nationalIdDigits = nationalId.replace(/[\s-]/g, '');
  const nationalIdValid = nationalIdDigits.length === 0 || nationalIdDigits.length === 10;

  function update(key: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  return (
    <form action={action} className="form">
      <div className="form__grid">
        <div className="field">
          <label className="field__label" htmlFor="supplier-name">
            نامِ تأمین‌کننده
          </label>
          <input
            id="supplier-name"
            className="field__input"
            name="supplierName"
            placeholder="مثال: شرکتِ پخشِ آریا"
            required
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="supplier-national-id">
            شناسه‌ی ملیِ تأمین‌کننده
          </label>
          <input
            id="supplier-national-id"
            className="field__input num"
            name="supplierNationalId"
            inputMode="numeric"
            placeholder="۱۰ رقم — برایِ ثبتِ شماره‌ی فاکتور لازم است"
            value={nationalId}
            onChange={(e) => setNationalId(e.target.value)}
          />
          <p className={`field__help${nationalIdValid ? '' : ' field__help--warn'}`}>
            {nationalIdValid
              ? 'با داشتنِ شناسه‌ی ملی، ثبتِ دوباره‌ی یک فاکتور به‌طورِ خودکار رد می‌شود.'
              : 'شناسه‌ی ملی باید ۱۰ رقم باشد.'}
          </p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="supplier-economic-code">
            کدِ اقتصادی
          </label>
          <input
            id="supplier-economic-code"
            className="field__input num"
            name="supplierEconomicCode"
            inputMode="numeric"
            placeholder="اختیاری"
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="supplier-invoice-no">
            شماره‌ی فاکتورِ تأمین‌کننده
          </label>
          <input
            id="supplier-invoice-no"
            className="field__input"
            name="supplierInvoiceNo"
            placeholder="مثال: INV-1405-7781"
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="issued-at">
            تاریخِ صدور (شمسی)
          </label>
          <input
            id="issued-at"
            className="field__input num"
            name="issuedAt"
            placeholder="۱۴۰۵/۰۶/۲۰"
            dir="rtl"
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="warehouse-id">
            انبارِ مقصد
          </label>
          <select id="warehouse-id" className="field__input" name="warehouseId" defaultValue={
            warehouses.find((w) => w.is_default)?.id ?? ''
          } required>
            <option value="">انتخاب…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h3 className="form__section">کالاهایِ فاکتور</h3>

      <div className="lines">
        <div className="lines__head lines__head--4">
          <span>کالا</span>
          <span>تعداد</span>
          <span>بهای خریدِ واحد (تومان)</span>
          <span />
        </div>

        {items.map((item, index) => {
          const selected = variants.find((v) => v.id === item.variantId);
          return (
            <div className="lines__row lines__row--4" key={item.key}>
              <select
                className="field__input field__input--sm"
                name="variantId"
                aria-label={`کالایِ ردیفِ ${index + 1}`}
                value={item.variantId}
                onChange={(e) => update(item.key, { variantId: e.target.value })}
                required
              >
                <option value="">انتخابِ کالا…</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.product} — {v.sku} ({fa(v.on_hand)} موجود)
                  </option>
                ))}
              </select>

              <input
                className="field__input field__input--sm num"
                name="quantity"
                inputMode="numeric"
                aria-label={`تعدادِ ردیفِ ${index + 1}`}
                value={item.quantity}
                onChange={(e) => update(item.key, { quantity: e.target.value })}
                required
              />

              <input
                className="field__input field__input--sm num"
                name="unitCost"
                inputMode="numeric"
                placeholder="مثال: ۱۲۰٬۰۰۰"
                aria-label={`بهای خریدِ ردیفِ ${index + 1}`}
                value={item.unitCost}
                onChange={(e) => update(item.key, { unitCost: e.target.value })}
                required
              />

              <button
                type="button"
                className="btn btn--ghost btn--xs"
                onClick={() =>
                  setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.key !== item.key) : prev))
                }
                disabled={items.length <= 1}
                aria-label="حذفِ ردیف"
              >
                ✕
              </button>

              {selected ? (
                <p className="lines__note">
                  موجودیِ کنونی: <span className="num">{fa(selected.on_hand)}</span> عدد
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="lines__actions">
        <button type="button" className="btn btn--ghost btn--xs" onClick={() => setItems((p) => [...p, newItem()])}>
          + کالایِ تازه
        </button>
      </div>

      <div className="form__grid form__grid--2">
        <div className="field">
          <label className="field__label" htmlFor="extra-cost">
            هزینه‌هایِ جانبی (حمل، گمرک…)
          </label>
          <input
            id="extra-cost"
            className="field__input num"
            name="extraCost"
            inputMode="numeric"
            placeholder="۰"
            value={extraCost}
            onChange={(e) => setExtraCost(e.target.value)}
          />
          <p className="field__help">
            این مبلغ در بهای کالا پخش می‌شود (روشِ میانگینِ موزون) — بدونِ باقی‌مانده.
          </p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="vat">
            ارزش افزوده
          </label>
          <input
            id="vat"
            className="field__input num"
            name="vat"
            inputMode="numeric"
            placeholder="۰"
            value={vatTouched ? vat : String(vatValue)}
            onChange={(e) => {
              setVatTouched(true);
              setVat(e.target.value);
            }}
          />
          <p className="field__help">
            در بهای کالا نمی‌نشیند؛ به‌عنوانِ «اعتبارِ مالیاتی» ثبت می‌شود تا از مالیاتِ فروش کسر شود.
          </p>
        </div>
      </div>

      {/* خلاصه‌ی مالی، پیش از ثبت — کاربر باید «چه می‌پردازد» را پیش از تأیید ببیند */}
      <div className="balance-meter">
        <div className="balance-meter__row">
          <span>ارزشِ کالا</span>
          <b className="num">{fa(subtotal)}</b>
        </div>
        <div className="balance-meter__row">
          <span>هزینه‌هایِ جانبی</span>
          <b className="num">{fa(extraValue)}</b>
        </div>
        <div className="balance-meter__row">
          <span>ارزش افزوده</span>
          <b className="num">{fa(vatValue)}</b>
        </div>
        <div className="balance-meter__row balance-meter__row--total">
          <span>قابلِ پرداخت به تأمین‌کننده</span>
          <b className="num">{fa(payable)}</b>
        </div>
        <p className="balance-meter__hint">
          بهایِ تمام‌شده‌یِ کالا برای محاسبه‌ی سود: <span className="num">{fa(goodsCost)}</span> تومان
          (بدونِ ارزش افزوده)
        </p>
      </div>

      <button className="btn btn--primary btn--block" type="submit" disabled={pending || subtotal <= 0}>
        {pending ? 'در حالِ ثبت…' : 'ثبتِ فاکتور و ورود به انبار'}
      </button>

      {state.error ? <p className="alert alert--danger">{state.error}</p> : null}
      {state.ok ? <p className="alert alert--ok">{state.ok}</p> : null}
    </form>
  );
}
