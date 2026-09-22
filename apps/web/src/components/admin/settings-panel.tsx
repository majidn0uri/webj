'use client';

import { useState } from 'react';
import {
  flushSmsOutbox,
  requeueSmsOutbox,
  saveSettings,
  saveSmsTemplate,
  type SmsTestResult,
} from '@/lib/settings-actions';
import { testSmsSend } from '@/lib/settings-actions';
import { QueueStatsCard, type SmsStats } from './queue-stats-card';

/** آنچه «آزمونِ ارسال» و چک‌لیستِ تنظیم نیاز دارند (سرور آن را می‌خواند) */
export interface ReadinessItem {
  key: string;
  label: string;
  ok: boolean;
  severity: 'blocker' | 'warn' | 'info';
  hint: string | null;
}

export interface Readiness {
  provider: string;
  providerKnown: boolean;
  enabled: boolean;
  hasApiKey: boolean;
  hasSender: boolean;
  dryRun: boolean;
  maxAttempts: number;
  backoffMinutes: number;
  checks: ReadinessItem[];
  counts: Record<string, number>;
  blockedTemplates: Array<{
    key: string;
    title: string | null;
    providerTemplateId: string | null;
    blocked: number;
    placeholders: string[];
    isActive: boolean;
  }>;
  requeueable: number;
  canSendNow: boolean;
}

/**
 * پنلِ تنظیمات و مرکزِ پیامک.
 *
 * چرا اینجا همه‌ی تنظیمات در یک صفحه‌اند؟ چون تنظیمات چیزی نیست که هر روز
 * تغییر کند؛ پراکندگی‌اش در چند صفحه یعنی جست‌وجویِ مدام. اما «قالب‌هایِ
 * پیامک» چیزِ دیگری است: آن‌ها را مدیر بارها می‌نویسد و باید در یک نگاه
 * کنارِ هم باشند تا لحنِ پیام‌ها یکی بماند.
 *
 * یک نکته‌یِ امنیتیِ نمایشی: کلیدهایِ محرمانه (درگاه، پیامک) فقط «تنظیم شده /
 * نشده» و چهار رقمِ آخر را نشان می‌دهند. مقدارِ تازه فقط هنگامِ نوشتن فرستاده
 * می‌شود و هرگز به مرورگر برنمی‌گردد.
 */

interface Item {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'secret';
  hint: string | null;
  options: Array<{ value: string; label: string }> | null;
  value: string;
  isSet: boolean;
  updatedAt: string | null;
}

interface Group {
  key: string;
  title: string;
  hint: string;
  items: Item[];
}

interface Template {
  key: string;
  title: string | null;
  body: string;
  providerTemplateId: string | null;
  isActive: boolean;
  placeholders: string[];
  /** متغیرهایِ لازمی که در متن جا افتاده‌اند */
  missingRequired: string[];
  updatedAt: string | null;
}

interface OutboxItem {
  id: string;
  phone: string;
  templateKey: string | null;
  body: string;
  status: string;
  providerRef: string | null;
  /** چند بار تلاش شده — بی‌این، «ناموفق» یعنی حدسِ بی‌پایان */
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  sentAt: string | null;
}

type Tab = 'settings' | 'templates' | 'outbox' | 'test';

const STATUS_LABEL: Record<string, string> = {
  pending: 'در صف',
  sending: 'در حالِ ارسال',
  sent: 'فرستاده‌شده',
  failed: 'ناموفق (دوباره در نوبت)',
  dead: 'از تلاش ناامید شدیم',
  skipped: 'رد شده',
};

/** رنگِ وضعیت‌ها: «ناامیدکننده» باید از «موقتاً ناموفق» جدا باشد، وگرنه
 *  مدیر هر دو را یک چیز می‌بیند و نمی‌فهمد کدام‌اش خودش درست می‌شود */
function pillClass(status: string): string {
  if (status === 'sent') return 'pill pill--ok';
  if (status === 'failed' || status === 'dead') return 'pill pill--danger';
  if (status === 'sending') return 'pill pill--warn';
  return 'pill';
}

const Template_FA: Record<string, string> = {
  welcome: 'خوش‌آمدگویی',
  otp_login: 'کدِ ورود',
  order_confirmed: 'تأییدِ سفارش',
  order_paid: 'پرداخت موفق',
  order_shipped: 'ارسالِ سفارش',
  order_delivered: 'تحویلِ سفارش',
  order_cancelled: 'لغوِ سفارش',
  invoice_issued: 'صدورِ فاکتور',
  check_due: 'سررسیدِ چک',
  check_bounced: 'برگشتِ چک',
  product_back: 'موجود شدنِ کالا',
};

export function SettingsPanel({
  groups,
  templates,
  outbox,
  outboxCounts,
  readiness,
  stats,
  canWrite,
}: {
  groups: Group[];
  templates: Template[];
  outbox: OutboxItem[];
  outboxCounts: Record<string, number>;
  /** وضعیتِ آماده‌به‌ارسال؛ null یعنی سرور نتوانست بخواند (و صفحه باید کار کند) */
  readiness: Readiness | null;
  /** پایشِ صف؛ null یعنی مسیرش خطا داد — نمودار غایب است ولی صندوق کار می‌کند */
  stats: SmsStats | null;
  canWrite: boolean;
}) {
  const [tab, setTab] = useState<Tab>('settings');
  // آزمونِ ارسال: شماره و قالب، بی‌صف
  const [testPhone, setTestPhone] = useState('');
  const [testTemplate, setTestTemplate] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testOut, setTestOut] = useState<SmsTestResult | string | null>(null);
  const [requeueBusy, setRequeueBusy] = useState(false);
  const [requeueOut, setRequeueOut] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // پیش‌نویسِ قالب‌ها
  const [tpl, setTpl] = useState<Record<string, { body: string; providerTemplateId: string; isActive: boolean }>>(
    () =>
      Object.fromEntries(
        templates.map((t) => [t.key, { body: t.body, providerTemplateId: t.providerTemplateId ?? '', isActive: t.isActive }]),
      ),
  );

  const valueOf = (item: Item) => draft[item.key] ?? item.value;
  const isDirty = Object.keys(draft).length > 0;

  async function save() {
    setBusy(true);
    setMessage(null);
    const out = await saveSettings(draft);
    setBusy(false);
    if (out.ok) setDraft({});
    setMessage(out.ok ? { kind: 'ok', text: out.message ?? 'ذخیره شد.' } : { kind: 'err', text: out.message });
  }

  async function requeue(templateKey?: string) {
    setRequeueBusy(true);
    setRequeueOut(null);
    const out = await requeueSmsOutbox(templateKey ? { templateKey } : {});
    setRequeueBusy(false);
    setRequeueOut(
      out.ok
        ? `${out.result.requeued} پیام به صف برگشت` +
          (out.result.stillBlocked ? ` · همچنان ${out.result.stillBlocked} پیام بلوکه است` : '')
        : out.message,
    );
  }

  async function runTest() {
    setTestBusy(true);
    setTestOut(null);
    const out = await testSmsSend({ phone: testPhone, ...(testTemplate ? { templateKey: testTemplate } : {}) });
    setTestBusy(false);
    setTestOut(out.ok ? out.result : out.message);
  }

  async function flush() {
    setBusy(true);
    setMessage(null);
    const out = await flushSmsOutbox();
    setBusy(false);
    setMessage(out.ok ? { kind: 'ok', text: out.message ?? '' } : { kind: 'err', text: out.message });
  }

  async function saveTemplate(key: string) {
    setBusy(true);
    setMessage(null);
    const t = tpl[key];
    const out = await saveSmsTemplate(key, {
      body: t?.body,
      providerTemplateId: t?.providerTemplateId,
      isActive: t?.isActive,
    });
    setBusy(false);
    setMessage(out.ok ? { kind: 'ok', text: out.message ?? 'ذخیره شد.' } : { kind: 'err', text: out.message });
  }

  return (
    <>
      <header className="head">
        <h1 className="head__title">تنظیمات</h1>
        <p className="head__sub">
          {groups.length} گروه · {templates.length} قالبِ پیامک ·{' '}
          <span className="num">{outboxCounts.pending ?? 0}</span> پیامک در صف
        </p>
      </header>

      <div className="tabs" role="tablist">
        {(
          [
            ['settings', 'تنظیمات'],
            ['templates', `قالب‌هایِ پیامک (${templates.length})`],
            ['outbox', `صندوقِ پیامک (${outbox.length})`],
            ['test', 'آزمونِ ارسال'],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`tab${tab === key ? ' tab--active' : ''}`}
            onClick={() => setTab(key)}
          >
            <span className="tab__label">{label}</span>
          </button>
        ))}
      </div>

      {message && (
        <div className={message.kind === 'ok' ? 'alert alert--ok' : 'alert alert--danger'}>{message.text}</div>
      )}

      {tab === 'settings' && (
        <>
          {groups.map((g) => (
            <section className="panel u-mb-4" key={g.key} >
              <div className="panel__head">
                <h2 className="panel__title">{g.title}</h2>
              </div>
              <p className="muted u-text-xs u-mt-0 u-mb-3" >
                {g.hint}
              </p>
              <div className="u-grid u-grid-auto u-gap-3">
                {g.items.map((item) => (
                  <label className="field" key={item.key}>
                    <span className="field__label">
                      {item.label}
                      {item.type === 'secret' && (
                        <span className="pill pill-inline" >
                          {item.isSet ? 'تنظیم شده' : 'خالی'}
                        </span>
                      )}
                    </span>

                    {item.type === 'boolean' || item.type === 'select' ? (
                      <select
                        className="field__input"
                        value={valueOf(item)}
                        disabled={!canWrite}
                        onChange={(e) => setDraft({ ...draft, [item.key]: e.target.value })}
                      >
                        {item.type === 'boolean'
                          ? [
                              <option key="t" value="true">بله</option>,
                              <option key="f" value="false">خیر</option>,
                            ]
                          : (item.options ?? []).map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                      </select>
                    ) : (
                      <input
                        className="field__input"
                        type={item.type === 'number' ? 'number' : item.type === 'secret' ? 'password' : 'text'}
                        value={valueOf(item)}
                        disabled={!canWrite}
                        placeholder={item.type === 'secret' ? 'برایِ تغییر، مقدارِ تازه را بنویسید' : ''}
                        onChange={(e) => setDraft({ ...draft, [item.key]: e.target.value })}
                      />
                    )}

                    {item.hint && (
                      <span className="muted u-text-xs" >
                        {item.hint}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </section>
          ))}

          {canWrite && (
            <div className="u-flex u-gap-2 u-items-center">
              <button className="btn btn--primary" type="button" disabled={busy || !isDirty} onClick={save}>
                {busy ? 'در حالِ ذخیره…' : 'ذخیره‌ی تنظیمات'}
              </button>
              {isDirty && (
                <button className="btn" type="button" onClick={() => setDraft({})} disabled={busy}>
                  انصراف
                </button>
              )}
              {!isDirty && <span className="muted u-text-xs" >تغییری ثبت نشده است.</span>}
            </div>
          )}
        </>
      )}

      {tab === 'templates' && (
        <section className="panel">
          <h2 className="panel__title">قالب‌هایِ پیامک</h2>
          <p className="muted u-text-xs u-mb-3" >
            متغیرها را با {'{'} و {'}'} می‌نویسید (مثلِ {'{code}'}).
            <strong> شناسه‌یِ قالب</strong> همان کدی است که ارسال‌کننده‌ی ایرانی پس از تأییدِ
            متن به شما می‌دهد؛ بدونِ آن پیامک در تولید فرستاده نمی‌شود.
          </p>
          <div className="u-grid u-gap-4">
            {templates.map((t) => (
              <div key={t.key} className="tpl-card">
                <div className="tpl-card__head">
                  <strong className="u-text-sm">{t.title ?? Template_FA[t.key] ?? t.key}</strong>
                  <code className="code" dir="ltr">{t.key}</code>
                  {t.placeholders.length > 0 && (
                    <span className="muted u-text-xs" >
                      متغیرها: {t.placeholders.map((p) => `{${p}}`).join('، ')}
                    </span>
                  )}
                  {t.missingRequired.length > 0 && (
                    <span className="pill pill--warn" title="این متغیر هنگامِ ارسال پر نمی‌شود">
                      جا افتاده: {t.missingRequired.map((p) => `{${p}}`).join('، ')}
                    </span>
                  )}
                  {!t.providerTemplateId && (
                    <span className="pill pill--danger" title="ارسال‌کننده‌هایِ ایرانی بدونِ شناسه‌یِ قالب، پیامک را نمی‌پذیرند">
                      بی‌شناسه
                    </span>
                  )}
                </div>
                {tpl[t.key]?.body !== t.body && (() => {
                  const missingNow = t.placeholders.filter(
                    (p) => !(tpl[t.key]?.body ?? '').includes(`{${p}}`),
                  );
                  return missingNow.length > 0 ? (
                    <p className="muted u-text-xs u-mb-2 text-warn">
                      با این متن، {missingNow.map((p) => `{${p}}`).join(' و ')} دیگر پر نمی‌شود.
                    </p>
                  ) : null;
                })()}
                <div className="u-grid u-grid-cols-2-1 u-gap-2">
                  <textarea
                    className="field__input u-min-h-60" 
                    value={tpl[t.key]?.body ?? ''}
                    disabled={!canWrite}
                    onChange={(e) => setTpl({ ...tpl, [t.key]: { ...tpl[t.key]!, body: e.target.value } })}
                  />
                  <div className="tpl-card__side">
                    <input
                      className="field__input"
                      placeholder="شناسه‌یِ قالب (ارسال‌کننده)"
                      value={tpl[t.key]?.providerTemplateId ?? ''}
                      disabled={!canWrite}
                      onChange={(e) =>
                        setTpl({ ...tpl, [t.key]: { ...tpl[t.key]!, providerTemplateId: e.target.value } })
                      }
                    />
                    <label className="tpl-card__label">
                      <input
                        type="checkbox"
                        checked={tpl[t.key]?.isActive ?? false}
                        disabled={!canWrite}
                        onChange={(e) =>
                          setTpl({ ...tpl, [t.key]: { ...tpl[t.key]!, isActive: e.target.checked } })
                        }
                      />
                      فعال
                    </label>
                    {canWrite && (
                      <button className="btn btn--sm" type="button" disabled={busy} onClick={() => saveTemplate(t.key)}>
                        ذخیره
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'test' && readiness && (
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">چرا پیامکی نمی‌رود؟</h2>
            <span className={readiness.canSendNow ? 'pill pill--ok' : 'pill pill--danger'}>
              {readiness.canSendNow ? 'آمادهٔ ارسال' : 'آماده نیست'}
            </span>
          </div>
          <ul className="readiness-list">
            {readiness.checks.map((c) => (
              <li key={c.key} className="u-flex u-items-start u-gap-2">
                <span className={c.ok ? 'pill pill--ok' : c.severity === 'blocker' ? 'pill pill--danger' : 'pill pill--warn'}>
                  {c.ok ? '✓' : c.severity === 'blocker' ? '×' : '!'}
                </span>
                <span className="u-flex-1">
                  {c.label}
                  {!c.ok && c.hint && (
                    <span className="muted u-block u-text-xs u-mt-2" >
                      {c.hint}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {readiness.blockedTemplates.some((t) => !t.providerTemplateId) && (
            <div className="alert alert--warn u-mt-3" >
              قالب‌هایِ زیر «شناسهٔ ارسال‌کننده» ندارند و پیام‌هایشان به سامانه
              نمی‌رود. آن‌ها را از تبِ «قالب‌ها» پر کنید — پس ازِ پرکردن،
              پیام‌هایِ جامانده خودبه‌خود برنمی‌گردند؛ دکمهٔ «بازگرداندنِ صف»
              پایینِ همین صفحه آن‌ها را دوباره نوبت می‌دهد.
              <ul className="panel-list">
                {readiness.blockedTemplates
                  .filter((t) => !t.providerTemplateId)
                  .slice(0, 6)
                  .map((t) => (
                    <li key={t.key}>
                      {Template_FA[t.key] ?? t.title ?? t.key}{' '}
                      <span className="muted">
                        ({t.blocked} پیام در انتظار{t.isActive ? '' : ' · قالب غیرفعال'} · متغیرها:{' '}
                        {t.placeholders.length ? t.placeholders.join('، ') : '—'})
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {canWrite && (
            <div className="u-flex u-flex-wrap u-items-center u-gap-2 u-mt-3">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => requeue()}
                disabled={requeueBusy || readiness.requeueable === 0}
              >
                {requeueBusy
                  ? 'در حالِ بازگردانی…'
                  : readiness.requeueable > 0
                    ? `بازگرداندنِ ${readiness.requeueable} پیام به صف`
                    : 'چیزی برایِ بازگردانی نیست'}
              </button>
              {requeueOut && <span className="muted u-text-xs" >{requeueOut}</span>}
            </div>
          )}
        </section>
      )}

      {tab === 'test' && (
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">آزمونِ ارسال</h2>
            <span className="panel__count">یک پیامک، بی‌صف</span>
          </div>
          <p className="muted u-text-sm u-mt-0" >
            یک پیامکِ واقعی به شماره‌یِ خودتان می‌فرستد تا معلوم شود کلید،
            قالب و اعتبارِ حساب درست کار می‌کنند یا نه. این پیام در «صندوقِ
            پیامک» ثبت نمی‌شود و{' '}
            <strong>اعتبارِ حسابِ پیامکی شما را مصرف می‌کند</strong> (تا پنج
            آزمون در هر ده دقیقه).
          </p>
          <div className="u-flex u-flex-wrap u-gap-2">
            <label className="field">
              <span className="field__label">شماره</span>
              <input
                className="field__input"
                dir="ltr"
                placeholder="09123456789"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                inputMode="tel"
              />
            </label>
            <label className="field">
              <span className="field__label">قالب</span>
              <select
                className="field__input"
                value={testTemplate}
                onChange={(e) => setTestTemplate(e.target.value)}
              >
                <option value="">فعال‌ترین قالب (خودکار)</option>
                {templates.map((t) => (
                  <option key={t.key} value={t.key}>
                    {(Template_FA[t.key] ?? t.title ?? t.key) + (t.providerTemplateId ? '' : ' — بی‌شناسهٔ سامانه')}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" onClick={runTest} disabled={testBusy || !canWrite || !testPhone.trim()}>
              {testBusy ? 'در حالِ ارسال…' : 'آزمون بفرست'}
            </button>
          </div>

          {testOut === null ? null : typeof testOut === 'string' ? (
            <div className="alert alert--danger u-mt-4" >{testOut}</div>
          ) : (
            <div className="test-result">
              <div>
                <span className={testOut.ok ? 'pill pill--ok' : 'pill pill--danger'}>
                  {testOut.ok ? 'رفت' : 'نرفت'}
                </span>{' '}
                <span className="muted u-text-xs" >
                  {testOut.provider} · {testOut.httpStatus ?? '—'} · {testOut.elapsedMs}ms
                  {testOut.ref ? ` · مرجع: ${testOut.ref}` : ''}
                  {typeof testOut.remainingTests === 'number' ? ` · ${testOut.remainingTests} آزمون باقی‌مانده` : ''}
                </span>
              </div>

              {/* آنچه واقعاً رفته، پیش ازِ هر چیز: متن، شناسهٔ قالب و متغیرها.
                  اگر مدیر این را با پیامکِ رویِ گوشی‌اش مقایسه کند، دو سومِ
                  «چرا درست نمی‌رسد؟»ها همین‌جا حل می‌شود */}
              <div className="card test-card" >
                <div className="muted">متنِ ارسالی</div>
                <div className="u-mt-2">{testOut.body}</div>
                <div className="muted u-mt-2" >
                  شناسهٔ قالب: <code className="code">{testOut.providerTemplateId ?? 'بی‌شناسه (متنِ آزاد)'}</code>
                  {' · '}
                  متغیرها: <span className="num">{testOut.vars.length}</span>
                  {testOut.vars.length > 0 ? ` (${testOut.vars.join('، ')})` : ''}
                </div>
              </div>

              {testOut.error && (
                <div className="alert alert--danger u-mb-0" >
                  {testOut.error}
                  {testOut.retryable === false && (
                    <div className="u-text-xs u-mt-2">
                      این خطا با تلاشِ دوباره درست نمی‌شود — تنظیم را ببینید.
                    </div>
                  )}
                </div>
              )}
              {testOut.notes.map((n) => (
                <div key={n} className="alert u-mb-0 u-text-xs" >{n}</div>
              ))}
              {testOut.raw && (
                <details>
                  <summary className="muted u-text-xs u-cursor-pointer" >
                    پاسخِ خامِ سامانه (برایِ رفعِ اشکال)
                  </summary>
                  <pre dir="ltr" className="test-raw">
                    {testOut.raw}
                  </pre>
                </details>
              )}
            </div>
          )}
        </section>
      )}

      {tab === 'outbox' && stats && <QueueStatsCard stats={stats} onDiagnose={() => setTab('test')} />}

      {tab === 'outbox' && (
        <section className="panel panel--flush panel--flush">
          <div className="panel__head">
            <h2 className="panel__title">صندوقِ پیامک</h2>
            <span className="panel__count num">{outbox.length}</span>
            {/* کارگرِ systemd هر چند دقیقه یک بار صف را می‌فرستد؛ این دکمه همان
                دور است، برایِ لحظه‌ای که مدیر تازه کلید را پر کرده و می‌خواهد
                همین حالا بداند کار می‌کند یا نه — بی‌انتظار‌ماندنِ تایمر. */}
            {canWrite && (
              <button type="button" className="btn btn--ghost" onClick={flush} disabled={busy}>
                {busy ? 'در حالِ ارسال…' : 'همین حالا بفرست'}
              </button>
            )}
          </div>
          {readiness && !readiness.canSendNow && (
            <div className="alert alert--warn u-mb-3" >
              {readiness.checks
                .filter((c) => !c.ok && c.severity !== 'info')
                .slice(0, 2)
                .map((c) => c.hint ?? c.label)
                .filter(Boolean)
                .join(' · ')}
              {' '}
              <button
                type="button"
                className="btn btn--ghost btn--xs pill-inline"
                
                onClick={() => setTab('test')}
              >
                تشخیصِ کامل
              </button>
            </div>
          )}
          <div className="u-flex u-flex-wrap u-gap-2 u-mb-3">
            {Object.entries(outboxCounts).map(([status, n]) => (
              <span key={status} className="pill">
                {STATUS_LABEL[status] ?? status}: <span className="num">{n}</span>
              </span>
            ))}
          </div>
          {outbox.length === 0 ? (
            <p className="empty">پیامکی در صف نیست.</p>
          ) : (
            <div className="u-overflow-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>گیرنده</th>
                    <th>قالب</th>
                    <th>متن</th>
                    <th>وضعیت</th>
                    <th>تلاش</th>
                  </tr>
                </thead>
                <tbody>
                  {outbox.map((m) => (
                    <tr key={m.id}>
                      <td className="num" dir="ltr">{m.phone}</td>
                      <td className="muted u-text-xs" >
                        {Template_FA[m.templateKey ?? ''] ?? m.templateKey ?? '—'}
                      </td>
                      <td className="outbox-max">{m.body}</td>
                      <td>
                        <span className={pillClass(m.status)}>
                          {STATUS_LABEL[m.status] ?? m.status}
                        </span>
                        {/* خطایِ آخر همان‌جا، نه در صفحه‌ای دیگر: بیشترِ
                            «پیامک نرسید»ها یک علتِ تنظیمی دارند (کلید، قالبِ
                            تأییدنشده، اعتبارِ تمام‌شده) و با همین یک خط حل می‌شوند */}
                        {m.lastError && (
                          <div className="outbox-error">
                            {m.lastError}
                          </div>
                        )}
                      </td>
                      <td className="num u-text-xs" >
                        {m.attempts}
                        {m.nextAttemptAt && m.status === 'failed' && (
                          <div className="muted u-text-base" >نوبتِ بعد</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
