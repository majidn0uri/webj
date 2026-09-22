import { searchKey } from '@set/shared-kernel';
import type { Queryable } from '@set/db';

import { AppError } from '@set/shared-kernel';

import { clearSearchCache, invalidateProbe } from './query-cache.js';

/**
 * فرهنگِ مترادف‌ها — همان چیزی که فروشنده باید از پنل مدیریت کند.
 *
 * چرا یک فایلِ جدا؟ چون جدولِ `search_synonyms` از مهاجرتِ ۰۰۹ بود و موتورِ
 * جستجو هم از همان روز آن را می‌خواند — ولی **هیچ** راهِ نوشتنی نداشت. یعنی
 * «فروشنده می‌تواند مترادف تعریف کند» رویِ کاغذ بود و در عمل یعنی یک نفَر
 * با `psql`. همین جدول تنها جایی است که «مردم این را می‌نویسند ولی ما آن را
 * «گوشی شارژر» می‌نامیم» را به سامانه یاد می‌دهد؛ پس رابطِ پنل، کارِ همین
 * نوبت است، نه افزودنیِ بعدی.
 *
 * دو قاعده که اینجا گم نمی‌شوند:
 *  • **کلیدها در همان جا نرمال می‌شوند که موتورِ جستجو می‌خواند** (`searchKey`
 *    در shared-kernel، همزادِ `setshop_search_key()` در پایگاه). اگر نوشتنِ
 *    پنل نرمالِ دیگری بکند، مترادف ثبت می‌شود ولی هرگز به کار نمی‌آید — و
 *    بدترین شکلِ باگ همین است: داده هست، رفتار نیست.
 *  • **هر نوشتن، کشِ مترادف‌ها را بی‌اعتبار می‌کند.** بی‌این، فروشنده چیزی
 *    اضافه می‌کند و تا سی ثانیه (عمرِ کش) هیچ فرقی نمی‌بیند و دکمه را دوباره
 *    می‌زند.
 */

export interface SynonymRow {
  id: string;
  term: string;
  termKey: string;
  canonical: string;
  canonicalKey: string;
  isActive: boolean;
  createdAt: string;
}

export interface SynonymInput {
  term: string;
  canonical: string;
  isActive?: boolean;
}

export interface SynonymSuggestion {
  normalized: string;
  sample: string;
  searches: number;
  lastSeenAt: string;
  /** همین عبارت قبلاً مترادف دارد؟ */
  mapped: boolean;
}

const MAX_LEN = 80;

function clean(value: unknown, field: string): string {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (text.length === 0) {
    throw new AppError('VALIDATION', { details: { [field]: 'این خانه نمی‌تواند خالی باشد.' } });
  }
  if (text.length > MAX_LEN) {
    throw new AppError('VALIDATION', {
      details: { [field]: `بیش از ${MAX_LEN} نویسه شد — مترادف یک واژه یا دو واژه است، نه یک جمله.` },
    });
  }
  return text;
}

/**
 * نرمال‌سازی + داوریِ «این اصلاً مترادف است؟».
 *
 * «شارژر → شارژر» که هیچ معنایی ندارد، ولی دامِ واقعی‌تر این است: دو رشتهٔ
 * متفاوت که **پس ازِ نرمال‌سازی** یکی می‌شوند («كابل» عربی و «کابل» فارسی).
 * آن یکی هم بی‌فایده است — چون موتورِ جستجو هر دو را یک چیز می‌بیند — و
 * نگه‌داشتنش در فهرست یعنی یک ردیفِ گمراه‌کننده برایِ مدیر.
 */
function pairOf(term: unknown, canonical: unknown): { term: string; canonical: string; termKey: string; canonicalKey: string } {
  const t = clean(term, 'term');
  const c = clean(canonical, 'canonical');
  const termKey = searchKey(t);
  const canonicalKey = searchKey(c);
  if (!termKey || !canonicalKey) {
    throw new AppError('VALIDATION', {
      details: { term: 'هر دو طرف باید دست‌کم یک حرف یا رقم داشته باشند (نقطه و ویرگول به‌تنهایی واژه نیست).' },
    });
  }
  if (termKey === canonicalKey) {
    throw new AppError('VALIDATION', {
      details: {
        canonical:
          'این دو پس ازِ یکسان‌سازیِ حروفِ فارسی/عربی و ارقام یکی می‌شوند؛ پس مترادفی میانِ آن‌ها معنا ندارد.',
      },
    });
  }
  return { term: t, canonical: c, termKey, canonicalKey };
}

function rowOf(r: {
  id: string;
  term: string;
  term_key: string;
  canonical: string;
  canonical_key: string;
  is_active: boolean;
  created_at: Date | string;
}): SynonymRow {
  return {
    id: r.id,
    term: r.term,
    termKey: r.term_key,
    canonical: r.canonical,
    canonicalKey: r.canonical_key,
    isActive: r.is_active,
    // رانرِ pg رشته می‌دهد و PGlite شیء Date — هر دو به ISO برمی‌گردند تا مصرف‌کننده یکی ببیند
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

/**
 * فهرستِ پنل. `q` هم خودِ واژه را می‌بیند هم کلیدش را، تا جستجوهایِ
 * «كابل» و «کابل» هر دو به نتیجه برسند — همان چیزی که از موتورِ جستجو
 * انتظار می‌رود، اینجا هم باید صادق باشد.
 */
export async function listSynonyms(
  db: Queryable,
  options: { q?: string; onlyInactive?: boolean; limit?: number; offset?: number } = {},
): Promise<{ rows: SynonymRow[]; total: number }> {
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const where: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  const q = String(options.q ?? '').trim();
  if (q) {
    const key = searchKey(q);
    params.push(`%${q}%`, `%${key}%`);
    where.push(`(s.term ILIKE $${i++} OR s.term_key ILIKE $${i++} OR s.canonical ILIKE $${i - 2} OR s.canonical_key ILIKE $${i - 1})`);
  }
  if (options.onlyInactive) where.push(`s.is_active = false`);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const count = await db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM search_synonyms s ${clause}`, params);
  // عمداً اینجا «چند کالا با این کلید می‌خورند» را نمی‌شماریم: الگویِ LIKE که با
  // || ساخته شود ثابت نیست و ایندکسِ trgm را نمی‌تواند به کار بگیرد؛ یعنی برایِ
  // هر سطرِ صفحه یک پویشِ کاملِ جدولِ کالا. «این مترادف به درد می‌خورد؟» را
  // پنل از جایِ درستش جواب می‌دهد: جدولِ «چه جستجو کردند و نشد» (`suggestions`).
  const { rows } = await db.query<{
    id: string;
    term: string;
    term_key: string;
    canonical: string;
    canonical_key: string;
    is_active: boolean;
    created_at: Date | string;
  }>(
    `SELECT s.id, s.term, s.term_key, s.canonical, s.canonical_key, s.is_active, s.created_at
       FROM search_synonyms s ${clause}
      ORDER BY s.is_active DESC, s.term ASC
      LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset],
  );

  return { rows: rows.map(rowOf), total: Number(count.rows[0]?.n ?? '0') };
}

/** افزودن یا به‌روزرسانیِ بی‌تکرار (کلیدِ یکتایی رویِ `(term_key, canonical_key)` است) */
export async function upsertSynonym(db: Queryable, input: SynonymInput): Promise<SynonymRow> {
  const { term, canonical, termKey, canonicalKey } = pairOf(input.term, input.canonical);
  const isActive = input.isActive !== false;

  const { rows } = await db.query<{
    id: string;
    term: string;
    term_key: string;
    canonical: string;
    canonical_key: string;
    is_active: boolean;
    created_at: Date | string;
  }>(
    `INSERT INTO search_synonyms (term, term_key, canonical, canonical_key, is_active)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (term_key, canonical_key) DO UPDATE
        SET term = EXCLUDED.term, canonical = EXCLUDED.canonical, is_active = EXCLUDED.is_active
      RETURNING id, term, term_key, canonical, canonical_key, is_active, created_at`,
    [term, termKey, canonical, canonicalKey, isActive],
  );
  const row = rows[0];
  if (!row) throw new AppError('CONFLICT', { message: 'مترادف ثبت نشد؛ دوباره تلاش کنید.' });
  touchCaches(db);
  return rowOf(row);
}

/** یک ردیف با شناسه — برایِ ویرایشِ بی‌خواندنِ کلِ فهرست */
export async function getSynonym(db: Queryable, id: string): Promise<SynonymRow | null> {
  const { rows } = await db.query<{
    id: string;
    term: string;
    term_key: string;
    canonical: string;
    canonical_key: string;
    is_active: boolean;
    created_at: Date | string;
  }>(
    `SELECT id, term, term_key, canonical, canonical_key, is_active, created_at
       FROM search_synonyms WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? rowOf(row) : null;
}

/** روشن/خاموش کردن — مدیرِ فروشگاه «موقتاً بی‌خیالِ این مترادف» را با حذف نمی‌نویسد */
export async function setSynonymActive(db: Queryable, id: string, active: boolean): Promise<SynonymRow | null> {
  const { rows } = await db.query<{
    id: string;
    term: string;
    term_key: string;
    canonical: string;
    canonical_key: string;
    is_active: boolean;
    created_at: Date | string;
  }>(
    `UPDATE search_synonyms SET is_active = $2 WHERE id = $1
     RETURNING id, term, term_key, canonical, canonical_key, is_active, created_at`,
    [id, active],
  );
  touchCaches(db);
  const row = rows[0];
  return row ? rowOf(row) : null;
}

export async function deleteSynonym(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(`DELETE FROM search_synonyms WHERE id = $1 RETURNING id`, [id]);
  touchCaches(db);
  return rows.length > 0;
}

/**
 * دو کش، دو چیزِ متفاوت، یکجا بی‌اعتبار:
 *   • کشِ خودِ مترادف‌ها (تا موتورِ جستجو همان لحظه فرهنگِ تازه را ببیند)
 *   • کشِ پاسخِ پرسش‌ها (تا «همان پرسشِ دیروز» نتیجهٔ دیروز را نشان ندهد)
 *
 * بی‌دومی، فروشنده مترادف می‌سازد، صفحهٔ نتایج را باز می‌کند و هیچ نمی‌بیند —
 * و حق دارد باور کند که کاری نکرده‌ایم. عمرِ کشِ پاسخ کوتاه است، ولی «کوتاه»
 * دلیلِ خوبِ گیج‌کردنِ آدم نیست.
 */
function touchCaches(db: Queryable): void {
  invalidateProbe(db as object, 'synonyms');
  clearSearchCache(db as object);
}

/**
 * «چه چیزی را جستجو کردند و چیزی پیدا نشد» — سوختِ همین فرهنگ.
 *
 * چرا در همین صفحه؟ چون درستِ کارِ فروشنده این است: ببیند مردم چه می‌خواهند،
 * همان‌جا برایش مترادف بسازد. بی‌این، جدولِ `search_queries` (که از مهاجرتِ
     ۰۱۱ پر می‌شود) یک گزارشِ خشک در گوشهٔ پنل است و کسی به آن نمی‌رسد.
 */
export async function zeroResultSuggestions(
  db: Queryable,
  options: { days?: number; limit?: number } = {},
): Promise<SynonymSuggestion[]> {
  const days = Math.max(1, Math.min(365, Math.floor(options.days ?? 30)));
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 10)));
  const { rows } = await db.query<{
    normalized: string;
    sample: string;
    searches: string;
    last_seen_at: Date | string;
    mapped: boolean;
  }>(
    `SELECT q.normalized,
            MAX(q.raw) AS sample,
            COUNT(*)::text AS searches,
            MAX(q.created_at) AS last_seen_at,
            BOOL_OR(EXISTS (SELECT 1 FROM search_synonyms s WHERE s.is_active AND s.term_key = q.normalized)) AS mapped
       FROM search_queries q
      WHERE q.results = 0
        AND q.created_at >= now() - ($1 || ' days')::interval
        AND length(q.normalized) > 0
      GROUP BY q.normalized
      ORDER BY COUNT(*) DESC, MAX(q.created_at) DESC
      LIMIT $2`,
    [days, limit],
  );

  return rows.map((r) => ({
    normalized: r.normalized,
    sample: r.sample,
    searches: Number(r.searches),
    lastSeenAt: r.last_seen_at instanceof Date ? r.last_seen_at.toISOString() : String(r.last_seen_at),
    mapped: r.mapped === true,
  }));
}
