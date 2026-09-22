'use client';

import { useActionState, useState } from 'react';
import { createProductAction, type ActionState } from '@/lib/admin-actions';

export interface ReferenceData {
  brands: Array<{ id: string; name: string; slug: string }>;
  productTypes: Array<{ key: string; name: string }>;
  deviceModels: Array<{ id: string; model: string; brand: string }>;
}

interface VariantRow {
  key: number;
  sku: string;
  price: string;
  models: string[];
}

/**
 * فرمِ ثبتِ کالا.
 *
 * دو تصمیمِ مهم:
 *  ۱) تنوع‌ها پویا هستند — یک کالا می‌تواند چند رنگ/مدل داشته باشد،
 *     و فرم نباید فروشنده را به یک تنوع محدود کند.
 *  ۲) انتخابِ مدلِ گوشی «چند انتخابی» است، چون یک قاب معمولاً به چند مدل می‌خورد؛
 *     این همان چیزی است که فیلترِ «کالاهای سازگار با گوشیِ من» روی آن سوار می‌شود.
 */
export function ProductForm({ reference }: { reference: ReferenceData }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createProductAction, {});
  const [open, setOpen] = useState(false);
  const [variants, setVariants] = useState<VariantRow[]>([
    { key: 1, sku: '', price: '', models: [] },
  ]);

  function update(key: number, patch: Partial<VariantRow>) {
    setVariants((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addVariant() {
    setVariants((rows) => [
      ...rows,
      { key: Math.max(0, ...rows.map((r) => r.key)) + 1, sku: '', price: '', models: [] },
    ]);
  }

  function removeVariant(key: number) {
    setVariants((rows) => (rows.length === 1 ? rows : rows.filter((r) => r.key !== key)));
  }

  /** مدل‌ها بر اساسِ برندِ گوشی دسته‌بندی می‌شوند تا انتخاب در فهرستِ بلند گم نشود */
  const modelsByBrand = reference.deviceModels.reduce<Record<string, typeof reference.deviceModels>>(
    (acc, m) => {
      (acc[m.brand] ??= []).push(m);
      return acc;
    },
    {},
  );

  if (!open) {
    return (
      <div className="row-actions">
        <button className="btn btn--primary" type="button" onClick={() => setOpen(true)}>
          + کالای تازه
        </button>
        {state.ok ? <span className="adjust__msg adjust__msg--ok">{state.ok}</span> : null}
      </div>
    );
  }

  return (
    <form action={action} className="form">
      <div className="form__grid">
        <label className="field">
          <span className="field__label">عنوانِ کالا</span>
          <input className="field__input" name="title" required minLength={3} placeholder="قاب سیلیکونی مات" />
        </label>

        <label className="field">
          <span className="field__label">نوعِ کالا</span>
          <select className="field__input" name="typeKey" required defaultValue="">
            <option value="" disabled>
              انتخاب کنید
            </option>
            {reference.productTypes.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">برند</span>
          <select className="field__input" name="brandSlug" defaultValue="">
            <option value="">بدون برند</option>
            {reference.brands.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span className="field__label">توضیح</span>
        <textarea className="field__input" name="description" rows={3} />
      </label>

      <div className="variants">
        <div className="variants__head">
          <h3 className="variants__title">تنوع‌ها</h3>
          <button className="btn btn--ghost btn--xs" type="button" onClick={addVariant}>
            + تنوع
          </button>
        </div>

        {variants.map((row, index) => (
          <fieldset key={row.key} className="variant">
            <legend className="variant__legend num">تنوع {index + 1}</legend>

            <div className="variant__row">
              <label className="field">
                <span className="field__label">شناسه (SKU)</span>
                <input
                  className="field__input"
                  name="sku"
                  value={row.sku}
                  onChange={(e) => update(row.key, { sku: e.target.value })}
                  placeholder="CS-13P-BLK"
                  required
                />
              </label>

              <label className="field">
                <span className="field__label">قیمت (تومان)</span>
                <input
                  className="field__input num"
                  name="price"
                  value={row.price}
                  onChange={(e) => update(row.key, { price: e.target.value })}
                  inputMode="numeric"
                  placeholder="255000"
                  required
                />
              </label>

              {variants.length > 1 ? (
                <button
                  className="btn btn--ghost btn--xs"
                  type="button"
                  onClick={() => removeVariant(row.key)}
                >
                  حذف
                </button>
              ) : null}
            </div>

            <label className="field">
              <span className="field__label">سازگار با کدام گوشی‌ها؟</span>
              <select
                className="field__input field__input--tall"
                name="models"
                multiple
                value={row.models}
                onChange={(e) =>
                  update(row.key, {
                    models: Array.from(e.target.selectedOptions).map((o) => o.value),
                  })
                }
              >
                {Object.entries(modelsByBrand).map(([brand, models]) => (
                  <optgroup key={brand} label={brand}>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.model}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="field__help">
                با نگه‌داشتنِ Ctrl (در موبایل لمسِ چندگانه) چند مدل انتخاب کنید.
              </span>
            </label>
          </fieldset>
        ))}
      </div>

      {state.error ? (
        <p className="alert alert--danger" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="row-actions">
        <button className="btn btn--primary" type="submit" disabled={pending}>
          {pending ? 'در حالِ ثبت…' : 'ثبتِ کالا'}
        </button>
        <button className="btn btn--ghost" type="button" onClick={() => setOpen(false)}>
          انصراف
        </button>
      </div>
    </form>
  );
}
