/**
 * انبارِ فایل.
 *
 * سه تصمیمِ کوچک که در ظاهر ساده‌اند و در عمل تفاوت می‌سازند:
 *
 *   ۱) **نامِ فایل از درونِ محتواست، نه از نامی که مرورگر فرستاده.** نامِ
 *      کاربر می‌تواند شاملِ «../» یا نویسه‌هایِ عجیب باشد؛ ما نام را می‌سازیم
 *      (درنگِ محتوا) و نامِ اصلی را فقط برایِ نمایش نگه می‌داریم.
 *
 *   ۲) **نوشتن دومرحله‌ای است**: نخست در یک فایلِ موقت، سپس جابه‌جاییِ اتمیک.
 *      اگر فرآیند در میانه بمیرد، هیچ فایلِ نیمه‌ای با نامِ اصلی باقی
 *      نمی‌ماند که بعداً به مشتری نشان داده شود.
 *
 *   ۳) **مسیر همیشه درونِ شاخه‌یِ رسانه می‌ماند.** هر بارگیری که بخواهد با
 *      «..» از شاخه بیرون بزند، پیش از خواندن رد می‌شود.
 */

import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import { isSafeSegment } from './image.js';

export interface MediaPaths {
  /** شاخه‌یِ ریشه‌یِ رسانه (از متغیرِ محیطی MEDIA_DIR) */
  root: string;
  /** مسیرِ نسبیِ فایل، برای ذخیره در پایگاه و ساختنِ نشانی */
  relative: string;
  /** مسیرِ کامل رویِ دیسک */
  absolute: string;
}

/**
 * نشانی‌یِ عمومیِ فایل — همان چیزی که در `product_images.url` می‌نشیند.
 *
 * چرا نسبی؟ چون سامانه ممکن است پشتِ هر دامنه‌ای باشد؛ نشانی‌یِ مطلقِ
 * `http://127.0.0.1:3000/...` در مرورگرِ مشتری معنا ندارد. نشانی‌یِ نسبی
 * هم در فروشگاه کار می‌کند و هم اگر روزی لازم شد از CDN سرو شود، تنها یک
 * پیشوند کافی است.
 */
export function publicUrl(relative: string): string {
  return `/media/${relative.split(path.sep).join('/')}`;
}

/** ریشه‌یِ انبار — همیشه به مسیرِ مطلق تبدیل می‌شود تا مقایسه‌ها درست باشند */
export function mediaRoot(): string {
  return path.resolve(process.env.MEDIA_DIR ?? path.resolve(process.cwd(), 'var/media'));
}

/**
 * ساختنِ مسیرِ امن برای یک نامِ فایل.
 *
 * `sub` معمولاً دو نویسه‌یِ نخستِ درنگ است (پراکندگی در شاخه‌ها) تا یک شاخه
 * با صدها هزار فایل سنگین نشود.
 */
export function mediaPaths(hash: string, extension: string, kind: 'full' | 'card' | 'thumb'): MediaPaths {
  if (!isSafeSegment(hash)) throw new Error('درنگِ فایل معتبر نیست.');
  if (!isSafeSegment(extension)) throw new Error('پسوندِ فایل معتبر نیست.');
  const sub = hash.slice(0, 2);
  const relative = path.join(sub, `${hash}-${kind}.${extension}`);
  const root = mediaRoot();
  const absolute = path.join(root, relative);
  // دفاعِ آخر: حتی اگر نام دستکاری شود، مسیر باید درونِ ریشه بماند
  if (!absolute.startsWith(root + path.sep)) throw new Error('مسیرِ فایل از شاخه‌یِ رسانه بیرون می‌زند.');
  return { root, relative, absolute };
}

/** آماده‌سازیِ شاخه و نوشتنِ اتمیک */
export async function writeAtomic(absolute: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(absolute), { recursive: true });
  const temp = `${absolute}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, data, { flag: 'wx', mode: 0o644 });
    await rename(temp, absolute);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** خواندنِ ایمن — فقط از درونِ ریشه */
export async function readMedia(relative: string): Promise<{ stream: NodeJS.ReadableStream; size: number } | null> {
  const root = mediaRoot();
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  try {
    const info = await stat(absolute);
    if (!info.isFile()) return null;
    return { stream: createReadStream(absolute), size: info.size };
  } catch {
    return null;
  }
}

/** حذفِ یک فایلِ رسانه (بی‌سر و صدا اگر نبود) */
export async function deleteMediaFile(relative: string): Promise<void> {
  const root = mediaRoot();
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return;
  await rm(absolute, { force: true });
}

/** درنگِ یک فایل رویِ دیسک — برایِ بررسی در آزمون‌ها */
export async function fileHash(absolute: string): Promise<string> {
  const data = await readFile(absolute);
  return createHash('sha256').update(data).digest('hex');
}
