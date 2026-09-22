import type { Queryable } from '@set/db';
import { getSetting } from './settings.js';
import { faDigits } from './sms-send.js';
import { readDays, readRetentionPolicy } from './housekeeping.js';

/**
 * پایشِ مسیرِ پیامک — «آیا صف واقعاً جلو می‌رود؟»
 *
 * تشخیصِ تنظیمات (`smsReadiness`) می‌گوید «چه چیزی را پر کن»؛ این فایل سؤالی
 * دیگر را جواب می‌دهد: تنظیمات کامل است، صف هم پیام دارد، اما **چیزی نمی‌رود**.
 * در نصبِ واقعی این حالت یعنی واحدِ systemd اجرا نمی‌شود (تایمر نصب نشده،
 * سرویس fail شده، DB_URLِ کارگر غلط است) — و تنها نشانه‌اش در پنل امروز این بود
 * که «در صف» همیشه ۱۲ است. یک فروشگاهِ تمام‌وقتشیت پیامک را دو هفته از دست
 * می‌دهد و هیچ‌کس نمی‌فهمد.
 *
 * چرا «آخرینِ ارسال» و نه «آخرینِ اجرایِ کارگر»؟ چون برایِ پاسخِ این سؤال به
 * جدولِ heart-beat نیاز نداریم: `sent_at` و `attempts` خودشان اثرِ انگشتِ کارگر
 * اند. اگر کارگر زنده باشد و کاری باشد، چیزی در `sms_outbox` تکان می‌خورد.
 * تنها حالتِ مبهم «همه در مهلتِ تلاشِ دوباره» است (پس ازِ قطعیِ سامانه) و آن را
 * در پیامِ هشدار می‌گوییم، نه این‌که وانمود کنیم کارگر مرده است.
 */

export interface SmsHourBucket {
  /** شروعِ ساعت به epoch (برچسبِ ساعت در پنل از همین ساخته می‌شود) */
  hour: number;
  enqueued: number;
  sent: number;
  failed: number;
  dead: number;
}

/**
 * تبدیلِ ارزشِ زمان — و دلیلِ بودنش: `pg` در تولید ستون‌هایِ `timestamptz` را
 * **رشته** می‌دهد (در `packages/db` هیچ typeParser‌ی نشاندہ نشده) و PGlite خودِ
 * Date. بی‌این تابع، همین مسیر رویِ PostgreSQLِ واقعی با «getTime is not a
 * function» می‌ترکید و در آزمون (که رویِ PGlite است) کاملاً سبز می‌ماند —
 * یعنی همان شکافی که نه typecheck می‌بیند و نه PGlite.
 */
export function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface SmsStats {
  hours: number;
  buckets: SmsHourBucket[];
  totals: { enqueued: number; sent: number; failed: number; dead: number };
  /** در JSON به رشتهٔ ISO تبدیل می‌شوند؛ پنل با `Intl` تاریخ می‌سازد */
  lastSentAt: Date | null;
  lastAttemptAt: Date | null;
  /** پیام‌هایِ رسیده‌یِ نوبت (pending/failedِ سررسیدشده) */
  dueNow: number;
  /** پیام‌هایی که در مهلتِ تلاشِ دوباره‌اند — «نمی‌روند» ولی اشکالی هم نیست */
  inBackoff: number;
  staleAfterMinutes: number;
  /** دقیقه‌ها از آخرین تکانهٔ صف؛ null یعنی هرگز چیزی نفرستاده شده */
  minutesSinceActivity: number | null;
  workerLooksStalled: boolean;
  /** چرا این هشدار داده شد — یک جمله‌یِ خوانا، نه دو عدد */
  reason: string | null;
  /** چندتا از پیام‌هایِ نوبت‌خورده «ناامیدکننده»‌اند (دکمهٔ بازگردانی لازم است) */
  stuckDead: number;
  /** سیاستِ نگهداری: صفی که هرگز پاک نشود، چند ماه بعد کُند می‌شود */
  retention: { smsOutboxDays: number; auditLogDays: number; observabilityDays: number };
  /** چند پیامکِ «تمام‌شده» مهلتِ نگهداری‌اش را رد کرده (یعنی پاک‌سازی لازم است) */
  purgeable: number;
}

const DEFAULT_STALE_MINUTES = 70;

/**
 * یک کوئری برایِ همه‌چیز: سطل‌هایِ ساعتی، شمارش‌ها و آخرینِ تکانه.
 *
 * سطل‌ها با `floor(extract(epoch …)/3600)` ساخته می‌شوند و نه `date_trunc`،
 * چون مسیرِ پایش باید در PGlite (جایی که آزمون‌ها اجرا می‌شوند) هم دقیقاً همان
 * SQLِ PostgreSQLِ واقعی را بدود — دو لهجه، دو نتیجه، و «نمودار در پنل با
 * آزمون نمی‌خورد» شدنِ باگ.
 */
export async function smsStats(db: Queryable, opts: { hours?: number } = {}): Promise<SmsStats> {
  const hours = Math.min(Math.max(Number(opts.hours ?? 24) || 24, 3), 168);

  const [{ rows: buckets }, { rows: meta }] = await Promise.all([
    // سطل‌ها را خودِ پایگاه می‌سازد، نه `for` در JS. دلیلش یک باگِ واقعیِ همین
    // نسخه است: وقتی ساعتِ شروع در JS با `Date.now()` حساب می‌شد و مرزِ پنجره
    // در SQL با `now() - interval`، دو دقیقه اختلافِ «خواندنِ ساعت» باعث شد
    // پیامکی که SQL شمرده بود در هیچ سطلی جا نشود و نمودار کم‌شمارد (۲ پیام →
    // ۱). حالا فهرستِ سطل‌ها و داده‌شان از یک NOW() می‌آیند.
    db.query<{ h: string; enq: string; sent: string; failed: string; dead: string }>(
      `WITH RECURSIVE bounds AS (
         -- bigint: در هر دو لهجه نوعِ صریح، بی‌تبدیلِ ضمنی به float8
         SELECT floor(extract(epoch from date_trunc('hour', NOW() - ($1 || ' hours')::interval)))::bigint AS first_h,
                floor(extract(epoch from date_trunc('hour', NOW())))::bigint AS last_h
       ),
       -- generate_series عمداً استفاده نشده: PGlite نسخهٔ سه‌آرگومانِ bigint
       -- را ندارد و بی‌سروصدا گام را نادیده می‌گیرد (سطل‌ها ۳۶۰۰ «ساعت» جلو
       -- می‌روند و نمودار خالی می‌ماند). ریکروزیو در هر دو لهجه یک جواب می‌دهد
       grid AS (
         SELECT first_h AS h FROM bounds
         UNION ALL
         SELECT g.h + 3600 FROM grid g CROSS JOIN bounds b WHERE g.h + 3600 <= b.last_h
       ),
       per_hour AS (
         SELECT floor(extract(epoch from date_trunc('hour', created_at)))::bigint AS h,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'sent') AS sent,
                COUNT(*) FILTER (WHERE status = 'failed') AS failed,
                COUNT(*) FILTER (WHERE status = 'dead') AS dead
           FROM sms_outbox
          WHERE created_at >= NOW() - ($1 || ' hours')::interval
          GROUP BY 1
       )
       SELECT g.h::text AS h,
              COALESCE(p.total, 0)::text AS enq,
              COALESCE(p.sent, 0)::text AS sent,
              COALESCE(p.failed, 0)::text AS failed,
              COALESCE(p.dead, 0)::text AS dead
         FROM grid g
         LEFT JOIN per_hour p ON p.h = g.h::bigint
        ORDER BY g.h`,
      [String(hours)],
    ),
    db.query<{
      last_sent: Date | null;
      last_attempt: Date | null;
      due_now: string;
      in_backoff: string;
      stuck_dead: string;
    }>(
      `SELECT
         MAX(sent_at) AS last_sent,
         -- «آخرینِ تکانه» ردپایِ واقعیِ کارگر است (last_attempt_at در لحظهٔ
         -- برداشتنِ پیام نوشته می‌شود) — نه available_at که نوبتِ «بعد» است
         GREATEST(MAX(sent_at), MAX(last_attempt_at)) AS last_attempt,
         COUNT(*) FILTER (
           WHERE status IN ('pending','failed') AND available_at <= now()
         )::text AS due_now,
         COUNT(*) FILTER (
           WHERE status IN ('pending','failed') AND available_at > now()
         )::text AS in_backoff,
         COUNT(*) FILTER (WHERE status = 'dead')::text AS stuck_dead
       FROM sms_outbox`,
    ),
  ]);

  const series: SmsHourBucket[] = buckets.map((r) => ({
    hour: Number(r.h),
    enqueued: Number(r.enq),
    sent: Number(r.sent),
    failed: Number(r.failed),
    dead: Number(r.dead),
  }));

  const totals = series.reduce(
    (a, b) => ({
      enqueued: a.enqueued + b.enqueued,
      sent: a.sent + b.sent,
      failed: a.failed + b.failed,
      dead: a.dead + b.dead,
    }),
    { enqueued: 0, sent: 0, failed: 0, dead: 0 },
  );

  const m = meta[0] ?? {
    last_sent: null,
    last_attempt: null,
    due_now: '0',
    in_backoff: '0',
    stuck_dead: '0',
  };
  const dueNow = Number(m.due_now);
  const inBackoff = Number(m.in_backoff);
  const stuckDead = Number(m.stuck_dead);
  const lastSentAt = toDate(m.last_sent);
  const lastActivity = toDate(m.last_attempt) ?? lastSentAt;
  const minutesSinceActivity = lastActivity
    ? Math.max(0, Math.round((Date.now() - lastActivity.getTime()) / 60_000))
    : null;

  // «نوبت مانده و هیچ تکانه‌ای» = کارگر اجرا نمی‌شود. staleAfter از پنل
  // خوانده می‌شود تا کسی که تایمرِ systemd را عوض می‌کند، مجبور نباشد کد عوض کند
  const staleAfterMinutes = Math.max(
    readDays(await getSetting(db, 'sms_worker_stale_minutes'), DEFAULT_STALE_MINUTES),
    5,
  );
  const stalled = (dueNow > 0 || stuckDead > 0) && (minutesSinceActivity ?? Infinity) >= staleAfterMinutes;

  let reason: string | null = null;
  if (stalled) {
    // «هیچ‌وقت» با «۰ دقیقه» یکی نیست: اولین سطرِ یکِ نصبِ تازه هیچ ردپایی ندارد
    // و نوشتنِ `null دقیقه` یعنی کارتِ پایش خودش خراب‌گفتار است
    const since = minutesSinceActivity === null ? 'هنوز هیچ‌وقت' : `${faDigits(minutesSinceActivity)} دقیقه است`;
    reason =
      dueNow === 0 && stuckDead > 0
        ? `${faDigits(stuckDead)} پیام «ناامیدکننده» است و ${since} صف تکان نخورده — دکمهٔ «بازگرداندن» لازم است.`
        : `${faDigits(dueNow)} پیام در نوبت است و ${since} چیزی فرستاده نشده — یا کارگرِ صف اجرا نمی‌شود، یا همه‌یِ پیام‌ها در مهلتِ تلاشِ دوباره‌اند (بلافاصله بعدِ قطعیِ سامانه این طبیعی است).`;
  } else if (inBackoff > 0 && dueNow === 0 && (lastSentAt === null || (minutesSinceActivity ?? 0) > staleAfterMinutes / 2)) {
    reason = `${faDigits(inBackoff)} پیام در مهلتِ تلاشِ دوباره‌اند؛ هیچ‌کدام الان نوبت ندارد.`;
  }

  // «چرا پنل کند شده؟» بیشتر اوقات جوابش این است: صفی که هیچ‌وقت کوچک نشده.
  // بی‌این دو عدد، هشدارِ کندی فقط یک حدسِ عمومی است
  const retention = await readRetentionPolicy(db);
  const purgeable =
    retention.smsOutboxDays > 0
      ? Number(
          (
            await db.query<{ n: string }>(
              `SELECT COUNT(*)::text AS n FROM sms_outbox
                WHERE status IN ('sent','dead')
                  AND created_at < now() - ($1 || ' days')::interval`,
              [String(retention.smsOutboxDays)],
            )
          ).rows[0]?.n ?? 0,
        )
      : 0;

  return {
    hours,
    buckets: series,
    totals,
    lastSentAt,
    lastAttemptAt: lastActivity,
    dueNow,
    inBackoff,
    staleAfterMinutes,
    minutesSinceActivity,
    workerLooksStalled: stalled,
    reason,
    stuckDead,
    retention,
    purgeable,
  };
}
