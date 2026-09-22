import type { Queryable } from '@set/db';
import { getSetting } from './settings.js';
import { faDigits } from './sms-send.js';

/**
 * پاک‌سازیِ دوره‌ای (retention) — خانه‌ای از پنل که واقعاً کار می‌کند.
 *
 * سه جدول در این فروشگاه فقط بزرگ می‌شوند و هیچ‌وقت کوچک: `sms_outbox` (متنِ
 * پیامک با شمارهٔ مشتری)، `audit_logs`، و دو جدولِ آمارِ مهارِ بار. بی‌سیاستِ
 * نگهداری، «صندوقِ پیامک» و «پایشِ صف» رویِ سروری که چند سال باز نشده رویِ
 * میلیونها سطرِ مرده کوئری می‌زنند — و صفحهٔ پنل دقیقاً همان‌جا می‌ماند که
 * مدیر باید مشکلِ دیگری را تشخیص بدهد.
 *
 * چهار قاعده که از رویِ راحتی برنداشته شده:
 *
 *  ۱) **صفِ زنده دست نمی‌خورد.** هرگز پیامکِ `pending`/`sending`/`failed` پاک
 *     نمی‌شود، حتی اگر سال‌ها مانده باشد — پاک‌کردنش یعنی گم‌شدنِ یک تعهدِ
 *     فرستاده‌نشده. فقط چیزهایِ «تمام‌شده» (`sent`، و `dead` که بازگردانی‌اش هم
 *     فایده‌ای نداشته) می‌روند.
 *  ۲) **۰ یعنی هرگز.** صفر یک عددِ بی‌معنا نیست؛ یعنی مدیر آگاهانه انتخاب
 *     کرده چیزی پاک نشود. بی‌این، «پاک‌سازیِ خودکار» می‌تواند ردِّ لازمِ
 *     حسابرسی را از بین ببرد. (پیش‌فرضِ `audit_log_retention_days` هم عمدتاً ۰
 *     است: پاک‌کردنِ ردِّ عملیات، تصمیمِ مدیر است نه تصمیمِ یک تایمر.)
 *  ۳) **پیش‌نمایش همان شمارشی را می‌دهد که اجرا می‌کُشد.** برآوردِ «در این دور»
 *     هم با همان `LIMIT` ساخته می‌شود، پس عددِ دکمه با عددِ نتیجه نمی‌جنگد.
 *  ۴) **دسته‌ای، نه یک‌باره.** `DELETE` رویِ میلیونها سطر، قفلِ طولانی و یک
 *     vacuumِ سنگین می‌سازد — یعنی همان «سنگین شدنِ سرور» که مدیر چند بار
 *     پرسیده چرا. اجرای‌هایِ بعدیِ همان کارگر، بقیه را می‌برد.
 */

/** سیاستِ پیش‌فرضِ نگهداری — اگر کلیدی در پنل نبود یا بی‌اعتبار بود */
export const RETENTION_DEFAULTS = {
  smsOutboxDays: 60,
  auditLogDays: 0,
  observabilityDays: 7,
} as const;

/** نامِ کلیدها در `store_settings` (همان‌ها که در تنظیماتِ پنل دیده می‌شوند) */
export const RETENTION_KEYS = {
  smsOutboxDays: 'sms_outbox_retention_days',
  auditLogDays: 'audit_log_retention_days',
  observabilityDays: 'observability_retention_days',
} as const;

export interface RetentionPolicy {
  smsOutboxDays: number;
  auditLogDays: number;
  observabilityDays: number;
}

export interface PurgeOptions {
  /** بی‌این سه عدد، سیاست از تنظیماتِ پنل خوانده می‌شود */
  policy?: Partial<RetentionPolicy>;
  /** برآوردِ بی‌حذف‌کردن — همان شمارش، بدونِ DELETE */
  dryRun?: boolean;
  /** در هر دور چند سطر کشته شود */
  batchLimit?: number;
  /**
   * قفلِ مشورتیِ سطحِ تراکنش (پیش‌فرض: روشن).
   *
   * پاک‌سازی هم در API (هر ۵ دقیقه) و هم در کارگرِ پس از فروش اجرا می‌شود؛
   * بدونِ قفل، دو فرآیند هم‌زمان یک دسته را «می‌کشند» — یکی برنده است و
   * دیگری بلوکه می‌ماند یا کارِ تکراری می‌کند. با `pg_advisory_xact_lock`
   * نفوذِ دوم صبر می‌کند و بعد صفر می‌بیند، و قفل با پایانِ تراکنش آزاد
   * می‌شود — نه با `pg_advisory_unlock` دستی، که رویِ استخرِ اتصالِ `pg`
   * یعنی «اتصالِ دیگری آن را باز کند» و قفل تا مرگِ اتصال در دست می‌ماند.
   */
  useAdvisoryLock?: boolean;
}

export interface TablePurge {
  /** چند سطر در این دور حذف شد (در dryRun: چند سطر **می‌شد**) */
  removed: number;
  /** چند سطر کلاً واجدِ شرط است — تا پنل بگوید «هنوز هست، دوباره بزن» */
  remaining: number;
  /** سیاستِ جاری به روز؛ ۰ یعنی عمداً خاموش */
  days: number;
  /** کلیدِ تنظیم، تا پنل بداند کدام خانه را نشان دهد */
  settingKey: string;
}

export interface PurgeReport {
  dryRun: boolean;
  batchLimit: number;
  policy: RetentionPolicy;
  tables: {
    smsOutbox: TablePurge;
    auditLog: TablePurge;
    observability: TablePurge;
  };
  /** جمله‌هایِ خوانا برایِ پنل، با رقمِ فارسی */
  notes: string[];
}

/**
 * تبدیلِ رشته‌یِ تنظیم به عددِ روز.
 *
 * سه دام که باید با هم باز شوند:
 *  • `Number('')` صفر است — و کلیدِ نبودہ در `store_settings` رشتهٔ خالی
 *    می‌دهد؛ بی‌این بررسی، «تنظیمِ نشده» یعنی «هرچه کهنه‌تر از امروز است را
 *    پاک کن» — یعنی صفی که با اولینِ اجرایِ کارگر خالی می‌شود.
 *  • `0` مجاز و معنادار است («هرگز پاک نکن»)، پس نمی‌توان با `||` یا با
 *    «0 بی‌اعتبار است» از آن رد شد.
 *  • کیبوردِ کاربر فارسی است: «۹۰» باید خوانده شود.
 */
/** کلیدِ یکتایِ قفلِ مشورتیِ همین کار (شماره‌ای که هیچ کارِ دیگری استفاده نمی‌کند) */
export const PURGE_ADVISORY_LOCK_KEY = 72_037_001;

export function readDays(value: unknown, fallback: number): number {
  const raw = String(value ?? '').trim();
  if (raw === '') return fallback;
  const n = Number(raw.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/** سیاستِ جاری از `store_settings` — هر بار خوانده می‌شود تا تغییرِ پنل فوری اثر کند */
export async function readRetentionPolicy(db: Queryable): Promise<RetentionPolicy> {
  // سه خواندن پشتِ سرِ هم، نه با Promise.all: استخرِ `pg` ممکن است هر سه را رویِ
  // یک اتصال بیندازد و `pg` این را deprecated دانسته («query در حالِ اجراست») —
  // در pg@9 خطا. اینجا سرعت اهمیتی ندارد (یک بار در هر دورِ کارگر).
  const sms = await getSetting(db, RETENTION_KEYS.smsOutboxDays);
  const audit = await getSetting(db, RETENTION_KEYS.auditLogDays);
  const obs = await getSetting(db, RETENTION_KEYS.observabilityDays);
  return {
    smsOutboxDays: readDays(sms, RETENTION_DEFAULTS.smsOutboxDays),
    auditLogDays: readDays(audit, RETENTION_DEFAULTS.auditLogDays),
    observabilityDays: readDays(obs, RETENTION_DEFAULTS.observabilityDays),
  };
}

/** «چند سطر واجدِ شرط است و چندتاش در این دور جا می‌شود» — یک کوئری، یک NOW() */
async function countStale(db: Queryable, predicate: string, days: number, limit: number) {
  const { rows } = await db.query<{ stale: string; batch: string }>(
    `SELECT COUNT(*)::text AS stale,
            LEAST(COUNT(*), $2::bigint)::text AS batch
       FROM ${predicate}`,
    [String(days), String(limit)],
  );
  const r = rows[0] ?? { stale: '0', batch: '0' };
  return { stale: Number(r.stale), batch: Number(r.batch) };
}

/** شرطِ «تمام‌شده و کهنه» — تنها چیزهایی که کشته می‌شوند */
const SMS_WHERE = `sms_outbox
        WHERE status IN ('sent','dead')
          AND created_at < now() - ($1 || ' days')::interval`;

const AUDIT_WHERE = `audit_logs
        WHERE created_at < now() - ($1 || ' days')::interval`;

/**
 * «چه چیزی در این دور می‌سوزد» می‌تواند سخت‌گیرانه‌تر از «چه چیزی شمرده
 * می‌شود» باشد. اینجا دقیقاً همین لازم است: صفِ زنده (`pending`/`sending`/
 * `failed`) در هیچ شمارشی نمی‌آید و نباید در DELETE هم وارد شود — یک
 * باگِ یک‌خطی در همین نقطه، پیامک‌هایِ «فرستاده‌نشده» را هم با سال‌ها
 * کهنگی می‌کُشت و گم‌شدنشان هیچ‌وقت در آزمونِ «چندتا رفت؟» دیده نمی‌شد.
 */
const SMS_DELETE_WHERE = SMS_WHERE;
const AUDIT_DELETE_WHERE = AUDIT_WHERE;

/**
 * دو جدولِ مهارِ بار با هم می‌روند: «سطل‌ها» بی‌وقفه پر می‌شوند و ردِّ
 * مسدودشدن‌ها هم همان‌جاست؛ نگه‌داشتنِ یکی و کشتنِ دیگری، آمارِ کج می‌سازد
 * («چرا ۴۰۰۰ مسدودشدن در ۹۰ سطلِ باقی‌مانده نیست؟»).
 */
async function purgeObservability(
  db: Queryable,
  days: number,
  limit: number,
  dryRun: boolean,
): Promise<{ removed: number; remaining: number }> {
  const eventWhere = `rate_limit_events
        WHERE last_seen_at < now() - ($1 || ' days')::interval`;
  const counters = await countStale(
    db,
    `rate_limit_counters
        WHERE window_started_at < now() - ($1 || ' days')::interval`,
    days,
    limit,
  );
  const events = await countStale(db, eventWhere, days, limit);
  const remaining = counters.stale + events.stale;
  const batch = counters.batch + events.batch;
  if (dryRun) return { removed: batch, remaining };

  // «سطل‌ها» بی‌LIMIT می‌روند (هر دور ریز‌ریزند و تعدادشان به تعدادِ سقف‌ها
  // وابسته است، نه به ترافیک)؛ ردِّ مسدودشدن‌ها دسته‌ای، چون می‌تواند انباشته شود
  const { rows } = await db.query<{ n: string }>(
    `WITH e AS (
        DELETE FROM rate_limit_events
         WHERE id IN (SELECT id FROM rate_limit_events
                       WHERE last_seen_at < now() - ($1 || ' days')::interval
                       ORDER BY last_seen_at LIMIT $2)
        RETURNING 1
      ),
      b AS (
        DELETE FROM rate_limit_counters
         WHERE window_started_at < now() - ($1 || ' days')::interval
        RETURNING 1
      )
      SELECT ((SELECT COUNT(*) FROM e) + (SELECT COUNT(*) FROM b))::text AS n`,
    [String(days), String(limit)],
  );
  return { removed: Number(rows[0]?.n ?? 0), remaining };
}

async function purgeOne(
  db: Queryable,
  spec: { table: string; where: string; deleteWhere: string; days: number; limit: number; dryRun: boolean },
): Promise<{ removed: number; remaining: number }> {
  const { table, where, deleteWhere, days, limit, dryRun } = spec;
  const { stale, batch } = await countStale(db, where, days, limit);
  if (dryRun) return { removed: batch, remaining: stale };
  // حذف از «همان شرطِ شمرده‌شده» با همان LIMIT — نه از یک بازنویسیِ جدا.
  // دو نسخه از یک شرط یعنی یکی LIMIT را گم می‌کند (اینجا دقیقاً همین شد:
  // «دسته‌ای» معنا‌اش را از دست داد و همه را یک‌جا کُشت)
  const { rows } = await db.query<{ n: string }>(
    `WITH doomed AS (
        SELECT id FROM ${deleteWhere}
         ORDER BY created_at
         LIMIT $2
       ),
       gone AS (
        DELETE FROM ${table} WHERE id IN (SELECT id FROM doomed) RETURNING 1
      )
      SELECT COUNT(*)::text AS n FROM gone`,
    [String(days), String(limit)],
  );
  return { removed: Number(rows[0]?.n ?? 0), remaining: stale };
}

/**
 * اجرایِ یک دورِ پاک‌سازی.
 *
 * `remaining` با «چیزی که در این دور کشتیم» یکی نیست: پاک‌سازی دسته‌ای است و
 * پنل باید بداند «هنوز هست، دوباره بزن» — وگرنه مدیر عددِ پیش‌نمایش را دروغ
 * می‌بیند.
 */
export async function purgeExpiredData(db: Queryable, opts: PurgeOptions = {}): Promise<PurgeReport> {
  if (opts.useAdvisoryLock !== false) {
    const tx = (db as unknown as {
      transaction?: <T>(fn: (t: Queryable) => Promise<T>) => Promise<T>;
    }).transaction;
    if (typeof tx === 'function') {
      return tx((inner) =>
        (async () => {
          // خروجی مهم نیست؛ خودِ «گرفتنِ قفل» هدف است (این تابع NULL می‌دهد)
          await inner.query(`SELECT pg_advisory_xact_lock(${PURGE_ADVISORY_LOCK_KEY})`);
          return purgeExpiredData(inner, { ...opts, useAdvisoryLock: false });
        })(),
      );
    }
  }
  const wanted = Number(opts.batchLimit ?? 5_000);
  const limit = Number.isFinite(wanted) && wanted >= 1
    ? Math.min(Math.floor(wanted), 50_000)
    : 5_000;
  const dryRun = opts.dryRun === true;
  const stored = await readRetentionPolicy(db);
  const policy: RetentionPolicy = { ...stored, ...(opts.policy ?? {}) };
  // «صفر» را فقط وقتی توضیح می‌دهیم که خودِ مدیر نوشته باشد؛ پیش‌فرضِ بی‌صدا
  // نباید در هر گزارشِ خالی جمله‌ای اضافه کند
  const auditExplicit =
    stored.auditLogDays <= 0 &&
    (
      await db.query(`SELECT 1 FROM store_settings WHERE key = $1`, [RETENTION_KEYS.auditLogDays])
    ).rows.length > 0;

  const zero = { removed: 0, remaining: 0 };
  const run = async (
    base: { table: string; where: string; deleteWhere: string },
    days: number,
  ): Promise<TablePurge> => {
    if (days <= 0) return { ...zero, days: 0, settingKey: '' };
    const r = await purgeOne(db, { ...base, days, limit, dryRun });
    return { ...r, days, settingKey: '' };
  };

  const smsOutbox = await run(
    { table: 'sms_outbox', where: SMS_WHERE, deleteWhere: SMS_DELETE_WHERE },
    policy.smsOutboxDays,
  );
  const auditLog = await run(
    { table: 'audit_logs', where: AUDIT_WHERE, deleteWhere: AUDIT_DELETE_WHERE },
    policy.auditLogDays,
  );
  const obsRaw =
    policy.observabilityDays <= 0 ? zero : await purgeObservability(db, policy.observabilityDays, limit, dryRun);
  const observability: TablePurge = { ...obsRaw, days: policy.observabilityDays, settingKey: '' };

  const notes: string[] = [];
  const label = dryRun ? 'خواهد شد' : 'شد';
  if (smsOutbox.removed > 0) {
    notes.push(
      `${faDigits(smsOutbox.removed)} پیامکِ تمام‌شده ${label} (بیش از ${faDigits(smsOutbox.days)} روز).`,
    );
  }
  if (auditLog.days <= 0 && auditExplicit) {
    notes.push('ردِّ عملیاتِ مدیریتی هرگز پاک نمی‌شود (برایِ اختلافِ مالی لازم است).');
  } else if (auditLog.removed > 0) {
    notes.push(`${faDigits(auditLog.removed)} سطرِ ممیزی ${label} (بیش از ${faDigits(auditLog.days)} روز).`);
  }
  if (observability.removed > 0) {
    notes.push(`${faDigits(observability.removed)} سطرِ آمارِ مهارِ بار ${label}.`);
  }
  const queued = smsOutbox.remaining - smsOutbox.removed + (auditLog.days > 0 ? auditLog.remaining - auditLog.removed : 0) + observability.remaining - observability.removed;
  if (!dryRun && queued > 0) {
    notes.push(`${faDigits(queued)} سطرِ دیگر هم واجدِ شرط است؛ اجرایِ بعدی آن‌ها را می‌برد.`);
  }
  if (notes.length === 0) {
    notes.push('چیزی برایِ پاک‌سازی نبود — همه‌چیز تازه‌تر از مهلتِ نگهداری است.');
  }

  return {
    dryRun,
    batchLimit: limit,
    policy,
    tables: {
      smsOutbox: { ...smsOutbox, settingKey: RETENTION_KEYS.smsOutboxDays },
      auditLog: { ...auditLog, settingKey: RETENTION_KEYS.auditLogDays },
      observability: { ...observability, settingKey: RETENTION_KEYS.observabilityDays },
    },
    notes,
  };
}
