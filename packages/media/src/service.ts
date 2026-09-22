/**
 * سرویسِ رسانه: از «فایلِ خامِ بارگذاری‌شده» تا «تصویری که در فروشگاه دیده
 * می‌شود» — و پیوندش با کالا.
 *
 * یک نکته‌یِ طراحی که در نگاهِ نخست دیده نمی‌شود: **فایل بر پایه‌یِ درنگِ
 * محتوا نام می‌گیرد و ممکن است چند کالا به یک فایل اشاره کنند** (مثلاً دو
 * رنگِ یک کالا که عکسِ یکسانی دارند). پس پاک کردنِ یک تصویر از یک کالا نباید
 * فایل را بی‌محابا حذف کند؛ حذفِ فایل تنها وقتی انجام می‌شود که هیچ ردیفی به
 * آن اشاره نکند (`sweepOrphanFiles`).
 */

import path from 'node:path';

import { AppError } from '@set/shared-kernel';
import type { Database, Queryable } from '@set/db';

import { contentHash, MAX_UPLOAD_BYTES, processImage, sniffImage, VARIANTS } from './image.js';
import { deleteMediaFile, mediaPaths, publicUrl, writeAtomic } from './store.js';
import {
  MAX_LIST,
  MIN_GRACE_MINUTES,
  removeOrphanMedia,
  type PurgeRefusal,
} from './hygiene.js';

export interface StoredImage {
  hash: string;
  /** نشانی‌یِ نسبیِ تصویرِ اصلی — چیزی که در `product_images.url` می‌نشیند */
  url: string;
  urlCard: string;
  urlThumb: string;
  placeholder: string;
  width: number;
  height: number;
  bytes: number;
  mime: string;
}

export interface SaveUploadInput {
  data: Buffer;
  /** نامِ فایل در دستگاهِ فروشنده — فقط برایِ پیام‌ها و ثبت، هرگز برایِ مسیر */
  filename?: string | null;
}

/**
 * پذیرش و ذخیره‌یِ یک تصویر.
 *
 * ترتیبِ بررسی‌ها اهمیت دارد: ارزان‌ترین بررسی نخست (اندازه)، سپس شناساییِ
 * بایت‌ها، و در پایان گران‌ترین کار (باز کردن و تبدیل). اگر تصویر رد شود،
 * هیچ فایلی رویِ دیسک نمی‌ماند.
 */
export async function saveUpload(input: SaveUploadInput): Promise<StoredImage> {
  const data = input.data;

  if (!data || data.length === 0) {
    throw new AppError('VALIDATION', { message: 'فایلی فرستاده نشده است.' });
  }
  if (data.length > MAX_UPLOAD_BYTES) {
    throw new AppError('VALIDATION', {
      message: `حجمِ تصویر ${Math.round(data.length / 1024 / 1024)} مگابایت است؛ بیشینه ${Math.round(
        MAX_UPLOAD_BYTES / 1024 / 1024,
      )} مگابایت مجاز است.`,
    });
  }

  const sniffed = sniffImage(data.subarray(0, 16));
  if (!sniffed) {
    throw new AppError('VALIDATION', {
      message: 'تنها تصویر می‌توان بارگذاری کرد (JPG، PNG یا WebP).',
    });
  }

  let processed;
  try {
    processed = await processImage(data);
  } catch (error) {
    throw new AppError('VALIDATION', {
      message: `این فایل تصویرِ سالمی نیست: ${(error as Error).message}`,
    });
  }

  const hash = contentHash(Buffer.concat([processed.full]));
  // پسوند از mime‌یِ خروجی می‌آید (برایِ خروجیِ WebP یعنی «webp»؛ اگر روزی
  // فرمتِ دیگری بیاید، همین‌جا افزوده می‌شود نه در هر صداکننده)
  const extension = processed.mime === 'image/png' ? 'png' : 'webp';
  const written: Array<{ relative: string }> = [];
  try {
    for (const [kind, buffer] of [
      ['full', processed.full],
      ['card', processed.card],
      ['thumb', processed.thumb],
    ] as const) {
      const paths = mediaPaths(hash, extension, kind);
      await writeAtomic(paths.absolute, buffer);
      written.push({ relative: paths.relative });
    }
  } catch (error) {
    // اگر نوشتنِ یکی از اندازه‌ها شکست، آنچه نوشته شده پاک می‌شود: یا همه یا هیچ
    for (const w of written) await deleteMediaFile(w.relative);
    throw error;
  }

  const [full, card, thumb] = [
    mediaPaths(hash, extension, 'full'),
    mediaPaths(hash, extension, 'card'),
    mediaPaths(hash, extension, 'thumb'),
  ];

  return {
    hash,
    url: publicUrl(full.relative),
    urlCard: publicUrl(card.relative),
    urlThumb: publicUrl(thumb.relative),
    placeholder: processed.placeholder,
    width: processed.width,
    height: processed.height,
    bytes: processed.bytes,
    mime: processed.mime,
  };
}

export interface ProductImageRow {
  id: string;
  url: string;
  urlCard: string | null;
  urlThumb: string | null;
  placeholder: string | null;
  alt: string;
  role: string;
  sortOrder: number;
  width: number | null;
  height: number | null;
}

/** تصویرهایِ یک کالا — نخست تصویرِ اصلی، سپس به ترتیبِ نمایش */
export async function listProductImages(db: Queryable, productId: string): Promise<ProductImageRow[]> {
  const { rows } = await db.query<{
    id: string;
    url: string;
    url_card: string | null;
    url_thumb: string | null;
    placeholder: string | null;
    alt: string;
    role: string;
    sort_order: number;
    width: number | null;
    height: number | null;
  }>(
    `SELECT id, url, url_card, url_thumb, placeholder, alt, role, sort_order, width, height
       FROM product_images
      WHERE product_id = $1
      ORDER BY (role = 'main') DESC, sort_order, created_at`,
    [productId],
  );
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    urlCard: r.url_card,
    urlThumb: r.url_thumb,
    placeholder: r.placeholder,
    alt: r.alt,
    role: r.role,
    sortOrder: r.sort_order,
    width: r.width,
    height: r.height,
  }));
}

/**
 * پیوند دادنِ تصویر به کالا.
 *
 * اگر کالا تصویرِ اصلی نداشته باشد، نخستین تصویر خودبه‌خود «اصلی» می‌شود؛
 * فروشنده مجبور نیست پیش از دیدنِ نتیجه، نقش انتخاب کند.
 */
export async function attachImage(
  db: Database,
  input: {
    productId: string;
    image: StoredImage;
    alt?: string | null;
    /** «اصلی» کردنِ این تصویر */
    asMain?: boolean;
  },
): Promise<ProductImageRow> {
  return db.transaction(async (tx) => {
    const existing = await tx.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM product_images WHERE product_id = $1`,
      [input.productId],
    );
    const isFirst = Number(existing.rows[0]?.count ?? '0') === 0;
    const role = input.asMain || isFirst ? 'main' : 'gallery';

    if (role === 'main') {
      await tx.query(`UPDATE product_images SET role = 'gallery' WHERE product_id = $1 AND role = 'main'`, [
        input.productId,
      ]);
    }

    const next = await tx.query<{ sort_order: number | null }>(
      `SELECT MAX(sort_order) AS sort_order FROM product_images WHERE product_id = $1`,
      [input.productId],
    );

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO product_images
         (product_id, url, url_card, url_thumb, placeholder, alt, role, sort_order, width, height)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        input.productId,
        input.image.url,
        input.image.urlCard,
        input.image.urlThumb,
        input.image.placeholder,
        // alt در پایگاه تهی‌ناپذیر است (پیش‌فرضِ رشته‌یِ تهی): فرستادنِ null
        // کلِ درج را خراب می‌کند، حتی اگر تصویر سالم باشد
        input.alt ?? '',
        role,
        (next.rows[0]?.sort_order ?? -1) + 1,
        input.image.width,
        input.image.height,
      ],
    );

    const id = rows[0]!.id;
    const [row] = await listProductImages(tx, input.productId);
    void row;
    const created = await tx.query<{
      id: string;
      url: string;
      url_card: string | null;
      url_thumb: string | null;
      placeholder: string | null;
      alt: string;
      role: string;
      sort_order: number;
      width: number | null;
      height: number | null;
    }>(`SELECT * FROM product_images WHERE id = $1`, [id]);
    const r = created.rows[0]!;
    return {
      id: r.id,
      url: r.url,
      urlCard: r.url_card,
      urlThumb: r.url_thumb,
      placeholder: r.placeholder,
      alt: r.alt,
      role: r.role,
      sortOrder: r.sort_order,
      width: r.width,
      height: r.height,
    };
  });
}

/** حذفِ یک تصویر از کالا (خودِ فایل بعداً در پاکسازی برداشته می‌شود) */
export async function detachImage(
  db: Database,
  input: { productId: string; imageId: string },
): Promise<{ removed: boolean; wasMain: boolean }> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ role: string }>(
      `SELECT role FROM product_images WHERE id = $1 AND product_id = $2`,
      [input.imageId, input.productId],
    );
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { message: 'این تصویر برایِ این کالا ثبت نشده است.' });

    await tx.query(`DELETE FROM product_images WHERE id = $1`, [input.imageId]);

    // اگر تصویرِ اصلی رفته، نخستین تصویرِ باقی‌مانده اصلی می‌شود؛
    // وگرنه کالا بی‌تصویر می‌ماند و در فهرست‌ها «عکس ندارد» نشان می‌دهد.
    if (row.role === 'main') {
      await tx.query(
        `UPDATE product_images SET role = 'main'
          WHERE id = (SELECT id FROM product_images
                       WHERE product_id = $1
                       ORDER BY sort_order, created_at LIMIT 1)`,
        [input.productId],
      );
    }
    return { removed: true, wasMain: row.role === 'main' };
  });
}

/** انتخابِ تصویرِ اصلی */
export async function setMainImage(
  db: Database,
  input: { productId: string; imageId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM product_images WHERE id = $1 AND product_id = $2`,
      [input.imageId, input.productId],
    );
    if (!rows[0]) throw new AppError('NOT_FOUND', { message: 'این تصویر برایِ این کالا ثبت نشده است.' });
    await tx.query(`UPDATE product_images SET role = 'gallery' WHERE product_id = $1 AND role = 'main'`, [
      input.productId,
    ]);
    await tx.query(`UPDATE product_images SET role = 'main' WHERE id = $1`, [input.imageId]);
  });
}

/** جابه‌جاییِ تصویر در ترتیبِ نمایش */
export async function reorderImages(db: Database, productId: string, imageIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [index, id] of imageIds.entries()) {
      await tx.query(`UPDATE product_images SET sort_order = $1 WHERE id = $2 AND product_id = $3`, [
        index,
        id,
        productId,
      ]);
    }
  });
}

/**
 * پاکسازیِ فایل‌هایِ بی‌صاحب (همان مسیرِ دیروز، با مراجعِ کامل).
 *
 * چرا هنوز این_wrapper_ هست؟ چون کنترلرِ پنل و آزمون‌هایِ رسانه به شکلِ
 * `{removed, kept}` کار می‌کنند. منطقِ واقعی در `hygiene.ts` است — آن‌جا
 * فهرستِ مراجع کامل است (بنرِ ویترین، تصویرِ دسته، اسکِنِ چک هم حساب می‌شوند؛
 * پیش از این فقط `product_images` خوانده می‌شد و پاک‌سازی می‌توانست بنرِ
 * در حالِ نمایشِ صفحهٔ نخست را ببرد)، مهلتِ اعتماد دارد، و چک‌بر.
 */
export async function sweepOrphanFiles(
  db: Queryable,
  options: { graceMinutes?: number; limit?: number; force?: boolean; dryRun?: boolean } = {},
): Promise<{ removed: number; kept: number; orphanBytes: number; removedBytes: number; refused: PurgeRefusal }> {
  const r = await removeOrphanMedia(db, {
    graceMinutes: options.graceMinutes ?? MIN_GRACE_MINUTES,
    limit: options.limit ?? MAX_LIST,
    force: options.force,
    dryRun: options.dryRun,
  });
  return {
    removed: r.removed,
    kept: r.referencedFiles + r.youngSkipped + r.unmanaged + r.tempSkipped,
    orphanBytes: r.orphanBytes,
    removedBytes: r.removedBytes,
    refused: r.refused,
  };
}

export { VARIANTS };
