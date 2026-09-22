'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import {
  loadMissingSstid,
  loadTaxInvoices,
  loadTaxSummary,
  loadVatReturn,
  retryTaxInvoice,
  sendTaxBatch,
  setProductSstidAction,
  type TaxQueueItem,
  type TaxSummary,
  type VatReturnPayload,
} from '@/lib/tax-actions';
import { toman } from '@/lib/format';
import { CertificatePanel } from './certificate-panel';

/**
 * پنلِ مالیات و سامانه‌یِ مؤدیان.
 *
 * سه پرسش که این صفحه باید در کمتر از ده ثانیه جواب بدهد:
 *   ۱) آیا صورتحساب‌هایم به سازمان رفته‌اند؟ (سربرگ: وضعیتِ صف)
 *   ۲) این ماه چقدر ارزش‌افزوده بدهکارم؟ (اظهارنامه: برون‌داد − درون‌داد)
 *   ۳) چرا بعضی صورتحساب‌ها رد شده‌اند و چه باید کرد؟ (جدولِ صف، با علت)
 *
 * اصلِ طراحی: **هیچ ارسالی بی‌توضیح نیست**. هر ردیف یا تأیید شده، یا علتش
 * نوشته شده. دکمه‌یِ ارسال همیشه نتیجه را می‌گوید (چند تا رفت، چند تا نرفت)
 * تا مدیر مجبور نباشد حدس بزند.
 */

const STATUS_ORDER = ['queued', 'sending', 'sent', 'failed', 'rejected', 'accepted'];

function statusClass(status: string): string {
  if (status === 'accepted') return 'pill pill--ok';
  if (status === 'rejected') return 'pill pill--danger';
  if (status === 'failed') return 'pill pill--warn';
  if (status === 'sent') return 'pill pill--info';
  return 'pill';
}

export function TaxPanel({ canSend }: { canSend: boolean }) {
  const [summary, setSummary] = useState<TaxSummary | null>(null);
  const [rows, setRows] = useState<TaxQueueItem[]>([]);
  const [vat, setVat] = useState<VatReturnPayload | null>(null);
  const [missing, setMissing] = useState<Array<{ productId: string; title: string }>>([]);
  const [filter, setFilter] = useState<string>('');
  const [kind, setKind] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refreshAll = useCallback(() => {
    startTransition(async () => {
      const [s, i, v, m] = await Promise.all([
        loadTaxSummary(),
        loadTaxInvoices(filter || undefined, kind || undefined),
        loadVatReturn(),
        loadMissingSstid(),
      ]);
      if (s.ok) setSummary(s.data);
      else setError(s.message);
      if (i.ok) setRows(i.data);
      if (v.ok) setVat(v.data);
      if (m.ok) setMissing(m.data.map((p) => ({ productId: p.productId, title: p.title })));
    });
    // هر دو فیلتر در وابستگی‌اند: اگر نوع اینجا نباشد، با تغییرِ آن جدول کهنه می‌ماند
  }, [filter, kind]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  function send() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await sendTaxBatch(50);
      if (res.ok) setMessage(res.message);
      else setError(res.message);
      refreshAll();
    });
  }

  function retry(id: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await retryTaxInvoice(id);
      if (res.ok) setMessage(res.message);
      else setError(res.message);
      refreshAll();
    });
  }

  const counts = summary?.queue.byStatus ?? {};
  const total = summary?.queue.total ?? 0;

  return (
    <div className="panel panel--flush panel--flush">
      <div className="panel__head">
        <div>
          <h2 className="head__title">مالیات و سامانه‌یِ مؤدیان</h2>
          <p className="head__sub">
            وضعیتِ صورتحساب‌هایِ الکترونیکی نزدِ سازمانِ امورِ مالیاتی، و
            اظهارنامه‌یِ ارزش‌افزوده‌یِ دوره
          </p>
        </div>
        {canSend ? (
          <button type="button" className="btn btn--primary" onClick={send} disabled={pending}>
            {pending ? 'در حالِ ارسال…' : 'ارسالِ دسته‌ای و استعلامِ وضعیت'}
          </button>
        ) : null}
      </div>

      {error ? <div className="alert alert--danger">{error}</div> : null}
      {message ? <div className="alert alert--ok">{message}</div> : null}

      {/* ── سربرگ: یک نگاه کافی باشد ───────────────────────────────── */}
      <div className="grid3">
        <div className="stat">
          <div className="stat__label">در صفِ ارسال</div>
          <div className="stat__value num">{counts.queued ?? 0}</div>
          <div className="stat__hint">
            {summary?.queue.oldestQueuedFa
              ? `قدیمی‌ترین: ${summary.queue.oldestQueuedFa}`
              : 'هیچ صورتحسابی در انتظار نیست'}
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">تأییدشده</div>
          <div className="stat__value num ok">{counts.accepted ?? 0}</div>
          <div className="stat__hint">از مجموعِ {total} صورتحساب</div>
        </div>
        <div className="stat">
          <div className="stat__label">ردشده / ناموفق</div>
          <div className="stat__value num bad">
            {(counts.rejected ?? 0) + (counts.failed ?? 0)}
          </div>
          <div className="stat__hint">نیازمندِ اصلاح یا تلاشِ دوباره</div>
        </div>
      </div>

      {summary && !summary.settings.ready ? (
        <div className="alert alert--warn">
          برایِ ارسال، سه چیز لازم است: «شناسه‌یِ یکتایِ حافظه‌یِ مالیاتی»،
          «شناسه‌یِ ملیِ فروشنده» و «کدِ پستیِ ۱۰ رقمی». آن‌ها را در{' '}
          <b>تنظیمات ← مالیات</b> کامل کنید. تا آن زمان صورتحساب‌ها ساخته و در
          صف نگه داشته می‌شوند، اما فرستاده نمی‌شوند.
        </div>
      ) : null}

      {missing.length > 0 ? (
        <div className="alert alert--warn">
          {missing.length} کالا «شناسه‌یِ کالا/خدمت» ندارد
          {missing.length <= 3 ? ` (${missing.map((p) => p.title).join('، ')})` : ''}. تا
          وقتی این شناسه ثبت نشود، صورتحسابِ آن‌ها رد می‌شود.
        </div>
      ) : null}

      {/* ── اظهارنامه ─────────────────────────────────────────────── */}
      {vat ? (
        <section className="panel panel--flush subpanel">
          <h3 className="panel__title">
            اظهارنامه‌یِ ارزش‌افزوده ({vat.display.from} تا {vat.display.to})
          </h3>
          <table className="table">
            <tbody>
              <tr>
                <th>فروشِ دوره (مشمولِ مالیات)</th>
                <td className="num">{vat.display.sales} تومان</td>
                <th>مالیاتِ برون‌داد (گرفته‌شده از مشتری)</th>
                <td className="num">{vat.display.outputVat} تومان</td>
              </tr>
              <tr>
                <th>خریدِ دوره</th>
                <td className="num">{vat.display.purchases} تومان</td>
                <th>مالیاتِ درون‌داد (پرداختی به تأمین‌کننده)</th>
                <td className="num">{vat.display.inputVat} تومان</td>
              </tr>
              <tr>
                <th>تعدادِ فروش‌ها</th>
                <td className="num">{vat.report.output.orderCount}</td>
                <th>
                  <b>خالصِ قابلِ پرداخت</b>
                </th>
                <td className="num">
                  <b>{vat.display.netPayable} تومان</b>{' '}
                  <span className={vat.report.direction === 'payable' ? 'bad' : 'ok'}>
                    {vat.display.direction}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          {vat.report.output.byRate.length > 0 ? (
            <table className="table table--inner">
              <thead>
                <tr>
                  <th>نرخ</th>
                  <th>مبلغِ مشمول</th>
                  <th>مالیات</th>
                  <th>تعدادِ ردیف</th>
                </tr>
              </thead>
              <tbody>
                {vat.report.output.byRate.map((r) => (
                  <tr key={r.ratePercent}>
                    <td className="num">{r.ratePercent ?? '۰'}٪</td>
                    <td className="num">{toman(r.taxableRial)}</td>
                    <td className="num">{toman(r.vatRial)}</td>
                    <td className="num">{r.lines}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {vat.report.warnings.length > 0 ? (
            <div className="alert alert--warn">
              <b>پیش از بستنِ دوره:</b>
              <ul className="hints">
                {vat.report.warnings.map((w) => (
                  <li key={w.kind}>{w.detail}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ── صف ────────────────────────────────────────────────────── */}
      <section className="panel panel--flush subpanel">
        <div className="panel__head">
          <h3 className="panel__title">صورتحساب‌ها</h3>
          <select
            className="field__input field__input--sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">همه</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
          <select
            className="field__input field__input--sm"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">فروش و اصلاحی</option>
            <option value="sale">فقط فروش</option>
            <option value="credit_note">فقط اصلاحیِ مرجوعی</option>
          </select>
        </div>

        {rows.length === 0 ? (
          <p className="empty">صورتحسابی با این فیلتر نیست.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>نوع</th>
                <th>شماره‌ی سفارش</th>
                <th>دوره</th>
                <th>شناسه‌ی مالیاتی</th>
                <th>وضعیت</th>
                <th>ثبت</th>
                <th>علت (در صورتِ رد)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className={r.kind === 'credit_note' ? 'pill pill--warn' : 'pill'}>
                      {r.kindLabel}
                    </span>
                  </td>
                  <td className="num">{r.orderNo}</td>
                  <td className="num muted">{r.periodKey}</td>
                  <td className="num muted">{r.taxid ?? '—'}</td>
                  <td>
                    <span className={statusClass(r.status)}>{r.statusLabel}</span>
                  </td>
                  <td className="num muted">{r.createdAtFa}</td>
                  <td className="muted hint-cell">{r.errorDetail ?? '—'}</td>
                  <td>
                    {canSend && (r.status === 'failed' || r.status === 'rejected') ? (
                      <button
                        type="button"
                        className="btn btn--xs btn--ghost"
                        disabled={pending}
                        onClick={() => retry(r.id)}
                      >
                        تلاشِ دوباره
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── کالاهایِ بی‌شناسه ─────────────────────────────────────── */}
      {missing.length > 0 ? <SstidFixer products={missing} onDone={refreshAll} /> : null}

      {/*
        گاوصندوقِ گواهی: چرا اینجا و نه در «تنظیمات»؟ چون پرسشِ مدیر این نیست
        که «گواهی کجاست»؛ پرسش این است که «چرا صورتحساب‌هایم رد می‌شوند».
        گواهی در همان صفحه‌ای که رد‌شدن‌ها را می‌بینی باید قابلِ دیدن و
        آزمودن باشد — نه در صفحه‌ای دیگر.
      */}
      <CertificatePanel canManage={canSend} />
    </div>
  );
}

/** ثبتِ دسته‌جمعیِ «شناسه‌یِ کالا/خدمت» — کاری که باید یک‌بار انجام شود */
function SstidFixer({
  products,
  onDone,
}: {
  products: Array<{ productId: string; title: string }>;
  onDone: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(productId: string) {
    const sstid = values[productId]?.trim();
    if (!sstid) return;
    setMsg(null);
    startTransition(async () => {
      const res = await setProductSstidAction({ productId, sstid });
      setMsg(res.ok ? res.message : res.message);
      onDone();
    });
  }

  return (
    <section className="panel subpanel">
      <h3 className="panel__title">ثبتِ شناسه‌یِ کالا/خدمت</h3>
      <p className="muted">
        این شناسه را از درگاهِ <span className="code">stuffid.tax.gov.ir</span> می‌گیرید؛
        سازمان بدونِ آن صورتحساب را می‌پذیرد اما ردیفِ کالا را رد می‌کند.
      </p>
      {msg ? <div className="alert alert--ok">{msg}</div> : null}
      <div className="sstid">
        {products.map((p) => (
          <div className="sstid__row" key={p.productId}>
            <span className="sstid__title">{p.title}</span>
            <input
              className="field__input field__input--sm"
              value={values[p.productId] ?? ''}
              inputMode="numeric"
              placeholder="مانندِ ۲۷۲۰۰۰۰۱۱۴۵۴۲"
              onChange={(e) => setValues((v) => ({ ...v, [p.productId]: e.target.value }))}
            />
            <button
              type="button"
              className="btn btn--xs btn--primary"
              disabled={pending || !values[p.productId]?.trim()}
              onClick={() => save(p.productId)}
            >
              ثبت
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: 'در صف',
    sending: 'در حالِ ارسال',
    sent: 'فرستاده‌شده',
    accepted: 'تأییدشده',
    rejected: 'ردشده',
    failed: 'ناموفق',
  };
  return labels[status] ?? status;
}
