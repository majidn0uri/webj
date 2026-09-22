import type { Database } from './client.js';
import { searchKey, jalaliParts, jalaliMonth } from '@set/shared-kernel';
import { nextNumber } from './numbering.js';

/**
 * داده‌ی نمونه برای توسعه و دِمو.
 * در تولید اجرا نمی‌شود — فقط برای این‌که رفتارِ سیستم روی داده‌ی واقعی دیده شود.
 */
export interface SeedSummary {
  deviceBrands: number;
  deviceModels: number;
  brands: number;
  productTypes: number;
  products: number;
  variants: number;
  compatibilityRows: number;
}

export interface SeedOptions {
  /**
   * ثبتِ موجودیِ افتتاحیه (و سندِ حسابداریِ آن).
   *
   * آزمون‌هایِ حسابداری این را خاموش می‌کنند تا از صفرِ مطلق شروع کنند و
   * اعدادِ انتظارشان با موجودیِ نمونه جمع نشود. در اجرایِ واقعی همیشه روشن است.
   */
  openingInventory?: boolean;
}

export async function seedCatalog(db: Database, opts: SeedOptions = {}): Promise<SeedSummary> {
  const withOpening = opts.openingInventory ?? true;
  let compatibilityRows = 0;

  // --- دستگاه‌ها ---
  const devices: Array<[brandSlug: string, brandName: string, models: string[]]> = [
    ['apple', 'اپل', ['iPhone 13 Pro', 'iPhone 13', 'iPhone 14 Pro']],
    ['samsung', 'سامسونگ', ['Galaxy S23', 'Galaxy A54']],
    ['xiaomi', 'شیائومی', ['Redmi Note 13']],
  ];

  const modelIds = new Map<string, string>();
  for (const [brandSlug, brandName, models] of devices) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO device_brands (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [brandSlug, brandName],
    );
    const brandId = rows[0]!.id;
    for (const model of models) {
      const slug = model.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const { rows: m } = await db.query<{ id: string }>(
        `INSERT INTO device_models (brand_id, name, slug) VALUES ($1, $2, $3)
         ON CONFLICT (brand_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [brandId, model, slug],
      );
      modelIds.set(model, m[0]!.id);
    }
  }

  // --- برندهای کالا ---
  const brands: Array<[string, string]> = [
    ['baseus', 'بیسوس'], ['ugreen', 'یوگرین'], ['nillkin', 'نیلکین'],
    ['remax', 'ریمکس'], ['anker', 'انکر'],
  ];
  for (const [slug, name] of brands) {
    await db.query(
      `INSERT INTO brands (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`,
      [slug, name],
    );
  }

  // --- انواع کالا ---
  const types: Array<[string, string]> = [
    ['case', 'قاب'], ['charger', 'شارژر'], ['cable', 'کابل'],
    ['glass', 'گلس'], ['powerbank', 'پاوربانک'],
  ];
  for (const [key, name] of types) {
    await db.query(
      // چرا «DO NOTHING» و نه «DO UPDATE SET name»؟ چون نامِ دسته از این لحظه
      // در دستِ فروشنده است (در پنل عوضش می‌کند). بذرافشانیِ دوباره نباید
      // نامی را که او گذاشته بی‌صدا به حالتِ پیشین برگرداند.
      `INSERT INTO product_types (key, name) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, name],
    );
  }

  // --- کالاها ---
  // هر کالا در یک **برگِ** درخت می‌نشیند، نه در ریشه. چرا؟ چون کالایی که در
  // ریشه بنشیند از هیچ مسیری «دقیق‌تر» نمی‌شود: خریداری که «شارژرِ دیواری»
  // می‌خواهد، نباید ناچار باشد همه‌یِ انواعِ شارژر را ببیند. ریشه‌ها برایِ
  // دسته‌بندی‌اند، نه برایِ نشستنِ کالا.

  const products: Array<{
    type: string; brand: string; title: string; slug: string;
    attrs?: Record<string, unknown>;
    variants: Array<{ sku: string; price: number; attrs?: Record<string, unknown>; models: string[] }>;
  }> = [
    {
      type: 'case-silicone', brand: 'nillkin', title: 'قاب سیلیکونی مات با محافظ دوربین', slug: 'case-silicon-matte',
      attrs: { material: 'سیلیکون مایع', thickness_mm: 1.2 },
      variants: [
        { sku: 'CS-13P-BLK', price: 2_550_000, attrs: { color: 'مشکی' }, models: ['iPhone 13 Pro'] },
        { sku: 'CS-13-BLK', price: 2_400_000, attrs: { color: 'مشکی' }, models: ['iPhone 13'] },
        { sku: 'CS-S23-BLK', price: 2_200_000, attrs: { color: 'مشکی' }, models: ['Galaxy S23'] },
        { sku: 'CS-S23-NAVY', price: 2_200_000, attrs: { color: 'سرمه‌ای' }, models: ['Galaxy S23'] },
        { sku: 'CS-S23-RED', price: 2_290_000, attrs: { color: 'قرمز' }, models: ['Galaxy S23'] },
        { sku: 'CS-S23-GRN', price: 2_200_000, attrs: { color: 'سبز' }, models: ['Galaxy S23'] },
      ],
    },
    {
      type: 'wall-charger', brand: 'baseus', title: 'شارژر دیواری ۲۰ وات با کابل تایپ‌سی', slug: 'charger-20w-typec',
      attrs: { power_watt: 20, port_type: 'USB-C' },
      variants: [
        { sku: 'CH-20W-WHT', price: 3_200_000, attrs: { color: 'سفید' }, models: ['iPhone 13 Pro', 'iPhone 13', 'iPhone 14 Pro', 'Galaxy S23', 'Redmi Note 13'] },
      ],
    },
    {
      type: 'cable-typec', brand: 'ugreen', title: 'کابل بافته‌شده تایپ‌سی ۱ متری', slug: 'cable-typec-1m',
      attrs: { length_cm: 100, connector: 'USB-C به USB-C' },
      variants: [
        { sku: 'CB-TC-1M', price: 1_250_000, attrs: { color: 'خاکستری' }, models: ['iPhone 13 Pro', 'iPhone 14 Pro', 'Galaxy S23', 'Galaxy A54', 'Redmi Note 13'] },
        { sku: 'CB-LT-1M', price: 1_100_000, attrs: { color: 'خاکستری' }, models: ['iPhone 13', 'iPhone 13 Pro'] },
      ],
    },
    {
      type: 'glass-ceramic', brand: 'remax', title: 'گلس سرامیکی ۹H دو عددی', slug: 'glass-ceramic-9h',
      attrs: { hardness: '9H', count: 2 },
      variants: [
        { sku: 'GL-13P', price: 950_000, models: ['iPhone 13 Pro'] },
        { sku: 'GL-S23', price: 890_000, models: ['Galaxy S23'] },
      ],
    },
    {
      type: 'powerbank-standard', brand: 'anker', title: 'پاوربانک ۲۰۰۰۰ میلی‌آمپر ۲۲.۵ وات', slug: 'powerbank-20000',
      attrs: { capacity_mah: 20000, power_watt: 22.5 },
      variants: [
        { sku: 'PB-20K', price: 12_500_000, models: ['iPhone 13 Pro', 'iPhone 14 Pro', 'Galaxy S23', 'Galaxy A54', 'Redmi Note 13'] },
      ],
    },
  ];

  let variantCount = 0;
  for (const p of products) {
    const { rows: types_ } = await db.query<{ id: string }>(`SELECT id FROM product_types WHERE key = $1`, [p.type]);
    const { rows: brands_ } = await db.query<{ id: string }>(`SELECT id FROM brands WHERE slug = $1`, [p.brand]);
    const { rows: prod } = await db.query<{ id: string }>(
      `INSERT INTO products (type_id, brand_id, title, slug, description, search_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       ON CONFLICT (slug) DO UPDATE
         SET title = EXCLUDED.title,
             search_key = EXCLUDED.search_key,
             -- دسته هم به‌روز می‌شود: این کالاها «نمونه» و در مالکیتِ بذرند.
             -- اگر رده‌بندی عوض شود (مثلاً کالا از ریشه به برگ برود) و بذرِ
             -- دوباره دسته را عوض نکند، کالا در جایِ کهنه می‌ماند و درخت
             -- نیمی از معنایش را از دست می‌دهد.
             type_id = EXCLUDED.type_id
       RETURNING id`,
      // کلیدِ جستجو حتماً نرمال‌شده ذخیره شود، وگرنه جستجوی کاربر (که نرمال است) با آن تطبیق نمی‌خورد
      [types_[0]!.id, brands_[0]!.id, p.title, p.slug, p.title, searchKey(`${p.title} ${p.attrs ? JSON.stringify(p.attrs) : ''}`)],
    );
    const productId = prod[0]!.id;

    await db.query(
      `INSERT INTO product_attributes (product_id, values) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING`,
      [productId, JSON.stringify(p.attrs ?? {})],
    );

    // تصویرِ کالا — در سیستمِ واقعی از پنلِ فروشنده بارگذاری می‌شود.
    // مسیر نسبی است تا هیچ وابستگی‌ای به دامنه یا اینترنت نداشته باشد (بخش AA).
    await db.query(
      `INSERT INTO product_images (product_id, url, alt, role, sort_order)
       SELECT $1, $2, $3, 'main', 0
        WHERE NOT EXISTS (
          SELECT 1 FROM product_images WHERE product_id = $1 AND url = $2
        )`,
      [productId, `/products/${p.slug}.jpg`, p.title],
    );

    for (const v of p.variants) {
      const { rows: vr } = await db.query<{ id: string }>(
        `INSERT INTO product_variants (product_id, sku, attributes, price_rial)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (sku) DO UPDATE SET price_rial = EXCLUDED.price_rial
         RETURNING id`,
        [productId, v.sku, JSON.stringify(v.attrs ?? {}), v.price],
      );
      variantCount++;
      for (const model of v.models) {
        const modelId = modelIds.get(model);
        if (!modelId) continue;
        // توجه: لایه‌ی دسترسی تعدادِ ردیفِ affected را با نام affectedRows برمی‌گرداند (نه rowCount)
        const { affectedRows } = await db.query(
          `INSERT INTO product_compatibility (variant_id, device_model_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [vr[0]!.id, modelId],
        );
        if (affectedRows) compatibilityRows += affectedRows;
      }
    }
  }

  // موجودیِ نمونه
  //
  // چرا `WHERE NOT EXISTS` و نه `ON CONFLICT DO NOTHING`؟ چون جدولِ انبارها
  // رویِ نام کلیدِ یکتا ندارد و `ON CONFLICT`ِ بی‌هدف هیچ تضادی نمی‌بیند؛
  // نتیجه این بود که هر بار اجرایِ بذر یک انبارِ تازه می‌ساخت و پس از چند
  // بار، موجودیِ هر کالا در گزارش‌ها چند برابرِ واقعی دیده می‌شد (۱۵ انبار،
  // ۳۱۵ قلم پاوربانک به‌جای ۲۱). بذر باید بتوان چندباره اجرا شود بی‌آنکه
  // داده را چند برابر کند.
  const { rows: wh } = await db.query<{ id: string }>(
    `INSERT INTO warehouses (name, is_default)
     SELECT 'انبار مرکزی', true
      WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE name = 'انبار مرکزی')
     RETURNING id`,
  );
  const warehouseId = wh[0]?.id ?? (await db.query<{ id: string }>(`SELECT id FROM warehouses LIMIT 1`)).rows[0]?.id;
  if (warehouseId) {
    const { rows: vs } = await db.query<{ id: string; price_rial: string }>(
      `SELECT id, price_rial::text FROM product_variants`,
    );
    let openingValue = 0n;
    for (const [index, v] of vs.entries()) {
      const quantity = 5 + ((index * 7) % 20);
      await db.query(
        `INSERT INTO stock_items (variant_id, warehouse_id, on_hand)
         VALUES ($1, $2, $3) ON CONFLICT (variant_id, warehouse_id) DO NOTHING`,
        [v.id, warehouseId, quantity],
      );

      // موجودیِ افتتاحیه باید «بهای خرید» داشته باشد، وگرنه فروشِ آن
      // درآمد می‌سازد بی‌آن‌که بهای کالای فروخته‌شده ثبت شود و سود، دروغ می‌شود.
      // در دنیایِ واقعی این بها از فاکتورِ خرید می‌آید؛ این‌جا برای داده‌ی نمونه
      // ۶۵٪ِ قیمتِ فروش فرض شده (حاشیه‌ی معمولِ لوازمِ جانبی) و گرد می‌شود.
      const price = BigInt(v.price_rial);
      const unitCost = ((price * 65n + 500n) / 1000n) * 10n;
      if (withOpening) {
        const { affectedRows } = await db.query(
          `INSERT INTO inventory_valuation (variant_id, warehouse_id, quantity, avg_cost_rial)
           VALUES ($1,$2,$3,$4) ON CONFLICT (variant_id, warehouse_id) DO NOTHING`,
          [v.id, warehouseId, quantity, unitCost.toString()],
        );
        if (affectedRows) openingValue += unitCost * BigInt(quantity);
      }
    }

    // سندِ افتتاحیه: بدهکار «موجودیِ کالا»، بستانکار «حساب‌های پرداختنی»
    // (موجودیِ اولیه به‌صورتِ نسیه از تأمین‌کننده وارد شده است)
    if (openingValue > 0n) {
      const { rows: opening } = await db.query<{ id: string }>(
        `SELECT id FROM journal_entries WHERE reference_type = 'opening' LIMIT 1`,
      );
      if (!opening[0]) {
        const { formatted: entryNo } = await nextNumber(db, 'journal_entry', {
          prefix: 'JV',
          jalaliYear: jalaliParts(new Date()).year,
          pad: 6,
        });
        const { rows: entry } = await db.query<{ id: string }>(
          `INSERT INTO journal_entries (entry_no, description, reference_type, posted_at, period)
           VALUES ($1,$2,'opening',now(),$3) RETURNING id`,
          [entryNo, 'سندِ افتتاحیه — موجودیِ کالا از تأمین‌کننده', jalaliPeriod(new Date())],
        );
        for (const [code, side] of [
          ['1000', 'debit'],
          ['2000', 'credit'],
        ] as const) {
          const { rows: acc } = await db.query<{ id: string }>(`SELECT id FROM accounts WHERE code = $1`, [code]);
          if (!acc[0]) continue;
          await db.query(
            `INSERT INTO journal_lines (entry_id, account_id, debit_rial, credit_rial, description)
             VALUES ($1,$2,$3,$4,$5)`,
            [
              entry[0]!.id,
              acc[0].id,
              side === 'debit' ? openingValue.toString() : '0',
              side === 'credit' ? openingValue.toString() : '0',
              'موجودیِ افتتاحیه‌ی کالا',
            ],
          );
        }
      }
    }
  }

  const count = async (table: string): Promise<number> => {
    const { rows } = await db.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM ${table}`);
    return Number(rows[0]!.c);
  };

  return {
    deviceBrands: await count('device_brands'),
    deviceModels: await count('device_models'),
    brands: await count('brands'),
    productTypes: await count('product_types'),
    products: await count('products'),
    variants: variantCount,
    compatibilityRows,
  };
}

/** دوره‌ی مالیِ شمسی به شکل ۱۴۰۵۰۶ — محاسبه در خودِ بسته تا seed به بسته‌ی حسابداری وابسته نشود */
function jalaliPeriod(date: Date): string {
  return `${jalaliParts(date).year}${String(jalaliMonth(date)).padStart(2, '0')}`;
}
