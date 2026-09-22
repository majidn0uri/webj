/**
 * بهداشتِ رسانه: «کدام فایل رویِ دیسک هیچ‌کس نمی‌خواهد؟» و «کدام ردیف به فایلی
 * اشاره می‌کند که دیگر نیست؟»
 *
 * چرا این فایل جدا از `service.ts` است؟ چون پاک کردنِ فایل، برعکسِ نوشتنش،
 * برگشت‌پذیر نیست و سه چیز را هم‌زمان باید درست کند:
 *
 *   ۱) **همهٔ مراجع، نه فقط تصویرِ کالا.** نشانیِ `/media/…` در شش جا ذخیره
 *      می‌شود: سه ستونِ `product_images`، بنرِ ویترین، تصویرِ دسته، و
 *      اسکِنِ چک. فهرستِ مراجع اگر ناقص باشد، پاک‌سازیِ «بی‌صاحب‌ها» دقیقاً
 *      همان بنرِ امروزِ صفحهٔ نخست را می‌بَرَد — و صفحهٔ نخست بی‌هیچ خطایی،
 *      فقط با یک تصویرِ شکسته باز می‌شود. پس مراجع یک `MEDIA_SOURCES` است و
 *      آزمونِ `hygiene.test.ts` از `information_schema` می‌خواند که «هر ستونِ
 *      متنیِ تازه‌ای که شکلِ نشانیِ رسانه می‌گیرد، اینجا هم هست».
 *   ۲) **پنجرهٔ اعتماد.** فایلی که همین حالا نوشته شده ممکن است هنوز به
 *      ردیفش نرسیده باشد؛ و فایلی که پس ازِ بازگردانیِ پشتیبان بی‌صاحب به‌نظر
 *      می‌رسد، لزوماً بی‌صاحب نیست. پس تنها فایل‌هایی کشته می‌شوند که از مهلتِ
 *      مدیر (پیش‌فرض ۱۴ روز، بر پایهٔ `mtime`) کهنه‌ترند — و یک کفِ سختِ
 *      ۶۰ دقیقه‌ای همیشه پابرجاست، حتی اگر مهلت را صفر بگذارید.
 *   ۳) **فقط آنچه خودِ سامانه ساخته.** نامِ فایل‌هایِ ما
 *      `«درنگِ محتوا»-«اندازه».jpg` است. هر فایلِ دیگری در همان پوشه (پشتیبانِ
 *      دستی، خروجیِ یک اسکریپت، چیزی که مدیر روزی آنجا ریخته) شمرده و
 *      **گزارش** می‌شود، ولی هرگز پاک نمی‌شود.
 *
 * دو چک‌برِ «خودکشی» هم همین‌جاست: اگر پایگاه هیچ ارجاعی نداشت ولی دیسک پُر
 * بود، یا اگر بیش از نیمی از دیسک «بی‌صاحب» شمرده شد، پاک‌سازی می‌ایستد و
 * می‌پرسد. این‌ها همان حالت‌هایی‌اند که یک حذفِ بد را به «نصفِ گالری رفت»
 * تبدیل می‌کنند.
 */

import { readdir, rm, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';

import type { Queryable } from '@set/db';

import { mediaRoot, publicUrl } from './store.js';

/** جایی که نشانیِ فایلِ رسانه ذخیره می‌شود */
export interface MediaSource {
  table: string;
  column: string;
  /** برچسبِ فارسی — تا در پنل معلوم باشد آن نشانی مالِ کجاست */
  label: string;
}

/**
 * فهرستِ مراجع. ستونِ تازه‌ای اضافه می‌کنید؟ همین‌جا هم بیایید؛ آزمونِ
 * «پوششِ کاملِ مراجع» از `information_schema` می‌خواند و اگر جا بمانید
 * می‌شکند — چون جا موندنِ این فهرست یعنی حذفِ تصویرِ در حالِ استفاده.
 */
export const MEDIA_SOURCES: ReadonlyArray<MediaSource> = [
  { table: 'product_images', column: 'url', label: 'تصویرِ کالا' },
  { table: 'product_images', column: 'url_card', label: 'تصویرِ کارتِ کالا' },
  { table: 'product_images', column: 'url_thumb', label: 'بندانگشتیِ کالا' },
  { table: 'store_banners', column: 'image_url', label: 'بنرِ ویترین' },
  { table: 'product_types', column: 'image_url', label: 'تصویرِ دسته' },
  { table: 'checks', column: 'image_url', label: 'اسکِنِ چک' },
];

/** کفِ سختِ مهلت (دقیقه) — مهلتِ صفرِ مدیر هم زیرِ این نمی‌رود */
export const MIN_GRACE_MINUTES = 60;

/**
 * نامِ فایل‌هایی که خودِ سامانه می‌سازد: `«درنگ ۶۴ رقمی»-«اندازه».webp`
 * (پسوندِ `jpg` نیز پذیرفته می‌شود تا فایل‌هایِ پیش‌ازِ مهاجرتِ WebP
 * همچنانِ «مدیریت‌شده» شناخته شوند و پاک‌سازیِ یتیمان آن‌ها را هم بپوشاند).
 */
export const MANAGED_NAME = /^[0-9a-f]{16,64}-(full|card|thumb)\.(jpg|webp)$/;

/** فایلِ میانیِ `writeAtomic` — اگر کهنه باشد یعنی نوشتن نیمه‌کاره مانده */
export const TEMP_SUFFIX = '.tmp';

/** مهلتِ فایلِ میانیِ نیمه (دقیقه): تا پیش از این دست‌نخورده می‌ماند */
export const TEMP_MIN_AGE_MINUTES = 15;

/** سقفِ عمقِ پویش — ساختارِ ما دو سطح است؛ بیشتر یعنی چیزِ عجیبی آنجا هست */
export const MAX_DEPTH = 8;

/** چک‌برِ «خودکشی»: با کمتر از این تعداد فایل، نسبت‌ها معنا ندارند */
export const REFUSE_THRESHOLD_FILES = 25;

/** نسبتِ بی‌صاحب که از آن به بعد شک می‌کنیم فهرستِ مراجع خراب شده است */
export const MAX_ORPHAN_RATIO = 0.5;

/** سقفِ تعدادِ بی‌صاحبِ جمع‌آوری‌شده در یک دور (حافظه، نه صحت) */
export const MAX_LIST = 5000;

export interface MediaScanOptions {
  /** فایل‌هایی که تازه‌تر از این‌اند بی‌صاحب شمرده نمی‌شوند (کف: ۶۰ دقیقه) */
  graceMinutes?: number;
  /** چند نمونه از بی‌صاحب‌ها نام برده شود (پیش‌فرض ۲۰، سقف ۵۰۰۰) */
  listLimit?: number;
  /** پوشهٔ رسانه؛ پیش‌فرض `MEDIA_DIR` — برایِ آزمون و نصبِ غیراستاندارد */
  root?: string;
  /**
   * سقفِ زمانِ پویش (میلی‌ثانیه). تعریف‌نشده/`Infinity`/منفی یعنی بی‌سقف؛
   * `0` یعنی «فقط نخستین فایل» — برایِ آزمون و برایِ هر جا که بخواهی
   * هزینهٔ پویش را به کمترینِ ممکن برسانی.
   *
   * چرا این هست؟ «چند فایلِ بی‌صاحب داریم؟» در صفحهٔ ویرایشِ کالا پرسیده می‌شود
   * و پویش یعنی یک `stat` به‌ازایِ هر فایل — رویِ صدها‌هزار فایل همان چیزی
   * می‌شود که کاربر «سنگین شدنِ سرور» صدا می‌زند. با سقف، یا جوابِ کامل
   * می‌گیری یا جوابی که رویش نوشته «کامل نشد» — نه صفحه‌ای که سه دقیقه
   * می‌چرخد. پاک‌سازیِ دستی بی‌سقف است؛ فقط پیش‌نمایش خودش را محدود می‌کند.
   */
  budgetMs?: number;
}

export interface OrphanFile {
  /** همان نشانیِ `/media/…` که اگر روزی پیوند بخورد، در ستون می‌نشیند */
  url: string;
  /** مسیرِ نسبی به ریشه — چیزی که برایِ حذف لازم است (بی‌بازیِ رشته‌ای) */
  relative: string;
  bytes: number;
  ageMinutes: number;
}

export interface UnmanagedFile {
  url: string;
  bytes: number;
}

export interface MissingLink {
  url: string;
  label: string;
  ownerId: string;
}

export interface MediaScan {
  root: string;
  /** هر فایلی که در پوشهٔ رسانه دیدیم (به هر نامی) */
  files: number;
  /** حجمِ همان‌ها */
  bytes: number;
  /** چند نشانیِ یکتا در پایگاه به `/media/` اشاره می‌کند */
  referencedUrls: number;
  /** چندتا از آن نشانی‌ها رویِ دیسک هم هستند */
  referencedFiles: number;
  orphans: number;
  orphanBytes: number;
  /** بی‌ارجاع‌هایی که به‌خاطرِ مهلت نگه داشته شدند */
  youngSkipped: number;
  /** فایل‌هایی که نامشان شکلِ فایلِ ما نیست — شمرده، بی‌حذف‌کردن */
  unmanaged: number;
  unmanagedBytes: number;
  /** فایل‌هایِ میانیِ نیمه که جوان بودند و بخشیده شدند */
  tempSkipped: number;
  /** فایل‌هایِ میانیِ کهنه (`*.tmp`) — از هر شمارشی بیرون‌اند و پاک می‌شوند */
  tempStale: number;
  tempStaleBytes: number;
  /** شاخه‌هایی که از عمقِ مجاز گذشتند و پویش نشدند (گزارش، نه حذف) */
  deepSkipped: number;
  /** چند ردیف به فایلی اشاره می‌کند که رویِ دیسک نیست (حداکثر تا `listLimit`) */
  missingTotal: number;
  orphansList: OrphanFile[];
  unmanagedList: UnmanagedFile[];
  tempStaleList: Array<{ relative: string; bytes: number }>;
  missing: MissingLink[];
  /** آیا پویش به سقفِ زمان خورد؟ (در این حالت عدد‌ها «حداقلِ» قطعی‌اند) */
  incomplete: boolean;
  scannedAt: string;
}

/**
 * همهٔ نشانی‌هایِ `/media/…` که یک ردیفِ زنده به آن‌ها تکیه کرده است.
 *
 * عمداً بی‌LIMIT: هر نشانی که از این فهرست بیفتد، فایلش «بی‌صاحب» شمرده و
 * پاک می‌شود.
 */
export async function referencedMediaUrls(db: Queryable): Promise<Set<string>> {
  const sql = MEDIA_SOURCES.map(
    ({ table, column }) => `SELECT ${column} AS url FROM ${table} WHERE ${column} LIKE '/media/%'`,
  ).join('\n     UNION\n     ');
  const { rows } = await db.query<{ url: string }>(sql);
  return new Set(rows.map((r) => r.url));
}

/** برایِ نشانی‌هایی که رویِ دیسک نیست: ردیفشان مالِ کدام جدول و کدام ردیف است */
async function ownersOf(db: Queryable, urls: string[]): Promise<MissingLink[]> {
  if (urls.length === 0) return [];
  const found: MissingLink[] = [];
  for (const { table, column, label } of MEDIA_SOURCES) {
    if (found.length >= urls.length) break;
    const { rows } = await db.query<{ url: string; id: string }>(
      `SELECT ${column} AS url, id::text AS id FROM ${table}
        WHERE ${column} = ANY($1::text[])
        LIMIT $2`,
      [urls, urls.length - found.length],
    );
    for (const r of rows) found.push({ url: r.url, label, ownerId: r.id });
  }
  return found;
}

/**
 * پویشِ پوشهٔ رسانه و طبقه‌بندیِ فایل‌ها. هیچ چیزی پاک نمی‌کند.
 *
 * اگر خواندنِ پایگاه خطا بدهد، همین‌جا خطا بالا می‌آید و پاک‌سازی اجرا
 * نمی‌شود: «بی‌صاحب» یعنی «مطمئنیم هیچ ردیفی نمی‌خواهدش»، و حدس‌زدن در این
 * سمتِ کار مجاز نیست.
 */
export async function scanOrphanMedia(db: Queryable, options: MediaScanOptions = {}): Promise<MediaScan> {
  const root = path.resolve(options.root ?? mediaRoot());
  const graceMinutes = Math.max(MIN_GRACE_MINUTES, Math.floor(options.graceMinutes ?? MIN_GRACE_MINUTES));
  const listLimit = Math.max(1, Math.min(MAX_LIST, options.listLimit ?? 20));
  // بی‌سقف: `undefined`، `Infinity`، NaN یا منفی. `0` یک سقفِ واقعی است:
  // «هرچه تا نخستین فایل دیدی» — که آزمونِ این مسیر به همان نیاز دارد.
  const rawBudget = options.budgetMs;
  const budgetMs =
    rawBudget === undefined || !Number.isFinite(rawBudget) || rawBudget < 0
      ? -1
      : Math.floor(rawBudget);
  const startedAt = Date.now();
  let incomplete = false;
  const referenced = await referencedMediaUrls(db);

  const now = Date.now();
  let files = 0;
  let bytes = 0;
  let referencedFiles = 0;
  let orphans = 0;
  let orphanBytes = 0;
  let youngSkipped = 0;
  let unmanaged = 0;
  let unmanagedBytes = 0;
  let tempSkipped = 0;
  let tempStale = 0;
  let tempStaleBytes = 0;
  let deepSkipped = 0;
  const tempStaleList: Array<{ relative: string; bytes: number }> = [];
  const orphansList: OrphanFile[] = [];
  const unmanagedList: UnmanagedFile[] = [];
  /** نشانی‌هایی که پایگاه می‌خواهد و دیسک دارد — برایِ تشخیصِ تصویرِ شکسته */
  const onDisk = new Set<string>();

  async function walk(dir: string, depth: number): Promise<void> {
    let entries: Dirent[];
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
    } catch {
      return; // پوشه‌ای نیست: نصبِ تازه، هنوز چیزی بارگذاری نشده
    }
    for (const entry of entries) {
      if (budgetMs >= 0 && files > 0 && Date.now() - startedAt >= budgetMs) {
        incomplete = true;
        return;
      }
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth + 1 > MAX_DEPTH) {
          deepSkipped += 1;
          continue;
        }
        await walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;

      const relative = path.relative(root, absolute);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue; // بیرون از ریشه
      const url = publicUrl(relative);
      onDisk.add(url);
      const info = await stat(absolute);
      files += 1;
      bytes += info.size;
      const ageMinutes = Math.floor((now - info.mtimeMs) / 60_000);

      if (entry.name.endsWith(TEMP_SUFFIX)) {
        // نوشتنِ اتمیک دو گام است؛ فایلِ میانیِ کهنه یعنی آن دوم گام هیچ‌وقت
        // نیامده. جوانش را دست نمی‌زنیم، وگرنه بارگذاریِ در جریان می‌شکند.
        if (ageMinutes < TEMP_MIN_AGE_MINUTES) tempSkipped += 1;
        else {
          tempStale += 1;
          tempStaleBytes += info.size;
          if (tempStaleList.length < listLimit) tempStaleList.push({ relative, bytes: info.size });
        }
        continue;
      }
      if (referenced.has(url)) {
        referencedFiles += 1;
        continue;
      }
      if (!MANAGED_NAME.test(entry.name)) {
        unmanaged += 1;
        unmanagedBytes += info.size;
        if (unmanagedList.length < listLimit) unmanagedList.push({ url, bytes: info.size });
        continue;
      }
      if (ageMinutes < graceMinutes) {
        youngSkipped += 1;
        continue;
      }
      orphans += 1;
      orphanBytes += info.size;
      if (orphansList.length < listLimit) orphansList.push({ url, relative, bytes: info.size, ageMinutes });
    }
  }

  let rootIsDir = false;
  try {
    rootIsDir = (await stat(root)).isDirectory();
  } catch {
    rootIsDir = false;
  }
  if (rootIsDir) await walk(root, 0);

  // با پویشِ نیمه «رویِ دیسک نبود» یعنی «هنوز نوبتش نشده» — نه تصویرِ شکسته
  const missingUrls: string[] = [];
  for (const url of incomplete ? [] : referenced) {
    if (!onDisk.has(url)) missingUrls.push(url);
    if (missingUrls.length >= listLimit) break;
  }

  return {
    root,
    files,
    bytes,
    referencedUrls: referenced.size,
    referencedFiles,
    orphans,
    orphanBytes,
    youngSkipped,
    unmanaged,
    unmanagedBytes,
    tempSkipped,
    tempStale,
    tempStaleBytes,
    deepSkipped,
    missingTotal: missingUrls.length,
    orphansList,
    unmanagedList,
    tempStaleList,
    missing: await ownersOf(db, missingUrls),
    incomplete,
    scannedAt: new Date().toISOString(),
  };
}

/** دلیلِ ایستادنِ پاک‌سازی — جمله‌سازیِ فارسی کارِ لایهٔ سیاست است، نه اینجا */
export type PurgeRefusal = 'no-references' | 'orphan-ratio' | null;

export interface RemoveMediaOptions extends MediaScanOptions {
  /** فقط بشمار، چیزی پاک نکن */
  dryRun?: boolean;
  /** در این دور چند فایل پاک شود */
  limit?: number;
  /** با وجودِ چک‌برها اجرا کن */
  force?: boolean;
  /** پویشِ از پیش انجام‌شده — تا یک پویش دو بار تکرار نشود */
  scan?: MediaScan;
}

export interface RemoveMediaResult extends MediaScan {
  dryRun: boolean;
  graceMinutes: number;
  limit: number;
  refused: PurgeRefusal;
  /** در dryRun: چند فایل **می‌شد** پاک شود */
  removable: number;
  removableBytes: number;
  /** آنچه در این دور واقعاً پاک شد */
  removed: number;
  removedBytes: number;
  /** چندتا از آن‌ها فایلِ میانیِ نیمه بودند (برایِ همین جدا شمرده می‌شوند) */
  removedTemp: number;
  removedTempBytes: number;
  /** برایِ دورهایِ بعد */
  remaining: number;
  remainingBytes: number;
  deleted: string[];
}

/**
 * پویش و (اگر چیزی مانع نبود) حذفِ فایل‌هایِ بی‌صاحب.
 *
 * «شمار، بعد بسوزان» با یک پویش انجام می‌شود و `listLimit` همان `limit` است،
 * تا عددِ پیش‌نمایش با عددِ نتیجه یکی باشد — دو عددِ متفاوت از یک کار، همان
 * چیزی است که مدیر را به هر دکمی بی‌اعتماد می‌کند.
 */
export async function removeOrphanMedia(db: Queryable, options: RemoveMediaOptions = {}): Promise<RemoveMediaResult> {
  const limit = Math.max(1, Math.min(MAX_LIST, Math.floor(options.limit ?? 500)));
  const graceMinutes = Math.max(MIN_GRACE_MINUTES, Math.floor(options.graceMinutes ?? MIN_GRACE_MINUTES));
  const dryRun = options.dryRun === true;
  // برایِ حذفِ واقعی باید خودِ فهرست را داشته باشیم؛ اگر پویشِ داده‌شده فهرستش
  // کوتاه‌تر از `limit` است (مثلاً برایِ گزارشِ ۲۰ تایی ساخته شده)، از نو می‌پویشیم.
  const scan =
    options.scan && options.scan.orphansList.length >= Math.min(limit, options.scan.orphans)
      ? options.scan
      : await scanOrphanMedia(db, {
          graceMinutes,
          listLimit: limit,
          root: options.root,
          // بی‌این خط، سقفِ زمانِ خواسته‌شده در «فقط گزارش» گم می‌شد و
          // روبشِ واقعی تمامِ دیسک را می‌گشت
          budgetMs: options.budgetMs,
        });

  let refused: PurgeRefusal = null;
  if (!options.force) {
    if (scan.referencedUrls === 0 && scan.files >= REFUSE_THRESHOLD_FILES) refused = 'no-references';
    if (
      refused === null &&
      // با شمارشِ نیمه نمی‌شود نسبتِ بی‌صاحب را داوری کرد
      !scan.incomplete &&
      scan.files >= REFUSE_THRESHOLD_FILES &&
      scan.orphanBytes > scan.bytes * MAX_ORPHAN_RATIO
    ) {
      refused = 'orphan-ratio';
    }
  }

  const garbage = scan.orphans + scan.tempStale;
  const removable = Math.min(garbage, limit);
  const removableBytes =
    scan.orphansList.length >= Math.min(scan.orphans, limit) && scan.tempStaleList.length >= scan.tempStale
      ? sumFirst(scan.orphansList, Math.min(scan.orphans, limit)) + sumFirst(scan.tempStaleList, scan.tempStale)
      : scan.orphanBytes + scan.tempStaleBytes;
  const result: RemoveMediaResult = {
    ...scan,
    dryRun,
    graceMinutes,
    limit,
    refused,
    removable: refused === null ? removable : 0,
    removableBytes: refused === null ? removableBytes : 0,
    removed: 0,
    removedBytes: 0,
    removedTemp: 0,
    removedTempBytes: 0,
    remaining: refused === null ? Math.max(0, garbage - removable) : garbage,
    remainingBytes: refused === null ? Math.max(0, scan.orphanBytes + scan.tempStaleBytes - removableBytes) : scan.orphanBytes + scan.tempStaleBytes,
    deleted: [],
  };
  if (refused !== null || dryRun) return result;

  let budget = limit;
  const kill = async (relative: string, bytes: number, url: string, temp: boolean): Promise<void> => {
    if (budget <= 0) return;
    budget -= 1;
    // `rm force`: اگر در همین فاصله پاک شده (دو اجرایِ هم‌زمان)، خطا نمی‌دهد
    await rm(path.resolve(scan.root, relative), { force: true });
    result.removed += 1;
    result.removedBytes += bytes;
    if (temp) {
      result.removedTemp += 1;
      result.removedTempBytes += bytes;
    }
    result.deleted.push(url);
  };
  for (const tmp of scan.tempStaleList) await kill(tmp.relative, tmp.bytes, publicUrl(tmp.relative), true);
  for (const orphan of scan.orphansList) await kill(orphan.relative, orphan.bytes, orphan.url, false);
  result.remaining = Math.max(0, garbage - result.removed);
  result.remainingBytes = Math.max(0, scan.orphanBytes + scan.tempStaleBytes - result.removedBytes);
  return result;
}

function sumFirst(list: Array<{ bytes: number }>, n: number): number {
  return list.slice(0, Math.max(0, n)).reduce((a, b) => a + b.bytes, 0);
}
