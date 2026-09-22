'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

/**
 * حسابِ کاربریِ مشتری — اکشن‌هایِ سمتِ سرور.
 *
 * چرا اینجا و نه در مرورگر؟ چون نشانه‌ی نشست نباید در دسترسِ جاوااسکریپتِ
 * صفحه باشد (کوکیِ HttpOnly)؛ و چون هر درخواست باید با نشانیِ API در شبکه‌ی
 * داخلی انجام شود، نه با نشانی‌ای که مرورگر بتواند دستکاری‌اش کند.
 *
 * یک قاعده در همه‌ی این اکشن‌ها رعایت شده: هیچ شناسه‌ای از مرورگر پذیرفته
 * نمی‌شود. «مشتریِ فعلی» همیشه از نشانه به دست می‌آید؛ یعنی اگر کسی آدرسِ
 * نشانیِ دیگری را هم حدس بزند، سامانه همان را می‌خواند که نشانه اجازه می‌دهد.
 */

const API_ORIGIN = process.env.API_BASE ?? 'http://127.0.0.1:3000';
const COOKIE = 'set_customer_token';

export interface Me {
  customerId: string;
  fullName: string | null;
  phone: string;
  nationalId: string | null;
  email: string | null;
  mobileVerified: boolean;
  isPartner?: boolean;
  counts: { orders: number; addresses: number; wishlist: number };
}

export interface Address {
  id: string;
  receiverName: string;
  phone: string;
  province: string;
  city: string;
  address: string;
  postalCode: string | null;
  isDefault: boolean;
}

export interface WishItem {
  variantId: string;
  productId: string;
  title: string;
  slug: string;
  variantTitle: string | null;
  priceRial: string | null;
  inStock: boolean;
  imageUrl: string | null;
  addedAt: string;
}

export interface OrderSummary {
  orderNo: string;
  status: string;
  statusLabel: string;
  totalRial: string;
  itemCount: number;
  createdAt: string;
  createdAtShamsi: string | null;
  paidAt: string | null;
  trackingCode: string | null;
}

export interface OrderDetail extends OrderSummary {
  items: Array<{
    variantId: string;
    title: string;
    quantity: number;
    unitPriceRial: string;
    totalRial: string;
  }>;
  subtotalRial: string;
  discountRial: string;
  taxRial: string;
  shippingRial: string;
  shippingAddress: Record<string, unknown> | null;
  customerNote: string | null;
  timeline: Array<{
    fromStatus: string | null;
    toStatus: string;
    label: string;
    reason: string | null;
    createdAt: string;
  }>;
}

async function readToken(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

async function call<T>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  const token = await readToken();
  const res = await fetch(`${API_ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { cookie: `${COOKIE}=${token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401) return null as unknown as T; // «وارد نشده» — نه خطا
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text.slice(0, 300) || `API ${path} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function currentShopper(): Promise<Me | null> {
  const token = await readToken();
  if (!token) return null;
  return call<Me>('/shop/me');
}

/* ---------- ورود ---------- */

export interface ActionResult {
  ok: boolean;
  message: string;
  /** برایِ پیش‌نمایش: کدی که پیامک شده (فقط وقتی OTP_DEV_MODE روشن است) */
  devCode?: string;
  next?: 'code' | 'done';
}


/**
 * پیامِ خطا از پاکتِ استانداردِ سامانه.
 *
 * همه‌ی خطاهایِ API در قالبِ `{ error: { message } }` برمی‌گردند؛ خواندنِ
 * `message` از ریشه همیشه تهی است و اگر به آن تکیه کنیم، پیام‌هایِ مهم
 * (مثلِ «حساب مسدود است» یا «بیش از ۵ کد در یک ساعت») با یک جمله‌ی کلی
 * جایگزین می‌شوند و کاربر نمی‌فهمد چه باید بکند.
 */
function apiMessage(
  body: { message?: string; error?: { message?: string } } | null,
  fallback: string,
): string {
  return body?.error?.message ?? body?.message ?? fallback;
}

export async function requestLoginCode(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const mobile = String(formData.get('mobile') ?? '').trim();
  if (!mobile) return { ok: false, message: 'شمارهٔ همراه را وارد کنید.' };

  const res = await fetch(`${API_ORIGIN}/shop/auth/otp/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ mobile, purpose: 'register' }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { message?: string; error?: { message?: string } }
      | null;
    return { ok: false, message: apiMessage(body, 'درخواست ناموفق بود؛ دوباره تلاش کنید.') };
  }
  const data = (await res.json()) as { devCode?: string };
  return {
    ok: true,
    message: 'کدِ ورود پیامک شد. آن را وارد کنید.',
    devCode: data.devCode,
    next: 'code',
  };
}

export async function verifyLoginCode(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const mobile = String(formData.get('mobile') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  const fullName = String(formData.get('fullName') ?? '').trim();
  if (!mobile || !code) return { ok: false, message: 'شماره و کد را وارد کنید.' };

  const res = await fetch(`${API_ORIGIN}/shop/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ mobile, code, purpose: 'register', fullName: fullName || null }),
    cache: 'no-store',
  });
  // تنها یک بار خوانده می‌شود: بدنه‌ی پاسخ یک جریان است و خواندنِ دوم همیشه
  // تهی است — اگر دو بار بخوانیم، پیامِ واقعیِ سامانه گم می‌شود و همان جمله‌ی
  // کلیِ «کد درست نبود» به کاربر می‌رسد.
  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    message?: string;
    error?: { message?: string };
  };
  if (!res.ok || !data.token) {
    // چرا پیامِ سامانه را همان‌طور می‌رسانیم؟ چون تفاوتِ «کد اشتباه است» با
    // «حساب شما مسدود است» برایِ کاربر تفاوتِ «دوباره تلاش کن» با «با پشتیبانی
    // تماس بگیر» است. اگر همه را با یک جمله‌ی کلی بپوشانیم، مشتریِ مسدود
    // بی‌پایان کد می‌گیرد و خطا را از خودش می‌داند.
    return { ok: false, message: apiMessage(data, 'کد درست نبود؛ دوباره تلاش کنید.') };
  }

  (await cookies()).set(COOKIE, data.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // ۳۰ روز
  });

  revalidatePath('/account');
  return { ok: true, message: 'وارد شدید.', next: 'done' };
}

export async function logoutShopper(): Promise<void> {
  const token = await readToken();
  if (token) {
    await fetch(`${API_ORIGIN}/shop/auth/logout`, {
      method: 'POST',
      headers: { cookie: `${COOKIE}=${token}` },
      cache: 'no-store',
    }).catch(() => null);
  }
  (await cookies()).delete(COOKIE);
  redirect('/');
}

/* ---------- نشانی‌ها ---------- */

export async function shopperAddresses(): Promise<Address[]> {
  const res = await call<{ items: Address[] }>('/shop/addresses');
  return res?.items ?? [];
}

export async function saveAddress(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get('id') ?? '').trim();
  const body = {
    receiverName: String(formData.get('receiverName') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    province: String(formData.get('province') ?? ''),
    city: String(formData.get('city') ?? ''),
    address: String(formData.get('address') ?? ''),
    postalCode: String(formData.get('postalCode') ?? ''),
    isDefault: formData.get('isDefault') === 'on',
  };
  const res = await fetch(`${API_ORIGIN}/shop/addresses${id ? `/${id}` : ''}`, {
    method: id ? 'PATCH' : 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      cookie: `${COOKIE}=${(await readToken()) ?? ''}`,
    },
    body: JSON.stringify(id ? { ...body, isDefault: body.isDefault } : body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, message: data?.message ?? 'ذخیره نشد؛ مقادیر را بررسی کنید.' };
  }
  revalidatePath('/account/addresses');
  return { ok: true, message: 'نشانی ذخیره شد.', next: 'done' };
}

export async function deleteAddress(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return;
  await call(`/shop/addresses/${id}`, { method: 'DELETE' });
  revalidatePath('/account/addresses');
}

/* ---------- علاقه‌مندی‌ها ---------- */

export async function shopperWishlist(): Promise<WishItem[]> {
  const res = await call<{ items: WishItem[] }>('/shop/wishlist');
  return res?.items ?? [];
}

export async function toggleWishlist(formData: FormData): Promise<void> {
  const variantId = String(formData.get('variantId') ?? '').trim();
  if (!variantId) return;
  await call('/shop/wishlist', { method: 'POST', body: { variantId } });
  revalidatePath('/account/wishlist');
}

export async function removeFromWishlist(formData: FormData): Promise<void> {
  const variantId = String(formData.get('variantId') ?? '').trim();
  if (!variantId) return;
  await call(`/shop/wishlist/${variantId}`, { method: 'DELETE' });
  revalidatePath('/account/wishlist');
}

/* ---------- سفارش‌ها ---------- */

export async function shopperOrders(): Promise<OrderSummary[]> {
  const res = await call<{ items: OrderSummary[] }>('/shop/orders');
  return res?.items ?? [];
}

export async function shopperOrder(orderNo: string): Promise<OrderDetail | null> {
  return call<OrderDetail>(`/shop/orders/${encodeURIComponent(orderNo)}`);
}
