'use server';

import { revalidatePath } from 'next/cache';

import { adminPost, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

/**
 * کنش‌هایِ بسته‌بندی و «خبرم کن» — سمتِ سرور.
 *
 * هر تغییر، صفحه‌یِ سفارش‌ها و برگه‌یِ کالا را باطل می‌کند: فروشنده باید
 * همان لحظه ببیند که سفارش از «تأییدشده» به «در حالِ بسته‌بندی» رفت، وگرنه
 * دوباره دکمه را می‌زند و با خطایِ «وضعیت نارواست» روبه‌رو می‌شود.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

function messageOf(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'ارتباط با سامانه برقرار نشد؛ دوباره تلاش کنید.';
}

const ORIGIN = process.env.API_BASE ?? 'http://127.0.0.1:3000';

function publish(): void {
  revalidatePath('/admin/orders');
  revalidatePath('/', 'layout');
}

/* ────────────────────────────────────────────────────────────────────────────
 * تأیید سفارش (پنل) — از paid به confirmed
 * ────────────────────────────────────────────────────────────────────────── */

export async function confirmOrder(id: string): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const res = await fetch(`${ORIGIN}/admin/orders/${id}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, message: payload?.error?.message ?? 'تأیید سفارش ثبت نشد.' };
    }
    publish();
    return { ok: true, data: { message: 'سفارش تأیید شد.' } };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * بسته‌بندی (پنل)
 * ────────────────────────────────────────────────────────────────────────── */

export async function packOrder(id: string): Promise<ActionResult<{ message: string; complete: boolean }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const res = await fetch(`${ORIGIN}/admin/orders/${id}/pack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, message: payload?.error?.message ?? 'بسته‌بندی ثبت نشد.' };
    }
    const data = (await res.json()) as { order?: { packingComplete?: boolean } };
    publish();
    return {
      ok: true,
      data: {
        complete: Boolean(data.order?.packingComplete),
        message: data.order?.packingComplete ? 'بسته‌بندیِ کامل ثبت شد.' : 'کسری ثبت شد؛ تا رسیدنِ کالا ارسال بسته می‌ماند.',
      },
    };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function unpackOrder(id: string): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    await adminPost(`/admin/orders/${id}/unpack`, token, {});
    publish();
    return { ok: true, data: { message: 'به تأییدشده بازگشت.' } };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function shipOrder(
  id: string,
  input: { trackingCode: string; carrier?: string },
): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    await adminPost(`/admin/orders/${id}/ship`, token, {
      trackingCode: input.trackingCode,
      carrier: input.carrier ?? 'پست',
    });
    publish();
    return { ok: true, data: { message: 'مرسوله ثبت شد.' } };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function reportShipmentIssue(
  shipmentId: string,
  status: 'returned' | 'lost',
  note?: string,
): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    await adminPost(`/admin/shipping/shipments/${shipmentId}/issue`, token, {
      status,
      note: note?.trim() || undefined,
    });
    publish();
    return {
      ok: true,
      data: { message: status === 'lost' ? 'گم‌شدگیِ مرسوله ثبت شد.' : 'برگشتِ مرسوله ثبت شد.' },
    };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * «خبرم کن وقتی موجود شد» (سایت)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * درخواستِ آگاه‌سازی.
 *
 * نکته‌یِ رفتاری: اگر کالا همین حالا موجود باشد، کارساز درخواستی ثبت
 * نمی‌کند و `available: true` برمی‌گرداند — رابط به‌جایِ «ثبت شد» می‌گوید
 * «موجود است، همین حالا بخر»، که همان چیزی است که خریدار می‌خواهد.
 */
export async function requestStockAlert(
  variantId: string,
  phone?: string,
): Promise<ActionResult<{ available: boolean; alreadyWaiting: boolean; message: string }>> {
  try {
    const res = await fetch(`${ORIGIN}/shop/stock-alerts`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variantId, phone: phone || undefined }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, message: payload?.error?.message ?? 'درخواست ثبت نشد.' };
    }
    const data = (await res.json()) as { available: boolean; alreadyWaiting: boolean };
    revalidatePath('/', 'layout');
    return {
      ok: true,
      data: {
        available: data.available,
        alreadyWaiting: data.alreadyWaiting,
        message: data.available
          ? 'این کالا همین حالا موجود است؛ می‌توانید سفارش دهید.'
          : data.alreadyWaiting
            ? 'پیش از این ثبت کرده‌اید؛ به محضِ آمدنِ کالا خبرتان می‌کنیم.'
            : 'ثبت شد؛ به محضِ آمدنِ کالا پیامک می‌فرستیم.',
      },
    };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}
