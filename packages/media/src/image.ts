/**
 * پردازش و پذیرشِ تصویر.
 *
 * دو اصل اینجا حاکم است:
 *
 *   ۱) **به برچسبِ فرستنده اعتماد نمی‌کنیم.** مرورگر (یا هر کلاینتِ دیگری)
 *      می‌تواند بگوید «این فایل image/jpeg است» در حالی که یک فایلِ اجرایی
 *      باشد. پس پیش از هر کاری، بایت‌هایِ آغازینِ فایل (magic bytes) خوانده
 *      می‌شود؛ و حتی پس از آن، تصویر باید واقعاً «باز» شود (decode) تا پذیرفته
 *      گردد — فایلی که بایت‌هایش درست اما محتوایش خراب است، در همین‌جا رد
 *      می‌شود نه در صفحه‌یِ مشتری.
 *
 *   ۲) **تصویرِ بارگذاری‌شده همان چیزی نیست که به مشتری می‌رسد.** عکسی که
 *      فروشنده با گوشی می‌گیرد ۴۰۰۰ پیکسل و ۶ مگابایت است. فرستادنِ آن برای
 *      کاربری با اینترنتِ همراه یعنی هدر دادنِ وقت و حجمِ او. برای همین هر
 *      تصویر به چند اندازه تبدیل می‌شود و همراهِ خودش یک «پیش‌نمایشِ تارِ
 *      بسیار کوچک» دارد تا صفحه پیش از رسیدنِ تصویرِ اصلی، خالی و پریده به نظر
 *      نرسد.
 */

import { createHash } from 'node:crypto';

import sharp from 'sharp';

export type ImageFormat = 'jpeg' | 'png' | 'webp';

export interface SniffResult {
  format: ImageFormat;
  extension: 'jpg' | 'png' | 'webp';
  mime: string;
}

/** بزرگ‌ترین اندازه‌یِ پذیرفتنی برایِ فایلِ خام (پیش از پردازش) */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** اندازه‌هایِ تولیدی — هر کدام برای یک جایِ مشخص در صفحه */
export const VARIANTS = {
  /** تصویرِ بزرگِ صفحه‌یِ کالا */
  full: 1600,
  /** کارتِ کالا در فهرست‌ها */
  card: 600,
  /** انگشتانه در سبد، سفارش و پنل */
  thumb: 200,
} as const;

export type VariantName = keyof typeof VARIANTS;

export const FORMAT_MIME: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * شناساییِ گونه‌یِ تصویر از رویِ بایت‌هایِ آغازین.
 *
 * چرا نه `Content-Type`؟ چون آن را فرستنده می‌نویسد و ما تصمیم می‌گیریم.
 */
export function sniffImage(head: Buffer): SniffResult | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { format: 'jpeg', extension: 'jpg', mime: 'image/jpeg' };
  }
  // 89 50 4E 47 0D 0A 1A 0A
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return { format: 'png', extension: 'png', mime: 'image/png' };
  }
  // RIFF????WEBP
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString('ascii') === 'RIFF' &&
    head.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { format: 'webp', extension: 'webp', mime: 'image/webp' };
  }
  return null;
}

/** درنگِ محتوا (برای نامِ فایل و کشِ ابدی) — دو تصویرِ همسان یک فایل می‌شوند */
export function contentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 32);
}

export interface ProcessedImage {
  width: number;
  height: number;
  /** تصویرِ اصلیِ بهینه‌شده */
  full: Buffer;
  card: Buffer;
  thumb: Buffer;
  /** یک تصویرِ بسیار کوچک و تار، به‌صورتِ data URI — برایِ نمایشِ بی‌پرش */
  placeholder: string;
  bytes: number;
  mime: string;
}

/**
 * تبدیلِ تصویر به اندازه‌هایِ استاندارد.
 *
 * خروجی **همیشه WebP** است: با کیفیتِ برابر، حدودِ یک‌سومِ حجمِ JPEG.
 * با هزاران کالا و ده‌ها تصویر در هر صفحه، این اختلاف در اینترنتِ همراهِ
 * مشتری دیده می‌شود. PNG با شفافیت هم WebP می‌شود (کانالِ ألفا حفظ می‌ماند)،
 * پس نیازی به تخت‌کردن رویِ زمینه نیست.
 *
 * `rotate()` بی‌آرگومان یعنی «اگر عکس جهتِ EXIF دارد، آن را اعمال کن» — بدون
 * آن، عکس‌هایِ گرفته‌شده با گوشی در صفحه خوابیده دیده می‌شوند و فروشنده
 * گمان می‌کند سامانه خراب است.
 *
 * فراداده (EXIF/GPS) حذف می‌شود: هم حجم کم می‌شود و هم اطلاعاتِ ناخواسته‌یِ
 * فروشنده (مکانِ عکاسی) به مشتری نمی‌رسد.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const base = sharp(input, { failOn: 'error' }).rotate().withMetadata({ orientation: undefined });
  const meta = await base.metadata();
  if (!meta.width || !meta.height) {
    throw new Error('تصویر خوانده نشد؛ ابعادش معلوم نیست.');
  }

  const make = async (size: number): Promise<Buffer> =>
    sharp(input, { failOn: 'error' })
      .rotate()
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

  const full = await make(VARIANTS.full);
  const card = await make(VARIANTS.card);
  const thumb = await make(VARIANTS.thumb);

  // پیش‌نمایشِ تار: ۱۶ پیکسل پهنا، کیفیتِ بسیار کم — چند صد بایت
  const tiny = await sharp(input, { failOn: 'error' })
    .rotate()
    .resize({ width: 16, fit: 'inside' })
    .blur(1)
    .webp({ quality: 30 })
    .toBuffer();

  // ابعادِ واقعیِ خروجی (ممکن است کوچک‌تر از درون‌داد باشد)
  const fullMeta = await sharp(full).metadata();

  return {
    width: fullMeta.width ?? meta.width,
    height: fullMeta.height ?? meta.height,
    full,
    card,
    thumb,
    placeholder: `data:image/webp;base64,${tiny.toString('base64')}`,
    bytes: full.length,
    mime: 'image/webp',
  };
}

/** آیا این رشته می‌تواند بخشی از نامِ فایل باشد؟ (جلوگیری از بیرون‌زدن از مسیر) */
export function isSafeSegment(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value) && !value.includes('..');
}
