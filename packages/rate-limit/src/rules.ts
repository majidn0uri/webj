import type { RateRule, RateScope, RateStore } from './types.js';

/**
 * قاعده‌هایِ پیش‌فرضِ مهارِ بار.
 *
 * چرا این عددها؟ هر کدام پاسخِ یک پرسشِ مشخص است، نه یک حدسِ خوش‌بینانه:
 *
 *   • خواندنِ عمومی (۶۰۰ در دقیقه): یک خریدارِ واقعی در یک دقیقه بیش از
 *     چند ده صفحه نمی‌بیند — حتی با باز کردنِ ده تب. ۶۰۰ یعنی ده برابرِ
 *     سنگین‌ترین رفتارِ انسانی، و نصفِ آن برایِ جستجو که گران‌تر است.
 *   • ورود با رمز (۱۰ در ده دقیقه): ده بار اشتباه زدنِ رمز در ده دقیقه
 *     برایِ آدمی که رمزش را نمی‌داند کافی است؛ بیشترش یعنی حدس زدن.
 *   • کدِ یک‌بارمصرف (۸ در ده دقیقه): هر کد یک پیامک است و پیامک هزینه
 *     دارد. این سقف مستقیم از کیفِ پولِ فروشگاه محافظت می‌کند.
 *   • کوپن (۳۰ در ده دقیقه): کدهایِ کوتاه را بدون این سقف می‌توان با
 *     چند هزار کوشش پیدا کرد.
 *   • ثبتِ سفارش (۱۰ در ساعت): سفارش موجودی را رزرو می‌کند؛ بی‌سقف بودنش
 *     یعنی یک اسکریپت می‌تواند انبارِ دیگری را قفل کند.
 *
 * همه‌ی این‌ها از پنل تغییر می‌کنند؛ اینجا فقط نقطه‌یِ آغاز است (و پشتیبان،
 * اگر روزی پایگاهِ قاعده‌ها در دسترس نباشد).
 */
export const DEFAULT_RULES: readonly RateRule[] = [
  {
    name: 'public.read',
    title: 'خواندنِ عمومی (فهرست، برگه‌یِ کالا، دسته‌ها)',
    hint: 'سقفِ هر بازدیدکننده در یک دقیقه. تماس‌هایِ درونیِ وب حساب نمی‌شوند.',
    maxRequests: 600,
    windowSeconds: 60,
    scope: 'ip',
    store: 'memory',
    isEnabled: true,
  },
  {
    name: 'search',
    title: 'جستجو',
    hint: 'جستجو گران‌ترین خواندنِ سامانه است؛ سقفش از بقیه‌یِ صفحه‌ها کمتر است.',
    maxRequests: 120,
    windowSeconds: 60,
    scope: 'ip',
    store: 'memory',
    isEnabled: true,
  },
  {
    name: 'public.write',
    title: 'تغییرهایِ عمومی (سبد، نشانی، دیدگاه)',
    hint: 'هر نوشتنِ بی‌نام؛ برایِ جلوگیری از انباشتِ سبدها و رکوردهایِ بی‌صاحب.',
    maxRequests: 120,
    windowSeconds: 60,
    scope: 'ip',
    store: 'memory',
    isEnabled: true,
  },
  {
    name: 'auth.login',
    title: 'ورود با رمز',
    hint: 'کوششِ ورود (پنل و فروشگاه). هر کوشش در login_attempts هم ثبت می‌شود.',
    maxRequests: 10,
    windowSeconds: 600,
    scope: 'ip',
    store: 'db',
    isEnabled: true,
  },
  {
    name: 'auth.otp',
    title: 'درخواستِ کدِ یک‌بارمصرف',
    hint: 'هر کد یک پیامک است و پیامک پول دارد؛ این سقف جلویِ هزینه‌یِ ساختگی را می‌گیرد.',
    maxRequests: 8,
    windowSeconds: 600,
    scope: 'ip',
    store: 'db',
    isEnabled: true,
  },
  {
    name: 'coupon.validate',
    title: 'آزمودنِ کدِ تخفیف',
    hint: 'بدون این سقف می‌توان همه‌یِ کدهایِ کوتاه را یکی‌یکی آزمود تا یکی درآید.',
    maxRequests: 30,
    windowSeconds: 600,
    scope: 'ip',
    store: 'db',
    isEnabled: true,
  },
  {
    name: 'order.create',
    title: 'ثبتِ سفارش',
    hint: 'سفارش موجودی را رزرو می‌کند؛ سقفش جلویِ قفل‌کردنِ انبار را می‌گیرد.',
    maxRequests: 10,
    windowSeconds: 3600,
    scope: 'ip_user',
    store: 'db',
    isEnabled: true,
  },
  {
    name: 'review.create',
    title: 'نوشتنِ دیدگاه',
    hint: 'چند دیدگاه در یک ساعت از یک نشست، بیشترش تبلیغ است نه تجربه‌یِ خرید.',
    maxRequests: 10,
    windowSeconds: 3600,
    scope: 'ip_user',
    store: 'db',
    isEnabled: true,
  },
  {
    name: 'media.upload',
    title: 'بارگذاریِ تصویر',
    hint: 'هر بارگذاری یعنی خواندن، تغییر اندازه و نوشتن روی دیسک — گران‌ترین کارِ پنل.',
    maxRequests: 40,
    windowSeconds: 600,
    scope: 'user',
    store: 'db',
    isEnabled: true,
  },
];

/** واکشیِ قاعده از فهرستی که ممکن است با پایگاه یکی نباشد (تکرارپذیر و امن) */
export function findRule(rules: readonly RateRule[], name: string): RateRule | undefined {
  return rules.find((rule) => rule.name === name);
}

/** ادغامِ قاعده‌هایِ پایگاه با پیش‌فرض‌ها: قاعده‌ای که در پایگاه نیست، پیش‌فرض است */
export function mergeRules(
  stored: readonly RateRule[],
  fallback: readonly RateRule[] = DEFAULT_RULES,
): RateRule[] {
  const byName = new Map<string, RateRule>(fallback.map((rule) => [rule.name, rule]));
  for (const rule of stored) byName.set(rule.name, rule);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * نگاشتِ مسیر → قاعده.
 *
 * چرا با الگو و نه با نامِ مسیر؟ چون مسیرها پارامتر دارند
 * (`/admin/products/:id/images`)؛ اگر کلید را بشود با چند شناسه‌یِ متفاوت
 * ساخت، یک سطل با کلیدِ تازه می‌سازد و سقف عملاً بی‌اثر می‌شود. پس نخست
 * الگوهایِ ویژه (امنیتی) بررسی می‌شوند و بقیه به دو سطلِ کلی می‌افتند.
 */
interface RouteRule {
  rule: string;
  /** اگر تعیین نشود، همه‌یِ فعل‌ها را در بر می‌گیرد */
  method?: string;
  pattern: RegExp;
}

/** مسیرهایی که هرگز مهار نمی‌شوند: سلامت برایِ نگهبان (مانیتورینگ) است */
const NO_LIMIT: readonly RegExp[] = [/^\/health(\/|$)/, /^\/media\//];

const ROUTE_RULES: readonly RouteRule[] = [
  { rule: 'auth.otp', method: 'POST', pattern: /^\/shop\/auth\/otp\// },
  { rule: 'auth.login', method: 'POST', pattern: /^\/auth\/login$/ },
  { rule: 'auth.login', method: 'POST', pattern: /^\/shop\/auth\/password$/ },
  { rule: 'coupon.validate', method: 'POST', pattern: /^\/shop\/coupons\/validate$/ },
  { rule: 'order.create', method: 'POST', pattern: /^\/orders$/ },
  { rule: 'order.create', method: 'POST', pattern: /^\/cart\/[^/]+\/checkout$/ },
  { rule: 'review.create', method: 'POST', pattern: /^\/shop\/reviews$/ },
  { rule: 'media.upload', method: 'POST', pattern: /^\/admin\/products\/[^/]+\/images$/ },
  { rule: 'search', method: 'GET', pattern: /^\/catalog\/search$/ },
];

/**
 * قاعده‌یِ برقرار برایِ یک درخواست.
 *
 * `pattern` باید **الگویِ مسیر** باشد (`/products/:slug`)، نه مسیرِ واقعی
 * (`/products/case-silicon-matte`)؛ وگرنه هر کالا سطلِ خودش را می‌سازد.
 */
export function ruleForRoute(method: string, pattern: string): string | null {
  const path = pattern.split('?')[0] ?? pattern;
  if (NO_LIMIT.some((r) => r.test(path))) return null;
  // بارگذاریِ تصویر استثناست: مسیرش «مدیریتی» است اما مهار می‌شود، چون گران است
  for (const entry of ROUTE_RULES) {
    if (entry.method && entry.method !== method) continue;
    if (entry.pattern.test(path)) return entry.rule;
  }
  if (path.startsWith('/admin/')) return null;
  return method === 'GET' || method === 'HEAD' ? 'public.read' : 'public.write';
}

/** ساختِ کلیدِ سطل بر پایه‌یِ گستره‌یِ قاعده */
export function bucketKey(scope: RateScope, identity: { ip: string; sessionKey?: string }): string {
  const ip = identity.ip || 'ناشناس';
  const session = identity.sessionKey ?? '';
  if (scope === 'ip') return ip;
  if (scope === 'user') return session || ip;
  return `${ip}::${session}`;
}

/** اعتبارسنجیِ مقدارهایِ ویرایش‌شده در پنل — پیش از آنکه به پایگاه برسند */
export function sanitizeRulePatch(patch: {
  maxRequests?: unknown;
  windowSeconds?: unknown;
  scope?: unknown;
  store?: unknown;
  isEnabled?: unknown;
}): {
  maxRequests?: number;
  windowSeconds?: number;
  scope?: RateScope;
  store?: RateStore;
  isEnabled?: boolean;
} {
  const out: {
    maxRequests?: number;
    windowSeconds?: number;
    scope?: RateScope;
    store?: RateStore;
    isEnabled?: boolean;
  } = {};

  if (patch.maxRequests !== undefined) {
    const n = Number(patch.maxRequests);
    // محدوده همان است که پایگاه هم می‌پذیرد؛ اینجا زودتر و با پیامِ روشن رد می‌شود
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
      throw new Error('بیشینه‌یِ درخواست‌ها باید عددی درست میانِ ۱ و یک‌میلیون باشد.');
    }
    out.maxRequests = n;
  }
  if (patch.windowSeconds !== undefined) {
    const n = Number(patch.windowSeconds);
    if (!Number.isInteger(n) || n < 1 || n > 86_400) {
      throw new Error('درازایِ پنجره باید میانِ ۱ ثانیه و یک روز (۸۶۴۰۰ ثانیه) باشد.');
    }
    out.windowSeconds = n;
  }
  if (patch.scope !== undefined) {
    if (patch.scope !== 'ip' && patch.scope !== 'user' && patch.scope !== 'ip_user') {
      throw new Error('گستره باید یکی از این‌ها باشد: ip، user، ip_user.');
    }
    out.scope = patch.scope;
  }
  if (patch.store !== undefined) {
    if (patch.store !== 'memory' && patch.store !== 'db') {
      throw new Error('جایگاهِ شمارنده باید «memory» یا «db» باشد.');
    }
    out.store = patch.store;
  }
  if (patch.isEnabled !== undefined) out.isEnabled = Boolean(patch.isEnabled);
  return out;
}
