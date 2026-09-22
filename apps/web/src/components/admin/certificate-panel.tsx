'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import {
  loadCertificateStatus,
  revokeCredentialAction,
  testSigningAction,
  uploadCredentialAction,
  type CredentialFactsView,
  type VaultStatusView,
} from '@/lib/tax-actions';

/**
 * گاوصندوقِ گواهیِ مؤدیان — بخشِ مدیریتیِ صفحه‌یِ مالیات.
 *
 * مسئله‌ای که این بخش حل می‌کند «امنیت» نیست (امنیت در لایه‌یِ سرویس است)؛
 * مسئله **راه‌اندازی بدونِ برنامه‌نویس** است. تا پیش از این، آغازِ ارسالِ
 * واقعی یعنی گذاشتنِ کلیدِ خصوصی روی سرور و اشاره‌یِ یک متغیرِ محیطی به
 * مسیرش: کاری که فروشنده نمی‌تواند بکند، و هر سال برایِ تعویضِ گواهی دوباره
 * به همان شخص وابسته می‌شد.
 *
 * سه پرسشی که این بخش باید بی‌درنگ جواب بدهد:
 *   ۱) گواهی دارم یا نه، و از کِی تا کِی معتبر است؟
 *   ۲) کلید و گواهی با هم جفت‌اند؟ (شایع‌ترین دلیلِ «امضایِ نامعتبر»)
 *   ۳) همین حالا می‌توانم به سازمان بفرستم؟ (بدونِ اینکه یک ارسالِ واقعی را
 *      خرجِ آزمایش کنم)
 *
 * یک تصمیمِ مهمِ رابط: **هشدارِ انقضا از سی روز پیش**. چون صدورِ گواهیِ تازه
 * در ایران اداری است و هفته‌ها زمان می‌برد؛ هشداری که در روزِ انقضا برسد،
 * یعنی ارسالِ صورتحساب‌ها میانِ دو گواهی می‌ایستد.
 */

const KIND_LABEL: Record<string, string> = {
  private_key: 'کلیدِ خصوصی',
  certificate: 'گواهی',
  public_key: 'کلیدِ عمومیِ سازمان',
};

const KIND_HELP: Record<string, string> = {
  private_key:
    'همان کلیدی که با آن صورتحساب را امضا می‌کنید. باید بی‌گذرواژه باشد و با «-----BEGIN … PRIVATE KEY-----» آغاز شود.',
  certificate:
    'گواهی‌ای که مرجع (مثلِ GICA) به نامِ فروشگاه صادر کرده؛ با «-----BEGIN CERTIFICATE-----» آغاز می‌شود.',
  public_key:
    'کلیدِ عمومیِ سامانه‌یِ مؤدیان برایِ رمزنگاریِ بسته. بی‌آن، بسته‌ها فقط امضا می‌شوند نه رمزنگاری.',
};

/** تاریخ را به شمسیِ کوتاه می‌برد — بی‌نیاز از کتابخانه */
function jalaliShort(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function expiryPill(facts: CredentialFactsView | null): { text: string; className: string } | null {
  if (!facts?.expiry) return null;
  if (facts.expiry === 'expired') return { text: 'منقضی شده', className: 'pill pill--danger' };
  if (facts.expiry === 'soon') {
    return { text: `${facts.daysRemaining} روزِ دیگر تمام می‌شود`, className: 'pill pill--warn' };
  }
  return { text: `${facts.daysRemaining} روز مانده`, className: 'pill pill--ok' };
}

function CredentialCard({
  kind,
  facts,
  onRevoke,
  busy,
}: {
  kind: 'private_key' | 'certificate' | 'public_key';
  facts: CredentialFactsView | null;
  onRevoke: (kind: 'private_key' | 'certificate' | 'public_key') => void;
  busy: boolean;
}) {
  const pill = expiryPill(facts);

  return (
    <div className="panel panel--pad">
      <div className="panel__head">
        <h3 className="panel__title">{KIND_LABEL[kind]}</h3>
        {facts ? (
          pill ? (
            <span className={pill.className}>{pill.text}</span>
          ) : (
            <span className="pill pill--ok">ثبت‌شده</span>
          )
        ) : (
          <span className="pill">ثبت نشده</span>
        )}
      </div>

      {facts ? (
        <dl className="kv">
          <div>
            <dt>نام</dt>
            <dd>{facts.subject || facts.label || '—'}</dd>
          </div>
          {facts.issuer ? (
            <div>
              <dt>صادرکننده</dt>
              <dd>{facts.issuer}</dd>
            </div>
          ) : null}
          {facts.serialNumber ? (
            <div>
              <dt>سریال</dt>
              <dd className="num" dir="ltr">
                {facts.serialNumber}
              </dd>
            </div>
          ) : null}
          {facts.notAfter ? (
            <div>
              <dt>اعتبار تا</dt>
              <dd>
                {jalaliShort(facts.notAfter)}
                {facts.notBefore ? ` (از ${jalaliShort(facts.notBefore)})` : ''}
              </dd>
            </div>
          ) : null}
          {facts.fingerprint ? (
            <div>
              <dt>اثرانگشتِ کلیدِ عمومی</dt>
              <dd className="num fingerprint" dir="ltr" title="با اثرانگشتِ کلیدِ خصوصی یکی است؛ سامانه با همین جفت‌بودن را می‌سنجد">
                {facts.fingerprint}
              </dd>
            </div>
          ) : null}
          {facts.certFingerprint ? (
            <div>
              <dt>اثرانگشتِ گواهی</dt>
              <dd className="num fingerprint" dir="ltr" title="همان که مرجع و کارپوشه‌یِ سازمان نشان می‌دهند">
                {facts.certFingerprint}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="muted">هنوز چیزی ثبت نشده است.</p>
      )}

      {facts ? (
        <div className="actions">
          <button type="button" className="btn btn--xs btn--ghost" disabled={busy} onClick={() => onRevoke(kind)}>
            ابطال و حذف
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CertificatePanel({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState<VaultStatusView | null>(null);
  const [kind, setKind] = useState<'private_key' | 'certificate' | 'public_key'>('certificate');
  const [pem, setPem] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      const res = await loadCertificateStatus();
      if (res.ok) setStatus(res.data);
      else setError(res.message);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function upload() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await uploadCredentialAction({ kind, pem, label });
      if (res.ok) {
        setStatus(res.data);
        setPem('');
        setLabel('');
        setMessage('ذخیره شد. برایِ اطمینان، «آزمایشِ امضا» را بزنید.');
      } else {
        setError(res.message);
      }
    });
  }

  function revoke(which: 'private_key' | 'certificate' | 'public_key') {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await revokeCredentialAction(which);
      if (res.ok) {
        setStatus(res.data);
        setMessage(`${KIND_LABEL[which]} باطل شد.`);
      } else setError(res.message);
    });
  }

  function test() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await testSigningAction();
      if (res.ok && res.data.signed) setMessage(res.message);
      else setError(res.message);
    });
  }

  const pairsMatch = status?.pairMatches;

  return (
    <section className="stack">
      <div className="panel panel--pad">
        <div className="panel__head">
          <h2 className="panel__title">گواهیِ سامانه‌یِ مؤدیان</h2>
          {status ? (
            <span className={status.readyForProduction ? 'pill pill--ok' : 'pill pill--warn'}>
              {status.readyForProduction ? 'آماده‌یِ ارسالِ واقعی' : 'ناقص'}
            </span>
          ) : null}
        </div>

        <p className="muted">
          گواهی و کلیدِ خصوصی را اینجا بارگذاری کنید؛ در پایگاه رمزنگاری‌شده می‌نشینند و هنگامِ
          ارسال به کار می‌روند. دیگر نیازی به گذاشتنِ پرونده روی سرور یا دست‌زدن به تنظیماتِ
          محیطی نیست.
        </p>

        {/* هشدار تنها وقتی که **پاسخ آمده** و می‌گوید بسته است.
            پیش از رسیدنِ پاسخ، «ندانستن» با «بسته بودن» یکی نیست: نشان‌دادنِ
            هشدارِ قرمز در آن یک‌ثانیه، مدیر را به جست‌وجویِ خطایی وامی‌دارد
            که اصلاً رخ نداده است. */}
        {status && !status.vaultReady ? (
          <div className="alert alert--danger">
            گاوصندوق بسته است: {status.vaultMessage ?? 'کلیدِ اصلی در محیط تعیین نشده است.'}
          </div>
        ) : null}

        {status?.warnings.length ? (
          <ul className="warn-list">
            {status.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}

        {pairsMatch === true ? (
          <p className="row-ok">کلیدِ خصوصی و گواهی با هم جفت‌اند (اثرانگشت‌ها یکی است).</p>
        ) : null}

        <div className="actions">
          <button type="button" className="btn btn--xs" onClick={test} disabled={pending}>
            آزمایشِ امضا (بی‌ارسال به سازمان)
          </button>
          <button type="button" className="btn btn--xs btn--ghost" onClick={load} disabled={pending}>
            تازه‌سازی
          </button>
        </div>

        {error ? <div className="alert alert--danger">{error}</div> : null}
        {message ? <p className="row-ok">{message}</p> : null}
      </div>

      <div className="cards">
        {(['private_key', 'certificate', 'public_key'] as const).map((which) => (
          <CredentialCard
            key={which}
            kind={which}
            facts={
              which === 'private_key'
                ? status?.privateKey ?? null
                : which === 'certificate'
                  ? status?.certificate ?? null
                  : status?.publicKey ?? null
            }
            onRevoke={revoke}
            busy={pending || !canManage}
          />
        ))}
      </div>

      {canManage ? (
        <div className="panel panel--pad">
          <h3 className="panel__title">بارگذاری</h3>
          <div className="stats">
            <label className="field">
              <span className="field__label">نوع</span>
              <select
                className="field__input"
                value={kind}
                onChange={(event) => setKind(event.target.value as typeof kind)}
              >
                {(['certificate', 'private_key', 'public_key'] as const).map((option) => (
                  <option key={option} value={option}>
                    {KIND_LABEL[option]}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">نامِ دلخواه (اختیاری)</span>
              <input
                className="field__input"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="مثلِ «گواهیِ ۱۴۰۵ فروشگاه»"
              />
            </label>
          </div>

          <label className="field">
            <span className="field__label">متنِ {KIND_LABEL[kind]}</span>
            <textarea
              className="field__input field__input--tall"
              value={pem}
              onChange={(event) => setPem(event.target.value)}
              dir="ltr"
              spellCheck={false}
              placeholder={`-----BEGIN ${kind === 'certificate' ? 'CERTIFICATE' : 'PRIVATE KEY'}-----\n…\n-----END ${kind === 'certificate' ? 'CERTIFICATE' : 'PRIVATE KEY'}-----`}
            />
            <span className="field__help">{KIND_HELP[kind]}</span>
          </label>

          <div className="actions">
            <button type="button" className="btn btn--primary btn--xs" onClick={upload} disabled={pending || !pem.trim()}>
              ذخیره در گاوصندوق
            </button>
          </div>

          <p className="muted">
            کلیدِ خصوصی از مرورگر تا پایگاه رمزنگاری می‌رود و هرگز در خروجیِ پنل یا گزارش‌ها
            نمایش داده نمی‌شود؛ پنل فقط اثرانگشت و تاریخِ اعتبار را نشان می‌دهد.
          </p>
        </div>
      ) : null}
    </section>
  );
}
