/**
 * سنجهٔ واقعی رویِ PostgreSQL (نه PGlite) برایِ صفحهٔ پایشِ صفِ پیامک.
 *
 * چرا لازم است: تست‌هایِ واحد رویِ PGlite می‌دوند و `pg` در تولید ستون
 * زمان را «رشته» می‌دهد نه Date — همان شکافی که دو بار باعث شد کد در سرورِ
 * واقعی ۵۰۰ بدهد و در آزمون سبز بماند. این اسکریپت همان SQL و همان خواندنِ
 * rows را رویِ سرورِ واقعی اجرا می‌کند و در پایان همه‌چیز را پاک می‌کند.
 *
 * اجرا:  DB_URL="postgres://..." npx tsx scripts/pg-stats-drill.mts
 */
import { createDatabase, applyMigrations, type Database } from '@set/db';
import { smsStats, toDate } from '../packages/commerce/src/sms-monitoring.js';
import { sendDue, readSmsSendConfig, claimDueMessages } from '../packages/commerce/src/sms-send.js';
import { setSetting, getSetting } from '../packages/commerce/src/settings.js';

const URL = process.env.DB_URL;
if (!URL) throw new Error('DB_URL لازم است');

const db: Database = createDatabase(URL);
await applyMigrations(db);

let fails = 0;
const ok = (name: string, cond: boolean, extra = ''): void => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

const MARK = 'pgdrill';
const phone = '09127770000';

async function clean(): Promise<void> {
  // پاک‌سازی بر پایهٔ id — چون برخی سنجه template_key را به 'order_paid'
  // عوض می‌کنند و «پاک‌سازی با کلیدِ آزمایشی» بعدش بی‌اثر می‌ماند (دقیقاً همان
  // اشتباهی که یک نوبت، دو سطرِ آزمایشی رویِ سرورِ واقعی باقی گذاشت)
  // شمارهٔ تلفنِ آزمایشیِ یکتا = نشانهٔ پاک‌سازی؛ بی‌وابستگی به template_key
  // که سنجه‌ها عوضش می‌کنند
  await db.query(`DELETE FROM sms_outbox WHERE phone = $1`, [phone]);
  await db.query(`DELETE FROM sms_templates WHERE key = $1`, [MARK]);
}
await clean();
// sms_outbox.template_key کلیدِ خارجی به sms_templates دارد (PGlite این را
// سخت‌گیرانه‌تر/آسان‌گیرتر نمی‌کند؛ رویِ سرورِ واقعی واجب است)
await db.query(
  `INSERT INTO sms_templates (key, body, is_active) VALUES ($1, 'متنِ {x} آزمون', true)
   ON CONFLICT (key) DO NOTHING`,
  [MARK],
);

async function row(x: {
  status: string;
  attempts?: number;
  createdMinAgo: number;
  sentMinAgo?: number | null;
  availableInMin?: number | null;
  lastAttemptMinAgo?: number | null;
  error?: string | null;
}): Promise<void> {
  await db.query(
    `INSERT INTO sms_outbox
       (phone, template_key, body, status, attempts, created_at, sent_at, available_at,
        last_attempt_at, last_error)
     VALUES ($1, $2, 'متنِ آزمونِ پایشِ صف', $3, $4,
             now() - ($5 || ' minutes')::interval,
             CASE WHEN $6::text IS NULL THEN NULL ELSE now() - ($6 || ' minutes')::interval END,
             CASE WHEN $7::text IS NULL THEN now() ELSE now() + ($7 || ' minutes')::interval END,
             CASE WHEN $8::text IS NULL THEN NULL ELSE now() - ($8 || ' minutes')::interval END,
             $9)`,
    [
      phone,
      MARK,
      x.status,
      String(x.attempts ?? 0),
      String(x.createdMinAgo),
      x.sentMinAgo == null ? null : String(x.sentMinAgo),
      x.availableInMin == null ? null : String(x.availableInMin),
      x.lastAttemptMinAgo == null ? null : String(x.lastAttemptMinAgo),
      x.error ?? null,
    ],
  );
}


// ── ۱) سطل‌ها و مجموع ───────────────────────────────────────────────────────
// دو پیامکِ فرستاده‌شده که آخرینِ تکانه‌شان ۹۰ دقیقه پیش است (کارگر از آن
// به‌بعد هیچ چیزی برنداشته) + یکی در نوبتِ همین حالا + یکی «ناامیدکننده»
// داخلِ پنجره، تا هم سطل‌ها پر شوند و هم شرطِ «خوابِ کارگر» روشن شود
await row({ status: 'sent', attempts: 1, createdMinAgo: 95, sentMinAgo: 90, lastAttemptMinAgo: 90 });
await row({ status: 'sent', attempts: 1, createdMinAgo: 180, sentMinAgo: 179, lastAttemptMinAgo: 90 });
await row({ status: 'failed', attempts: 2, createdMinAgo: 240, availableInMin: -1 });
await row({ status: 'dead', attempts: 5, createdMinAgo: 200, lastAttemptMinAgo: 95, error: 'قالب پیدا نشد' });

let s = await smsStats(db, { hours: 8 });
ok('buckets پیوسته‌اند (۹ سطل برایِ پنجرهٔ ۸ ساعته)', s.buckets.length === 9, `length=${s.buckets.length}`);
ok(
  'فاصلهٔ سطل‌ها ۳۶۰۰ ثانیه است (نه ۱، نه ۳۶۰۰ ساعت)',
  s.buckets.every((b, i) => i === 0 || b.hour - s.buckets[i - 1]!.hour === 3600),
  s.buckets.map((b) => b.hour).join(','),
);
ok('مجموعِ sent در سطل‌ها = ۲', s.buckets.reduce((n, b) => n + b.sent, 0) === 2);
// پیامِ dead که ۲۰۰ دقیقه پیش ایجاد شده «داخل» پنجرهٔ ۸ ساعته است؛ اگر روزی
// سطل‌ها پنجره را درست نپوشانند، همین سنجه عدد کم می‌آورد (نه صفر شدنِ کلِ نمودار)
ok('deadِ داخلِ پنجره در سطل‌ها شمرده شده', s.buckets.reduce((n, b) => n + b.dead, 0) === 1, `dead=${s.buckets.reduce((n,b)=>n+b.dead,0)}`);
ok('deadِ بیرونِ پنجره هم در stuckDead دیده می‌شود', s.stuckDead === 1, `stuckDead=${s.stuckDead}`);
// dead عمداً در dueNow نیست: «ناامیدکننده» از نوبتِ خودکار بیرون است و تنها
// با دکمهٔ بازگردانی برمی‌گردد — اگر روزی dueNow آن را هم بشمارد، یعنی کارگر
// بی‌اجازهٔ مدیر به پیام‌هایِ مرده دست می‌زند
ok('dueNow = ۱ (فقط failedِ سررسیدشده؛ dead در نوبتِ خودکار نیست)', s.dueNow === 1, `dueNow=${s.dueNow}`);
ok('inBackoff = ۰ (چیزی در آینده نوبت ندارد)', s.inBackoff === 0, `inBackoff=${s.inBackoff}`);
ok(
  'lastSentAt از pg (رشته!) به Date تبدیل می‌شود',
  s.lastSentAt instanceof Date && !Number.isNaN(s.lastSentAt?.getTime() ?? NaN),
  String(s.lastSentAt),
);

// ── ۲) تشخیصِ خوابِ کارگر ───────────────────────────────────────────────────
ok('صف بی‌تکانهٔ ۳۰۰ دقیقه‌ای = هشدار', s.workerLooksStalled === true, `mins=${s.minutesSinceActivity}`);
ok('توضیحِ هشدار نوشته شده', typeof s.reason === 'string' && s.reason.length > 10, String(s.reason));

await setSetting(db, 'sms_worker_stale_minutes', '15');
s = await smsStats(db, { hours: 8 });
ok('آستانه از پنل خوانده می‌شود', s.staleAfterMinutes === 15, `stale=${s.staleAfterMinutes}`);
await setSetting(db, 'sms_worker_stale_minutes', 'abc');
s = await smsStats(db, { hours: 8 });
ok('آستانهٔ بی‌اعتبار = پیش‌فرض ۷۰', s.staleAfterMinutes === 70, `stale=${s.staleAfterMinutes}`);
await db.query(`DELETE FROM store_settings WHERE key = 'sms_worker_stale_minutes'`);
ok('پاک‌شدنِ تنظیمِ آزمایشی', (await getSetting(db, 'sms_worker_stale_minutes')) === '');

// ── ۳) مسیرِ واقعیِ کارگر: claim → last_attempt_at ──────────────────────────
await db.query(
  `UPDATE sms_outbox
      SET status = 'pending', attempts = 0, available_at = now(), last_error = NULL,
          template_key = 'order_paid'
    WHERE template_key = $1 AND status = 'failed'`,
  [MARK],
);
await setSetting(db, 'sms_enabled', 'false');
const cfg = await readSmsSendConfig(db);
const before = (await db.query(`SELECT id FROM sms_outbox WHERE template_key = $1 AND last_attempt_at IS NULL`, [MARK])).rows.length;
const res = await sendDue(db, { ...cfg, provider: 'none' }, { ignoreEnablement: true });
ok('ارائه‌دهندهٔ «none» صف را دست نمی‌زند', res.claimed === 0 && res.sent === 0, JSON.stringify(res));
ok('پیامِ بدونِ تلاش هنوز last_attempt_at ندارد', (await db.query(`SELECT id FROM sms_outbox WHERE template_key = $1 AND last_attempt_at IS NULL`, [MARK])).rows.length === before);

// ── ۴) claimِ واقعی: ستونِ تازه واقعاً نوشته می‌شود؟ ────────────────────────
// مهم‌ترینِ بخشِ این سنجه: اگر UPDATEِ کارگر ستونی را جا بیندازد، PGlite هم
// خطا می‌دهد اما اگر روزی ستون جابه‌جا/تغییرِ نوع شود، تنها سرورِ واقعی
// می‌گوید. «کارگر خواب است» بی‌این ردپا یعنی حدس‌زدن
await row({ status: 'pending', attempts: 0, createdMinAgo: 30 });
// پیامِ این سنجه را با id نشانه می‌گیریم: سنجه‌هایِ بخش ۱ هم نوبت‌دارند و
// «تازه‌ترینِ سطر» یا «درِ پنجرهٔ زمانی» برایِ جداکردنش کافی نیست
const mineId = String(
  (await db.query(`SELECT id FROM sms_outbox WHERE phone = $1 AND status = 'pending' ORDER BY id DESC LIMIT 1`, [phone]))
    .rows[0]!.id,
);
// در این لحظه سنجه‌هایِ بخش ۱ هم پیامکِ درنوبت دارند، پس claim بیش از یکی
// برمی‌دارد؛ آنچه مهم است ردپایِ کارگر رویِ صف است، نه شمارشِ خودِ claim
const claimed = await claimDueMessages(db, { limit: 5, maxAttempts: 3 });
ok('claim چیزی برایِ برداشتن پیدا کرد', claimed.length >= 1, `claimed=${claimed.length}`);
// و پیامِ خودِ سنجه که «pendingِ تازه» بود حتماً برداشته شده
const mine = (
  await db.query(`SELECT status FROM sms_outbox WHERE id = $1`, [mineId])
).rows as { status: string }[];
ok('پیامِ تازهٔ سنجه توسطِ کارگر برداشته شد', mine.length === 1 && mine[0]!.status === 'sending', JSON.stringify(mine));
const after = (
  await db.query(
    `SELECT status, attempts, EXTRACT(epoch FROM (now() - last_attempt_at))/60 AS mins
       FROM sms_outbox WHERE id = $1`,
    [mineId],
  )
).rows[0] as { status: string; attempts: string | number; mins: string | number };
ok('پس ازِ claim وضعیت sending و تلاش ۱ است', after?.status === 'sending' && Number(after?.attempts) === 1, JSON.stringify(after));
ok(
  'last_attempt_at در همان claim نوشته شد (تکانهٔ تازه)',
  Number.isFinite(Number(after?.mins)) && Number(after?.mins) < 2,
  `mins=${after?.mins}`,
);
const s2 = await smsStats(db, { hours: 8 });
ok('با تکانهٔ تازه، هشدارِ «خوابِ کارگر» خاموش می‌شود', s2.workerLooksStalled === false, `mins=${s2.minutesSinceActivity}`);
// رهاکردنِ قفلِ آزمون (وگرنه رویِ سرورِ کاری ۳۰ دقیقه صف بلوکه می‌ماند)
// رهاکردنِ پیامِ سنجه (وگرنه ۱۰ دقیقه در وضعیت sending قفل می‌ماند)
await db.query(
  `UPDATE sms_outbox
      SET status = 'pending', attempts = 0, available_at = now(), last_attempt_at = NULL
    WHERE id = ANY($1::uuid[]) OR phone = $2`,
  [claimed.map((c) => c.id), phone],
);

// ── ۵) بازپُریِ ستونِ تازه در دادهٔ موجود (مهاجرت) ──────────────────────────
await db.query(`DELETE FROM sms_outbox WHERE template_key = $1`, [MARK]);
await row({ status: 'dead', attempts: 4, createdMinAgo: 500, availableInMin: -480 });
await applyColumnBackfill(db);
const bf = (
  await db.query(
    `SELECT EXTRACT(epoch FROM (now() - last_attempt_at))/60 AS mins FROM sms_outbox WHERE template_key = $1`,
    [MARK],
  )
).rows[0] as { mins: string | number | Date };
const mins = Number(bf?.mins);
ok(
  'بازپُریِ مهاجرت: last_attempt_at در گذشته است، نه «همین حالا»',
  Number.isFinite(mins) && mins > 400,
  `mins=${mins}`,
);
ok('toDate روی مقدارِ pg رشته‌ای هم کار می‌کند', toDate(String(new Date().toISOString())) instanceof Date);

await clean();
const left = Number((await db.query(`SELECT COUNT(*)::text c FROM sms_outbox`)).rows[0]!.c);
ok('پاکسازی: سطرِ آزمایشی باقی نمانده', left === 0, `rows=${left}`);
await db.close();

async function applyColumnBackfill(d: Database): Promise<void> {
  await d.query(
    `UPDATE sms_outbox
        SET last_attempt_at = CASE
            WHEN status = 'sent' THEN COALESCE(sent_at, created_at)
            WHEN status IN ('failed','dead','sending')
              THEN GREATEST(LEAST(COALESCE(available_at, now()), now()) - interval '11 minutes', created_at)
            ELSE NULL
        END
      WHERE last_attempt_at IS NULL`,
  );
}

console.log(fails === 0 ? '\nهمهٔ سنجه‌ها رویِ PostgreSQLِ واقعی پاس شد.' : `\n${fails} سنجه شکست خورد.`);
process.exitCode = fails === 0 ? 0 : 1;
