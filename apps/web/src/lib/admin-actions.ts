'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { clearSession, setSession } from '@/lib/admin-session';
import { parseJalali, formatToman } from '@set/shared-kernel';

const API_ORIGIN = process.env.API_BASE ?? 'http://127.0.0.1:3000';

export interface ActionState {
  error?: string;
  /** پیامِ موفقیت — برای این‌که کاربر بداند کار انجام شده است */
  ok?: string;
  orderId?: string | null;
  orderNo?: string | null;
}

/**
 * ورود به پنل.
 *
 * چرا کنشِ سروری و نه فراخوانی از مرورگر؟ چون کوکیِ نشست httpOnly است
 * و مرورگر حقِ نوشتنِ آن را ندارد؛ اگر ورود از سمتِ مرورگر انجام می‌شد،
 * یا باید توکن در یک کوکیِ معمولی (قابلِ دزدیدن) ذخیره می‌شد،
 * یا اصلاً نشستی شکل نمی‌گرفت.
 */
export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const mobile = String(formData.get('mobile') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!mobile || !password) {
    return { error: 'شماره موبایل و رمز را وارد کنید.' };
  }

  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/auth/login`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ mobile, password }),
    });
  } catch {
    return { error: 'ارتباط با سامانه برقرار نشد؛ دوباره تلاش کنید.' };
  }

  if (!res.ok) {
    // پیامِ عمومی: نگفتنِ «رمز اشتباه است» در برابرِ «چنین کاربری نیست»
    // جلویِ حدس‌زدنِ شماره موبایلِ کارکنان را می‌گیرد.
    const payload = (await res.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    return { error: payload?.error?.message ?? 'شماره موبایل یا رمز نادرست است.' };
  }

  const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
  if (!data.accessToken || !data.refreshToken) {
    return { error: 'سامانه توکنی صادر نکرد؛ دوباره تلاش کنید.' };
  }

  // هر دو توکن ذخیره می‌شوند: دسترسی (۱۵ دقیقه) برایِ فراخوانی‌ها و
  // تازه‌سازی (۳۰ روز) برایِ اینکه نشست هشت‌ساعته در میانه‌ی کار نپرد.
  await setSession(data.accessToken, data.refreshToken);

  // کاربر اگر از صفحه‌ای بیرون انداخته شده بود، به همان صفحه برمی‌گردد
  redirect(safeNext(String(formData.get('next') ?? '')));
}

/**
 * فقط مسیرهایِ خودِ پنل مقصدِ مجازند.
 *
 * چرا محدود کردن؟ چون مقدار از فرم می‌آید و اگر بی‌مهارت رها شود،
 * یک نشانیِ بیرونی می‌تواند کاربرِ تازه‌وارد را به سایتِ دیگری بفرستد
 * (باز-هدایتِ باز). مقصد باید مسیرِ نسبیِ درونِ پنل باشد.
 */
function safeNext(raw: string): string {
  const value = raw.trim();
  if (!value.startsWith('/admin') || value.startsWith('/admin/login')) return '/admin';
  if (value.startsWith('//')) return '/admin';
  return value;
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect('/admin/login');
}

/** تعدیلِ موجودی از پنل — خطاها به‌صورتِ پیام به فرم برمی‌گردند، نه استثنا */
export async function adjustStockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { getSessionToken } = await import('@/lib/admin-session');
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const variantId = String(formData.get('variantId') ?? '');
  const delta = Number(formData.get('delta') ?? '0');
  const reason = String(formData.get('reason') ?? 'adjust');
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!variantId) return { error: 'کالا انتخاب نشده است.' };
  if (!Number.isInteger(delta) || delta === 0) {
    return { error: 'مقدارِ تعدیل باید یک عددِ صحیحِ غیرِ صفر باشد.' };
  }

  const res = await fetch(`${API_ORIGIN}/admin/inventory/adjust`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ variantId, delta, reason, note }),
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    return { error: payload?.error?.message ?? 'تعدیل انجام نشد.' };
  }

  revalidatePath('/admin/inventory');
  revalidatePath('/admin');
  const after = (await res.json().catch(() => null)) as { onHand?: number } | null;
  return { ok: after?.onHand === undefined ? 'تعدیل ثبت شد.' : `تعدیل ثبت شد؛ موجودیِ جدید: ${after.onHand}` };
}

/**
 * ثبتِ کالای تازه.
 *
 * نکته‌ی پول: کاربر قیمت را به «تومان» می‌نویسد (آنچه می‌فروشد)،
 * اما سامانه همیشه «ریال» ذخیره می‌کند (بخش Q-2).
 * این تبدیل دقیقاً در یک‌جا انجام می‌شود تا هیچ فرمی عدد را اشتباه نفرستد.
 */
export async function createProductAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { getSessionToken } = await import('@/lib/admin-session');
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const title = String(formData.get('title') ?? '').trim();
  const typeKey = String(formData.get('typeKey') ?? '').trim();
  const brandSlug = String(formData.get('brandSlug') ?? '').trim() || null;
  const description = String(formData.get('description') ?? '').trim() || null;

  if (title.length < 3) return { error: 'عنوانِ کالا باید دست‌کم ۳ نویسه باشد.' };
  if (!typeKey) return { error: 'نوعِ کالا را انتخاب کنید.' };

  // تنوع‌ها به‌صورتِ آرایه‌ای از فیلدها می‌آیند: sku_0, price_0, ...
  const skus = formData.getAll('sku').map((v) => String(v).trim());
  const prices = formData.getAll('price').map((v) => String(v).trim());
  // مدل‌هایِ هر تنوع زیرِ نامِ خودش می‌آید (models_0، models_1، …)؛
  // اگر همه را با یک نام می‌خواندیم، یک قابِ آیفون به گوشیِ سامسونگ هم می‌خورد
  const modelsPerVariant = formData
    .getAll('variantKey')
    .map((key) => formData.getAll(`models_${String(key)}`).map((v) => String(v)));

  const variants: Array<{ sku: string; priceRial: string; compatibleModelIds: string[] }> = [];
  for (let i = 0; i < skus.length; i += 1) {
    const sku = skus[i];
    const priceToman = prices[i];
    if (!sku || !priceToman) continue;

    const toman = Number(priceToman.replace(/[,\s]/g, ''));
    if (!Number.isFinite(toman) || toman <= 0) {
      return { error: `قیمتِ تنوعِ «${sku}» معتبر نیست.` };
    }

    variants.push({
      sku,
      // تومان → ریال: ضرب در ۱۰، با گردکردن برای جلوگیری از اعشارِ شناور
      priceRial: String(Math.round(toman) * 10),
      compatibleModelIds: modelsPerVariant[i] ?? [],
    });
  }

  if (variants.length === 0) return { error: 'دست‌کم یک تنوع با شناسه و قیمت لازم است.' };

  const res = await fetch(`${API_ORIGIN}/catalog/products`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ typeKey, brandSlug, title, description, variants }),
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as
      | { error?: { message?: string; details?: Array<{ field?: string; message?: string }> } }
      | null;

    // جزئیاتِ هر فیلد از سمتِ سرور می‌آید — آن را به‌جای پیامِ کلی نشان می‌دهیم
    const detail = payload?.error?.details?.[0];
    if (detail?.message) return { error: detail.message };
    return { error: payload?.error?.message ?? 'کالا ثبت نشد.' };
  }

  const created = (await res.json().catch(() => null)) as { slug?: string } | null;
  revalidatePath('/admin/products');
  revalidatePath('/admin');
  return { ok: `کالا ثبت شد${created?.slug ? ` (${created.slug})` : ''}.` };
}

/**
 * ویرایشِ کالا.
 *
 * سه نکته‌ی مهم در این کنش:
 *  ۱) تنوع‌هایِ حذف‌شده «پاک» نمی‌شوند مگر این‌که هیچ اثری از آن‌ها در سفارش،
 *     انبار یا فاکتور نمانده باشد — تصمیم با خودِ سامانه است (در لایه‌یِ دامنه)،
 *     نه با فرم؛ پس تاریخچه‌ی مالی هیچ‌وقت نمی‌شکند.
 *  ۲) قیمت به تومان گرفته می‌شود و در ریال فرستاده می‌شود؛ تبدیل فقط همین‌جا
 *     و در یک‌جا انجام می‌شود تا هیچ فرمی عدد را دو بار تبدیل نکند.
 *  ۳) نتیجه شاملِ تغییراتِ قیمت است و همان به کاربر نشان داده می‌شود تا بداند
 *     دقیقاً چه چیزی عوض شده (و بعداً در حسابرسی هم ثبت است).
 */
export async function updateProductAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { getSessionToken } = await import('@/lib/admin-session');
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const productId = String(formData.get('productId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const typeKey = String(formData.get('typeKey') ?? '').trim();
  const brandSlugRaw = String(formData.get('brandSlug') ?? '');
  const brandSlug = brandSlugRaw === '' ? undefined : brandSlugRaw === '__none__' ? null : brandSlugRaw;
  const description = String(formData.get('description') ?? '').trim() || null;
  const status = String(formData.get('status') ?? 'active');

  if (!productId) return { error: 'شناسه‌ی کالا مشخص نیست.' };
  if (title.length < 3) return { error: 'عنوانِ کالا باید دست‌کم ۳ نویسه باشد.' };
  if (!typeKey) return { error: 'نوعِ کالا را انتخاب کنید.' };

  const keys = formData.getAll('variantKey').map((v) => String(v));
  const variants: Array<{
    id?: string;
    sku: string;
    priceRial: string;
    compatibleModelIds: string[];
    active: boolean;
  }> = [];

  for (const key of keys) {
    const sku = String(formData.get(`sku_${key}`) ?? '').trim();
    const priceToman = String(formData.get(`price_${key}`) ?? '').trim();
    const id = String(formData.get(`id_${key}`) ?? '').trim();
    const active = formData.get(`active_${key}`) !== null;

    if (!sku && !id) continue;
    if (!sku) return { error: 'شناسه‌ی تنوع نمی‌تواند خالی باشد.' };

    const toman = Number(priceToman.replace(/[,\s]/g, ''));
    if (!Number.isFinite(toman) || toman <= 0) {
      return { error: `قیمتِ تنوعِ «${sku}» معتبر نیست.` };
    }

    variants.push({
      ...(id ? { id } : {}),
      sku,
      priceRial: String(Math.round(toman) * 10),
      compatibleModelIds: formData.getAll(`models_${key}`).map((v) => String(v)),
      active,
    });
  }

  if (variants.length === 0) return { error: 'دست‌کم یک تنوع لازم است.' };

  const images = formData
    .getAll('images')
    .map((v) => String(v).trim())
    .filter(Boolean)
    .map((url) => ({ url, alt: '', role: 'gallery' }));

  const res = await fetch(`${API_ORIGIN}/catalog/products/${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title,
      typeKey,
      brandSlug,
      description,
      status,
      variants,
      ...(images.length ? { images } : {}),
    }),
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as
      | { error?: { message?: string; details?: Array<{ field?: string; message?: string }> } }
      | null;
    const detail = payload?.error?.details?.[0];
    if (detail?.message) return { error: detail.message };
    return { error: payload?.error?.message ?? 'تغییرات ذخیره نشد.' };
  }

  const updated = (await res.json().catch(() => null)) as
    | { priceChanges?: Array<{ sku: string; fromRial: string; toRial: string }>; deactivatedVariantIds?: string[] }
    | null;

  revalidatePath('/admin/products');
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath('/');

  const parts: string[] = ['تغییرات ذخیره شد.'];
  const changes = updated?.priceChanges ?? [];
  if (changes.length) {
    parts.push(
      `قیمتِ ${changes.length} تنوع تغییر کرد (${changes
        .map((c) => `${c.sku}: ${formatToman(BigInt(c.fromRial))} → ${formatToman(BigInt(c.toRial))}`)
        .join('، ')})`,
    );
  }
  if (updated?.deactivatedVariantIds?.length) {
    parts.push(
      `${updated.deactivatedVariantIds.length} تنوع که در سفارش‌ها یا انبار اثر داشتند، غیرفعال شدند (حذف نشدند تا تاریخچه سالم بماند).`,
    );
  }
  return { ok: parts.join(' ') };
}

/* ==================== صندوقِ حضوری ==================== */

/**
 * گشایشِ شیفت.
 * توجه: شناسه‌ی کاربر از توکن گرفته می‌شود و هرگز از فرم نمی‌آید —
 * بنابراین هیچ‌کس نمی‌تواند شیفت را «به نامِ دیگری» باز کند.
 */
export async function openShiftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { getSessionToken } = await import('@/lib/admin-session');
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const warehouseId = String(formData.get('warehouseId') ?? '');
  const openingCashToman = String(formData.get('openingCash') ?? '0').replace(/[,\s]/g, '');

  if (!warehouseId) return { error: 'انبار انتخاب نشده است.' };
  const toman = Number(openingCashToman) || 0;
  if (toman < 0) return { error: 'موجودیِ اولیه نمی‌تواند منفی باشد.' };

  const res = await fetch(`${API_ORIGIN}/pos/shifts/open`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ warehouseId, openingCashRial: String(Math.round(toman) * 10) }),
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { error: payload?.error?.message ?? 'شیفت باز نشد.' };
  }

  revalidatePath('/admin/pos');
  return { ok: 'شیفت گشوده شد.' };
}

/**
 * ثبتِ فروشِ حضوری.
 *
 * offlineId یک شناسه‌ی یکتا است که مرورگر می‌سازد؛ اگر همان درخواست دوبار
 * فرستاده شود (تکرارِ کلیک، بازگشتِ شبکه پس از قطعی)، سامانه فروشِ دوم را
 * ثبت نمی‌کند و همان نتیجه‌ی نخست را برمی‌گرداند.
 */
export async function posSellAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { getSessionToken } = await import('@/lib/admin-session');
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const shiftId = String(formData.get('shiftId') ?? '');
  const paymentMethod = String(formData.get('paymentMethod') ?? 'cash');
  const offlineId = String(formData.get('offlineId') ?? '');
  const customerName = String(formData.get('customerName') ?? '').trim() || null;
  const customerMobile = String(formData.get('customerMobile') ?? '').trim() || null;

  const variantIds = formData.getAll('variantId').map(String);
  const quantities = formData.getAll('quantity').map((v) => Number(String(v)));

  const items = variantIds
    .map((id, i) => ({ variantId: id, quantity: quantities[i] }))
    .filter((it) => it.variantId && Number.isInteger(it.quantity) && it.quantity > 0);

  if (!shiftId) return { error: 'شیفتی باز نیست.' };
  if (items.length === 0) return { error: 'دست‌کم یک کالا به فروش اضافه کنید.' };

  const res = await fetch(`${API_ORIGIN}/pos/shifts/${shiftId}/sell`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ items, paymentMethod, offlineId, customerName, customerMobile }),
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { error: payload?.error?.message ?? 'فروش ثبت نشد.' };
  }

  const sale = (await res.json().catch(() => null)) as
    | { orderId?: string; orderNo?: string; display?: { total?: string }; duplicate?: boolean }
    | null;

  revalidatePath('/admin/pos');
  revalidatePath('/admin/inventory');
  revalidatePath('/admin/orders');

  return {
    ok: sale?.duplicate
      ? 'این فروش پیش‌تر ثبت شده بود (تکراری نادیده گرفته شد).'
      : `فروش ثبت شد: ${sale?.orderNo ?? ''} — ${sale?.display?.total ?? ''} تومان`,
    orderId: sale?.orderId ?? null,
    orderNo: sale?.orderNo ?? null,
  };
}

/** بستنِ شیفت با شمارشِ نقدِ واقعی — هر مغایرتی ثبت می‌شود، نه اینکه پنهان شود */
export async function closeShiftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { getSessionToken } = await import('@/lib/admin-session');
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const shiftId = String(formData.get('shiftId') ?? '');
  const countedToman = String(formData.get('countedCash') ?? '').replace(/[,\s]/g, '');
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!shiftId) return { error: 'شیفتی برای بستن نیست.' };
  const toman = Number(countedToman);
  if (!Number.isFinite(toman) || toman < 0) return { error: 'مبلغِ شمارش‌شده معتبر نیست.' };

  const res = await fetch(`${API_ORIGIN}/pos/shifts/${shiftId}/close`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ countedCashRial: String(Math.round(toman) * 10), note }),
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { error: payload?.error?.message ?? 'شیفت بسته نشد.' };
  }

  const closed = (await res.json().catch(() => null)) as
    | { display?: { expected?: string; counted?: string; difference?: string }; differenceRial?: string }
    | null;

  revalidatePath('/admin/pos');
  const diff = Number(closed?.differenceRial ?? '0');
  const word = diff === 0 ? 'بدون مغایرت ✅' : `مغایرت: ${closed?.display?.difference ?? ''} تومان`;

  return {
    ok: `شیفت بسته شد — مورد انتظار ${closed?.display?.expected ?? ''}، شمارش‌شده ${closed?.display?.counted ?? ''} — ${word}`,
  };
}

/* ==================== حسابداری ==================== */

/**
 * تبدیلِ «تومانِ وارد‌شده» به «ریالِ ذخیره‌شده».
 *
 * چرا اینجا و نه در سرور؟ چون کاربر تومان می‌نویسد و پایگاه‌داده ریال
 * نگه می‌دارد؛ اگر این تبدیل در فرم‌ها پراکنده می‌شد، یک فرم می‌توانست
 * ریال بفرستد و عدد ده برابر شود. یک نقطه‌ی واحد = یک رفتار واحد.
 */
function tomanToRialString(raw: string | number): string {
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '0';
  return String(Math.round(n) * 10);
}

/** تاریخِ شمسیِ وارد‌شده را به رشته‌ی «YYYY-MM-DD» تبدیل می‌کند (برای ستونِ date) */
function jalaliToIsoDate(raw: string): string | null {
  const parsed = parseJalali(String(raw).trim());
  if (!parsed) return null;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * ثبتِ سندِ حسابداریِ دستی.
 *
 * سند پیش از ارسال در مرورگر «تراز» می‌شود (جمعِ بدهکار = جمعِ بستانکار)،
 * اما اعتبارِ نهایی با سرور است — تراز بودن در پایگاه‌داده هم قید دارد.
 */
export async function postJournalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { getSessionToken } = await import('@/lib/admin-session');
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const description = String(formData.get('description') ?? '').trim();
  const codes = formData.getAll('accountCode').map(String);
  const debits = formData.getAll('debit').map(String);
  const credits = formData.getAll('credit').map(String);
  const descs = formData.getAll('lineDescription').map(String);

  if (description.length < 3) return { error: 'شرحِ سند دست‌کم ۳ نویسه است.' };

  const lines: Array<{ accountCode: string; debitRial: string; creditRial: string; description?: string }> = [];
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i];
    const debit = debits[i]?.trim();
    const credit = credits[i]?.trim();
    if (!code) continue;
    if (!debit && !credit) continue;

    lines.push({
      accountCode: code,
      debitRial: debit ? tomanToRialString(debit) : '0',
      creditRial: credit ? tomanToRialString(credit) : '0',
      description: descs[i]?.trim() || undefined,
    });
  }

  if (lines.length < 2) return { error: 'هر سند دست‌کم دو ردیفِ غیرِ صفر دارد.' };

  const res = await fetch(`${API_ORIGIN}/admin/accounting/journal`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ description, lines }),
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as
      | { error?: { message?: string; details?: { message?: string } } }
      | null;
    return {
      error:
        payload?.error?.details?.message ??
        payload?.error?.message ??
        'سند ثبت نشد.',
    };
  }

  const entry = (await res.json().catch(() => null)) as
    | { entryNo?: string; display?: { total?: string } }
    | null;

  revalidatePath('/admin/accounting');
  return { ok: `سندِ ${entry?.entryNo ?? ''} ثبت شد — ${entry?.display?.total ?? ''} تومان` };
}

/**
 * برگشتِ سند.
 *
 * نکته‌ی حسابداری: سند هرگز حذف نمی‌شود. اصلاحِ یک اشتباه با ثبتِ سندِ
 * معکوس است، تا ردِ آنچه اتفاق افتاده برای همیشه بماند (بخشِ حسابرسی).
 */
export async function reverseJournalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { getSessionToken } = await import('@/lib/admin-session');
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const entryId = String(formData.get('entryId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();

  if (!entryId) return { error: 'سند مشخص نشده است.' };
  if (reason.length < 3) return { error: 'دلیلِ برگشت دست‌کم ۳ نویسه است.' };

  const res = await fetch(`${API_ORIGIN}/admin/accounting/journal/reverse`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ entryId, reason }),
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { error: payload?.error?.message ?? 'برگشت انجام نشد.' };
  }

  const reversal = (await res.json().catch(() => null)) as { entryNo?: string } | null;
  revalidatePath('/admin/accounting');
  return { ok: `سندِ معکوسِ ${reversal?.entryNo ?? ''} ثبت شد؛ سندِ اصلی حذف نشده است.` };
}

/**
 * ثبتِ فاکتورِ خرید — ورودِ کالا به انبار و ایجادِ بدهی به تأمین‌کننده.
 *
 * ارزش افزوده جداگانه می‌آید: نه به بهای کالا اضافه می‌شود (تا میانگینِ
 * موزون خراب نشود) و نه پنهان می‌ماند (تا در پایانِ دوره از مالیاتِ فروش
 * کسر شود).
 */
export async function postPurchaseInvoiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { getSessionToken } = await import('@/lib/admin-session');
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const supplierName = String(formData.get('supplierName') ?? '').trim();
  const supplierNationalId = String(formData.get('supplierNationalId') ?? '').trim() || null;
  const supplierEconomicCode = String(formData.get('supplierEconomicCode') ?? '').trim() || null;
  const supplierInvoiceNo = String(formData.get('supplierInvoiceNo') ?? '').trim() || null;
  const issuedJalali = String(formData.get('issuedAt') ?? '').trim();
  const warehouseId = String(formData.get('warehouseId') ?? '');
  const extraCost = String(formData.get('extraCost') ?? '').trim();
  const vat = String(formData.get('vat') ?? '').trim();

  if (supplierName.length < 2) return { error: 'نامِ تأمین‌کننده را وارد کنید.' };
  if (!warehouseId) return { error: 'انبارِ مقصد را انتخاب کنید.' };

  const variantIds = formData.getAll('variantId').map(String);
  const quantities = formData.getAll('quantity').map((v) => Number(String(v)));
  const unitCosts = formData.getAll('unitCost').map(String);

  const items = variantIds
    .map((variantId, i) => ({
      variantId,
      quantity: quantities[i],
      unitCostRial: tomanToRialString(unitCosts[i] ?? ''),
    }))
    .filter((it) => it.variantId && Number.isInteger(it.quantity) && it.quantity > 0);

  if (items.length === 0) return { error: 'دست‌کم یک کالا با تعداد و بهای خرید لازم است.' };

  const issuedAt = issuedJalali ? jalaliToIsoDate(issuedJalali) : null;
  if (issuedJalali && !issuedAt) {
    return { error: 'تاریخِ صدور معتبر نیست؛ قالبِ درست: ۱۴۰۵/۰۶/۲۰' };
  }

  const res = await fetch(`${API_ORIGIN}/admin/accounting/purchases`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      supplierName,
      supplierNationalId,
      supplierEconomicCode,
      supplierInvoiceNo,
      issuedAt,
      warehouseId,
      items,
      extraCostRial: extraCost ? tomanToRialString(extraCost) : '0',
      vatRial: vat ? tomanToRialString(vat) : '0',
    }),
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as
      | { error?: { message?: string; details?: { message?: string } } }
      | null;
    return {
      error:
        payload?.error?.details?.message ??
        payload?.error?.message ??
        'فاکتور ثبت نشد.',
    };
  }

  const invoice = (await res.json().catch(() => null)) as
    | { invoiceNo?: string; entryNo?: string; display?: { payable?: string; vat?: string } }
    | null;

  revalidatePath('/admin/accounting');
  revalidatePath('/admin/inventory');
  return {
    ok: `فاکتورِ ${invoice?.invoiceNo ?? ''} ثبت شد — قابلِ پرداخت ${invoice?.display?.payable ?? ''} تومان (ارزش افزوده ${invoice?.display?.vat ?? ''}) — سند ${invoice?.entryNo ?? ''}`,
  };
}

/* ── شمارش فیزیکی انبار ──────────────────────────────────────────────── */

export async function createInventoryCount(formData: FormData) {
  const { getSessionToken } = await import('@/lib/admin-session');
  const token = await getSessionToken();
  if (!token) return { error: 'نشست شما منقضی شده.' };

  const warehouseId = String(formData.get('warehouseId') ?? '');
  if (!warehouseId) return { error: 'انبار را انتخاب کنید.' };

  const res = await fetch(`${API_ORIGIN}/admin/inventory/counts`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ warehouseId }),
  });

  if (!res.ok) {
    const p = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { error: p?.error?.message ?? 'ایجاد شمارش ناموفق.' };
  }

  revalidatePath('/admin/inventory');
  const d = (await res.json().catch(() => null)) as { countId?: string; message?: string } | null;
  return { ok: d?.message ?? 'شمارش ایجاد شد.', countId: d?.countId };
}

export async function recordInventoryCount(formData: FormData) {
  const { getSessionToken } = await import('@/lib/admin-session');
  const token = await getSessionToken();
  if (!token) return { error: 'نشست شما منقضی شده.' };

  const countId = String(formData.get('countId') ?? '');
  if (!countId) return { error: 'شناسه شمارش نامعتبر.' };

  // خواندن آیتم‌ها از formData (variantId_0, countedQty_0, variantId_1, ...)
  const items: Array<{ variantId: string; countedQty: number }> = [];
  for (let i = 0; ; i++) {
    const vid = String(formData.get(`variantId_${i}`) ?? '');
    const qty = Number(formData.get(`countedQty_${i}`) ?? '');
    if (!vid) break;
    if (Number.isFinite(qty) && qty >= 0) items.push({ variantId: vid, countedQty: qty });
  }
  if (!items.length) return { error: 'آیتمی وارد نشد.' };

  const res = await fetch(`${API_ORIGIN}/admin/inventory/counts/${countId}/record`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ items }),
  });

  if (!res.ok) {
    const p = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { error: p?.error?.message ?? 'ثبت شمارش ناموفق.' };
  }

  revalidatePath('/admin/inventory');
  return { ok: `${items.length} آیتم ثبت شد.` };
}

export async function closeInventoryCount(formData: FormData) {
  const { getSessionToken } = await import('@/lib/admin-session');
  const token = await getSessionToken();
  if (!token) return { error: 'نشست شما منقضی شده.' };

  const countId = String(formData.get('countId') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  if (!countId) return { error: 'شناسه شمارش نامعتبر.' };

  const res = await fetch(`${API_ORIGIN}/admin/inventory/counts/${countId}/close`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ note }),
  });

  if (!res.ok) {
    const p = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { error: p?.error?.message ?? 'بستن شمارش ناموفق.' };
  }

  revalidatePath('/admin/inventory');
  const d = (await res.json().catch(() => null)) as { differences?: Array<{ sku: string; title: string; system_qty: number; counted_qty: number; diff_qty: number }> } | null;
  const diffs = d?.differences ?? [];
  if (diffs.length === 0) return { ok: 'شمارش بسته شد — بدون مغایرت.' };
  return {
    ok: `شمارش بسته شد — ${diffs.length} مغایرت:`,
    differences: diffs,
  };
}

/* ── انتقال بین انبارها ──────────────────────────────────────────────── */

export async function transferStock(formData: FormData) {
  const { getSessionToken } = await import('@/lib/admin-session');
  const token = await getSessionToken();
  if (!token) return { error: 'نشست شما منقضی شده.' };

  const fromWarehouseId = String(formData.get('fromWarehouseId') ?? '');
  const toWarehouseId = String(formData.get('toWarehouseId') ?? '');
  const variantId = String(formData.get('variantId') ?? '');
  const quantity = Number(formData.get('quantity') ?? '0');

  if (!fromWarehouseId || !toWarehouseId || !variantId || quantity <= 0) {
    return { error: 'اطلاعات ناقص است.' };
  }

  const res = await fetch(`${API_ORIGIN}/admin/inventory/transfer`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ fromWarehouseId, toWarehouseId, variantId, quantity }),
  });

  if (!res.ok) {
    const p = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { error: p?.error?.message ?? 'انتقال ناموفق.' };
  }

  revalidatePath('/admin/inventory');
  return { ok: `${quantity} عدد با موفقیت منتقل شد.` };
}
