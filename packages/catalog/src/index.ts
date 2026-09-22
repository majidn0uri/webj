export * from './query-cache.js';
export * from './synonyms.js';
export * from './colours.js';
export * from './categories.js';
export * from './compatibility.js';
export * from './compare.js';
export * from './price-history.js';
import type { Database, Queryable } from '@set/db';
import { AppError, newId, searchKey, expandSearchQuery } from '@set/shared-kernel';

import {
  cachedList,
  cachedProbe,
  cacheGet,
  cachePut,
  clearSearchCache,
  hasRelation,
  invalidateProbe,
  searchCacheKey,
  searchCachePolicy,
  type SearchCachePolicy,
} from './query-cache.js';
import { compare as compareProducts } from './compare.js';
import { priceHistory as priceHistoryFn, recordPriceChange } from './price-history.js';

/**
 * فرهنگِ مترادف تقریباً بی‌تغییر است (روزی یکی‌دوتا) ولی در **هر** جستجو لازم
 * می‌شود. پیش‌تر برایِ هر درخواست از نو خوانده و بازسازی می‌شد؛ رویِ کاتالوگِ
 * بزرگ همان چیزی است که کاربر «سرور سنگین می‌شود» صدا می‌زند. سی ثانیه کش، و
 * هر نوشتنی که از پنل مترادف را عوض می‌کند بی‌اعتبارش می‌سازد — پس فروشنده
 * نتیجه را همان لحظه می‌بیند و بقیهٔ فرآیندها حداکثر تا همان سی ثانیه.
 */
const SYNONYMS_TTL_MS = 30_000;

/** آنچه برایِ یک پاسخِ کش‌شده لازم است (بی‌`tookMs` — آن عدد مالِ همین درخواست است) */
interface SearchCachePayload {
  items: ProductSummary[];
  total: number;
  normalized: string;
  applied: Array<{ input: string; matched: string[] }>;
  relaxed: boolean;
  builtAt: number;
}

/**
 * کاتالوگ — جایی که «سازگاری با مدل گوشی» از یک ایده به داده تبدیل می‌شود.
 *
 * قانونِ طلایی: هیچ کالایی بدون دست‌کم یک «نوع» ثبت نمی‌شود،
 * و هیچ تنوعی بدون اعلامِ صریحِ دستگاه‌های سازگار منتشر نمی‌گردد
 * (در غیر این صورت فروشگاه نمی‌تواند وعده‌ی «ست می‌شود» بدهد).
 */

export interface VariantInput {
  sku: string;
  barcode?: string | null;
  attributes?: Record<string, unknown>;
  priceRial: bigint;
  compatibleModelIds?: string[];
}

export interface CreateProductInput {
  typeKey: string;
  brandSlug?: string | null;
  title: string;
  slug?: string;
  description?: string;
  attributes?: Record<string, unknown>;
  images?: Array<{ url: string; alt?: string; role?: string }>;
  variants: VariantInput[];
  status?: 'draft' | 'active' | 'archived';
}

export interface UpdateVariantInput extends VariantInput {
  /** شناسه‌ی تنوع — اگر نباشد یعنی تنوعِ تازه است */
  id?: string;
  /** false یعنی از فروش خارج شود (حذفِ نرم) */
  active?: boolean;
}

export interface PriceChange {
  variantId: string;
  sku: string;
  fromRial: string;
  toRial: string;
}

export interface UpdateProductInput {
  productId: string;
  title?: string;
  description?: string;
  status?: 'draft' | 'active' | 'archived';
  typeKey?: string;
  /** null یعنی حذفِ برند */
  brandSlug?: string | null;
  attributes?: Record<string, unknown>;
  images?: Array<{ url: string; alt?: string; role?: string }>;
  variants?: UpdateVariantInput[];
}

export interface UpdateProductResult {
  id: string;
  slug: string;
  title: string;
  variantIds: string[];
  deactivatedVariantIds: string[];
  priceChanges: PriceChange[];
}

export interface ProductSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  brandName: string | null;
  typeKey: string;
  minPriceRial: string | null;
  /** ارزان‌ترین تنوعِ فعال — برای «افزودن به سبدِ سریع» از کارتِ کالا */
  defaultVariantId: string | null;
  variantCount: number;
  imageUrl?: string | null;
  /** اندازه‌یِ کارت (۶۰۰ پیکسل) — برایِ فهرست‌ها؛ نبودش یعنی تصویرِ قدیمی است */
  imageCardUrl?: string | null;
  /** پیش‌نمایشِ تارِ بسیار کوچک (data URI) — تا پیش از رسیدنِ تصویر، جایش را نگه دارد */
  imagePlaceholder?: string | null;
  /** «جدید» است؟ بر پایه‌یِ `is_new_until`ِ تنوع‌ها */
  isNew?: boolean;
  /** درصدِ تخفیفِ اکنون‌جاریِ کالا (بیرون از بازه یا بی‌تخفیف: تهی) */
  discountPercent?: number | null;
  /** مبلغِ تخفیفِ اکنون‌جاری (ریال) — برایِ تخفیف‌هایِ مبلغی */
  discountAmountRial?: string | null;
  /** روی‌هم‌رفته‌یِ موجودیِ قابلِ فروشِ همه‌یِ تنوع‌ها */
  availableQty?: number;
  /** رنگ‌هایِ موجود — برایِ فیلترِ رنگ در فهرست و سواچِ رویِ کارت */
  colours?: string[];
}

export class CatalogService {
  constructor(private readonly db: Database) {}

  async createProduct(input: CreateProductInput): Promise<{ id: string; slug: string; variantIds: string[] }> {
    if (input.variants.length === 0) {
      throw new AppError('VALIDATION', { details: { variants: 'هر کالا دست‌کم یک تنوع دارد' } });
    }

    const slug = input.slug?.trim() || slugify(input.title);

    return this.afterCatalogChange(this.db.transaction(async (tx) => {
      const { rows: types } = await tx.query<{ id: string }>(
        `SELECT id FROM product_types WHERE key = $1`, [input.typeKey],
      );
      const type = types[0];
      if (!type) throw new AppError('VALIDATION', { details: { typeKey: 'نوع کالا نامعتبر است' } });

      let brandId: string | null = null;
      if (input.brandSlug) {
        const { rows } = await tx.query<{ id: string }>(`SELECT id FROM brands WHERE slug = $1`, [input.brandSlug]);
        brandId = rows[0]?.id ?? null;
        if (!brandId) throw new AppError('VALIDATION', { details: { brandSlug: 'برند یافت نشد' } });
      }

      const { rows: inserted } = await tx.query<{ id: string; slug: string }>(
        `INSERT INTO products (type_id, brand_id, title, slug, description, search_key, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, slug`,
        [
          type.id,
          brandId,
          input.title.trim(),
          slug,
          input.description ?? '',
          searchKey(`${input.title} ${input.description ?? ''}`),
          input.status ?? 'active',
        ],
      );
      const product = inserted[0]!;

      if (input.attributes && Object.keys(input.attributes).length) {
        await tx.query(
          `INSERT INTO product_attributes (product_id, values) VALUES ($1, $2::jsonb)`,
          [product.id, JSON.stringify(input.attributes)],
        );
      }

      for (const [index, image] of (input.images ?? []).entries()) {
        await tx.query(
          `INSERT INTO product_images (product_id, url, alt, role, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [product.id, image.url, image.alt ?? '', image.role ?? 'gallery', index],
        );
      }

      const variantIds: string[] = [];
      for (const variant of input.variants) {
        const { rows: v } = await tx.query<{ id: string }>(
          `INSERT INTO product_variants (product_id, sku, barcode, attributes, price_rial)
           VALUES ($1, $2, $3, $4::jsonb, $5)
           RETURNING id`,
          [
            product.id,
            variant.sku,
            variant.barcode ?? null,
            JSON.stringify(variant.attributes ?? {}),
            variant.priceRial.toString(),
          ],
        );
        const variantId = v[0]!.id;
        variantIds.push(variantId);

        // ثبتِ قیمتِ آغازین در تاریخچه — نقطهٔ صفرِ نمودار
        await recordPriceChange(tx, variantId, variant.priceRial);

        if (variant.compatibleModelIds?.length) {
          for (const modelId of variant.compatibleModelIds) {
            await tx.query(
              `INSERT INTO product_compatibility (variant_id, device_model_id, confidence)
               VALUES ($1, $2, 'exact') ON CONFLICT DO NOTHING`,
              [variantId, modelId],
            );
          }
        }
      }

      return { id: product.id, slug: product.slug, variantIds };
    }));
  }

  /**
   * هر نوشتنِ موفّق رویِ کاتالوگ، کشِ پاسخِ جستجو را می‌اندازد.
   *
   * چرا این‌جا و نه با تریگرِ پایگاه؟ چون تریگرِ statement رویِ یک سطرِ
   * مشترکِ «نوبتِ معتبرسازی» زیرِ بارِ وارداتِ انبوه به گلوگاهِ قفل تبدیل
   * می‌شود (همان اشتباهی که در کشِ رسانه دیدیم). نوشتنِ کالا از همین دو
   * متدِ سرویس می‌گذرد، پس همین‌جا هم ارزان است هم قطعی: فروشنده کالا را
   * «انتشار» می‌دهد و همان لحظه در جستجو دیده می‌شود، بدونِ انتظارِ TTL.
   * (موجودی و قیمتِ تغییرکرده با سفارش از این مسیرها نمی‌گذرند — سقفِ
   * کهنگی‌شان همان ۱۵ ثانیهٔ `revalidate` است، نه چیزی که ما افزوده باشیم.)
   *
   * فقط در حالتِ موفّق؛ اگر تراکنش rollback شد چیزی عوض نشده که کش برود.
   */
  private afterCatalogChange<T>(work: Promise<T>): Promise<T> {
    return work.then((value) => {
      clearSearchCache(this.db);
      return value;
    });
  }

  /**
   * ویرایشِ کالا.
   *
   * چرا «ویرایش» سخت‌تر از «ایجاد» است؟ چون کالا تا این لحظه فروخته شده،
   * در انبار مانده و در فاکتورها آمده است. پس سه قاعده رعایت می‌شود:
   *
   *   ۱) تنوع‌ها حذفِ فیزیکی نمی‌شوند مگر اینکه هیچ اثری از آن‌ها نمانده باشد
   *      (بدونِ حرکتِ انبار، بدونِ سفارش، بدونِ فاکتور). در غیر این صورت
   *      غیرفعال می‌شوند تا تاریخچه‌ی مالی و انبار سالم بماند.
   *   ۲) تغییرِ قیمت ثبت می‌شود (از چه به چه) — هم برای حسابرسی و هم برای
   *      این‌که اگر مشتری در سبد قیمتِ قدیمی دارد، بشود صادقانه به او گفت
   *      قیمت تغییر کرده است.
   *   ۳) سندِ جستجو خودبه‌خود بازسازی می‌شود (تریگرِ ۰۱۰)؛ کافی است داده‌ی
   *      واقعی درست نوشته شود.
   */
  async updateProduct(input: UpdateProductInput): Promise<UpdateProductResult> {
    if (input.variants && input.variants.length === 0) {
      throw new AppError('VALIDATION', { details: { variants: 'هر کالا دست‌کم یک تنوع دارد' } });
    }

    return this.afterCatalogChange(this.db.transaction(async (tx): Promise<UpdateProductResult> => {
      const { rows: found } = await tx.query<{
        id: string; title: string; slug: string; description: string; status: string;
        type_id: string; brand_id: string | null;
      }>(
        `SELECT id, title, slug, description, status, type_id, brand_id
           FROM products WHERE id = $1 FOR UPDATE`,
        [input.productId],
      );
      const product = found[0];
      if (!product) throw new AppError('NOT_FOUND', { message: 'کالا پیدا نشد.' });

      // --- نوع و برند (اگر آمده باشند)
      let typeId = product.type_id;
      if (input.typeKey !== undefined) {
        const { rows } = await tx.query<{ id: string }>(
          `SELECT id FROM product_types WHERE key = $1`, [input.typeKey],
        );
        if (!rows[0]) throw new AppError('VALIDATION', { details: { typeKey: 'نوع کالا نامعتبر است' } });
        typeId = rows[0].id;
      }

      let brandId = product.brand_id;
      if (input.brandSlug !== undefined) {
        if (input.brandSlug === null) {
          brandId = null;
        } else {
          const { rows } = await tx.query<{ id: string }>(
            `SELECT id FROM brands WHERE slug = $1`, [input.brandSlug],
          );
          if (!rows[0]) throw new AppError('VALIDATION', { details: { brandSlug: 'برند یافت نشد' } });
          brandId = rows[0].id;
        }
      }

      const title = input.title?.trim() ?? product.title;
      const description = input.description ?? product.description;
      const status = input.status ?? product.status;

      await tx.query(
        `UPDATE products
            SET title = $2, description = $3, search_key = $4, status = $5,
                type_id = $6, brand_id = $7, updated_at = now()
          WHERE id = $1`,
        [product.id, title, description, searchKey(`${title} ${description}`), status, typeId, brandId],
      );

      // --- مشخصات (ویژگی‌ها)
      if (input.attributes) {
        const { affectedRows } = await tx.query(
          `UPDATE product_attributes SET values = $2::jsonb WHERE product_id = $1`,
          [product.id, JSON.stringify(input.attributes)],
        );
        if (!affectedRows) {
          await tx.query(
            `INSERT INTO product_attributes (product_id, values) VALUES ($1, $2::jsonb)`,
            [product.id, JSON.stringify(input.attributes)],
          );
        }
      }

      // --- تصویرها: مجموعه جایگزین می‌شود (تصویر ارجاعی ندارد که بشکند)
      if (input.images) {
        await tx.query(`DELETE FROM product_images WHERE product_id = $1`, [product.id]);
        for (const [index, image] of input.images.entries()) {
          await tx.query(
            `INSERT INTO product_images (product_id, url, alt, role, sort_order)
             VALUES ($1, $2, $3, $4, $5)`,
            [product.id, image.url, image.alt ?? '', image.role ?? 'gallery', index],
          );
        }
      }

      const variantIds: string[] = [];
      const deactivatedVariantIds: string[] = [];
      const priceChanges: PriceChange[] = [];

      if (input.variants) {
        const { rows: existing } = await tx.query<{
          id: string; sku: string; price_rial: string; is_active: boolean;
        }>(
          `SELECT id, sku, price_rial::text, is_active FROM product_variants WHERE product_id = $1`,
          [product.id],
        );
        const existingById = new Map(existing.map((v) => [v.id, v]));
        const keptIds = new Set(input.variants.map((v) => v.id).filter((id): id is string => Boolean(id)));

        for (const variant of input.variants) {
          if (variant.id && existingById.has(variant.id)) {
            // --- تنوعِ موجود: به‌روزرسانی
            const current = existingById.get(variant.id)!;
            const newPrice = variant.priceRial.toString();
            if (current.price_rial !== newPrice) {
              priceChanges.push({
                variantId: variant.id,
                sku: variant.sku || current.sku,
                fromRial: current.price_rial,
                toRial: newPrice,
              });
            }
            await tx.query(
              `UPDATE product_variants
                  SET sku = $2, barcode = $3, attributes = $4::jsonb,
                      price_rial = $5, is_active = $6
                WHERE id = $1`,
              [
                variant.id,
                variant.sku,
                variant.barcode ?? null,
                JSON.stringify(variant.attributes ?? {}),
                newPrice,
                variant.active ?? true,
              ],
            );
            if (variant.active === false) deactivatedVariantIds.push(variant.id);
            else variantIds.push(variant.id);

            // ثبتِ تغییرِ قیمت — حتی اگر فروشنده فقط sku را عوض کرده باشد
            // ولی قیمت همان باشد، recordPriceChange تکراری نمی‌نویسد
            // (تفاوتِ قیمت در priceChanges بالا بررسی شده).
            if (current.price_rial !== newPrice) {
              await recordPriceChange(tx, variant.id, newPrice);
            }
          } else {
            // --- تنوعِ تازه
            const { rows: v } = await tx.query<{ id: string }>(
              `INSERT INTO product_variants (product_id, sku, barcode, attributes, price_rial)
               VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
              [
                product.id,
                variant.sku,
                variant.barcode ?? null,
                JSON.stringify(variant.attributes ?? {}),
                variant.priceRial.toString(),
              ],
            );
            variantIds.push(v[0]!.id);
            await recordPriceChange(tx, v[0]!.id, variant.priceRial);
          }

          // سازگاریِ این تنوع از نو نوشته می‌شود (ساده‌تر و بی‌خطاتر از تفاضل‌گیری)
          const targetId = variant.id && existingById.has(variant.id)
            ? variant.id
            : (await tx.query<{ id: string }>(
                `SELECT id FROM product_variants WHERE product_id = $1 AND sku = $2 LIMIT 1`,
                [product.id, variant.sku],
              )).rows[0]!.id;

          await tx.query(`DELETE FROM product_compatibility WHERE variant_id = $1`, [targetId]);
          for (const modelId of variant.compatibleModelIds ?? []) {
            await tx.query(
              `INSERT INTO product_compatibility (variant_id, device_model_id, confidence)
               VALUES ($1, $2, 'exact') ON CONFLICT DO NOTHING`,
              [targetId, modelId],
            );
          }
        }

        // --- تنوع‌هایی که در فهرستِ تازه نیستند: یا حذف یا غیرفعال
        for (const old of existing) {
          if (keptIds.has(old.id)) continue;
          if (await this.isVariantReferenced(tx, old.id)) {
            await tx.query(`UPDATE product_variants SET is_active = false WHERE id = $1`, [old.id]);
            deactivatedVariantIds.push(old.id);
          } else {
            await tx.query(`DELETE FROM product_compatibility WHERE variant_id = $1`, [old.id]);
            await tx.query(`DELETE FROM product_variants WHERE id = $1`, [old.id]);
          }
        }

        // دست‌کم یک تنوعِ فعال باید بماند؛ وگرنه کالا در فروشگاه دیده می‌شود
        // اما قابلِ خرید نیست — همان تجربه‌ای که مشتری را عصبانی می‌کند
        const { rows: active } = await tx.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM product_variants WHERE product_id = $1 AND is_active = true`,
          [product.id],
        );
        if (Number(active[0]?.n ?? 0) === 0) {
          throw new AppError('VALIDATION', {
            details: { variants: 'کالا باید دست‌کم یک تنوعِ فعال داشته باشد' },
          });
        }
      }

      return {
        id: product.id,
        slug: product.slug,
        title,
        variantIds,
        deactivatedVariantIds,
        priceChanges,
      };
    }));
  }

  /**
   * آیا از این تنوع اثری در جایی مانده است؟
   *
   * اگر بله، حذفِ فیزیکی یعنی شکستنِ تاریخچه: سفارشی که این کالا را خریده
   * دیگر کالایش معلوم نیست و انبار با موجودیِ یتیم روبه‌رو می‌شود.
   */
  private async isVariantReferenced(tx: Queryable, variantId: string): Promise<boolean> {
    const { rows } = await tx.query<{ refs: string }>(
      `SELECT (
         (SELECT COUNT(*) FROM order_items       WHERE variant_id = $1)
       + (SELECT COUNT(*) FROM stock_items       WHERE variant_id = $1)
       + (SELECT COUNT(*) FROM stock_movements   WHERE variant_id = $1)
       + (SELECT COUNT(*) FROM cart_items        WHERE variant_id = $1)
       + (SELECT COUNT(*) FROM purchase_invoice_items WHERE variant_id = $1)
       + (SELECT COUNT(*) FROM inventory_valuation WHERE variant_id = $1)
       )::text AS refs`,
      [variantId],
    );
    return Number(rows[0]?.refs ?? 0) > 0;
  }

  /**
   * فرهنگِ مترادف از پایگاه‌داده — در هر دو جهت.
   *
   * چرا دوطرفه؟ چون اگر فروشنده بنویسد «شارجر → شارژر»، باید هم جستجویِ
   * «شارجر» کالاهایِ «شارژر» را بیاورد و هم برعکس؛ وگرنه نیمی از مسیر
   * ناتمام می‌ماند و همان «نتیجه نداردِ» همیشگی دیده می‌شود.
   */
  private async loadSynonyms(db: Queryable): Promise<Record<string, string[]>> {
    return cachedProbe(db, 'synonyms', SYNONYMS_TTL_MS, () => this.readSynonyms(db));
  }

  /** بی‌اعتبارکردنِ کشِ مترادف‌ها — هر نوشتنِ پنل باید این را صدا بزند */
  static invalidateSynonyms(db: object): void {
    invalidateProbe(db, 'synonyms');
  }

  private async readSynonyms(db: Queryable): Promise<Record<string, string[]>> {
    // جدول ممکن است پیش از مهاجرتِ ۰۰۹ وجود نداشته باشد (تست‌هایِ قدیمی)
    if (!(await hasRelation(db, 'search_synonyms'))) return {};

    const { rows } = await db.query<{ term_key: string; canonical_key: string }>(
      `SELECT term_key, canonical_key FROM search_synonyms WHERE is_active = true`,
    );

    const map: Record<string, Set<string>> = {};
    const add = (from: string, to: string) => {
      map[from] = map[from] ?? new Set<string>();
      map[from].add(to);
    };
    for (const r of rows) {
      add(r.term_key, r.canonical_key);
      add(r.canonical_key, r.term_key);
    }

    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(map)) out[k] = [...v];
    return out;
  }

  /**
   * جستجویِ فارسی با رتبه‌بندی و «نرم‌شدنِ هوشمند».
   *
   * چرا رتبه‌بندی؟ چون بدونِ آن، نتیجه‌ها بر اساسِ «تازه‌ترین» می‌آیند و
   * جستجوی «شارژر آیفون» ممکن است یک قابِ تازه‌ثبت‌شده را بالاتر از شارژرِ
   * درست نشان دهد. رتبه بر اساسِ چهار سیگنال است: انطباقِ کاملِ عبارت،
   * آغاز شدنِ عنوان با عبارت، جایگاهِ واژه در سندِ جستجو، و موجود بودن.
   *
   * چرا «نرم‌شدن»؟ چون اگر مشتری بنویسد «شارژر فندکی آیفون ۱۳» و فروشگاه
   * شارژرِ فندکیِ مخصوصِ آیفون نداشته باشد، پاسخِ «هیچی نیست» بن‌بست است و
   * مشتری می‌رود. اینجا اگر ترکیبِ سخت‌گیرانه («و» میانِ واژه‌ها) هیچ نتیجه‌ای
   * نداشت، یک‌بار با «یا» تلاش می‌کنیم و نتیجه را با نشانِ relaxed برمی‌گردانیم
   * تا صفحه صادقانه بگوید: «همه‌ی واژه‌ها با هم پیدا نشد؛ این‌ها بخشی را دارند».
   */
  async search(opts: {
    query: string;
    deviceModelId?: string | null;
    brandSlug?: string | null;
    typeKey?: string | null;
    /**
     * دسته با زیردسته‌هایش — همان کاری که «کلیک روی یک دسته» باید بکند.
     *
     * چرا جدای از typeKey؟ چون typeKey تنها یک دسته را می‌گیرد. خریداری که
     * روی «شارژر و آداپتور» می‌زند، انتظار دارد شارژرِ دیواری را هم ببیند؛
     * نشان دادنِ پنج کالا در حالی که بیست کالا در زیردسته‌هایِ همان دسته
     * است، خریدار را گمان‌مند می‌کند که «این فروشگاه کالا ندارد».
     */
    typeIds?: string[] | null;
    onlyAvailable?: boolean;
    limit?: number;
    offset?: number;
    /** رنگ‌هایِ خواسته‌شده (نامِ فارسی، همان که در `attributes.color` است) */
    colours?: readonly string[];
    /** فقط کالاهایی که هم‌اکنون تخفیفِ فعال دارند */
    onlyDiscounted?: boolean;
    /** آیا مشتری همکار است؟ قیمت همکاری نمایش داده شود */
    isPartner?: boolean;
    channel?: string;
    log?: boolean;
  }): Promise<{
    items: ProductSummary[];
    total: number;
    normalized: string;
    applied: Array<{ input: string; matched: string[] }>;
    relaxed: boolean;
    tookMs: number;
    /** پاسخ از کشِ سرویس آمد؟ (دیدبانی و آزمونِ بار باید همین را ببینند) */
    cached: boolean;
    /** چند میلی‌ثانیه از ساختِ این پاسخِ کش‌شده گذشته است */
    cacheAgeMs: number;
  }> {
    const startedAt = Date.now();
    const limit = Math.min(opts.limit ?? 24, 100);
    const offset = opts.offset ?? 0;

    /**
     * کشِ پاسخِ پرسش‌هایِ تکراری. سه قاعده که با هم معنا می‌دهند:
     *  • سیاست از پنل است (`search_cache_seconds`) و `0` یعنی خاموش، تا
     *    فروشنده بتواند «قیمتِ تازه همان لحظه» را 요구 کند؛
     *  • آمارِ جستجو رویِ پاسخِ کش‌شده هم نوشته می‌شود، وگرنه
     *    «پرتکرارترینِ عبارت‌ها» دقیقاً همان‌جا ناپدید می‌شوند که ترافیک زیاد
     *    است و گزارشِ «چه کالایی کم داریم؟» دروغ می‌گوید؛
     *  • کلید، فیلترها و صفحه‌بندی را هم می‌بیند، پس «فیلتر زدم و همان نتیجهٔ
     *    قبلی را دیدم» ممکن نیست.
     */
    const policy: SearchCachePolicy = await searchCachePolicy(this.db);
    const cacheKey = searchCacheKey(opts as unknown as Record<string, unknown>);
    const found = cacheGet(this.db, cacheKey, policy);
    if (found.hit) {
      const hitValue = found.value as SearchCachePayload;
      if (opts.log !== false) {
        const entry = {
          raw: opts.query,
          normalized: hitValue.normalized,
          results: hitValue.total,
          channel: opts.channel ?? 'web',
          deviceModelId: opts.deviceModelId ?? null,
        };
        setTimeout(() => {
          void this.logSearch(entry).catch(() => undefined);
        }, 0);
      }
      return {
        items: hitValue.items,
        total: hitValue.total,
        normalized: hitValue.normalized,
        applied: hitValue.applied,
        relaxed: hitValue.relaxed,
        // در این حالت وقتِ سرویس تقریباً صفر است؛ «پرس‌وجو چقدر طول کشید» را
        // باید از cacheAgeMs خواند، نه از عددِ این درخواست
        tookMs: Date.now() - startedAt,
        cached: true,
        cacheAgeMs: Math.max(0, Date.now() - hitValue.builtAt),
      };
    }

    const synonyms = await this.loadSynonyms(this.db);
    const expanded = expandSearchQuery(opts.query, synonyms);
    // سندِ جستجو (مهاجرت ۰۱۰) شاملِ نامِ گوشی‌هایِ سازگار هم هست؛
    // اگر پایگاه‌داده هنوز آن مهاجرت را نداشته باشد، به همان کلیدِ قدیمی برمی‌گردیم.
    const hay = await this.searchHaystack(this.db);

    // عبارتِ قیمت: همکار ← قیمت همکاری (partner_price_rial)، مهمان ← قیمت فروش
    const priceExpr = opts.isPartner
      ? `COALESCE(v.partner_price_rial, v.price_rial)`
      : `v.price_rial`;

    const structural: string[] = [];
    const structuralParams: unknown[] = [];
    let si = 1;

    if (opts.deviceModelId) {
      structural.push(
        `EXISTS (SELECT 1 FROM product_compatibility pc
                   JOIN product_variants v ON v.id = pc.variant_id
                  WHERE v.product_id = p.id AND pc.device_model_id = $${si++} AND v.is_active = true)`,
      );
      structuralParams.push(opts.deviceModelId);
    }
    if (opts.brandSlug) {
      structural.push(`b.slug = $${si++}`);
      structuralParams.push(opts.brandSlug);
    }
    if (opts.typeKey) {
      structural.push(`pt.key = $${si++}`);
      structuralParams.push(opts.typeKey);
    }
    if (opts.typeIds && opts.typeIds.length > 0) {
      structural.push(`pt.id = ANY($${si++}::uuid[])`);
      structuralParams.push(opts.typeIds);
    }
    if (opts.onlyAvailable) {
      structural.push(
        `EXISTS (SELECT 1 FROM stock_items s JOIN product_variants v ON v.id = s.variant_id
                  WHERE v.product_id = p.id AND (s.on_hand - s.reserved) > 0)`,
      );
    }
    if (opts.colours && opts.colours.length > 0) {
      // رنگ در ویژگی‌هایِ **تنوع** است، نه کالا. EXISTS و نه پیوند: با پیوند،
      // کالایی که چند تنوعِ هم‌رنگ دارد چندبار در نتیجه می‌آمد.
      structural.push(
        `EXISTS (SELECT 1 FROM product_variants v
                  WHERE v.product_id = p.id AND v.is_active = true
                    AND v.attributes->>'color' = ANY($${si++}::text[]))`,
      );
      structuralParams.push(opts.colours as string[]);
    }
    if (opts.onlyDiscounted) {
      // تخفیف رویِ کالاست (نه تنوع) و تنها در بازه‌یِ تاریخ معتبر است — همان
      // قاعده‌یِ pricing.ts. اگر اینجا از نو نوشته نشود، فهرست کالایی را
      // «تخفیف‌دار» نشان می‌دهد که در سبد هیچ تخفیفی نمی‌گیرد.
      structural.push(
        `((p.discount_percent IS NOT NULL AND p.discount_percent > 0)
           OR (p.discount_amount_rial IS NOT NULL AND p.discount_amount_rial > 0))`,
      );
      structural.push(`(p.discount_starts_at IS NULL OR p.discount_starts_at <= now())`);
      structural.push(`(p.discount_ends_at IS NULL OR p.discount_ends_at >= now())`);
    }

    /**
     * اجرایِ یک پرس‌وجو.
     * @param joiner «و» (سخت‌گیرانه: همه‌ی واژه‌ها) یا «یا» (نرم: هر کدام)
     */
    const run = async (joiner: ' AND ' | ' OR ') => {
      const conditions = [`p.status = 'active'`, ...structural];
      const params: unknown[] = [...structuralParams];
      let i = structuralParams.length + 1;

      if (expanded.groups.length) {
        const groupSql = expanded.groups
          .map((group) => {
            const alts = group
              .map((alt) => {
                params.push(`%${alt}%`);
                return `${hay} LIKE $${i++}`;
              })
              .join(' OR ');
            return `(${alts})`;
          })
          .join(joiner);
        conditions.push(groupSql);
      }

      // --- رتبه‌بندی: هرچه واژه زودتر در سندِ جستجو بیاید، امتیاز بیشتر
      const scoreParts: string[] = [];
      if (expanded.normalized) {
        params.push(expanded.normalized);
        scoreParts.push(`(CASE WHEN ${hay} = $${i++} THEN 100 ELSE 0 END)`);
        params.push(`${expanded.normalized}%`);
        scoreParts.push(`(CASE WHEN ${hay} LIKE $${i++} THEN 40 ELSE 0 END)`);
      }
      for (const group of expanded.groups) {
        // برای هر واژه، بهترین جایگاه در میانِ واژه‌هایِ هم‌معنی
        const perAlt = group.map((alt) => {
          params.push(alt);
          return `(CASE WHEN position($${i++} in ${hay}) > 0
                        THEN 12 - LEAST(position($${i - 1} in ${hay}), 10) ELSE 0 END)`;
        });
        if (perAlt.length) scoreParts.push(`GREATEST(${perAlt.join(', ')})`);
      }
      // موجود بودن: کالایی که هست، بالاتر از کالایی که نیست
      scoreParts.push(
        `(CASE WHEN EXISTS (SELECT 1 FROM stock_items s JOIN product_variants v ON v.id = s.variant_id
                            WHERE v.product_id = p.id AND (s.on_hand - s.reserved) > 0) THEN 8 ELSE 0 END)`,
      );
      // کالایی که «همه‌ی» واژه‌ها را دارد، بالاتر از کالایی که بخشی را دارد
      if (joiner === ' OR ') {
        const all = expanded.groups
          .map((group) => {
            const alts = group
              .map((alt) => {
                params.push(`%${alt}%`);
                return `CASE WHEN ${hay} LIKE $${i++} THEN 1 ELSE 0 END`;
              })
              // با کاما نه با OR: هر عبارت عدد است (۰ یا ۱) و OR فقط برای منطق است
              .join(', ');
            // هر واژه ۰ یا ۱ می‌گیرد؛ بهترینِ آن‌ها نماینده‌ی گروه است
            return `GREATEST(${alts})`;
          })
          .join(' + ');
        if (all) scoreParts.push(`(${all}) * 30`);
      }
      const scoreSql = scoreParts.length ? scoreParts.join(' + ') : '0';

      const { rows } = await this.db.query<ProductSummary & { total_count: string; score: number }>(
        `SELECT p.id, p.title, p.slug, p.status, b.name AS "brandName", pt.key AS "typeKey",
                (SELECT MIN(${priceExpr}) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = true) AS "minPriceRial",
                -- شناسه‌ی ارزان‌ترین تنوعِ فعال: کارتِ کالا با آن «افزودن به سبدِ
                -- سریع» را بی‌نیاز از یک درخواستِ دیگر انجام می‌دهد
                (SELECT v.id FROM product_variants v WHERE v.product_id = p.id AND v.is_active = true
                  ORDER BY ${priceExpr} LIMIT 1) AS "defaultVariantId",
                (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id)::int AS "variantCount",
                -- تصویرِ نماینده: «اصلی» مقدم است (وگرنه فهرست، تصویری را نشان
                -- می‌دهد که فروشنده برایِ نمایش برنگزیده)
                img.url AS "imageUrl",
                COALESCE(img.url_card, img.url) AS "imageCardUrl",
                img.placeholder AS "imagePlaceholder",
                -- «جدید»: اگر هر تنوعی هنوز در بازه‌یِ نوآمدگی باشد
                EXISTS (SELECT 1 FROM product_variants v
                         WHERE v.product_id = p.id AND v.is_active = true
                           AND v.is_new_until IS NOT NULL AND v.is_new_until >= now()) AS "isNew",
                -- تخفیفِ جاری: همان شرط، این‌بار برایِ نمایش رویِ کارت
                (CASE WHEN (p.discount_starts_at IS NULL OR p.discount_starts_at <= now())
                        AND (p.discount_ends_at IS NULL OR p.discount_ends_at >= now())
                      THEN p.discount_percent END)::int AS "discountPercent",
                (CASE WHEN (p.discount_starts_at IS NULL OR p.discount_starts_at <= now())
                        AND (p.discount_ends_at IS NULL OR p.discount_ends_at >= now())
                      THEN p.discount_amount_rial END)::text AS "discountAmountRial",
                -- موجودیِ قابلِ فروش: برایِ برچسبِ «تنها ۳ عدد مانده»
                COALESCE((SELECT SUM(s.on_hand - s.reserved) FROM stock_items s
                           JOIN product_variants v ON v.id = s.variant_id
                          WHERE v.product_id = p.id AND v.is_active = true), 0)::int AS "availableQty",
                -- رنگ‌ها: برایِ سواچِ رویِ کارت و برایِ فیلترِ رنگ
                COALESCE((SELECT array_agg(DISTINCT v.attributes->>'color')
                            FROM product_variants v
                           WHERE v.product_id = p.id AND v.is_active = true
                             AND v.attributes->>'color' IS NOT NULL),
                         ARRAY[]::text[]) AS "colours",
                (${scoreSql}) AS "score",
                COUNT(*) OVER() AS total_count
           FROM products p
           LEFT JOIN LATERAL (
             SELECT pi.url, pi.url_card, pi.placeholder
               FROM product_images pi
              WHERE pi.product_id = p.id
              ORDER BY (pi.role = 'main') DESC, pi.sort_order
              LIMIT 1
           ) img ON true
           LEFT JOIN brands b ON b.id = p.brand_id
           JOIN product_types pt ON pt.id = p.type_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY "score" DESC, p.created_at DESC
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      );

      return {
        items: rows.map(({ total_count: _c, score: _s, ...rest }) => rest as unknown as ProductSummary),
        total: rows.length ? Number(rows[0]!.total_count) : 0,
      };
    };

    // ۱) تلاشِ سخت‌گیرانه: همه‌ی واژه‌ها با هم
    let result = await run(' AND ');
    let relaxed = false;

    // ۲) اگر هیچ نتیجه‌ای نبود و بیش از یک واژه داشتیم، تلاشِ نرم: هر کدام
    if (result.total === 0 && expanded.groups.length > 1) {
      const soft = await run(' OR ');
      if (soft.total > 0) {
        result = soft;
        relaxed = true;
      }
    }

    const tookMs = Date.now() - startedAt;

    // --- ثبتِ جستجو: «جستجوی بی‌نتیجه» گران‌بهاترین داده‌یِ فروشگاه است،
    // چون تقاضایی را نشان می‌دهد که پاسخ نگرفته. ثبت، جدای از پاسخ انجام
    // می‌شود تا هیچ‌گاه پاسخ را کُند یا شکست‌خورده نکند.
    if (opts.log !== false) {
      // چرا با تأخیرِ صفر و نه فراخوانیِ مستقیم؟ چون در پایگاه‌داده‌ی تک‌اتصال
      // (مثل PGlite در آزمون‌ها) فرستادنِ یک پرس‌وجو در میانه‌ی پرس‌وجویِ دیگر
      // گیر می‌کند. با انداختن به چرخه‌ی بعد، پرس‌وجویِ اصلی کاملاً تمام شده است
      // و ثبت، هیچ‌گاه پاسخ را کُند یا شکست‌خورده نمی‌کند.
      const entry = {
        raw: opts.query,
        normalized: expanded.normalized,
        results: result.total,
        channel: opts.channel ?? 'web',
        deviceModelId: opts.deviceModelId ?? null,
      };
      setTimeout(() => {
        void this.logSearch(entry).catch(() => undefined);
      }, 0);
    }

    cachePut(
      this.db,
      cacheKey,
      {
        items: result.items,
        total: result.total,
        normalized: expanded.normalized,
        applied: expanded.applied,
        relaxed,
        builtAt: Date.now(),
      } satisfies SearchCachePayload,
      policy,
    );

    return {
      items: result.items,
      total: result.total,
      normalized: expanded.normalized,
      applied: expanded.applied,
      relaxed,
      tookMs,
      cached: false,
      cacheAgeMs: 0,
    };
  }

  /** ستونی که متن روی آن جستجو می‌شود — با مهاجرتِ ۰۱۰ غنی‌تر شده است */
  private haystackCache = new WeakMap<object, string>();

  private async searchHaystack(db: Queryable | Database): Promise<string> {
    const cached = this.haystackCache.get(db as object);
    if (cached) return cached;
    const { rows } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'products' AND column_name = 'search_document'`,
    );
    const value = Number(rows[0]?.n ?? '0') > 0 ? 'p.search_document' : 'p.search_key';
    this.haystackCache.set(db as object, value);
    return value;
  }

  /**
   * ثبتِ یک جستجو در جدولِ search_queries.
   * عمومی است تا آزمون‌ها بتوانند آن را مستقیماً (و قطعی) فراخوانی کنند،
   * بی‌آنکه منتظرِ رفتارِ ناهمزمان بمانند.
   */
  async logSearch(entry: {
    raw: string;
    normalized: string;
    results: number;
    channel: string;
    deviceModelId: string | null;
  }): Promise<void> {
    if (!(await hasRelation(this.db, 'search_queries'))) return;

    await this.db.query(
      `INSERT INTO search_queries (raw, normalized, results, channel, device_model_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [entry.raw.slice(0, 200), entry.normalized.slice(0, 200), entry.results, entry.channel, entry.deviceModelId],
    );
  }

  /** فهرست با فیلترهای فروشگاه — از جمله مهم‌ترین فیلتر: مدلِ گوشی */
  async list(opts: {
    deviceModelId?: string | null;
    brandSlug?: string | null;
    typeKey?: string | null;
    query?: string | null;
    onlyAvailable?: boolean;
    limit?: number;
    offset?: number;
    channel?: string;
    /**
     * فقط کالاهایی که «همین حالا» تخفیف دارند (در بازه‌یِ زمانیِ فعال).
     * چرا در پایگاه و نه در حافظه؟ چون بازه‌یِ تخفیف وابسته به زمانِ حال
     * است؛ اگر در حافظه فیلتر می‌شد، فهرستِ ۱۲ تایی پس از فیلتر ممکن بود
     * خالی بماند در حالی که سی کالایِ تخفیف‌دار در پایگاه هست.
     */
    discounted?: boolean;
    /** رنگ‌هایِ خواسته‌شده (نامِ فارسیِ `attributes.color`) */
    colours?: readonly string[];
    /** مرتب‌سازی: پرفروشِ ۱۴ روزِ اخیر، تازه‌ترین، یا ارزان‌ترین */
    sort?: 'trending' | 'newest' | 'cheapest';
    /** آیا مشتری همکار است؟ قیمت همکاری نمایش داده شود */
    isPartner?: boolean;
  } = {}): Promise<{ items: ProductSummary[]; total: number }> {
    // هرگاه عبارتی هست، از موتورِ جستجو (با مترادف و رتبه‌بندی) استفاده کن
    if (opts.query && opts.query.trim().length > 0) {
      const result = await this.search({ ...opts, query: opts.query });
      return { items: result.items, total: result.total };
    }

    const limit = Math.min(opts.limit ?? 24, 100);
    const offset = opts.offset ?? 0;

    // عبارتِ قیمت: همکار ← قیمت همکاری، مهمان ← قیمت فروش
    const priceExpr = opts.isPartner
      ? `COALESCE(v.partner_price_rial, v.price_rial)`
      : `v.price_rial`;

    const conditions = [`p.status = 'active'`];
    const params: unknown[] = [];
    let i = 1;

    if (opts.deviceModelId) {
      conditions.push(
        `EXISTS (SELECT 1 FROM product_compatibility pc
                   JOIN product_variants v ON v.id = pc.variant_id
                  WHERE v.product_id = p.id AND pc.device_model_id = $${i++} AND v.is_active = true)`,
      );
      params.push(opts.deviceModelId);
    }
    if (opts.brandSlug) {
      conditions.push(`b.slug = $${i++}`);
      params.push(opts.brandSlug);
    }
    if (opts.typeKey) {
      conditions.push(`pt.key = $${i++}`);
      params.push(opts.typeKey);
    }
    if (opts.query) {
      // جستجوی واژه‌محور: همه‌ی واژه‌ها باید حاضر باشند (AND)، در هر جایِ متن.
      // جستجوی «رشته‌ی پیوسته» کار نمی‌کند چون واژه‌ها در عنوان پراکنده‌اند.
      const tokens = searchKey(opts.query).split(' ').filter((t) => t.length > 1);
      if (tokens.length) {
        const orAnd = tokens.map(() => `p.search_key LIKE $${i++}`).join(' AND ');
        conditions.push(`(${orAnd})`);
        params.push(...tokens.map((t) => `%${t}%`));
      }
    }
    if (opts.onlyAvailable) {
      conditions.push(
        `EXISTS (SELECT 1 FROM stock_items s JOIN product_variants v ON v.id = s.variant_id
                  WHERE v.product_id = p.id AND (s.on_hand - s.reserved) > 0)`,
      );
    }
    if (opts.discounted) {
      // بازه‌یِ تاریخِ تخفیف باید «اکنون» را دربر بگیرد (BR-03)
      conditions.push(
        `((p.discount_percent IS NOT NULL AND p.discount_percent > 0)
           OR (p.discount_amount_rial IS NOT NULL AND p.discount_amount_rial > 0))
         AND (p.discount_starts_at IS NULL OR p.discount_starts_at <= now())
         AND (p.discount_ends_at  IS NULL OR p.discount_ends_at  >= now())`,
      );
    }
    if (opts.colours && opts.colours.length > 0) {
      // رنگ در ویژگی‌هایِ **تنوع** است، نه کالا. EXISTS (و نه پیوند) تا کالایی
      // که چند تنوعِ هم‌رنگ دارد، چندبار در فهرست نیاید.
      conditions.push(
        `EXISTS (SELECT 1 FROM product_variants v
                  WHERE v.product_id = p.id AND v.is_active = true
                    AND v.attributes->>'color' = ANY($${i++}::text[]))`,
      );
      params.push(opts.colours as string[]);
    }

    // --- مرتب‌سازی
    //
    // «پرفروشِ ۱۴ روزِ اخیر» از رویِ ردیف‌هایِ سفارشِ پرداخت‌شده حساب می‌شود،
    // نه از یک ستونِ دستی. اگر در این بازه فروشی نبود (فروشگاهِ تازه)،
    // مرتب‌سازی به «تازه‌ترین» برمی‌گردد تا ریل هیچ‌وقت خالی یا گمراه‌کننده
    // نباشد: ترتیبی که هیچ مبنایی ندارد نباید «ترند» نامیده شود.
    const sort = opts.sort ?? 'newest';
    const orderBy =
      sort === 'trending'
        ? `(SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi
              JOIN orders o ON o.id = oi.order_id
             WHERE oi.variant_id IN (SELECT v.id FROM product_variants v WHERE v.product_id = p.id)
               AND o.paid_at IS NOT NULL
               AND o.paid_at >= now() - interval '14 days') DESC,
            p.created_at DESC`
        : sort === 'cheapest'
          ? `(SELECT MIN(${priceExpr}) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = true) ASC, p.created_at DESC`
          : `p.created_at DESC`;


    const where = conditions.join(' AND ');
    const { rows } = await this.db.query<ProductSummary & { total_count: string }>(
      `SELECT p.id, p.title, p.slug, p.status, b.name AS "brandName", pt.key AS "typeKey",
              (SELECT MIN(${priceExpr}) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = true) AS "minPriceRial",
              (SELECT v.id FROM product_variants v WHERE v.product_id = p.id AND v.is_active = true
                ORDER BY ${priceExpr} LIMIT 1) AS "defaultVariantId",
              (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id)::int AS "variantCount",
              img.url AS "imageUrl",
              COALESCE(img.url_card, img.url) AS "imageCardUrl",
              img.placeholder AS "imagePlaceholder",
              -- «جدید»: اگر هر تنوعی هنوز در بازه‌یِ نوآمدگی باشد
              EXISTS (SELECT 1 FROM product_variants v
                       WHERE v.product_id = p.id AND v.is_active = true
                         AND v.is_new_until IS NOT NULL AND v.is_new_until >= now()) AS "isNew",
              -- تخفیفِ جاری: همان شرط، این‌بار برایِ نمایش رویِ کارت
              (CASE WHEN (p.discount_starts_at IS NULL OR p.discount_starts_at <= now())
                      AND (p.discount_ends_at IS NULL OR p.discount_ends_at >= now())
                    THEN p.discount_percent END)::int AS "discountPercent",
              (CASE WHEN (p.discount_starts_at IS NULL OR p.discount_starts_at <= now())
                      AND (p.discount_ends_at IS NULL OR p.discount_ends_at >= now())
                    THEN p.discount_amount_rial END)::text AS "discountAmountRial",
              -- موجودیِ قابلِ فروش: برایِ برچسبِ «تنها ۳ عدد مانده»
              COALESCE((SELECT SUM(s.on_hand - s.reserved) FROM stock_items s
                         JOIN product_variants v ON v.id = s.variant_id
                        WHERE v.product_id = p.id AND v.is_active = true), 0)::int AS "availableQty",
              -- رنگ‌ها: برایِ سواچِ رویِ کارت و برایِ فیلترِ رنگ
              COALESCE((SELECT array_agg(DISTINCT v.attributes->>'color')
                          FROM product_variants v
                         WHERE v.product_id = p.id AND v.is_active = true
                           AND v.attributes->>'color' IS NOT NULL),
                       ARRAY[]::text[]) AS "colours",
              COUNT(*) OVER() AS total_count
         FROM products p
         LEFT JOIN LATERAL (
           SELECT pi.url, pi.url_card, pi.placeholder
             FROM product_images pi
            WHERE pi.product_id = p.id
            ORDER BY (pi.role = 'main') DESC, pi.sort_order
            LIMIT 1
         ) img ON true
         LEFT JOIN brands b ON b.id = p.brand_id
         JOIN product_types pt ON pt.id = p.type_id
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    const total = rows.length ? Number(rows[0]!.total_count) : 0;
    return { items: rows.map(({ total_count, ...rest }) => rest as unknown as ProductSummary), total };
  }

  /**
   * برندهایِ دارایِ کالایِ فعال، همراه با شمارش.
   *
   * چرا شمارش؟ چون دیدنِ «انکر (۱۲)» کنارِ نامِ برند به مشتری می‌گوید کلیک
   * روی این برند به بن‌بست نمی‌رسد؛ برندی با صفر کالا در فهرست نمی‌آید،
   * پس نیازی به غیرفعال‌کردنِ دستیِ چیزی نیست.
   */
  /**
   * فهرستِ برندها برایِ فیلتر — کش‌شده (سیاستِ مشترکِ `search_cache_seconds`).
   *
   * شمارِ هر برند رویِ `products` حساب می‌شود؛ یعنی هر بار که صفحه‌ای باز
   * شود، کلِ میزِ کالا تراورس شده است — فقط برایِ چند نامِ برند. نوشتنِ هر
   * کالا (ساخت/ویرایش/حذف/تغییرِ وضعیت) کش را می‌شکند (`afterCatalogChange`)،
   * پس «برند کهنه» ممکن نیست.
   */
  async brands(): Promise<{ items: Array<{ slug: string; name: string; count: number }>; cached: boolean; cacheAgeMs: number }> {
    return cachedList(this.db, searchCacheKey({ list: 'brands' }), async () => {
      const { rows } = await this.db.query<{ slug: string; name: string; count: number }>(
        `SELECT b.slug, b.name, COUNT(DISTINCT p.id)::int AS count
           FROM brands b
           JOIN products p ON p.brand_id = b.id AND p.status = 'active'
          GROUP BY b.slug, b.name
         HAVING COUNT(DISTINCT p.id) > 0
          ORDER BY COUNT(DISTINCT p.id) DESC, b.name`,
      );
      return rows;
    });
  }

  /**
   * رنگ‌هایِ واقعاً موجودِ فروشگاه — برایِ فیلترِ رنگِ صفحه‌یِ جستجو و فهرست.
   *
   * چرا یک پرس‌وجویِ جدا؟ چون صفحه‌یِ جستجو برایِ به دست آوردنِ همین فهرست،
   * «صد کالا» را با تنوع‌ها و تصویرها و برچسب‌هایشان می‌خواند و در جاوااسکریپت
   * صاف می‌کرد: گران‌ترینِ کارِ بی‌فایده‌یِ صفحه. این پرس‌وجو یک ستونِ jsonb را
   * DISTINCT می‌کند و هیچ چیزِ دیگری نمی‌خواند.
   *
   * چرا «رنگ‌هایِ کالاهایِ فعال» و نه همه‌یِ تنوع‌ها؟ چون رنگی که تنها رویِ کالایِ
   * غیرفعال باشد، فیلتری می‌سازد که نتیجه‌اش همیشه خالی است.
   */
  async availableColours(): Promise<{ items: string[]; cached: boolean; cacheAgeMs: number }> {
    return cachedList(this.db, searchCacheKey({ list: 'colours' }), async () => {
      const { rows } = await this.db.query<{ colour: string }>(
        `SELECT DISTINCT v.attributes->>'color' AS colour
           FROM product_variants v
           JOIN products p ON p.id = v.product_id
          WHERE v.is_active = true
            AND p.status = 'active'
            AND v.attributes->>'color' IS NOT NULL
            AND v.attributes->>'color' <> ''
          ORDER BY colour`,
      );
      return rows.map((r) => r.colour);
    });
  }

  /**
   * مقایسه‌یِ تا چهار کالا (برگه‌یِ /compare). منطق در compare.ts است؛ این روش
   * فقط پایگاه را می‌دهد تا فراخوانندگان همچنان کاتالوگ را یک درِ واحد ببینند.
   */
  compare(slugs: string[]) {
    return compareProducts(this.db, slugs);
  }

  /**
   * تاریخچهٔ قیمتِ یک کالا — آخرین ۳۰ نقطهٔ قیمت (روزانه).
   * نقطه‌های تکراریِ یک روز به ارزان‌ترین فشرده می‌شوند.
   */
  priceHistory(slug: string, limit = 30) {
    return priceHistoryFn(this.db, slug, limit);
  }

  async getBySlug(slug: string): Promise<Record<string, unknown> | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT p.id, p.title, p.slug, p.description, p.status, b.name AS brand, pt.key AS type
         FROM products p
         LEFT JOIN brands b ON b.id = p.brand_id
         JOIN product_types pt ON pt.id = p.type_id
        WHERE p.slug = $1`,
      [slug],
    );
    const product = rows[0];
    if (!product) return null;

    const { rows: variants } = await this.db.query<Record<string, unknown>>(
      `SELECT v.id, v.sku, v.attributes, v.price_rial, v.is_active,
              (SELECT COALESCE(SUM(s.on_hand - s.reserved), 0) FROM stock_items s WHERE s.variant_id = v.id)::int AS available
         FROM product_variants v WHERE v.product_id = $1 ORDER BY v.price_rial`,
      [product.id as string],
    );

    const { rows: images } = await this.db.query<Record<string, unknown>>(
      `SELECT url, alt, role, sort_order FROM product_images WHERE product_id = $1 ORDER BY sort_order`,
      [product.id as string],
    );

    const { rows: compat } = await this.db.query<Record<string, unknown>>(
      `SELECT DISTINCT db.name AS brand, dm.id, dm.name AS model
         FROM product_compatibility pc
         JOIN product_variants v ON v.id = pc.variant_id
         JOIN device_models dm ON dm.id = pc.device_model_id
         JOIN device_brands db ON db.id = dm.brand_id
        WHERE v.product_id = $1
        ORDER BY db.name, dm.name`,
      [product.id as string],
    );

    // ویژگی‌هایِ کالا (جنس، توان، طول …) در جدولی جدا است؛ برگه‌یِ کالا
    // برایِ تبِ «مشخصات» به آن‌ها نیاز دارد. نبودشان یعنی آن تب هیچ چیزی
    // برای گفتن ندارد جز چیزی که رویِ تنوع‌ها است.
    const { rows: attrRows } = await this.db.query<{ values: Record<string, unknown> }>(
      `SELECT values FROM product_attributes WHERE product_id = $1`,
      [product.id],
    );

    return {
      ...product,
      attributes: attrRows[0]?.values ?? {},
      variants,
      images,
      compatibleDevices: compat,
    };
  }

  /** تعیینِ سازگاری برای نمایشِ نشانِ «ست می‌شود» روی کارت کالا */
  async isCompatibleWith(productId: string, deviceModelId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM product_compatibility pc
           JOIN product_variants v ON v.id = pc.variant_id
          WHERE v.product_id = $1 AND pc.device_model_id = $2
       ) AS ok`,
      [productId, deviceModelId],
    );
    return rows[0]?.ok ?? false;
  }
}

export function slugify(input: string): string {
  const base = searchKey(input)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || newId('prd');
}
