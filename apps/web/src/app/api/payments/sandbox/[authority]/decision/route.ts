import { NextResponse } from 'next/server';

/**
 * انتقالِ تصمیمِ درگاهِ آزمایشی به API.
 *
 * چرا این مسیر وجود دارد؟ چون صفحه‌ی شبیه‌ساز در مرورگر است و مرورگر نباید
 * نشانیِ API را مستقیماً صدا بزند (در استقرارِ واقعی آن نشانی پشتِ شبکه‌ی
 * داخلی است). این میانجی فقط همان بدنه را منتقل می‌کند.
 *
 * چرا بدونِ نیاز به نشست؟ چون کلیدِ این فراخوانی خودِ authority است: رشته‌ای
 * با آنتروپیِ بالا که فقط کسی آن را دارد که نشانیِ درگاه را باز کرده است.
 * گذاشتنِ نشست روی این مسیر، آزمایشِ پرداخت را برایِ مشتریِ واقعی سخت می‌کرد
 * بی‌آنکه امنیتی اضافه کند (سرویس در تولید این مسیر را اساساً رد می‌کند).
 */

const API_ORIGIN = process.env.API_BASE ?? 'http://127.0.0.1:3000';

export async function POST(
  request: Request,
  ctx: { params: Promise<{ authority: string }> },
) {
  const { authority } = await ctx.params;
  const body = await request.text();

  let res: Response;
  try {
    res = await fetch(
      `${API_ORIGIN}/payments/sandbox/${encodeURIComponent(authority)}/decision`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          // نشانیِ مشتری به سرویس می‌رسد تا لاگِ درگاه و سقف‌هایِ نشانی درست
          // شمرده شوند (پیش‌تر: همه از ۱۲۷.۰.۰.۱)
          // `x-real-ip` را از nginx می‌گیریم و دست‌به‌دست می‌کنیم؛ XFFِ خامِ
          // کلاینت را نمی‌خوانیم (جعلی است). بدون این، سرویسِ پرداخت هم
          // «۱۲۷.۰.۰.۱» را لاگ می‌گرفت.
          ...(request.headers.get('x-real-ip') ? { 'x-set-client-ip': request.headers.get('x-real-ip')! } : {}),
        },
        body,
      },
    );
  } catch {
    return NextResponse.json(
      { error: { code: 'ERR-503', message: 'ارتباط با سامانه برقرار نشد.' } },
      { status: 503 },
    );
  }

  const text = await res.text();
  return NextResponse.json(text ? JSON.parse(text) : { ok: true }, { status: res.status });
}
