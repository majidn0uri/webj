import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * GET /api/cart — برگرداندنِ سبدِ مشتری برایِ CartBadge.
 *
 * CartBadge سمتِ کاربر است و نمی‌تواند کوکیِ HttpOnly بخواند.
 * این مسیر کوکیِ set_cart را از سرور می‌خواند و سبد را از API
 * برمی‌گرداند — بدون اینکه مشتری cartId را بداند.
 *
 * چرا یک مسیرِ Next و نه rewrite؟
 *   چون API فقط `GET /cart/:id` دارد (با cartId)، نه `GET /cart`.
 *   rewrite نمی‌تواند cartId را از کوکی بخواند و در مسیر بگذارد.
 */
const API_ORIGIN = process.env.API_BASE ?? 'http://127.0.0.1:3000';

export async function GET(): Promise<NextResponse> {
  const store = await cookies();
  const cartId = store.get('set_cart')?.value;

  if (!cartId) {
    return NextResponse.json({ items: [], itemCount: 0 }, { status: 200 });
  }

  try {
    const res = await fetch(`${API_ORIGIN}/cart/${cartId}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) {
      // سبد منقضی یا حذف شده — خالی برگردان
      return NextResponse.json({ items: [], itemCount: 0 }, { status: 200 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ items: [], itemCount: 0 }, { status: 200 });
  }
}