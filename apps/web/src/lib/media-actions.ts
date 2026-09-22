'use server';

import { adminDelete, adminGet, adminPatch, adminPost, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

/**
 * کنش‌هایِ رسانه — سمتِ سرور.
 *
 * بارگذاریِ فایل یک «عملِ حساس» است: کسی که بتواند هر فایلی را رویِ سرور
 * بنشاند، در عمل کنترلِ بخشی از سامانه را دارد. برای همین اینجا — نه در
 * مرورگر — توکن از کوکیِ HttpOnly خوانده می‌شود و اجازه با `media.upload`
 * سنجیده می‌گردد. مرورگر هرگز توکن را نمی‌بیند و هرگز نمی‌تواند با یک
 * درخواستِ دستی، این مسیر را دور بزند.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface ProductImage {
  id: string;
  url: string;
  urlCard: string | null;
  urlThumb: string | null;
  placeholder: string | null;
  alt: string;
  role: string;
  sortOrder: number;
  width: number | null;
  height: number | null;
}

export interface MediaLimits {
  maxBytes: number;
  accept: string[];
}

async function requireToken(): Promise<string> {
  const token = await getSessionToken();
  if (!token) throw new Error('نشست پایان یافته است؛ دوباره وارد شوید.');
  return token;
}

function messageOf(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'ارتباط با سامانه برقرار نشد؛ دوباره تلاش کنید.';
}

export async function loadProductImages(productId: string): Promise<ActionResult<ProductImage[]>> {
  try {
    const token = await requireToken();
    const data = await adminGet<{ items: ProductImage[] }>(`/admin/products/${productId}/images`, token);
    return { ok: true, data: data.items };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function loadMediaLimits(): Promise<ActionResult<MediaLimits>> {
  try {
    const token = await requireToken();
    const data = await adminGet<MediaLimits>('/admin/media/limits', token);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/**
 * بارگذاریِ یک تصویر.
 *
 * `formData` از مرورگر می‌آید (فایلِ انتخاب‌شده)، اما نشانی و توکن اینجا
 * ساخته می‌شود؛ پس مرورگر نمی‌تواند تصویر را به سرویسِ دیگری بفرستد یا
 * اندازه‌یِ مجاز را دور بزند.
 */
export async function uploadProductImage(
  productId: string,
  formData: FormData,
  options: { alt?: string; asMain?: boolean } = {},
): Promise<ActionResult<ProductImage>> {
  try {
    const token = await requireToken();
    const query = new URLSearchParams();
    if (options.alt) query.set('alt', options.alt);
    if (options.asMain) query.set('main', '1');
    const suffix = query.toString() ? `?${query.toString()}` : '';

    // بدنه‌یِ multipart را همان‌که مرورگر ساخته می‌فرستیم؛ مرز (boundary) درونِ
    // FormData است و نباید دستکاری شود.
    const data = await postForm<{ item: ProductImage }>(
      `/admin/products/${productId}/images${suffix}`,
      token,
      formData,
    );
    return { ok: true, data: data.item };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function deleteProductImage(
  productId: string,
  imageId: string,
): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await requireToken();
    await adminDelete(`/admin/products/${productId}/images/${imageId}`, token);
    return { ok: true, data: { message: 'تصویر برداشته شد.' } };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function makeMainImage(
  productId: string,
  imageId: string,
): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await requireToken();
    const data = await adminPost<{ message: string }>(
      `/admin/products/${productId}/images/${imageId}/main`,
      token,
      {},
    );
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/**
 * گزارشِ «بهداشتِ فایل‌ها» — همان چیزی که API از `mediaHygiene` می‌دهد.
 *
 * چرا این‌قدر فیلد؟ چون سه چیزِ متفاوت رویِ یک پوشه اتفاق می‌افتد و مدیر باید
 * تفکیکشان ببیند: چیزی که **می‌شود** برداشت (`orphans`)، چیزی که به‌خاطرِ
 * مهلت امن نگه داشته شده (`youngSkipped`)، و چیزی که اصلاً کارِ ما نیست
 * (`unmanaged`، `missing`). یکی‌کردنشان در یک عدد، همان چیزی است که باعث
 * می‌شود کسی به دکمهٔ «پاک‌سازی» اعتماد نکند.
 */
export interface MediaHygiene {
  mode: 'report' | 'run';
  policy: { graceDays: number; autopurge: boolean; scanIntervalMinutes: number };
  ran: boolean;
  cached: boolean;
  /** شمارش به سقفِ زمانِ پیش‌نمایش خورد؟ (رقم‌ها «کمترینِ قطعی» است) */
  incomplete: boolean;
  scannedAt: string;
  files: number;
  bytes: number;
  referencedFiles: number;
  orphans: number;
  orphanBytes: number;
  youngSkipped: number;
  unmanaged: number;
  unmanagedBytes: number;
  tempStale: number;
  tempStaleBytes: number;
  missingTotal: number;
  missing: Array<{ url: string; label: string; ownerId: string }>;
  removed: number;
  removedBytes: number;
  remaining: number;
  refuseCode: 'no-references' | 'orphan-ratio' | null;
  notes: string[];
}

/**
 * پیش‌نمایشِ بی‌حذف‌کردن.
 *
 * `fresh` کشِ «پویشِ اخیر» را رد می‌کند؛ بی‌آن رویِ صدها‌هزار فایل، هر بار
 * بازکردنِ صفحهٔ کالا یک پویشِ کاملِ دیسک نمی‌فرستد.
 */
export async function loadMediaHygiene(fresh = false): Promise<ActionResult<MediaHygiene>> {
  try {
    const token = await requireToken();
    const data = await adminGet<MediaHygiene>(`/admin/media/cleanup${fresh ? '?fresh=1' : ''}`, token);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** اجرایِ یک دورِ پاک‌سازی (حداکثر `limit` فایل). */
export async function runMediaCleanup(
  limit = 500,
  force = false,
): Promise<ActionResult<MediaHygiene>> {
  try {
    const token = await requireToken();
    const data = await adminPost<MediaHygiene>('/admin/media/cleanup', token, { limit, force });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function reorderProductImages(
  productId: string,
  ids: string[],
): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await requireToken();
    const data = await adminPatch<{ message: string }>(
      `/admin/products/${productId}/images/order`,
      token,
      { ids },
    );
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/**
 * فرستادنِ multipart.
 *
 * چرا جدا از `adminPost`؟ چون آن تابع بدنه را با `JSON.stringify` می‌بندد و
 * برایِ FormData باید مرزِ خودش همراهِ درخواست برود؛ و چون نباید هیچ هدرِ
 * content-type ی دستی گذاشت — مرورگر/فچ مرز را درونِ آن می‌نویسد.
 */
async function postForm<T>(path: string, token: string, body: FormData): Promise<T> {
  const origin = process.env.API_BASE ?? 'http://127.0.0.1:3000';
  const res = await fetch(`${origin}${path}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new AdminApiError(
      res.status,
      payload?.error?.code ?? 'UNKNOWN',
      payload?.error?.message ?? `خطا در ارتباط با سامانه (${res.status})`,
    );
  }
  return res.json() as Promise<T>;
}
