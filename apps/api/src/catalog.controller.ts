import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, formatToman } from '@set/shared-kernel';
import type { Database } from '@set/db';
import { recordAudit, publishEvent } from '@set/db';
import { CatalogService, CategoryService, CompatibilityService } from '@set/catalog';
import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';
import type { TokenService } from '@set/auth';
import type { AccessControl } from '@set/rbac';

const CreateProductDto = z.object({
  typeKey: z.string().min(2),
  brandSlug: z.string().nullish(),
  title: z.string().min(3),
  description: z.string().nullish(),
  attributes: z.record(z.unknown()).nullish(),
  images: z.array(z.object({ url: z.string(), alt: z.string().nullish(), role: z.string().nullish() })).nullish(),
  variants: z.array(
    z.object({
      sku: z.string().min(2),
      priceRial: z.union([z.string(), z.number()]).transform((v) => BigInt(v)),
      attributes: z.record(z.unknown()).nullish(),
      compatibleModelIds: z.array(z.string()).nullish(),
    }),
  ).min(1),
});

const UpdateProductDto = z.object({
  title: z.string().min(3).optional(),
  description: z.string().nullish(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  typeKey: z.string().min(2).optional(),
  brandSlug: z.string().nullish(),
  attributes: z.record(z.unknown()).nullish(),
  images: z
    .array(z.object({ url: z.string(), alt: z.string().nullish(), role: z.string().nullish() }))
    .nullish(),
  variants: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        sku: z.string().min(2),
        priceRial: z.union([z.string(), z.number()]).transform((v) => BigInt(v)),
        attributes: z.record(z.unknown()).nullish(),
        compatibleModelIds: z.array(z.string()).nullish(),
        active: z.boolean().optional(),
      }),
    )
    .min(1)
    .optional(),
});

@Controller('catalog')
export class CatalogController {
  private readonly catalog: CatalogService;
  private readonly compat: CompatibilityService;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {
    this.catalog = new CatalogService(this.db);
    this.compat = new CompatibilityService(this.db);
  }

  /**
   * جستجویِ فارسی.
   *
   * تفاوتش با `/catalog/products?q=`: این مسیر «توضیح» هم برمی‌گرداند —
   * کدام مترادف‌ها اعمال شد، عبارت پس از نرمال‌سازی چه بوده، و جستجو چند
   * میلی‌ثانیه طول کشیده. این سه برای این لازم‌اند که:
   *   • اگر کاربر نتیجه‌ای ندید، بفهمیم چرا (مترادفِ غلط؟ کالا موجود نیست؟)،
   *   • و اگر کالا پیدا نشد، ردّش در جدولِ search_queries بماند تا بشود
   *     تقاضایِ از‌دست‌رفته را تأمین کرد.
   */
  @Get('search')
  async search(
    @Query('q') q?: string,
    @Query('device') device?: string,
    @Query('brand') brand?: string,
    @Query('type') type?: string,
    /** نامکِ دسته — کالاهایِ این دسته **و همه‌یِ زیردسته‌هایش** */
    @Query('cat') cat?: string,
    @Query('available') available?: string,
    /** رنگ‌ها، با کاما جدا شده */
    @Query('colour') colour?: string,
    /** فقط کالاهایی که همین لحظه تخفیفِ فعال دارند */
    @Query('discounted') discounted?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Headers('authorization') authorization?: string,
  ) {
    if (!q || q.trim().length === 0) {
      return {
        total: 0,
        count: 0,
        items: [],
        normalized: '',
        applied: [],
        relaxed: false,
        tookMs: 0,
        cached: false,
        cacheAgeMs: 0,
      };
    }

    // تشخیص همکار از توکن (اختیاری — مهمان قیمت عادی می‌بیند)
    let isPartner = false;
    if (authorization) {
      try {
        const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : undefined;
        if (token) {
          const claims = await this.tokens.verifyAccess(token);
          if (claims?.sub) {
            const { rows: cust } = await this.db.query<{ is_partner: boolean }>(
              `SELECT is_partner FROM customers WHERE user_id = $1 LIMIT 1`, [claims.sub],
            );
            isPartner = cust[0]?.is_partner === true;
          }
        }
      } catch { /* مهمان */ }
    }

    const result = await this.catalog.search({
      query: q,
      deviceModelId: device ?? null,
      brandSlug: brand ?? null,
      typeKey: type ?? null,
      typeIds: cat ? await new CategoryService(this.db).descendantIds(String(cat)) : null,
      onlyAvailable: available === '1' || available === 'true',
      colours: colour
        ? colour.split(',').map((c) => c.trim()).filter((c) => c.length > 0)
        : undefined,
      onlyDiscounted: discounted === '1' || discounted === 'true',
      isPartner,
      limit: limit ? Number(limit) : 24,
      offset: offset ? Number(offset) : 0,
      channel: 'web',
    });

    return {
      total: result.total,
      count: result.items.length,
      normalized: result.normalized,
      applied: result.applied,
      relaxed: result.relaxed,
      tookMs: result.tookMs,
      // «از کش آمد یا نه» باید بیرونِ سرور هم دیده شود: هم برایِ این‌که
      // آزمونِ بار و اسکریپتِ اندازه‌گیری نرخِ برخورد را گزارش کنند، هم برایِ
      // این‌که وقتی فروشنده می‌پرسد «چرا قیمتِ دیروز را نشان می‌دهد» جوابِ
      // آماده باشد (cacheAgeMs عمرِ پاسخِ مانده را می‌گوید).
      cached: result.cached,
      cacheAgeMs: result.cacheAgeMs,
      items: result.items.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        brand: p.brandName,
        type: p.typeKey,
        minPriceRial: p.minPriceRial,
        variantCount: p.variantCount,
        imageUrl: p.imageUrl,
        imageCardUrl: p.imageCardUrl ?? null,
        imagePlaceholder: p.imagePlaceholder ?? null,
        // همان برچسب‌هایِ مسیرِ «فهرست»: یک رفتار در دو مسیر، تا کارتِ کالا
        // در جستجو چیزی کمتر از فهرست نشان ندهد
        isNew: p.isNew ?? false,
        discountPercent: p.discountPercent ?? null,
        discountAmountRial: p.discountAmountRial ?? null,
        availableQty: p.availableQty ?? 0,
        colours: p.colours ?? [],
      })),
    };
  }

  /** فهرستِ کالاها — مهم‌ترین پارامتر: device (مدلِ گوشی) */
  @Get('products')
  async list(
    @Query('device') device?: string,
    @Query('brand') brand?: string,
    @Query('type') type?: string,
    @Query('q') q?: string,
    @Query('available') available?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    /** فقط کالاهایی که همین لحظه تخفیفِ فعال دارند (BR-03) */
    @Query('discounted') discounted?: string,
    /** رنگ‌ها، با کاما جدا شده: colour=مشکی,سرمه‌ای */
    @Query('colour') colour?: string,
    /** trending = پرفروشِ ۱۴ روزِ اخیر · newest · cheapest */
    @Query('sort') sort?: string,
    @Headers('authorization') authorization?: string,
  ) {
    // تشخیص همکار از توکن
    let isPartner = false;
    if (authorization) {
      try {
        const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : undefined;
        if (token) {
          const claims = await this.tokens.verifyAccess(token);
          if (claims?.sub) {
            const { rows: cust } = await this.db.query<{ is_partner: boolean }>(
              `SELECT is_partner FROM customers WHERE user_id = $1 LIMIT 1`, [claims.sub],
            );
            isPartner = cust[0]?.is_partner === true;
          }
        }
      } catch { /* مهمان */ }
    }

    const { items, total } = await this.catalog.list({
      deviceModelId: device ?? null,
      brandSlug: brand ?? null,
      typeKey: type ?? null,
      query: q ?? null,
      onlyAvailable: available === '1' || available === 'true',
      limit: limit ? Number(limit) : 24,
      offset: offset ? Number(offset) : 0,
      discounted: discounted === '1' || discounted === 'true',
      // رنگ‌ها از نشانی می‌آیند (با کاما جدا)؛ تهی و فاصله حذف می‌شود تا
      // `colour=مشکی,` نیز درست کار کند
      colours: colour
        ? colour.split(',').map((c) => c.trim()).filter((c) => c.length > 0)
        : undefined,
      isPartner,
      sort:
        sort === 'trending' || sort === 'cheapest' || sort === 'newest'
          ? (sort as 'trending' | 'cheapest' | 'newest')
          : undefined,
    });

    return {
      total,
      count: items.length,
      items: items.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        brand: p.brandName,
        type: p.typeKey,
        price: p.minPriceRial ? formatToman(BigInt(p.minPriceRial)) : null,
        priceRial: p.minPriceRial,
        // ارزان‌ترین تنوعِ فعال: «افزودن به سبدِ سریع» روی کارتِ کالا
        defaultVariantId: p.defaultVariantId ?? null,
        variantCount: p.variantCount,
        imageUrl: p.imageUrl ?? null,
        imageCardUrl: p.imageCardUrl ?? null,
        imagePlaceholder: p.imagePlaceholder ?? null,
        // برچسب‌هایِ کارت: «جدید»، درصدِ تخفیف، و «تنها چند عدد مانده».
        // این‌ها در پایگاه حساب می‌شوند (نه در مرورگر) چون وابسته به «اکنون»
        // اند: اگر در مرورگر حساب شوند، تا رسیدنِ پاسخ، تاریخ‌شان گذشته است.
        isNew: p.isNew ?? false,
        discountPercent: p.discountPercent ?? null,
        discountAmountRial: p.discountAmountRial ?? null,
        availableQty: p.availableQty ?? 0,
        colours: p.colours ?? [],
      })),
    };
  }

  /** برندهایِ دارایِ کالا، با شمارش — خوراکِ ریلِ برندها در صفحه‌ی اصلی */
  @Get('brands')
  async brands() {
    const startedAt = Date.now();
    const r = await this.catalog.brands();
    return { brands: r.items, cached: r.cached, cacheAgeMs: r.cacheAgeMs, tookMs: Date.now() - startedAt };
  }

  /** دستگاه‌های پشتیبانی‌شده (برای انتخابگرِ «گوشی شما چیست؟») */
  @Get('devices')
  async devices() {
    const startedAt = Date.now();
    const r = await this.compat.listDevices();
    return { devices: r.items, cached: r.cached, cacheAgeMs: r.cacheAgeMs, tookMs: Date.now() - startedAt };
  }

  /**
   * رنگ‌هایِ موجودِ فروشگاه — خوراکِ فیلترِ رنگ.
   *
   * بی‌این مسیر، صفحه‌یِ جستجو مجبور بود برایِ دانستنِ هفت نامِ رنگ، صد کالا را
   * کامل بخواند؛ آن هم در هر درخواست، چون نتیجه‌یِ جستجو کش نمی‌شود. این پاسخ
   * ساعت‌ها اعتبار دارد (رنگ را فروشنده از پنل عوض می‌کند، نه خریدار).
   */
  @Get('colours')
  async colours() {
    const startedAt = Date.now();
    const r = await this.catalog.availableColours();
    return { colours: r.items, cached: r.cached, cacheAgeMs: r.cacheAgeMs, tookMs: Date.now() - startedAt };
  }

  /** کالاهای سازگار با یک مدل — خوراکِ صفحه اصلیِ «بر اساس گوشی شما» */
  @Get('compatible/:deviceModelId')
  async compatible(@Param('deviceModelId') deviceModelId: string, @Query('limit') limit?: string) {
    const rows = await this.compat.compatibleProducts(deviceModelId, limit ? Number(limit) : 24);
    return {
      count: rows.length,
      items: rows.map((r) => ({
        productId: r.product_id,
        title: r.title,
        slug: r.slug,
        sku: r.sku,
        price: formatToman(BigInt(r.price_rial)),
        priceRial: r.price_rial,
        available: r.available,
      })),
    };
  }

  @Get('products/:slug')
  async detail(@Param('slug') slug: string) {
    const product = await this.catalog.getBySlug(slug);
    if (!product) throw new AppError('NOT_FOUND');
    return product;
  }

  /**
   * مقایسه‌یِ کالا — دو تا چهار کالا در کنارِ هم (جدولِ مشخصات + سازگاری).
   * عمومی است (مثلِ خودِ کالاها): خریداری که وارد نشده هم مقایسه می‌کند.
   */
  @Get('compare')
  async compare(@Query('slugs') slugs?: string) {
    const list = (slugs ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length < 2) throw new AppError('VALIDATION', { message: 'برایِ مقایسه دست‌کم دو کالا لازم است' });
    return this.catalog.compare(list);
  }

  /**
   * تاریخچهٔ قیمت — عمومی: خریدار باید ببیند قیمتِ فعلی واقعی است یا نه.
   */
  @Get('products/:slug/price-history')
  async priceHistory(@Param('slug') slug: string) {
    return this.catalog.priceHistory(slug);
  }

  /** کالاهایی که سازگاری اعلام نکرده‌اند — برای تکمیل در پنل */
  @Get('incomplete')
  async incomplete(@Headers('authorization') authorization?: string) {
    await this.requirePermission(authorization, 'product', 'write');
    return { items: await this.compat.productsMissingCompatibility() };
  }

  @Post('products')
  async create(@Body() body: unknown, @Headers('authorization') authorization?: string, @Req() req?: FastifyRequest) {
    const claims = await this.requirePermission(authorization, 'product', 'write');
    const input = CreateProductDto.parse(body);

    const created = await this.catalog.createProduct({
      typeKey: input.typeKey,
      brandSlug: input.brandSlug ?? null,
      title: input.title,
      description: input.description ?? undefined,
      attributes: (input.attributes as Record<string, unknown>) ?? undefined,
      images: (input.images ?? []).map((i) => ({ url: i.url, alt: i.alt ?? undefined, role: i.role ?? undefined })),
      variants: input.variants.map((v) => ({
        sku: v.sku,
        priceRial: v.priceRial,
        attributes: (v.attributes as Record<string, unknown>) ?? undefined,
        compatibleModelIds: v.compatibleModelIds ?? undefined,
      })),
    });

    await recordAudit(this.db, {
      actorUserId: claims.sub,
      action: 'product.created',
      entity: 'product',
      entityId: created.id,
      after: { title: input.title, variants: created.variantIds.length },
      ip: req?.ip ?? null,
    });
    await publishEvent(this.db, {
      aggregate: 'product',
      aggregateId: created.id,
      eventType: 'product.created',
      payload: { title: input.title },
    });

    return created;
  }

  /**
   * ویرایشِ کالا.
   *
   * تفاوتِ مهم با ایجاد: اینجا «تاریخچه» وجود دارد. تنوعی که از فهرست حذف
   * شود، اگر در سفارش‌ها یا انبار اثری از آن مانده باشد حذفِ فیزیکی نمی‌شود
   * (فقط غیرفعال می‌گردد) تا گزارش‌ها و اسنادِ حسابداری نشکنند. تغییرِ قیمت
   * هم با مقدارِ قبلی و جدید در حسابرسی ثبت می‌شود.
   */
  @Patch('products/:id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Req() req?: FastifyRequest,
  ) {
    const claims = await this.requirePermission(authorization, 'product', 'write');
    if (!z.string().uuid().safeParse(id).success) {
      throw new AppError('VALIDATION', { message: 'شناسه‌ی کالا معتبر نیست.' });
    }
    const input = UpdateProductDto.parse(body);

    const before = await this.productDetail(id).catch(() => null);
    const updated = await this.catalog.updateProduct({
      productId: id,
      title: input.title,
      description: input.description ?? undefined,
      status: input.status,
      typeKey: input.typeKey,
      // نبودن یعنی «تغییر نکند»؛ null یعنی «برند برداشته شود»
      brandSlug: input.brandSlug,
      attributes: (input.attributes as Record<string, unknown>) ?? undefined,
      images: (input.images ?? undefined)?.map((i) => ({ url: i.url, alt: i.alt ?? undefined, role: i.role ?? undefined })),
      variants: input.variants?.map((v) => ({
        id: v.id,
        sku: v.sku,
        priceRial: v.priceRial,
        attributes: (v.attributes as Record<string, unknown>) ?? undefined,
        compatibleModelIds: v.compatibleModelIds ?? undefined,
        active: v.active,
      })),
    });

    await recordAudit(this.db, {
      actorUserId: claims.sub,
      action: 'product.updated',
      entity: 'product',
      entityId: id,
      before: before ? { title: before.title, status: before.status } : null,
      after: {
        title: updated.title,
        priceChanges: updated.priceChanges,
        deactivatedVariants: updated.deactivatedVariantIds.length,
      },
      ip: req?.ip ?? null,
    });
    await publishEvent(this.db, {
      aggregate: 'product',
      aggregateId: id,
      eventType: 'product.updated',
      payload: { title: updated.title, priceChanges: updated.priceChanges },
    });

    return updated;
  }

  /** جزئیاتِ کامل برایِ فرمِ ویرایش — تنوع‌ها، تصویرها و گوشی‌هایِ سازگار */
  @Get('products/:id/edit')
  async editForm(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    await this.requirePermission(authorization, 'product', 'write');
    if (!z.string().uuid().safeParse(id).success) {
      throw new AppError('VALIDATION', { message: 'شناسه‌ی کالا معتبر نیست.' });
    }
    const detail = await this.productDetail(id);
    if (!detail) throw new AppError('NOT_FOUND', { message: 'کالا پیدا نشد.' });
    return detail;
  }

  private async productDetail(id: string): Promise<{
    id: string; title: string; slug: string; description: string; status: string;
    typeKey: string | null; brandSlug: string | null; attributes: Record<string, unknown>;
    images: Array<{ url: string; alt: string; role: string }>;
    variants: Array<{
      id: string; sku: string; barcode: string | null; priceRial: string;
      isActive: boolean; attributes: Record<string, unknown>; compatibleModelIds: string[];
    }>;
  } | null> {
    const { rows } = await this.db.query<{
      id: string; title: string; slug: string; description: string; status: string;
      type_key: string | null; brand_slug: string | null;
    }>(
      `SELECT p.id, p.title, p.slug, p.description, p.status,
              pt.key AS type_key, b.slug AS brand_slug
         FROM products p
         LEFT JOIN product_types pt ON pt.id = p.type_id
         LEFT JOIN brands b ON b.id = p.brand_id
        WHERE p.id = $1`,
      [id],
    );
    const p = rows[0];
    if (!p) return null;

    const { rows: attrs } = await this.db.query<{ values: Record<string, unknown> | null }>(
      `SELECT values FROM product_attributes WHERE product_id = $1`, [id],
    );
    const { rows: images } = await this.db.query<{ url: string; alt: string; role: string }>(
      `SELECT url, alt, role FROM product_images WHERE product_id = $1 ORDER BY sort_order`, [id],
    );
    const { rows: variants } = await this.db.query<{
      id: string; sku: string; barcode: string | null; price_rial: string;
      is_active: boolean; attributes: Record<string, unknown> | null;
    }>(
      `SELECT id, sku, barcode, price_rial::text, is_active, attributes
         FROM product_variants WHERE product_id = $1 ORDER BY sku`,
      [id],
    );

    const compatByVariant = new Map<string, string[]>();
    if (variants.length) {
      const { rows: compat } = await this.db.query<{ variant_id: string; device_model_id: string }>(
        `SELECT pc.variant_id::text, pc.device_model_id::text
           FROM product_compatibility pc
           JOIN product_variants pv ON pv.id = pc.variant_id
          WHERE pv.product_id = $1`,
        [id],
      );
      for (const c of compat) {
        const list = compatByVariant.get(c.variant_id) ?? [];
        list.push(c.device_model_id);
        compatByVariant.set(c.variant_id, list);
      }
    }

    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      description: p.description,
      status: p.status,
      typeKey: p.type_key,
      brandSlug: p.brand_slug,
      attributes: attrs[0]?.values ?? {},
      images: images.map((i) => ({ url: i.url, alt: i.alt ?? '', role: i.role ?? 'gallery' })),
      variants: variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        priceRial: v.price_rial,
        isActive: v.is_active,
        attributes: v.attributes ?? {},
        compatibleModelIds: compatByVariant.get(v.id) ?? [],
      })),
    };
  }

  private async requirePermission(authorization: string | undefined, resource: string, action: string) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED', { message: 'توکن نامعتبر یا منقضی شده است' });
    await this.access.assert({ userId: claims.sub, branchId: claims.branch }, resource, action);
    return claims;
  }
}
