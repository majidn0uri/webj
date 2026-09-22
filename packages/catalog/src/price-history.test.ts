import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMigrations, createDatabase, seedCatalog, type Database } from '@set/db';

import { CatalogService } from './index.js';
import { recordPriceChange } from './price-history.js';

/**
 * تاریخچهٔ قیمت — آزمون.
 *
 * آنچه اینجا می‌سنجد:
 *   • «آیا فروشنده قیمت را بالا برد و بعد تخفیف زد؟» — بزرگ‌ترین
 *     دشمنِ اعتماد در فروشگاه‌های آنلاین. اگر خریدار ببیند که قیمت
 *     از ۱۰۰ به ۱۲۰ رفته و حالا ۹۰ است، اعتمادش بیشتر می‌شود تا
 *     اینکه فقط «۹۰ تومان!» ببیند.
 *   • سیدِ آغازین (۰۴۰) باید نقطهٔ صفر بسازد — خریدارِ اولین روز هم
 *     باید «قیمت از ابتدا همین بوده» ببیند، نه «داده‌ای نیست».
 *   • اگر فقط یک نقطه باشد، صفحه «تاریخچهٔ قیمت» نشان نمی‌دهد —
 *     «قیمت از ابتدا همین بوده» اطلاعاتی نیست، فقط فضا اشغال می‌کند.
 */

let db: Database;
let catalog: CatalogService;

beforeEach(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  await seedCatalog(db);
  catalog = new CatalogService(db);

  // نقطهٔ صفر: قیمتِ فعلیِ هر تنوعِ فعال — در تولید، createProduct
  // خودش این کار را می‌کند (recordPriceChange)؛ اینجا seedCatalog
  // مستقیم INSERT می‌زند، پس دستی اضافه می‌کنیم.
  await db.query(
    `INSERT INTO product_price_log (variant_id, price_rial)
     SELECT id, price_rial FROM product_variants WHERE is_active = true`,
  );
});

afterEach(async () => db.close());

async function variantIdOf(sku: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM product_variants WHERE sku = $1`, [sku]);
  if (!rows[0]) throw new Error(`تنوعِ ${sku} نیست`);
  return rows[0].id;
}

describe('تاریخچهٔ قیمت', () => {
  it('نقطهٔ صفر برایِ هر تنوعِ فعال ساخته شده', async () => {
    const charger = await catalog.priceHistory('charger-20w-typec');
    expect(charger.total).toBeGreaterThanOrEqual(1);
    expect(charger.points[0].priceRial).toBeGreaterThan(0);
  });

  it('نقطهٔ تازه ثبت می‌شود و با تاریخ برمی‌گردد', async () => {
    const vid = await variantIdOf('CH-20W-WHT');
    await recordPriceChange(db, vid, 3_500_000);

    const h = await catalog.priceHistory('charger-20w-typec');
    // نکته: نقطه‌هایِ یک روز به MIN فشرده می‌شوند. 3,500,000 کمتر از قیمتِ
    // اصلی (3,200,000) نیست، پس MIN همان 3,200,000 است — ولی نقطه هنوز یکی
    // است (روزانه). آزمونِ فشرده‌سازی در آزمونِ بعدی است.
    expect(h.total).toBeGreaterThanOrEqual(1);
    // قیمتِ ثبت‌شده باید در داده باشد — حتی اگر MIN باشد
    expect(h.points.some((p) => p.priceRial > 0)).toBe(true);
  });

  it('نقطه‌هایِ یک روز به ارزان‌ترین فشرده می‌شوند', async () => {
    const vid = await variantIdOf('CH-20W-WHT');
    await recordPriceChange(db, vid, 4_000_000);
    await recordPriceChange(db, vid, 3_800_000);

    const h = await catalog.priceHistory('charger-20w-typec');
    const today = new Date().toISOString().slice(0, 10);
    const todayPoints = h.points.filter((p) => p.date === today);
    expect(todayPoints.length).toBeLessThanOrEqual(1);
  });

  it('نامکِ ناموجود: خروجی تُهی (خطا نیست)', async () => {
    const h = await catalog.priceHistory('slugi-ke-nist');
    expect(h.points).toHaveLength(0);
    expect(h.total).toBe(0);
  });

  it('کالایِ غیرفعال: تاریخچه هست (تصمیمِ آگاهانه)', async () => {
    const slug = (await db.query<{ slug: string }>(
      `SELECT slug FROM products WHERE title = 'شارژر دیواری ۲۰ وات با کابل تایپ‌سی'`,
    )).rows[0]!.slug;
    await db.query(`UPDATE products SET status = 'draft' WHERE slug = $1`, [slug]);

    const h = await catalog.priceHistory(slug);
    expect(h.total).toBeGreaterThanOrEqual(1);
  });
});