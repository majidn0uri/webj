import { Body, Controller, Delete, Get, Headers, Inject, Param, Patch, Post, Query } from '@nestjs/common';

import { AppError } from '@set/shared-kernel';
import { CategoryService, ColourService } from '@set/catalog';
import { CatalogService } from '@set/catalog';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';

import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * درختِ دسته‌بندی.
 *
 * دو گونه مسیر، با یک مرزِ روشن:
 *
 *   • **عمومی** (`/categories`) — بی‌نشست، فقط دسته‌هایی که کالا دارند (در
 *     خودشان یا در فرزندانشان). منویی که برگه‌یِ خالی نشان بدهد، خریدار را
 *     به بن‌بست می‌برد.
 *   • **پنل** (`/admin/categories`) — با دسترسی، و همه چیز را می‌بیند تا
 *     فروشنده بتواند دسته‌ای را پیشاپیش بسازد و بعداً کالا در آن بریزد.
 */

function asText(value: unknown, field: string, max = 120): string {
  const text = String(value ?? '').trim();
  if (text.length === 0) throw new AppError('VALIDATION', { message: `${field} را بنویسید.` });
  return text.slice(0, max);
}

function optionalText(value: unknown, max = 500): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return String(value).slice(0, max);
}

function optionalBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return value === true || value === 'true';
}

@Controller()
export class CategoriesController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  private readonly categories = (): CategoryService => new CategoryService(this.db);
  private readonly catalog = (): CatalogService => new CatalogService(this.db);

  private async require(
    authorization: string | undefined,
    permission: 'categories.read' | 'categories.write',
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    const [resource, action] = permission.split('.');
    await this.access.assert({ userId: claims.sub, branchId: null }, resource!, action!);
    return claims;
  }

  /** ── مسیرهایِ عمومی ───────────────────────────────────────────────── */

  /** درخت برایِ منو — تنها دسته‌هایی که کالا دارند (کش‌شده؛ §«کشِ فهرست‌ها») */
  @Get('categories')
  async tree(@Query('all') all?: string) {
    const startedAt = Date.now();
    const r = await this.categories().tree({
      onlyWithProducts: !(all === 'true' || all === '1'),
    });
    return {
      items: r.items,
      // «از کش آمد یا نه» در پاسخِ عمومی هم باید دیده شود: هم سنجه‌ها همین را
      // می‌خوانند، هم وقتی فروشنده بپرسد «چرا منویِ دیروز را نشان می‌دهد؟»
      // جوابِ آماده است.
      cached: r.cached,
      cacheAgeMs: r.cacheAgeMs,
      tookMs: Date.now() - startedAt,
    };
  }

  /** یک دسته با نیاکان (نانِ راهنما) و فرزندانش، و کالاهایش */
  @Get('categories/:slug')
  async detail(@Param('slug') slug: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const { category, ancestors, children } = await this.categories().bySlug(slug);

    const take = Math.min(Math.max(Number(limit ?? 24) || 24, 1), 60);
    const skip = Math.max(Number(offset ?? 0) || 0, 0);

    // کالاهایِ این دسته **و همه‌یِ زیردسته‌هایش**
    const ids = await this.categories().descendantIds(category.id);
    const result = await this.catalog().search({
      query: '',
      typeIds: ids,
      limit: take,
      offset: skip,
      channel: 'web',
    });

    return { category, ancestors, children, products: result.items, total: result.total };
  }

  /** ── مسیرهایِ پنل ─────────────────────────────────────────────────── */

  /**
   * سواچ‌هایِ رنگِ یک کالا.
   *
   * جدا از برگه‌یِ کالا چرا؟ چون رابطِ سواچ می‌خواهد تنها رنگ‌ها را بداند، نه
   * همه‌یِ مشخصات را؛ و چون می‌توان آن‌ها را بی‌بارگیریِ دوباره‌یِ کلِ برگه
   * به‌روز کرد (مثلاً پس از برگزیدنِ مدلِ گوشی).
   */
  @Get('products/:slug/colours')
  async colours(@Param('slug') slug: string) {
    const res = await this.db.query<{ id: string }>(`SELECT id FROM products WHERE slug = $1`, [slug]);
    const id = res.rows[0]?.id;
    if (!id) throw new AppError('NOT_FOUND', { message: 'کالا یافت نشد.' });
    const items = await new ColourService(this.db).swatches(id);
    return { items };
  }

  @Get('admin/categories')
  async listAdmin(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization, 'categories.read');
    const items = await this.categories().flat({ onlyActive: false });
    return { items };
  }

  @Post('admin/categories')
  async create(@Headers('authorization') authorization: string | undefined, @Body() body: Record<string, unknown>) {
    await this.require(authorization, 'categories.write');
    const item = await this.categories().create({
      name: asText(body.name, 'نامِ دسته'),
      key: optionalText(body.key, 60) ?? undefined,
      slug: optionalText(body.slug, 120) ?? undefined,
      parentId: optionalText(body.parentId, 40) ?? null,
      description: optionalText(body.description),
      imageUrl: optionalText(body.imageUrl, 500),
      sortOrder: body.sortOrder === undefined ? undefined : Number(body.sortOrder),
      isActive: optionalBool(body.isActive),
    });
    return { item };
  }

  @Patch('admin/categories/:id')
  async update(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    await this.require(authorization, 'categories.write');
    const item = await this.categories().update(id, {
      name: body.name === undefined ? undefined : asText(body.name, 'نامِ دسته'),
      slug: optionalText(body.slug, 120) ?? undefined,
      description: optionalText(body.description),
      imageUrl: optionalText(body.imageUrl, 500),
      sortOrder: body.sortOrder === undefined ? undefined : Number(body.sortOrder),
      isActive: optionalBool(body.isActive),
    });
    return { item };
  }

  /**
   * جابه‌جاییِ یک شاخه.
   *
   * این تنها کاری در درخت است که می‌تواند کلِ ساختار را خراب کند — پس همه‌یِ
   * مهارها (چرخه، ژرفا، بازسازیِ مسیر) پیش از پاسخ اجرا می‌شوند و نتیجه‌ی
   * تازه (با مسیرِ نو) برمی‌گردد تا رابط بی‌درنگ درست را نشان دهد.
   */
  @Post('admin/categories/:id/move')
  async move(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    await this.require(authorization, 'categories.write');
    const parentId = optionalText(body.parentId, 40) ?? null;
    const item = await this.categories().move(id, parentId);
    return { item };
  }

  /** چیدنِ فرزندانِ یک پدر */
  @Post('admin/categories/order')
  async reorder(@Headers('authorization') authorization: string | undefined, @Body() body: Record<string, unknown>) {
    await this.require(authorization, 'categories.write');
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id)) : [];
    if (ids.length === 0) throw new AppError('VALIDATION', { message: 'ترتیبی فرستاده نشده است.' });
    const parentId = optionalText(body.parentId, 40) ?? null;
    await this.categories().reorder(parentId, ids);
    return { ok: true };
  }

  @Delete('admin/categories/:id')
  async remove(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Query('moveProductsTo') moveProductsTo?: string,
    @Query('moveChildrenTo') moveChildrenTo?: string,
  ) {
    await this.require(authorization, 'categories.write');
    return this.categories().remove(id, {
      moveProductsTo: moveProductsTo ? String(moveProductsTo) : undefined,
      moveChildrenTo: moveChildrenTo ? String(moveChildrenTo) : undefined,
    });
  }
}
