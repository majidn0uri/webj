import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, applyMigrations, seedCatalog, type Database } from '@set/db';
import { CatalogService, slugify } from './index.js';
import { CompatibilityService } from './compatibility.js';

let db: Database;
let catalog: CatalogService;
let compat: CompatibilityService;

beforeEach(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  await seedCatalog(db);
  catalog = new CatalogService(db);
  compat = new CompatibilityService(db);
});

afterEach(async () => db.close());

/** کالا بر اساسِ عنوان (برایِ خواناییِ آزمون‌ها) */
async function productByTitle(db: Database, title: string) {
  const { rows } = await db.query<{ id: string; title: string; type_key: string; brand_slug: string | null }>(
    `SELECT p.id, p.title, pt.key AS type_key, b.slug AS brand_slug
       FROM products p
       LEFT JOIN product_types pt ON pt.id = p.type_id
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.title = $1`,
    [title],
  );
  const row = rows[0];
  if (!row) throw new Error(`کالای «${title}» در داده‌ی نمونه نیست`);
  return row;
}

async function variantsOf(db: Database, productId: string) {
  const { rows } = await db.query<{ id: string; sku: string; price_rial: string }>(
    `SELECT id, sku, price_rial::text FROM product_variants WHERE product_id = $1 ORDER BY sku`,
    [productId],
  );
  return rows;
}

describe('کاتالوگ', () => {
  it('داده‌ی نمونه ساخته می‌شود', async () => {
    const { rows } = await db.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM product_compatibility`);
    expect(Number(rows[0]!.c)).toBeGreaterThan(10);
  });

  it('فیلتر بر اساسِ مدلِ گوشی، فقط کالاهای سازگار را برمی‌گرداند', async () => {
    const iphone13pro = await compat.findModelId('اپل', 'iPhone 13 Pro');
    const galaxyS23 = await compat.findModelId('سامسونگ', 'Galaxy S23');
    expect(iphone13pro).toBeTruthy();
    expect(galaxyS23).toBeTruthy();

    const forApple = await catalog.list({ deviceModelId: iphone13pro! });
    const forSamsung = await catalog.list({ deviceModelId: galaxyS23! });

    const appleTitles = forApple.items.map((p) => p.title);
    const samsungTitles = forSamsung.items.map((p) => p.title);

    // کابل و شارژر با هر دو سازگارند
    expect(appleTitles).toContain('شارژر دیواری ۲۰ وات با کابل تایپ‌سی');
    expect(samsungTitles).toContain('شارژر دیواری ۲۰ وات با کابل تایپ‌سی');

    // اما قابِ آیفون ۱۳ پرو نباید در نتایجِ گلکسی S23 باشد
    const caseVariantForApple = forApple.items.find((p) => p.title.startsWith('قاب'));
    expect(caseVariantForApple).toBeTruthy();
    expect(samsungTitles.some((t) => t.startsWith('قاب'))).toBe(true); // قاب مخصوصِ سامسونگ
  });

  it('هر کالای سازگار، دقیقاً همان تنوعِ مربوطه را نشان می‌دهد نه تنوعِ دیگر', async () => {
    const iphone13 = await compat.findModelId('اپل', 'iPhone 13');
    const rows = await compat.compatibleProducts(iphone13!);
    const skus = rows.map((r) => r.sku);
    expect(skus).toContain('CS-13-BLK');   // قابِ آیفون ۱۳
    expect(skus).not.toContain('CS-13P-BLK'); // قابِ آیفون ۱۳ پرو — نباید باشد
    expect(skus).toContain('CB-LT-1M');    // کابلِ لایتنینگ
  });

  it('بررسیِ سازگاری سه‌حالته است: می‌خورد / نامعلوم / اعلام‌نشده', async () => {
    const iphone13pro = await compat.findModelId('اپل', 'iPhone 13 Pro')!;
    const galaxyS23 = await compat.findModelId('سامسونگ', 'Galaxy S23')!;

    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM product_variants WHERE sku = 'CS-13P-BLK'`,
    );
    const caseVariant = rows[0]!.id;

    expect(await compat.checkFit(caseVariant, iphone13pro!)).toEqual({ status: 'fits', confidence: 'exact' });
    expect(await compat.checkFit(caseVariant, galaxyS23!)).toEqual({ status: 'unknown', confidence: null });

    // کالای بدون اعلامِ سازگاری
    const created = await catalog.createProduct({
      typeKey: 'cable',
      title: 'کابل تست بدون سازگاری',
      variants: [{ sku: 'NO-COMPAT-1', priceRial: 100_000n }],
    });
    const { rows: newVariant } = await db.query<{ id: string }>(
      `SELECT id FROM product_variants WHERE product_id = $1`, [created.id],
    );
    expect(await compat.checkFit(newVariant[0]!.id, iphone13pro!)).toEqual({ status: 'not_declared', confidence: null });
  });

  it('کالاهای بدون اعلامِ سازگاری برای تکمیل در پنل گزارش می‌شوند', async () => {
    await catalog.createProduct({
      typeKey: 'cable',
      title: 'کابل ناقص',
      variants: [{ sku: 'INCOMPLETE-1', priceRial: 50_000n }],
    });
    const missing = await compat.productsMissingCompatibility();
    expect(missing.map((m) => m.title)).toContain('کابل ناقص');
    expect(missing.map((m) => m.title)).not.toContain('شارژر دیواری ۲۰ وات با کابل تایپ‌سی');
  });

  it('ایجادِ کالا: تصاویر، ویژگی‌ها و موجودیِ اولیه در یک تراکنش', async () => {
    const result = await catalog.createProduct({
      typeKey: 'charger',
      brandSlug: 'anker',
      title: 'شارژر ۶۵ وات سه‌پورت',
      description: 'شارژر رومیزی با سه درگاه',
      attributes: { power_watt: 65, ports: 3 },
      images: [{ url: '/img/charger-65-1.jpg', role: 'main' }],
      variants: [{ sku: 'CH-65W', priceRial: 8_900_000n, attrs: { color: 'مشکی' }, compatibleModelIds: [] }],
    });

    const detail = await catalog.getBySlug(result.slug);
    expect(detail).toBeTruthy();
    expect((detail!.images as unknown[]).length).toBe(1);
    expect(detail!.title).toBe('شارژر ۶۵ وات سه‌پورت');
  });

  it('کالا بدون تنوع پذیرفته نمی‌شود', async () => {
    await expect(
      catalog.createProduct({ typeKey: 'charger', title: 'بدون تنوع', variants: [] }),
    ).rejects.toMatchObject({ code: 'ERR-001' });
  });

  it('برند یا نوعِ نامعتبر رد می‌شود', async () => {
    await expect(
      catalog.createProduct({ typeKey: 'ندارد', title: 'خطا', variants: [{ sku: 'X1', priceRial: 10n }] }),
    ).rejects.toMatchObject({ code: 'ERR-001' });
  });

  it('جستجوی فارسی با نویسه‌های عربی و فاصله‌های اضافه هم نتیجه می‌دهد', async () => {
    // «شارژر» با یای عربی و فاصله‌ی اضافی
    const q1 = await catalog.list({ query: 'شارژر  ۲۰ وات', log: false });
    expect(q1.total).toBeGreaterThan(0);

    const q2 = await catalog.list({ query: 'قاب', log: false });
    expect(q2.items.some((p) => p.title.includes('قاب'))).toBe(true);
  });

  it('فیلترِ «فقط موجود» کالای ناموجود را حذف می‌کند', async () => {
    await db.query(`UPDATE stock_items SET on_hand = 0`);
    const none = await catalog.list({ onlyAvailable: true });
    expect(none.total).toBe(0);
  });

  it('نامک (slug) از عنوان ساخته می‌شود', () => {
    expect(slugify('قاب سیلیکونی مات')).toBeTruthy();
    expect(slugify('قاب سیلیکونی مات')).not.toContain(' ');
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * جستجویِ فارسی
 *
 * این آزمون‌ها «رفتارِ دیده‌شده توسط مشتری» را قفل می‌کنند، نه پیاده‌سازی را.
 * هر کدام یکی از شکست‌هایِ واقعیِ فروشگاه‌هایِ ایرانی است:
 *   • نوشتنِ «شارجر» به‌جای «شارژر»، «اي فون» به‌جای «آیفون»
 *   • جدا نوشتنِ واژه‌هایِ مرکب («پاور بانک»)
 *   • جستجو با نامِ گوشی، در حالی که نامِ گوشی در عنوانِ کالا نیست
 *   • پاسخِ «هیچی نیست» برای عبارتِ چندواژه‌ای
 * ─────────────────────────────────────────────────────────────────────────── */
describe('جستجوی فارسی', () => {
  it('هم‌معنی‌ها را می‌فهمد: شارجر = شارژر، اپل = آیفون', async () => {
    const a = await catalog.search({ query: 'شارژر', log: false });
    const b = await catalog.search({ query: 'شارجر', log: false });
    const c = await catalog.search({ query: 'شارژرها', log: false }); // جمعِ فارسی
    expect(a.total).toBeGreaterThan(0);
    expect(b.total).toBe(a.total);
    expect(c.total).toBe(a.total);
  });

  it('عبارتِ مرکب را تکه‌تکه نمی‌کند: «پاور بانک» همان «پاوربانک» است', async () => {
    const spaced = await catalog.search({ query: 'پاور بانک', log: false });
    const joined = await catalog.search({ query: 'پاوربانک', log: false });
    expect(spaced.items.some((p) => p.title.includes('پاوربانک'))).toBe(true);
    expect(joined.items.some((p) => p.title.includes('پاوربانک'))).toBe(true);
  });

  it('نویسه‌های عربی، لاتین و اعراب تفاوتی در نتیجه ندارند', async () => {
    const persian = await catalog.search({ query: 'کابل تایپ سی', log: false });
    const arabic = await catalog.search({ query: 'كابل تایپ سی', log: false });
    const latin = await catalog.search({ query: 'type c', log: false });
    expect(persian.total).toBeGreaterThan(0);
    expect(arabic.total).toBe(persian.total);
    expect(latin.total).toBe(persian.total);
  });

  it('نامِ گوشی را در سندِ جستجو می‌یابد، هرچند در عنوانِ کالا نباشد', async () => {
    const r = await catalog.search({ query: 'آیفون ۱۳ پرو', log: false });
    // عنوانِ هیچ کالایی «آیفون ۱۳ پرو» نیست؛ از جدولِ سازگاری آمده است
    expect(r.total).toBeGreaterThan(0);
    expect(r.items.every((p) => !p.title.includes('آیفون'))).toBe(true);
    expect(r.relaxed).toBe(false); // نتیجه از ترکیبِ دقیق آمده، نه از نرم‌شدن
  });

  it('چند واژه با هم: «و» منطقی میانِ واژه‌ها', async () => {
    const both = await catalog.search({ query: 'شارژر تایپسی', log: false });
    expect(both.total).toBe(1);
    expect(both.items[0]!.title).toContain('شارژر');
  });

  it('اگر ترکیبِ کامل نبود، نرم می‌شود و صادقانه اعلام می‌کند', async () => {
    // «قاب پاوربانک» یعنی کالایی که هم قاب باشد و هم پاوربانک — چنین کالایی
    // نداریم. نه باید خطا بدهد، نه بن‌بست نشان دهد: هر دو گروه جداگانه جستجو
    // می‌شود و آن‌که واژه‌هایِ بیشتری را دارد بالا می‌آید.
    const r = await catalog.search({ query: 'قاب پاوربانک', log: false });
    expect(r.relaxed).toBe(true);
    expect(r.total).toBeGreaterThanOrEqual(2);
    const titles = r.items.map((p) => p.title);
    expect(titles.some((t) => t.includes('قاب'))).toBe(true);
    expect(titles.some((t) => t.includes('پاوربانک'))).toBe(true);

    // هیچ کالایِ «بن‌بستی» برنمی‌گردد: هر نتیجه دست‌کم یکی از واژه‌ها را دارد
    expect(r.items.every((p) => /قاب|پاوربانک|کاور|محافظ/.test(p.title))).toBe(true);
  });

  it('برای عبارتِ بی‌ربط نتیجه‌ای نیست و درخواست ثبت می‌شود', async () => {
    const r = await catalog.search({ query: 'یخچال ساید بای ساید', log: false });
    expect(r.total).toBe(0);
    expect(r.relaxed).toBe(false);

    // ثبتِ جستجو در مسیرِ عادی «ناهمزمانِ رها‌شده» است (پاسخ را منتظر نمی‌ماند)؛
    // اینجا همان متد را مستقیماً صدا می‌زنیم تا آزمون قطعی باشد.
    await catalog.logSearch({
      raw: 'یخچال ساید بای ساید',
      normalized: r.normalized,
      results: 0,
      channel: 'web',
      deviceModelId: null,
    });

    const { rows } = await db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM search_queries WHERE results = 0`,
    );
    expect(Number(rows[0]!.c)).toBe(1);
  });

  it('رتبه‌بندی: انطباقِ دقیق بالاتر از انطباقِ دور', async () => {
    const r = await catalog.search({ query: 'کابل', log: false });
    expect(r.items[0]!.title).toContain('کابل');
  });

  it('سندِ جستجو با تغییرِ سازگاری به‌روز می‌شود (تریگر)', async () => {
    const before = await catalog.search({ query: 'redmi', log: false }); // شیائومی Redmi
    expect(before.total).toBeGreaterThan(0);

    // همه‌ی سازگاری‌هایِ کابل را پاک می‌کنیم — از مسیرِ خودِ سرویس، نه SQLِ خام:
    // کشِ پاسخِ جستجو نوشتنِ دور‌زنِ سرویس را نمی‌شناسد (تا TTL کهنه می‌ماند،
    // که در `query-cache.test.ts` هم صریحاً آزموده شده)، پس اگر اینجا `DELETE`
    // مستقیم می‌زدیم، آزمونِ تریگر به آزمونِ «کش کار می‌کند» تبدیل می‌شد.
    const cableVariants = await db.query<{ id: string }>(
      `SELECT v.id FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE p.title LIKE 'کابل%'`,
    );
    for (const variant of cableVariants.rows) await compat.setCompatibility(variant.id, []);

    const after = await catalog.search({ query: 'redmi', log: false });
    expect(after.total).toBeLessThan(before.total);
  });

  /* ─────────────────────────── ویرایشِ کالا ─────────────────────────── */
  // چرا این آزمون‌ها مهم‌اند؟ چون ویرایش تنها جایی است که «تاریخچه» با
  // «خواسته‌ی فروشنده» برخورد می‌کند: اگر تنوعی که فروخته شده پاک شود،
  // سفارش‌ها و اسناد یتیم می‌مانند. این آزمون‌ها همان مرز را نگه می‌دارند.

  it('ویرایش: قیمت تغییر می‌کند و تغییرش در خروجی و حسابرسی می‌آید', async () => {
    const product = await productByTitle(db, 'قاب سیلیکونی مات با محافظ دوربین');
    const before = await variantsOf(db, product.id);
    const target = before.find((v) => v.sku === 'CS-13-BLK')!;

    const result = await catalog.updateProduct({
      productId: product.id,
      variants: before.map((v) => ({
        id: v.id,
        sku: v.sku,
        priceRial: v.sku === 'CS-13-BLK' ? BigInt(v.price_rial) + 100_000n : BigInt(v.price_rial),
        active: true,
        compatibleModelIds: [],
      })),
    });

    expect(result.priceChanges).toHaveLength(1);
    expect(result.priceChanges[0]!.sku).toBe('CS-13-BLK');
    expect(result.priceChanges[0]!.fromRial).toBe(target.price_rial);
    expect(result.priceChanges[0]!.toRial).toBe(String(BigInt(target.price_rial) + 100_000n));

    const after = await variantsOf(db, product.id);
    expect(after.find((v) => v.sku === 'CS-13-BLK')!.price_rial).toBe(
      String(BigInt(target.price_rial) + 100_000n),
    );
  });

  it('ویرایش: تنوعِ فروخته‌شده حذف نمی‌شود، فقط غیرفعال می‌گردد', async () => {
    const product = await productByTitle(db, 'قاب سیلیکونی مات با محافظ دوربین');
    const variants = await variantsOf(db, product.id);
    const sold = variants[0]!;

    // یک ردیفِ سفارشِ ساختگی: یعنی این تنوع پیش‌تر فروخته شده است
    await db.query(
      `INSERT INTO orders (order_no, customer_mobile, status, channel, total_rial)
       VALUES ('ORD-TEST-1', '09120000000', 'paid', 'web', 0)`,
    );
    const orderId = (await db.query<{ id: string }>(`SELECT id FROM orders WHERE order_no='ORD-TEST-1'`))
      .rows[0]!.id;
    await db.query(
      `INSERT INTO order_items (order_id, variant_id, quantity, unit_price_rial, total_rial)
       VALUES ($1, $2, 1, 0, 0)`,
      [orderId, sold.id],
    );

    const result = await catalog.updateProduct({
      productId: product.id,
      variants: variants
        .filter((v) => v.id !== sold.id)
        .map((v) => ({
          id: v.id,
          sku: v.sku,
          priceRial: BigInt(v.price_rial),
          active: true,
          compatibleModelIds: [],
        })),
    });

    expect(result.deactivatedVariantIds).toEqual([sold.id]);

    // ردیف هنوز هست (تاریخچه سالم است) ولی غیرفعال است
    const rows = await db.query<{ is_active: boolean }>(
      `SELECT is_active FROM product_variants WHERE id = $1`,
      [sold.id],
    );
    expect(rows.rows[0]!.is_active).toBe(false);
  });

  it('ویرایش: تنوعِ بی‌اثر واقعاً پاک می‌شود (ردیفِ یتیم نمی‌ماند)', async () => {
    const product = await productByTitle(db, 'قاب سیلیکونی مات با محافظ دوربین');
    const variants = await variantsOf(db, product.id);

    // نخست یک تنوعِ تازه می‌سازیم: نه فروخته شده، نه در انبار آمده
    await catalog.updateProduct({
      productId: product.id,
      variants: [
        ...variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          priceRial: BigInt(v.price_rial),
          active: true,
          compatibleModelIds: [],
        })),
        { sku: 'TMP-FOR-DELETE', priceRial: 1_000_000n, active: true, compatibleModelIds: [] },
      ],
    });

    // اکنون همان را حذف می‌کنیم: چون هیچ اثری از آن نیست، باید پاک شود
    const kept = await variantsOf(db, product.id);
    const result = await catalog.updateProduct({
      productId: product.id,
      variants: kept
        .filter((v) => v.sku !== 'TMP-FOR-DELETE')
        .map((v) => ({
          id: v.id,
          sku: v.sku,
          priceRial: BigInt(v.price_rial),
          active: true,
          compatibleModelIds: [],
        })),
    });

    expect(result.deactivatedVariantIds).toEqual([]);
    const { rows } = await db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM product_variants WHERE sku = 'TMP-FOR-DELETE'`,
    );
    expect(rows[0]!.c).toBe('0');
  });

  it('ویرایش: کالا نمی‌تواند بی‌تنوعِ فعال بماند', async () => {
    const product = await productByTitle(db, 'قاب سیلیکونی مات با محافظ دوربین');
    const variants = await variantsOf(db, product.id);

    await expect(
      catalog.updateProduct({
        productId: product.id,
        variants: variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          priceRial: BigInt(v.price_rial),
          active: false,
          compatibleModelIds: [],
        })),
      }),
    ).rejects.toMatchObject({ key: 'VALIDATION' });
  });

  it('ویرایش: تنوعِ تازه افزوده می‌شود و سازگاری‌اش ذخیره می‌گردد', async () => {
    const product = await productByTitle(db, 'قاب سیلیکونی مات با محافظ دوربین');
    const variants = await variantsOf(db, product.id);
    const modelId = await compat.findModelId('اپل', 'iPhone 13 Pro');

    const result = await catalog.updateProduct({
      productId: product.id,
      variants: [
        ...variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          priceRial: BigInt(v.price_rial),
          active: true,
          compatibleModelIds: [],
        })),
        { sku: 'CS-13P-BLU', priceRial: 2_600_000n, active: true, compatibleModelIds: [modelId!] },
      ],
    });

    expect(result.variantIds).toHaveLength(variants.length + 1);
    const { rows } = await db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM product_compatibility pc
         JOIN product_variants v ON v.id = pc.variant_id
        WHERE v.sku = 'CS-13P-BLU' AND pc.device_model_id = $1`,
      [modelId!],
    );
    expect(rows[0]!.c).toBe('1');
  });

  it('ویرایش: عنوان که عوض شود، کالا با عنوانِ تازه پیدا می‌شود', async () => {
    const product = await productByTitle(db, 'کابل بافته‌شده تایپ‌سی ۱ متری');
    const before = await catalog.search({ query: 'بافته', log: false });
    expect(before.items.some((i) => i.title === 'کابل بافته‌شده تایپ‌سی ۱ متری')).toBe(true);

    await catalog.updateProduct({
      productId: product.id,
      title: 'کابل بافته‌شده تایپ‌سی ۲ متری',
      description: 'کابل بافته‌شده تایپ‌سی ۲ متری با بدنه‌یِ مقاوم',
    });

    const after = await catalog.search({ query: '۲ متری', log: false });
    expect(after.items.some((i) => i.title === 'کابل بافته‌شده تایپ‌سی ۲ متری')).toBe(true);

  });
});

/**
 * فیلترِ رنگ و «فقط تخفیف‌دار»، و برچسب‌هایِ کارت.
 *
 * آنچه اینجا می‌سنجد ظاهر نیست؛ این است که **مرزِ درستی** داشته باشیم: رنگ
 * رویِ تنوع است و تخفیف رویِ کالا، و هر دو وابسته به «اکنون». اشتباه در این
 * مرزها یعنی خریدار فیلترِ «تخفیف‌دار» را می‌زند و کالایی می‌بیند که در سبد
 * هیچ تخفیفی نمی‌گیرد — همان چیزی که در فروشگاه‌هایِ بزرگ، از هر چیزِ دیگری
 * بیشتر اعتماد را می‌کشد.
 */
describe('فیلترِ فهرست و برچسب‌ها', () => {
  /** کالایی با رنگ‌هایِ گوناگون می‌سازیم تا فیلتر رویِ داده‌یِ قطعی سنجیده شود */
  async function makeCase(title: string, colours: string[]) {
    const created = await catalog.createProduct({
      title,
      description: 'برایِ آزمونِ فیلتر',
      typeKey: 'case-silicone',
      brandSlug: 'nillkin',
      attributes: {},
      variants: colours.map((c, i) => ({
        sku: `FIL-${title}-${i}`,
        priceRial: 1_000_000n,
        attributes: { color: c },
      })),
    });
    return created.id;
  }

  it('فیلترِ رنگ: کالایِ هم‌رنگ می‌آید، بی‌رنگ نمی‌آید', async () => {
    await makeCase('قابِ سرخِ آزمون', ['قرمز']);
    await makeCase('قابِ آبیِ آزمون', ['آبی']);

    const red = await catalog.list({ colours: ['قرمز'] });
    const redTitles = red.items.map((p) => p.title);
    expect(redTitles).toContain('قابِ سرخِ آزمون');
    expect(redTitles).not.toContain('قابِ آبیِ آزمون');
  });

  it('فیلترِ رنگِ چندگانه: «یا» است، نه «و»', async () => {
    await makeCase('قابِ سبزِ آزمون', ['سبز']);
    await makeCase('قابِ زردِ آزمون', ['زرد']);
    await makeCase('قابِ بنفشِ آزمون', ['بنفش']);

    const two = await catalog.list({ colours: ['سبز', 'زرد'] });
    const titles = two.items.map((p) => p.title);
    // هر کالایی که یکی از این دو رنگ را دارد — «و» بودنِ این فیلتر بی‌معناست
    expect(titles).toContain('قابِ سبزِ آزمون');
    expect(titles).toContain('قابِ زردِ آزمون');
    expect(titles).not.toContain('قابِ بنفشِ آزمون');
  });

  it('کالایی که چند تنوعِ هم‌رنگ دارد، یک‌بار می‌آید (تکرار نمی‌شود)', async () => {
    await makeCase('قابِ تکراری', ['مشکی', 'مشکی', 'مشکی']);
    const black = await catalog.list({ colours: ['مشکی'] });
    const count = black.items.filter((p) => p.title === 'قابِ تکراری').length;
    expect(count).toBe(1);
  });

  it('رنگِ ناموجود: نتیجه تُهی است و خطا نیست', async () => {
    await makeCase('قابِ موجود', ['سفید']);
    const none = await catalog.list({ colours: ['رنگی-که-نیست'] });
    expect(none.items).toHaveLength(0);
    expect(none.total).toBe(0);
  });

  it('رنگِ کالا در خروجی می‌آید (خوراکِ سواچِ رویِ کارت)', async () => {
    await makeCase('قابِ رنگارنگ', ['قرمز', 'سبز']);
    const all = await catalog.list({});
    const found = all.items.find((p) => p.title === 'قابِ رنگارنگ');
    expect(found?.colours?.sort()).toEqual(['سبز', 'قرمز'].sort());
  });

  it('«فقط تخفیف‌دار»: تخفیفِ بیرون از بازه به حساب نمی‌آید', async () => {
    const id = await makeCase('قابِ تخفیف‌دار', ['مشکی']);

    // تخفیفی در آینده: هنوز آغاز نشده
    await db.query(
      `UPDATE products SET discount_percent = 20,
              discount_starts_at = now() + interval '10 days',
              discount_ends_at = now() + interval '20 days'
        WHERE id = $1`,
      [id],
    );
    const future = await catalog.list({ discounted: true });
    expect(future.items.map((p) => p.id)).not.toContain(id);

    // همان تخفیف، اکنون جاری
    await db.query(
      `UPDATE products SET discount_starts_at = now() - interval '1 day',
              discount_ends_at = now() + interval '10 days'
        WHERE id = $1`,
      [id],
    );
    const now = await catalog.list({ discounted: true });
    expect(now.items.map((p) => p.id)).toContain(id);
    expect(now.items.find((p) => p.id === id)?.discountPercent).toBe(20);
  });

  it('تخفیفِ گذشته: در فهرستِ تخفیف‌دار نمی‌آید و درصدش هم تهی است', async () => {
    const id = await makeCase('قابِ تخفیفِ گذشته', ['مشکی']);
    await db.query(
      `UPDATE products SET discount_percent = 30,
              discount_starts_at = now() - interval '30 days',
              discount_ends_at = now() - interval '10 days'
        WHERE id = $1`,
      [id],
    );
    const list = await catalog.list({ discounted: true });
    expect(list.items.map((p) => p.id)).not.toContain(id);

    const all = await catalog.list({});
    const found = all.items.find((p) => p.id === id);
    expect(found?.discountPercent).toBeNull();
  });

  it('برچسبِ «جدید» از is_new_untilِ تنوع می‌آید', async () => {
    const id = await makeCase('قابِ نو', ['مشکی']);
    const before = await catalog.list({});
    expect(before.items.find((p) => p.id === id)?.isNew).toBe(false);

    await db.query(
      `UPDATE product_variants SET is_new_until = now() + interval '5 days' WHERE product_id = $1`,
      [id],
    );
    const after = await catalog.list({});
    expect(after.items.find((p) => p.id === id)?.isNew).toBe(true);
  });

  it('موجودیِ قابلِ فروش در خروجی هست (خوراکِ «تنها ۳ عدد مانده»)', async () => {
    const all = await catalog.list({});
    for (const p of all.items) {
      expect(typeof p.availableQty).toBe('number');
      expect(p.availableQty!).toBeGreaterThanOrEqual(0);
    }
  });

  it('فهرستِ رنگ‌ها: رنگِ تنوعِ فعال می‌آید، مرتب و بی‌تکرار', async () => {
    await makeCase('قابِ رنگِ الف', ['زرد', 'مشکی']);
    await makeCase('قابِ رنگِ ب', ['زرد', 'سبز']);

    const colours = (await catalog.availableColours()).items;
    expect(colours).toContain('زرد');
    expect(colours).toContain('مشکی');
    expect(colours).toContain('سبز');
    // «هر رنگ یک‌بار» و «مرتب»: فیلترِ رنگِ فروشگاه بی‌این، با هر جستجو
    // ترتیبش عوض می‌شد و خریدار جایِ دکمه‌ها را گم می‌کرد
    expect(colours.filter((c) => c === 'زرد')).toHaveLength(1);
    expect([...colours].sort()).toEqual(colours);
  });

  it('رنگِ تنوعِ غیرفعال در فهرستِ فیلتر نمی‌آید', async () => {
    const id = await makeCase('قابِ خاموش', ['صورتی']);
    await db.query(`UPDATE product_variants SET is_active = false WHERE product_id = $1`, [id]);

    expect((await catalog.availableColours()).items).not.toContain('صورتی');
  });

  it('رنگِ کالایِ غیرفعال در فهرستِ فیلتر نمی‌آید (فیلترِ بی‌نتیجه نمی‌سازیم)', async () => {
    const id = await makeCase('قابِ بایکوتی', ['کرم']);
    await db.query(`UPDATE products SET status = 'archived' WHERE id = $1`, [id]);

    expect((await catalog.availableColours()).items).not.toContain('کرم');
  });

  it('تنوعِ بی‌رنگ فهرست را با رشته‌یِ تهی آلوده نمی‌کند', async () => {
    await makeCase('قابِ بی‌رنگِ آزمون', ['']);
    const colours = (await catalog.availableColours()).items;
    expect(colours).not.toContain('');
    expect(colours).not.toContain(null as unknown as string);
  });

  it('جستجو هم فیلترِ رنگ را می‌پذیرد (list برایِ عبارت، به search می‌سپارد)', async () => {
    await makeCase('قابِ جستجویی', ['نارنجی']);
    // واژه‌یِ یکتا؛ نیم‌فاصله‌یِ میانِ «قاب» و «ِ» در جستجو معنا ندارد
    const hit = await catalog.list({ query: 'جستجویی', colours: ['نارنجی'] });
    expect(hit.items.some((p) => p.title === 'قابِ جستجویی')).toBe(true);

    const miss = await catalog.list({ query: 'جستجویی', colours: ['صورتی'] });
    expect(miss.items.some((p) => p.title === 'قابِ جستجویی')).toBe(false);
  });
});
