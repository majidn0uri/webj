import type { Database, Queryable } from '@set/db';
import { AppError } from '@set/shared-kernel';

import { cachedList, clearListCache, clearSearchCache, searchCacheKey } from './query-cache.js';

/**
 * ماتریسِ سازگاری — قلبِ مزیتِ این فروشگاه.
 *
 * تجربه‌ی واقعی مشتری این است: «آیا این قطعه به گوشی من می‌خورد؟»
 * دیجی‌کالا (و هر قالبِ آماده) این پرسش را با متنِ آزاد جواب می‌دهد؛
 * ما با یک رابطه‌ی دقیقِ جدولی، که هم قابل فیلتر است و هم قابل تضمین.
 */

export interface DeviceModel {
  id: string;
  brand: string;
  model: string;
  slug: string;
}

export class CompatibilityService {
  constructor(private readonly db: Database) {}

  async ensureBrand(slug: string, name: string): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO device_brands (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [slug, name],
    );
    // فهرستِ دستگاه‌ها (انتخابگرِ «گوشی شما چیست؟») تازه شد. با `clearListCache`
    // و **نه** `clearSearchCache`: نتایجِ جستجو را دست‌نخورده می‌گذاریم — مدلِ
    // تازه‌ای که هنوز سازگاری ندارد، در هیچ جستجویی ظاهر نمی‌شود، پس شکستنِ
    // کشِ گران‌قیمتِ جستجو بی‌جایی بود.
    clearListCache(this.db);
    return rows[0]!.id;
  }

  async ensureModel(brandSlug: string, brandName: string, modelName: string): Promise<string> {
    const brandId = await this.ensureBrand(brandSlug, brandName);
    const slug = modelName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO device_models (brand_id, name, slug) VALUES ($1, $2, $3)
       ON CONFLICT (brand_id, slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [brandId, modelName, slug],
    );
    clearListCache(this.db);
    return rows[0]!.id;
  }

  /**
   * فهرستِ دستگاه‌ها — کش‌شده: این جدول را تنها `ensureBrand`/`ensureModel`
   * عوض می‌کنند و هر دو کش را می‌شکنند. انتخابگرِ «گوشی شما چیست؟» در هر
   * بازدید خوانده می‌شود؛ بی‌کش، هر بار از نو JOIN می‌شد.
   */
  async listDevices(): Promise<{ items: DeviceModel[]; cached: boolean; cacheAgeMs: number }> {
    return cachedList(this.db, searchCacheKey({ list: 'devices' }), async () => {
      const { rows } = await this.db.query<DeviceModel>(
        `SELECT dm.id, db.name AS brand, dm.name AS model, dm.slug
           FROM device_models dm JOIN device_brands db ON db.id = dm.brand_id
          ORDER BY db.name, dm.name`,
      );
      return rows;
    });
  }

  async findModelId(brand: string, model: string): Promise<string | null> {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT dm.id FROM device_models dm JOIN device_brands db ON db.id = dm.brand_id
        WHERE lower(db.name) = lower($1) AND lower(dm.name) = lower($2)`,
      [brand, model],
    );
    return rows[0]?.id ?? null;
  }

  /** ثبتِ سازگاری برای یک تنوع — جایگزینِ کامل (نه افزایشی) */
  async setCompatibility(
    variantId: string,
    deviceModelIds: string[],
    opts: { confidence?: 'exact' | 'reported' | 'unverified'; tx?: Queryable } = {},
  ): Promise<void> {
    const db = opts.tx ?? this.db;
    await db.query(`DELETE FROM product_compatibility WHERE variant_id = $1`, [variantId]);
    for (const modelId of new Set(deviceModelIds)) {
      await db.query(
        `INSERT INTO product_compatibility (variant_id, device_model_id, confidence)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [variantId, modelId, opts.confidence ?? 'exact'],
      );
    }

    // نامِ مدل‌هایِ گوشی داخلِ `search_document` است (تریگرِ ۰۱۰)، پس این
    // نوشتن نتیجهٔ جستجو را عوض می‌کند. اگر کشِ پاسخ سرِ جایش بماند،
    // فروشنده می‌گوید «سازگاری را اصلاح کردم و مشتری همان جوابِ دیروز را
    // می‌بیند» — و این دقیقاً همان چیزی است که این فروشگاه رویش حساب باز
    // کرده. درونِ تراکنشِ دیگران کاری نمی‌کنیم: مالکِ تراکنش بعد ازِ commit
    // خودش می‌اندازد (`afterCatalogChange` در `CatalogService`).
    if (!opts.tx) clearSearchCache(this.db);
  }

  /**
   * کالاهای سازگار با یک مدل، همراه با قیمت و موجودیِ قابل فروش.
   * این همان چیزی است که صفحه‌ی اصلیِ «بر اساس گوشی شما» را تغذیه می‌کند.
   */
  async compatibleProducts(deviceModelId: string, limit = 24) {
    const { rows } = await this.db.query<{
      product_id: string;
      title: string;
      slug: string;
      variant_id: string;
      sku: string;
      price_rial: string;
      available: number;
    }>(
      `SELECT p.id AS product_id, p.title, p.slug, v.id AS variant_id, v.sku, v.price_rial,
              COALESCE((SELECT SUM(s.on_hand - s.reserved) FROM stock_items s WHERE s.variant_id = v.id), 0)::int AS available
         FROM product_compatibility pc
         JOIN product_variants v ON v.id = pc.variant_id AND v.is_active = true
         JOIN products p ON p.id = v.product_id AND p.status = 'active'
        WHERE pc.device_model_id = $1
        ORDER BY available DESC, v.price_rial ASC
        LIMIT $2`,
      [deviceModelId, limit],
    );
    return rows;
  }

  /**
   * بررسیِ «آیا این قطعه به دستگاهِ من می‌خورد؟» — برای نمایشِ هشدار در سبد خرید.
   * پاسخِ سه‌حالته عمداً طراحی شده: ندانستن، بهتر از حدس زدن است.
   */
  async checkFit(variantId: string, deviceModelId: string): Promise<{
    status: 'fits' | 'unknown' | 'not_declared';
    confidence: string | null;
  }> {
    const { rows } = await this.db.query<{ confidence: string }>(
      `SELECT confidence FROM product_compatibility
        WHERE variant_id = $1 AND device_model_id = $2`,
      [variantId, deviceModelId],
    );
    if (rows[0]) return { status: 'fits', confidence: rows[0].confidence };

    const { rows: anyDeclared } = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM product_compatibility WHERE variant_id = $1`,
      [variantId],
    );
    return Number(anyDeclared[0]?.c ?? '0') > 0
      ? { status: 'unknown', confidence: null }
      : { status: 'not_declared', confidence: null };
  }

  /** کالاهایی که هیچ سازگاری‌ای اعلام نکرده‌اند — باید در پنل به عنوانِ «ناقص» نمایش داده شوند */
  async productsMissingCompatibility(limit = 50): Promise<Array<{ product_id: string; title: string; slug: string }>> {
    const { rows } = await this.db.query<{ product_id: string; title: string; slug: string }>(
      `SELECT p.id AS product_id, p.title, p.slug
         FROM products p
        WHERE p.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM product_variants v
              JOIN product_compatibility pc ON pc.variant_id = v.id
             WHERE v.product_id = p.id)
        ORDER BY p.created_at DESC
        LIMIT $1`,
      [limit],
    );
    return rows;
  }
}

export function assertDeclaredCompatibility(variantIds: string[]): void {
  if (variantIds.length === 0) {
    throw new AppError('INVARIANT', { details: { message: 'کالا بدون تنوع است' } });
  }
}
