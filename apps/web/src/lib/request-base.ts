import type { NextRequest } from 'next/server';

/**
 * نشانیِ پایه‌ی سایت از رویِ درخواست.
 *
 * چرا این تابع لازم است؟ چون وقتی سایت پشتِ یک پروکسی (نظیرِ پیش‌نمایش یا
 * nginx) اجرا می‌شود، `req.nextUrl.host` همان نشانیِ داخلی است — مثلاً
 * `0.0.0.0:3100` — نه نامی که مرورگر می‌شناسد. اگر هدایتِ پس از پرداخت با
 * آن ساخته شود، مشتری به نشانی‌ای می‌رود که در شبکه‌ی او وجود ندارد و سفارش
 * «پرداخت‌شده» می‌ماند بی‌آنکه او رسیدی دیده باشد.
 *
 * ترتیبِ تصمیم:
 *   ۱) APP_URL اگر صریحاً تنظیم شده باشد (در تولید همیشه تنظیم است)،
 *   ۲) سربرگ‌های forwarded که پروکسی می‌گذارد (x-forwarded-host/proto)،
 *   ۳) در نهایت همان نشانیِ خودِ درخواست.
 */
export function requestBase(req: NextRequest): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const forwardedHost = req.headers.get('x-forwarded-host');
  const forwardedProto = req.headers.get('x-forwarded-proto');

  if (forwardedHost) {
    return `${forwardedProto ?? req.nextUrl.protocol.replace(':', '')}://${forwardedHost}`.replace(
      /\/$/,
      '',
    );
  }

  return `${req.nextUrl.protocol}//${req.nextUrl.host}`;
}
