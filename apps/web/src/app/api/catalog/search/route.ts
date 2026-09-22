import { NextResponse } from 'next/server';

/**
 * پیشنهادِ زنده‌ی جستجو.
 *
 * چرا یک مسیرِ میانجی و نه فراخوانیِ مستقیمِ مرورگر به API؟
 *   ۱) نشانیِ API در مرورگر پیدا نیست (و در استقرارِ واقعی پشتِ یک نام
 *      یکسان می‌نشیند)؛
 *   ۲) کش در یک‌جا کنترل می‌شود: ۳۰ ثانیه برایِ پیشنهادها منطقی است، چون
 *      کسی منتظرِ تغییرِ لحظه‌ایِ «قاب» نیست اما فشار روی پایگاه هم نمی‌خواهیم؛
 *   ۳) اگر روزی منبعِ جستجو عوض شود (مثلِ رفتن به موتورِ اختصاصی)، مرورگر
 *      بی‌خبر می‌ماند — فقط این فایل عوض می‌شود.
 *
 * چرا محدودیتِ ۱۰ نتیجه؟ چون این پاسخ برایِ «تکمیلِ خودکار» است، نه برایِ
 * صفحه‌ی نتایج: کاربر باید در کمتر از ۱۰۰ میلی‌ثانیه شش گزینه ببیند،
 * نه ۵۰۰ کالا.
 */

const API_ORIGIN = process.env.API_BASE ?? 'http://127.0.0.1:3000';

/** نشانیِ مشتری از سرآیندهایِ خودِ درخواست (nginx: `X-Real-IP`، سپس XFF) */
function clientIpOf(request: Request): string | null {
  const real = request.headers.get('x-real-ip');
  if (real) return real.split(',')[0]!.trim() || null;
  // XFF تنها وقتی خوانده می‌شود که استقرار بگوید nginx نشانی را **افزوده**
  // است (`TRUST_XFF=1`)؛ و آنگاه از آخر می‌خوانیم، نه از اول
  if (process.env.TRUST_XFF !== '1') return null;
  const xff = request.headers.get('x-forwarded-for');
  const chain = (xff ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return chain.at(-1) ?? null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 6), 1), 10);

  if (q.length < 2) {
    return NextResponse.json({ items: [], total: 0, normalized: '', applied: [] });
  }

  try {
    const res = await fetch(
      `${API_ORIGIN}/catalog/search?q=${encodeURIComponent(q)}&limit=${limit}`,
      {
        // کشِ کوتاه: پیشنهادها ارزان‌اند اما بی‌نهایت هم نیستند
        next: { revalidate: 30 },
        headers: {
          accept: 'application/json',
          // شمارشِ منصفانه: بی‌این، API همهٔ خریداران را «نشانیِ وب» می‌بیند و
          // سقفِ «۱۲۰ جستجو در دقیقه» به یک سقفِ **جهانی** تبدیل می‌شود
          ...(clientIpOf(request) ? { 'x-set-client-ip': clientIpOf(request)! } : {}),
        },
      },
    );

    if (!res.ok) {
      return NextResponse.json({ items: [], total: 0, normalized: q, applied: [] }, { status: 200 });
    }

    const data = (await res.json()) as {
      items: Array<{ id: string; title: string; slug: string; brand?: string | null; price?: string | null }>;
      total: number;
      normalized: string;
      applied: unknown[];
    };

    return NextResponse.json({
      items: data.items ?? [],
      total: data.total ?? 0,
      normalized: data.normalized ?? q,
      applied: data.applied ?? [],
    });
  } catch {
    // خرابیِ جستجو نباید جعبه را بشکند؛ کاربر همچنان می‌تواند تایپ کند و اینتر بزند
    return NextResponse.json({ items: [], total: 0, normalized: q, applied: [] });
  }
}
