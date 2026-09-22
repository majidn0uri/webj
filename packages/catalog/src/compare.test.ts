import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMigrations, createDatabase, seedCatalog, type Database } from '@set/db';

import { CatalogService } from './index.js';
import { compare, COMPARE_MAX } from './compare.js';

/**
 * مقایسه‌یِ کالا — آزمونِ منطق.
 *
 * آنچه اینجا می‌سنجد «یک جدولِ HTML» نیست؛ مرزهایی است که اگر نادرست شوند،
 * خریدار عددِ دروغ می‌بیند یا تصمیمِ نادرست می‌گیرد:
 *
 *   • ترتیبِ ستون‌ها مالِ خریدار است (نه پایگاه) — ستونِ نخست، انتخابِ او است؛
 *   • «ارزان‌ترین» یعنی ارزان‌ترین تنوعِ **فعال**، نه ردیفِ اول؛
 *   • مشخصاتِ متغیر: هر کالا ویژگی‌هایِ خودش را دارد و جایِ خالی «null» است؛
 *   • امتیاز فقط از نظراتِ **منتشرشده** می‌آید — نظرِ در صفِ بررسی نباید
 *     تصمیم را آلوده کند؛
 *   • کالایِ غیرفعال یا ناموجود وارد مقایسه نمی‌شود.
 *
 * نامک‌هایِ کالاهایِ نمونه (از seedCatalog) مستقیم نوشته شده‌اند تا آزمون
 * به شکلِ ظاهریِ عنوان وابسته نباشد.
 */

const CHARGER = 'charger-20w-typec';
const CASE = 'case-silicon-matte';
const CABLE = 'cable-typec-1m';
const GLASS = 'glass-ceramic-9h';
const POWERBANK = 'powerbank-20000';

let db: Database;
let catalog: CatalogService;

beforeEach(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  await seedCatalog(db);
  catalog = new CatalogService(db);
});

afterEach(async () => db.close());

async function idOf(slug: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM products WHERE slug = $1`, [slug]);
  if (!rows[0]) throw new Error(`کالایِ نمونه با نامکِ ${slug} نیست`);
  return rows[0].id;
}

async function warehouseId(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM warehouses LIMIT 1`);
  return rows[0]!.id;
}

/** کالایِ تازه با ویژگی — برایِ آزمونِ «متحِدِ کلیدها» */
async function makeExtra(title: string, attrs: Record<string, unknown>, priceRial: bigint): Promise<string> {
  const created = await catalog.createProduct({
    title,
    description: 'برایِ آزمونِ مقایسه',
    typeKey: 'case-silicone',
    brandSlug: 'nillkin',
    attributes: attrs,
    variants: [{ sku: `CMP-${title}`, priceRial, attributes: {} }],
  });
  return created.slug;
}

describe('مقایسه‌یِ کالا', () => {
  it('دو کالا به **ترتیبِ درخواست** می‌آیند، نه به ترتیبِ پایگاه', async () => {
    const r1 = await compare(db, [CABLE, CHARGER]);
    expect(r1.products.map((p) => p.slug)).toEqual([CABLE, CHARGER]);

    // معکوسِ درخواست، معکوسِ ستون‌ها
    const r2 = await compare(db, [CHARGER, CABLE]);
    expect(r2.products.map((p) => p.slug)).toEqual([CHARGER, CABLE]);
  });

  it('قیمت، ارزان‌ترین تنوعِ فعال است (نه ردیفِ اولِ جدول) و موجودی جمعِ همهٔ تنوع‌هاست', async () => {
    const id = await idOf(CASE);
    const wh = await warehouseId();
    // دو تنوعِ تازه با قیمت‌هایِ معکوسِ ترتیبِ درج (uuid واقعی — ستونِ id uuid است)
    await db.query(
      `INSERT INTO product_variants (id, product_id, sku, price_rial, is_active, attributes, sort_order)
       VALUES (gen_random_uuid(), $1, 'CMP-CHEAP', 500000, true, '{}'::jsonb, 1),
              (gen_random_uuid(), $1, 'CMP-DEAR', 900000, true, '{}'::jsonb, 2)`,
      [id],
    );
    await db.query(
      `INSERT INTO stock_items (variant_id, warehouse_id, on_hand)
       SELECT v.id, $1, s.qty FROM product_variants v
         JOIN (VALUES ('CMP-CHEAP', 3), ('CMP-DEAR', 1)) AS s(sku, qty) ON s.sku = v.sku
        WHERE v.product_id = $2`,
      [wh, id],
    );

    const r = await compare(db, [CASE, GLASS]);
    expect(r.products[0].minPriceRial).toBe(500000);
    expect(r.products[0].available).toBeGreaterThan(3); // دست‌کم موجودیِ دو تنوعِ تازه
  });

  it('نامکِ تکراری یکی می‌شود و بیش از چهار کالا، چهارتایِ نخست', async () => {
    const r = await compare(db, [CHARGER, CHARGER, CABLE, CASE, GLASS, POWERBANK]);
    expect(r.products.map((p) => p.slug)).toEqual([CHARGER, CABLE, CASE, GLASS]);
    expect(COMPARE_MAX).toBe(4);
  });

  it('نامکِ ناموجود ساقط می‌شود؛ اگر کمتر از دو بماند، خروجی تُهی (خطا نیست)', async () => {
    const one = await compare(db, [CHARGER, 'slugi-ke-nist']);
    expect(one.products).toHaveLength(1);

    const none = await compare(db, ['slug-1', 'slug-2']);
    expect(none.products).toHaveLength(0);
    expect(none.specRows).toHaveLength(0);
  });

  it('کالایِ غیرفعال (draft) وارد مقایسه نمی‌شود', async () => {
    const slug = await makeExtra('قابِ آزمونِ مقایسه', { material: 'سیلیکون' }, 1_000_000n);
    await db.query(`UPDATE products SET status = 'draft' WHERE slug = $1`, [slug]);

    const r = await compare(db, [slug, GLASS]);
    expect(r.products.map((p) => p.slug)).not.toContain(slug);
    expect(r.products).toHaveLength(1);
  });

  it('متحِدِ کلیدهایِ مشخصات: ترتیبِ نخست‌دید، و جایِ خالی null', async () => {
    const extra = await makeExtra('قابِ آزمونِ ویژگی', { material: 'سیلیکون مایع', weight_g: 28 }, 1_200_000n);

    // کلیدهایِ «قابِ آزمون» (material, weight_g) پیش از کلیدهایِ «شارژر» می‌آیند
    const r = await compare(db, [extra, CHARGER]);
    expect(r.specRows.map((row) => row.key)).toEqual(['material', 'weight_g', 'port_type', 'power_watt']);

    const material = r.specRows.find((row) => row.key === 'material')!;
    expect(material.values).toEqual(['سیلیکون مایع', null]);

    const watt = r.specRows.find((row) => row.key === 'power_watt')!;
    expect(watt.values).toEqual([null, 20]);
  });

  it('امتیاز فقط از نظراتِ منتشرشده می‌آید؛ بی‌نظر، null است', async () => {
    const id = await idOf(GLASS);

    await db.query(
      `INSERT INTO product_reviews (product_id, author_name, body, rating, status, is_approved)
       VALUES ($1, 'بازدیدکنندهٔ آزمون', 'خوب بود', 4, 'approved', true)`,
      [id],
    );
    await db.query(
      `INSERT INTO product_reviews (product_id, author_name, body, rating, status, is_approved)
       VALUES ($1, 'در صفِ بررسی', 'بسیار عالی', 5, 'pending', false)`,
      [id],
    );

    const r = await compare(db, [GLASS, CABLE]);
    expect(r.products[0].rating).toBe(4); // نظرِ ۵ ستاره‌ایِ «در صف» حساب نشده
    expect(r.products[0].reviewCount).toBe(1);
    expect(r.products[1].rating).toBeNull();
    expect(r.products[1].reviewCount).toBe(0);
  });

  it('سازگاری، «برند + مدل» است و برایِ هر کالا جدا می‌شود', async () => {
    const r = await compare(db, [CASE, CABLE]);
    // کابلِ تایپ‌سی با چند مدل سازگار است
    expect(r.deviceModels[1].length).toBeGreaterThan(0);
    for (const list of r.deviceModels) {
      for (const m of list) expect(m).toContain(' '); // «برند + مدل»
    }
  });

  it('تخفیفِ بیرون از بازه، در مقایسه نمی‌آید (همان قاعده‌یِ کارت)', async () => {
    const slug = await makeExtra('قابِ آزمونِ تخفیف', {}, 1_000_000n);
    await db.query(
      `UPDATE products SET discount_percent = 10, discount_ends_at = now() - interval '1 day' WHERE slug = $1`,
      [slug],
    );

    const r = await compare(db, [slug, GLASS]);
    expect(r.products[0].discountPercent).toBeNull();
  });
});
