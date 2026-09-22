'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { api, type CartView } from '@/lib/api';

const CART_COOKIE = 'set_cart';

/**
 * سبد در سمتِ سرور نگه‌داری می‌شود و فقط شناسه‌اش در کوکی است.
 * چرا؟ چون موجودی و قیمت باید از پایگاه‌داده بیایند، نه از مرورگرِ مشتری؛
 * مرورگر می‌تواند قیمت را دستکاری کند، پایگاه‌داده را نه.
 */
async function readCartId(): Promise<string | null> {
  const store = await cookies();
  return store.get(CART_COOKIE)?.value ?? null;
}

async function writeCartId(id: string): Promise<void> {
  const store = await cookies();
  store.set(CART_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // ۳۰ روز
  });
}

/** پیامِ خطایِ خوانا از پاسخِ کارساز (یا متنِ آماده‌یِ خودش) */
function messageOfCheckout(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  // قالبِ ApiError در لایه‌یِ api: «API /cart/... → 409 <پیامِ فارسی>»
  const m = /→\s*\d{3}\s*(.+)$/.exec(raw);
  const text = (m?.[1] ?? raw).trim();
  if (text && /[؀-ۿ]/.test(text)) return text;
  return 'تسویه‌حساب انجام نشد. موجودی یا قیمت تغییر کرده است؛ سبد را بررسی کنید.';
}

async function clearCartId(): Promise<void> {
  const store = await cookies();
  store.delete(CART_COOKIE);
}

/** سبدِ فعلی؛ اگر نباشد، خالی است (و در اولین افزودن ساخته می‌شود) */
export async function getCart(): Promise<CartView | null> {
  const id = await readCartId();
  if (!id) return null;
  try {
    return await api.getCart(id);
  } catch {
    // سبد منقضی یا پاک شده — کوکی را هم پاک می‌کنیم
    await clearCartId();
    return null;
  }
}

async function ensureCart(): Promise<string> {
  const existing = await readCartId();
  if (existing) return existing;
  const { cartId } = await api.createCart();
  await writeCartId(cartId);
  return cartId;
}

export async function addToCart(formData: FormData): Promise<void> {
  const variantId = String(formData.get('variantId') ?? '');
  const quantity = Number(formData.get('quantity') ?? 1);
  if (!variantId || !Number.isFinite(quantity) || quantity < 1) return;

  const cartId = await ensureCart();
  await api.addToCart(cartId, variantId, Math.min(quantity, 99));
  revalidatePath('/cart');
  revalidatePath('/', 'layout');
}

export async function removeFromCart(formData: FormData): Promise<void> {
  const variantId = String(formData.get('variantId') ?? '');
  const cartId = await readCartId();
  if (!variantId || !cartId) return;

  await api.removeFromCart(cartId, variantId);
  revalidatePath('/cart');
  revalidatePath('/', 'layout');
}

export async function checkout(
  formData: FormData,
  gateway?: string,
): Promise<{ error?: string; orderNo?: string; orderId?: string }> {
  const cartId = await readCartId();
  if (!cartId) return { error: 'سبد شما خالی است.' };

  const customerName = String(formData.get('customerName') ?? '').trim();
  const customerMobile = String(formData.get('customerMobile') ?? '').trim();
  const shippingAddress = String(formData.get('shippingAddress') ?? '').trim();
  const couponCode = String(formData.get('couponCode') ?? '').trim();
  const shippingRial = String(formData.get('shippingRial') ?? '0').trim();
  const shippingMethodKey = String(formData.get('shippingMethodKey') ?? '').trim();
  const paymentMethod = String(formData.get('paymentMethod') ?? 'online').trim();
  const checkSayadNo = String(formData.get('checkSayadNo') ?? '').trim();
  const checkNo = String(formData.get('checkNo') ?? '').trim();
  const checkBank = String(formData.get('checkBank') ?? '').trim();
  const checkDueDate = String(formData.get('checkDueDate') ?? '').trim();

  if (customerName.length < 3) return { error: 'نامِ گیرنده را کامل وارد کنید.' };
  if (!/^09\d{9}$/.test(customerMobile)) return { error: 'شماره‌ی موبایل باید با ۰۹ و ۱۱ رقم باشد.' };
  if (shippingAddress.length < 10) return { error: 'نشانی را کامل‌تر وارد کنید.' };

  // آدرس کامل: شهر + نشانی
  const city = String(formData.get('city') ?? '').trim();
  const fullAddress = city ? `${city}، ${shippingAddress}` : shippingAddress;

  try {
    const result = await api.checkout(cartId, {
      idempotencyKey: `web:${cartId}`,
      customerName,
      customerMobile,
      shippingAddress: fullAddress,
      shippingRial,
      shippingMethodKey: shippingMethodKey || undefined,
      couponCode: couponCode || undefined,
      paymentMethod: paymentMethod !== 'online' ? paymentMethod : undefined,
      checkNo: checkNo || undefined,
      checkSayadNo: checkSayadNo || undefined,
      checkBank: checkBank || undefined,
      checkDueDate: checkDueDate || undefined,
    });

    // --- رفتن به درگاهِ پرداخت
    // سفارش ساخته شده و کالا برای مشتری رزرو است. حالا یک تراکنش نزدِ درگاه
    // می‌سازیم و مرورگر را به درگاه هدایت می‌کنیم.
    //
    // نکته‌ی مهم: clearCartId() باید **بعد** از startPayment() باشد، نه قبل.
    // اگر startPayment شکست بخورد، سبد هنوز موجود است و مشتری می‌تواند
    // دوباره تلاش کند. اگر سبد را زودتر پاک کنیم، مشتری هم سبد را از دست
    // داده و هم پرداخت انجام نشده — بدترین حالتِ ممکن.
    try {
      const payment = await api.startPayment(result.orderId, gateway);
      // پرداخت با موفقیت ساخته شد — حالا سبد را پاک کن
      await clearCartId();
      revalidatePath('/cart');
      revalidatePath('/', 'layout');
      // redirect() یک استثنایِ ویژه می‌اندازد؛ پس نباید درونِ try/catch بمیرد
      const url = payment.redirectUrl;
      revalidatePath('/', 'layout');
      redirect(url);
    } catch (err) {
      // استثنایِ هدایتِ Next را بالا می‌اندازیم (نباید به‌عنوان خطا دیده شود)
      if (typeof err === 'object' && err && 'digest' in err) throw err;
      // startPayment شکست خورد — سبد هنوز موجود است
      // سفارش ساخته شده ولی پرداخت شروع نشده
      // مشتری می‌تواند از صفحه سبد دوباره تلاش کند
      return { error: 'سفارش ثبت شد ولی اتصال به درگاه پرداخت برقرار نشد. لطفاً دوباره تلاش کنید.', orderNo: result.orderNo, orderId: result.orderId };
    }
  } catch (error) {
    // پیامِ کارساز را همان‌طور می‌رسانیم: کارساز برایِ هر خطایِ کسب‌وکاری
    // (کدِ منقضی، پایین‌تر از کمینه، اتمامِ ظرفیت) پیامِ فارسیِ خودش را
    // نوشته است. پوشاندنش با یک جمله‌یِ عمومی یعنی مشتری نمی‌فهمد چه کند.
    return { error: messageOfCheckout(error) };
  }
}
