'use server';

import { revalidatePath } from 'next/cache';

import { adminPatch, adminPost, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

/**
 * کنش‌هایِ نظرات — سمتِ سرور.
 *
 * دو نکته در اینجا تعیین‌کننده است:
 *
 *   الف) **نظرها در لحظه به‌روز می‌شوند**: تأیید یا رد در پنل، حافظه‌یِ
 *       صفحه‌یِ کالا را باطل می‌کند، تا فروشنده بداند تصمیمش افتاد. بی‌این،
 *       تا یک دقیقه صفحه همان می‌ماند که بود و او دوباره دکمه می‌زند.
 *   ب) **خریدار از مسیرِ خودش می‌نویسد** (`/shop/reviews`)، نه از مسیرِ
 *       پنل؛ چون نشستِ خریدار با نشستِ کارمند فرق دارد و قاطی کردنشان یعنی
 *       یا دسترسیِ ناخواسته، یا ناتوانی از نوشتن.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface Review {
  id: string;
  productId: string;
  authorName: string;
  rating: number;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  isVerifiedPurchase: boolean;
  sellerReply: string | null;
  repliedAt: string | null;
  helpfulCount: number;
  unhelpfulCount: number;
  viewerVote: boolean | null;
  createdAt: string;
}

export interface ReviewSummary {
  productId: string;
  average: number;
  count: number;
  histogram: Record<'1' | '2' | '3' | '4' | '5', number>;
  verifiedCount: number;
}

export interface ReviewBundle {
  items: Review[];
  summary: ReviewSummary;
  total: number;
  canReview: { can: boolean; reason: string | null };
}

const EMPTY_BUNDLE: ReviewBundle = {
  items: [],
  summary: {
    productId: '',
    average: 0,
    count: 0,
    histogram: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    verifiedCount: 0,
  },
  total: 0,
  canReview: { can: false, reason: 'برایِ نوشتنِ نظر باید وارد شوید.' },
};

function messageOf(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'ارتباط با سامانه برقرار نشد؛ دوباره تلاش کنید.';
}

const ORIGIN = process.env.API_BASE ?? 'http://127.0.0.1:3000';

/**
 * بارگیریِ نظرها برایِ صفحه‌یِ کالا.
 *
 * اگر کارساز در دسترس نباشد، «تهی» برمی‌گردانیم نه خطا: نبودِ نظرها صفحه‌یِ
 * کالا را بی‌ارزش نمی‌کند، و شکستنِ کلِ صفحه برایِ بخشی که ممکن است اصلاً
 * نظری نداشته باشد، تناسب ندارد.
 */
export async function loadProductReviews(
  productSlug: string,
  options: { sort?: string; cookieHeader?: string } = {},
): Promise<ReviewBundle> {
  try {
    const query = new URLSearchParams({ product: productSlug, sort: options.sort ?? 'newest', limit: '20' });
    const res = await fetch(`${ORIGIN}/reviews?${query.toString()}`, {
      next: { revalidate: 60 },
      headers: options.cookieHeader ? { cookie: options.cookieHeader } : undefined,
    });
    if (!res.ok) return EMPTY_BUNDLE;
    const data = (await res.json()) as ReviewBundle;
    return { ...data, canReview: { can: data.canReview?.can ?? false, reason: data.canReview?.reason ?? null } };
  } catch {
    return EMPTY_BUNDLE;
  }
}

/** نوشتنِ نظر از سویِ خریدار — نشست از کوکی می‌آید */
export async function submitReview(input: {
  productId: string;
  rating: number;
  body: string;
  authorName?: string;
}): Promise<ActionResult<{ message: string }>> {
  try {
    const { cookies } = await import('next/headers');
    const jar = await cookies();
    const token = jar.get('set_customer_token')?.value;
    if (!token) return { ok: false, message: 'برایِ نوشتنِ نظر باید واردِ حسابِ خود شوید.' };

    const res = await fetch(`${ORIGIN}/shop/reviews`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', cookie: `set_customer_token=${token}` },
      body: JSON.stringify({
        productId: input.productId,
        rating: Number(input.rating),
        body: input.body,
        authorName: input.authorName,
      }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, message: payload?.error?.message ?? 'نظر ثبت نشد.' };
    }
    revalidatePath(`/products/${input.productId}`, 'page');
    return {
      ok: true,
      data: {
        message: 'نظرتان ثبت شد و پس از تأییدِ فروشگاه رویِ صفحه‌یِ کالا می‌آید.',
      },
    };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** رأیِ «مفید بود / نبود» — برایِ مهمان با یک نشانه در کوکی */
export async function voteReview(
  reviewId: string,
  isHelpful: boolean,
): Promise<ActionResult<{ helpfulCount: number; unhelpfulCount: number }>> {
  try {
    const { cookies } = await import('next/headers');
    const jar = await cookies();
    const customer = jar.get('set_customer_token')?.value;
    const guest = jar.get('set_guest_token')?.value;

    const res = await fetch(`${ORIGIN}/shop/reviews/${reviewId}/vote`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        cookie: [customer ? `set_customer_token=${customer}` : '', guest ? `set_guest_token=${guest}` : '']
          .filter(Boolean)
          .join('; '),
      },
      body: JSON.stringify({ isHelpful, voterToken: guest ?? null }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, message: payload?.error?.message ?? 'رأی ثبت نشد.' };
    }
    const data = (await res.json()) as { helpfulCount: number; unhelpfulCount: number };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * پنل
 * ────────────────────────────────────────────────────────────────────────── */

export interface AdminReview extends Review {
  customerId: string | null;
}

export async function loadReviewsForAdmin(options: {
  status?: string;
  q?: string;
} = {}): Promise<
  ActionResult<{ items: AdminReview[]; total: number; counts: Record<'pending' | 'approved' | 'rejected', number> }>
> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const query = new URLSearchParams({ status: options.status ?? 'all', limit: '50' });
    if (options.q) query.set('q', options.q);
    const res = await fetch(`${ORIGIN}/admin/reviews?${query.toString()}`, {
      cache: 'no-store',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, message: payload?.error?.message ?? 'نظرها بارگیری نشد.' };
    }
    return { ok: true, data: (await res.json()) as never };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** تأیید یا رد */
export async function moderateReview(
  id: string,
  status: 'approved' | 'rejected',
  note?: string,
): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    await adminPatch(`/admin/reviews/${id}`, token, { status, note: note ?? null });
    revalidatePath('/', 'layout');
    return {
      ok: true,
      data: { message: status === 'approved' ? 'نظر منتشر شد.' : 'نظر رد شد.' },
    };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** پاسخِ فروشنده */
export async function replyToReview(id: string, body: string): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    await adminPost(`/admin/reviews/${id}/reply`, token, { body });
    revalidatePath('/', 'layout');
    return { ok: true, data: { message: 'پاسخ ثبت شد.' } };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}
