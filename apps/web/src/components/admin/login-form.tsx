'use client';

import { useActionState } from 'react';
import { loginAction, type ActionState } from '@/lib/admin-actions';

/**
 * فرمِ ورود به پنل.
 * وضعیت با useActionState نگه داشته می‌شود تا پیامِ خطا پس از ارسال،
 * در خودِ فرم و در جایِ درست نمایش داده شود (بدون رفتن به صفحه‌ای دیگر).
 */
/**
 * شماره‌یِ موبایل را از پیش پر نمی‌کنیم — حتی در محیطِ توسعه.
 *
 * یک مقدارِ پیش‌فرضِ آماده رویِ صفحه‌یِ ورود، نیمی از گذرواژه را به هر
 * رهگذری می‌دهد: مهاجم دیگر نمی‌پرسد «شماره‌یِ مدیر چیست»، فقط رمز را
 * می‌آزماید. راحتیِ چند ثانیه در برابرِ این بها نمی‌ارزد.
 */
export function LoginForm({ next = '/admin' }: { next?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(loginAction, {});

  return (
    <form action={action} className="login__form">
      {/* مقصدی که کاربر می‌خواسته است — پس از ورود همان‌جا می‌رود */}
      <input type="hidden" name="next" value={next} />
      <label className="field">
        <span className="field__label">شماره موبایل</span>
        <input
          className="field__input num"
          name="mobile"
          type="tel"
          inputMode="numeric"
          autoComplete="username"
          placeholder="۰۹۱۲۰۰۰۰۰۰۰"
          required
        />
      </label>

      <label className="field">
        <span className="field__label">رمز عبور</span>
        <input
          className="field__input"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
      </label>

      {state.error ? (
        <p className="alert alert--danger" role="alert">
          {state.error}
        </p>
      ) : null}

      <button className="btn btn--primary btn--block" type="submit" disabled={pending}>
        {pending ? 'در حالِ بررسی…' : 'ورود'}
      </button>
    </form>
  );
}
