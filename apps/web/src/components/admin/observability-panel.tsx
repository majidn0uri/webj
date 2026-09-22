'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { faDigits } from '@/lib/format';
import {
  limitsAction,
  metricsAction,
  releaseLimitAction,
  setRateLimitEnabledAction,
  updateLimitAction,
  type BlockedRow,
  type LimitRow,
  type LimitsPayload,
  type MetricsPayload,
} from '@/lib/observability-actions';

/**
 * پنلِ سلامت و مهارِ بار.
 *
 * آنچه اینجا اهمیت دارد، «نمودار» نیست — **تصمیم** است. مدیر با این صفحه
 * سه کار می‌کند: می‌فهمد کندی کجاست، سقف را جابه‌جا می‌کند، و اگر مشتری‌ای
 * پشتِ سقف گیر کرده آزادش می‌کند. هر سه باید بی‌تماس با سرور ممکن باشند.
 *
 * یک تصمیمِ رابط: جدولِ «کندترین مسیرها» بالاتر از جدولِ «سقف‌ها» است. چون
 * کسی که به این صفحه می‌آید یا شکایت از کندی دارد (و باید نخست پاسخش را
 * بگیرد) یا آمده تنظیم کند (و برایِ رسیدن به سقف‌ها، کمی پایین‌تر می‌آید).
 */

/** پنجره را به ثانیه/دقیقه/ساعت می‌گرداند — «۳۶۰۰ ثانیه» برایِ کسی معنا ندارد */
function windowText(seconds: number): string {
  if (seconds % 3600 === 0) return `${faDigits(String(seconds / 3600))} ساعت`;
  if (seconds % 60 === 0) return `${faDigits(String(seconds / 60))} دقیقه`;
  return `${faDigits(String(seconds))} ثانیه`;
}

function uptimeText(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${faDigits(String(h))} ساعت و ${faDigits(String(m))} دقیقه`;
  if (m > 0) return `${faDigits(String(m))} دقیقه`;
  return `${faDigits(String(seconds))} ثانیه`;
}

const STORE_LABEL: Record<string, string> = { memory: 'حافظه', db: 'پایگاه' };
const SCOPE_LABEL: Record<string, string> = {
  ip: 'بر پایهٔ نشانی',
  user: 'بر پایهٔ نشست',
  ip_user: 'نشانی + نشست',
};

interface Draft {
  maxRequests: string;
  windowSeconds: string;
}

function draftOf(row: LimitRow): Draft {
  return { maxRequests: String(row.maxRequests), windowSeconds: String(row.windowSeconds) };
}

export function ObservabilityPanel() {
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [limits, setLimits] = useState<LimitsPayload | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [live, setLive] = useState(true);

  const load = useCallback(async () => {
    const [m, l] = await Promise.all([metricsAction(), limitsAction()]);
    if (m.ok) setMetrics(m.data);
    else setMessage({ kind: 'err', text: m.message });
    if (l.ok) {
      setLimits(l.data);
      setDrafts((prev) => {
        const next: Record<string, Draft> = { ...prev };
        for (const row of l.data.items) if (!next[row.name]) next[row.name] = draftOf(row);
        return next;
      });
    } else if (!m.ok) {
      setMessage({ kind: 'err', text: l.message });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // تازه‌سازیِ خودکار: آمار کهنه بی‌فایده است — آدم برایِ «همین لحظه» نگاه
  // می‌کند. ده ثانیه کوتاه‌تر از آن است که خسته‌کننده شود و بلندتر از آن که
  // یک شلوغیِ ناگهانی را از دست بدهد.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void metricsAction().then((r) => r.ok && setMetrics(r.data)), 10_000);
    return () => clearInterval(timer);
  }, [live]);

  const pressure = metrics?.process.memoryPressure ?? 'normal';
  const pressureLabel =
    pressure === 'critical' ? 'بحرانی' : pressure === 'high' ? 'بالا' : 'عادی';

  const rules = limits?.items ?? [];
  const blocked: BlockedRow[] = limits?.blocked ?? [];

  const dirty = useMemo(
    () =>
      rules.filter((row) => {
        const draft = drafts[row.name];
        if (!draft) return false;
        return (
          draft.maxRequests !== String(row.maxRequests) ||
          draft.windowSeconds !== String(row.windowSeconds)
        );
      }),
    [rules, drafts],
  );

  async function toggleMaster() {
    const next = !(limits?.enabled ?? true);
    setBusy('master');
    const res = await setRateLimitEnabledAction(next);
    setBusy(null);
    if (res.ok) {
      setMessage({
        kind: next ? 'ok' : 'err',
        text: next ? 'مهارِ بار روشن شد.' : 'مهارِ بار خاموش شد — سامانه اکنون بی‌سقف است.',
      });
      void load();
    } else setMessage({ kind: 'err', text: res.message });
  }

  async function save(row: LimitRow) {
    const draft = drafts[row.name];
    if (!draft) return;
    setBusy(row.name);
    setMessage(null);
    const res = await updateLimitAction(row.name, {
      maxRequests: Number(draft.maxRequests),
      windowSeconds: Number(draft.windowSeconds),
    });
    setBusy(null);
    if (res.ok) {
      setMessage({ kind: 'ok', text: `سقفِ «${row.title}» به‌روزرسانی شد.` });
      void load();
    } else setMessage({ kind: 'err', text: res.message });
  }

  async function toggleRule(row: LimitRow) {
    setBusy(row.name);
    const res = await updateLimitAction(row.name, { isEnabled: !row.isEnabled });
    setBusy(null);
    if (res.ok) void load();
    else setMessage({ kind: 'err', text: res.message });
  }

  async function release(row: LimitRow, bucketKey?: string) {
    setBusy(`release-${row.name}`);
    const res = await releaseLimitAction(row.name, bucketKey);
    setBusy(null);
    if (res.ok) {
      setMessage({
        kind: 'ok',
        text: bucketKey
          ? `یک سطل از «${row.title}» آزاد شد.`
          : `${faDigits(String(res.data.released))} سطل از «${row.title}» آزاد شد.`,
      });
      void load();
    } else setMessage({ kind: 'err', text: res.message });
  }

  return (
    <div className="stack">
      {message ? (
        <div className={message.kind === 'ok' ? 'notice notice--ok' : 'notice notice--err'}>
          {message.text}
        </div>
      ) : null}

      <div className="cards cards--3">
        <div className="card card--stat">
          <span className="card__k">درخواست‌ها (از آغازِ این نمونه)</span>
          <strong className="card__v">
            {faDigits(String(metrics?.traffic.totals.requests ?? 0))}
          </strong>
          <span className="card__h">
            {faDigits(String(metrics?.traffic.throughput.avgPerSecond ?? 0))} در ثانیه (میانگینِ
            یک‌دقیقه)
          </span>
        </div>
        <div className="card card--stat">
          <span className="card__k">خطایِ سامانه (۵xx)</span>
          <strong className="card__v">
            {faDigits(String(metrics?.traffic.totals.errors ?? 0))}
          </strong>
          <span className="card__h">
            {faDigits(String(metrics?.traffic.totals.errorRatePercent ?? 0))} درصد از کل
          </span>
        </div>
        <div className="card card--stat">
          <span className="card__k">زمانِ پاسخ — صدکِ ۹۵</span>
          <strong className="card__v">
            {faDigits(String(Math.round(metrics?.traffic.latency.p95Ms ?? 0)))}
          </strong>
          <span className="card__h">
            میلی‌ثانیه — کندترین: {faDigits(String(Math.round(metrics?.traffic.latency.maxMs ?? 0)))}
          </span>
        </div>
        <div className="card card--stat">
          <span className="card__k">اوجِ ترافیک</span>
          <strong className="card__v">
            {faDigits(String(metrics?.traffic.throughput.peakPerSecond ?? 0))}
          </strong>
          <span className="card__h">درخواست در یک ثانیه</span>
        </div>
        <div className="card card--stat">
          <span className="card__k">حافظه</span>
          <strong className="card__v">{faDigits(String(metrics?.process.rssMb ?? 0))}</strong>
          <span className="card__h">
            مگابایت — فشار: {pressureLabel}
          </span>
        </div>
        <div className="card card--stat">
          <span className="card__k">زمانِ کار</span>
          <strong className="card__v">
            {uptimeText(metrics?.traffic.uptimeSeconds ?? 0)}
          </strong>
          <span className="card__h">{metrics?.database.kind ?? '—'}</span>
        </div>
      </div>

      <section className="card">
        <div className="u-flex u-flex-wrap u-items-center u-gap-3">
          <h2 className="card__title u-mr-auto" >
            مهارِ بار
          </h2>
          <span className={limits?.enabled ? 'pill pill--ok' : 'pill pill--danger'}>
            {limits?.enabled ? 'روشن' : 'خاموش — بی‌سقف'}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--xs"
            onClick={() => setLive((v) => !v)}
            aria-pressed={live}
          >
            {live ? 'تازه‌سازیِ خودکار: روشن' : 'تازه‌سازیِ خودکار: خاموش'}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--xs"
            onClick={() => void load()}
            disabled={loading}
          >
            تازه‌سازی
          </button>
          <button
            type="button"
            className={limits?.enabled ? 'btn btn--danger btn--xs' : 'btn btn--primary btn--xs'}
            onClick={() => void toggleMaster()}
            disabled={busy === 'master'}
          >
            {limits?.enabled ? 'خاموش کردنِ اضطراری' : 'روشن کردن'}
          </button>
        </div>

        <p className="field__hint u-mt-2 u-mb-2" >
          سقفِ هر بخش را تغییر دهید و «ذخیره» را بزنید؛ تغییر حداکثر ظرفِ چند ثانیه اِعمال
          می‌شود و نیازی به راه‌اندازیِ دوباره نیست. «حافظه» یعنی شمارش در همین نمونه‌یِ سامانه
          (ارزان، برایِ مسیرهایِ پُرفشار) و «پایگاه» یعنی شمارشِ یکسان در میانِ همه‌یِ نمونه‌ها
          (برایِ مسیرهایِ امنیتی).
          {limits?.internalCallsExempt
            ? ' تماس‌هایِ درونیِ وب با سامانه، از سقف‌هایِ حافظه‌ای معاف‌اند.'
            : ''}
        </p>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>بخش</th>
                <th>سقف</th>
                <th>پنجره</th>
                <th>گستره و جایگاه</th>
                <th>وضعیت</th>
                <th>آخرین تغییر</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((row) => {
                const draft = drafts[row.name];
                const isDirty = dirty.some((d) => d.name === row.name);
                return (
                  <tr key={row.name}>
                    <td>
                      <div className="u-font-semibold">{row.title}</div>
                      <div className="field__hint">{row.hint}</div>
                      <div className="mono u-text-xs" dir="ltr" >
                        {row.name}
                      </div>
                    </td>
                    <td>
                      <input
                        className="field__input u-w-7rem"
                        
                        inputMode="numeric"
                        value={draft?.maxRequests ?? String(row.maxRequests)}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [row.name]: {
                              maxRequests: e.target.value.replace(/[^\d]/g, ''),
                              windowSeconds: prev[row.name]?.windowSeconds ?? String(row.windowSeconds),
                            },
                          }))
                        }
                        aria-label={`سقفِ ${row.title}`}
                      />
                      <div className="field__hint">درخواست</div>
                    </td>
                    <td>
                      <input
                        className="field__input u-w-7rem"
                        
                        inputMode="numeric"
                        value={draft?.windowSeconds ?? String(row.windowSeconds)}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [row.name]: {
                              windowSeconds: e.target.value.replace(/[^\d]/g, ''),
                              maxRequests: prev[row.name]?.maxRequests ?? String(row.maxRequests),
                            },
                          }))
                        }
                        aria-label={`پنجره‌یِ ${row.title}`}
                      />
                      <div className="field__hint">{windowText(Number(draft?.windowSeconds ?? row.windowSeconds))}</div>
                    </td>
                    <td>
                      <span className="pill pill--muted">{SCOPE_LABEL[row.scope] ?? row.scope}</span>{' '}
                      <span className="pill pill--muted">{STORE_LABEL[row.store] ?? row.store}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--ghost btn--xs"
                        onClick={() => void toggleRule(row)}
                        disabled={busy === row.name}
                      >
                        {row.isEnabled ? 'فعال' : 'خاموش'}
                      </button>
                    </td>
                    <td>
                      {row.updatedAtShamsi ? (
                        <>
                          <div>{faDigits(row.updatedAtShamsi)}</div>
                          <div className="field__hint">{row.updatedByName ?? '—'}</div>
                        </>
                      ) : (
                        <span className="field__hint">تغییری نکرده</span>
                      )}
                    </td>
                    <td>
                      <div className="u-flex u-flex-wrap u-gap-2">
                        <button
                          type="button"
                          className="btn btn--primary btn--xs"
                          onClick={() => void save(row)}
                          disabled={!isDirty || busy === row.name}
                        >
                          ذخیره
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--xs"
                          onClick={() => void release(row)}
                          disabled={busy === `release-${row.name}`}
                          title="پاک کردنِ همه‌یِ شمارنده‌هایِ این قاعده"
                        >
                          آزادسازی
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={7}>قاعده‌ای تعریف نشده است.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">کندترین مسیرها</h2>
        <p className="field__hint u-mt-2 u-mb-2" >
          بر پایهٔ صدکِ ۹۵: یعنی از هر بیست درخواست، کندترینِ آن‌ها. میانگین این را نشان
          نمی‌دهد — یک درخواستِ دوثانیه‌ای در میانِ صد درخواستِ تند، در میانگین گم می‌شود.
        </p>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>مسیر</th>
                <th>درخواست‌ها</th>
                <th>میانگین</th>
                <th>صدکِ ۹۵</th>
                <th>کندترین</th>
                <th>خطایِ ۵xx</th>
              </tr>
            </thead>
            <tbody>
              {(metrics?.traffic.slowestRoutes ?? []).map((row) => (
                <tr key={`${row.method} ${row.route}`}>
                  <td className="mono" dir="ltr">
                    {row.method} {row.route}
                  </td>
                  <td>{faDigits(String(row.count))}</td>
                  <td>{faDigits(String(Math.round(row.avgMs)))}</td>
                  <td>
                    <strong>{faDigits(String(Math.round(row.p95Ms)))}</strong>
                  </td>
                  <td>{faDigits(String(Math.round(row.maxMs)))}</td>
                  <td>{faDigits(String(row.errors))}</td>
                </tr>
              ))}
              {(metrics?.traffic.slowestRoutes ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6}>هنوز درخواستی ثبت نشده است.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">مسدودشدن‌هایِ اخیر</h2>
        <p className="field__hint u-mt-2 u-mb-2" >
          هر ردیف یعنی یک «سطل» (یک بازدیدکننده یا یک نشست) که در یک پنجره به سقف رسیده است —
          نه هر درخواستِ ردشده؛ وگرنه یک حمله می‌توانست همین جدول را پر کند. ستونِ «تکرار»
          می‌گوید در آن پنجره چند بار دیگر هم کوشیده شد.
        </p>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>قاعده</th>
                <th>سطل (نشانی/نشست)</th>
                <th>مسیر</th>
                <th>تکرار</th>
                <th>آخرین بار</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {blocked.map((row) => (
                <tr key={row.id}>
                  <td className="mono" dir="ltr">
                    {row.ruleName}
                  </td>
                  <td className="mono" dir="ltr">
                    {row.bucketKey}
                  </td>
                  <td className="mono" dir="ltr">
                    {row.method ? `${row.method} ` : ''}
                    {row.path ?? '—'}
                  </td>
                  <td>{faDigits(String(row.seen))}</td>
                  <td>{faDigits(row.lastSeenAtShamsi)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--ghost btn--xs"
                      onClick={() =>
                        void release(
                          { name: row.ruleName, title: row.ruleName } as LimitRow,
                          row.bucketKey,
                        )
                      }
                    >
                      آزادسازی
                    </button>
                  </td>
                </tr>
              ))}
              {blocked.length === 0 ? (
                <tr>
                  <td colSpan={6}>هیچ مسدودشدنی ثبت نشده است.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
