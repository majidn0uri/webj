import type { Queryable } from '@set/db';

/**
 * میانگیرِ گزارش‌ها.
 *
 * چرا میانگیر؟ چون این سه گزارش روی صدها هزار ردیف جمع می‌زنند: سودِ ناخالص
 * هر ردیفِ فروش را می‌خواند، گردشِ موجودی روی همه‌ی تنوع‌ها می‌چرخد، و سنِ
 * بدهی همه‌ی چک‌ها را. بی‌میانگیر، هر بار باز کردنِ صفحه (و هر بار لمسِ یک
 * فیلتر) چند پرس‌وجویِ سنگین به پایگاه می‌فرستاد و در ساعتِ شلوغ، خودِ گزارش
 * عاملِ کندی می‌شد.
 *
 * قاعده‌یِ ساده و ایمن:
 *   • کلید = نامِ گزارش + کلیدِ دوره (و شعبه و دسته‌بندی). پس تغییرِ هر فیلتر
 *     کلیدِ تازه می‌سازد و نتیجه‌یِ کهنه به جایِ تازه نشان داده نمی‌شود.
 *   • میانگیر بیش از ۱۵ دقیقه عمر نمی‌کند؛ پس مدیر همیشه عددِ همین ربعِ ساعت
 *     را می‌بیند، نه عددِ دیروز را.
 *   • دکمه‌یِ «بازسازی» میانگیر را نادیده می‌گیرد و دوباره می‌سازد.
 *
 * نکته‌یِ مهم: خروجیِ گزارش‌ها همه رشته است (مبالغ BIGINT در پایگاه هستند و
 * در JSON به رشته بدل می‌شوند)، پس ذخیره و بازخوانیِ آن‌ها بی‌هیچ تبدیلی
 * درست است و هیچ رقمی در این میان گرد نمی‌شود.
 */

export const REPORT_TTL_MS = 15 * 60 * 1000;

export interface CachedResult<T> {
  payload: T;
  /** آیا از میانگیر آمده یا همین لحظه ساخته شده؟ (در پنل نشان داده می‌شود) */
  cached: boolean;
  generatedAt: Date;
  buildMs: number;
  rowCount: number;
}

interface CacheRow {
  payload: unknown;
  row_count: number;
  build_ms: number;
  generated_at: string;
}

function isFresh(generatedAt: Date, ttlMs: number, now: Date): boolean {
  return now.getTime() - generatedAt.getTime() <= ttlMs;
}

/**
 * گزارش را از میانگیر می‌خواند؛ اگر نبود یا کهنه بود یا بازسازی خواسته شده
 * بود، می‌سازد و در میانگیر می‌نویسد.
 *
 * اگر نوشتنِ میانگیر شکست بخورد (مثلاً پایگاه لحظه‌ای در دسترس نباشد)،
 * خطا بالا نمی‌رود: گزارش ساخته شده و همان برگردانده می‌شود — میانگیر یک
 * بهبود است، نه بخشی از درستیِ عدد.
 */
export async function cachedReport<T>(
  db: Queryable,
  input: {
    reportKey: string;
    periodKey: string;
    rebuild?: boolean;
    ttlMs?: number;
    now?: Date;
    build: () => Promise<{ payload: T; rowCount: number }>;
  },
): Promise<CachedResult<T>> {
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? REPORT_TTL_MS;

  if (!input.rebuild) {
    const { rows } = await db.query<CacheRow>(
      `SELECT payload, row_count, build_ms, generated_at::text
         FROM report_cache
        WHERE report_key = $1 AND period_key = $2`,
      [input.reportKey, input.periodKey],
    );
    const hit = rows[0];
    if (hit && isFresh(new Date(hit.generated_at), ttlMs, now)) {
      return {
        payload: hit.payload as T,
        cached: true,
        generatedAt: new Date(hit.generated_at),
        buildMs: hit.build_ms,
        rowCount: hit.row_count,
      };
    }
  }

  const startedAt = Date.now();
  const built = await input.build();
  const buildMs = Date.now() - startedAt;

  try {
    await db.query(
      `INSERT INTO report_cache (report_key, period_key, payload, row_count, build_ms, generated_at)
       VALUES ($1,$2,$3::jsonb,$4,$5,now())
       ON CONFLICT (report_key, period_key)
       DO UPDATE SET payload = EXCLUDED.payload, row_count = EXCLUDED.row_count,
                     build_ms = EXCLUDED.build_ms, generated_at = now()`,
      [
        input.reportKey,
        input.periodKey,
        JSON.stringify(built.payload),
        built.rowCount,
        buildMs,
      ],
    );
  } catch {
    // میانگیر شکست خورد؛ عدد درست است و همین برگردانده می‌شود
  }

  return {
    payload: built.payload,
    cached: false,
    generatedAt: now,
    buildMs,
    rowCount: built.rowCount,
  };
}

/** پاک کردنِ میانگیرِ یک گزارش (پس از ثبتِ سندِ تازه، یا با دکمه‌یِ بازسازی) */
export async function invalidateReport(
  db: Queryable,
  reportKey: string,
  periodKey?: string,
): Promise<number> {
  // RETURNING می‌دهیم چون نوعِ نتیجه‌یِ پرس‌وجو در این پروژه شمارِ ردیف ندارد
  const { rows } = await db.query<{ id: string }>(
    periodKey
      ? `DELETE FROM report_cache WHERE report_key = $1 AND period_key = $2 RETURNING id`
      : `DELETE FROM report_cache WHERE report_key = $1 RETURNING id`,
    periodKey ? [reportKey, periodKey] : [reportKey],
  );
  return rows.length;
}
