import { mkdtemp, utimes, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { applyMigrations, createDatabase, seedCatalog, type Database } from '@set/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  MANAGED_NAME,
  MAX_ORPHAN_RATIO,
  MIN_GRACE_MINUTES,
  MEDIA_SOURCES,
  referencedMediaUrls,
  removeOrphanMedia,
  scanOrphanMedia,
} from './hygiene.js';
import { publicUrl } from './store.js';

/**
 * آزمون‌هایِ «بهداشتِ رسانه».
 *
 * اینجا چیزی که سنجیده می‌شود «پاک‌کردن» نیست — **نبودنِ** پاک‌کردن است. هر
 * اشتباه در این مسیر یک فایلِ تصویر را برایِ همیشه از بین می‌بَرَد و در فروشگاه
 * فقط یک جایِ خالی می‌ماند؛ هیچ استثنایی ثبت نمی‌شود و هیچ پیامکی نمی‌آید. پس
 * هر آزمون یا «این فایل نباید برود» را می‌گوید یا «این عدد را اشتباه گزارش
 * مَده».
 */

const DAY = 86_400_000;
const HASH = 'f'.repeat(64);

let db: Database;
let mediaDir: string;
let productId: string;
let typeId: string;

/** یک فایلِ رسانه می‌سازد و سنّش را تنظیم می‌کند */
async function putFile(hash: string, kind: 'full' | 'card' | 'thumb', ageDays: number, dir = 2): Promise<string> {
  const sub = hash.slice(0, dir);
  await mkdir(path.join(mediaDir, sub), { recursive: true });
  const relative = path.join(sub, `${hash}-${kind}.jpg`);
  const absolute = path.join(mediaDir, relative);
  await writeFile(absolute, Buffer.alloc(1024, 7));
  if (ageDays > 0) {
    const when = new Date(Date.now() - ageDays * DAY);
    await utimes(absolute, when, when);
  }
  return publicUrl(relative);
}

/** هر سه اندازه‌یِ یک بارگذاری (آنچه `saveUpload` رویِ دیسک می‌گذارد) */
async function putVariantSet(hash: string, ageDays: number): Promise<{ url: string; card: string; thumb: string }> {
  return {
    url: await putFile(hash, 'full', ageDays),
    card: await putFile(hash, 'card', ageDays),
    thumb: await putFile(hash, 'thumb', ageDays),
  };
}

/** یک درنگِ ۶۴ رقمیِ معتبر از شمارهِ آزمون (تا فایل‌ها نامِ یکتا داشته باشند) */
function hashFor(i: number): string {
  return i.toString(16).padStart(64, '0').slice(-64);
}

async function has(url: string): Promise<boolean> {
  const relative = url.replace(/^\/media\//, '').split('/').join(path.sep);
  try {
    const { stat } = await import('node:fs/promises');
    await stat(path.join(mediaDir, relative));
    return true;
  } catch {
    return false;
  }
}

async function setCol(sql: string, params: unknown[] = []): Promise<void> {
  await db.query(sql, params as never[]);
}

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(tmpdir(), 'set-hygiene-'));
  process.env.MEDIA_DIR = mediaDir;

  db = createDatabase('memory://');
  await applyMigrations(db);
  await seedCatalog(db, { openingInventory: false });
  productId = (await db.query<{ id: string }>(`SELECT id FROM products LIMIT 1`)).rows[0]!.id;
  typeId = (await db.query<{ id: string }>(`SELECT id FROM product_types LIMIT 1`)).rows[0]!.id;
}, 240_000);

beforeEach(async () => {
  // هر آزمون از یک پوشهٔ خالی و یک پایگاهِ بی‌ارجاع شروع می‌کند
  const { readdir, rm } = await import('node:fs/promises');
  for (const entry of await readdir(mediaDir)) await rm(path.join(mediaDir, entry), { recursive: true, force: true });
  await setCol(`DELETE FROM product_images`);
  await setCol(`DELETE FROM store_banners`);
  await setCol(`UPDATE product_types SET image_url = NULL`);
});

afterAll(async () => {
  await db.close();
});

describe('مرجع‌ها: چه چیزی «در حالِ استفاده» حساب می‌شود', () => {
  it('فایلِ بی‌صاحبِ کهنه می‌رود و تازه‌اش می‌ماند', async () => {
    const gone = await putVariantSet('a'.repeat(64), 40);
    const kept = await putVariantSet('b'.repeat(64), 0);

    const report = await removeOrphanMedia(db, { graceMinutes: 60 * 24, limit: 100 });
    expect(report.orphans).toBe(3);
    expect(report.removed).toBe(3);
    expect(report.youngSkipped).toBe(3);
    expect(await has(gone.url)).toBe(false);
    expect(await has(kept.url)).toBe(true);
  });

  it('مهلتِ صفرِ گزینه، کفِ ۶۰ دقیقه را می‌شکند نه «همه‌چیز را بریز دور»', async () => {
    const young = await putFile('c'.repeat(64), 'full', 0);
    const report = await removeOrphanMedia(db, { graceMinutes: 0 });
    expect(report.graceMinutes).toBe(MIN_GRACE_MINUTES);
    expect(report.orphans).toBe(0);
    expect(report.youngSkipped).toBe(1);
    expect(await has(young)).toBe(true);
  });

  it('تصویرِ کالایِ دیگر که به همان فایل اشاره می‌کند، فایل را نگه می‌دارد', async () => {
    const shared = await putVariantSet('d'.repeat(64), 90);
    await setCol(
      `INSERT INTO product_images (product_id, url, url_card, url_thumb, role)
       VALUES ($1,$2,$3,$4,'main')`,
      [productId, shared.url, shared.card, shared.thumb],
    );
    await removeOrphanMedia(db, { graceMinutes: 60 });
    expect(await has(shared.url)).toBe(true);
    expect(await has(shared.card)).toBe(true);
  });

  // این آزمونِ اصلیِ همین نوبت است: تا پیش از این فقط `product_images` خوانده
  // می‌شد و پاک‌سازی می‌توانست بنرِ در حالِ نمایش یا تصویرِ دسته را بَرد.
  it('ارجاع از بنرِ ویترین و تصویرِ دسته هم فایل را محافظت می‌کند', async () => {
    const banner = await putVariantSet('e'.repeat(64), 200);
    const category = await putVariantSet('1'.repeat(64), 200);
    await setCol(
      `INSERT INTO store_banners (kind, title, image_url) VALUES ('hero','بنرِ آزمون',$1)`,
      [banner.url],
    );
    await setCol(`UPDATE product_types SET image_url = $1 WHERE id = $2`, [category.url, typeId]);

    const urls = await referencedMediaUrls(db);
    expect(urls.has(banner.url)).toBe(true);
    expect(urls.has(category.url)).toBe(true);

    await removeOrphanMedia(db, { graceMinutes: 60 });
    expect(await has(banner.url)).toBe(true);
    expect(await has(category.url)).toBe(true);
    expect(await has(banner.thumb)).toBe(false); // انداره‌هایِ بی‌ارجاعِ همان بارگذاری می‌روند
  });

  it('نشانیِ بیرونی (https://…) در بنر، فایلِ ما را بی‌دلیل محافظت نمی‌کند', async () => {
    await setCol(`INSERT INTO store_banners (kind, title, image_url) VALUES ('hero','بیرونی','https://cdn.example/x.jpg')`);
    const orphan = await putFile('2'.repeat(64), 'full', 60);
    const report = await removeOrphanMedia(db, { graceMinutes: 60 });
    expect(report.orphans).toBe(1);
    expect(report.removed).toBe(1);
    expect(await has(orphan)).toBe(false);
  });

  it('هر ستونِ متنیِ تازه‌ای که نشانیِ رسانه می‌گیرد، در MEDIA_SOURCES هست', async () => {
    // فهرستِ مراجع اگر از یک ستونِ تازه غافل بماند، آن ستون یعنی «فایلِ در حالِ
    // استفاده که بی‌صاحب شمرده و سوزانده می‌شود». پس از خودِ دیتابیس می‌پرسیم،
    // نه از این آرایه — و هر ستونِ تازه‌ای باید یا فهرست شود یا در فهرستِ
    // «به‌کارِ رسانه نیست» بنشیند، آن هم با دلیل.
    const NOT_MEDIA_PATHS = new Set([
      'payments.callback_url', // نشانیِ بازگشتِ درگاه
      'payments.redirect_url', // همان، سمتِ کاربر
      'store_banners.link_url', // لینکِ تبلیغاتی، نه فایلِ ما
      'shipments.tracking_url',
      'returns.label_url',
      'media_objects.url',
    ]);
    const { rows } = await db.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'text'
          AND (column_name = 'image_url' OR column_name = 'url' OR column_name ~ '_(card|thumb)_url$' OR column_name = 'url_card' OR column_name = 'url_thumb')`,
    );
    const declared = new Set(MEDIA_SOURCES.map((src) => `${src.table}.${src.column}`));
    const candidates = rows.map((r) => `${r.table_name}.${r.column_name}`).sort();
    const missing = candidates.filter((c) => !declared.has(c) && !NOT_MEDIA_PATHS.has(c));
    expect(missing, `این ستون‌ها به فهرستِ مراجع اضافه نشدند: ${missing.join(', ')}`).toEqual([]);
    // و خودِ فهرست هم باید واقعاً به ستون‌هایِ موجود اشاره کند (ستونِ تغییرنام‌یافته
    // یعنی کوئریِ مراجع با ۴۲۷ می‌ترکد و پاک‌سازی از کار می‌افتد)
    for (const src of MEDIA_SOURCES) {
      expect(candidates, `${src.table}.${src.column} دیگر وجود ندارد`).toContain(`${src.table}.${src.column}`);
    }
    expect(declared.size).toBeGreaterThanOrEqual(6);
  });
});

describe('طبقه‌بندیِ درستِ فایل‌ها', () => {
  it('فایلِ ناشناس شمرده می‌شود ولی هرگز پاک نمی‌شود', async () => {
    await mkdir(path.join(mediaDir, 'backup'), { recursive: true });
    await writeFile(path.join(mediaDir, 'backup', 'پشتیبانِ-دستی.tar'), Buffer.alloc(2048));
    const aged = await putFile('3'.repeat(64), 'full', 90);

    const report = await removeOrphanMedia(db, { graceMinutes: 60 });
    expect(report.unmanaged).toBe(1);
    expect(report.orphans).toBe(1);
    expect(await has(aged)).toBe(false);
    const { stat } = await import('node:fs/promises');
    await expect(stat(path.join(mediaDir, 'backup', 'پشتیبانِ-دستی.tar'))).resolves.toBeTruthy();
  });

  it('فایلِ میانیِ نیمهٔ کهنه می‌رود، جوانش می‌ماند', async () => {
    const stale = path.join(mediaDir, 'ab');
    await mkdir(stale, { recursive: true });
    await writeFile(path.join(stale, `${'4'.repeat(64)}-full.jpg.111.tmp`), Buffer.alloc(512));
    const when = new Date(Date.now() - 3 * 3600_000);
    await utimes(path.join(stale, `${'4'.repeat(64)}-full.jpg.111.tmp`), when, when);
    await writeFile(path.join(stale, `${'5'.repeat(64)}-full.jpg.222.tmp`), Buffer.alloc(512));

    const report = await removeOrphanMedia(db, { graceMinutes: 60 });
    expect(report.tempStale).toBe(1);
    expect(report.tempSkipped).toBe(1);
    expect(report.removed).toBe(1);
    const { access } = await import('node:fs/promises');
    await expect(access(path.join(stale, `${'4'.repeat(64)}-full.jpg.111.tmp`))).rejects.toBeTruthy();
    await expect(access(path.join(stale, `${'5'.repeat(64)}-full.jpg.222.tmp`))).resolves.toBeUndefined();
  });

  it('نامِ فایلِ ما با نام‌هایِ دیگر قاطی نمی‌شود', () => {
    expect(MANAGED_NAME.test(`${'a'.repeat(64)}-full.jpg`)).toBe(true);
    expect(MANAGED_NAME.test(`${'a'.repeat(64)}-full.webp`)).toBe(true);
    expect(MANAGED_NAME.test(`${'a'.repeat(64)}-thumb.webp`)).toBe(true);
    expect(MANAGED_NAME.test(`${'a'.repeat(64)}-card.jpg`)).toBe(true);
    expect(MANAGED_NAME.test(`${'a'.repeat(64)}-detail.jpg`)).toBe(false);
    expect(MANAGED_NAME.test('IMG_2024.jpg')).toBe(false);
    expect(MANAGED_NAME.test(`${'a'.repeat(8)}-full.jpg`)).toBe(false);
  });

  it('ردیفی که فایلش نیست، «تصویرِ شکسته» گزارش می‌شود (و ردیف دست نمی‌خورد)', async () => {
    await setCol(
      `INSERT INTO product_images (product_id, url, role) VALUES ($1,'/media/ff/${'9'.repeat(64)}-full.jpg','main')`,
      [productId],
    );
    const scan = await scanOrphanMedia(db, { graceMinutes: 60 });
    expect(scan.missingTotal).toBe(1);
    expect(scan.missing[0]!.label).toBe('تصویرِ کالا');
    expect(scan.missing[0]!.url).toContain('-full.jpg');
    // و حذفِ فایل، هیچ‌وقت ردیفِ پایگاه را پاک نمی‌کند
    await removeOrphanMedia(db, { graceMinutes: 60 });
    expect((await db.query(`SELECT count(*)::text n FROM product_images`)).rows[0]!.n).toBe('1');
  });
});

describe('چک‌برها', () => {
  it('بی‌هیچ ارجاعی در پایگاه، با دیسکِ پُر هیچ فایل نمی‌رود', async () => {
    for (let i = 0; i < 26; i++) await putFile(hashFor(i), 'full', 400);
    const dry = await removeOrphanMedia(db, { graceMinutes: 60, limit: 100 });
    expect(dry.refused).toBe('no-references');
    expect(dry.removed).toBe(0);
    expect(dry.orphans).toBe(26);

    const forced = await removeOrphanMedia(db, { graceMinutes: 60, limit: 100, force: true });
    expect(forced.refused).toBeNull();
    expect(forced.removed).toBe(26);
  });

  it('اگر بیش از نیمی از دیسک «بی‌صاحب» باشد، می‌ایستد', async () => {
    const used = await putVariantSet('7'.repeat(64), 400);
    await setCol(`INSERT INTO product_images (product_id, url, url_card, url_thumb, role) VALUES ($1,$2,$3,$4,'main')`, [
      productId,
      used.url,
      used.card,
      used.thumb,
    ]);
    for (let i = 0; i < 30; i++) await putFile(hashFor(100 + i), 'full', 400);

    const report = await removeOrphanMedia(db, { graceMinutes: 60, limit: 100 });
    expect(report.refused).toBe('orphan-ratio');
    expect(report.removed).toBe(0);
    // dryRun هم همین را می‌گوید تا پیش‌نمایشِ پنل، اجرایِ شکست‌خورده را «موفق» نخواند
    const preview = await removeOrphanMedia(db, { graceMinutes: 60, dryRun: true });
    expect(preview.refused).toBe('orphan-ratio');
    expect(preview.removable).toBe(0);
  });

  it('dryRun همان عددِ اجرا را می‌دهد و چیزی را نمی‌کُشد', async () => {
    await putVariantSet('8'.repeat(64), 400);
    const preview = await removeOrphanMedia(db, { graceMinutes: 60, dryRun: true, limit: 2 });
    expect(preview.removable).toBe(2);
    expect(preview.remaining).toBe(1);
    expect(preview.removed).toBe(0);
    const real = await removeOrphanMedia(db, { graceMinutes: 60, limit: 2 });
    expect(real.removed).toBe(2);
    expect(real.remaining).toBe(preview.remaining);
  });

  it('سقفِ دور رعایت می‌شود و «باقی‌مانده» درست گفته می‌شود', async () => {
    for (let i = 0; i < 12; i++) await putFile(hashFor(i), 'full', 400);
    const first = await removeOrphanMedia(db, { graceMinutes: 60, limit: 5 });
    expect(first.removed).toBe(5);
    expect(first.remaining).toBe(7);
    expect(first.limit).toBe(5);
    const second = await removeOrphanMedia(db, { graceMinutes: 60, limit: 5 });
    expect(second.removed).toBe(5);
    expect(second.remaining).toBe(2);
  });

  it('سقفِ بی‌حد و گوشهٔ منفی، سیاست را نمی‌شکنند', async () => {
    const a = await removeOrphanMedia(db, { limit: 10_000_000, graceMinutes: -50 });
    expect(a.limit).toBe(5000);
    expect(a.graceMinutes).toBe(MIN_GRACE_MINUTES);
  });
});

describe('سقفِ زمانِ پویش: صفحهٔ کالا نباید منتظرِ شمردنِ دیسک بماند', () => {
  /**
   * چرا این آزمون هست: پرسشِ «چند فایلِ بی‌صاحب داریم؟» در هر بازکردنِ صفحهٔ
   * ویرایشِ کالا جواب داده می‌شود، ولی پاسخ‌دادنش یعنی یک `stat` به‌ازایِ هر
   * فایلِ رویِ دیسک. رویِ انبارِ تصویرِ واقعی، همین یک شماره‌گیرِ کنارِ صفحه
   * سرور را قفل می‌کند. پس پویش سقفِ زمان دارد و وقتی به سقف خورد باید **روشن**
   * بگوید که نیمه‌کاره مانده — وگرنه «۲ فایلِ بی‌صاحب» برایِ دیسکی با ۴۰۰ هزار
   * فایل، یک دروغِ بی‌ضرر به‌نظرِ همه است.
   */
  it('بی‌سقف کامل می‌شود؛ با سقفِ صفر می‌ایستد و پرچم را بالا می‌آورد', async () => {
    for (let i = 0; i < 6; i++) await putFile(hashFor(i), 'full', 400);
    const full = await scanOrphanMedia(db, { graceMinutes: 60 * 24 });
    expect(full.incomplete).toBe(false);
    expect(full.files).toBe(6);

    const partial = await scanOrphanMedia(db, { graceMinutes: 60 * 24, budgetMs: 0 });
    expect(partial.incomplete).toBe(true);
    expect(partial.files).toBeGreaterThanOrEqual(1);
    expect(partial.files).toBeLessThan(6);
    expect(partial.orphanBytes).toBeLessThan(full.orphanBytes);
  });

  it('`Infinity` و عددِ منفی یعنی بی‌سقف — شمارشِ کامل همان‌جا تمام می‌شود', async () => {
    for (let i = 0; i < 4; i++) await putFile(hashFor(i + 16), 'full', 400);
    const viaInfinity = await scanOrphanMedia(db, {
      graceMinutes: 60 * 24,
      budgetMs: Number.POSITIVE_INFINITY,
    });
    expect(viaInfinity.incomplete).toBe(false);
    expect(viaInfinity.files).toBe(4);
    const viaNegative = await scanOrphanMedia(db, { graceMinutes: 60 * 24, budgetMs: -1 });
    expect(viaNegative.incomplete).toBe(false);
    expect(viaNegative.files).toBe(4);
  });

  it('با پویشِ نیمه، «ردیفِ بی‌فایل» گزارش نمی‌شود — چون هنوز نوبتش نشده', async () => {
    const broken = await putVariantSet('9'.repeat(64), 40);
    await setCol(
      `INSERT INTO product_images (product_id, url, url_card, url_thumb, role)
       VALUES ($1,$2,$3,$4,'main')`,
      [productId, broken.url, broken.card, broken.thumb],
    );
    const { rm } = await import('node:fs/promises');
    await rm(path.join(mediaDir, broken.url.replace('/media/', '')), { force: true });
    await putFile(hashFor(41), 'full', 400);

    const full = await scanOrphanMedia(db, { graceMinutes: 60 * 24 });
    // فقط `url` از دیسک رفت؛ `card` و `thumb` همان‌جا هستند
    expect(full.missingTotal).toBe(1);
    expect(full.incomplete).toBe(false);

    const partial = await scanOrphanMedia(db, { graceMinutes: 60 * 24, budgetMs: 0 });
    expect(partial.incomplete).toBe(true);
    expect(partial.missingTotal).toBe(0);
  });

  it('سقفِ زمان، خودِ پاک‌سازی را هم محدود می‌کند (و همان‌ها را که دیده می‌برد)', async () => {
    for (let i = 0; i < 5; i++) await putFile(hashFor(i + 32), 'full', 400);
    const run = await removeOrphanMedia(db, { graceMinutes: 60 * 24, limit: 100, budgetMs: 0 });
    expect(run.incomplete).toBe(true);
    expect(run.removed).toBe(run.files);
    expect(run.removed).toBeLessThan(5);
    // فایلِ ندیده‌شده باید سرِ جایش بماند، نه اینکه «پاک شد» گزارش شود
    const left = await scanOrphanMedia(db, { graceMinutes: 60 * 24 });
    expect(left.files).toBe(5 - run.removed);
    expect(left.incomplete).toBe(false);
  });

  it('چک‌برِ «نیمی از دیسک بی‌صاحب است» با شمارشِ نیمه داوری نمی‌کند', async () => {
    const kept = await putVariantSet('e'.repeat(64), 0);
    await setCol(`INSERT INTO store_banners (kind, title, image_url) VALUES ('hero','بنر',$1)`, [kept.url]);
    for (let i = 0; i < 40; i++) await putFile(hashFor(i + 64), 'full', 400);

    const full = await removeOrphanMedia(db, { graceMinutes: 60 * 24, limit: 100, dryRun: true });
    expect(full.incomplete).toBe(false);
    expect(full.refused).toBe('orphan-ratio');

    const partial = await removeOrphanMedia(db, {
      graceMinutes: 60 * 24,
      limit: 100,
      dryRun: true,
      budgetMs: 0,
    });
    expect(partial.incomplete).toBe(true);
    expect(partial.refused).toBeNull();
  });
});
