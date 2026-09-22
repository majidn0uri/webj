import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type Database } from '@set/db';
import { applyMigrations } from '@set/db';
import { setSetting } from './settings.js';
import {
  RETENTION_DEFAULTS,
  RETENTION_KEYS,
  purgeExpiredData,
  readRetentionPolicy,
} from './housekeeping.js';

/**
 * سنجشِ سیاستِ نگهداری.
 *
 * چیزی که اینجا مهم است، «چیزی که نباید برود» است، نه چیزی که می‌رود: یک
 * پاک‌سازیِ خودکار که صفِ زنده یا ردِّ حسابرسی را هم ببلعد، بدتر از جدولِ
 * پُر است — چون خرابی‌اش بی‌صدا و برگشت‌ناپذیر است. پس سنجه‌ها بیشتر «دست
 * نبردن» را می‌سنجند تا «کشتن» را.
 */

let db: Database;

beforeEach(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  await setSetting(db, 'store_name', 'ست‌شاپ');
  // سیاستِ پیش‌فرضِ مهاجرت‌ها را پاک می‌کنیم تا هر آزمون عددِ خودش را بگذارد
  for (const key of Object.values(RETENTION_KEYS)) {
    await db.query(`DELETE FROM store_settings WHERE key = $1`, [key]);
  }
});

afterEach(async () => {
  await db.close();
});

async function sms(x: {
  status?: string;
  daysAgo?: number;
  phone?: string;
}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO sms_outbox (phone, template_key, body, status, attempts, created_at, sent_at)
     VALUES ($1, 'order_paid', 'متن', $2, 1, now() - ($3 || ' days')::interval,
             CASE WHEN $2 = 'sent' THEN now() - ($3 || ' days')::interval ELSE NULL END)
     RETURNING id::text AS id`,
    [x.phone ?? '09121110000', x.status ?? 'sent', String(x.daysAgo ?? 0)],
  );
  return rows[0]!.id;
}

async function audit(action: string, daysAgo: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO audit_logs (action, entity, created_at)
     VALUES ($1, 'test', now() - ($2 || ' days')::interval)
     RETURNING id::text AS id`,
    [action, String(daysAgo)],
  );
  return rows[0]!.id;
}

async function exists(table: 'sms_outbox' | 'audit_logs', id: string): Promise<boolean> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ${table} WHERE id = $1::uuid`,
    [id],
  );
  return Number(rows[0]!.n) > 0;
}

async function counter(bucket: string, daysAgo: number): Promise<void> {
  await db.query(
    `INSERT INTO rate_limit_counters (rule_name, bucket_key, window_started_at, count)
     VALUES ('order.create', $1, now() - ($2 || ' days')::interval, 3)`,
    [bucket, String(daysAgo)],
  );
}

async function blockedEvent(daysAgo: number): Promise<void> {
  await db.query(
    `INSERT INTO rate_limit_events (rule_name, bucket_key, window_started_at, ip, seen, created_at, last_seen_at)
     VALUES ('order.create', 'b', now() - ($1 || ' days')::interval, '5.5.5.5', 1,
             now() - ($1 || ' days')::interval, now() - ($1 || ' days')::interval)`,
    [String(daysAgo)],
  );
}

describe('readRetentionPolicy', () => {
  it('پیش‌فرض‌ها اگر هیچ کلیدی در پنل نباشد', async () => {
    const p = await readRetentionPolicy(db);
    expect(p).toEqual({ ...RETENTION_DEFAULTS });
  });

  it('«۰» یک تصمیمِ آگاهانه است، نه «بی‌مقدار»', async () => {
    await setSetting(db, RETENTION_KEYS.auditLogDays, '0');
    await setSetting(db, RETENTION_KEYS.smsOutboxDays, '0');
    const p = await readRetentionPolicy(db);
    expect(p.auditLogDays).toBe(0);
    expect(p.smsOutboxDays).toBe(0);
  });

  it('عددِ بی‌اعتبار و منفی به پیش‌فرض برمی‌گردند (نه صفر، نه خطا)', async () => {
    await setSetting(db, RETENTION_KEYS.observabilityDays, 'چیزی');
    await setSetting(db, RETENTION_KEYS.smsOutboxDays, '-5');
    const p = await readRetentionPolicy(db);
    expect(p.observabilityDays).toBe(RETENTION_DEFAULTS.observabilityDays);
    expect(p.smsOutboxDays).toBe(RETENTION_DEFAULTS.smsOutboxDays);
  });

  it('رقمِ فارسی در پنل پذیرفته می‌شود (کاربر با کیبوردِ فارسی می‌نویسد)', async () => {
    await setSetting(db, RETENTION_KEYS.smsOutboxDays, '۹۰');
    expect((await readRetentionPolicy(db)).smsOutboxDays).toBe(90);
  });
});

describe('purgeExpiredData — صفِ پیامک', () => {
  it('پیامکِ فرستاده‌شدهٔ کهنه می‌رود، تازه‌ها می‌مانند', async () => {
    await setSetting(db, RETENTION_KEYS.smsOutboxDays, '60');
    const gone = await sms({ status: 'sent', daysAgo: 61 });
    const kept = await sms({ status: 'sent', daysAgo: 59 });
    const report = await purgeExpiredData(db);
    expect(report.tables.smsOutbox.removed).toBe(1);
    expect(await exists('sms_outbox', gone)).toBe(false);
    expect(await exists('sms_outbox', kept)).toBe(true);
  });

  it('صفِ زنده هرگز دست نمی‌خورد، حتی ده سال مانده باشد', async () => {
    await setSetting(db, RETENTION_KEYS.smsOutboxDays, '60');
    const pending = await sms({ status: 'pending', daysAgo: 3650 });
    const failed = await sms({ status: 'failed', daysAgo: 3650 });
    const sending = await sms({ status: 'sending', daysAgo: 1 });
    const freshPending = await sms({ status: 'pending', daysAgo: 1 });
    await purgeExpiredData(db);
    expect(await exists('sms_outbox', pending)).toBe(true);
    expect(await exists('sms_outbox', failed)).toBe(true);
    expect(await exists('sms_outbox', sending)).toBe(true);
    expect(await exists('sms_outbox', freshPending)).toBe(true);
  });

  it('«ناامیدکننده» پاک می‌شود — بازگردانی‌اش پس ازِ دو سال فایده‌ای ندارد', async () => {
    await setSetting(db, RETENTION_KEYS.smsOutboxDays, '30');
    const dead = await sms({ status: 'dead', daysAgo: 40 });
    await purgeExpiredData(db);
    expect(await exists('sms_outbox', dead)).toBe(false);
  });

  it('با مهلتِ صفر، هیچ پیامکی کشته نمی‌شود', async () => {
    await setSetting(db, RETENTION_KEYS.smsOutboxDays, '0');
    const old = await sms({ status: 'sent', daysAgo: 9999 });
    const report = await purgeExpiredData(db);
    expect(report.tables.smsOutbox.removed).toBe(0);
    expect(report.tables.smsOutbox.days).toBe(0);
    expect(await exists('sms_outbox', old)).toBe(true);
  });

  it('dryRun همان عددِ اجرا را می‌دهد و چیزی را نمی‌کُشد', async () => {
    await setSetting(db, RETENTION_KEYS.smsOutboxDays, '10');
    for (let i = 0; i < 5; i++) await sms({ status: 'sent', daysAgo: 30 });
    const preview = await purgeExpiredData(db, { dryRun: true });
    expect(preview.tables.smsOutbox.removed).toBe(5);
    expect(preview.tables.smsOutbox.remaining).toBe(5);
    expect((await db.query(`SELECT COUNT(*)::text n FROM sms_outbox`)).rows[0]!.n).toBe('5');
    const real = await purgeExpiredData(db);
    expect(real.tables.smsOutbox.removed).toBe(preview.tables.smsOutbox.removed);
  });

  it('دسته‌ای کار می‌کند: محدودهِ هر دور رعایت می‌شود و «باقی‌مانده» درست گفته می‌شود', async () => {
    await setSetting(db, RETENTION_KEYS.smsOutboxDays, '10');
    for (let i = 0; i < 12; i++) await sms({ status: 'sent', daysAgo: 30 });
    const first = await purgeExpiredData(db, { batchLimit: 5 });
    expect(first.tables.smsOutbox.removed).toBe(5);
    expect(first.batchLimit).toBe(5);
    expect(first.tables.smsOutbox.remaining).toBe(12);
    const second = await purgeExpiredData(db, { batchLimit: 5 });
    expect(second.tables.smsOutbox.removed).toBe(5);
    // ۱۲ − ۵ − ۵ = ۲ تا مانده؛ پنل باید بگوید «هنوز هست، دفعهٔ بعد»
    expect(second.notes.join(' ')).toContain('۲ سطرِ دیگر');
    await purgeExpiredData(db, { batchLimit: 5 });
    await purgeExpiredData(db, { batchLimit: 5 });
    expect((await db.query(`SELECT COUNT(*)::text n FROM sms_outbox`)).rows[0]!.n).toBe('0');
  });

  it('محدودهِ batchLimit کلمپ می‌شود (نه منفی، نه بی‌نهایت)', async () => {
    expect((await purgeExpiredData(db, { batchLimit: -4 })).batchLimit).toBe(5_000);
    expect((await purgeExpiredData(db, { batchLimit: 10_000_000 })).batchLimit).toBe(50_000);
  });
});

describe('purgeExpiredData — ممیزی و آمارِ مهارِ بار', () => {
  it('پیش‌فرضِ ممیزی «هرگز پاک نکن» است', async () => {
    const old = await audit('sms.outbox_requeued', 4000);
    const report = await purgeExpiredData(db);
    expect(report.policy.auditLogDays).toBe(0);
    expect(report.tables.auditLog.removed).toBe(0);
    expect(await exists('audit_logs', old)).toBe(true);
    // و «صفرِ پیش‌فرض» بی‌سروصدا است: مدیر چیزی ننوشته، پس جمله‌ای هم دربارهٔ
    // تصمیمش به او نمی‌گوییم (گزارشِ خالی باید خالی بماند)
    expect(report.notes.join(' ')).toContain('چیزی برایِ پاک‌سازی نبود');
  });

  it('اگر صفر را خودِ مدیر نوشته باشد، همان در گزارش گفته می‌شود', async () => {
    await setSetting(db, RETENTION_KEYS.auditLogDays, '0');
    await audit('order.create', 4000);
    const report = await purgeExpiredData(db);
    expect(report.tables.auditLog.removed).toBe(0);
    expect(report.notes.join(' ')).toContain('هرگز پاک نمی‌شود');
  });

  it('اگر مدیر روشنش کرد، سطرهایِ کهنه می‌روند و تازه‌ها می‌مانند', async () => {
    await setSetting(db, RETENTION_KEYS.auditLogDays, '365');
    const old = await audit('order.create', 400);
    const fresh = await audit('order.create', 364);
    await purgeExpiredData(db);
    expect(await exists('audit_logs', old)).toBe(false);
    expect(await exists('audit_logs', fresh)).toBe(true);
  });

  it('سطل‌ها و ردِّ مسدودشدن‌ها با هم می‌روند (آمارِ کج نسازد)', async () => {
    await setSetting(db, RETENTION_KEYS.observabilityDays, '7');
    await counter('a', 10);
    await counter('b', 1);
    await blockedEvent(10);
    await blockedEvent(2);
    const report = await purgeExpiredData(db);
    expect(report.tables.observability.removed).toBe(2);
    const buckets = await db.query(`SELECT bucket_key FROM rate_limit_counters`);
    expect(buckets.rows.map((r) => r.bucket_key).sort()).toEqual(['b']);
    const events = await db.query(`SELECT seen FROM rate_limit_events`);
    expect(events.rows.length).toBe(1);
  });

  it('با مهلتِ صفر، آمارِ مهارِ بار هم دست‌نخورده می‌ماند', async () => {
    await setSetting(db, RETENTION_KEYS.observabilityDays, '0');
    await counter('a', 999);
    const report = await purgeExpiredData(db);
    expect(report.tables.observability.removed).toBe(0);
    expect((await db.query(`SELECT COUNT(*)::text n FROM rate_limit_counters`)).rows[0]!.n).toBe('1');
  });
});

describe('گزارشِ خوانا', () => {
  it('رقم‌هایِ جمله‌ها فارسی‌اند («1 پیامک» در متنِ فارسی، باقی‌ماندهٔ کار است)', async () => {
    await setSetting(db, RETENTION_KEYS.smsOutboxDays, '10');
    await sms({ status: 'sent', daysAgo: 30 });
    const report = await purgeExpiredData(db);
    const text = report.notes.join(' ');
    expect(text).not.toMatch(/[0-9]/);
    expect(text).toContain('۱ پیامکِ تمام‌شده');
  });

  it('وقتی کاری نیست، جمله‌اش این است: «چیزی برایِ پاک‌سازی نبود»', async () => {
    const report = await purgeExpiredData(db);
    expect(report.notes).toEqual(['چیزی برایِ پاک‌سازی نبود — همه‌چیز تازه‌تر از مهلتِ نگهداری است.']);
  });

  it('پیش‌نمایش جملهٔ «اجرایِ بعدی» را نمی‌گوید (چیزی قرار است بعداً برود؟ نه، الان فقط شمارش است)', async () => {
    await setSetting(db, RETENTION_KEYS.smsOutboxDays, '1');
    for (let i = 0; i < 4; i++) await sms({ status: 'sent', daysAgo: 9 });
    const report = await purgeExpiredData(db, { dryRun: true, batchLimit: 2 });
    expect(report.notes.join(' ')).not.toContain('اجرایِ بعدی');
    // و در نسخهٔ واقعی همان جمله هست، چون چیزی «برایِ دورِ بعد» می‌ماند
    const real = await purgeExpiredData(db, { batchLimit: 2 });
    expect(real.notes.join(' ')).toContain('۲ سطرِ دیگر');
  });
});
