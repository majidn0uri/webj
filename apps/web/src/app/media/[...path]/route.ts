/**
 * میانجیِ رسانه.
 *
 * چرا یک میانجی و نه ارجاعِ مستقیم به API؟ چون تصویرها رویِ API نگه داشته
 * می‌شوند (‎`/media/…`‎)، اما مرورگرِ مشتری نباید نشانیِ آن سرویس را بداند:
 * در استقرارِ واقعی API پشتِ دیوار است و تنها وب با آن حرف می‌زند. با این
 * میانجی، نشانی در صفحه همان ‎`/media/…`‎ ی نسبی می‌ماند — هم در نشانی‌یِ
 * اینترنتیِ فروشگاه و هم در پیش‌نما، بی‌هیچ تغییری در داده.
 *
 * دو ویژگیِ کوچک که اثرِ بزرگی دارند:
 *   • پاسخ در لبه‌یِ شبکه کش می‌شود (`immutable`) چون نشانی بر پایه‌یِ درنگِ
 *     محتواست و هیچ‌گاه کهنه نمی‌شود؛
 *   • تنها پسوندهایِ تصویر عبور می‌کنند — چیزی به عنوانِ «فایلِ اجرایی در
 *     پوشه‌یِ رسانه» از این مسیر بیرون نمی‌رود.
 */

import { NextResponse } from 'next/server';

const API_ORIGIN = process.env.API_BASE ?? 'http://127.0.0.1:3000';

const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const relative = (path ?? []).join('/');

  // ایمنی: تنها تصویر، و هیچ بیرون‌زدن از مسیر
  if (!relative || relative.includes('..') || relative.startsWith('/')) {
    return new NextResponse('یافت نشد', { status: 404 });
  }
  const dot = relative.lastIndexOf('.');
  const extension = dot >= 0 ? relative.slice(dot).toLowerCase() : '';
  if (!ALLOWED.has(extension)) {
    return new NextResponse('یافت نشد', { status: 404 });
  }

  const upstream = await fetch(`${API_ORIGIN}/media/${relative}`, {
    cache: 'force-cache',
    next: { revalidate: 31_536_000 },
  }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    return new NextResponse('یافت نشد', { status: 404 });
  }

  const headers = new Headers();
  const type = upstream.headers.get('content-type');
  if (type && type.startsWith('image/')) headers.set('content-type', type);
  else headers.set('content-type', 'image/jpeg');
  const length = upstream.headers.get('content-length');
  if (length) headers.set('content-length', length);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');

  return new NextResponse(upstream.body, { status: 200, headers });
}
