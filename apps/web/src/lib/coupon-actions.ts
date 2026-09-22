'use server';

import { revalidatePath } from 'next/cache';

import { adminGet, adminPost, adminPatch, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

/**
 * کنش‌هایِ کوپن — سمتِ سرور.
 *
 * چرا پول اینجا از رابط به‌صورتِ **رشته** می‌آید و همان‌طور می‌رود؟ چون
 * مبلغ‌ها در سامانه «بیگ‌اینِتِ» ریال‌اند و در JSON جایی ندارند. تبدیل به
 * عدد در میانه‌یِ راه یعنی از دست رفتنِ دقت در مبالغِ بزرگ — همان چیزی که
 * در فروشگاهی با قیمتِ میلیونی، ترازِ حساب را به هم می‌زند.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface CouponRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  kind: 'percent' | 'fixed';
  valueBp: number | null;
  valueRial: string | null;
  minSubtotalRial: string;
  maxDiscountRial: string | null;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number;
  appliesTo: 'all' | 'product' | 'category';
  productId: string | null;
  categoryId: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface RedemptionRow {
  id: string;
  orderId: string | null;
  orderNo: string | null;
  customerName: string | null;
  discountRial: string;
  createdAt: string;
}

function messageOf(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'ارتباط با سامانه برقرار نشد؛ دوباره تلاش کنید.';
}

export async function listCouponsAction(): Promise<ActionResult<CouponRow[]>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const res = await adminGet<{ rows: CouponRow[] }>('/admin/coupons', token);
    return { ok: true, data: res.rows ?? [] };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export interface CouponFormInput {
  code: string;
  title: string;
  description?: string;
  kind: 'percent' | 'fixed';
  /** در «ده‌هزار»: ۱۰٪ می‌شود ۱۰۰۰ تا نیم‌درصدها هم دقیق باشند */
  valueBp?: number;
  valueRial?: string | null;
  minSubtotalRial?: string;
  maxDiscountRial?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  perCustomerLimit?: number;
  appliesTo: 'all' | 'product' | 'category';
  productId?: string | null;
  categoryId?: string | null;
  isActive: boolean;
}

export async function createCouponAction(
  input: CouponFormInput,
): Promise<ActionResult<{ id: string; code: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const data = await adminPost<{ id: string; code: string }>('/admin/coupons', token, input);
    revalidatePath('/admin/coupons');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function updateCouponAction(
  id: string,
  patch: Partial<CouponFormInput>,
): Promise<ActionResult<{ id: string; code?: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const data = await adminPatch<{ id: string }>(`/admin/coupons/${id}`, token, patch);
    revalidatePath('/admin/coupons');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function setCouponActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const data = await adminPatch<{ id: string; isActive: boolean }>(
      `/admin/coupons/${id}/active`,
      token,
      { isActive },
    );
    revalidatePath('/admin/coupons');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function couponRedemptionsAction(
  id: string,
): Promise<ActionResult<{ rows: RedemptionRow[] }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const data = await adminGet<{ rows: RedemptionRow[] }>(
      `/admin/coupons/${id}/redemptions`,
      token,
    );
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/**
 * ارزیابیِ کد برایِ مشتری (سویِ فروشگاه).
 *
 * چرا پیش از ثبتِ سفارش؟ چون خریدار می‌خواهد «ببیند» چقدر کم می‌کند، نه
 * اینکه پس از پرداخت بفهمد. و چرا پیامِ خطا همان است که کارساز نوشته (نه
 * یک جمله‌یِ عمومی)؟ چون اگر بگوییم «کد نامعتبر است»، مشتری که کد را از
 * پیامک کپی کرده نمی‌فهمد مشکل چیست: منقضی شده؟ برایِ خریدِ بالایِ پانصد
 * هزار است؟ مصرفش تمام شده؟ پرسشِ او را باید پاسخ داد، نه ردش کرد.
 */
export interface CouponPreview {
  valid: boolean;
  code: string;
  title: string;
  kind: 'percent' | 'fixed';
  valueBp: number | null;
  valueRial: string | null;
  minSubtotalRial: string;
  maxDiscountRial: string | null;
  subtotalRial: string;
  shortByRial: string;
  appliesTo: 'all' | 'product' | 'category';
  endsAt: string | null;
  message: string | null;
}

export async function previewCouponAction(
  code: string,
): Promise<ActionResult<CouponPreview>> {
  try {
    const res = await fetch(
      `${process.env.API_BASE ?? 'http://127.0.0.1:3000'}/shop/coupons/validate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
        cache: 'no-store',
      },
    );
    const data = (await res.json()) as CouponPreview & { message?: string };
    if (!res.ok) {
      return { ok: false, message: data.message ?? 'این کد قابلِ استفاده نیست.' };
    }
    if (!data.valid && data.shortByRial && BigInt(data.shortByRial) > 0n) {
      const shortToman = BigInt(data.shortByRial) / 10n;
      return {
        ok: false,
        message: `این کد برایِ خریدهایِ بالایِ ${shortToman.toLocaleString('fa-IR')} تومانِ دیگر است.`,
      };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, message: 'ارتباط با سامانه برقرار نشد؛ دوباره تلاش کنید.' };
  }
}
