import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database, Queryable } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_DIR = join(here, '..', 'migrations');

/** شمارهٔ تکراری ۰۳۹ اصلاح شده؛ نصب‌های قبلی نباید مجوزهای حذف‌شده را دوباره بگیرند. */
const LEGACY_VERSIONS: Record<string, string> = {
  '049_shipping_checks_permissions': '039_shipping_checks_permissions',
};

/** اجرای اتمیک و تکرارپذیرِ مهاجرت‌ها — هر فایل در یک تراکنشِ جداگانه */
/**
 * خرابیِ شاخه‌ی داده‌ی محلی.
 *
 * PGlite روی دیسک در برابرِ «کشته‌شدنِ ناگهانیِ فرآیند» — مانندِ کشته‌شدن بر اثرِ
 * کمبودِ حافظه — مقاوم نیست و ممکن است شاخه‌ی داده خراب شود (تحملِ خرابی ندارد).
 *
 * برخوردِ درست با این وضعیت: تشخیص و دادنِ پیامِ روشن.
 * نه بالا آمدن با خطایی مبهم، و نه — که بسیار بدتر است — پاک‌کردنِ بی‌سر و صدایِ داده.
 * تصمیمِ نهایی درباره‌ی بازسازی بر عهده‌ی انسان است.
 *
 * برای تولید باید از PostgreSQL واقعی استفاده کرد که با WAL از این وضعیت عبور می‌کند.
 */
export class CorruptDatabaseError extends Error {
  constructor(
    // cause از پیش در Error تعریف شده؛ override یعنی آگاهانه همان را پُر می‌کنیم
    override readonly cause: unknown,
    readonly dataDir: string,
  ) {
    super(
      [
        `شاخه‌ی داده‌ی پایگاه سالم نیست: ${dataDir}`,
        ``,
        `دلیلِ معمول: فرآیند هنگامِ نوشتن کشته شده است (کمبودِ حافظه، خاموشیِ ناگهانی).`,
        `PGlite روی دیسک «تحملِ خرابیِ ناگهانی» ندارد.`,
        ``,
        `راهِ حل در توسعه:`,
        `  rm -rf ${dataDir} && npm run start:api     (داده پاک و از نو ساخته می‌شود)`,
        ``,
        `راهِ حل در تولید: DB_URL را به PostgreSQL واقعی بدهید`,
        `  DB_URL=postgres://user:pass@host:5432/db npm run start:api`,
      ].join('\n'),
    );
    this.name = 'CorruptDatabaseError';
  }
}

export async function applyMigrations(
  db: Database,
  dir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<string[]> {
  try {
    await ensureMigrationsTable(db);
  } catch (cause) {
    // نخستین تماس با پایگاه‌داده است — اگر اینجا شکست بخورد،
    // تقریباً همیشه به معنایِ خرابیِ شاخه‌ی داده است، نه خطایِ SQL.
    throw new CorruptDatabaseError(cause, process.env.DB_URL ?? './.data/pg');
  }
  const applied = await getAppliedVersions(db);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  const done: string[] = [];
  for (const file of files) {
    const version = file.replace('.sql', '');
    if (applied.has(version)) continue;

    const legacy = LEGACY_VERSIONS[version];
    if (legacy && applied.has(legacy)) {
      // فقط ثبت نام جدید؛ نام تاریخی برای ممیزی باقی می‌ماند و SQL تکرار نمی‌شود.
      await db.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [version]);
      continue;
    }

    const sql = await readFile(join(dir, file), 'utf8');
    await db.transaction(async (tx: Queryable) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    });
    done.push(version);
  }
  return done;
}

export async function getAppliedVersions(db: Queryable): Promise<Set<string>> {
  const { rows } = await db.query<{ version: string }>('SELECT version FROM schema_migrations');
  return new Set(rows.map((r) => r.version));
}

async function ensureMigrationsTable(db: Queryable): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
}
