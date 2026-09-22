import { createHash } from 'node:crypto';

import type { Database as DbHandle } from '@set/db';
import { purgeExpiredData } from '@set/commerce';

import {
  DbCounterStore,
  MemoryCounterStore,
  RateLimiter,
  mergeRules,
  type RateRule,
  type Queryable,
} from '@set/rate-limit';

/**
 * ساختِ مهارگرِ بار برایِ این فرآیند.
 *
 * سه تصمیمِ مهم در این پرونده:
 *
 *   ۱. **قاعده‌ها از پایگاه می‌آیند، با یک میانگیرِ کوتاه.** مدیر در پنل سقف
 *      را عوض می‌کند و نباید برایِ اثر کردنِ تغییر، سامانه را بازراه‌اندازی
 *      کرد. میانگیرِ ۱۵ ثانیه‌ای یعنی تغییر «حداکثر با یک‌ربع دقیقه تأخیر»
 *      اِعمال می‌شود و در عوض هر درخواست یک پرس‌وجویِ پایگاه کمتر دارد.
 *
 *   ۲. **دو جایگاهِ شمارش.** قاعده‌هایِ پُرفشار در حافظه (بدون کوئری)،
 *      قاعده‌هایِ امنیتی در پایگاه (یکسان در همه‌یِ نمونه‌ها).
 *
 *   ۳. **شکست = عبور.** اگر خواندنِ قاعده‌ها خطا بدهد (پایگاه لحظه‌ای در
 *      دسترس نباشد)، آخرین فهرستِ شناخته‌شده به کار می‌رود و اگر هیچ فهرستی
 *      نباشد، پیش‌فرض‌ها. مهارگر هرگز نباید خودش علتِ بسته شدنِ فروشگاه شود.
 */

/** درازایِ میانگیرِ قاعده‌ها — ۱۵ ثانیه */
const RULES_TTL_MS = 15_000;
/** هر چند وقت یک‌بار سطل‌هایِ کهنه‌یِ پایگاه پاک شوند */
const PRUNE_INTERVAL_MS = 5 * 60_000;


export interface RateLimitBundle {
  limiter: RateLimiter;
  /** واکشیِ قاعده‌ها — پنل از همین استفاده می‌کند */
  rules: () => Promise<RateRule[]>;
  /**
   * باطل کردنِ میانگیرِ قاعده‌ها.
   *
   * چرا لازم است؟ میانگیر یعنی تغییرِ مدیر در پنل تا پانزده ثانیه اِعمال
   * نشود — و پانزده ثانیه برایِ کسی که همین لحظه سقف را کم کرده (چون حمله
   * می‌بیند) یا زیاد کرده (چون مشتری پشتِ سقف مانده) بسیار طولانی است. پس
   * هر تغییر از پنل، میانگیر را باطل می‌کند تا نخستین درخواستِ بعدی قاعده‌یِ
   * تازه را بخواند.
   */
  invalidate: () => void;
  /** بستنِ زمان‌سنجِ پاک‌سازی (برایِ خروجِ ایمن) */
  stop: () => void;
}

/**
 * خواندنِ قاعده‌ها از پایگاه.
 *
 * چرا `updated_at` هم می‌آید؟ تا پنل بتواند بگوید «این سقف را سه‌شنبه
 * مدیرِ شعبه کم کرده است» — بی‌این، تغییرِ سقف بی‌نام می‌ماند و کسی
 * مسئولیتش را نمی‌پذیرد.
 */
async function loadRules(db: Queryable): Promise<RateRule[]> {
  const { rows } = await db.query<{
    name: string;
    title: string;
    hint: string;
    max_requests: number | string;
    window_seconds: number | string;
    scope: RateRule['scope'];
    store: RateRule['store'];
    is_enabled: boolean;
  }>(
    `SELECT name, title, hint, max_requests, window_seconds, scope, store, is_enabled
       FROM rate_limit_rules
      ORDER BY name`,
  );

  return rows.map((row) => ({
    name: row.name,
    title: row.title,
    hint: row.hint,
    maxRequests: Number(row.max_requests),
    windowSeconds: Number(row.window_seconds),
    scope: row.scope,
    store: row.store,
    isEnabled: row.is_enabled === true,
  }));
}

export function createRateLimiter(
  db: Queryable,
  options: { enabledSetting?: () => Promise<boolean | null> } = {},
): RateLimitBundle {
  const memory = new MemoryCounterStore();
  const dbStore = new DbCounterStore(db);

  let cached: RateRule[] | null = null;
  let cachedAt = 0;
  let refreshing: Promise<RateRule[]> | null = null;

  const rules = async (): Promise<RateRule[]> => {
    const now = Date.now();
    if (cached && now - cachedAt < RULES_TTL_MS) return cached;
    // هم‌زمانی: اگر ده درخواست با هم میانگیر را خالی ببینند، یکی پایگاه
    // می‌خواند و بقیه همان وعده را می‌گیرند (وگرنه ده پرس‌وجویِ یکسان می‌رفت)
    if (refreshing) return refreshing;
    refreshing = loadRules(db)
      .then((rows) => {
        cached = rows.length ? mergeRules(rows) : mergeRules([]);
        cachedAt = Date.now();
        return cached;
      })
      .catch(() => cached ?? mergeRules([]))
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  };

  const limiter = new RateLimiter({
    stores: { memory, db: dbStore },
    rules,
    enabled: async () => {
      // کلیدِ اضطراری از تنظیماتِ فروشگاه؛ اگر پایگاه پاسخ ندهد، مهار روشن
      // می‌ماند (حالتِ امن‌تر: بی‌سقف بودن بدتر از خطایِ خواندنِ تنظیم است)
      if (!options.enabledSetting) return true;
      try {
        const value = await options.enabledSetting();
        return value !== false;
      } catch {
        return true;
      }
    },
  });

  // پاک‌سازیِ دوره‌ای: سطل‌هایِ کهنه و ردِّ مسدودشدن‌هایِ قدیمی.
  // `unref` تا این زمان‌سنج مانعِ خروجِ فرآیند نشود.
  const timer = setInterval(() => {
    // مهلتِ نگهداری از یک ثابتِ این فایل به تنظیماتِ پنل منتقل شد. کلیدِ
    // `observability_retention_days` از مهاجرتِ ۰۳۳ در «تنظیمات» نوشته شده
    // بود و توضیحش هم همان‌جا بود، اما هیچ کدی نمی‌خواندش — یعنی مدیر عددی
    // را عوض می‌کرد که اثری نداشت (و این در پنلی که «همه‌چیز از رابطِ مدیریتی»
    // است، از باگِ بدتر است). `purgeExpiredData` همان خانه را جدی می‌گیرد و
    // ضمناً پیامک‌هایِ تمام‌شدهٔ کهنه را هم می‌برد، با قفلِ مشورتی تا اگر
    // کارگرِ پس از فروش هم‌زمان اجرا شد، دو دورِ تکراری نشود.
    void dbStore
      .prune(86_400)
      // تبدیلِ نوع به `Database`: @set/rate-limit یک Queryable «کمینه» دارد
      // (فقط query) و پاک‌سازی به همان یک متد کار دارد — فقط نوع است که
      // نمی‌داند، پس بی‌cast این دو نوعِ ساختاریِ سازگار، همدیگر را رد می‌کنند
      .then(() => purgeExpiredData(db as unknown as DbHandle, { batchLimit: 2_000 }))
      .catch(() => undefined);
  }, PRUNE_INTERVAL_MS);
  timer.unref?.();

  return {
    limiter,
    rules,
    invalidate: () => {
      cached = null;
      cachedAt = 0;
    },
    stop: () => clearInterval(timer),
  };
}

/**
 * خلاصه‌یِ نشست — برایِ این‌که سطلِ درخواست به «نشست» گره بخورد نه به «نشانی».
 *
 * چرا درهم (hash) و نه خودِ توکن؟ چون این مقدار در پایگاه و در لاگ می‌نشیند؛
 * نگه داشتنِ خودِ توکن یعنی هر کسی که به پایگاه دسترسی دارد، می‌تواند نشستِ
 * مدیر را برباید. درهم یک‌سویه است: برایِ شمردن کافی، برایِ جعل ناکافی.
 */
export function sessionKeyOf(headers: {
  authorization?: string | string[];
  cookie?: string | string[];
}): string | undefined {
  const authorization = Array.isArray(headers.authorization)
    ? headers.authorization[0]
    : headers.authorization;
  if (authorization) {
    return createHash('sha256').update(authorization).digest('hex').slice(0, 16);
  }
  const cookie = Array.isArray(headers.cookie) ? headers.cookie[0] : headers.cookie;
  if (cookie) {
    // فقط نام و مقدارِ کوکی‌هایِ نشست — بقیه بی‌ربط‌اند و کلید را بی‌ثبات می‌کنند
    const sessionish = cookie
      .split(';')
      .map((part) => part.trim())
      .filter((part) => /^(set_|sid|session|cart)/i.test(part))
      .join(';');
    if (sessionish) {
      return createHash('sha256').update(sessionish).digest('hex').slice(0, 16);
    }
  }
  return undefined;
}
