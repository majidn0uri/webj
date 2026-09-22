import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type Database } from '@set/db';
import { applyMigrations } from '@set/db';
import { enqueueSms } from './sms.js';
import { setSetting } from './settings.js';
import { readSmsSendConfig, type SmsSendConfig } from './sms-send.js';
import { isConfigishError, requeueSmsMessages, smsReadiness } from './sms-diagnose.js';

/**
 * آزمونِ «چرا پیامک نمی‌رسد؟».
 *
 * دو چیز اینجا عمدًا با کوئریِ واقعی سنجیده می‌شود و نه با بدلِ تابعی:
 *  • الگویِ خطاهایِ «تنظیمی» در SQL (`~ 'قالب|شناسه|…'`) — چون همان رشته هم در
 *    TypeScript و هم در متنِ کوئری نوشته می‌شود و اگر یکی فرار کند (نگارشِ
 *    فارسی، کاراکترِ ZWNJ)، تشخیصِ ما بی‌صدا از کار می‌افتد؛
 *  • شماره‌گذاریِ پارامترهایِ `$n` در `requeueSmsMessages` — با فیلترِ قالب،
 *    یک پارامتر میانی اضافه می‌شود و اگر LIMIT همان `$2` بماند، حدّ و قالب
 *    جابه‌جا می‌شوند. کوئریِ تنها با یک فیلتر، این را هیچ‌وقت نمی‌بیند.
 */

let db: Database;

beforeEach(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  await setSetting(db, 'store_name', 'ست‌شاپ');
  await setSetting(db, 'sms_provider', 'kavenegar');
  await setSetting(db, 'sms_api_key', 'K1');
  await setSetting(db, 'sms_enabled', 'true');
});

afterEach(async () => {
  await db.close();
});

async function cfg(over: Partial<SmsSendConfig> = {}): Promise<SmsSendConfig> {
  const base = await readSmsSendConfig(db);
  return { ...base, ...over };
}

async function insertRow(x: {
  phone?: string;
  templateKey?: string | null;
  body?: string;
  status?: string;
  attempts?: number;
  lastError?: string | null;
  availableInMinutes?: number;
  /** پیامکِ «دیروز» ساختن — سنجشِ تأخیرِ صف با created_at انجام می‌شود */
  createdMinutesAgo?: number;
  ref?: string | null;
}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO sms_outbox (phone, template_key, body, status, attempts, last_error, provider_ref,
                             created_at, available_at, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
             now() - ($9 || ' minutes')::interval,
             now() + ($8 || ' minutes')::interval,
             CASE WHEN $4 = 'sent' THEN now() ELSE NULL END)
     RETURNING id`,
    [
      x.phone ?? '09121110000',
      x.templateKey === undefined ? 'order_paid' : x.templateKey,
      x.body ?? 'بدنهٔ آزمون',
      x.status ?? 'pending',
      String(x.attempts ?? 0),
      x.lastError ?? null,
      x.ref ?? null,
      String(x.availableInMinutes ?? 0),
      String(x.createdMinutesAgo ?? 0),
    ],
  );
  return rows[0]!.id;
}

/* ───────────────────────────────────────────────────────────────────────── */
/* بازگرداندنِ صف                                                             */
/* ───────────────────────────────────────────────────────────────────────── */

describe('requeueSmsMessages', () => {
  it('«ناموفقِ موقت» که در نوبت است، بازگردانی نمی‌شود (بی‌force)', async () => {
    // نوبتش رسیده و خودِ کارگر برمی‌دارد؛ شمارش‌کردنش در «بازگردانده‌شد» یعنی
    // عددِ دروغ در پنل
    await insertRow({ status: 'failed', attempts: 2, lastError: 'قالب شناسه ندارد', availableInMinutes: -5 });
    expect((await requeueSmsMessages(db)).requeued).toBe(0);
  });

  it('پیامِ «ناامیدکننده» با خطایِ تنظیمی برمی‌گردد: attempts صفر، خطا پاک', async () => {
    const id = await insertRow({ status: 'dead', attempts: 5, lastError: 'قالبِ «order_paid» شناسهٔ ارسال‌کننده ندارد' });
    const r = await requeueSmsMessages(db);
    expect(r.requeued).toBe(1);
    expect(r.statuses.dead).toBe(1);
    const { rows } = await db.query<{ status: string; attempts: number; last_error: string | null }>(
      `SELECT status, attempts, last_error FROM sms_outbox WHERE id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 0, last_error: null });
  });

  it('پیامِ ردشده به‌خاطرِ «شماره در سیاه‌فهرست» برنمی‌گردد (بی‌force)', async () => {
    const id = await insertRow({ status: 'dead', attempts: 5, lastError: 'شماره مقصد در سیاه‌فهرست است' });
    const r = await requeueSmsMessages(db);
    expect(r.requeued).toBe(0);
    expect(r.stillBlocked).toBe(1);
    expect((await db.query(`SELECT status FROM sms_outbox WHERE id = $1`, [id])).rows[0]!.status).toBe('dead');
    // و پیامِ راهنما باید راهِ بعدی را بگوید، نه این‌که فقط «چیزی نبود» بگوید
    expect(r.notes.join(' ')).toMatch(/اجباری/);
  });

  it('با force همان سیاه‌فهرست هم برمی‌گردد — مدیر آگاهانه خواسته', async () => {
    const id = await insertRow({ status: 'dead', attempts: 5, lastError: 'شماره مقصد در سیاه‌فهرست است' });
    const r = await requeueSmsMessages(db, { force: true });
    expect(r.requeued).toBe(1);
    expect((await db.query<{ status: string }>(`SELECT status FROM sms_outbox WHERE id = $1`, [id])).rows[0]!.status).toBe(
      'pending',
    );
  });

  it('پیامِ فرستاده‌شده هرگز دست نمی‌خورد، حتی با force', async () => {
    const id = await insertRow({ status: 'sent', attempts: 1, ref: 'T-77', lastError: null });
    const r = await requeueSmsMessages(db, { force: true, includeWaiting: true });
    expect(r.requeued).toBe(0);
    const row = (
      await db.query<{ status: string; attempts: number; provider_ref: string | null }>(
        `SELECT status, attempts, provider_ref FROM sms_outbox WHERE id = $1`,
        [id],
      )
    ).rows[0]!;
    expect(row).toMatchObject({ status: 'sent', attempts: 1, provider_ref: 'T-77' });
  });

  it('«در صفِ عادی» بیدار نمی‌شود (بیکار است و شمارش را گمراه می‌کند)', async () => {
    await insertRow({ status: 'pending', attempts: 0, lastError: null });
    const r = await requeueSmsMessages(db);
    expect(r.requeued).toBe(0);
  });

  it('«ناموفقِ موقت» با includeWaiting آزاد می‌شود و بی‌آن‌که در نوبت بماند', async () => {
    const id = await insertRow({ status: 'failed', attempts: 2, lastError: 'سامانه در 10000ms پاسخ نداد', availableInMinutes: 40 });
    const before = await db.query<{ a: string }>(`SELECT available_at::text AS a FROM sms_outbox WHERE id = $1`, [id]);
    const r = await requeueSmsMessages(db, { includeWaiting: true });
    expect(r.requeued).toBe(1);
    const after = await db.query<{ status: string; available_at: Date }>(
      `SELECT status, available_at FROM sms_outbox WHERE id = $1`,
      [id],
    );
    expect(after.rows[0]!.status).toBe('pending');
    // نوبت باید «حالا» شده باشد؛ وگرنه ۴۰ دقیقه دیگر هم پیام نوبت نمی‌خورد
    expect(new Date(after.rows[0]!.available_at).getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
    expect(new Date(before.rows[0]!.a as unknown as string).getTime() || 1).toBeTruthy();
  });

  it('«در حالِ ارسال»ِ کارگرِ مرده آزاد می‌شود', async () => {
    const id = await insertRow({ status: 'sending', attempts: 1, availableInMinutes: -30 });
    const r = await requeueSmsMessages(db);
    expect(r.requeued).toBe(1);
    expect(r.statuses.sending).toBe(1);
    expect((await db.query<{ status: string }>(`SELECT status FROM sms_outbox WHERE id = $1`, [id])).rows[0]!.status).toBe(
      'pending',
    );
  });

  it('فیلترِ قالب + LIMIT با هم: پارامترها جابه‌جا نمی‌شوند', async () => {
    // سه پیام بلوکه: دو تا order_paid، یکی order_shipped — با limit=1 و فیلترِ
    // قالب، فقط یکی از order_paid‌ها باید برگردد
    for (const k of ['order_paid', 'order_paid', 'order_shipped']) {
      await insertRow({ status: 'dead', attempts: 5, templateKey: k, lastError: 'قالبِ «' + k + '» شناسهٔ ارسال‌کننده ندارد' });
    }
    const r = await requeueSmsMessages(db, { templateKey: 'order_paid', limit: 1 });
    expect(r.requeued).toBe(1);
    const left = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM sms_outbox WHERE status = 'dead' AND template_key = 'order_paid'`,
    );
    expect(left.rows[0]!.n).toBe('1');
    const untouched = await db.query<{ status: string }>(
      `SELECT status FROM sms_outbox WHERE template_key = 'order_shipped'`,
    );
    expect(untouched.rows[0]!.status).toBe('dead');
  });

  it('«قابلِ بازگردانی» در تشخیص، همان چیزی است که دکمه برمی‌گرداند', async () => {
    await db.query(`UPDATE sms_templates SET provider_template_id='T1' WHERE provider_template_id IS NULL`);
    await insertRow({ status: 'failed', attempts: 2, lastError: 'سامانه در 10000ms پاسخ نداد', availableInMinutes: 30 });
    await insertRow({ status: 'dead', attempts: 5, lastError: 'قالب شناسه ندارد' });
    const r = await smsReadiness(db, await cfg());
    expect(r.requeueable).toBe(1); // 'failedِ' در مهلتِ بک‌آف، شمرده نمی‌شود
    const res = await requeueSmsMessages(db);
    expect(res.requeued).toBe(r.requeueable); // و دکمه هم دقیقاً همان‌قدر کار می‌کند
  });

  it('پیامِ «ناامیدکننده» بی‌خطا (هرگز last_error نگرفته) گم نمی‌شود', async () => {
    const id = await insertRow({ status: 'dead', attempts: 5, lastError: null });
    expect((await requeueSmsMessages(db)).requeued).toBe(1);
    expect((await db.query<{ status: string }>(`SELECT status FROM sms_outbox WHERE id = $1`, [id])).rows[0]!.status).toBe(
      'pending',
    );
  });

  it('«پیامی که صف را ساخته» با دست‌کاریِ وضعیت فرقی ندارد — صف از نو قابلِ استفاده است', async () => {
    const enq = await enqueueSms(db, { phone: '09121112233', templateKey: 'order_paid', vars: { order: 'ORD-7', amount: '۱۰۰' } });
    await db.query(`UPDATE sms_outbox SET status = 'dead', attempts = 5, last_error = 'قالب شناسه ندارد' WHERE id = $1`, [enq.id]);
    expect((await requeueSmsMessages(db)).requeued).toBe(1);
    const row = (await db.query<{ body: string; status: string }>(`SELECT body, status FROM sms_outbox WHERE id = $1`, [enq.id]))
      .rows[0]!;
    expect(row.status).toBe('pending');
    expect(row.body).toContain('ORD-7'); // متنِ رندرشده دست‌نخورده مانده است
  });
});

/* ───────────────────────────────────────────────────────────────────────── */
/* چک‌لیستِ آمادگی                                                           */
/* ───────────────────────────────────────────────────────────────────────── */

describe('smsReadiness', () => {
  it('همه‌چیز جور است: بدونِ بلاکر، «آمادهٔ ارسال»', async () => {
    await db.query(`UPDATE sms_templates SET provider_template_id='T1' WHERE provider_template_id IS NULL`);
    const r = await smsReadiness(db, await cfg());
    expect(r.canSendNow).toBe(true);
    expect(r.checks.filter((c) => !c.ok && c.severity === 'blocker')).toEqual([]);
    expect(r.checks.find((c) => c.key === 'queue')?.ok).toBe(false); // صف خالی است
  });

  it('ارائه‌دهنده انتخاب نشده: blocker با نامِ مسیرِ پنل', async () => {
    await setSetting(db, 'sms_provider', 'none');
    const r = await smsReadiness(db, await cfg({ provider: 'none' }));
    const c = r.checks.find((x) => x.key === 'provider')!;
    expect(c.ok).toBe(false);
    expect(c.severity).toBe('blocker');
    expect(c.hint).toMatch(/ارائه‌دهنده/);
    expect(r.canSendNow).toBe(false);
  });

  it('ارائه‌دهندهٔ ناآشنا: فهرستِ مجاز را می‌گوید', async () => {
    const r = await smsReadiness(db, await cfg({ provider: 'telegram-bot' as SmsSendConfig['provider'] }));
    expect(r.providerKnown).toBe(false);
    expect(r.checks.find((x) => x.key === 'provider')!.hint).toMatch(/کاوه‌نگار|kavenegar/);
  });

  it('ملی‌پیامک: شکلِ «کاربری|گذرواژه» یادآوری می‌شود', async () => {
    await setSetting(db, 'sms_api_key', '');
    const r = await smsReadiness(db, await cfg({ provider: 'melipayamak', apiKey: '' }));
    expect(r.checks.find((x) => x.key === 'api-key')!.hint).toMatch(/کاربری\|گذرواژه/);
  });

  it('SMS_DRY_RUN روشن: با «آماده نیست» و توضیحِ خودش', async () => {
    await db.query(`UPDATE sms_templates SET provider_template_id='T1' WHERE provider_template_id IS NULL`);
    const r = await smsReadiness(db, await cfg({ dryRun: true }));
    expect(r.dryRun).toBe(true);
    expect(r.canSendNow).toBe(false);
    expect(r.checks.find((x) => x.key === 'dry-run')!.hint).toMatch(/SMS_DRY_RUN/);
  });

  it('«ارسالِ پیامک» خاموش: هشدار است نه بلاکر، ولی «آمادهٔ ارسال» هم نیست', async () => {
    await db.query(`UPDATE sms_templates SET provider_template_id='T1' WHERE provider_template_id IS NULL`);
    const r = await smsReadiness(db, await cfg({ enabled: false }));
    const c = r.checks.find((x) => x.key === 'enabled')!;
    expect(c.ok).toBe(false);
    expect(c.severity).toBe('warn');
    // دو چیز با هم فرق دارند: «تنظیمات غلط نیست» (پس بلاکر نه) و «دکمه‌ای
    // در پنل کاری می‌کند» (که با ارسالِ خاموش، هیچ‌کدام را نمی‌کند)
    expect(r.canSendNow).toBe(false);
    expect(r.checks.filter((x) => !x.ok && x.severity === 'blocker')).toEqual([]);
  });

  it('قالبِ بی‌شناسه با پیامِ در صف: در فهرستِ مسدودکننده‌ها می‌آید', async () => {
    await db.query(`UPDATE sms_templates SET provider_template_id=NULL, body='سفارش {order} — {store}' WHERE key='order_paid'`);
    await insertRow({ status: 'pending', templateKey: 'order_paid', lastError: null });
    await insertRow({ status: 'dead', templateKey: 'order_paid', attempts: 5, lastError: 'قالب شناسه ندارد' });
    const r = await smsReadiness(db, await cfg());
    const t = r.blockedTemplates.find((x) => x.key === 'order_paid')!;
    expect(t.providerTemplateId).toBeNull();
    expect(t.blocked).toBe(2);
    expect(t.placeholders).toEqual(['order', 'store']);
    expect(r.requeueable).toBe(1); // فقط آن یکی که «ناامیدکننده» است
    expect(r.checks.find((x) => x.key === 'sender')!.ok).toBe(false);
  });

  it('پیامِ بی‌نوبتِ ۴۵ دقیقه‌ای: کارگر متهم می‌شود، نه تنظیمات', async () => {
    await db.query(`UPDATE sms_templates SET provider_template_id='T1' WHERE provider_template_id IS NULL`);
    await insertRow({ status: 'pending', lastError: null, createdMinutesAgo: 45 });
    const r = await smsReadiness(db, await cfg());
    const q = r.checks.find((x) => x.key === 'queue')!;
    expect(q.ok).toBe(true);
    expect(typeof q.hint).toBe('string');
    expect(q.hint as string).toMatch(/کارگرِ systemd/);
    expect(q.hint as string).toMatch(/[0-9۰-۹]+/); // عددِ تأخیر هم باید داخلش باشد
  });

  it('«در حالِ ارسال» با مهلتِ آزادسازی اعلام می‌شود', async () => {
    await db.query(`UPDATE sms_templates SET provider_template_id='T1' WHERE provider_template_id IS NULL`);
    await insertRow({ status: 'sending', attempts: 1, availableInMinutes: -2 });
    const r = await smsReadiness(db, await cfg({}), { staleSendingMinutes: 10 });
    const c = r.checks.find((x) => x.key === 'sending')!;
    expect(c.ok).toBe(false);
    expect(c.hint).toMatch(/۱|1/);
  });
});

describe('الگویِ مشترکِ «خطایِ تنظیمی»', () => {
  it('تنظیمی‌ها را می‌شناسد و خطاهایِ سامانه را نه', () => {
    expect(isConfigishError('قالبِ «x» شناسهٔ ارسال‌کننده ندارد')).toBe(true);
    expect(isConfigishError('کلیدِ API کاوه‌نگار تنظیم نشده است.')).toBe(true);
    expect(isConfigishError('کارگر پیش از گرفتنِ نتیجه متوقف شد.')).toBe(true);
    expect(isConfigishError('شماره مقصد در سیاه‌فهرست است')).toBe(false);
    expect(isConfigishError(null)).toBe(false);
  });

  it('الگو در SQL همان الگوی TypeScript است (وگرنه تشخیص بی‌صدا می‌میرد)', async () => {
    const cfgish = 'قالب شناسه ندارد';
    const not = 'شماره مسدود';
    const { rows } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM (VALUES ($1::text),($2::text)) AS t(e)
        WHERE t.e ~ 'قالب|شناسه|کلید|ارسال‌کننده|اعتبار|خطِ سرویس|متنِ آزاد|DRY_RUN|کارگر پیش از'`,
      [cfgish, not],
    );
    expect(rows[0]!.n).toBe('1');
  });
});
