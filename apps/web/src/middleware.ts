import { NextResponse, type NextRequest } from 'next/server';

/**
 * تازه‌سازیِ بی‌صدایِ نشستِ پنل.
 *
 * چرا اینجا و نه در صفحه‌ها؟
 *   ۱) کامپوننتِ سروری نمی‌تواند کوکی بنویسد؛ بنابراین تازه‌سازی درونِ صفحه
 *      از نظرِ فنی ناممکن است.
 *   ۲) این کار به *هر* مسیر مربوط است، نه به یک صفحه؛ تکرارش در هفت صفحه
 *      یعنی هفت جا برای اشتباه.
 *
 * رفتار:
 *   • نشستِ سالم ← عبورِ بی‌هزینه (بدون تماس با API)؛
 *   • توکنِ دسترسی نزدیکِ انقضا (کمتر از ۲ دقیقه مانده) ← تازه‌سازی،
 *     نوشتنِ کوکی‌هایِ تازه در پاسخ *و* در درخواستِ جاری تا همان رندرِ اول
 *     هم با توکنِ تازه کار کند؛
 *   • تازه‌سازی ناموفق یا نبودِ توکنِ تازه‌سازی ← بازگشت به ورود، با یادآوریِ
 *     مقصد (‎?next=‎) تا کاربر پس از ورود به همان صفحه برود، نه به پیشخوان.
 */

const API_ORIGIN = process.env.API_BASE ?? 'http://127.0.0.1:3000';
const SESSION_COOKIE = 'set_admin_token';
const REFRESH_COOKIE = 'set_admin_refresh';

/** اگر کمتر از این مقدار تا انقضا مانده باشد، توکن پیشاپیش تازه می‌شود */
const REFRESH_BEFORE_SECONDS = 120;

export const config = {
  // چرا «/api/admin/:path*» هم اینجاست؟ چون این نشانی‌ها در عمل به سرویسِ
  // API بازنویسی می‌شوند (بازنویسیِ سراسری در next.config)، و API توکن را
  // از سربرگ می‌خواند نه از کوکی. پس باید پیش از بازنویسی، توکنِ نشست را از
  // کوکیِ httpOnly برداریم و به سربرگ بچسبانیم — کاری که فقط میان‌افزار
  // می‌تواند بکند (مؤلفه‌یِ سروری حقِ نوشتنِ سربرگِ درخواست را ندارد).
  matcher: ['/admin', '/admin/:path*', '/api/admin/:path*'],
};

interface TokenPair {
  accessToken?: string;
  refreshToken?: string;
}

/** زمانِ انقضایِ توکن — بدونِ نیاز به کتاب‌خانه، فقط خواندنِ بخشِ میانی */
function accessTokenExpiry(token: string | null | undefined): number | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** مقدارِ یک کوکی را در رشته‌یِ هدرِ cookie جایگزین می‌کند (برایِ درخواستِ جاری) */
function withCookies(header: string | null, updates: Record<string, string>): string {
  const kept = (header ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .filter((part) => !Object.keys(updates).some((name) => part.startsWith(`${name}=`)));

  for (const [name, value] of Object.entries(updates)) kept.push(`${name}=${value}`);
  return kept.join('; ');
}

function cookieInit(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 8,
    secure,
  };
}

function toLogin(req: NextRequest, where: string): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = '/admin/login';
  url.search = '';
  // مقصد را به خاطر می‌سپاریم: «می‌خواستم بروم صندوق» نباید با ورود فراموش شود
  url.searchParams.set('next', where);

  const res = NextResponse.redirect(url);
  // نشستِ مرده را همان‌جا پاک می‌کنیم تا حلقه‌یِ رِفرِش ساخته نشود
  if (req.cookies.has(SESSION_COOKIE) || req.cookies.has(REFRESH_COOKIE)) {
    res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
    res.cookies.set(REFRESH_COOKIE, '', { path: '/', maxAge: 0 });
  }
  return res;
}

/**
 * یک‌بار تازه‌سازی برایِ «یک» توکنِ تازه‌سازی.
 *
 * چرا حافظه‌ی کوتاه‌مدت؟ چون مرورگر چند برگه دارد و نکست پیوندها را
 * پیش‌بارگیری می‌کند: چند درخواست می‌توانند همزمان با یک توکنِ تازه‌سازی برسند.
 * اگر هر کدام جداگانه چرخش بخواهند، نخستی زنجیره را می‌چرخاند و بقیه — که هنوز
 * همان توکنِ قدیمی را دارند — یا خطا می‌گیرند یا زنجیره را بی‌دلیل می‌سوزانند.
 * اینجا دو لایه داریم:
 *   • ادغامِ درخواست‌هایِ همزمان (inflight): یک فراخوانی برایِ یک توکن؛
 *   • یادداشتِ کوتاه (recent): پاسخِ موفق تا ۶۰ ثانیه برایِ همان توکنِ قدیمی
 *     بازگردانده می‌شود — هماهنگ با پنجره‌ی ارفاقِ سرویسِ احرازِ هویت.
 *
 * حافظه در حدِ چند رکورد و محدود به یک فرآیند است؛ اگر چند نمونه از وب اجرا
 * شود، پنجره‌ی ارفاقِ سمتِ سرورِ API جلویِ بیرون‌انداختنِ کاربر را می‌گیرد.
 */
const RECENT_TTL_MS = 60_000;
const RECENT_MAX = 200;
const inflight = new Map<string, Promise<RefreshOutcome>>();
const recent = new Map<string, { pair: TokenPair; at: number }>();

function forgetOld(): void {
  const now = Date.now();
  for (const [key, value] of recent) {
    if (now - value.at > RECENT_TTL_MS) recent.delete(key);
  }
  if (recent.size > RECENT_MAX) {
    const oldestFirst = [...recent.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [key] of oldestFirst.slice(0, oldestFirst.length - RECENT_MAX)) recent.delete(key);
  }
}

type RefreshOutcome =
  | { status: 'ok'; pair: TokenPair }
  | { status: 'offline' }
  | { status: 'rejected' };

async function refreshOnce(refreshToken: string): Promise<RefreshOutcome> {
  forgetOld();

  const remembered = recent.get(refreshToken);
  if (remembered && Date.now() - remembered.at <= RECENT_TTL_MS) {
    return { status: 'ok', pair: remembered.pair };
  }

  const pending = inflight.get(refreshToken);
  if (pending) return pending;

  const task = (async (): Promise<RefreshOutcome> => {
    try {
      const res = await fetch(`${API_ORIGIN}/auth/refresh`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      // ۴۰۱/۴۰۳ یعنی خودِ سامانه گفته «این توکن مرده است»؛
      // ۵xx یا خطایِ شبکه یعنی سامانه پاسخ نمی‌دهد — و این با «نشست تمام شده»
      // یکی نیست: نباید کاربر را با پیامِ انقضا گیج کرد و کوکی‌اش را پاک کرد.
      if (res.status === 401 || res.status === 403) return { status: 'rejected' };
      if (!res.ok) return { status: 'offline' };

      const data = (await res.json()) as TokenPair;
      if (!data?.accessToken || !data?.refreshToken) return { status: 'rejected' };

      recent.set(refreshToken, { pair: data, at: Date.now() });
      return { status: 'ok', pair: data };
    } catch {
      return { status: 'offline' };
    } finally {
      inflight.delete(refreshToken);
    }
  })();

  inflight.set(refreshToken, task);
  return task;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl;

  /**
   * مسیرهایِ داده‌ایِ پنل (خروجیِ اکسل/پی‌دی‌اف، دریافتِ پرونده و مانندِ آن).
   *
   * این مسیرها «صفحه» نیستند: قرار است یک پرونده به مرورگر برگردانند، نه یک
   * برگه‌یِ اچ‌تی‌ام‌ال. پس اگر نشست مرده باشد، نباید به صفحه‌یِ ورود
   * «تغییرمسیر» شویم — مرورگر که دارد فایل می‌گیرد، یک برگه‌یِ ورود را درون
   * همان فایل می‌نویسد و کاربر پرونده‌ای خراب با نامِ درست تحویل می‌گیرد.
   * اینجا پاسخِ خطا درست است و بس.
   *
   * و چرا توکن را همین‌جا تازه می‌کنیم؟ چون کاربر ممکن است نشستش درست در
   * لحظه‌ای رو به انقضا باشد که رویِ «دریافتِ اکسل» کلیک کرده؛ اگر تازه‌سازی
   * را به برگه‌یِ بعدی بسپاریم، همان یک کلیک با خطایِ ۴۰۱ شکست می‌خورد.
   */
  if (pathname.startsWith('/api/admin/')) {
    let bearer = req.cookies.get(SESSION_COOKIE)?.value ?? null;
    const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value ?? null;
    const expiresAt = accessTokenExpiry(bearer);
    const nowSeconds = Math.floor(Date.now() / 1000);
    let renewed: TokenPair | null = null;

    if ((expiresAt === null || expiresAt - nowSeconds <= REFRESH_BEFORE_SECONDS) && refreshToken) {
      const outcome = await refreshOnce(refreshToken);
      if (outcome.status === 'ok' && outcome.pair.accessToken) {
        renewed = outcome.pair;
        bearer = outcome.pair.accessToken;
      }
    }

    if (!bearer) {
      return NextResponse.json(
        { error: { code: 'ERR-401', message: 'نشست تمام شده است؛ دوباره وارد شوید.' } },
        { status: 401 },
      );
    }

    const headers = new Headers(req.headers);
    headers.set('authorization', `Bearer ${bearer}`);
    const res = NextResponse.next({ request: { headers } });
    const secure = (req.headers.get('x-forwarded-proto') ?? '').split(',')[0]?.trim() === 'https';
    if (renewed?.accessToken && renewed?.refreshToken) {
      res.cookies.set(SESSION_COOKIE, renewed.accessToken, cookieInit(secure));
      res.cookies.set(REFRESH_COOKIE, renewed.refreshToken, cookieInit(secure));
    }
    return res;
  }

  // نشانیِ مسیر را به درخواست می‌چسبانیم. چرا؟ چون چیدمانِ ریشه (یک مؤلفه‌ی
  // سروری) نمی‌تواند مسیر را بخواند، و بی‌آن نمی‌فهمد در پنل است یا فروشگاه؛
  // نتیجه این بود که هدر، فوتر و نوارِ تبِ فروشگاه بالا و پایینِ پنلِ مدیریت
  // هم رندر می‌شدند و هر صفحه‌یِ مدیریت یک درخواستِ بی‌فایده‌یِ «حسابِ مشتری»
  // می‌فرستاد (که در پنل همیشه ۴۰۱ می‌گرفت).
  const withPath = (headers?: Headers): Headers => {
    const next = new Headers(headers ?? req.headers);
    next.set('x-pathname', pathname);
    return next;
  };

  // صفحه‌یِ ورود خودش نباید محافظت شود — وگرنه حلقه می‌سازد
  if (pathname === '/admin/login') return NextResponse.next({ request: { headers: withPath() } });

  const access = req.cookies.get(SESSION_COOKIE)?.value ?? null;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value ?? null;
  const where = `${pathname}${search}`;

  const exp = accessTokenExpiry(access);
  const now = Math.floor(Date.now() / 1000);
  if (exp !== null && exp - now > REFRESH_BEFORE_SECONDS)
    return NextResponse.next({ request: { headers: withPath() } });

  if (!refresh) return toLogin(req, where);


  const outcome = await refreshOnce(refresh);

  // سامانه در دسترس نیست: نشست را نمی‌کشیم و کاربر را به ورود نمی‌فرستیم؛
  // فقط به صفحه می‌گوییم «پاسخی از سامانه نیامد» تا پیام درست نشان داده شود.
  if (outcome.status === 'offline') {
    const offlineHeaders = new Headers(req.headers);
    offlineHeaders.set('x-set-api-down', '1');
    return NextResponse.next({ request: { headers: withPath(offlineHeaders) } });
  }

  if (outcome.status === 'rejected') return toLogin(req, where);

  const data = outcome.pair;
  if (!data.accessToken || !data.refreshToken) return toLogin(req, where);

  const secure = (req.headers.get('x-forwarded-proto') ?? '').split(',')[0]?.trim() === 'https';

  // ۱) کوکی برای مرورگر
  const res = NextResponse.next({
    request: {
      // ۲) کوکی برای همین درخواست — تا رندرِ جاری هم توکنِ تازه را ببیند
      headers: withPath(
        new Headers({
          ...Object.fromEntries(req.headers),
          cookie: withCookies(req.headers.get('cookie'), {
            [SESSION_COOKIE]: data.accessToken,
            [REFRESH_COOKIE]: data.refreshToken,
          }),
        }),
      ),
    },
  });

  res.cookies.set(SESSION_COOKIE, data.accessToken, cookieInit(secure));
  res.cookies.set(REFRESH_COOKIE, data.refreshToken, cookieInit(secure));
  return res;
}
