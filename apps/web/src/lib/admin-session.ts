import { cookies, headers } from 'next/headers';

/**
 * نشستِ پنلِ مدیریت.
 *
 * توکن‌ها در کوکیِ httpOnly نگه داشته می‌شوند تا از جاوااسکریپتِ صفحه قابلِ
 * خواندن نباشند (کاهشِ آسیبِ XSS). چون این فایل فقط در کامپوننت‌ها و
 * کنش‌هایِ سروری استفاده می‌شود، مقدارِ توکن‌ها هرگز به مرورگر فرستاده نمی‌شود.
 *
 * چرا دو کوکی و نه یکی؟
 *   توکنِ دسترسی ۱۵ دقیقه عمر دارد (کوتاه‌عمر = اگر دزدیده شود، زیان محدود است)
 *   و توکنِ تازه‌سازی ۳۰ روز. کوکیِ نشست ۸ ساعت است. اگر فقط توکنِ دسترسی
 *   ذخیره می‌شد — که چنین بود — نشست پس از ۱۵ دقیقه از کار می‌افتاد و هر صفحه
 *   کاربر را به ورود پرتاب می‌کرد. اکنون middleware (‎`src/middleware.ts`‎)
 *   پیش از هر درخواست، در صورتِ نیاز توکن را بی‌صدا تازه می‌کند.
 */
export const SESSION_COOKIE = 'set_admin_token';
export const REFRESH_COOKIE = 'set_admin_refresh';

/** عمرِ نشست: یک شیفتِ کاری (۸ ساعت) */
const MAX_AGE = 60 * 60 * 8;

/**
 * آیا اتصال امن است؟
 *
 * برخلافِ نسخه‌ی پیشین که از `NODE_ENV` استفاده می‌کرد، اینجا پروتکلِ واقعیِ
 * درخواست خوانده می‌شود: چرا که پشتِ یک پروکسی (مثلاً اجرایِ آزمایشی روی http)
 * پرچمِ `secure` روی کوکیِ ارسالی با http باعث می‌شد مرورگر کوکی را دور بیندازد
 * و ورود اصلاً انجام نشود — بدون هیچ خطایی در سرور.
 */
export async function isSecureRequest(): Promise<boolean> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (proto) return proto === 'https';
  return false;
}

function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: MAX_AGE,
    secure,
  };
}

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value ?? null;
}

/** ذخیره‌ی هر دو توکن پس از ورود یا تازه‌سازی */
export async function setSession(accessToken: string, refreshToken: string): Promise<void> {
  const store = await cookies();
  const secure = await isSecureRequest();
  store.set(SESSION_COOKIE, accessToken, cookieOptions(secure));
  store.set(REFRESH_COOKIE, refreshToken, cookieOptions(secure));
}

/** پاک کردنِ نشست — هر دو کوکی، وگرنه توکنِ تازه‌سازی زنده می‌ماند */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  const secure = await isSecureRequest();
  const dead = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 0, secure };
  store.set(SESSION_COOKIE, '', dead);
  store.set(REFRESH_COOKIE, '', dead);
}

/**
 * زمانِ انقضایِ توکنِ دسترسی (ثانیه از ابتدایِ دوران) — برایِ اینکه
 * middleware بداند پیش از انقضا تازه‌سازی کند، نه پس از خطا.
 */
export function accessTokenExpiry(token: string | null | undefined): number | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}
