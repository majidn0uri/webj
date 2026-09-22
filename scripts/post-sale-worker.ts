/**
 * کارگرِ پس از فروش — «تعهد‌هایی که با هر فروش ساخته می‌شوند».
 *
 * پنج وظیفه دارد، و هر پنج تا یک ویژگیِ مهم دارند: **بی‌اثر بودنِ تکرار** (idempotent).
 * یعنی اگر کارگر ده بار هم پشتِ سر هم اجرا شود، نه صورتحسابی دوبار صادر
 * می‌شود و نه گارانتی‌ای از نو آغاز می‌گردد. این ویژگیِ اصلی است، نه یک
 * جزئیات: کارگری که با تکرار، داده خراب کند، بدتر از کارگری است که اصلاً
 * کار نکند — چون خرابی را پنهان می‌کند تا وقتی که مشتری پیدایش شود.
 *
 *   ۱) **صورتحسابِ فروش**: هر سفارشِ پرداخت‌شده‌ای که صورتحسابی ندارد،
 *      صورتحسابش ساخته و در صف گذاشته می‌شود (ارسال را کارگرِ مالیات انجام
 *      می‌دهد). چرا اینجا و نه در لحظه‌یِ پرداخت؟ چون ساختنِ صورتحساب به
 *      تنظیماتِ مؤدیان، شناسه‌یِ کالا و شماره‌یِ سریال وابسته است و نباید
 *      پرداختِ مشتری را به خطایِ یکی از این‌ها گره زد: پول گرفته شده،
 *      صورتحساب بعداً ساخته می‌شود.
 *
 *   ۲) **پیامک‌ها** — صفِ `sms_outbox` به سامانه‌یِ پیامکیِ انتخاب‌شده در پنل
 *      فرستاده می‌شود (کاوه‌نگار/ملی‌پیامک/فراز). چرا در همین کارگر و نه در
 *      لحظه‌یِ واقعه؟ چون پیامک نباید به قطعیِ سامانه گره بخورد: سفارش ثبت
 *      شده و پیام با تلاشِ دوباره و فاصله، بعداً می‌رسد. و چرا در کارگرِ پس از
 *      فروش؟ چون هر دو «یک دورِ بی‌خطر»‌اند؛ تایمرِ یکی، دیگری را هم جلو
 *      می‌آورد و هیچ‌کدام تکراری تولید نمی‌کند (پیامکِ در حالِ ارسال با قفلِ
 *      SKIP LOCKED و مهلتِ «sending» دوباره‌فرستاده نمی‌شود).
 *
 *   ۳) **پاک‌سازیِ دوره‌ای**: پیامک‌هایِ تمام‌شدهٔ کهنه، ردِّ ممیزی (اگر مدیر
 *      مهلت گذاشته باشد) و آمارِ مهارِ بار. چرا در همین کارگر و نه تایمرِ جدا؟
 *      چون جدول‌هایِ «فقط بزرگ‌شونده» همان‌جا سنگین می‌شوند که پنل باید مشکلِ
 *      دیگری را نشان بدهد، و مهلتِ نگهداری از پنل خوانده می‌شود — پس نه
 *      کدِ تازه، نه سرویسِ تازه.
 *
 *   ۴) **بهداشتِ فایل‌ها**: فایل‌هایِ بی‌صاحبِ پوشهٔ رسانه (تصویرِ کالایِ حذف‌شده،
 *      `*.tmp`هایِ نوشتنِ نیمه‌کاره). چرا با «خودکاریِ خاموش»؟ چون فایلِ پاک‌شده
 *      برگشت‌پذیر نیست و سناریویِ «پایگاه از پشتیبانِ کهنه برگشته، فایل‌ها نو
 *      مانده‌اند» همهٔ تصویرهایِ زنده را در چشمِ یک پویش بی‌صاحب می‌کند؛ پس
 *      پیش‌فرض فقط **گزارش** می‌شود و پاک‌کردن یا با کلیدِ `media_autopurge`
 *      در پنل است یا با دکمهٔ «پاک‌سازی» در صفحهٔ تصویرِ کالا.
 *
 *   ۵) **آغازِ گارانتی**: برای هر ردیفِ پرداخت‌شده که گارانتی ندارد، یک دوره‌ی
 *      گارانتی از تاریخِ پرداخت آغاز می‌شود. تاریخِ آغاز «تاریخِ پرداخت» است،
 *      نه «امروز»؛ وگرنه با اجرایِ دیرهنگامِ کارگر، مدتِ گارانتیِ مشتری کوتاه
 *      می‌شد — دزدیِ خاموش از حقِ مشتری.
 *
 * اجرا:
 *   npm run worker:once                                   # یک دور (همان چیزی که تایمرِ systemd می‌زند)
 *   npm run start:worker                                  # چرخه: هر ۶۰ ثانیه یک دور
 *   POSTSALE_INTERVAL_SEC=15 npm run start:worker         # فاصله‌یِ دستی
 *   DB_URL="postgres://…" npx tsx scripts/post-sale-worker.ts --loop
 *
 * دو حالت، چون دو جور ماشین داریم. رویِ سرورِ واقعی تایمرِ `systemd`
 * (`deploy/systemd/setshop-postsale.timer`) این اسکریپت را هر چند دقیقه یک بار
 * اجرا می‌کند و «چرخهٔ» ماندگار لازم نیست — یک فرآیندِ خوابیده در systemd یعنی
 * پیامکِ نرفته، و تایمرِ systemd حتی از افتادنِ سرور هم برمی‌گردد. رویِ ماشینِ
 * توسعه و رویِ هر هاستی که systemd در دسترس نیست، `--loop` همان کار را می‌کند.
 * هر دو با «تکرارِ بی‌اثر» می‌سازند، پس اگر روزی **هر دو** بالا باشند هم چیزی
 * دوباره ارسال نمی‌شود (claim با `SKIP LOCKED` + مهلتِ `sending`).
 */

import { createDatabase, type Database } from '../packages/db/src/index.js';
import {
  readSmsSendConfig,
  sendDue,
  purgeExpiredData,
  readMediaPolicy,
  mediaHygiene,
  formatMediaBytes,
  faDigits,
  smsQueueCounts,
  smsStateLines,
  resolveLoopIntervalMs,
  type SmsSendConfig,
} from '../packages/commerce/src/index.js';
import { createInvoiceForOrder, readTaxSettings } from '../packages/tax/src/index.js';
import { startWarranty, readReturnSettings } from '../packages/returns/src/index.js';

/** هر دور چند سفارش/ردیف بررسی شود (سقفِ بار رویِ پایگاه در یک دور) */
const ORDER_LIMIT = clampInt(process.env.POSTSALE_ORDER_LIMIT, 200);
const ITEM_LIMIT = clampInt(process.env.POSTSALE_ITEM_LIMIT, 500);
const PURGE_LIMIT = clampInt(process.env.POSTSALE_PURGE_LIMIT, 2000);
const MEDIA_LIMIT = clampInt(process.env.POSTSALE_MEDIA_LIMIT, 200);

/** `--loop` یا `POSTSALE_LOOP=1` — حالتِ چرخه برایِ میزبانیِ بی‌systemd */
const LOOP = process.argv.includes('--loop') || /^(1|true|yes|بله)$/i.test((process.env.POSTSALE_LOOP ?? '').trim());

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * عددِ محیطی را با کف و سقف می‌خوانیم.
 *
 * چرا این‌قدر وسواس رویِ یک `parseInt`؟ چون `Number('')` صفر است: یک
 * `POSTSALE_ITEM_LIMIT=`ِ خالی در واحدِ systemd (که آدم‌ها موقعِ آزمایش می‌گذارند)
 * یعنی «صفر ردیف بررسی کن» — و کارگر بی‌هیچ خطایی هیچ‌کاری نمی‌کند. صفرِ
 * عمداً هم معنا ندارد: این‌ها سقف‌اند، نه سیاست.
 */
function clampInt(raw: string | undefined, fallback: number): number {
  const n = Number(String(raw ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).trim());
  return Number.isFinite(n) && n > 0 ? Math.min(50000, Math.floor(n)) : fallback;
}

async function issueMissingInvoices(db: Database): Promise<{ done: number; failed: number }> {
  const settings = await readTaxSettings(db);
  if (!settings.enabled || !settings.fiscalId) {
    console.log('مالیات خاموش یا بی‌شناسه‌یِ مالیاتی است؛ صدورِ صورتحساب انجام نشد.');
    return { done: 0, failed: 0 };
  }

  // سفارش‌هایِ پرداخت‌شده که «هیچ» صورتحسابی ندارند — نه فروش و نه اصلاحی.
  const { rows } = await db.query<{ id: string; order_no: string }>(
    `SELECT o.id, o.order_no
       FROM orders o
      WHERE o.status = 'paid'
        AND o.paid_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM tax_invoices t WHERE t.order_id = o.id)
      ORDER BY o.paid_at
      LIMIT $1`,
    [ORDER_LIMIT],
  );

  let done = 0;
  let failed = 0;
  for (const order of rows) {
    try {
      const result = await createInvoiceForOrder(db, order.id);
      done += 1;
      // صورتحسابی که در بررسیِ محلی رد شده (مثلاً کالا بی‌شناسه است) ساخته
      // شده و در صف مانده است — با وضعیتِ «ردشده» تا هرگز ناخواسته ارسال نشود.
      if (result.validationErrors.length > 0) {
        console.warn(`  ! ${order.order_no}: ${result.validationErrors.join(' ')}`);
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      console.warn(`  ! ${order.order_no}: ${(error as Error).message}`);
    }
  }
  return { done, failed };
}

async function startMissingWarranties(db: Database): Promise<{ started: number; skipped: number }> {
  const settings = await readReturnSettings(db);
  if (settings.warrantyDefaultMonths <= 0) {
    console.log('مدتِ گارانتیِ پیش‌فرض صفر است؛ گارانتی‌ای آغاز نشد.');
    return { started: 0, skipped: 0 };
  }

  const { rows } = await db.query<{ id: string; order_no: string }>(
    `SELECT oi.id, o.order_no
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'paid'
        AND o.paid_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM warranties w WHERE w.order_item_id = oi.id)
      ORDER BY o.paid_at
      LIMIT $1`,
    [ITEM_LIMIT],
  );

  let started = 0;
  let skipped = 0;
  for (const item of rows) {
    try {
      await startWarranty(db, { orderItemId: item.id });
      started += 1;
    } catch (error) {
      skipped += 1;
      console.warn(`  ! گارانتیِ ${item.order_no}: ${(error as Error).message}`);
    }
  }
  return { started, skipped };
}

/** یک دورِ کامل: پنج وظیفه، همه با «تکرارِ بی‌اثر». پیکربندیِ پیامک را از بیرون
 *  می‌گیرد تا بنرِ وضعیت و خودِ دور، یک config را ببینند (نه دو تا، که در
 *  فاصلهٔ چند میلی‌ثانیه می‌تواند عوض شده باشد و گزارش با واقعیت نخواند). */
async function runOnce(db: Database, cfg: SmsSendConfig): Promise<void> {
    const invoices = await issueMissingInvoices(db);
    const warranties = await startMissingWarranties(db);
    const sms = await sendDue(db, cfg, {
      limit: clampInt(process.env.SMS_BATCH, 20),
    });
    // پاک‌سازیِ دوره‌ای در همین کارگر (نه در یک تایمرِ جدا): کارگرِ پس از فروش
    // همین حالا هر چند دقیقه یک بار اجرا می‌شود و «یک دورِ بی‌خطر» است؛ افزودنِ
    // یک واحدِ systemdِ دیگر یعنی یک چیزِ بیشترِ فراموش‌شدنی. با قفلِ مشورتی،
    // اگر API هم هم‌زمان پاک‌سازی کند، دورِ دوم صفر می‌بیند و کاری تکراری نشود.
    const purge = await purgeExpiredData(db, { batchLimit: PURGE_LIMIT });
    const mediaPolicy = await readMediaPolicy(db);
    const media = await mediaHygiene(db, {
      mode: mediaPolicy.autopurge ? 'run' : 'report',
      limit: MEDIA_LIMIT,
    });
    console.log(
      [
        `صورتحساب: ${invoices.done} ساخته شد (${invoices.failed} نیازمندِ اصلاح)`,
        `گارانتی: ${warranties.started} آغاز شد (${warranties.skipped} انجام نشد)`,
        `پیامک: ${sms.sent} فرستاده شد (${sms.failed} دوباره در صف، ${sms.dead} ناامیدکننده` +
          `${sms.claimed === 0 ? '، صف خالی' : ''})`,
        `پاک‌سازی: ${faDigits(
          purge.tables.smsOutbox.removed + purge.tables.auditLog.removed + purge.tables.observability.removed,
        )} سطرِ کهنه`,
        mediaPolicy.graceDays === 0
          ? 'فایل: مهلتِ صفر، پوشهٔ رسانه پویش نشد'
          : mediaPolicy.autopurge
            ? `فایل: ${faDigits(media.removed)} بی‌صاحب پاک شد (${formatMediaBytes(media.removedBytes)})${
                media.remaining > 0 ? `، ${faDigits(media.remaining)} تا دورِ بعد` : ''
              }`
            : `فایل: ${faDigits(media.orphans)} بی‌صاحب (${formatMediaBytes(media.orphanBytes)}) — خودکار خاموش` +
              `${media.missingTotal > 0 ? `، ${faDigits(media.missingTotal)} تصویرِ شکسته!` : ''}`,
      ].join(' | '),
    );
    // پیامکِ ناامیدکننده (dead) با «کدِ ورود» یعنی مشتریِ از دست رفته؛ خروجیِ
    // غیرصفرِ این کارگر در systemd یعنی «چیزی را ببین» — اما فقط وقتی کاری
    // انجام شده و همه‌اش شکست خورده باشد، نه در هر قطعیِ ساده.
    if (sms.dead > 0 && sms.sent === 0 && sms.claimed > 0) {
      console.error(`⚠ ${sms.dead} پیامک از تلاش‌ها ناامید شد؛ آخرینِ خطاها: ${sms.notes.slice(0, 3).join(' / ')}`);
    }
    // «صفی هست و هیچ‌کدام نمی‌رود» اگر از نوعِ تنظیمی باشد، یک بار گفتن کافی است:
    // مدیر با پرکردنِ شناسهٔ قالب یا کلیدِ حساب، خودبه‌خود در دورِ بعد ترکه می‌رود.
    if (sms.sent === 0 && sms.claimed > 0 && sms.failed + sms.dead > 0) {
      const configish = sms.notes.filter((n) => /قالب|کلید|شناسه|ارسال‌کننده/.test(n));
      if (configish.length > 0) {
        console.error(`⚠ تنظیماتِ پیامک کامل نیست — ${configish[0]}`);
      }
    }
}

async function main(): Promise<void> {
  const url = process.env.DB_URL;
  if (!url) {
    console.error('DB_URL تنظیم نشده است.');
    process.exit(1);
  }

  const db = createDatabase(url);
  try {
    // نخستین چیزی که چاپ می‌شود «چه وضعیتی داریم» است، نه نتیجهٔ دور: اگر
    // سامانه‌ای انتخاب نشده باشد، دورِ اول هم چیزی ندارد بگوید (صف دست‌نخورده
    // می‌ماند و پیامک‌ها هم می‌مانند) و آدم سراغِ لاگِ API می‌رود که آن هم چیزی
    // ندارد. دو خطِ اول، کلِ «چرا نمی‌رسد» را می‌بندد.
    const firstCfg = await readSmsSendConfig(db);
    for (const line of smsStateLines(firstCfg, await smsQueueCounts(db))) console.log(line);

    if (!LOOP) {
      await runOnce(db, firstCfg);
      return;
    }

    const intervalMs = resolveLoopIntervalMs(process.env.POSTSALE_INTERVAL_SEC);
    console.log(
      `حالتِ چرخه: هر ${faDigits(Math.round(intervalMs / 1000))} ثانیه یک دور — Ctrl-C که بزنی، دورِ جاری` +
        ` تمام می‌شود و تمیز می‌ایستم (نبستنِ تمیزِ استخرِ اتصال مهم‌تر از یک ثانیه زودتر ایستادن است).`,
    );

    let stopping = false;
    const stop = (signal: string): void => {
      if (stopping) return;
      stopping = true;
      console.log(`⏹ ${signal} رسید؛ پس از پایانِ دورِ جاری می‌ایستم.`);
    };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));

    while (true) {
      const startedAt = Date.now();
      await runOnce(db, await readSmsSendConfig(db));
      if (stopping) break;
      // خوابیدن در تکه‌هایِ یک‌ثانیه‌ای: بی‌این، SIGTERM تا پایانِ یک خوابِ شصت
      // ثانیه‌ای بی‌پاسخ می‌ماند و «restart» ادم را معطل می‌کند.
      const until = Date.now() + Math.max(0, intervalMs - (Date.now() - startedAt));
      while (!stopping && Date.now() < until) {
        await sleep(Math.min(1000, Math.max(0, until - Date.now())));
      }
      if (stopping) break;
    }
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error('کارگرِ پس از فروش شکست خورد:', error);
  process.exit(1);
});
