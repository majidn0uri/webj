import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AppError, isUuid } from '@set/shared-kernel';
import { mediaHygiene } from '@set/commerce';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import {
  attachImage,
  detachImage,
  listProductImages,
  MAX_UPLOAD_BYTES,
  reorderImages,
  saveUpload,
  setMainImage,
} from '@set/media';

import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * رسانه: بارگذاریِ تصویرِ کالا از پنل.
 *
 * چرا این مسیرها وجود دارند؟ چون تا پیش از این، افزودنِ عکس به کالا یعنی
 * دسترسی به فایل‌هایِ سرور — کاری که یک فروشنده نه بلد است و نه باید بتواند.
 * اینجا همان کار با یک کلیک انجام می‌شود، بی‌آنکه کسی به پوسته نیاز داشته باشد.
 *
 * دو نکته که در ظاهر پیدا نیست:
 *
 *   ۱) **بارگذاری و پیوند one step است.** اگر فایل را جدا بار می‌گذاشتیم و
 *      بعد پیوند می‌دادیم، فایل‌هایِ بی‌صاحب رویِ دیسک می‌ماندند (کاربر
 *      بارگذاری می‌کند و پیش از ذخیره، صفحه را می‌بندد). اینجا فایل تا وقتی
 *      به کالا وصل نشده، «موقت» به حساب می‌آید و پاکسازی آن را برمی‌دارد.
 *
 *   ۲) **همه‌چیز با یک درخواستِ multipart انجام می‌شود**، پس نیازی به هیچ
 *      کتاب‌خانه‌ای در مرورگر نیست و فروشنده می‌تواند عکس را بکشد و رها کند.
 */
/**
 * بدنهٔ «اجرایِ پاک‌سازیِ رسانه».
 *
 * `limit` مهار شده چون پاک‌سازیِ فایل یعنی هزاران `unlink`؛ یک درخواستِ وب که
 * پنج دقیقه کار کند، زیرِ بارِ فروشگاه یعنی تایم‌اوتِ کاربر و یک نیمه‌کاره‌ای که
 * نمی‌دانیم کجا تمام شده. `force` هم عمداً جدا است: چک‌برها («پایگاه هیچ ارجاعی
 * ندارد»، «بیش از نیمی از دیسک بی‌صاحب است») برایِ همین‌اند که یک اجرایِ
 * شتاب‌زده فاجعه نشود — ردِّشان فقط با این کلیدِ صریح و در همان درخواست ممکن
 * است و در ممیزی هم ثبت می‌شود.
 */
const MediaCleanupDto = z.object({
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  force: z.boolean().optional(),
});

@Controller('admin')
export class AdminMediaController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  private async require(
    authorization: string | undefined,
    permission: 'media.read' | 'media.upload',
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    const [resource, action] = permission.split('.');
    await this.access.assert({ userId: claims.sub, branchId: null }, resource!, action!);
    return claims;
  }

  /**
   * تصویرهایِ یک کالا.
   */
  @Get('products/:id/images')
  async list(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    await this.require(authorization, 'media.read');
    if (!isUuid(id)) throw new AppError('NOT_FOUND', { message: 'کالا یافت نشد.' });
    return { items: await listProductImages(this.db, id) };
  }

  /**
   * بارگذاری و پیوند در یک گام.
   *
   * پاسخ، تصویرِ تازه را با هر سه نشانی برمی‌گرداند تا رابط همان لحظه آن را
   * نشان دهد — بدون درنگ و بدون نیاز به بارگیریِ دوباره‌یِ فهرست.
   */
  @Post('products/:id/images')
  async upload(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Req() request: FastifyRequest,
  ) {
    await this.require(authorization, 'media.upload');
    if (!isUuid(id)) throw new AppError('NOT_FOUND', { message: 'کالا یافت نشد.' });

    const data = await readUploadedFile(request);
    const alt = typeof (request as unknown as { query?: Record<string, string> }).query?.['alt'] === 'string'
      ? String((request as unknown as { query: Record<string, string> }).query['alt'])
      : null;
    const asMain = (request as unknown as { query?: Record<string, string> }).query?.['main'] === '1';

    const image = await saveUpload({ data, filename: null });
    const row = await attachImage(this.db, {
      productId: id,
      image,
      alt: alt ?? undefined,
      asMain,
    });
    return { item: row };
  }

  /** حذفِ یک تصویر از کالا */
  @Delete('products/:id/images/:imageId')
  async remove(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    await this.require(authorization, 'media.upload');
    if (!isUuid(id) || !isUuid(imageId)) throw new AppError('NOT_FOUND', { message: 'تصویر یافت نشد.' });
    return detachImage(this.db, { productId: id, imageId });
  }

  /** انتخابِ تصویرِ اصلی */
  @Post('products/:id/images/:imageId/main')
  async makeMain(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    await this.require(authorization, 'media.upload');
    if (!isUuid(id) || !isUuid(imageId)) throw new AppError('NOT_FOUND', { message: 'تصویر یافت نشد.' });
    await setMainImage(this.db, { productId: id, imageId });
    return { message: 'تصویرِ اصلی انتخاب شد.' };
  }

  /** جابه‌جاییِ تصویرها (ترتیبِ نمایش در صفحه‌یِ کالا) */
  @Patch('products/:id/images/order')
  async order(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: { ids?: string[] },
  ) {
    await this.require(authorization, 'media.upload');
    if (!isUuid(id)) throw new AppError('NOT_FOUND', { message: 'کالا یافت نشد.' });
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === 'string' && isUuid(x)) : [];
    if (ids.length === 0) throw new AppError('VALIDATION', { message: 'ترتیبی فرستاده نشده است.' });
    await reorderImages(this.db, id, ids);
    return { message: 'ترتیبِ تصویرها ذخیره شد.' };
  }

  /**
   * پیش‌نمایشِ بهداشتِ رسانه: چند فایلِ بی‌صاحب چقدر جا گرفته‌اند، چند فایلِ
   * میانیِ نیمه مانده، و کدام ردیف‌ها به فایلی اشاره می‌کنند که رویِ دیسک نیست.
   *
   * بی‌حذف‌کردن. و بی‌پویشِ دوباره هم اگر کشِ «اخیر» تازه باشد — چون پویشِ
   * پوشه یعنی `stat` برایِ هر فایل. `?fresh=1` کش را رد می‌کند.
   */
  @Get('media/cleanup')
  async cleanupPreview(
    @Headers('authorization') authorization: string | undefined,
    @Query('fresh') fresh: string | undefined,
  ) {
    await this.require(authorization, 'media.read');
    const want = fresh === '1' || fresh === 'true';
    // «از نو» یعنی کاربر خودش شمارشِ کامل را خواسته؛ پس بی‌سقفِ زمان می‌گردد
    // (پیش‌نمایشِ خودکارِ صفحه، که در همان درخواست هم هست، سقف دارد).
    return mediaHygiene(this.db, {
      mode: 'report',
      fresh: want,
      budgetMs: want ? Number.POSITIVE_INFINITY : undefined,
    });
  }

  /**
   * اجرایِ یک دورِ پاک‌سازیِ فایل‌هایِ بی‌صاحب.
   *
   * ممیزی «شمارش و سیاست» را نگه می‌دارد، نه نامِ فایل‌ها: نامِ فایل در این
   * سامانه درنگِ محتواست و هر ردیفِ دیگری که همان فایل را می‌خواست در همین
   * فهرست پیدا می‌شود؛ فهرستِ کاملِ آنچه نبود، در لاگِ سرویس می‌ماند نه در
   * جدولِ ردِّ عملیات.
   */
  @Post('media/cleanup')
  async cleanupRun(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const claims = await this.require(authorization, 'media.upload');
    const input = MediaCleanupDto.parse(body ?? {});
    const report = await mediaHygiene(this.db, {
      mode: 'run',
      limit: input.limit ?? 500,
      force: input.force === true,
      fresh: true,
    });
    await this.db.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity, after_data, ip)
       VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [
        claims.sub,
        'media.cleanup_ran',
        'store_settings',
        JSON.stringify({
          removed: report.removed,
          removedBytes: report.removedBytes,
          remaining: report.remaining,
          missingFiles: report.missingTotal,
          refused: report.refuseCode,
          force: input.force === true,
          policy: report.policy,
        }),
        req.ip ?? null,
      ],
    );
    return report;
  }

  /** @deprecated همان `POST media/cleanup` — برایِ سازگاریِ رابطِ قدیم */
  @Post('media/sweep')
  async sweep(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization, 'media.upload');
    const report = await mediaHygiene(this.db, { mode: 'run', fresh: true });
    return {
      removed: report.removed,
      kept: report.referencedFiles + report.youngSkipped + report.unmanaged + report.tempSkipped,
      refused: report.refuseCode,
      notes: report.notes,
    };
  }

  /** بزرگ‌ترین اندازه‌یِ مجاز — رابط پیش از فرستادن هشدار می‌دهد */
  @Get('media/limits')
  async limits(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization, 'media.read');
    return { maxBytes: MAX_UPLOAD_BYTES, accept: ['image/jpeg', 'image/png', 'image/webp'] };
  }
}

/**
 * خواندنِ فایل از درخواستِ multipart.
 *
 * چرا جریان (stream) را می‌خوانیم نه `req.body`؟ چون تصویر ممکن است چند
 * مگابایت باشد و نگه‌داشتنِ آن در حافظه برایِ هر بارگذاری، سامانه را زیرِ بار
 * زمین می‌زند. با جریان، اندازه در همان لحظه مهار می‌شود (`limits.fileSize`).
 */
async function readUploadedFile(request: FastifyRequest): Promise<Buffer> {
  const req = request as unknown as {
    file?: (options?: { limits?: { fileSize?: number } }) => Promise<
      | {
          file: AsyncIterable<Buffer>;
          filename: string;
          mimetype: string;
        }
      | undefined
    >;
    isMultipart?: () => boolean;
  };

  const isMultipart = typeof req.isMultipart === 'function' ? req.isMultipart() : false;
  if (!isMultipart) {
    throw new AppError('VALIDATION', {
      message: 'فایل باید به صورتِ multipart فرستاده شود.',
    });
  }

  let upload: Awaited<ReturnType<NonNullable<typeof req.file>>>;
  try {
    upload = await req.file?.({ limits: { fileSize: MAX_UPLOAD_BYTES } });
  } catch (error) {
    // @fastify/multipart هنگامِ تخطی از اندازه، پیش از پایانِ جریان خطا می‌دهد
    const code = (error as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE' || /too large/i.test((error as Error).message ?? '')) {
      throw new AppError('VALIDATION', {
        message: `حجمِ تصویر بیش از ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} مگابایت است.`,
      });
    }
    throw error;
  }

  if (!upload) {
    throw new AppError('VALIDATION', { message: 'هیچ فایلی در این درخواست نبود.' });
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of upload.file) {
    total += chunk.length;
    if (total > MAX_UPLOAD_BYTES) {
      throw new AppError('VALIDATION', {
        message: `حجمِ تصویر بیش از ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} مگابایت است.`,
      });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
