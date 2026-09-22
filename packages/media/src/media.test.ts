import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createDatabase, applyMigrations, seedCatalog, type Database } from '@set/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  attachImage,
  contentHash,
  detachImage,
  isSafeSegment,
  listProductImages,
  MAX_UPLOAD_BYTES,
  mediaPaths,
  processImage,
  publicUrl,
  reorderImages,
  saveUpload,
  setMainImage,
  sniffImage,
  sweepOrphanFiles,
} from './index.js';

/**
 * آزمون‌هایِ رسانه.
 *
 * نخستین پرسشِ هر سامانه‌ای که فایل می‌پذیرد این است: «اگر کسی فایلِ بد
 * بفرستد چه می‌شود؟» پاسخِ ما باید پیش از آنکه فایلی رویِ دیسک بنشیند داده
 * شود. برای همین اینجا آزمون‌هایِ «رد کردن» به اندازه‌یِ آزمون‌هایِ «پذیرفتن»
 * جدی گرفته شده‌اند.
 */

let db: Database;
let productId: string;
let mediaDir: string;

/** یک تصویرِ واقعیِ آزمایشی می‌سازد (بدونِ نیاز به فایل در مخزن) */
async function makeImage(width: number, height: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg'): Promise<Buffer> {
  const img = sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 200 } },
  });
  if (format === 'png') return img.png().toBuffer();
  if (format === 'webp') return img.webp().toBuffer();
  return img.jpeg().toBuffer();
}

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(tmpdir(), 'set-media-'));
  process.env.MEDIA_DIR = mediaDir;

  db = createDatabase('memory://');
  await applyMigrations(db);
  await seedCatalog(db, { openingInventory: false });
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM products LIMIT 1`);
  productId = rows[0]!.id;
}, 180_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.query(`DELETE FROM product_images`);
});

describe('شناساییِ تصویر و امنیتِ نام', () => {
  it('گونه‌یِ تصویر را از بایت‌ها می‌فهمد، نه از برچسب', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
    expect(sniffImage(jpeg)?.format).toBe('jpeg');
    expect(sniffImage(png)?.format).toBe('png');
    expect(sniffImage(webp)?.format).toBe('webp');
  });

  it('فایلی که تصویر نیست را نمی‌پذیرد', () => {
    expect(sniffImage(Buffer.from('<?php system($_GET[0]); ?>'))).toBeNull();
    expect(sniffImage(Buffer.from('%PDF-1.7\n'))).toBeNull();
    expect(sniffImage(Buffer.alloc(16))).toBeNull();
  });

  it('نامی که از شاخه بیرون می‌زند را نمی‌پذیرد', () => {
    expect(isSafeSegment('..')).toBe(false);
    expect(isSafeSegment('ab/../cd')).toBe(false);
    expect(isSafeSegment('a'.repeat(80))).toBe(false);
    expect(isSafeSegment('ab12_-')).toBe(true);
  });

  it('مسیرِ ساخته‌شده همیشه درونِ شاخه‌یِ رسانه می‌ماند', () => {
    const p = mediaPaths(contentHash(Buffer.from('x')), 'jpg', 'full');
    expect(p.absolute.startsWith(path.resolve(mediaDir) + path.sep)).toBe(true);
    expect(() => mediaPaths('../evil', 'jpg', 'full')).toThrow();
  });

  it('نشانی‌یِ عمومی نسبی است (نه وابسته به میزبان)', () => {
    expect(publicUrl('ab/abc-full.jpg')).toBe('/media/ab/abc-full.jpg');
  });
});

describe('پذیرشِ بارگذاری', () => {
  it('تصویر را به سه اندازه می‌سازد و پیش‌نمایش می‌دهد', async () => {
    const source = await makeImage(3000, 2000);
    const stored = await saveUpload({ data: source, filename: 'عکسِ من.jpg' });

    expect(stored.width).toBeLessThanOrEqual(1600);
    expect(stored.url).toMatch(/^\/media\/[a-f0-9]{2}\/[a-f0-9]{32}-full\.webp$/);
    expect(stored.urlCard).toContain('-card.webp');
    expect(stored.urlThumb).toContain('-thumb.webp');
    expect(stored.placeholder.startsWith('data:image/webp;base64,')).toBe(true);
    // پیش‌نمایش باید واقعاً کوچک باشد — وگرنه فایده‌اش (نمایشِ بی‌پرش) از بین می‌رود
    expect(stored.placeholder.length).toBeLessThan(4000);
  });

  it('تصویرِ خروجی از ورودی کوچک‌تر است (بهینه‌سازی واقعی رخ داده)', async () => {
    const source = await makeImage(2400, 1800);
    const stored = await saveUpload({ data: source });
    expect(stored.bytes).toBeLessThan(source.length);
  });

  it('فایلی که تصویر نیست را رد می‌کند و چیزی رویِ دیسک نمی‌نویسد', async () => {
    const before = await countFiles(mediaDir);
    await expect(saveUpload({ data: Buffer.from('این متن است نه تصویر') })).rejects.toThrow(
      /تنها تصویر/,
    );
    expect(await countFiles(mediaDir)).toBe(before);
  });

  it('فایلی با بایت‌هایِ درست اما محتوایِ خراب را رد می‌کند', async () => {
    // سرآیندِ JPEG درست است، اما بقیه نویسه‌یِ تصادفی است
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 0x7a)]);
    await expect(saveUpload({ data: fake })).rejects.toThrow(/تصویرِ سالمی نیست/);
  });

  it('فایلِ بسیار بزرگ را پیش از هر کاری رد می‌کند', async () => {
    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(MAX_UPLOAD_BYTES)]);
    await expect(saveUpload({ data: huge })).rejects.toThrow(/بیشینه/);
  });

  it('بارگذاریِ همسان، فایلِ تکراری نمی‌سازد (درنگِ محتوا)', async () => {
    const source = await makeImage(800, 600);
    const first = await saveUpload({ data: source });
    const hash = contentHash((await import('node:fs/promises')).readFile
      ? Buffer.from([])
      : Buffer.from([])); // برایِ خوانایی: درنگ را از نشانی می‌گیریم
    void hash;
    const again = await saveUpload({ data: source });
    expect(again.url).toBe(first.url);

    // سه فایل برایِ این تصویر باید وجود داشته باشد — نه بیشتر (شاخه از
    // آزمون‌هایِ پیشین هم فایل دارد، پس فقط فایل‌هایِ همین درنگ را می‌شماریم)
    const own = await countFilesWith(mediaDir, first.url.split('/').pop()!.replace('-full.webp', ''));
    expect(own).toBe(3);
  });
});

describe('پیوندِ تصویر با کالا', () => {
  it('نخستین تصویر خودبه‌خود اصلی می‌شود', async () => {
    const stored = await saveUpload({ data: await makeImage(1200, 900) });
    const row = await attachImage(db, { productId, image: stored, alt: 'نمایِ روبه‌رو' });
    expect(row.role).toBe('main');
    expect(row.alt).toBe('نمایِ روبه‌رو');
  });

  it('تصویرِ دوم «گالری» است و با انتخاب، اصلی می‌شود', async () => {
    const a = await attachImage(db, { productId, image: await saveUpload({ data: await makeImage(100, 100) }) });
    const b = await attachImage(db, { productId, image: await saveUpload({ data: await makeImage(101, 100) }) });
    expect(b.role).toBe('gallery');

    await setMainImage(db, { productId, imageId: b.id });
    const rows = await listProductImages(db, productId);
    expect(rows.find((r) => r.id === b.id)?.role).toBe('main');
    expect(rows.find((r) => r.id === a.id)?.role).toBe('gallery');
  });

  it('حذفِ تصویرِ اصلی، اصلی را به تصویرِ بعدی می‌سپارد', async () => {
    const a = await attachImage(db, { productId, image: await saveUpload({ data: await makeImage(110, 100) }) });
    const b = await attachImage(db, { productId, image: await saveUpload({ data: await makeImage(111, 100) }) });
    await detachImage(db, { productId, imageId: a.id });
    const rows = await listProductImages(db, productId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(b.id);
    expect(rows[0]!.role).toBe('main');
  });

  it('ترتیبِ نمایش را همان‌که می‌خواهیم می‌چیند', async () => {
    const a = await attachImage(db, { productId, image: await saveUpload({ data: await makeImage(120, 100) }) });
    const b = await attachImage(db, { productId, image: await saveUpload({ data: await makeImage(121, 100) }) });
    await reorderImages(db, productId, [b.id, a.id]);
    const rows = await listProductImages(db, productId);
    const by = new Map(rows.map((r) => [r.id, r.sortOrder]));
    expect(by.get(b.id)).toBe(0);
    expect(by.get(a.id)).toBe(1);
    // تصویرِ اصلی در نمایش همیشه نخست است — ترتیب، در میانِ بقیه معنا دارد
    expect(rows[0]!.role).toBe('main');
  });

  it('تصویرِ کالایِ دیگر را نمی‌توان حذف کرد', async () => {
    const other = await db.query<{ id: string }>(
      `SELECT id FROM products WHERE id <> $1 LIMIT 1`,
      [productId],
    );
    const row = await attachImage(db, {
      productId: other.rows[0]!.id,
      image: await saveUpload({ data: await makeImage(130, 100) }),
    });
    await expect(detachImage(db, { productId, imageId: row.id })).rejects.toThrow();
  });
});

describe('پاکسازی', () => {
  /**
   * چرا اینجا همه‌چیز پاک می‌شود؟ چون آزمونِ «چندتا رفت؟» با پوشه‌ای که بی‌ده
   * آزمون‌هایِ پیش از آن پر شده، عددِ قطعی ندارد — و اگر شمارِ فایل‌ها از آستانهٔ
   * چک‌برِ «غیرعادی است» بگذرد، همان بی‌ثباتی رفتارش را هم عوض می‌کند.
   */
  async function fresh(dir: string, keepRows = true): Promise<void> {
    for (const entry of await readdir(dir)) await rm(path.join(dir, entry), { recursive: true, force: true });
    if (!keepRows) await db.query(`DELETE FROM product_images`);
  }

  it('فایلِ در حالِ استفاده را نگه می‌دارد و بی‌صاحب را برمی‌دارد', async () => {
    await fresh(mediaDir, false);
    const stored = await saveUpload({ data: await makeImage(140, 100) });
    const row = await attachImage(db, { productId, image: stored });
    const key = stored.url.split('/').pop()!.replace('-full.webp', '');

    // وانمود می‌کنیم فایل‌ها کهنه شده‌اند تا از محافظتِ «یک ساعت» بگذرند
    await ageFiles(mediaDir);

    const first = await sweepOrphanFiles(db);
    expect(first.removed).toBe(0);
    expect(first.refused).toBeNull();
    // فایل‌هایی که پایگاه به آن‌ها اشاره دارد باید مانده باشند
    expect(await countFilesWith(mediaDir, key)).toBe(3);

    await detachImage(db, { productId, imageId: row.id });
    const after = await sweepOrphanFiles(db);
    expect(after.removed).toBe(3);
    expect(after.removedBytes).toBeGreaterThan(0);
    expect(await countFilesWith(mediaDir, key)).toBe(0);
  });

  it('ارجاعِ بیرونِ product_images (بنرِ ویترین) هم فایل را نگه می‌دارد', async () => {
    await fresh(mediaDir, false);
    const stored = await saveUpload({ data: await makeImage(150, 110) });
    await db.query(
      `INSERT INTO store_banners (kind, title, image_url) VALUES ('hero','بنرِ آزمون',$1)`,
      [stored.url],
    );
    await ageFiles(mediaDir);
    const r = await sweepOrphanFiles(db);
    // محافظت «به‌ازایِ هر نشانی» است، نه هر درنگ: بنر فقط اندازهٔ اصلی را
    // می‌خواهد، پس همان می‌ماند و دو اندازهٔ بی‌صاحبِ همان بارگذاری می‌روند.
    expect(r.removed).toBe(2);
    const { access } = await import('node:fs/promises');
    await expect(access(path.join(mediaDir, stored.url.replace('/media/', '')))).resolves.toBeUndefined();
    await expect(access(path.join(mediaDir, stored.urlThumb.replace('/media/', '')))).rejects.toBeTruthy();
    await db.query(`DELETE FROM store_banners WHERE title = 'بنرِ آزمون'`);
  });

  it('دیسکِ پُرِ بی‌ارجاع، روبش را می‌ایستاند (و بی‌«اجباری» چیزی نمی‌رود)', async () => {
    await fresh(mediaDir, false);
    // ۲۶ فایلِ بی‌صاحبِ کهنه، بدونِ هیچ ارجاعی در پایگاه: دقیقاً همان حالتی که
    // یا یعنی «پایگاهِ اشتباهی وصل است» یا «پشتیبان برگردانده شده». در هیچ‌کدام
    // سوزاندنِ کلِ دیسک جوابِ درست نیست.
    for (let i = 0; i < 26; i++) {
      const hash = i.toString(16).padStart(64, '0');
      const dir = path.join(mediaDir, hash.slice(0, 2));
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${hash}-full.jpg`), Buffer.alloc(64));
    }
    await ageFiles(mediaDir);
    const r = await sweepOrphanFiles(db);
    expect(r.removed).toBe(0);
    expect(r.refused).toBe('no-references');
    expect(r.kept).toBe(0);
    await fresh(mediaDir, false);
  });
});

describe('پردازش', () => {
  it('ابعاد را کوچک می‌کند و نسبت را نگه می‌دارد', async () => {
    const processed = await processImage(await makeImage(4000, 2000));
    expect(processed.width).toBe(1600);
    expect(processed.height).toBe(800);
  });

  it('تصویرِ کوچک را بزرگ نمی‌کند (بدونِ افتِ کیفیتِ ساختگی)', async () => {
    const processed = await processImage(await makeImage(320, 240));
    expect(processed.width).toBe(320);
    expect(processed.height).toBe(240);
  });
});

/** شمارِ فایل‌هایی که نامشان شاملِ این رشته است */
async function countFilesWith(dir: string, needle: string): Promise<number> {
  let total = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) total += await countFilesWith(full, needle);
    else if (entry.includes(needle)) total += 1;
  }
  return total;
}

/** شمارِ فایل‌هایِ رویِ دیسک */
async function countFiles(dir: string): Promise<number> {
  let total = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) total += await countFiles(full);
    else total += 1;
  }
  return total;
}

/** زمانِ ویرایشِ فایل‌ها را به گذشته می‌برد تا از محافظتِ «یک ساعت» بگذرند */
async function ageFiles(dir: string): Promise<void> {
  const { utimes } = await import('node:fs/promises');
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await ageFiles(full);
    else await utimes(full, old, old);
  }
}
