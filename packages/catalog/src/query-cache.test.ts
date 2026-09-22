import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { createDatabase, applyMigrations, seedCatalog, type Database, type Queryable } from '@set/db';

import { CatalogService } from './index.js';

import {
  SEARCH_CACHE_DEFAULT_SECONDS,
  SEARCH_CACHE_MAX_ENTRIES,
  cachedList,
  cachedProbe,
  cacheGet,
  cachePut,
  clearListCache,
  clearSearchCache,
  hasRelation,
  invalidateProbe,
  listCacheStats,
  queryCacheStats,
  resetQueryCaches,
  searchCacheKey,
  searchCachePolicy,
} from './query-cache.js';

import { CategoryService } from './categories.js';
import { CompatibilityService } from './compatibility.js';

/**
 * سنجشِ «کشِ پرسش» — و این‌که چه چیزی را **نباید** بکشیم.
 *
 * سه چیز در این فایل اهمیت دارد، چون همان سه‌تا چیزهایی‌اند که در تولید دردسر
 * می‌سازند: کلیدِ کش (اگر بی‌ثبات باشد، کش هیچ‌وقت نمی‌خورد و همه فکر می‌کنند
 * «بی‌فایده است»)، عمرِ کش (اگر بی‌اعتبارشدنِ دستی نباشد، فروشنده نتیجهٔ کهنه
 * می‌بیند)، و شمارنده‌ها (بی‌آن‌ها نمی‌شود فهمید سود داده یا نه).
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * پایگاهِ ساختگی: فقط `.query` لازم است، و **شمارشِ فراخوانی‌ها خودِ سنجه است** —
 * «یک بار پرسید» را نمی‌شود با نگاه‌کردن به نتیجه ثابت کرد.
 */
function liveDb(initial?: string) {
  const state = { setting: initial };
  const sqls: string[] = [];
  const db = {
    async query(sql: string) {
      sqls.push(sql);
      if (sql.includes('store_settings')) {
        return { rows: state.setting === undefined ? [] : [{ value: state.setting }] };
      }
      return { rows: [{ n: '1' }] };
    },
  } as unknown as Queryable & object;
  return { db, sqls, set: (value: string) => (state.setting = value) };
}

const stubDb = (setting?: string) => {
  const live = liveDb(setting);
  return { db: live.db, sqls: live.sqls };
};

describe('کلیدِ کشِ پرسش', () => {
  it('ترتیبِ فیلدها و «تهی بودن» کلید را عوض نمی‌کند', () => {
    const a = searchCacheKey({ query: 'شارژر', limit: 24, brandSlug: null });
    const b = searchCacheKey({ limit: 24, brandSlug: undefined, query: 'شارژر' });
    expect(a).toBe(b);
  });

  it('هر فیلتر، کلید را عوض می‌کند — «فیلتر زدم و همان نتیجهٔ قبلی آمد» ممکن نیست', () => {
    const base = searchCacheKey({ query: 'شارژر', limit: 24 });
    expect(searchCacheKey({ query: 'شارژر', limit: 24, brandSlug: 'apple' })).not.toBe(base);
    expect(searchCacheKey({ query: 'شارژر', limit: 12 })).not.toBe(base);
    expect(searchCacheKey({ query: 'شارژر', limit: 24, offset: 24 })).not.toBe(base);
    expect(searchCacheKey({ query: 'شارژر', limit: 24, onlyAvailable: true })).not.toBe(base);
  });

  it('ترتیبِ رنگ‌ها کلید را عوض نمی‌کند (مجموعه، نه فهرست است)', () => {
    expect(searchCacheKey({ colours: ['قرمز', 'آبی'] })).toBe(searchCacheKey({ colours: ['آبی', 'قرمز'] }));
  });
});

describe('گذاشتن و گرفتن', () => {
  it('پس ازِ عمر، پاسخ بی‌اعتبار است — «همیشه» در کش معنایش فاجعه است', async () => {
    const { db } = stubDb();
    const policy = { ttlMs: 5, maxEntries: 10 };
    expect(cachePut(db, 'k', { total: 3 }, policy)).toBe(true);
    expect(cacheGet(db, 'k', policy).hit).toBe(true);
    await sleep(9);
    expect(cacheGet(db, 'k', policy).hit).toBe(false);
  });

  it('سیاستِ صفر هیچ چیزی نمی‌گذارد و هیچ چیزی نمی‌گیرد', () => {
    const { db } = stubDb();
    const off = { ttlMs: 0, maxEntries: 10 };
    expect(cachePut(db, 'k', { total: 1 }, off)).toBe(false);
    expect(cacheGet(db, 'k', off)).toEqual({ hit: false });
  });

  it('پاسخِ گنده نگه داشته می‌شود نه؛ و بی‌صدا نمی‌ماند', () => {
    const { db } = stubDb();
    const policy = { ttlMs: 60_000, maxEntries: 10 };
    const huge = { items: Array.from({ length: 40_000 }, () => 'x'.repeat(20)) };
    expect(cachePut(db, 'big', huge, policy)).toBe(false);
    expect(queryCacheStats(db).skippedBig).toBe(1);
    expect(cachePut(db, 'small', { items: [1, 2, 3] }, policy)).toBe(true);
  });

  it('سقفِ کلیدها حفظ می‌شود و بیرون‌رفتن شمرده می‌شود (LRU، نه FIFO بی‌رحم)', () => {
    const { db } = stubDb();
    const policy = { ttlMs: 600_000, maxEntries: 3 };
    for (let i = 0; i < 3; i++) cachePut(db, `k${i}`, { i }, policy);
    // k0 تازه خوانده شد ⇒ بازِ k1 نباید k0 را بیرون بیندازد
    expect(cacheGet(db, 'k0', policy).hit).toBe(true);
    cachePut(db, 'k3', { i: 3 }, policy);
    expect(cacheGet(db, 'k0', policy).hit).toBe(true);
    expect(cacheGet(db, 'k1', policy).hit).toBe(false);
    expect(queryCacheStats(db).evictions).toBe(1);
    expect(queryCacheStats(db).entries).toBeLessThanOrEqual(3);
  });

  it('پاک‌سازیِ دستی شمارنده‌ها را نمی‌سوزاند — تا «سودِ کش» در همان لحظه داوری شود', () => {
    const { db } = stubDb();
    const policy = { ttlMs: 600_000, maxEntries: 5 };
    cachePut(db, 'k', { i: 1 }, policy);
    cacheGet(db, 'k', policy);
    clearSearchCache(db);
    const stats = queryCacheStats(db);
    expect(stats.hits).toBe(1);
    expect(stats.cleared).toBe(1);
    expect(stats.entries).toBe(0);
    expect(cacheGet(db, 'k', policy).hit).toBe(false);
  });
});

describe('سیاست از پنل', () => {
  it('بی‌کلید: پیش‌فرض؛ با رقمِ فارسی همان عدد؛ و «۰» یعنی خاموش', async () => {
    const missing = stubDb();
    expect((await searchCachePolicy(missing.db)).ttlMs).toBe(SEARCH_CACHE_DEFAULT_SECONDS * 1000);

    const fa = stubDb('۳۰');
    expect((await searchCachePolicy(fa.db)).ttlMs).toBe(30_000);

    const off = stubDb('0');
    expect((await searchCachePolicy(off.db)).ttlMs).toBe(0);
  });

  it('خارج از بازه کوتاه می‌شود، نادیده نه — و رشتهٔ بی‌معنی پیش‌فرض را نمی‌شکند', async () => {
    expect((await searchCachePolicy(stubDb('999999').db)).ttlMs).toBe(3600 * 1000);
    expect((await searchCachePolicy(stubDb('-5').db)).ttlMs).toBe(0);
    expect((await searchCachePolicy(stubDb('هیچ').db)).ttlMs).toBe(SEARCH_CACHE_DEFAULT_SECONDS * 1000);
    expect((await searchCachePolicy(stubDb('').db)).ttlMs).toBe(SEARCH_CACHE_DEFAULT_SECONDS * 1000);
  });

  it('روشن ← خاموش، پاسخ‌هایِ مانده را همان لحظه می‌ریزد', async () => {
    // «خاموش کردم ولی همان قیمتِ کهنه می‌آید» بدترین چیزی است که می‌تواند
    // حس شود، چون دقیقاً اعتماد به خانهٔ تنظیمات را می‌شکند.
    const { db, set } = liveDb('600');
    const policy = await searchCachePolicy(db);
    cachePut(db, 'k', { i: 1 }, policy);
    expect(cacheGet(db, 'k', policy).hit).toBe(true);

    set('0');
    invalidateProbe(db, 'policy'); // همان کاری که گذشتِ پنج ثانیه می‌کند
    const off = await searchCachePolicy(db);
    expect(off.ttlMs).toBe(0);
    expect(queryCacheStats(db).enabled).toBe(false);
    expect(queryCacheStats(db).staleAfterPolicyChange).toBe(1);
    expect(queryCacheStats(db).entries).toBe(0);
    expect(cacheGet(db, 'k', policy).hit).toBe(false);
  });

  it('سیاست یک‌بار خوانده می‌شود، نه در هر پرسش (میکرو-کش — وگرنه کش خودش هزینه است)', async () => {
    const { db, sqls } = stubDb('15');
    await searchCachePolicy(db);
    await searchCachePolicy(db);
    await searchCachePolicy(db);
    expect(sqls.filter((s) => s.includes('store_settings'))).toHaveLength(1);
  });
});

describe('پرسش‌هایِ کمکیِ «آیا این جدول هست؟»', () => {
  it('یک بار می‌پرسد و تا عمرِ میکرو-کش دوباره نمی‌پرسد', async () => {
    const { db, sqls } = stubDb();
    expect(await hasRelation(db, 'search_synonyms')).toBe(true);
    expect(await hasRelation(db, 'search_synonyms')).toBe(true);
    expect(sqls.filter((s) => s.includes('information_schema'))).toHaveLength(1);
  });

  it('پاسخ «نیست» هم گرفته می‌شود، و بی‌اعتبارکردنِ دستی دوباره می‌پرسد', async () => {
    const { db, sqls } = stubDb();
    const noTable = {
      async query() {
        sqls.push('missing');
        return { rows: [{ n: '0' }] };
      },
    } as unknown as Queryable & object;
    expect(await hasRelation(noTable, 'search_queries')).toBe(false);
    expect(await hasRelation(noTable, 'search_queries')).toBe(false);
    expect(sqls.filter((s) => s === 'missing')).toHaveLength(1);
    invalidateProbe(noTable, 'relation:search_queries');
    await hasRelation(noTable, 'search_queries');
    expect(sqls.filter((s) => s === 'missing')).toHaveLength(2);
  });

  it('cachedProbe با عمرِ صفر هر بار می‌پرسد (برایِ داده‌ای که بی‌درنگ باید تازه باشد)', async () => {
    let n = 0;
    const { db } = stubDb();
    const compute = async () => ++n;
    await cachedProbe(db, 'x', 0, compute);
    await cachedProbe(db, 'x', 0, compute);
    expect(n).toBe(2);
    await cachedProbe(db, 'y', 60_000, compute);
    await cachedProbe(db, 'y', 60_000, compute);
    expect(n).toBe(3);
  });

  it('سقفِ کلیدها از بیرون هم دیده می‌شود (برایِ کارنامهٔ تنظیمات و پنل)', () => {
    expect(SEARCH_CACHE_MAX_ENTRIES).toBeGreaterThan(10);
    expect(SEARCH_CACHE_MAX_ENTRIES).toBeLessThan(10_000);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   آزمون‌هایِ رویِ دادهٔ واقعی — این سه تا دربارهٔ «همکاریِ کش با بقیهٔ موتور»
   اند، نه خودِ کش، پس با پایگاهِ ساختگی از آب درنمی‌آیند.
   ────────────────────────────────────────────────────────────────────────── */
describe('خطِ پیشِ جستجو با کش (روی دادهٔ واقعی)', () => {
  let db: Database;
  let catalog: CatalogService;

  beforeEach(async () => {
    db = createDatabase('memory://');
    await applyMigrations(db);
    await seedCatalog(db);
    catalog = new CatalogService(db);
  });

  afterEach(async () => {
    resetQueryCaches(db);
    await db.close();
  });

  /**
   * چند بار این پرسش در جدولِ پُرتکرارها ثبت شده؟
   *
   * چرا صبر می‌کند؟ چون ثبتِ پرسش «آتش بده و رها کن» است (`void
   * this.logSearch(...)`) — جستجو نباید برایِ یک INSERTِ گزارشِ باقی بماند.
   * پس لحظهٔ برگشتِ جستجو ممکن است سطرِ آخر هنوز نرسیده باشد، و آزمونی که
   * بی‌صبر می‌شمارد رقمِ کم می‌بیند و بی‌دلیل می‌سوزد.
   */
  async function logged(query: string, attempts = 25): Promise<number> {
    let last = -1;
    for (let i = 0; i < attempts; i += 1) {
      const { rows } = await db.query<{ n: string | number }>(
        `SELECT COUNT(*)::int AS n FROM search_queries WHERE raw = $1`,
        [query],
      );
      last = Number(rows[0]?.n ?? -1);
      if (last > 0) return last;
      await new Promise((r) => setTimeout(r, 40));
    }
    return last;
  }

  it('با وجودِ کش، هر جستجو در جدولِ پُرتکرارها نوشته می‌شود (پیشنهادِ مترادف از دست نمی‌رود)', async () => {
    for (let i = 0; i < 4; i += 1) await catalog.search({ query: 'کابلِ زربوف', log: true });
    expect(await logged('کابلِ زربوف')).toBe(4);

    const stats = queryCacheStats(db);
    expect(stats.hits).toBe(3);
    expect(stats.misses).toBe(1);
  });

  /** یک کالایِ ساختگی با واژهٔ بی‌معنی (نه در فرهنگِ داخلیِ جستجو، نه در دادهٔ نمونه) */
  async function zerbof(): Promise<void> {
    const created = await catalog.createProduct({
      typeKey: 'cable',
      title: 'کابلِ زربوف ویژه',
      variants: [{ sku: `SYN-${Math.random().toString(36).slice(2, 8)}`, priceRial: 20_000n }],
    });
    await db.query(`UPDATE products SET status = 'active' WHERE id = $1`, [created.id]);
  }

  it('کالایِ تازه همان لحظه در جستجو می‌آید؛ کشِ ۱۵ ثانیه‌ای مانعِ «کالا دادم، نیست» نمی‌شود', async () => {
    const before = await catalog.search({ query: 'زربوف', log: false });
    expect(before.total).toBe(0);
    expect(before.cached).toBe(false);

    const created = await catalog.createProduct({
      typeKey: 'cable',
      title: 'کابلِ زربوف فوق‌سریع',
      variants: [{ sku: 'FRESH-1', priceRial: 30_000n }],
    });
    await db.query(`UPDATE products SET status = 'active' WHERE id = $1`, [created.id]);

    const after = await catalog.search({ query: 'زربوف', log: false });
    expect(after.total).toBe(1);
    expect(after.items[0]?.title).toContain('زربوف');
  });

  it('مرزِ کش: نوشتنِ دور‌زنِ سرویس تا TTL کهنه می‌ماند — و دکمهٔ پنل همان لحظه درستش می‌کند', async () => {
    await zerbof();
    expect((await catalog.search({ query: 'زلبلوف', log: false })).total).toBe(0);

    // همان تغییرِ داده، این‌بار با SQLِ خام (مثلِ اسکریپتِ وارداتِ فروشنده)
    await db.query(`INSERT INTO store_settings (key, value) VALUES ('x','y') ON CONFLICT (key) DO NOTHING`);
    await db.query(`UPDATE products SET title = 'زلبلوفِ وارداتی' WHERE title LIKE 'کابلِ زربوف%'`);

    const stale = await catalog.search({ query: 'زلبلوف', log: false });
    expect(stale.total).toBe(0); // کش: هنوز همان «هیچ»
    expect(stale.cached).toBe(true);

    clearSearchCache(db); // همان دکمهٔ «خالی‌کردنِ کشِ جستجو» در پنل
    const fresh = await catalog.search({ query: 'زلبلوف', log: false });
    expect(fresh.total).toBe(1);
    expect(fresh.cached).toBe(false);
  });

  it('«صفر» یعنی کش خاموش — و کشِ موجود هم در همان لحظه می‌رود', async () => {
    await catalog.search({ query: 'کابل', log: false });
    expect((await catalog.search({ query: 'کابل', log: false })).cached).toBe(true);
    expect(queryCacheStats(db).entries).toBeGreaterThan(0);

    await db.query(
      `INSERT INTO store_settings (key, value) VALUES ('search_cache_seconds', '0')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );

    // سیاستِ «عمرِ کش» تا ۵ ثانیه میکرو-کش می‌شود؛ دکمهٔ پنل — که آزمونِ ما هم
    // همان را صدا می‌زند — با خالی‌کردنِ کش، سیاست را هم دور می‌ریزد. `enabled`
    // در آمار از *خواندنِ* سیاست می‌آید، پس یک جستجو لازم است تا رقم تازه شود.
    clearSearchCache(db);
    expect((await catalog.search({ query: 'کابل', log: false })).cached).toBe(false);

    const stats = queryCacheStats(db);
    expect(stats.enabled).toBe(false);
    expect(stats.entries).toBe(0); // کشِ مانده رفت، وگرنه فروشنده همان قیمتِ دیروز را می‌دید
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   کشِ فهرست‌ها — دسته‌ها/برندها/دستگاه‌ها/رنگ‌ها؛ سیاستِ مشترک، آمارِ جدا.
   ────────────────────────────────────────────────────────────────────────── */
describe('cachedList — هستهٔ کشِ فهرست‌ها (پایگاهِ ساختگی)', () => {
  it('دورِ اول می‌سازد، دورِ دوم می‌خورد — و «از کش آمد» را صدا می‌زند', async () => {
    const { db } = stubDb();
    let n = 0;
    const compute = async () => {
      n += 1;
      return { count: n };
    };
    const first = await cachedList(db, 'brands', compute);
    expect(first).toEqual({ items: { count: 1 }, cached: false, cacheAgeMs: 0 });
    const second = await cachedList(db, 'brands', compute);
    expect(second.cached).toBe(true);
    expect(second.cacheAgeMs).toBeGreaterThanOrEqual(0);
    expect(second.items).toEqual({ count: 1 });
    expect(n).toBe(1); // فقط یک بار ساخته شد
    expect(listCacheStats(db).hits).toBe(1);
    expect(listCacheStats(db).misses).toBe(1);
  });

  it('کلیدِ متفاوت، کشِ متفاوت — «منویِ پنل» با «منویِ خریدار» قاطی نمی‌شود', async () => {
    const { db } = stubDb();
    let n = 0;
    const compute = async () => ++n;
    await cachedList(db, 'categories&onlyWithProducts=false', compute);
    await cachedList(db, 'categories&onlyWithProducts=true', compute);
    expect(n).toBe(2);
    expect(listCacheStats(db).entries).toBe(2);
  });

  it('سیاستِ صفر: هیچ فهرستی نگه داشته نمی‌شود', async () => {
    const { db } = stubDb('0');
    let n = 0;
    const compute = async () => ++n;
    await cachedList(db, 'k', compute);
    await cachedList(db, 'k', compute);
    expect(n).toBe(2);
    expect(listCacheStats(db).entries).toBe(0);
  });

  it('روشن ← خاموش: فهرست‌هایِ مانده همان لحظه می‌روند (نه تا پنج ثانیهٔ میکرو-کشِ سیاست)', async () => {
    const { db, set } = liveDb('600');
    await cachedList(db, 'k', async () => ({ v: 1 }));
    expect((await cachedList(db, 'k', async () => ({ v: 2 }))).cached).toBe(true);

    set('0');
    invalidateProbe(db, 'policy');
    await searchCachePolicy(db);
    expect(listCacheStats(db).entries).toBe(0);
    expect(listCacheStats(db).enabled).toBe(false);
    expect((await cachedList(db, 'k', async () => ({ v: 2 }))).cached).toBe(false);
  });

  it('فهرستِ گنده نگه نمی‌شود و بی‌صدا نمی‌ماند', async () => {
    const { db } = stubDb();
    const huge = { items: Array.from({ length: 40_000 }, () => 'x'.repeat(20)) };
    await cachedList(db, 'big', async () => huge);
    expect(listCacheStats(db).skippedBig).toBe(1);
    expect(listCacheStats(db).entries).toBe(0);
  });

  it('clearListCache فقط فهرست‌ها را می‌ریزد؛ کشِ جستجو دست‌نخورده می‌ماند', () => {
    const { db } = stubDb();
    const policy = { ttlMs: 600_000, maxEntries: 5 };
    cachePut(db, 'search', { q: 1 }, policy); // کشِ جستجو
    // فهرست از مسیرِ خودش
    void db;
    clearListCache(db);
    expect(queryCacheStats(db).entries).toBe(1); // جستجو سالم است
    expect(cacheGet(db, 'search', policy).hit).toBe(true);
  });

  it('clearSearchCache هر دو را با هم می‌ریزد («یک دکمه، همهٔ خوانش‌ها تازه»)', async () => {
    const { db } = stubDb();
    const policy = { ttlMs: 600_000, maxEntries: 5 };
    cachePut(db, 'search', { q: 1 }, policy);
    await cachedList(db, 'list', async () => [1, 2]);
    expect(listCacheStats(db).entries).toBe(1);
    clearSearchCache(db);
    expect(queryCacheStats(db).entries).toBe(0);
    expect(listCacheStats(db).entries).toBe(0);
    expect((await cachedList(db, 'list', async () => [1, 2])).cached).toBe(false);
  });
});

describe('کشِ فهرست‌ها رویِ دادهٔ واقعی (PGlite + کاتالوگِ نمونه)', () => {
  let db: Database;
  let catalog: CatalogService;
  let categories: CategoryService;
  let compat: CompatibilityService;

  beforeEach(async () => {
    db = createDatabase('memory://');
    await applyMigrations(db);
    await seedCatalog(db);
    catalog = new CatalogService(db);
    categories = new CategoryService(db);
    compat = new CompatibilityService(db);
  });

  afterEach(async () => {
    resetQueryCaches(db);
    await db.close();
  });

  it('درختِ دسته‌ها: دورِ دوم از کش می‌آید؛ آمارِ جدا از جستجو می‌شمارد', async () => {
    const first = await categories.tree({ onlyWithProducts: false });
    expect(first.cached).toBe(false);
    const second = await categories.tree({ onlyWithProducts: false });
    expect(second.cached).toBe(true);
    expect(second.items).toEqual(first.items);
    expect(listCacheStats(db).hits).toBeGreaterThanOrEqual(1);
    // آمارِ جستجو درگیر نشده — «cacheRateِ نزدیکِ صد» برایِ فهرست‌ها، کشِ جستجو را
    // باطل نمی‌کند.
    expect(queryCacheStats(db).hits).toBe(0);
  });

  it('دستهٔ تازه: منویِ بعدیِ همان لحظه، «از کش نبود» است و دستهٔ تازه را نشان می‌دهد', async () => {
    await categories.tree({ onlyWithProducts: false });
    const created = await categories.create({ name: 'دستهِٔ زربوف' });
    expect(created.id).toBeTruthy();

    const next = await categories.tree({ onlyWithProducts: false });
    expect(next.cached).toBe(false);
    expect(next.items.some((n) => n.name === 'دستهِٔ زربوف')).toBe(true);
  });

  it('کالایِ تازه، شمارِ برند را عوض می‌کند — کشِ فهرست همان لحظه شکسته می‌شود', async () => {
    const before = await catalog.brands();
    expect(before.cached).toBe(false);
    expect((await catalog.brands()).cached).toBe(true);

    await catalog.createProduct({
      typeKey: 'cable',
      title: 'کابلِ زربوف',
      variants: [{ sku: 'BRAND-CACHE-1', priceRial: 10_000n }],
    });

    const after = await catalog.brands();
    expect(after.cached).toBe(false);
  });

  it('مدلِ گوشیِ تازه: فهرستِ دستگاه‌ها تازه می‌شود، ولی کشِ گرانِ جستجو نمی‌رود', async () => {
    // نخست کشِ جستجو را پر می‌کنیم
    await catalog.search({ query: 'کابل', log: false });
    const searchEntries = queryCacheStats(db).entries;
    expect(searchEntries).toBeGreaterThan(0);

    await compat.ensureModel('samsung', 'سامسونگ', 'Galaxy S99');

    // فهرستِ دستگاه‌ها: تازه‌سازی شد و مدلِ تازه در آن است
    const devices = await compat.listDevices();
    expect(devices.cached).toBe(false);
    expect(devices.items.some((m) => m.model === 'Galaxy S99')).toBe(true);

    // ولی کشِ جستجو دست‌نخورده است — همان دادهٔ پیشین هنوز می‌آید
    expect(queryCacheStats(db).entries).toBe(searchEntries);
    expect((await catalog.search({ query: 'کابل', log: false })).cached).toBe(true);
  });

  it('رنگ‌ها: دورِ دوم از کش؛ و با «صفر» در پنل، کشِ فهرست هم همان لحظه خاموش می‌شود', async () => {
    expect((await catalog.availableColours()).cached).toBe(false);
    expect((await catalog.availableColours()).cached).toBe(true);

    await db.query(
      `INSERT INTO store_settings (key, value) VALUES ('search_cache_seconds', '0')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    clearSearchCache(db);
    expect((await catalog.availableColours()).cached).toBe(false);
    expect(listCacheStats(db).entries).toBe(0);
  });
});
