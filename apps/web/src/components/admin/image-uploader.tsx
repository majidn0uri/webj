'use client';

import { useEffect, useRef, useState } from 'react';

import {
  deleteProductImage,
  loadMediaHygiene,
  loadProductImages,
  makeMainImage,
  runMediaCleanup,
  uploadProductImage,
  type MediaHygiene,
  type ProductImage,
} from '@/lib/media-actions';

import { faDigits } from '@/lib/format';

/**
 * بخشِ تصویرِ کالا.
 *
 * آنچه اینجا اهمیت دارد، «امکانِ بارگذاری» نیست — هر سامانه‌ای آن را دارد.
 * اهمیت در چیزهایی است که در لحظه‌یِ کارِ فروشنده دیده می‌شود:
 *
 *   • **کشیدن و رها کردن**: فروشنده عکس‌ها را از پوشه می‌کشد داخلِ کادر؛
 *     گشتن در پوشه‌ها برایِ هر فایل، کاری است که بعد از ده بار آدم را خسته
 *     می‌کند.
 *   • **پیش‌نمایشِ بی‌درنگ**: تصویر همان لحظه دیده می‌شود، نه پس از تازه‌سازیِ
 *     صفحه. فروشنده باید مطمئن شود عکسِ درست را فرستاده.
 *   • **تصویرِ اصلی روشن است**: نخستین تصویر، تصویرِ اصلی است و رویِ هر
 *     تصویر نوشته شده کدام «اصلی» است — چون همین تصویر است که در نتایجِ
 *     جستجو دیده می‌شود.
 *   • **جایِ خالی خالی نمی‌ماند**: هنگامِ بارگذاری، یک کادرِ لرزان دیده
 *     می‌شود، نه یک صفحه‌یِ بی‌حرکت که معلوم نیست کار می‌کند یا نه.
 */

type Status = { tone: 'ok' | 'bad'; text: string } | null;

/** حجمِ خامِ دیسک به واحدی که آدم بفهمد (رقمِ فارسی، چون بقیهٔ پنل هم فارسی است) */
function mb(bytes: number): string {
  const n = Math.max(0, bytes);
  if (n < 1024) return `${faDigits(n)} بایت`;
  if (n < 1024 * 1024) return `${faDigits(Math.round(n / 1024))} کیلوبایت`;
  return `${faDigits((Math.round((n / (1024 * 1024)) * 10) / 10).toFixed(1)).replace('.', '٫')} مگابایت`;
}

export function ImageUploader({ productId }: { productId: string }) {
  const [items, setItems] = useState<ProductImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [dragging, setDragging] = useState(false);
  const [alt, setAlt] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [hygiene, setHygiene] = useState<MediaHygiene | null>(null);

  useEffect(() => {
    void loadProductImages(productId).then((result) => {
      if (result.ok) setItems(result.data);
      else setStatus({ tone: 'bad', text: result.message });
    });
    // بهداشتِ فایل‌ها مالِ کلِ انبار است، نه این کالا — یک بار در کافی است و
    // از کشِ سرور خوانده می‌شود (بی‌پویشِ دوبارهٔ دیسک در هر بازکردنِ صفحه).
    void loadMediaHygiene().then((result) => {
      if (result.ok) setHygiene(result.data);
    });
  }, [productId]);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setBusy(true);
    setStatus(null);

    const failed: string[] = [];
    for (const file of list) {
      // بررسیِ پیشاپیش در مرورگر: جلوگیری از فرستادنِ فایلی که بی‌گمان رد
      // می‌شود (سرور هم دوباره بررسی می‌کند — اینجا فقط برایِ سرعت و احترام به
      // وقتِ فروشنده است)
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        failed.push(`${file.name}: تنها JPG، PNG یا WebP`);
        continue;
      }
      if (file.size > 12 * 1024 * 1024) {
        failed.push(`${file.name}: بیش از ۱۲ مگابایت`);
        continue;
      }

      const form = new FormData();
      form.append('file', file);
      const result = await uploadProductImage(productId, form, {
        alt: alt.trim() || undefined,
        asMain: items.length === 0,
      });
      if (result.ok) {
        setItems((prev) => [...prev, result.data]);
      } else {
        failed.push(`${file.name}: ${result.message}`);
      }
    }

    setBusy(false);
    setAlt('');
    if (failed.length > 0) setStatus({ tone: 'bad', text: failed.join(' · ') });
    else setStatus({ tone: 'ok', text: `${list.length} تصویر بارگذاری و بهینه شد.` });
  }

  async function remove(id: string) {
    setBusy(true);
    const result = await deleteProductImage(productId, id);
    setBusy(false);
    if (result.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      // اگر تصویرِ اصلی رفته بود، سامانه نخستین تصویر را اصلی کرده است
      void loadProductImages(productId).then((r) => {
        if (r.ok) setItems(r.data);
      });
    } else setStatus({ tone: 'bad', text: result.message });
  }

  async function clean(force = false) {
    setBusy(true);
    const result = await runMediaCleanup(force ? 2000 : 500, force);
    setBusy(false);
    if (!result.ok) {
      setStatus({ tone: 'bad', text: result.message });
      return;
    }
    setHygiene(result.data);
    const r = result.data;
    setStatus({
      tone: r.refuseCode ? 'bad' : 'ok',
      text: r.notes[0] ?? (r.removed > 0 ? `${r.removed} فایل پاک شد.` : 'چیزی برایِ پاک‌سازی نبود.'),
    });
  }

  async function rescan() {
    setBusy(true);
    const result = await loadMediaHygiene(true);
    setBusy(false);
    if (result.ok) setHygiene(result.data);
    else setStatus({ tone: 'bad', text: result.message });
  }

  async function setMain(id: string) {
    setBusy(true);
    const result = await makeMainImage(productId, id);
    setBusy(false);
    if (result.ok) {
      setItems((prev) =>
        prev.map((i) => ({ ...i, role: i.id === id ? 'main' : 'gallery' })),
      );
    } else setStatus({ tone: 'bad', text: result.message });
  }

  return (
    <div className="stack">
      {status ? (
        <div className={status.tone === 'ok' ? 'alert alert--ok' : 'alert alert--danger'}>{status.text}</div>
      ) : null}

      {/* ── ناحیه‌یِ رها کردن ─────────────────────────────────────────── */}
      <div
        className={`dropzone${dragging ? ' dropzone--over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(event.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void upload(event.target.files);
            event.target.value = '';
          }}
        />
        <b>تصویرها را اینجا بکشید و رها کنید</b>
        <span className="hint-cell">
          یا کلیک کنید — JPG، PNG یا WebP، تا ۱۲ مگابایت. سامانه خودش اندازه‌یِ مناسبِ
          فهرست و صفحه‌یِ کالا را می‌سازد.
        </span>
      </div>

      <div className="actions">
        <input
          className="grow"
          placeholder="توضیحِ تصویر (برایِ دسترسی و جستجو — مانندِ «نمایِ پشتِ قاب»)"
          value={alt}
          onChange={(event) => setAlt(event.target.value)}
          disabled={busy}
        />
      </div>

      {/* ── پیش‌نمایش ────────────────────────────────────────────────── */}
      {items.length === 0 ? (
        <p className="empty">هنوز تصویری ندارد.</p>
      ) : (
        <div className="thumbs">
          {items.map((item) => (
            <figure key={item.id} className={item.role === 'main' ? 'thumb thumb--main' : 'thumb'}>
              {/* نشانی نسبی است: چه فروشگاه روی دامنه باشد، چه در پیش‌نما،
                  تصویر از همین سایت بار می‌شود */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.urlThumb ?? item.url}
                alt={item.alt}
                width={120}
                height={120}
                loading="lazy"
                style={{
                  // تا رسیدنِ تصویر، همان تارِ رنگی جایش را نگه می‌دارد
                  backgroundImage: item.placeholder ? `url(${item.placeholder})` : undefined,
                  backgroundSize: 'cover',
                }}
              />
              <figcaption>
                {item.role === 'main' ? (
                  <span className="pill pill--ok">اصلی</span>
                ) : (
                  <button className="btn btn--xs btn--ghost" disabled={busy} onClick={() => setMain(item.id)}>
                    اصلی کن
                  </button>
                )}
                <button className="btn btn--xs btn--danger" disabled={busy} onClick={() => remove(item.id)}>
                  حذف
                </button>
              </figcaption>
              {item.alt ? <span className="hint-cell">{item.alt}</span> : null}
              {busy ? <span className="thumb__spinner" aria-hidden /> : null}
            </figure>
          ))}
        </div>
      )}

      {/* ── بهداشتِ فایل‌ها ─────────────────────────────────────────────
          سه عدد جدا، چون سه چیزِ جداست: آنچه می‌شود برداشت، آنچه مهلت
          نگهش داشته، و آنچه اصلاً فایلِ ما نیست. */}
      <div className="actions">
        <div className="u-flex u-flex-wrap u-items-center u-gap-2">
          <button
            className="btn btn--xs btn--ghost"
            disabled={busy || !hygiene || hygiene.orphans + hygiene.tempStale === 0}
            onClick={() => void clean(false)}
          >
            {hygiene && hygiene.orphans + hygiene.tempStale > 0
              ? `پاک‌سازیِ ${faDigits(hygiene.orphans + hygiene.tempStale)} فایل`
              : 'فایلِ بی‌صاحبی نیست'}
          </button>
          <button className="btn btn--xs btn--ghost" disabled={busy} onClick={() => void rescan()}>
            از نو بررسی کن
          </button>
        </div>
        {hygiene ? (
          <span className="hint-cell">
            {hygiene.orphans + hygiene.tempStale > 0
              ? `${mb(hygiene.orphanBytes + hygiene.tempStaleBytes)} از ${mb(hygiene.bytes)}ِ پوشهٔ رسانه بی‌صاحب است · مهلتِ اعتماد ${faDigits(hygiene.policy.graceDays)} روز · `
              : `پوشهٔ رسانه پاک است (${mb(hygiene.bytes)}) · `}
            {hygiene.cached ? 'از آخرینِ بررسی' : 'همین حالا'}
            {hygiene.policy.autopurge ? ' · پاک‌سازیِ خودکار روشن است' : ' · پاک‌سازیِ خودکار خاموش است (تنظیمات ← پیشرفته)'}
          </span>
        ) : (
          <span className="hint-cell">در حالِ بررسیِ پوشهٔ رسانه…</span>
        )}
        {hygiene && hygiene.missingTotal > 0 ? (
          <span className="pill pill--bad u-text-xs">
            {faDigits(hygiene.missingTotal)} ردیف به فایلی اشاره می‌کند که رویِ دیسک نیست
          </span>
        ) : null}
        {hygiene && hygiene.unmanaged > 0 ? (
          <span className="hint-cell">
            {faDigits(hygiene.unmanaged)} فایلِ ناشناس هم آنجا هست که هرگز پاک نمی‌شود.
          </span>
        ) : null}
        {hygiene && hygiene.incomplete ? (
          <span className="hint-cell">
            شمارشِ دیسک در این پیش‌نمایش کامل نشد (سقفِ زمان) — رقم‌هایِ بالا کمترینِ
            قطعی‌اند. با «از نو بررسی کن» کامل می‌شود.
          </span>
        ) : null}
        {/* چک‌بر ایستاد: به‌جایِ اینکه بی‌صدا رد شویم، دلیلش را می‌گوییم و
            راهِ اجبار را هم نشان می‌دهیم — تصمیم با مدیر است، نه با ترس. */}
        {hygiene && hygiene.refuseCode ? (
          <span className="hint-cell u-flex u-gap-2 u-items-center" >
            <span className="pill pill--bad u-text-xs">
              سامانه یک‌طرفه پاک نمی‌کند
            </span>
            <button className="btn btn--xs btn--danger" disabled={busy} onClick={() => void clean(true)}>
              با وجودِ این هشدار پاک کن
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
