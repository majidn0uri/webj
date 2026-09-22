/**
 * تمامِ داده از API واقعیِ ست‌شاپ می‌آید؛ هیچ داده‌ای در فرانت «جعل» نمی‌شود.
 *
 * نکته‌ی مهم: مرورگرِ مشتری هرگز مستقیماً به پورتِ API وصل نمی‌شود.
 * در سمتِ سرور نشانیِ مطلق استفاده می‌شود و در مرورگر مسیرِ نسبیِ /api
 * که توسط rewrite به سرویسِ API پروکسی می‌گردد.
 */
const API_ORIGIN = process.env.API_BASE ?? 'http://127.0.0.1:3000';

function url(path: string): string {
  return typeof window === 'undefined' ? `${API_ORIGIN}${path}` : `/api${path}`;
}

/**
 * سرآیندِ «تماسِ درونی» — فقط در سمتِ سرور.
 *
 * چرا؟ چون صفحه‌هایِ فروشگاه در سرورِ نکست ساخته می‌شوند: ده‌ها درخواستِ
 * «برایِ یک خریدار»، از **یک** نشانی (خودِ وب) به API می‌رسند. اگر آن‌ها با
 * نشانی شمرده شوند، سهمِ همه‌یِ خریداران از یک سطل خرج می‌شود و در نخستین
 * شلوغی، فروشگاه خودش را می‌بندد. این سرآیند می‌گوید «این تماس از لایه‌یِ
 * وب است، نه از یک مرورگرِ ناشناس» و API سقف‌هایِ حاشیه‌ای را برایش برنمی‌دارد.
 *
 * مقدارش ثابت است (یک متغیرِ محیطی)، پس کلیدِ کشِ نکست هم ثابت می‌ماند.
 */
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN ?? '';

function internalHeaders(): Record<string, string> {
  if (typeof window !== 'undefined') return {};
  return INTERNAL_TOKEN ? { 'x-set-internal': INTERNAL_TOKEN } : {};
}

async function get<T>(path: string, revalidate = 30): Promise<T> {
  const res = await fetch(url(path), {
    next: { revalidate },
    headers: { accept: 'application/json', ...internalHeaders() },
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

/* ---------- قالب‌های داده — دقیقاً مطابقِ پاسخِ واقعیِ API ---------- */

export interface Device {
  id: string;
  brand: string;
  model: string;
  slug: string;
}

export interface ProductListItem {
  id: string;
  title: string;
  slug: string;
  brand: string | null;
  type: string;
  price: string | null;      // تومان، قالب‌بندی‌شده
  priceRial: number;
  /** ارزان‌ترین تنوعِ فعال — برای «افزودن به سبدِ سریع» */
  defaultVariantId: string | null;
  variantCount: number;
  imageUrl?: string | null;
  /** اندازه‌یِ کارت (۶۰۰ پیکسل) — برایِ فهرست‌ها */
  imageCardUrl?: string | null;
  /** پیش‌نمایشِ تار (data URI) — نمایشِ بی‌پرش پیش از رسیدنِ تصویر */
  imagePlaceholder?: string | null;
  isNew?: boolean;
  discountPercent?: number | null;
  discountAmountRial?: string | null;
  availableQty?: number;
  colours?: string[];
}

export interface GatewayOption {
  key: 'sandbox' | 'zarinpal' | 'idpay';
  label: string;
  recommended?: boolean;
}

export interface PaymentStart {
  paymentId: string;
  gateway: 'sandbox' | 'zarinpal' | 'idpay';
  amountRial: string;
  authority: string;
  redirectUrl: string;
}

export interface PaymentVerifyResult {
  status: 'success' | 'failed' | 'already';
  orderNo: string;
  paymentId: string;
  refId: string | null;
  message: string;
}

export interface PaymentStatusView {
  paymentId: string;
  orderNo: string;
  gateway: string;
  status: 'pending' | 'success' | 'failed';
  amountRial: string;
  refId: string | null;
  cardPanMasked: string | null;
  message: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export interface CompatibleItem {
  productId: string;
  title: string;
  slug: string;
  sku: string;
  price: string;
  priceRial: number;
  available: number;
}

export interface Variant {
  id: string;
  sku: string;
  attributes: Record<string, unknown>;
  price_rial: number;
  is_active: boolean;
  available: number;
}

export interface ProductDetail {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  status: string;
  brand: string | null;
  type: string;
  variants: Variant[];
  images: Array<{ url: string; alt?: string | null; role?: string | null }>;
  compatibleDevices: Array<{ id: string; brand: string; model: string }>;
  /** ویژگی‌هایِ کالا (جنس، توان، طول …) — خوراکِ تبِ «مشخصات» */
  attributes?: Record<string, unknown>;
}

/** ستونِ یک کالا در جدولِ مقایسه — همان اعدادی که رویِ صفحه‌یِ کالا دیده می‌شود */
export interface CompareItem {
  slug: string;
  title: string;
  brand: string | null;
  minPriceRial: number;
  defaultVariantId: string | null;
  discountPercent: number | null;
  available: number;
  imageUrl: string | null;
  rating: number | null;
  reviewCount: number;
}

export interface CompareResult {
  products: CompareItem[];
  specRows: Array<{ key: string; values: (string | number | null)[] }>;
  deviceModels: string[][];
}

export interface SearchResult {
  total: number;
  count: number;
  normalized: string;
  /** مترادف‌هایی که روی عبارتِ کاربر اعمال شده — برای نمایشِ «منظورتان…» */
  applied: Array<{ input: string; matched: string[] }>;
  /** اگر true باشد یعنی همه‌ی واژه‌ها با هم پیدا نشد؛ نتیجه‌ها بخشی را دارند */
  relaxed: boolean;
  tookMs: number;
  items: Array<{
    id: string;
    title: string;
    slug: string;
    brand: string | null;
    type: string;
    minPriceRial: string;
    variantCount: number;
    imageUrl?: string | null;
    imageCardUrl?: string | null;
    imagePlaceholder?: string | null;
    isNew?: boolean;
    discountPercent?: number | null;
    discountAmountRial?: string | null;
    availableQty?: number;
    colours?: string[];
  }>;
}

/* ---------- سبدِ خرید ---------- */

export interface CartItemView {
  variantId: string;
  sku: string;
  title: string;
  productSlug: string;
  quantity: number;
  priceAtAddRial: string;
  currentPriceRial: string;
  priceChanged: boolean;
  lineTotalRial: string;
  available: number;
  enoughStock: boolean;
}

export interface CartView {
  cartId: string;
  status: string;
  items: CartItemView[];
  subtotalRial: string;
  itemCount: number;
  hasPriceChanges: boolean;
  hasStockProblems: boolean;
  /** نرخِ ارزش‌افزوده (درصد) از تنظیماتِ پنل — همان که سفارش با آن حساب می‌شود */
  vatPercent: number;
}

/**
 * سرآیندِ کوکی برایِ درخواست‌هایِ سمتِ سرور.
 *
 * چرا لازم شد؟ چون نشستِ مشتری در یک کوکیِ HttpOnly است و اگر آن را به API
 * نفرستیم، سفارش «مهمان» ثبت می‌شود و در «سفارش‌هایِ من» نمی‌آید. در مرورگر
 * نیازی نیست (همان کوکی به‌طورِ خودکار با درخواستِ هم‌ origin می‌رود).
 */
/**
 * نشانیِ مشتری، برایِ عبور از لایه‌یِ وب تا API.
 *
 * چرا دست‌به‌دست می‌شود؟ چون Next با `rewrites` سرآیندها را عبور **نمی‌دهد**
 * (اندازه گرفته شد: پاسخِ API از راهِ وب، `x-forwarded-for` نداشت) و API همه‌یِ
 * خریداران را «۱۲۷.۰.۰.۱» می‌بیند. برایِ سقف‌هایِ کسب‌وکاری که «با نشست»
 * شمرده می‌شوند این یعنی: خریدارِ واردنشده نشستِ شناسایی ندارد، پس سطلش
 * `ip::` می‌شود — یعنی سطلِ **کلِ فروشگاه**. نتیجه‌اش در آزمونِ بار دیده شد:
 * `order.create` (۱۰ در ساعت) پس ازِ ده سفارش، به همه ۴۲۹ می‌داد.
 *
 * API این سرآیند را تنها از تماسِ **درونیِ** معتبر (کلیدِ `x-set-internal`)
 * می‌پذیرد؛ بی‌کلید، بی‌اعتبار است. پس جعلش از بیرون ممکن نیست.
 *
 * و تنها در مسیرِ نوشتن خوانده می‌شود، نه در خواندنِ کشیدنی: یک `headers()`
 * در مسیرِ خواندن، کشِ همهٔ صفحه‌ها را خاموش می‌کند (تجربه‌یِ تلخِ §۲م از
 * `docs/bar-va-tavan.md`). نوشتن‌ها از پیش پویا هستند.
 */
async function clientIpHeader(): Promise<Record<string, string>> {
  if (typeof window !== 'undefined') return {};
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    // `x-real-ip` تنها چیزی است که جعلش از بیرون ممکن نیست: nginx آن را از
    // `$remote_addr` می‌نویسد. `x-forwarded-for` را پیش‌فرض نمی‌خوانیم، چون
    // نخستینِ مقدارش را خودِ کلاینت می‌نویسد — همان سوراخی که در
    // `apps/api/src/client-ip.ts` توضیح داده شده. اگر جایی nginx را تنها با XFF
    // مستقر کرده‌اند، `TRUST_XFF=1` روشنش می‌کند و زنجیره از **آخر** خوانده
    // می‌شود (چون `$proxy_add_x_forwarded_for` نشانیِ واقعی را در آخر می‌گذارد).
    const real = h.get('x-real-ip');
    const xff = process.env.TRUST_XFF === '1' ? h.get('x-forwarded-for') : null;
    const chain = (real ?? xff ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const ip = real ? chain[0] : chain.at(-1);
    return ip ? { 'x-set-client-ip': ip } : {};
  } catch {
    return {};
  }
}

async function cookieHeader(): Promise<Record<string, string>> {
  if (typeof window !== 'undefined') return {};
  try {
    const { cookies } = await import('next/headers');
    const jar = (await cookies())
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
    return jar ? { cookie: jar } : {};
  } catch {
    // بیرون از زمینه‌ی درخواستِ نکست (مثلِ یک اسکریپت) — کوکی‌ای در کار نیست
    return {};
  }
}

/** درخواست‌هایِ تغییردهنده همیشه بی‌کش هستند */
/**
 * پیامِ خطا از بدنه‌یِ پاسخ.
 *
 * چرا جدا؟ چون خواندنِ بدنه خودش می‌تواند شکست بخورد (پاسخِ تُهی یا ناتمام)،
 * و شکست در ساختنِ پیامِ خطا نباید پیامِ اصلی را ببلعد.
 */
async function safeMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: unknown; error?: unknown };
    const raw = typeof data.message === 'string' ? data.message : typeof data.error === 'string' ? data.error : '';
    return raw.trim().slice(0, 300);
  } catch {
    return '';
  }
}

async function mutate<T>(path: string, method: 'POST' | 'DELETE', body?: unknown): Promise<T> {
  const res = await fetch(url(path), {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      accept: 'application/json',
      ...(await cookieHeader()),
      ...internalHeaders(),
      ...(await clientIpHeader()),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) {
    // پیامِ فارسی‌ای که کارساز برایِ این خطا نوشته (مانندِ «این کدِ تخفیف
    // منقضی شده است») همراهِ پاسخ است؛ اگر آن را دور بریزیم، رابط ناچار
    // می‌شود یک جمله‌یِ عمومی نشان دهد و کاربر نمی‌فهمد چه باید بکند.
    const detail = await safeMessage(res);
    throw new Error(
      `API ${method} ${path} → ${res.status}${detail ? ` ${detail}` : ''}`,
    );
  }
  return res.json() as Promise<T>;
}

/**
 * جستجو همیشه بی‌کش است: نتیجه به عبارتِ کاربر وابسته است و کشِ مشترک
 * برای آن بی‌معناست (تازه‌بودنِ موجودی هم در همین پاسخ است).
 */
async function getFresh<T>(path: string): Promise<T> {
  const res = await fetch(url(path), {
    cache: 'no-store',
    headers: { accept: 'application/json', ...internalHeaders() },
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  search: (q: string, extra = '') =>
    getFresh<SearchResult>(`/catalog/search?q=${encodeURIComponent(q)}${extra}`),
  devices: () => get<{ devices: Device[] }>('/catalog/devices', 300),
  /**
   * رنگ‌هایِ موجودِ فروشگاه (برایِ فیلترِ رنگِ صفحه‌یِ جستجو).
   *
   * چرا کشِ ده‌دقیقه‌ای؟ چون فهرستِ رنگ را فروشنده از پنل عوض می‌کند، نه
   * خریدار؛ و پیش ازِ این، هر جستجو برایِ دانستنِ همین هفتِ نام، صد کالا را
   * کامل می‌خواند. کشِ کوتاه‌مدتِ «نتیجه‌یِ جستجو» با این فرق دارد: نتیجه به
   * عبارتِ کاربر وابسته است، امّا رنگ‌ها به هیچ‌کس وابسته نیستند.
   */
  colours: () => get<{ colours: string[] }>('/catalog/colours', 600),
  products: (query = '') => get<{ total: number; count: number; items: ProductListItem[] }>(`/catalog/products${query}`),
  compatible: (deviceId: string) =>
    get<{ count: number; items: CompatibleItem[] }>(`/catalog/compatible/${deviceId}`, 60),
  brands: () => get<{ brands: Array<{ slug: string; name: string; count: number }> }>('/catalog/brands', 600),
  product: (slug: string) => get<ProductDetail>(`/catalog/products/${slug}`, 60),
  /** مقایسه‌یِ تا چهار کالا — نامک‌ها به همان ترتیبِ ستون‌ها (نخستین، انتخابِ خریدار) */
  compare: (slugs: string) => get<CompareResult>(`/catalog/compare?slugs=${encodeURIComponent(slugs)}`, 60),
  /** تاریخچهٔ قیمتِ یک کالا (آخرین ۳۰ نقطهٔ روزانه) */
  priceHistory: (slug: string) => get<{ points: Array<{ date: string; priceRial: number }>; total: number }>(`/catalog/products/${slug}/price-history`, 300),

  /* --- سبد --- */
  createCart: () => mutate<{ cartId: string }>('/cart', 'POST', {}),
  getCart: (cartId: string) => get<CartView>(`/cart/${cartId}`, 0),
  addToCart: (cartId: string, variantId: string, quantity: number) =>
    mutate<CartView>(`/cart/${cartId}/items`, 'POST', { variantId, quantity }),
  removeFromCart: (cartId: string, variantId: string) =>
    mutate<CartView>(`/cart/${cartId}/items/${variantId}`, 'DELETE'),
  checkout: (
    cartId: string,
    payload: {
      idempotencyKey: string;
      customerName: string;
      customerMobile: string;
      shippingAddress: string;
      shippingRial?: string;
      shippingMethodKey?: string;
      couponCode?: string;
      paymentMethod?: string;
      checkNo?: string;
      checkSayadNo?: string;
      checkBank?: string;
      checkDueDate?: string;
    },
  ) => mutate<{ orderId: string; orderNo: string; totalRial: string; duplicate: boolean; paymentMethod?: string }>(
    `/cart/${cartId}/checkout`, 'POST', payload,
  ),

  /* --- پرداخت (درگاهِ ایرانی) --- */
  gateways: () => get<{ gateways: GatewayOption[] }>('/payments/gateways', 300),
  startPayment: (orderId: string, gateway?: string) =>
    mutate<PaymentStart>('/payments/start', 'POST', { orderId, gateway }),
  /** تأیید فقط از سمتِ سرور صدا زده می‌شود، نه از مرورگرِ مشتری */
  verifyPayment: (authority: string, gateway?: string) =>
    mutate<PaymentVerifyResult>('/payments/verify', 'POST', { authority, gateway }),
  paymentStatus: (paymentId: string) => get<PaymentStatusView>(`/payments/status/${paymentId}`, 0),
  paymentByAuthority: (authority: string) =>
    getFresh<{ paymentId: string; orderNo: string; amountRial: string; gateway: string; status: string } | null>(
      `/payments/authority/${encodeURIComponent(authority)}`,
    ),
  /** فقط برای درگاهِ آزمایشی */
  sandboxDecision: (authority: string, decision: 'paid' | 'cancelled' | 'failed') =>
    mutate<{ ok: boolean }>(`/payments/sandbox/${authority}/decision`, 'POST', { decision }),
};
