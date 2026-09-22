'use client';

import { useActionState, useState } from 'react';
import { requestLoginCode, verifyLoginCode, type ActionResult } from '@/lib/shopper-actions';

/**
 * ورود و ثبت‌نامِ مشتری — یک مسیر، دو گام.
 *
 * چرا رمــز ندارد؟ چون در ایران رمز فراموش می‌شود و شمارهٔ همراه نه؛ و چون
 * ساختِ حساب نباید یک فرمِ دیگر باشد — همان کدی که وارد می‌کند، هم هویتش را
 * ثابت می‌کند و هم حساب را در صورتِ نبودن می‌سازد.
 */
export function AccountLoginForm({ next = '/account' }: { next?: string }) {
  const [mobile, setMobile] = useState('');
  const [stage, setStage] = useState<'mobile' | 'code'>('mobile');
  const [code, setCode] = useState('');

  const [reqState, reqAction, reqPending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => {
      const res = await requestLoginCode(_prev, formData);
      if (res.ok) setStage('code');
      return res;
    },
    null,
  );

  const [verState, verAction, verPending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => {
      const res = await verifyLoginCode(_prev, formData);
      if (res.ok) window.location.assign(next);
      return res;
    },
    null,
  );

  return (
    <div>
      <h1 className="acct__login-title">
        {stage === 'mobile' ? 'ورود / ثبت‌نام' : 'کدِ ورود'}
      </h1>
      <p className="acct__login-sub">
        {stage === 'mobile'
          ? 'شمارهٔ همراه‌تان را وارد کنید؛ کدی پیامک می‌شود. اگر حسابی نداشته باشید، همان‌جا ساخته می‌شود.'
          : `کدِ شش‌رقمی پیامک‌شده به ${mobile} را وارد کنید.`}
      </p>

      {/* در پیش‌نمایش، کد همین‌جا نشان داده می‌شود */}
      {reqState?.ok && reqState.devCode ? (
        <p className="acct__login-dev">
          پیش‌نمایش: پیامک واقعی ارسال نمی‌شود — کدِ شما{' '}
          <b className="num" style={{ letterSpacing: 2 }}>{reqState.devCode}</b>
        </p>
      ) : null}

      {stage === 'mobile' ? (
        <form action={reqAction} className="acct__form">
          <div className="acct__field">
            <label htmlFor="ac-mobile" className="acct__label">شمارهٔ همراه</label>
            <input
              id="ac-mobile"
              name="mobile"
              inputMode="tel"
              autoComplete="tel"
              required
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="۰۹۱۲۳۴۵۶۷۸۹"
              className="acct__input acct__input--ltr"
            />
          </div>

          {reqState && !reqState.ok ? (
            <p className="alert alert--danger" style={{ margin: 0 }}>{reqState.message}</p>
          ) : null}

          <button className="btn-p btn-p--primary btn-p--block" type="submit" disabled={reqPending}>
            {reqPending ? 'در حالِ ارسال…' : 'دریافتِ کد'}
          </button>
        </form>
      ) : (
        <form action={verAction} className="acct__form">
          <input type="hidden" name="mobile" value={mobile} />
          <div className="acct__field">
            <label htmlFor="ac-code" className="acct__label">کدِ پیامک‌شده</label>
            <input
              id="ac-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="——————"
              className="acct__input acct__input--ltr"
              style={{ textAlign: 'center', letterSpacing: 12, fontSize: '1.8rem' }}
            />
          </div>
          <div className="acct__field">
            <label htmlFor="ac-name" className="acct__label">نام (اختیاری)</label>
            <input
              id="ac-name"
              name="fullName"
              placeholder="مثلاً سارا کریمی"
              className="acct__input"
            />
          </div>

          {verState && !verState.ok ? (
            <p className="alert alert--danger" style={{ margin: 0 }}>{verState.message}</p>
          ) : null}

          <button className="btn-p btn-p--primary btn-p--block" type="submit" disabled={verPending}>
            {verPending ? 'در حالِ بررسی…' : 'ورود'}
          </button>
          <button
            type="button"
            className="btn-p btn-p--outline btn-p--block"
            onClick={() => {
              setStage('mobile');
              setCode('');
            }}
          >
            تغییرِ شماره
          </button>
        </form>
      )}
    </div>
  );
}