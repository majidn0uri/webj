import { mkdirSync } from 'node:fs';
import os from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

/**
 * لایه‌ی دسترسی به داده.
 *
 * دو پشتیبان (backend) دارد که یک قراردادِ واحد را پیاده می‌کنند:
 *
 *   ۱. `memory://`         → PGlite درون‌فرآیندی (فقط تست؛ با خروج پاک می‌شود)
 *   ۲. مسیرِ پوشه          → PGlite روی دیسک (توسعه؛ بینِ اجراها می‌ماند)
 *   ۳. `postgres://…`      → PostgreSQL واقعی از طریقِ Pool (تولید)
 *
 * چرا این مهم است؟ چون تا پیش از این، پایگاه‌داده فقط در حافظه بود و با هر
 * ری‌استارت همه‌چیز پاک می‌شد — یعنی سیستم برای استفاده‌ی واقعی آماده نبود.
 * همه‌ی کدها فقط از اینترفیسِ Queryable استفاده می‌کنند، بنابراین جابه‌جایی
 * میانِ این سه حالت فقط یک متغیرِ محیطی است، نه بازنویسی.
 */
export interface QueryResult<T> {
  rows: T[];
  affectedRows?: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}

export interface Transaction extends Queryable {}

export interface Database extends Queryable {
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** PGlite از affectedRows استفاده می‌کند و pg از rowCount؛ اینجا یکسان می‌شود. */
function normalize<T>(res: { rows: T[]; affectedRows?: number; rowCount?: number | null }): QueryResult<T> {
  return {
    rows: res.rows ?? [],
    affectedRows: res.affectedRows ?? res.rowCount ?? undefined,
  };
}

/** پشتیبانِ PGlite (درون‌فرآیندی یا روی دیسک) */
function createPgliteDatabase(dataDir: string): Database {
  if (dataDir !== 'memory://') {
    // PGlite پوشه‌ی والد را خودش نمی‌سازد؛ اینجا می‌سازیم تا اجرا با خطا متوقف نشود
    mkdirSync(dataDir, { recursive: true });
  }
  const pg = new PGlite(dataDir === 'memory://' ? undefined : dataDir);
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return normalize(await pg.query<T>(sql, params as never[]));
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
    async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      return pg.transaction(async (tx) => {
        const wrapped: Transaction = {
          async query<R>(sql: string, params: unknown[] = []) {
            return normalize(await tx.query<R>(sql, params as never[]));
          },
          async exec(sql: string) {
            await tx.exec(sql);
          },
        };
        return fn(wrapped);
      }) as Promise<T>;
    },
    async close() {
      await pg.close();
    },
  };
}

/**
 * اندازه‌یِ استخرِ اتصال — و چرا «۲۰ِ» ثابت نبود.
 *
 * `pg.Pool` با عددِ ثابتِ بزرگ رویِ ماشینِ قوی اشکالی ندارد، اما همین عدد رویِ
 * جعبه‌یِ ۲ هسته‌ایِ توسعه (همان که `setup.sh` بالا می‌آورد) فاجعه است: هر
 * بک‌اندِ PostgreSQL دست‌کم ~۱۰۰ مگابایت RSS می‌گیرد، پس بیست اتصال یعنی دو
 * گیگابایت رمِ رفته، و بیست پرس‌وجویِ هم‌زمان رویِ دو هسته فقط صف می‌سازد —
 * که در آن صف، هر درخواستِ دیگری هم پشتِ پرس‌وجوها می‌خوابد و «رم پر می‌شود و
 * API هنگ می‌کند» از همین‌جا شروع می‌شود. قانونِ سرانگشتیِ خودِ PostgreSQL
 * «دو برابرِ هسته‌هایِ در دسترس» است؛ پس عدد با ماشین بزرگ و کوچک می‌شود.
 *
 * `DB_POOL_MAX` همیشه برنده است (ماشینِ پر‌هسته، یا چند نمونه‌یِ API پشتِ
 * nginx که باید سهمِ هر نمونه را دانست). عددِ بی‌معنی — خالی، صفر، منفی،
 * «چیزی» — نادیده گرفته می‌شود، چون `Number('') === 0` است و استخری با
 * `max: 0` هیچ اتصالی نمی‌دهد: سرویس بالا می‌آید، سلامتش هم ۲۰۰ می‌دهد، و
 * اولین درخواستِ واقعی تا ابد منتظر می‌ماند. همان دامِ `getNumber`ها.
 */
export function resolvePoolSize(raw: string | undefined, cores: number): number {
  const fallback = Math.min(20, Math.max(4, Math.round(cores) * 2));
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 1 || n > 200) return fallback;
  return Math.floor(n);
}

/** پشتیبانِ PostgreSQL واقعی (تولید) */
function createPostgresDatabase(connectionString: string): Database {
  const pool = new pg.Pool({
    connectionString,
    max: resolvePoolSize(process.env.DB_POOL_MAX, os.availableParallelism?.() ?? os.cpus().length),
    // اگر پایگاه‌داده لحظه‌ای در دسترس نبود، کل سیستم از کار نیفتد
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await pool.query(sql, params as unknown[]);
      return normalize(res);
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const wrapped: Transaction = {
          async query<R>(sql: string, params: unknown[] = []) {
            const res = await client.query(sql, params as unknown[]);
            return normalize(res);
          },
          async exec(sql: string) {
            await client.query(sql);
          },
        };
        const out = await fn(wrapped);
        await client.query('COMMIT');
        return out;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

/**
 * مقدارِ DB_URL سه حالت دارد:
 *   memory://          → درون‌فرآیندی (تست)
 *   ./مسیر یا /مسیر     → PGlite روی دیسک (توسعه)
 *   postgres://…       → PostgreSQL واقعی (تولید)
 */
export function createDatabase(url: string = process.env.DB_URL ?? 'memory://'): Database {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    return createPostgresDatabase(url);
  }
  return createPgliteDatabase(url);
}
