/**
 * سنجشِ «سیاستِ نگهداریِ داده» رویِ PostgreSQLِ واقعی (نه PGlite).
 *
 * چرا لازم است: این مسیر `DELETE ... WHERE id IN (SELECT ...)`, `WITH`هایِ
 * چندلایه، `pg_advisory_xact_lock` و `pg_total_relation_size` را به کار
 * می‌گیرد — چندتاشان در PGlite معنا/رفتارِ دیگری دارند. همان درسی که دو بار
 * گرفته شد: مسیری که فقط typecheck یا فقط PGlite رد شده، «سنجیده» نیست.
 *
 * اجرا:  DB_URL="postgres://…" npx tsx scripts/pg-retention-drill.mts
 */
import { createDatabase, applyMigrations, type Database } from '@set/db';
import { setSetting, getSetting } from '../packages/commerce/src/settings.js';
import {
  RETENTION_KEYS,
  purgeExpiredData,
  readRetentionPolicy,
  readDays,
} from '../packages/commerce/src/housekeeping.js';

const URL = process.env.DB_URL;
if (!URL) throw new Error('DB_URL لازم است');

const db: Database = createDatabase(URL);
await applyMigrations(db);

let fails = 0;
const ok = (name: string, cond: boolean, extra = ''): void => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

const PHONE = '09125556677';
const MARK = 'ret-drill';

async function clean(): Promise<void> {
  await db.query(`DELETE FROM sms_outbox WHERE phone = $1`, [PHONE]);
  await db.query(`DELETE FROM audit_logs WHERE entity = $1`, [MARK]);
  await db.query(`DELETE FROM rate_limit_counters WHERE bucket_key LIKE $1`, [`${MARK}%`]);
  await db.query(`DELETE FROM rate_limit_events WHERE bucket_key LIKE $1`, [`${MARK}%`]);
  for (const key of Object.values(RETENTION_KEYS)) {
    await db.query(`DELETE FROM store_settings WHERE key = $1`, [key]);
  }
}
await clean();

// ── ۱) readDays رویِ رشته‌هایِ واقعیِ pg ─────────────────────────────────────
ok('رشتهٔ خالی = پیش‌فرض (نه صفر!)', readDays('', 60) === 60);
ok('«۰» صریح = صفر (نه پیش‌فرض)', readDays('0', 60) === 0);
ok('رقمِ فارسی خوانده می‌شود', readDays('۹۰', 60) === 90);
ok('منفی/بی‌عدد = پیش‌فرض', readDays('-3', 60) === 60 && readDays('x', 60) === 60);
ok(
  'کلیدِ نبودہ در store_settings، پیش‌فرضِ کد را می‌دهد',
  (await readRetentionPolicy(db)).smsOutboxDays === 60,
  JSON.stringify(await readRetentionPolicy(db)),
);

// ── ۲) داده‌یِ واقعی: سطل‌ها، ممیزی، پیامک ──────────────────────────────────
async function sms(status: string, daysAgo: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO sms_outbox (phone, template_key, body, status, attempts, created_at, sent_at)
     VALUES ($1, 'order_paid', 'متنِ آزمون', $2, 1, now() - ($3 || ' days')::interval,
             CASE WHEN $2 = 'sent' THEN now() - ($3 || ' days')::interval ELSE NULL END)
     RETURNING id::text AS id`,
    [PHONE, status, String(daysAgo)],
  );
  return rows[0]!.id;
}
async function audit(daysAgo: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO audit_logs (action, entity, created_at)
     VALUES ('test.action', $1, now() - ($2 || ' days')::interval)
     RETURNING id::text AS id`,
    [MARK, String(daysAgo)],
  );
  return rows[0]!.id;
}

const oldSent = await sms('sent', 200);
const oldDead = await sms('dead', 200);
const oldPending = await sms('pending', 200);
const oldSending = await sms('sending', 200);
const oldFailed = await sms('failed', 200);
const freshSent = await sms('sent', 5);
const oldAudit = await audit(500);
const freshAudit = await audit(1);
await db.query(
  `INSERT INTO rate_limit_counters (rule_name, bucket_key, window_started_at, count)
   VALUES ('order.create', $1, now() - interval '30 days', 9)`,
  [`${MARK}-old`],
);
await db.query(
  `INSERT INTO rate_limit_counters (rule_name, bucket_key, window_started_at, count)
   VALUES ('order.create', $1, now() - interval '1 days', 2)`,
  [`${MARK}-new`],
);
await db.query(
  `INSERT INTO rate_limit_events (rule_name, bucket_key, window_started_at, ip, seen, created_at, last_seen_at)
   VALUES ('order.create', $1, now() - interval '30 days', '5.5.5.5', 4,
           now() - interval '30 days', now() - interval '30 days')`,
  [`${MARK}-old`],
);

const alive = async (table: 'sms_outbox' | 'audit_logs', id: string) =>
  Number((await db.query(`SELECT COUNT(*)::text n FROM ${table} WHERE id = $1::uuid`, [id])).rows[0]!.n) > 0;

// ── ۳) پیش‌نمایش: بی‌کشتن، عددِ درست ────────────────────────────────────────
await setSetting(db, RETENTION_KEYS.smsOutboxDays, '60');
await setSetting(db, RETENTION_KEYS.observabilityDays, '7');
const preview = await purgeExpiredData(db, { dryRun: true });
ok('dryRun: دو پیامکِ تمام‌شدهٔ کهنه شمرده شد', preview.tables.smsOutbox.removed === 2, JSON.stringify(preview.tables.smsOutbox));
ok('dryRun: چیزی پاک نشد', await alive('sms_outbox', oldSent) && await alive('sms_outbox', oldPending), '');
ok('dryRun: آمارِ مهارِ بار هم شمرده شد', preview.tables.observability.removed === 2, JSON.stringify(preview.tables.observability));
ok('dryRun: ممیزی خاموش است (پیش‌فرض ۰، چون کلیدش پاک شد)', preview.tables.auditLog.removed === 0, JSON.stringify(preview.tables.auditLog));

// ── ۴) اجرایِ واقعی رویِ pg ──────────────────────────────────────────────────
const run = await purgeExpiredData(db, { batchLimit: 5_000 });
ok('اجرا: دو پیامکِ تمام‌شده رفت', run.tables.smsOutbox.removed === 2, JSON.stringify(run.tables.smsOutbox));
ok('اجرا: sent/dead کهنه پاک شد', !(await alive('sms_outbox', oldSent)) && !(await alive('sms_outbox', oldDead)));
ok('اجرا: صفِ زنده (pending/sending/failed) دست‌نخورد', await alive('sms_outbox', oldPending) && await alive('sms_outbox', oldSending) && await alive('sms_outbox', oldFailed));
ok('اجرا: sentِ تازه ماند', await alive('sms_outbox', freshSent));
ok('اجرا: سطلِ کهنه رفت و تازه ماند', (await db.query(`SELECT bucket_key FROM rate_limit_counters WHERE bucket_key LIKE $1`, [`${MARK}%`])).rows.map((r) => r.bucket_key).join() === `${MARK}-new`, '');
ok('اجرا: ردِّ مسدودشدنِ کهنه رفت', (await db.query(`SELECT COUNT(*)::text n FROM rate_limit_events WHERE bucket_key LIKE $1`, [`${MARK}%`])).rows[0]!.n === '0');
ok('اجرا: ممیزی (خاموش) دست‌نخورد', await alive('audit_logs', oldAudit) && await alive('audit_logs', freshAudit));
ok('جمله‌هایِ گزارش رقمِ فارسی دارند', !run.notes.join(' ').match(/[0-9]/), run.notes.join(' / ').slice(0, 90));

// ── ۵) دسته‌ای: با LIMITِ کوچک، چند دور لازم است ────────────────────────────
for (let i = 0; i < 6; i++) await sms('sent', 200);
const batch1 = await purgeExpiredData(db, { batchLimit: 4 });
ok('LIMIT رعایت شد (۴ تا در این دور)', batch1.tables.smsOutbox.removed === 4, JSON.stringify(batch1.tables.smsOutbox));
ok('«باقی‌مانده» درست گفته شد', batch1.tables.smsOutbox.remaining === 6, '');
const batch2 = await purgeExpiredData(db, { batchLimit: 4 });
ok('دورِ دوم بقیه را برد', batch2.tables.smsOutbox.removed === 2, JSON.stringify(batch2.tables.smsOutbox));

// ── ۶) قفلِ مشورتی: دو اجرایِ هم‌زمان، یک برنده ─────────────────────────────
for (let i = 0; i < 3; i++) await sms('sent', 400);
const [a1, a2] = await Promise.all([purgeExpiredData(db, { batchLimit: 10 }), purgeExpiredData(db, { batchLimit: 10 })]);
const totalRemoved = a1.tables.smsOutbox.removed + a2.tables.smsOutbox.removed;
ok('با قفل، هیچ پیامکی دو بار «کاشته» نشد', totalRemoved === 3, `${a1.tables.smsOutbox.removed} + ${a2.tables.smsOutbox.removed}`);
ok('پس ازِ دو دور، صفِ تمام‌شدهٔ کهنه خالی است', (await db.query(`SELECT COUNT(*)::text n FROM sms_outbox WHERE status='sent' AND created_at < now() - interval '300 days'`)).rows[0]!.n === '0');

// ── ۷) سیاست از پنل، تازه خوانده می‌شود (نه کش‌شده) ─────────────────────────
await setSetting(db, RETENTION_KEYS.smsOutboxDays, '۳۰');
ok('عددِ فارسیِ ذخیره‌شده در پنل خوانده می‌شود', (await readRetentionPolicy(db)).smsOutboxDays === 30, String(await getSetting(db, RETENTION_KEYS.smsOutboxDays)));
await setSetting(db, RETENTION_KEYS.smsOutboxDays, '0');
const off = await purgeExpiredData(db);
ok('با «۰» هیچ پیامکی پاک نشد', off.tables.smsOutbox.removed === 0 && (await alive('sms_outbox', freshSent)));

// ── ۸) اندازهٔ جدول‌ها (همان کوئریِ مسیرِ پنل) ──────────────────────────────
const sizes = (
  await db.query<{ t: string; bytes: string; rows: string }>(
    `SELECT c.relname AS t, pg_total_relation_size(c.oid)::text AS bytes,
            GREATEST(c.reltuples, 0)::bigint::text AS rows
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind = 'r'
        AND c.relname IN ('sms_outbox','audit_logs','rate_limit_events','rate_limit_counters')
      ORDER BY pg_total_relation_size(c.oid) DESC`,
  )
).rows;
ok('کوئریِ اندازه رویِ pg کار می‌کند', sizes.length === 4, JSON.stringify(sizes.map((x) => `${x.t}:${x.bytes}B`)));

await clean();
ok('پاکسازی: چیزی از آزمون نمانده', (await db.query(`SELECT COUNT(*)::text n FROM sms_outbox WHERE phone = $1`, [PHONE])).rows[0]!.n === '0' &&
  (await db.query(`SELECT COUNT(*)::text n FROM audit_logs WHERE entity = $1`, [MARK])).rows[0]!.n === '0');
await db.close();

console.log(fails === 0 ? '\nهمهٔ سنجه‌ها رویِ PostgreSQLِ واقعی پاس شد.' : `\n${fails} سنجه شکست خورد.`);
process.exitCode = fails === 0 ? 0 : 1;
