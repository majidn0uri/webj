/**
 * مهاجرتِ تصویرهایِ موجود از JPEG به WebP.
 *
 * چرا لازم است؟
 *   تا پیش از این، آپلودها JPEG با کیفیتِ ۸۲ ذخیره می‌شدند. اکنونِ خطِ تولید
 *   خروجیِ WebP می‌دهد (کیفیتِ برابر، حدودِ یک‌سومِ حجم) — اما فایل‌هایی که
 *   پیش‌تر بارگذاری شده‌اند رویِ دیسک JPEG مانده‌اند. این اسکریپت همان‌ها را
 *   به WebP بازنویسی می‌کند:
 *
 *     ۱. سه اندازه‌یِ کامل/کارت/بندانگشتیِ هر تصویر دوباره ساخته می‌شود؛
 *     ۲. ردیف‌هایِ پایگاه (product_images و ستون‌هایِ بنر/دسته/چک) به
 *        نشانی‌هایِ تازه اشاره می‌کنند — در یک تراکنش، تا صفحه‌ی مشتری
 *        هرگز «تصویرِ شکسته» نبیند؛
 *     ۳. فایل‌هایِ JPEGِ کهنه فقط پس ازِ موفقیتِ تراکنش حذف می‌شوند.
 *
 * اجرا (رویِ دستگاهی که متغیرهایِ محیطیِ سامانه را می‌شناسد):
 *   npx tsx scripts/reencode-media-webp.ts            # اجرا
 *   npx tsx scripts/reencode-media-webp.ts --dry-run  # فقط گزارش، بدونِ نوشتن
 *
 * بی‌خطر برای اجرایِ دوباره: تصویری که WebP شده است دیگر دیده نمی‌شود.
 */
import { stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { createDatabase } from '@set/db';
import {
  contentHash,
  mediaPaths,
  publicUrl,
  writeAtomic,
} from '@set/media';

const DRY_RUN = process.argv.includes('--dry-run');

/** فهرستِ مراجع — هم‌خوانی با MEDIA_SOURCESِ hygiene؛ اگر ستونِ تازه‌ای اضافه شد همین‌جا هم بیاید */
const REF_COLUMNS: ReadonlyArray<readonly [table: string, column: string]> = [
  ['product_images', 'url'],
  ['product_images', 'url_card'],
  ['product_images', 'url_thumb'],
  ['store_banners', 'image_url'],
  ['product_types', 'image_url'],
  ['checks', 'image_url'],
];

type Db = Awaited<ReturnType<typeof createDatabase>>;

async function collectJpgRefs(db: Db): Promise<string[]> {
  const sql = `
    SELECT "url" FROM product_images WHERE "url" LIKE '/media/%.jpg'
    UNION
    SELECT "url_card" FROM product_images WHERE "url_card" LIKE '/media/%.jpg'
    UNION
    SELECT "url_thumb" FROM product_images WHERE "url_thumb" LIKE '/media/%.jpg'
    UNION
    SELECT "image_url" FROM store_banners WHERE "image_url" LIKE '/media/%.jpg'
    UNION
    SELECT "image_url" FROM product_types WHERE "image_url" LIKE '/media/%.jpg'
    UNION
    SELECT "image_url" FROM checks WHERE "image_url" LIKE '/media/%.jpg'`;
  const { rows } = await db.query<{ url: string }>(sql, []);
  // فقط فایل‌هایِ مدیریت‌شده (درنگ ۶۴ رقمی + اندازه + پسوند) مهاجرت می‌کنند
  const managed = /^[0-9a-f]{16,64}-(full|card|thumb)\.jpg$/;
  return rows
    .map((r) => r.url)
    .filter((url) => managed.test(url.split('/').pop() ?? ''));
}

/** از نشانی، درنگ و اندازه خوانده می‌شود */
function parseUrl(url: string): { hash: string; kind: 'full' | 'card' | 'thumb' } | null {
  const m = url.match(/^\/media\/[0-9a-f]{2}\/([0-9a-f]{16,64})-(full|card|thumb)\.jpg$/);
  if (!m?.[1]) return null;
  return { hash: m[1], kind: m[2] as 'full' | 'card' | 'thumb' };
}

async function fileSize(abs: string): Promise<number> {
  try {
    return (await stat(abs)).size;
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  const dbUrl = process.env.DB_URL ?? 'memory://';
  // پایگاهِ درون‌حافظه فقط برایِ آزمون‌ها و تمرین — نه جایِ داده‌یِ واقعی
  if (dbUrl === 'memory://' && process.env.ALLOW_MEMORY_DB !== '1') {
    console.error('DB_URL تعیین نشده است.');
    process.exit(2);
  }
  const mediaDir = path.resolve(process.env.MEDIA_DIR ?? path.resolve(process.cwd(), 'var/media'));
  const db = createDatabase(dbUrl);

  let reencoded = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  try {
    const refs = await collectJpgRefs(db);
    if (refs.length === 0) {
      console.log('هیچ تصویرِ JPEGِ مدیریت‌شده‌ای در پایگاه نیست؛ کاری نمی‌ماند.');
      return;
    }

    // هر تصویر (بر اساسِ درنگ) یک‌بار بازنویسی می‌شود — حتی اگر چند ردیف به آن اشاره کنند
    const byHash = new Map<string, string[]>();
    for (const url of refs) {
      const p = parseUrl(url);
      if (!p) continue;
      const list = byHash.get(p.hash) ?? [];
      if (!list.includes(url)) list.push(url);
      byHash.set(p.hash, list);
    }
    console.log(`تصاویرِ JPEGِ شناسایی‌شده: ${byHash.size}`);

    for (const [hash, oldUrls] of byHash) {
      const sub = hash.slice(0, 2);
      const fullAbs = path.join(mediaDir, sub, `${hash}-full.jpg`);
      const cardAbs = path.join(mediaDir, sub, `${hash}-card.jpg`);
      const thumbAbs = path.join(mediaDir, sub, `${hash}-thumb.jpg`);

      if ((await fileSize(fullAbs)) === 0) {
        console.warn(`فایلِ «${hash}-full.jpg» رویِ دیسک نیست — رد می‌شود (فقط ردیفِ پایگاه هست).`);
        continue;
      }

      // بازسازیِ سه اندازه — دقیقاً به‌همان خطِ تولیدِ آپلود
      const make = (size: number) =>
        sharp(fullAbs, { failOn: 'error' })
          .rotate()
          .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
      const tiny = await sharp(fullAbs, { failOn: 'error' })
        .rotate()
        .resize({ width: 16, fit: 'inside' })
        .blur(1)
        .webp({ quality: 30 })
        .toBuffer();

      const [full, card, thumb] = [await make(1600), await make(600), await make(200)];
      const newHash = contentHash(full);
      const placeholder = `data:image/webp;base64,${tiny.toString('base64')}`;
      const urls = {
        full: publicUrl(mediaPaths(newHash, 'webp', 'full').relative),
        card: publicUrl(mediaPaths(newHash, 'webp', 'card').relative),
        thumb: publicUrl(mediaPaths(newHash, 'webp', 'thumb').relative),
      };

      bytesBefore += (await fileSize(fullAbs)) + (await fileSize(cardAbs)) + (await fileSize(thumbAbs));
      bytesAfter += full.length + card.length + thumb.length;

      if (DRY_RUN) {
        reencoded++;
        continue;
      }

      // نوشتنِ اتمیکِ سه فایلِ تازه — یا همه یا هیچ
      const started: string[] = [];
      try {
        for (const [buf, kind] of [
          [full, 'full'],
          [card, 'card'],
          [thumb, 'thumb'],
        ] as const) {
          const p = mediaPaths(newHash, 'webp', kind);
          await writeAtomic(p.absolute, buf);
          started.push(p.absolute);
        }
      } catch (error) {
        for (const abs of started) await unlink(abs).catch(() => undefined);
        throw error;
      }

      // به‌روزرسانیِ پایگاه در یک تراکنش
      try {
        await db.transaction(async (tx) => {
          // product_images: نشانیِ اصلی را کلید می‌کنیم؛ سه نشانی و placeholder با هم می‌روند
          const fullUrls = oldUrls.filter((u) => parseUrl(u)?.kind === 'full');
          for (const oldFull of fullUrls) {
            const { affectedRows } = await tx.query(
              `UPDATE product_images
                  SET url = $1, url_card = $2, url_thumb = $3, placeholder = $4
                WHERE url = $5`,
              [urls.full, urls.card, urls.thumb, placeholder, oldFull],
            );
            if ((affectedRows ?? 0) > 0) {
              // اگر card/thumb مستقلاً هم از نشانی‌هایِ JPEG استفاده می‌کردند، هم‌راستا می‌کنیم
              await tx.query(`UPDATE product_images SET url_card = $1 WHERE url_card = $2`, [
                urls.card,
                oldFull.replace('-full.jpg', '-card.jpg'),
              ]);
              await tx.query(`UPDATE product_images SET url_thumb = $1 WHERE url_thumb = $2`, [
                urls.thumb,
                oldFull.replace('-full.jpg', '-thumb.jpg'),
              ]);
            }
          }
          // بنرها/دسته‌ها/چک‌ها: هر نشانیِ کامل، هر جا باشد
          for (const [table, column] of REF_COLUMNS) {
            if (table === 'product_images') continue;
            for (const oldUrl of oldUrls) {
              const p = parseUrl(oldUrl);
              if (!p) continue;
              await tx.query(`UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`, [
                urls[p.kind],
                oldUrl,
              ]);
            }
          }
        });
      } catch (error) {
        console.error(`به‌روزرسانیِ پایگاه برایِ ${hash} شکست خورد — فایل‌هایِ تازه باقی می‌مانند تا پاک‌سازیِ یتیمان برود:`);
        console.error(`  ${(error as Error).message}`);
        continue;
      }

      // حالا که هیچ ردیفی به JPEGها اشاره نمی‌کند، حذف
      for (const abs of [fullAbs, cardAbs, thumbAbs]) {
        await unlink(abs).catch(() => undefined);
      }
      reencoded++;
    }

    console.log('────────────────────────────────────────────');
    console.log(`تصاویرِ مهاجرت‌شده: ${reencoded}`);
    if (bytesBefore > 0) {
      const saved = Math.round((1 - bytesAfter / bytesBefore) * 100);
      console.log(
        `حجمِ کل: ${Math.round(bytesBefore / 1024 / 1024)}MB → ${Math.round(bytesAfter / 1024 / 1024)}MB  (کاهشِ ${saved}٪)`,
      );
    }
    if (DRY_RUN) console.log('حالتِ آزمایشی بود — هیچ فایلی نوشته یا حذف نشد.');
  } finally {
    await db.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
