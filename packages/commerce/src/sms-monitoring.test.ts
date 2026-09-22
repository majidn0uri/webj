import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type Database } from '@set/db';
import { applyMigrations } from '@set/db';
import { setSetting } from './settings.js';
import { smsStats, toDate } from './sms-monitoring.js';

/**
 * پایشِ صف — سنجشِ «آیا چیزی واقعاً می‌رود؟».
 *
 * سخت‌گیریِ اصلی رویِ «سطل‌هایِ ساعتی» و «تشخیصِ خوابِ کارگر» است؛ هر دو با
 * دادهٔ تاریخ‌دار ساخته می‌شوند، چون با دادهٔ «همین حالا» هیچ‌وقت نمی‌شد فهمید
 * که آستانه کجا رد می‌شود (و آستانه، تنها عددِ مفیدِ این صفحه است).
 */

let db: Database;

beforeEach(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  await setSetting(db, 'store_name', 'ست‌شاپ');
});

afterEach(async () => {
  await db.close();
});

async function row(x: {
  status?: string;
  attempts?: number;
  minutesAgo?: number;
  sentMinutesAgo?: number | null;
  availableInMinutes?: number | null;
  templateKey?: string | null;
}): Promise<void> {
  const mins = x.minutesAgo ?? 0;
  await db.query(
    `INSERT INTO sms_outbox (phone, template_key, body, status, attempts, created_at, sent_at, available_at)
     VALUES ('09121110000', $6, 'متن', $1, $2,
             now() - ($3 || ' minutes')::interval,
             CASE WHEN $4 < 0 THEN NULL ELSE now() - ($4 || ' minutes')::interval END,
             -- $5::text لازم است: بی‌آن، در شاخه‌یِ «NULL» هیچ‌جا از پارامتر
             -- استفاده‌یِ type‌دار نمی‌شود و پایگاه «cannot determine data type»
             -- می‌دهد (خطایِ همین helper، نه کدِ تولید)
             CASE WHEN $5::text IS NULL THEN now() ELSE now() + ($5 || ' minutes')::interval END)`,
    [
      x.status ?? 'pending',
      String(x.attempts ?? 0),
      String(mins),
      x.sentMinutesAgo === null ? '-1' : String(x.sentMinutesAgo ?? mins),
      x.availableInMinutes === undefined || x.availableInMinutes === null ? null : String(x.availableInMinutes),
      x.templateKey === undefined ? 'order_paid' : x.templateKey,
    ],
  );
}

/** شبکهٔ سطل‌ها را خودِ SQL می‌سازد، پس پنجرهٔ hours یک «hours+۱» سطلی است */
function expectContiguous(buckets: { hour: number }[], count: number): void {
  expect(buckets.length).toBe(count);
  for (let i = 1; i < buckets.length; i++) {
    // hour «ثانیهٔ epochِ شروعِ آن ساعت» است، پس فاصلهٔ سطل‌ها ۳۶۰۰ است نه ۱؛
    // چیزی که نمودار لازم دارد فقط پیوستگی و ترتیب است، نه نامِ واحد
    expect(buckets[i]!.hour - buckets[i - 1]!.hour).toBe(3600);
  }
}

describe('smsStats — سطل‌ها', () => {
  it('صفِ خالی: صفرها، بی‌تکانه، بی‌هشدار', async () => {
    const s = await smsStats(db);
    expect(s.hours).toBe(24);
    expectContiguous(s.buckets, 25);
    expect(s.totals).toEqual({ enqueued: 0, sent: 0, failed: 0, dead: 0 });
    expect(s.lastSentAt).toBeNull();
    expect(s.minutesSinceActivity).toBeNull();
    expect(s.workerLooksStalled).toBe(false);
    expect(s.reason).toBeNull();
  });

  it('هیچ پیامِ شمرده‌شده‌ای از نمودار جا نمی‌ماند (مرزِ پنجرهٔ SQL و JS)', async () => {
    // بازتولیدِ باگی که این نسخه اصلاح می‌کند: اگر شبکهٔ سطل‌ها در JS با
    // Date.now() ساخته شود و مرزِ داده در SQL با NOW()، دو دقیقه اختلافِ
    // «خواندنِ ساعت» کافی است که پیامکی در «مجموع» باشد و در هیچ سطلی نه —
    // یعنی نموداری که بی‌سروصدا کم‌شمارد. ۴۷۷/۴۷۸/۴۷۹ دقیقه لبهٔ ۸ ساعته‌اند
    const gaps = [1, 2, 59, 61, 119, 178, 239, 241, 300, 359, 361, 420, 477, 478, 479];
    for (const g of gaps) {
      await row({ status: 'sent', attempts: 1, minutesAgo: g, sentMinutesAgo: g });
    }
    const s = await smsStats(db, { hours: 8 });
    expect(s.totals.sent).toBe(gaps.length);
    expect(s.buckets.reduce((n, b) => n + b.sent, 0)).toBe(gaps.length);
    expect(s.buckets.reduce((n, b) => n + b.enqueued, 0)).toBe(gaps.length);
  });

  it('سطل‌هایِ ساعتی درست پر می‌شوند (۱۰ دقیقه پیش و ۳ ساعت پیش در دو سطلِ متفاوت)', async () => {
    await row({ status: 'sent', attempts: 1, minutesAgo: 10, sentMinutesAgo: 9 });
    await row({ status: 'sent', attempts: 1, minutesAgo: 180, sentMinutesAgo: 179 });
    const s = await smsStats(db, { hours: 6 });
    expectContiguous(s.buckets, 7);
    expect(s.totals.sent).toBe(2);
    // «چند سطل پُر است» را نمی‌سنجیم: اگر سنجش دقیقاً رویِ مرزِ ساعت بیفتد،
    // پیامِ ۱۰ دقیقه‌پیش در سطلِ قبلی هم می‌نشیند و عدد عوض می‌شود. چیزی که
    // نمودار واقعاً لازم دارد: پیوستگی، ترتیب، و دو پیام در دو سطلِ جدا
    expectContiguous(s.buckets, 7);
    const nonzero = s.buckets.filter((b) => b.sent > 0);
    expect(nonzero.length).toBeGreaterThanOrEqual(2);
    expect(nonzero.reduce((n, b) => n + b.sent, 0)).toBe(2);
    expect(nonzero[0]!.hour).toBeLessThan(nonzero[nonzero.length - 1]!.hour);
    expect(s.buckets[0]!.hour).toBeLessThan(s.buckets[6]!.hour);
  });

  it('سطل‌هایِ بی‌کار هم در خروجی‌اند (نمودار نباید پرشِ ساعت داشته باشد)', async () => {
    await row({ status: 'sent', attempts: 1, minutesAgo: 5, sentMinutesAgo: 4 });
    const s = await smsStats(db, { hours: 8 });
    // «۷ سطلِ خالی» عددِ شکننده‌ای بود: اگر پیام دقیقاً رویِ مرزِ ساعت بیفتد،
    // در سطلِ قبلی هم شمرده می‌شود. آنچه نمودار واقعاً لازم دارد: پُر بودنِ
    // همهٔ خانه‌هایِ شبکه (بی‌ساعتِ جاافتاده) و رسیدنِ شمارش به همان یک پیام
    expectContiguous(s.buckets, 9);
    expect(s.buckets.filter((b) => b.enqueued === 0).length).toBeGreaterThanOrEqual(6);
    expect(s.buckets.reduce((n, b) => n + b.sent, 0)).toBe(1);
  });

  it('حدودِ hours: از ۳ تا ۱۶۸، بیرون از آن کلمپ می‌شود', async () => {
    expectContiguous((await smsStats(db, { hours: 1 })).buckets, 4);
    expectContiguous((await smsStats(db, { hours: 9999 })).buckets, 169);
  });
});

describe('smsStats — «کارگر خواب است؟»', () => {
  it('پیامِ نوبت‌خورده + آخرینِ تکانه ۸۰ دقیقه پیش = هشدار', async () => {
    await row({ status: 'pending', attempts: 0, minutesAgo: 120 });
    // کارگر ۸۰ دقیقه پیش زنده بوده (یک ارسالِ موفق) و بعد از آن هیچ
    await row({ status: 'sent', attempts: 1, minutesAgo: 90, sentMinutesAgo: 80, availableInMinutes: -80 });
    const s = await smsStats(db);
    expect(s.dueNow).toBe(1);
    expect(s.workerLooksStalled).toBe(true);
    expect(s.minutesSinceActivity).toBeGreaterThanOrEqual(75);
    expect(s.reason).toContain('کارگرِ صف');
  });

  it('پیامِ نوبت‌خورده + تکانهٔ ۵ دقیقه پیش = بی‌هشدار', async () => {
    await row({ status: 'pending', attempts: 0, minutesAgo: 40 });
    await row({ status: 'sent', attempts: 1, minutesAgo: 6, sentMinutesAgo: 5, availableInMinutes: -5 });
    const s = await smsStats(db);
    expect(s.dueNow).toBe(1);
    expect(s.workerLooksStalled).toBe(false);
  });

  it('صفِ خالی و تکانهٔ کهنه: هشدار نیست (کاری نبوده که انجام شود)', async () => {
    await row({ status: 'sent', attempts: 1, minutesAgo: 3000, sentMinutesAgo: 3000 });
    const s = await smsStats(db);
    expect(s.dueNow).toBe(0);
    expect(s.workerLooksStalled).toBe(false);
  });

  it('«ناامیدکننده» تنها، خودش صفِ نوبت‌خورده نیست — اما تکانهٔ کهنه هشدار می‌گیرد', async () => {
    await row({ status: 'dead', attempts: 5, minutesAgo: 200, availableInMinutes: -200 });
    const s = await smsStats(db);
    expect(s.dueNow).toBe(0);
    expect(s.stuckDead).toBe(1);
    expect(s.workerLooksStalled).toBe(true);
    expect(s.reason).toMatch(/بازگرداندن/);
  });

  it('مهلتِ آستانه از پنل خوانده می‌شود (sms_worker_stale_minutes)', async () => {
    await row({ status: 'pending', attempts: 0, minutesAgo: 120 });
    await row({ status: 'sent', attempts: 1, minutesAgo: 40, sentMinutesAgo: 35, availableInMinutes: -35 });
    expect((await smsStats(db)).workerLooksStalled).toBe(false); // ۳۵ < ۷۰

    await setSetting(db, 'sms_worker_stale_minutes', '30');
    const s = await smsStats(db);
    expect(s.staleAfterMinutes).toBe(30);
    expect(s.workerLooksStalled).toBe(true);

    // مقدارِ زیرِ کفِ منطقی «کلمپ» می‌شود (نه پرش به پیش‌فرض): مدیر ۱ دقیقه
    // خواسته، ما کمِترینِ معقولِ ۵ دقیقه را می‌دهیم و در پنل هم همان را نشان
    // می‌دهیم — عددِ ذخیره‌شده با عددِ اعمال‌شده یکی باشد، گمراه‌کننده نیست
    await setSetting(db, 'sms_worker_stale_minutes', '1');
    expect((await smsStats(db)).staleAfterMinutes).toBe(5);

    // رقمِ فارسی در پنل پذیرفته می‌شود
    await setSetting(db, 'sms_worker_stale_minutes', '۲۰');
    expect((await smsStats(db)).staleAfterMinutes).toBe(20);

    // و رشتهٔ بی‌عدد به پیش‌فرض برمی‌گردد (نه NaN، نه صفر = «همیشه هشدار بده»)
    await setSetting(db, 'sms_worker_stale_minutes', 'چیزی');
    expect((await smsStats(db)).staleAfterMinutes).toBe(70);
  });

  it('هیچ‌وقت تکانه‌ای ندیده: «null دقیقه» در متنِ هشدار نمی‌نشیند', async () => {
    // اولینِ سطرِ یکِ نصبِ تازه هیچ sent_at و هیچ last_attempt_at ندارد؛ اگر
    // رشتهٔ هشدار مستقیم عدد را چاپ کند، مدیر «null دقیقه» می‌بیند
    // sentMinutesAgo: null شرطِ آزمون است — helper به‌طورِ پیش‌فرض sent_at را هم
    // پر می‌کند و آن‌وقت «تکانهٔ کهنه» داریم نه «بی‌تکانه»
    await row({ status: 'pending', attempts: 0, minutesAgo: 400, sentMinutesAgo: null });
    const s = await smsStats(db);
    expect(s.minutesSinceActivity).toBeNull();
    expect(s.workerLooksStalled).toBe(true);
    expect(s.reason).toContain('هنوز هیچ‌وقت');
    expect(s.reason ?? '').not.toMatch(/null/);
    // رقمِ فارسی: «1 پیام» در متنِ فارسی، باقی‌ماندهٔ کارِ نیمه‌تمام است
    expect(s.reason ?? '').not.toMatch(/[0-9]/);
  });

  it('همه در مهلتِ تلاشِ دوباره: نوبتی نیست، و توضیحش جدا از «خوابِ کارگر» است', async () => {
    // sent_at ندارد: یک تلاشِ ناموفق، پس کارگر چیزی نفرستاده که «تازه» باشد
    await row({
      status: 'failed',
      attempts: 2,
      minutesAgo: 30,
      sentMinutesAgo: null,
      availableInMinutes: 25,
    });
    const s = await smsStats(db);
    expect(s.dueNow).toBe(0);
    expect(s.inBackoff).toBe(1);
    expect(s.workerLooksStalled).toBe(false);
    expect(s.reason).toMatch(/مهلتِ تلاشِ دوباره/);
  });

  it('«نوبتِ تلاشِ بعدیِ» یک پیامِ ناموفق، تکانه حساب نمی‌شود', async () => {
    // این دقیقاً همان دامی بود که ستونِ تازه را لازم کرد: تلاشِ کارگر ۶۰۰ دقیقه
    // پیش بوده و نوبتِ بعد ۲۰ دقیقه‌یِ آینده است — اگر «تکانه» را از
    // available_at بخوانیم، کارگرِ مرده «تازه» به‌نظر می‌رسد
    await row({ status: 'failed', attempts: 3, minutesAgo: 600, availableInMinutes: 20 });
    await row({ status: 'pending', attempts: 0, minutesAgo: 700 });
    let s = await smsStats(db);
    expect(s.dueNow).toBe(1);
    expect(s.workerLooksStalled).toBe(true);

    // و همان داده، اگر کارگر واقعاً ۱۰ دقیقه پیش چیزی را برداشته باشد، ساکت است
    await db.query(
      `UPDATE sms_outbox SET last_attempt_at = now() - interval '10 minutes' WHERE attempts > 0`,
    );
    s = await smsStats(db);
    expect(s.workerLooksStalled).toBe(false);
    expect(s.minutesSinceActivity).toBeLessThanOrEqual(12);
  });

  it('خواندنِ زمان با هر دو شکلِ درایور کار می‌کند (Date در PGlite، رشته در pg)', () => {
    // آزمونِ خالصِ تابعی، عمداً بی‌دیتابیس: در تولید `pg` ستونِ timestamptz را
    // رشته می‌دهد (هیچ typeParser در packages/db نشاندہ نشده) و PGlite Date —
    // بی toDate، پنل رویِ سرورِ واقعی با getTime می‌ترکید و اینجا سبز می‌ماند
    const iso = '2026-09-18T13:30:00.000Z';
    expect(toDate(iso)?.toISOString()).toBe(iso);
    expect(toDate(new Date(iso))?.toISOString()).toBe(iso);
    expect(toDate(null)).toBeNull();
    expect(toDate('')).toBeNull();
    expect(toDate('چیزی‌که‌تاریخ‌نیست')).toBeNull();
  });
});
