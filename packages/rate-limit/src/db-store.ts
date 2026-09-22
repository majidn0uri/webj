import { alignedWindowStart } from './memory-store.js';
import type { CounterHit, CounterStore, CounterValue } from './types.js';

/**
 * کم‌ترین چیزی که این شمارنده از پایگاه می‌خواهد.
 *
 * چرا نوع را اینجا تعریف کرده‌ایم و نه از `@set/db` وارد؟ چون مهارگر نباید به
 * لایه‌یِ داده گره بخورد: در آزمون‌ها یک شیءِ ساده کافی است و در برنامه،
 * همان `Database` واقعی (ساختاراً سازگار) داده می‌شود.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; affectedRows?: number }>;
}

/**
 * شمارنده‌یِ پایگاهی — یکسان در میانِ همه‌یِ نمونه‌هایِ API.
 *
 * سه ویژگی که این پیاده‌سازی را امن می‌کند:
 *
 *   ۱. **یک دستور.** افزایشِ شمارنده یک `INSERT … ON CONFLICT` است که در
 *      همان دستور، انقضایِ پنجره را هم حل می‌کند (مقایسه‌یِ آغازِ پنجره). پس
 *      میانِ «خواندنِ شمارنده» و «نوشتنِ شمارنده» هیچ پنجره‌ای برایِ سبقت
 *      گرفتنِ دو درخواستِ هم‌زمان نیست — چیزی که با دو کوئری (SELECT سپس
 *      UPDATE) پیش می‌آمد و سقف را در لحظه‌یِ شلوغی بی‌اثر می‌کرد.
 *
 *   ۲. **پنجره‌یِ هم‌راستا.** کلیدِ سطل ثابت است و فقط «آغازِ پنجره» عوض
 *      می‌شود؛ پس ردیف‌ها رشد نمی‌کنند (یک ردیف به‌ازایِ هر کلید، نه هر
 *      پنجره) و پاک‌سازی یک شرطِ ساده است.
 *
 *   ۳. **شکست = عبور.** اگر پایگاه پاسخ ندهد، شمارنده خطا را بالا نمی‌دهد؛
 *      اجازه می‌دهد و آن را گزارش می‌کند. چرا؟ چون مهارِ بار برایِ حفظِ
 *      دسترسی است، نه برایِ گرفتنش: پایگاهی که از پاسخ افتاده، اگر مهارگر هم
 *      به آن وابسته باشد، کلِ فروشگاه را با خودش پایین می‌کشد. بهایش این است
 *      که در چند لحظه‌یِ نادر سقف اِعمال نمی‌شود — و این از بسته شدنِ فروشگاه
 *      بهتر است.
 */
export class DbCounterStore implements CounterStore {
  readonly kind = 'db' as const;

  private failures = 0;
  private lastErrorAt: Date | null = null;

  constructor(private readonly db: Queryable) {}

  async incr(hit: CounterHit): Promise<CounterValue> {
    const windowStartedAt = new Date(alignedWindowStart(hit.now, hit.windowSeconds));
    try {
      const { rows } = await this.db.query<{ count: number | string; started: string }>(
        `INSERT INTO rate_limit_counters (rule_name, bucket_key, window_started_at, count)
         VALUES ($1, $2, $3::timestamptz, 1)
         ON CONFLICT (rule_name, bucket_key) DO UPDATE
            SET count = CASE
                          WHEN rate_limit_counters.window_started_at = EXCLUDED.window_started_at
                            THEN rate_limit_counters.count + 1
                          ELSE 1
                        END,
                window_started_at = EXCLUDED.window_started_at
         RETURNING count, window_started_at::text AS started`,
        [hit.rule, hit.key, windowStartedAt.toISOString()],
      );
      const row = rows[0];
      if (!row) {
        // پایگاه در دسترس است اما ردیفی برنگشت — وضعیتی که انتظارش را نداریم.
        // در این حالت هم عبور می‌دهیم (همان استدلالِ بالا) و می‌شماریمش.
        this.failures += 1;
        this.lastErrorAt = new Date();
        return { count: 1, windowStartedAt };
      }
      return {
        count: Number(row.count),
        windowStartedAt: new Date(row.started),
      };
    } catch {
      this.failures += 1;
      this.lastErrorAt = new Date();
      return { count: 1, windowStartedAt };
    }
  }

  async reset(rule?: string): Promise<number> {
    if (!rule) {
      const { rows } = await this.db.query<{ n: string }>(
        `WITH cleared AS (DELETE FROM rate_limit_counters RETURNING 1)
            SELECT COUNT(*)::text AS n FROM cleared`,
      );
      return Number(rows[0]?.n ?? 0);
    }
    const { rows } = await this.db.query<{ n: string }>(
      `WITH cleared AS (DELETE FROM rate_limit_counters WHERE rule_name = $1 RETURNING 1)
          SELECT COUNT(*)::text AS n FROM cleared`,
      [rule],
    );
    return Number(rows[0]?.n ?? 0);
  }

  size(): number {
    return -1;
  }

  /** آمارِ سلامتِ خودِ مهارگر — در پنل نشان داده می‌شود */
  health(): { failures: number; lastErrorAt: Date | null } {
    return { failures: this.failures, lastErrorAt: this.lastErrorAt };
  }

  /** پاک‌سازیِ سطل‌هایِ کهنه — با زمان‌سنج (از بیرون) صدا زده می‌شود */
  async prune(olderThanSeconds = 86_400): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>(
      `WITH cleared AS (
          DELETE FROM rate_limit_counters
           WHERE window_started_at < now() - ($1 || ' seconds')::interval
         RETURNING 1
       )
       SELECT COUNT(*)::text AS n FROM cleared`,
      [String(olderThanSeconds)],
    );
    return Number(rows[0]?.n ?? 0);
  }
}

/**
 * ثبتِ یک مسدودشدن.
 *
 * چرا جدا از شمارنده؟ چون مسدودشدن باید «دیده» شود اما نباید خودش به ابزارِ
 * حمله تبدیل شود. کلیدِ یکتایِ `(قاعده، سطل، پنجره)` در جدول باعث می‌شود هر
 * سطل در هر پنجره یک ردیف داشته باشد — نه یکی به‌ازایِ هر درخواستِ ردشده. پس
 * حمله با یک میلیون درخواست، یک ردیف می‌سازد و شمارنده‌یِ `seen` بالا می‌رود.
 */
export async function recordBlocked(
  db: Queryable,
  input: {
    rule: string;
    bucketKey: string;
    windowStartedAt: Date;
    ip?: string;
    method?: string;
    path?: string;
    traceId?: string;
  },
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO rate_limit_events
         (rule_name, bucket_key, window_started_at, ip, method, path, trace_id)
       VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7)
       ON CONFLICT (rule_name, bucket_key, window_started_at) DO UPDATE
          SET seen = rate_limit_events.seen + 1,
              last_seen_at = now()`,
      [
        input.rule,
        input.bucketKey,
        input.windowStartedAt.toISOString(),
        input.ip ?? null,
        input.method ?? null,
        input.path ?? null,
        input.traceId ?? null,
      ],
    );
  } catch {
    // ثبتِ ردِّ مسدودشدن هرگز نباید جلویِ پاسخ را بگیرد
  }
}
