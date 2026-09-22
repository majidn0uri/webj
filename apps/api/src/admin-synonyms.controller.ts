import { Body, Controller, Delete, Get, Headers, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AppError } from '@set/shared-kernel';
import {
  deleteSynonym,
  getSynonym,
  clearSearchCache,
  listSynonyms,
  upsertSynonym,
  setSynonymActive,
  zeroResultSuggestions,
} from '@set/catalog';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';

import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * فرهنگِ مترادف‌ها و کشِ جستجو — از پنل، بی‌`psql`.
 *
 * دو چیز که با هم ساخته‌اند و جدا معنا ندارند:
 *
 *  1. **نوشتنِ مترادف.** جدول از مهاجرتِ ۰۰۹ بود و موتورِ جستجو از همان روز
 *     آن را می‌خواند، ولی هیچ مسیرِ نوشتنی نداشت — پس «فروشنده می‌تواند
 *     مترادف تعریف کند» عملاً یعنی developer. این‌جا هم افزودن هست، هم
 *     خاموش/روشن (چون «این مترادف فعلاً ضرر می‌زند» با حذف گفتنی نیست)، هم
 *     «مردم چه جستجو کردند و چیزی پیدا نشد» کنارِ همان فرم — یعنی همان‌جا
 *     که درد هست، درمان هم داده شود.
 *  2. **کشِ پرسش‌هایِ پُرتکرار.** رویِ کاتالوگِ ۲۰٬۰۰۰ کالایی یک «شارژر» ۸۴
 *     میلی‌ثانیه وقتِ سرویس می‌بَرَد؛ دکمهٔ «خالی‌کردنِ کش» برایِ همان است که
 *     پس ازِ یک ویرایشِ دسته‌جمعی (یا یک واردکردنِ اکسل) لازم نشود صبر کرد —
 *     و بی‌اعتبارکردنِ کشِ مترادف، خودِ هر نوشتن انجام می‌دهد.
 *
 * ممیزی: واژه‌ها در `after_data` می‌مانند (داراییِ فرهنگیِ فروشگاه‌اند و باید
 * معلوم باشد چه کسی چه اضافه کرد)، ولی هیچ نشانیِ فایل یا دادهٔ مشتری در این
 * مسیر ردّ نمی‌شود.
 */

const synonymDto = z.object({
  term: z.string().min(1).max(120),
  canonical: z.string().min(1).max(120),
  isActive: z.boolean().optional(),
});

const patchDto = z
  .object({
    term: z.string().min(1).max(120).optional(),
    canonical: z.string().min(1).max(120).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'چیزی برایِ ویرایش فرستاده نشد.' });

const idDto = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'شناسه نامعتبر است');

@Controller('admin/catalog')
export class AdminSynonymsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  private async require(
    authorization: string | undefined,
    permission: 'product.read' | 'product.write',
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    const [resource, action] = permission.split('.');
    await this.access.assert({ userId: claims.sub, branchId: null }, resource!, action!);
    return claims;
  }

  private async audit(
    claims: AccessClaims,
    action: string,
    after: unknown,
    req: FastifyRequest | undefined,
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity, after_data, ip)
         VALUES ($1,$2,$3,$4::jsonb,$5)`,
        [claims.sub, action, 'search_synonyms', JSON.stringify(after ?? null), req?.ip ?? null],
      );
    } catch {
      // ممیزی هرگز مسیرِ اصلی را نمی‌شکند (همان قاعدهٔ بقیهٔ پنل)
    }
  }

  /** خودِ جدولِ مترادف‌ها + جایِ صفحه‌بندی برایِ پنل */
  @Get('synonyms')
  async list(
    @Headers('authorization') authorization: string | undefined,
    @Query('q') q?: string,
    @Query('onlyInactive') onlyInactive?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    await this.require(authorization, 'product.read');
    return listSynonyms(this.db, {
      q,
      onlyInactive: onlyInactive === '1' || onlyInactive === 'true',
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /**
   * پرتکرارترینِ «چیزی پیدا نشد»هایِ سی روزِ اخیر.
   *
   * چرا این جدا از فهرستِ مترادف‌هاست؟ چون پرسشش فرق دارد: یکی «چه گذاشته‌ام»،
   * یکی «چه کم دارم». ولی در پنل کنارِ هم نمایش داده می‌شوند — فروشنده باید
   * بتواند از سطرِ «۳۷ بار جستجو، صفر نتیجه» مستقیم برود رویِ «مترادف بساز».
   */
  @Get('synonyms/suggestions')
  async suggestions(
    @Headers('authorization') authorization: string | undefined,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    await this.require(authorization, 'product.read');
    const rows = await zeroResultSuggestions(this.db, {
      days: days ? Number(days) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return { days: days ? Number(days) : 30, rows };
  }

  @Post('synonyms')
  async create(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const claims = await this.require(authorization, 'product.write');
    const input = synonymDto.parse(body);
    const row = await upsertSynonym(this.db, input);
    await this.audit(claims, 'synonym.upserted', { id: row.id, term: row.term, canonical: row.canonical }, req);
    // کشِ پاسخِ جستجو هم باید برود: یک مترادفِ تازه یعنی «همان پرسش، نتیجهٔ
    // تازه». نگه‌داشتنِ پاسخِ کهنه برایِ ۱۵ ثانیه قابلِ تحمل است ولی برایِ
    // چیزی که فروشنده همین حالا ساخته، توضیح‌خواست می‌شود.
    clearSearchCache(this.db as object);
    return row;
  }

  @Patch('synonyms/:id')
  async patch(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const claims = await this.require(authorization, 'product.write');
    const id = idDto.parse(rawId);
    const input = patchDto.parse(body);

    let row = null;
    if (input.term !== undefined || input.canonical !== undefined) {
      // ویرایشِ خودِ واژه‌ها: باید هر دو داشته باشیم تا کلیدها درست شوند؛
      // فرستادنِ یک‌طرف هم مجاز است چون پنل هر دو را می‌فرستد.
      const found = await getSynonym(this.db, id);
      if (!found) throw new AppError('NOT_FOUND', { message: 'مترادف یافت نشد.' });
      row = await upsertSynonym(this.db, {
        term: input.term ?? found.term,
        canonical: input.canonical ?? found.canonical,
        isActive: input.isActive ?? found.isActive,
      });
      if (row.id !== id) {
        // کلید عوض شده یعنی سطرِ تازه‌ای ساخته شده (یهی‌که یکتایی رویِ کلیدهاست)؛
        // سطرِ کهنه را نگه نمی‌داریم، وگرنه یک واژه دو مترادف دارد.
        await deleteSynonym(this.db, id);
      }
    } else {
      row = await setSynonymActive(this.db, id, input.isActive === true);
      if (!row) throw new AppError('NOT_FOUND', { message: 'مترادف یافت نشد.' });
    }

    await this.audit(claims, 'synonym.updated', { id: row.id, term: row.term, canonical: row.canonical }, req);
    clearSearchCache(this.db as object);
    return row;
  }

  @Delete('synonyms/:id')
  async remove(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Req() req: FastifyRequest,
  ) {
    const claims = await this.require(authorization, 'product.write');
    const id = idDto.parse(rawId);
    const removed = await deleteSynonym(this.db, id);
    if (!removed) throw new AppError('NOT_FOUND', { message: 'مترادفی با این شناسه نبود.' });
    await this.audit(claims, 'synonym.deleted', { id }, req);
    clearSearchCache(this.db as object);
    return { removed: true };
  }

  /**
   * «کشِ جستجو را خالی کن» — برایِ لحظه‌ای که فروشنده دسته‌ای ویرایش کرده و
   * نمی‌خواهد عمرِ کشِ تنظیم‌شده در پنل تمامِ آن را صبر کند.
   */
  @Post('search-cache/clear')
  async clearCache(@Headers('authorization') authorization: string | undefined, @Req() req: FastifyRequest) {
    const claims = await this.require(authorization, 'product.write');
    clearSearchCache(this.db as object);
    await this.audit(claims, 'search_cache.cleared', { at: new Date().toISOString() }, req);
    return { cleared: true };
  }

  /* ── تخفیف حجمی ──────────────────────────────────────────────────────── */

  @Post('volume-discounts')
  async createVolumeDiscount(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Req() req?: FastifyRequest,
  ) {
    const claims = await this.require(authorization, 'product.write');
    const input = z.object({
      productId: z.string().uuid(),
      minQuantity: z.number().int().min(2),
      discountType: z.enum(['percent', 'amount']),
      discountValue: z.string(),
    }).parse(body);

    const { rows } = await this.db.query(
      `INSERT INTO volume_discounts (product_id, min_quantity, discount_type, discount_value)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.productId, input.minQuantity, input.discountType, input.discountValue],
    );

    await this.audit(claims, 'volume_discount.created', { productId: input.productId, minQty: input.minQuantity }, req);
    return { id: rows[0]!.id, message: 'تخفیف حجمی ثبت شد.' };
  }

  @Get('volume-discounts/:productId')
  async getVolumeDiscounts(@Param('productId') productId: string) {
    const { rows } = await this.db.query(
      `SELECT id, min_quantity, discount_type, discount_value::text, is_active
       FROM volume_discounts WHERE product_id = $1 ORDER BY min_quantity`,
      [productId],
    );
    return { items: rows };
  }

  @Delete('volume-discounts/:id')
  async deleteVolumeDiscount(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.require(authorization, 'product.write');
    await this.db.query('DELETE FROM volume_discounts WHERE id = $1', [id]);
    return { deleted: true };
  }
}
