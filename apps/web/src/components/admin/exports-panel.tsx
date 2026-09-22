'use client';

import { useMemo, useState } from 'react';
import { ShamsiDatePicker } from '@/components/shamsi-date-picker';

/**
 * پنلِ خروجی‌ها.
 *
 * فلسفه‌یِ این صفحه: **خروجی گرفتن نباید نیاز به آموزش داشته باشد.** کسی که
 * می‌خواهد گزارشِ فروش را بگیرد، نباید بداند ستون‌ها کدام‌اند یا فرقِ
 * «گروه‌بندی بر پایه‌ی کالا» با «بر پایه‌ی برند» چیست. پس هر خروجی یک کارت
 * است: نام، یک خط توضیح، صافی‌هایی که لازم دارد، و یک دکمه برای هر قالب.
 *
 * دو تصمیمِ رابط:
 *
 *  ۱. **دانلود با پیوند، نه با جاوااسکریپت.** دکمه در واقع یک `<a>` است با
 *     نشانیِ میانجیِ خودمان. چرا؟ چون اگر با `fetch` و `Blob` می‌گرفتیم،
 *     خطا را باید خودمان نشان می‌دادیم و پرونده تا تمام شدن در حافظه‌یِ
 *     مرورگر می‌ماند. با پیوند، مرورگر خودش می‌گیرد، نوارِ پیشرفت نشان
 *     می‌دهد، و اگر خطا بیاید (مثلاً ۴۰۳) همان را در صفحه می‌بینیم.
 *
 *  ۲. **بازه‌یِ تاریخ شمسی است و با تقویمِ کاربر.** هیچ انتخاب‌گرِ میلادی‌ای
 *     اینجا نیست؛ فروشنده با همان تاریخی کار می‌کند که در تقویمِ دیواری‌اش
 *     می‌بیند.
 */

export interface ExportItem {
  key: string;
  label: string;
  hint: string;
  formats: ReadonlyArray<'xlsx' | 'pdf'>;
  filters: ReadonlyArray<'from' | 'to' | 'status' | 'channel' | 'groupBy' | 'lowOnly'>;
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'همه‌ی وضعیت‌ها' },
  { value: 'pending_payment', label: 'در انتظارِ پرداخت' },
  { value: 'paid', label: 'پرداخت‌شده' },
  { value: 'processing', label: 'در حالِ آماده‌سازی' },
  { value: 'shipped', label: 'ارسال‌شده' },
  { value: 'delivered', label: 'تحویل‌شده' },
  { value: 'cancelled', label: 'ابطال‌شده' },
];

const CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'همه‌ی کانال‌ها' },
  { value: 'web', label: 'اینترنتی' },
  { value: 'pos', label: 'حضوری (صندوق)' },
  { value: 'phone', label: 'تلفنی' },
];

const GROUP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'variant', label: 'کالا' },
  { value: 'brand', label: 'برند' },
  { value: 'product_type', label: 'نوعِ کالا' },
  { value: 'day', label: 'روز' },
];

function today(): string {
  // تاریخِ امروز به شمسی — با کمکِ خودِ مرورگر (Intl)، بی‌نیاز از کتابخانه
  try {
    const parts = new Intl.DateTimeFormat('fa-IR-u-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '01';
    return `${get('year')}/${get('month')}/${get('day')}`;
  } catch {
    return '';
  }
}

export function ExportsPanel({ items }: { items: ExportItem[] }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [groupBy, setGroupBy] = useState('variant');
  const [error, setError] = useState<string | null>(null);

  const hint = useMemo(() => `مثلِ ${today() || '۱۴۰۵/۰۶/۲۶'}`, []);

  function linkFor(item: ExportItem, format: 'xlsx' | 'pdf'): string {
    const params = new URLSearchParams();
    for (const filter of item.filters) {
      if (filter === 'from' && from) params.set('from', from);
      if (filter === 'to' && to) params.set('to', to);
      if (filter === 'status' && status) params.set('status', status);
      if (filter === 'channel' && channel) params.set('channel', channel);
      if (filter === 'groupBy') params.set('groupBy', groupBy);
    }
    const query = params.toString();
    return `/api/admin/exports/${item.key}.${format}${query ? `?${query}` : ''}`;
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="panel__title">صافیِ همگانی</h2>
        <p className="muted">
          این صافی‌ها رویِ خروجی‌هایی اثر می‌گذارند که به آن‌ها نیاز دارند. تاریخ را شمسی وارد کنید.
        </p>

        <div className="stats">
          <label className="field">
            <span className="field__label">از تاریخ</span>
            <ShamsiDatePicker value={from} onChange={setFrom} format="jalali" placeholder="۱۴۰۵/۰۱/۰۱" />
            <span className="field__help">{hint}</span>
          </label>

          <label className="field">
            <span className="field__label">تا تاریخ</span>
            <ShamsiDatePicker value={to} onChange={setTo} format="jalali" placeholder="۱۴۰۵/۰۶/۲۶" />
            <span className="field__help">اگر خالی بماند، «امروز» است.</span>
          </label>

          <label className="field">
            <span className="field__label">وضعیتِ سفارش</span>
            <select className="field__input" value={status} onChange={(event) => setStatus(event.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">کانالِ فروش</span>
            <select className="field__input" value={channel} onChange={(event) => setChannel(event.target.value)}>
              {CHANNEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">گروه‌بندیِ سودِ ناخالص</span>
            <select className="field__input" value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
              {GROUP_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="field__help">فقط برایِ گزارشِ سودِ ناخالص.</span>
          </label>
        </div>
      </section>

      {error ? <div className="alert alert--danger">{error}</div> : null}

      <div className="cards">
        {items.map((item) => (
          <section className="panel" key={item.key}>
            <h2 className="panel__title">{item.label}</h2>
            <p className="muted">{item.hint}</p>
            <div className="actions">
              {item.formats.map((format) => (
                <a
                  key={format}
                  className={`btn ${format === 'pdf' ? 'btn--ghost' : 'btn--primary'}`}
                  href={linkFor(item, format)}
                  // دانلود است، نه جابه‌جاییِ صفحه
                  download
                >
                  {format === 'pdf' ? 'دریافتِ پی‌دی‌اف' : 'دریافتِ اکسل'}
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="muted">
        اکسل برایِ کارِ بعدی است (جمع‌بستن، صافی گذاشتن، نمودار)؛ پی‌دی‌اف برایِ چاپ و فرستادن. هر دو از
        یک مدل ساخته می‌شوند، پس ستون‌ها و مبالغ‌شان یکی است. مبالغ به ریال‌اند.
      </p>
    </div>
  );
}
