'use server';

import { revalidatePath } from 'next/cache';

import { adminDelete, adminGet, adminPatch, adminPost, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

/**
 * کنش‌هایِ ویترین (بنرها) — سمتِ سرور.
 *
 * نکته‌یِ ظریفِ اینجا: خواندنِ بنرها برایِ **سایت** (صفحه‌یِ نخستِ عمومی) و
 * برایِ **پنل** دو مسیرِ جداست. مسیرِ عمومی بی‌نشست است و فقط آنچه را «اکنون
 * قابلِ نمایش» است می‌دهد؛ مسیرِ پنل با دسترسی است و همه چیز را نشان می‌دهد.
 * قاطی کردنِ این دو یعنی یا نشتِ بنرِ خاموش به بیرون، یا ناتوانیِ فروشنده
 * از دیدنِ بنری که خودش خاموش کرده.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface Banner {
  id: string;
  kind: 'announcement' | 'hero' | 'middle';
  title: string;
  body: string;
  linkUrl: string | null;
  imageUrl: string | null;
  placeholder: string | null;
  tone: string | null;
  sortOrder: number;
  /** رشته‌یِ ISO از سویِ کارساز است (درست مانندِ تاریخ‌هایِ دیگرِ پروژه) */
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
}

export interface Storefront {
  announcements: Banner[];
  heroes: Banner[];
  middles: Banner[];
}

function messageOf(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'ارتباط با سامانه برقرار نشد؛ دوباره تلاش کنید.';
}

/** آنچه سایت نشان می‌دهد — بی‌نیاز از نشست، و فقط «اکنون قابلِ نمایش» */
/**
 * باطل کردنِ حافظه‌یِ صفحه‌ها پس از هر تغییر.
 *
 * چرا لازم است: سایت بنرها را ۶۰ ثانیه نگه می‌دارد تا برایِ هزاران بازدید
 * هر بار به کارساز سر نزند. بی‌این باطل‌سازی، فروشنده پیام را منتشر
 * می‌کند و تا یک دقیقه چیزی نمی‌بیند — یعنی یا فکر می‌کند سیستم خراب
 * است، یا سه‌بار دیگر دکمه را می‌زند.
 *
 * چرا «layout» و نه یک صفحه: نوارِ اعلان در هدر است، و هدر در
 * چیدمانِ مشترکِ همه‌یِ صفحات؛ پس باید کلِ درخت باطل شود، نه فقط نخست.
 */
function publish(): void {
  revalidatePath('/', 'layout');
}

export async function loadStorefrontBanners(): Promise<Storefront> {
  const origin = process.env.API_BASE ?? 'http://127.0.0.1:3000';
  try {
    const res = await fetch(`${origin}/banners`, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error('دریافتِ بنرها ناموفق بود');
    return (await res.json()) as Storefront;
  } catch {
    // ویترین نباید به‌خاطرِ نرسیدنِ بنرها از کار بیفتد؛ بدونِ بنر هم
    // فروشگاه هست — فقط تبلیغش نیست.
    return { announcements: [], heroes: [], middles: [] };
  }
}

/** همه‌یِ بنرها — برایِ پنل */
export async function loadAllBanners(): Promise<ActionResult<Banner[]>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const data = await adminGet<{ items: Banner[] }>('/admin/banners', token);
    return { ok: true, data: data.items };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function createBanner(input: {
  kind: Banner['kind'];
  title: string;
  body?: string;
  linkUrl?: string;
  imageUrl?: string | null;
  placeholder?: string | null;
  tone?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
}): Promise<ActionResult<Banner>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const data = await adminPost<{ item: Banner }>('/admin/banners', token, input);
    publish();
    return { ok: true, data: data.item };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function updateBanner(
  id: string,
  patch: Partial<{ title: string; body: string; linkUrl: string | null; isActive: boolean; startsAt: string | null; endsAt: string | null; sortOrder: number }>,
): Promise<ActionResult<Banner>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const data = await adminPatch<{ item: Banner }>(`/admin/banners/${id}`, token, patch);
    publish();
    return { ok: true, data: data.item };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function deleteBanner(id: string): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    await adminDelete(`/admin/banners/${id}`, token);
    publish();
    return { ok: true, data: { message: 'برداشته شد.' } };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function reorderBanners(ids: string[]): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const data = await adminPost<{ message: string }>('/admin/banners/order', token, { ids });
    publish();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}
