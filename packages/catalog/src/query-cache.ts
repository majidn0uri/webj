import type { Database } from '@set/db';

/**
 * کشِ پرسش‌هایِ پُرتکرارِ جستجو — و کم‌کردنِ کارِ زائدِ هر درخواست.
 *
 * ریشهٔ مسئله (اندازه‌گیری‌شده، نه حدس): رویِ کاتالوگِ ۲۰٬۰۰۰ کالایی، یک پرسشِ
 * داغ مثلِ «شارژر» که ۶٬۶۵۱ کالا را می‌تراواند و رتبه می‌دهد، ۸۴ میلی‌ثانیه
 * زمانِ **خودِ سرویس** می‌بَرَد (`tookMs`؛ نه شبکه، نه رندر). خریدارِ واقعی
 * این‌طور جستجو می‌کند: هشتاد درصدِ ترافیک رویِ چند واژهٔ پرتکرار است. پس
 * پرسیدنِ همان پرسش از پایگاه، بارِ بی‌فایده است — دقیقاً همان چیزی که در
 * «سنگین شدنِ سرور زیرِ بار» حس می‌شود.
 *
 * سه چیز در این فایل است و هر سه عمداً بی‌وابستگی‌اند:
 *  • یک TTL/LRU کوچولو (بی‌`lru-cache` — یک وابستگیِ تازه برایِ هشتاد خط کد
 *    ارزش ندارد، و در این پروژه هر وابستگی یعنی یک ریسکِ زنجیرهٔ تأمین)؛
 *  • کشِ میکرو برایِ «آیا این جدول اصلاً وجود دارد؟» — پیش‌تر دو پرسشِ
 *    `information_schema` به‌ازایِ هر جستجو اجرا می‌شد که تنها جوابشان با
 *    مهاجرت عوض می‌شود، نه با هر درخواست؛
 *  • سیاست از پنل (`search_cache_seconds`) با خوانشِ میکرو-کش‌شده، تا فروشنده
 *    بی‌کدنویسی بتواند کش را خاموش/تنظیم کند.
 *
 * چرا کشِ درون‌فرآیندی و نه کشِ بیرونی (ردیس و…)؟ چون سامانه رویِ یک ماشینِ
 * ایرانی و بی‌هر وابستگیِ خارجیِ لازم مستقر می‌شود (محدودیتِ قطعیِ پروژه);
 * و چون اشتباه‌کردنِ کشِ جستجو یعنی «قیمتِ کهنه به مشتری نشان دادن»، نه یعنی
 * خرابیِ داده — پس سقفِ خرابی = TTL، و همان ۱۵ ثانیه است که نکست در رندرِ
 * برگه هم می‌پذیرد (`revalidate = 15`). یعنی این کش **هیچ کهنه‌ای اضافه
 * نمی‌کند**؛ فقط جلویِ تکرارِ کار را می‌گیرد.
 */

/** کلیدِ تنظیم در `store_settings` (کارنامهٔ تنظیمات: گروه «پیشرفته») */
export const SEARCH_CACHE_SETTING_KEY = 'search_cache_seconds';

/** پیش‌فرضِ سیاست — با `fallback`ِ کارنامهٔ تنظیمات یکی نگه داشته می‌شود */
export const SEARCH_CACHE_DEFAULT_SECONDS = 15;

/** سقفِ کلیدها در حافظه — تا کش خودش عاملِ نشتِ حافظه نشود */
export const SEARCH_CACHE_MAX_ENTRIES = 200;

/**
 * فهرست‌هایِ کاتالوگ (درختِ دسته‌ها، برندها، دستگاه‌ها، رنگ‌ها) یک کشِ جدا —
 * با **همان سیاست** (`search_cache_seconds`) و **همان دکمهٔ** خالی‌کردن، اما
 * آمارِ جدا. چرا جدا؟ چون چهار فهرست در **هر** بازدیدِ ویترین خوانده می‌شوند و
 * سهمِ «برخورد»‌شان در آمارِ جستجو، سودِ خودِ کشِ جستجو را بی‌شکل می‌کرد:
 * فروشنده `cacheRate`ی نزدیکِ صد می‌دید و نمی‌دانست برایِ چه.
 */
export const LIST_CACHE_MAX_ENTRIES = 64;

/** پاسخِ هر چند میلی‌ثانیه یک «بیش از این» بزرگ‌تر از این است؟ برایِ حذفِ نتیجهٔ گنده */
export const SEARCH_CACHE_MAX_ITEM_BYTES = 512 * 1024;

/** چقدر «آیا جدول هست؟» و «سیاست چند است؟» را میکرو-کش کنیم (میلی‌ثانیه) */
const MICRO_TTL_MS = 5_000;

export interface SearchCachePolicy {
  /** عمرِ پاسخ (میلی‌ثانیه). `0` یعنی کش خاموش */
  ttlMs: number;
  maxEntries: number;
}

export interface SearchCacheStats {
  enabled: boolean;
  ttlMs: number;
  entries: number;
  hits: number;
  misses: number;
  /** چندان بزرگ بودند که نگه داشته نشوند */
  skippedBig: number;
  /** به‌دلیلِ پرشدنِ LRU بیرون رفتند */
  evictions: number;
  /** پاسخ‌هایِ کش‌شده‌ای که به‌دلیلِ سیاستِ تازه‌خوانده‌شده بازنشسته شدند */
  staleAfterPolicyChange: number;
  /** چند بار دستی خالی شد (دکمهٔ پنل، یا نوشتنِ مترادف) */
  cleared: number;
}

/** آمارِ کشِ فهرست‌ها — شکلش با آمارِ جستجو یکی است تا پنل یک قالبِ واحد داشته باشد */
export interface ListCacheStats {
  enabled: boolean;
  ttlMs: number;
  entries: number;
  hits: number;
  misses: number;
  /** چندان بزرگ بودند که نگه داشته نشوند */
  skippedBig: number;
  /** به‌دلیلِ پرشدنِ LRU بیرون رفتند */
  evictions: number;
  /** چند بار (با نوشتنِ دسته/دستگاه یا دکمهٔ پنل) خالی شد */
  cleared: number;
}

interface Entry {
  value: unknown;
  bytes: number;
  at: number;
}

type KeyedDb = Database | (import('@set/db').Queryable & object);

const caches = new WeakMap<object, Map<string, Entry>>();
const stats = new WeakMap<object, SearchCacheStats>();
const listCaches = new WeakMap<object, Map<string, Entry>>();
const listStats = new WeakMap<object, ListCacheStats>();
const micro = new WeakMap<object, Map<string, { value: unknown; at: number }>>();
/** شمارندهٔ «نسْلِ» کش: هر پاک‌سازی، نسل را بالا می‌برد و پاسخ‌هایِ نسلِ پیشین را بی‌اعتبار می‌کند */
const generation = new WeakMap<object, number>();

function cacheFor(db: object): Map<string, Entry> {
  let map = caches.get(db);
  if (!map) {
    map = new Map<string, Entry>();
    caches.set(db, map);
  }
  return map;
}

function statsFor(db: object): SearchCacheStats {
  let s = stats.get(db);
  if (!s) {
    s = {
      enabled: true,
      ttlMs: SEARCH_CACHE_DEFAULT_SECONDS * 1000,
      entries: 0,
      hits: 0,
      misses: 0,
      skippedBig: 0,
      evictions: 0,
      staleAfterPolicyChange: 0,
      cleared: 0,
    };
    stats.set(db, s);
  }
  return s;
}

function microFor(db: object): Map<string, { value: unknown; at: number }> {
  let map = micro.get(db);
  if (!map) {
    map = new Map<string, { value: unknown; at: number }>();
    micro.set(db, map);
  }
  return map;
}

function listCacheFor(db: object): Map<string, Entry> {
  let map = listCaches.get(db);
  if (!map) {
    map = new Map<string, Entry>();
    listCaches.set(db, map);
  }
  return map;
}

function listStatsFor(db: object): ListCacheStats {
  let s = listStats.get(db);
  if (!s) {
    s = {
      enabled: true,
      ttlMs: SEARCH_CACHE_DEFAULT_SECONDS * 1000,
      entries: 0,
      hits: 0,
      misses: 0,
      skippedBig: 0,
      evictions: 0,
      cleared: 0,
    };
    listStats.set(db, s);
  }
  return s;
}

/**
 * «کشِ جستجو را خالی کن» بی‌سوزاندنِ شمارنده‌ها — همان چیزی که دکمهٔ پنل و هر
 * نوشتنِ مترادف لازم دارند. اگر آمار را هم صفر کنیم، «چرا hits ناگهان افتاد؟»
 * بی‌جواب می‌ماند و داوریِ سودِ کش در آن لحظه ناممکن.
 */
export function clearSearchCache(db: object): void {
  cacheFor(db).clear();
  // «کشِ خوانش‌ها» یک کلّه است: هر نوشتنی که نتایجِ جستجو را عوض کند، شمارِ
  // برندها/دسته‌ها/رنگ‌ها را هم عوض کرده (کالا رفت، برندِ آخرش شد صفر). پس
  // دکمهٔ «خالی‌کردنِ کش» و هر نوشتنِ کالا، هر دو کش را با هم خالی می‌کنند؛
  // کشِ فهرستِ جدا، جدا نمی‌ماند.
  listCacheFor(db).clear();
  // عددِ «عمرِ کش» از پنل تغییر می‌کند و پنل همین دکمه را هم دارد؛ اگر
  // سیاستِ خوانده‌شده (۵ ثانیه میکرو-کش است) دست‌نخورده بماند، فروشنده
  // «۰» می‌گذارد و کش می‌رود، ولی سرویس تا پنج ثانیه همان ۱۵ را می‌بیند.
  microFor(db).clear();
  generation.set(db, (generation.get(db) ?? 0) + 1);
  statsFor(db).cleared += 1;
  statsFor(db).entries = 0;
  listStatsFor(db).entries = 0;
}

/**
 * خالی‌کردنِ **فقط** کشِ فهرست‌ها — برایِ نوشتنی که فهرست را عوض می‌کند اما
 * نتایجِ جستجو را نه (مثلاً افزودنِ یک مدلِ گوشی به انتخابگر). بی‌این، باید
 * کلّ کشِ جستجو را هم می‌ریختیم که بی‌جایی است.
 */
export function clearListCache(db: object): void {
  listCacheFor(db).clear();
  generation.set(db, (generation.get(db) ?? 0) + 1);
  listStatsFor(db).cleared += 1;
  listStatsFor(db).entries = 0;
}

/**
 * برایِ آزمون و برایِ دکمهٔ «کش را خالی کن»: همه‌چیزِ مربوطِ **این اتصال**
 * فراموش می‌شود. (`WeakMap` شمارشی نیست، پس «پاک‌کردنِ همه» معنا ندارد — و
 * درست‌تر هم همین است: هر استخرِ اتصال، کشِ خودش را دارد.)
 */
export function resetQueryCaches(db: object): void {
  cacheFor(db).clear();
  listCacheFor(db).clear();
  microFor(db).clear();
  const s = statsFor(db);
  s.entries = 0;
  s.hits = 0;
  s.misses = 0;
  s.skippedBig = 0;
  s.evictions = 0;
  const ls = listStatsFor(db);
  ls.entries = 0;
  ls.hits = 0;
  ls.misses = 0;
  ls.skippedBig = 0;
  ls.evictions = 0;
  generation.set(db, (generation.get(db) ?? 0) + 1);
}

/**
 * یک پرسشِ کوچکِ یک‌ستونه رویِ `information_schema`، میکرو-کش‌شده.
 *
 * چرا کش می‌شود و نه «یک‌بار در زمانِ بالاآمدن»؟ چون در آزمون‌ها و در استقرار،
 * مهاجرت‌ها می‌توانند پس ازِ نخستین درخواست اجرا شوند؛ پاسخِ «نیست» باید عمرِ
 * کوتاه داشته باشد تا پریدنِ میزِ تازه را ببیند.
 */
export async function hasRelation(db: KeyedDb, name: string): Promise<boolean> {
  const map = microFor(db as object);
  const key = `relation:${name}`;
  const hit = map.get(key);
  const now = Date.now();
  if (hit && now - hit.at < MICRO_TTL_MS) return hit.value === true;
  const { rows } = await db
    .query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM information_schema.tables WHERE table_name = $1`,
      [name],
    )
    .catch(() => ({ rows: [{ n: '0' }] }));
  const value = Number(rows[0]?.n ?? '0') > 0;
  map.set(key, { value, at: now });
  return value;
}

/**
 * سیاستِ کش از پنل، با میکرو-کش.
 *
 * `0` یعنی خاموش (فروشنده‌ای که می‌خواهد قیمتِ تازه را همان لحظه ببیند)، و
 * عددِ بیرون از بازه کوتاه می‌شود — نه نادیده گرفته. بی‌میکرو-کش، «کش خاموش»
 * یعنی هر درخواست یک خواندنِ تنظیمات؛ که خودش هزینه است.
 */
export async function searchCachePolicy(db: KeyedDb): Promise<SearchCachePolicy> {
  const map = microFor(db as object);
  const now = Date.now();
  const hit = map.get(`policy`);
  if (hit && now - hit.at < MICRO_TTL_MS) return hit.value as SearchCachePolicy;
  let seconds = SEARCH_CACHE_DEFAULT_SECONDS;
  const { rows } = await db
    .query<{ value: string | null }>(
      `SELECT value FROM store_settings WHERE key = $1`,
      [SEARCH_CACHE_SETTING_KEY],
    )
    .catch(() => ({ rows: [] as { value: string | null }[] }));
  const raw = rows[0]?.value;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const parsed = Number(String(raw).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))));
    if (Number.isFinite(parsed)) seconds = Math.max(0, Math.min(3600, Math.floor(parsed)));
  }
  const policy: SearchCachePolicy = { ttlMs: seconds * 1000, maxEntries: SEARCH_CACHE_MAX_ENTRIES };
  const s = statsFor(db as object);
  const wasEnabled = s.enabled;
  s.enabled = policy.ttlMs > 0;
  s.ttlMs = policy.ttlMs;
  // فهرست‌ها با **همان** سیاست نفس می‌کشند؛ اگر روشن ← خاموش شود، پاسخ‌هایِ
  // کهنهٔ آن‌ها هم باید همان لحظه بروند (وگرنه فروشنده «کش را خاموش کردم ولی
  // فهرستِ دیروز می‌آید» می‌گوید).
  const ls = listStatsFor(db as object);
  ls.enabled = policy.ttlMs > 0;
  ls.ttlMs = policy.ttlMs;
  if (wasEnabled && !s.enabled) {
    // سیاست تازه گفت «خاموش» — پاسخ‌هایِ مانده باید بی‌اعتبار شوند، وگرنه
    // «خاموش کردم ولی همان قیمتِ دیروز می‌آید» دقیقاً همان چیزی است که
    // فروشنده به‌عنوانِ باگ گزارش می‌کند.
    cacheFor(db as object).clear();
    listCacheFor(db as object).clear();
    s.staleAfterPolicyChange += 1;
  }
  map.set('policy', { value: policy, at: now });
  return policy;
}

/**
 * کلیدِ پرسش. عمداً رشته‌سازِ ساده، نه `JSON.stringify(opts)`:
 * ترتیبِ فیلدها در شیء نباید کلید را عوض کند (باگِ «کش خورد» وقتی همان
 * پرسش از مسیرِ دیگری با ترتیبِ دیگری ساخته می‌شود)، و `null` با «نبود»
 * یکی حساب می‌شود، چون در پرس‌وجو همان معنا را دارند.
 */
export function searchCacheKey(opts: Record<string, unknown>): string {
  const norm = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(norm).sort().join(',');
    return String(v);
  };
  const parts = Object.keys(opts)
    .sort()
    .map((k) => `${k}=${norm(opts[k])}`);
  return parts.join('&');
}

/**
 * «این را در کش بگذار». خروجیِ `false` یعنی نگه داشته نشد (خاموش بودنِ سیاست
 * یا بزرگ‌بودنِ پاسخ) — و این‌ها با شمارنده‌ها دیده می‌شوند، نه بی‌صدا.
 */
export function cachePut(db: object, key: string, value: unknown, policy: SearchCachePolicy): boolean {
  const s = statsFor(db);
  if (policy.ttlMs <= 0) return false;
  const bytes = estimateBytes(value);
  if (bytes > SEARCH_CACHE_MAX_ITEM_BYTES) {
    s.skippedBig += 1;
    return false;
  }
  const map = cacheFor(db);
  map.delete(key);
  map.set(key, { value, bytes, at: Date.now() });
  while (map.size > policy.maxEntries) {
    const oldest = map.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
    s.evictions += 1;
  }
  s.entries = map.size;
  return true;
}

/** `false` یعنی «بپرس»; اگر چیزی برگشت، `hit` است (و بی‌اعتبارشماریِ TTL هم همین‌جا) */
export function cacheGet(db: object, key: string, policy: SearchCachePolicy): { hit: true; value: unknown } | { hit: false } {
  const s = statsFor(db);
  if (policy.ttlMs <= 0) return { hit: false };
  const map = cacheFor(db);
  const entry = map.get(key);
  if (!entry) {
    s.misses += 1;
    return { hit: false };
  }
  if (Date.now() - entry.at >= policy.ttlMs) {
    map.delete(key);
    s.entries = map.size;
    s.misses += 1;
    return { hit: false };
  }
  // LRU: همان‌چه تازه خوانده شد، دیرتر بیرون می‌رود
  map.delete(key);
  map.set(key, entry);
  s.hits += 1;
  return { hit: true, value: entry.value };
}

export function queryCacheStats(db: object): SearchCacheStats {
  return { ...statsFor(db), entries: cacheFor(db).size };
}

export function listCacheStats(db: object): ListCacheStats {
  return { ...listStatsFor(db), entries: listCacheFor(db).size };
}

/**
 * «این فهرست را از کش بخوان، وگرنه بساز». خروجی هم‌زمان سه چیز است:
 *  • `items` — خودِ داده (کهنگه یا تازه، برایِ مصرف‌کننده فرق نمی‌کند)؛
 *  • `cached` — آیا این بار از کش آمد؛ و
 *  • `cacheAgeMs` — اگر از کش آمد، چند میلی‌ثانیه از ساختِ پاسخ گذشته.
 *
 * چرا سه تکه در یک شیء؟ چون مسیرِ «از کش آمد» **نیاز بهِ هیچ پرس‌وجویی ندارد**
 * (نه پایگاه، نه «بپرس فقط اگر کهنه شد»). پس مصرف‌کننده باید بتواند بدونِ هیچ
 * بارِ جانبی بگوید «این پاسخ از کش آمد و چند ثانیهٔ عمر دارد». این همان
 * قرارداد `search()` است که برایِ فهرست‌ها تکرار شده — تا رفتارِ دو مسیر
 * یکی باشد و فروشنده فقط یک مفهومِ «کشِ خوانش» در سر داشته باشد.
 *
 * کلید را **مصرف‌کننده** می‌سازد (با `searchCacheKey` رویِ گزینه‌هایش)، نه این
 * تابع: چون فقط مصرف‌کننده می‌داند کدام گزینه‌ها نتیجه را عوض می‌کنند.
 */
export async function cachedList<T>(
  db: KeyedDb,
  key: string,
  compute: () => Promise<T>,
): Promise<{ items: T; cached: boolean; cacheAgeMs: number }> {
  const policy: SearchCachePolicy = await searchCachePolicy(db);
  const s = listStatsFor(db as object);
  s.enabled = policy.ttlMs > 0;
  s.ttlMs = policy.ttlMs;

  if (policy.ttlMs > 0) {
    const map = listCacheFor(db as object);
    const entry = map.get(key);
    if (entry) {
      if (Date.now() - entry.at < policy.ttlMs) {
        // LRU: تازه خوانده شد، دیرتر بیرون می‌رود
        map.delete(key);
        map.set(key, entry);
        s.hits += 1;
        s.entries = map.size;
        return { items: entry.value as T, cached: true, cacheAgeMs: Math.max(0, Date.now() - entry.at) };
      }
      map.delete(key);
      s.entries = map.size;
    }
  }
  s.misses += 1;

  const value = await compute();

  if (policy.ttlMs > 0) {
    const bytes = estimateBytes(value);
    if (bytes <= SEARCH_CACHE_MAX_ITEM_BYTES) {
      const map = listCacheFor(db as object);
      map.delete(key);
      map.set(key, { value, bytes, at: Date.now() });
      // فهرست‌ها دستِ آخر چهار تا هستند؛ سقفِ جدا، چون ۲۰۰ کلیدِ جستجو را
      // نباید یک درختِ بزرگِ دسته‌ها از آن بگیرد.
      const cap = Math.min(policy.maxEntries, LIST_CACHE_MAX_ENTRIES);
      while (map.size > cap) {
        const oldest = map.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        map.delete(oldest);
        s.evictions += 1;
      }
      s.entries = map.size;
    } else {
      s.skippedBig += 1;
    }
  }

  return { items: value, cached: false, cacheAgeMs: 0 };
}

/**
 * یک پرسشِ ارزیدۀ «بپرس فقط اگر کهنه شد» — همان چیزی که هر سرویسِ داغ به آن
 * نیاز دارد (فرهنگِ مترادف، فهرستِ ستون‌ها، و…). عمرِ کوتاه یعنی «فروشنده چیزی
 * را عوض کرد و تا چند ثانیه دیگر اثرش دیده می‌شود»، نه «باید سرور را خلاص کن».
 */
export async function cachedProbe<T>(
  db: KeyedDb,
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<T> {
  const map = microFor(db as object);
  const now = Date.now();
  const hit = map.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as T;
  const value = await compute();
  map.set(key, { value, at: Date.now() });
  return value;
}

/** بی‌اعتبارکردنِ آگاهانه: هر نوشتنی که نتیجهٔ یک پرسشِ کش‌شده را عوض می‌کند */
export function invalidateProbe(db: object, key?: string): void {
  const map = microFor(db);
  if (key === undefined) map.clear();
  else map.delete(key);
}

/** برآوردِ اندازه — بی‌`JSON.stringify`ِ کاملِ پاسخ در مسیرِ داغ */
function estimateBytes(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (value === null || value === undefined) return 4;
  if (typeof value === 'number' || typeof value === 'boolean') return 8;
  if (Array.isArray(value)) return value.reduce((sum, v) => sum + estimateBytes(v) + 2, 2);
  if (typeof value === 'object') {
    let sum = 2;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) sum += k.length + estimateBytes(v) + 4;
    return sum;
  }
  return 16;
}
