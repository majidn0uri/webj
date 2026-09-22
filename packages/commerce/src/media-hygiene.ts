/**
 * سیاستِ پاک‌سازیِ فایل‌هایِ رسانه + حافظهٔ «پویشِ اخیر».
 *
 * چرا این لایه جدا از `@set/media` است؟ چون `@set/media` ابزارِ مکانیکی است
 * (پوشه را می‌گردد، ارجاع‌ها را می‌شمارد، فایل را برمی‌دارد) و نباید بداند
 * «مدیر چه عددی در پنل نوشته» یا «این عدد را چطور به فارسی بخوانیم». اینجا
 * همان‌جایی است که سیاست خوانده و جمله ساخته می‌شود — کنارِ `housekeeping.ts`،
 * تا «مهلتِ نگهداری» یک جا معنا شود، نه چهار جا.
 *
 * سه تصمیم که از رویِ راحتی برنداشته شده:
 *
 *  ۱) **پاک‌سازیِ خودکار پیش‌فرض خاموش است.** برعکسِ ردیف‌هایِ `sms_outbox` که
 *     از رفتنِ یک پیامکِ یک‌ساله کسی پشیمان نمی‌شود، فایلِ تصویر
 *     **برگشت‌پذیر نیست**: اگر روزی پایگاه از پشتیبانِ کهنه برگردد و فایل‌ها نو
 *     بمانند، هر «بی‌صاحبِ» شمرده‌شده در واقع تصویرِ زندهٔ فروشگاه است. پس
 *     سامانه می‌شمارد و می‌گوید؛ «پاک‌سازی» یا روشن‌کردنِ کلیدِ خودکار، کارِ
 *     مدیر است.
 *  ۲) **پویشِ کلِ پوشه، هر پنج دقیقه نه.** نتیجه در `store_settings` می‌نشیند و
 *     تا `media_scan_minutes` (پیش‌فرض شش ساعت) دوباره تکرار نمی‌شود. این کش
 *     عمداً **بی‌ردِّ عملیات** نوشته می‌شود: یک سطرِ ممیزی در هر دورِ کارگر،
 *     همان جدولی را پر می‌کند که برایِ اختلافِ مالی لازم است.
 *  ۳) **مهلتِ صفر یعنی «هیچ‌وقت»، آن‌قدر که پویش هم نمی‌کنیم.** همان قاعده‌ای
 *     که در `housekeeping.ts` برایِ ردیف‌ها هست؛ معناهایِ متفاوتِ «صفر» در دو
 *     جایِ یک پنل، یعنی مدیر عدد را نمی‌فهمد.
 */

import type { Queryable } from '@set/db';
import {
  removeOrphanMedia,
  type MediaScan,
  type MissingLink,
  type OrphanFile,
  type PurgeRefusal,
  type UnmanagedFile,
} from '@set/media';

import { getSetting } from './settings.js';
import { readDays } from './housekeeping.js';
import { faDigits } from './sms-send.js';

/**
 * سقفِ زمانِ پویش برایِ «فقط ببینیم» (میلی‌ثانیه).
 *
 * صفحهٔ ویرایشِ کالا هر بار که باز می‌شود می‌پرسد «چند فایلِ بی‌صاحب داریم؟» و
 * پاسخِ این پرسش نباید به شمردنِ صدها‌هزار فایل کشیده شود — همان چیزی که کاربر
 * «سنگین شدنِ سرور» صدا می‌زند. وقتی پویش به سقف خورد، پیش‌نمایش همان
 * عدد‌هایِ قطعیِ تا آن لحظه را می‌دهد و رویشان می‌نویسد «کامل نشد» (و کش هم
 * نمی‌شود). پاک‌سازیِ دستی — دکمهٔ پنل و کارگرِ پس از فروش — بی‌سقف است، چون
 * خودش یک کارِ خواسته‌شده است نه یک رقمِ کنارِ صفحه.
 */
export const MEDIA_REPORT_BUDGET_MS = 400;

/** سیاستِ پیش‌فرض — با `fallback`هایِ کارنامهٔ تنظیمات یکی نگه داشته می‌شود */
export const MEDIA_POLICY_DEFAULTS = {
  graceDays: 14,
  autopurge: false,
  scanIntervalMinutes: 360,
} as const;

export const MEDIA_POLICY_KEYS = {
  graceDays: 'media_grace_days',
  autopurge: 'media_autopurge',
  scanIntervalMinutes: 'media_scan_minutes',
  /** کلیدِ داخلیِ کش؛ در کارنامهٔ تنظیمات نیست تا در پنل دیده نشود */
  lastScan: 'media_last_scan',
} as const;

export interface MediaPolicy {
  graceDays: number;
  autopurge: boolean;
  scanIntervalMinutes: number;
}

export interface MediaHygieneReport {
  mode: 'report' | 'run';
  policy: MediaPolicy;
  /** در این دور فایلی پاک شد؟ */
  ran: boolean;
  /** نتیجه از پویشِ اخیر خوانده شد (بی‌گشت‌وگذارِ دوباره رویِ دیسک) */
  cached: boolean;
  /**
   * آیا پویش به سقفِ زمانِ پیش‌نمایش خورد؟ اگر بله، عدد‌هایِ این گزارش
   * «کمترینِ قطعی» است نه شمارشِ کامل، و کش هم نمی‌شود — تا پنل عددِ ناقص را
   * شش ساعت نگه ندارد و «از نو بررسی کن» روشن بماند.
   */
  incomplete: boolean;
  scannedAt: string;
  root: string;
  files: number;
  bytes: number;
  referencedUrls: number;
  referencedFiles: number;
  orphans: number;
  orphanBytes: number;
  youngSkipped: number;
  unmanaged: number;
  unmanagedBytes: number;
  tempStale: number;
  tempStaleBytes: number;
  tempSkipped: number;
  deepSkipped: number;
  missingTotal: number;
  orphansList: OrphanFile[];
  unmanagedList: UnmanagedFile[];
  missing: MissingLink[];
  removed: number;
  removedBytes: number;
  remaining: number;
  remainingBytes: number;
  deleted: string[];
  refuseCode: PurgeRefusal;
  notes: string[];
}

export interface MediaHygieneOptions {
  /** `report` فقط می‌شمارد؛ `run` پاک می‌کند (پیش‌فرض: report) */
  mode?: 'report' | 'run';
  /** با وجودِ چک‌برِ «غیرعادی به‌نظر می‌رسد» اجرا کن */
  force?: boolean;
  /** در این دور حداکثر چند فایل */
  limit?: number;
  /** کش را نادیده بگیر و از نو بگرد (دکمهٔ «از نو بررسی کن») */
  fresh?: boolean;
  /**
   * سقفِ زمانِ پویش (میلی‌ثانیه)؛ تعریف‌نشده یعنی پیش‌فرضِ حالت: پیش‌نمایش
   * `MEDIA_REPORT_BUDGET_MS` و پاک‌سازی بی‌سقف. `Number.POSITIVE_INFINITY` را
   * بفرست وقتی کاربر خودش «از نو بررسی کن» را زده — آن‌جا شمارشِ کامل خواسته
   * شده و رقمِ ناقص فایده‌ای ندارد.
   */
  budgetMs?: number;
}

/**
 * «بله/خیر» در این سامانه چند شکل دارد: `true` که رابطِ تنظیمات می‌فرستد،
 * `1` که از `psql` یا اسکریپتِ استقرار می‌ماند، و رشتهٔ خالی که یعنی «کلید
 * نبود». پیش‌فرض باید از رویِ **نبودِ کلید** بیاید، نه از رویِ «هرچه بود صفر
 * است» — همان دامی که `Number('') === 0` برایِ مهلت‌ها گذاشت.
 */
export function readBool(value: unknown, fallback: boolean): boolean {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    // کیبوردِ فارسی: «۱» و «۰» هم در خانهٔ تنظیمات نوشته می‌شوند
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  if (raw === '') return fallback;
  if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on' || raw === 'بله') return true;
  if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off' || raw === 'خیر') return false;
  return fallback;
}

/** سیاستِ جاری از پنل — هر بار خوانده می‌شود تا تغییرِ مدیر بی‌راه‌اندازیِ دوباره اثر کند */
export async function readMediaPolicy(db: Queryable): Promise<MediaPolicy> {
  // سه خواندنِ پشتِ سرِ هم (نه Promise.all): استخرِ `pg` ممکن است همه را رویِ
  // یک اتصال بیندازد و `pg` دو query هم‌زمان رویِ یک اتصال را deprecated دانسته.
  const grace = await getSetting(db, MEDIA_POLICY_KEYS.graceDays);
  const auto = await getSetting(db, MEDIA_POLICY_KEYS.autopurge);
  const interval = await getSetting(db, MEDIA_POLICY_KEYS.scanIntervalMinutes);
  return {
    graceDays: readDays(grace, MEDIA_POLICY_DEFAULTS.graceDays),
    autopurge: readBool(auto, MEDIA_POLICY_DEFAULTS.autopurge),
    scanIntervalMinutes: Math.max(1, readDays(interval, MEDIA_POLICY_DEFAULTS.scanIntervalMinutes)),
  };
}

export function formatMediaBytes(bytes: number): string {
  const n = Math.max(0, bytes);
  if (n < 1024) return `${faDigits(n)} بایت`;
  if (n < 1024 * 1024) return `${faDigits(Math.round(n / 1024))} کیلوبایت`;
  // ممیزِ فارسی: «۵.۰» در صفحه‌ای که همه‌اش فارسی است، یعنی یک عددِ کپی‌شده از
  //  جایِ دیگر — و با آزمونِ «رقمِ لاتین ممنوع» هم نمی‌خواند
  return `${faDigits((Math.round((n / (1024 * 1024)) * 10) / 10).toFixed(1)).replace('.', '٫')} مگابایت`;
}

/** چیزی که در کش می‌نشیند — فهرست‌ها کوتاه‌شده، تا `store_settings` سنگین نشود */
/**
 * چیزی که در کش می‌نشیند: همهٔ عدد‌هایِ گزارش + فهرست‌هایِ کوتاه‌شده.
 *
 * چرا «دقیقاً همان شکلِ پویش»؟ تا `fromScan` یک مسیرِ واحد داشته باشد؛ دو
 * نسخهٔ نیمه‌کامل از یک داده، همان جایی است که یک روز یک فیلد جا می‌ماند و
 * پنل عددِ صفر نشان می‌دهد در حالی که دیسک پُر است.
 */
interface CachedScan {
  scannedAt: string;
  root: string;
  files: number;
  bytes: number;
  referencedUrls: number;
  referencedFiles: number;
  orphans: number;
  orphanBytes: number;
  youngSkipped: number;
  unmanaged: number;
  unmanagedBytes: number;
  tempStale: number;
  tempStaleBytes: number;
  tempSkipped: number;
  deepSkipped: number;
  missingTotal: number;
  orphansList: OrphanFile[];
  unmanagedList: UnmanagedFile[];
  missing: MissingLink[];
  /** پویش به سقفِ زمان خورد؟ (کش فقط شمارشِ کامل را نگه می‌دارد) */
  incomplete: boolean;
}

function toCached(scan: MediaScan): CachedScan {
  return {
    scannedAt: scan.scannedAt,
    root: scan.root,
    files: scan.files,
    bytes: scan.bytes,
    referencedUrls: scan.referencedUrls,
    referencedFiles: scan.referencedFiles,
    orphans: scan.orphans,
    orphanBytes: scan.orphanBytes,
    youngSkipped: scan.youngSkipped,
    unmanaged: scan.unmanaged,
    unmanagedBytes: scan.unmanagedBytes,
    tempStale: scan.tempStale,
    tempStaleBytes: scan.tempStaleBytes,
    tempSkipped: scan.tempSkipped,
    deepSkipped: scan.deepSkipped,
    missingTotal: scan.missingTotal,
    orphansList: scan.orphansList.slice(0, 20),
    unmanagedList: scan.unmanagedList.slice(0, 20),
    missing: scan.missing.slice(0, 20),
    incomplete: scan.incomplete === true,
  };
}

/**
 * کشِ پس ازِ یک اجرا باید «آنچه مانده» را بگوید، نه «آنچه پیدا شد».
 *
 * چرا این ریزه‌کاری لازم است؟ اگر همان عددِ پیشِ اجرا بماند، پنل تا ساعت‌ها
 * «۱ فایلِ بی‌صاحب · پاک‌سازیِ ۱ فایل» را نشان می‌دهد در حالی که فایل رفته —
 * و مدیر از همین صفحه یاد می‌گیرد که به هیچ عددی اعتماد نکند.
 */
function afterRunCache(result: Awaited<ReturnType<typeof removeOrphanMedia>>): CachedScan {
  const base = toCached(result);
  if (result.removed === 0) return base;
  const removedOrphans = result.removed - result.removedTemp;
  const removedOrphanBytes = result.removedBytes - result.removedTempBytes;
  return {
    ...base,
    files: Math.max(0, base.files - result.removed),
    bytes: Math.max(0, base.bytes - result.removedBytes),
    tempStale: Math.max(0, base.tempStale - result.removedTemp),
    tempStaleBytes: Math.max(0, base.tempStaleBytes - result.removedTempBytes),
    orphans: Math.max(0, base.orphans - removedOrphans),
    orphanBytes: Math.max(0, base.orphanBytes - removedOrphanBytes),
    orphansList: base.orphansList.filter((o) => !result.deleted.includes(o.url)),
  };
}

/** خواندنِ کش؛ `null` یعنی باید از نو پویش کرد (کلید نیست، کهنه است، یا خراب است) */
async function readCache(db: Queryable, maxAgeMinutes: number): Promise<CachedScan | null> {
  const raw = await getSetting(db, MEDIA_POLICY_KEYS.lastScan);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedScan;
    if (typeof parsed?.scannedAt !== 'string' || typeof parsed?.orphans !== 'number') return null;
    const ageMinutes = (Date.now() - Date.parse(parsed.scannedAt)) / 60_000;
    if (!Number.isFinite(ageMinutes) || ageMinutes < 0) return null;
    return ageMinutes <= maxAgeMinutes ? parsed : null;
  } catch {
    return null;
  }
}

/** نوشتنِ کش — عمداً بی‌`setSetting`، تا هر دورِ کارگر ردِّ عملیات ننویسد */
async function writeCache(db: Queryable, scan: CachedScan): Promise<void> {
  await db.query(
    `INSERT INTO store_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [MEDIA_POLICY_KEYS.lastScan, JSON.stringify(scan)],
  );
}

const REFUSAL_TEXT: Record<Exclude<PurgeRefusal, null>, string> = {
  'no-references':
    'پایگاه هیچ ارجاعی به پوشهٔ رسانه ندارد ولی فایل آنجاست — یا پایگاهِ اشتباهی وصل شده یا مهاجرتی ناقص مانده. بی‌«اجباری» چیزی پاک نمی‌شود.',
  'orphan-ratio':
    'بیش از نیمی از دیسکِ رسانه «بی‌صاحب» شمرده شد؛ این غیرعادی است (مثلاً بازگردانیِ پشتیبانِ کهنه). بی‌«اجباری» چیزی پاک نمی‌شود.',
};

function zeroReport(policy: MediaPolicy, mode: 'report' | 'run', notes: string[]): MediaHygieneReport {
  return {
    mode,
    policy,
    ran: false,
    cached: false,
    scannedAt: new Date().toISOString(),
    root: '',
    files: 0,
    bytes: 0,
    referencedUrls: 0,
    referencedFiles: 0,
    orphans: 0,
    orphanBytes: 0,
    youngSkipped: 0,
    unmanaged: 0,
    unmanagedBytes: 0,
    tempStale: 0,
    tempStaleBytes: 0,
    tempSkipped: 0,
    deepSkipped: 0,
    missingTotal: 0,
    orphansList: [],
    unmanagedList: [],
    missing: [],
    incomplete: false,
    removed: 0,
    removedBytes: 0,
    remaining: 0,
    remainingBytes: 0,
    deleted: [],
    refuseCode: null,
    notes,
  };
}

function notesFor(
  scan: CachedScan | MediaScan,
  policy: MediaPolicy,
  mode: 'report' | 'run',
  removed: { count: number; bytes: number } | null,
  refuseCode: PurgeRefusal,
): string[] {
  const notes: string[] = [];
  if (refuseCode) notes.push(REFUSAL_TEXT[refuseCode]);
  if (mode === 'run' && removed && removed.count > 0) {
    notes.push(
      `${faDigits(removed.count)} فایلِ بی‌صاحب پاک شد (${formatMediaBytes(removed.bytes)} آزاد شد).`,
    );
    if (scan.orphans + scan.tempStale - removed.count > 0) {
      notes.push(`${faDigits(scan.orphans - removed.count)} فایلِ دیگر هم بی‌صاحب است؛ دورِ بعدی می‌برداردشان.`);
    }
  } else if (scan.orphans > 0) {
    notes.push(
      `${faDigits(scan.orphans)} فایلِ بی‌صاحب (${formatMediaBytes(
        scan.orphanBytes,
      )}) کهنه‌تر از ${faDigits(policy.graceDays)} روز است.`,
    );
  } else {
    notes.push('هیچ فایلِ بی‌صاحبی نبود — پوشهٔ رسانه پاک است.');
  }
  if (scan.tempStale > 0) {
    notes.push(`${faDigits(scan.tempStale)} فایلِ میانیِ نیمه (${formatMediaBytes(scan.tempStaleBytes)}) هم زباله است.`);
  }
  if (scan.youngSkipped > 0) {
    notes.push(`${faDigits(scan.youngSkipped)} فایلِ تازه‌تر از مهلت دست‌نخورده ماند (بارگذاریِ در جریان ممکن است).`);
  }
  if (scan.unmanaged > 0) {
    notes.push(
      `${faDigits(scan.unmanaged)} فایلِ ناشناس (${formatMediaBytes(
        scan.unmanagedBytes,
      )}) نامش شکلِ فایلِ سامانه نیست — هرگز پاک نمی‌شود؛ خودتان درباره‌اش تصمیم بگیرید.`,
    );
  }
  if (scan.missingTotal > 0) {
    notes.push(
      `${faDigits(scan.missingTotal)} ردیف به فایلی اشاره می‌کند که رویِ دیسک نیست — همان‌ها در فروشگاه تصویرِ شکسته می‌شوند (پوشهٔ رسانه یا آخرینِ پشتیبان را ببینید).`,
    );
  }
  if (scan.incomplete === true) {
    notes.push(
      `پویشِ دیسک کامل نشد (سقفِ ${MEDIA_REPORT_BUDGET_MS} میلی‌ثانیه) — عدد‌هایِ بالا ` +
        `کمترینِ قطعی‌اند؛ برایِ شمارشِ کامل دکمهٔ «از نو بررسی کن» را بزن.`,
    );
  }
  if (scan.deepSkipped > 0) {
    notes.push(`${faDigits(scan.deepSkipped)} شاخه از عمقِ مجاز بیرون بود و پویش نشد.`);
  }
  if (mode === 'report' && !policy.autopurge && scan.orphans > 0) {
    notes.push('پاک‌سازیِ خودکارِ فایل خاموش است؛ اگر می‌خواهید کارگرِ پس از فروش خودش برمی‌دارد، همین خانه را روشن کنید.');
  }
  return notes;
}

function fromScan(policy: MediaPolicy, mode: 'report' | 'run', cached: CachedScan | MediaScan): MediaHygieneReport {
  return {
    mode,
    policy,
    ran: false,
    cached: true,
    scannedAt: cached.scannedAt,
    root: cached.root,
    files: cached.files,
    bytes: cached.bytes,
    referencedUrls: cached.referencedUrls,
    referencedFiles: cached.referencedFiles,
    orphans: cached.orphans,
    orphanBytes: cached.orphanBytes,
    youngSkipped: cached.youngSkipped,
    unmanaged: cached.unmanaged,
    unmanagedBytes: cached.unmanagedBytes,
    tempStale: cached.tempStale,
    tempStaleBytes: cached.tempStaleBytes,
    tempSkipped: cached.tempSkipped,
    deepSkipped: cached.deepSkipped,
    missingTotal: cached.missingTotal,
    incomplete: cached.incomplete === true,
    orphansList: cached.orphansList ?? [],
    unmanagedList: cached.unmanagedList ?? [],
    missing: cached.missing ?? [],
    removed: 0,
    removedBytes: 0,
    remaining: cached.orphans,
    remainingBytes: cached.orphanBytes,
    deleted: [],
    refuseCode: null,
    notes: notesFor(cached, policy, mode, null, null),
  };
}

/**
 * گزارش، و در صورتِ خواست پاک‌سازیِ فایل‌هایِ بی‌صاحب.
 *
 * `mode: 'run'` با چک‌برِ «غیرعادی است» یا با مهلتِ صفر، هیچ چیزی پاک نمی‌کند
 * و همان را در `notes` می‌گوید — «دکمه را زدم و نشد» بی‌جواب نمی‌ماند.
 */
export async function mediaHygiene(
  db: Queryable,
  options: MediaHygieneOptions = {},
): Promise<MediaHygieneReport> {
  const policy = await readMediaPolicy(db);
  const mode = options.mode === 'run' ? 'run' : 'report';
  const limit = Math.max(1, Math.min(5000, Math.floor(options.limit ?? 500)));

  if (policy.graceDays === 0) {
    return zeroReport(policy, mode, [
      'مهلتِ صفر یعنی «هرگز پاک نشود» — برایِ همین نه پویش می‌کنیم نه حذف؛ برایِ پیش‌نمایش، مهلت را عددِ روز بگذارید.',
    ]);
  }

  if (mode === 'report' && !options.fresh) {
    const cached = await readCache(db, policy.scanIntervalMinutes);
    if (cached) return fromScan(policy, mode, cached);
  }

  const result = await removeOrphanMedia(db, {
    graceMinutes: policy.graceDays * 24 * 60,
    limit,
    force: options.force === true,
    // پیش‌نمایش بی‌سقف یعنی «هر بازکردنِ صفحهٔ کالا، یک شمردنِ کاملِ دیسک»؛
    // پاک‌سازیِ دستی (دکمه و کارگر) بی‌سقف است، چون خودش خواسته شده.
    budgetMs: options.budgetMs ?? (mode === 'report' ? MEDIA_REPORT_BUDGET_MS : Number.POSITIVE_INFINITY),
    ...(mode === 'report' ? { dryRun: true } : {}),
  });

  // شمارشِ نیمه کش نمی‌شود: کشیدنِ جوابِ ناقص یعنی عددِ صفحه تا ساعت‌ها کم‌گفته می‌ماند.
  if (!result.incomplete) await writeCache(db, afterRunCache(result));
  const refused = result.refused ?? null;
  return {
    ...fromScan(policy, mode, result),
    cached: false,
    ran: result.removed > 0,
    removed: result.removed,
    removedBytes: result.removedBytes,
    remaining: result.remaining,
    remainingBytes: result.remainingBytes,
    deleted: result.deleted,
    refuseCode: refused,
    notes: notesFor(
      result,
      policy,
      mode,
      result.removed > 0 ? { count: result.removed, bytes: result.removedBytes } : null,
      refused,
    ),
  };
}
