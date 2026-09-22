'use client';

import { useActionState, useState } from 'react';
import { updateProductAction, type ActionState } from '@/lib/admin-actions';
import type { ReferenceData } from './product-form';
import { ImageUploader } from './image-uploader';

export interface ProductDetail {
  id: string;
  title: string;
  slug: string;
  description: string;
  status: string;
  typeKey: string | null;
  brandSlug: string | null;
  images: Array<{ url: string }>;
  variants: Array<{
    id: string;
    sku: string;
    priceRial: string;
    isActive: boolean;
    compatibleModelIds: string[];
  }>;
}

interface VariantRow {
  key: number;
  id?: string;
  sku: string;
  /** قیمت به تومان — آنچه فروشنده می‌نویسد (پایگاه ریال نگه می‌دارد) */
  price: string;
  models: string[];
  active: boolean;
  removed: boolean;
}

/**
 * فرمِ ویرایشِ کالا.
 *
 * تفاوتش با فرمِ ثبت: اینجا «تاریخچه» هم هست. تنوعی که فروشنده حذف می‌کند
 * از فرم بیرون می‌رود، اما سامانه تصمیم می‌گیرد آن را پاک کند یا فقط غیرفعال
 * — چون ممکن است پیش‌تر فروخته شده باشد. به همین دلیل حذف، «قابلِ بازگشت»
 * نیست و فرم پیش از حذف هشدار می‌دهد.
 */
export function ProductEditForm({
  product,
  reference,
}: {
  product: ProductDetail;
  reference: ReferenceData;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateProductAction, {});

  const [title, setTitle] = useState(product.title);
  const [typeKey, setTypeKey] = useState(product.typeKey ?? '');
  const [brandSlug, setBrandSlug] = useState(product.brandSlug ?? '__none__');
  const [status, setStatus] = useState(product.status);
  const [description, setDescription] = useState(product.description ?? '');
  const [images, setImages] = useState<string[]>(product.images.map((i) => i.url));
  const [variants, setVariants] = useState<VariantRow[]>(() =>
    product.variants.map((v, index) => ({
      key: index + 1,
      id: v.id,
      sku: v.sku,
      price: String(Math.round(Number(v.priceRial) / 10)),
      models: v.compatibleModelIds,
      active: v.isActive,
      removed: false,
    })),
  );

  const live = variants.filter((v) => !v.removed);
  const nextKey = () => Math.max(0, ...variants.map((v) => v.key)) + 1;

  function patch(key: number, change: Partial<VariantRow>) {
    setVariants((rows) => rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }

  /** مدل‌ها بر اساسِ برندِ گوشی گروه‌بندی می‌شوند تا در فهرستِ بلند گم نشوند */
  const modelsByBrand = reference.deviceModels.reduce<Record<string, typeof reference.deviceModels>>(
    (acc, m) => {
      (acc[m.brand] ??= []).push(m);
      return acc;
    },
    {},
  );

  return (
    <form action={action} className="form">
      <input type="hidden" name="productId" value={product.id} />

      <div className="form__grid">
        <label className="field">
          <span className="field__label">عنوانِ کالا</span>
          <input
            className="field__input"
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={3}
          />
        </label>

        <label className="field">
          <span className="field__label">نوعِ کالا</span>
          <select
            className="field__input"
            name="typeKey"
            value={typeKey}
            onChange={(e) => setTypeKey(e.target.value)}
            required
          >
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
          <select
            className="field__input"
            name="brandSlug"
            value={brandSlug}
            onChange={(e) => setBrandSlug(e.target.value)}
          >
            <option value="__none__">بدون برند</option>
            {reference.brands.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">وضعیت</span>
          <select
            className="field__input"
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="active">فعال (در فروشگاه دیده می‌شود)</option>
            <option value="draft">پیش‌نویس (دیده نمی‌شود)</option>
            <option value="archived">بایگانی‌شده</option>
          </select>
        </label>
      </div>

      <label className="field">
        <span className="field__label">توضیح</span>
        <textarea
          className="field__input"
          name="description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      {/* ── تصویرها ───────────────────────────────────────────────────────
          پیش از این، فروشنده باید «نشانیِ فایل» را می‌نوشت — یعنی در عمل باید
          فایل را جایِ دیگری رویِ سرور می‌گذاشت. اکنون تصویر را می‌کشد و رها
          می‌کند و سامانه خودش اندازه‌هایِ گوناگون را می‌سازد. تصویرهایِ کنونی
          (که نشانی دارند) به قوتِ خود باقی‌اند و همان‌جا دیده می‌شوند.
          ─────────────────────────────────────────────────────────────────── */}
      <div className="field">
        <span className="field__label">تصویرها</span>
        <ImageUploader productId={product.id} />
      </div>
      {images.map((url) =>
        url.trim() ? <input key={url} type="hidden" name="images" value={url.trim()} /> : null,
      )}

      <div className="variants">
        <div className="variants__head">
          <h3 className="variants__title">تنوع‌ها</h3>
          <button
            className="btn btn--ghost btn--xs"
            type="button"
            onClick={() =>
              setVariants((rows) => [
                ...rows,
                { key: nextKey(), sku: '', price: '', models: [], active: true, removed: false },
              ])
            }
          >
            + تنوع
          </button>
        </div>

        {live.map((row, index) => (
          <fieldset key={row.key} className="variant">
            <legend className="variant__legend num">
              تنوع {index + 1}
              {row.id ? ' (موجود)' : ' (تازه)'}
            </legend>

            <input type="hidden" name="variantKey" value={row.key} />
            {row.id ? <input type="hidden" name={`id_${row.key}`} value={row.id} /> : null}

            <div className="variant__row">
              <label className="field">
                <span className="field__label">شناسه (SKU)</span>
                <input
                  className="field__input"
                  name={`sku_${row.key}`}
                  value={row.sku}
                  onChange={(e) => patch(row.key, { sku: e.target.value })}
                  required
                />
              </label>

              <label className="field">
                <span className="field__label">قیمت (تومان)</span>
                <input
                  className="field__input num"
                  name={`price_${row.key}`}
                  value={row.price}
                  onChange={(e) => patch(row.key, { price: e.target.value })}
                  inputMode="numeric"
                  required
                />
              </label>

              <label className="field field--inline">
                <input
                  type="checkbox"
                  name={`active_${row.key}`}
                  checked={row.active}
                  onChange={(e) => patch(row.key, { active: e.target.checked })}
                />
                <span>فعال</span>
              </label>

              {live.length > 1 ? (
                <button
                  className="btn btn--ghost btn--xs"
                  type="button"
                  onClick={() => patch(row.key, { removed: true })}
                >
                  حذف
                </button>
              ) : null}
            </div>

            <label className="field">
              <span className="field__label">سازگار با کدام گوشی‌ها؟</span>
              <select
                className="field__input field__input--tall"
                name={`models_${row.key}`}
                multiple
                value={row.models}
                onChange={(e) =>
                  patch(row.key, {
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

      {variants.some((v) => v.removed) ? (
        <p className="alert alert--warn">
          تنوع‌هایِ حذف‌شده ذخیره نشده‌اند. با ذخیره، آن‌هایی که پیش‌تر فروخته شده یا در انبار
          مانده‌اند فقط «غیرفعال» می‌شوند تا تاریخچه‌ی سفارش‌ها و اسناد سالم بماند.
        </p>
      ) : null}

      {state.error ? (
        <p className="alert alert--danger" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="alert alert--ok" role="status">
          {state.ok}
        </p>
      ) : null}

      <div className="row-actions">
        <button className="btn btn--primary" type="submit" disabled={pending}>
          {pending ? 'در حالِ ذخیره…' : 'ذخیره‌ی تغییرات'}
        </button>
      </div>
    </form>
  );
}
