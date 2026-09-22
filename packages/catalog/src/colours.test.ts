import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations, createDatabase, type Database } from '@set/db';

import { ColourService, NEUTRAL_HEX, NO_COLOUR } from './colours.js';

/**
 * آزمونِ سواچِ رنگ.
 *
 * آنچه می‌سنجد ظاهر نیست؛ این است که رنگ درست به تنوعِ درست برسد. اشتباهِ
 * اینجا یعنی خریدار «مشکی» را می‌زند و «آبی» می‌خرد — و برگشتِ کالا، که در
 * بازارِ ایران هزینه‌اش از سودِ آن فروش بیشتر است.
 */

let db: Database;
let colours: ColourService;

let typeId = '';
let productId = '';
let warehouseId = '';

beforeAll(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  colours = new ColourService(db);

  const type = await db.query<{ id: string }>(
    `INSERT INTO product_types (key, name) VALUES ('case', 'قاب')
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  typeId = type.rows[0]!.id;

  const product = await db.query<{ id: string }>(
    `INSERT INTO products (type_id, title, slug, status) VALUES ($1, 'قابِ سیلیکونی', 'case-many', 'active') RETURNING id`,
    [typeId],
  );
  productId = product.rows[0]!.id;

  const warehouse = await db.query<{ id: string }>(
    `INSERT INTO warehouses (name, is_default) VALUES ('انبارِ آزمون', true) RETURNING id`,
  );
  warehouseId = warehouse.rows[0]!.id;
});

afterAll(async () => {
  await db.close();
});

afterEach(async () => {
  await db.query(`DELETE FROM product_images`);
  await db.query(`DELETE FROM product_compatibility`);
  await db.query(`DELETE FROM stock_items`);
  await db.query(`DELETE FROM product_variants`);
});

async function variant(opts: {
  sku: string;
  colour?: string | null;
  hex?: string | null;
  stock?: number;
  price?: number;
}): Promise<string> {
  const attributes: Record<string, unknown> = {};
  if (opts.colour) attributes.color = opts.colour;
  if (opts.hex) attributes.color_hex = opts.hex;

  const row = await db.query<{ id: string }>(
    `INSERT INTO product_variants (product_id, sku, price_rial, attributes)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
    [productId, opts.sku, opts.price ?? 100000, JSON.stringify(attributes)],
  );
  const id = row.rows[0]!.id;
  await db.query(
    `INSERT INTO stock_items (variant_id, warehouse_id, on_hand, reserved) VALUES ($1,$2,$3,0)`,
    [id, warehouseId, opts.stock ?? 0],
  );
  return id;
}

async function productImage(url = '/products/case-many.jpg'): Promise<void> {
  await db.query(
    `INSERT INTO product_images (product_id, url, alt, role, sort_order)
     VALUES ($1, $2, 'قاب', 'main', 0)`,
    [productId, url],
  );
}

async function variantImage(variantId: string, url: string): Promise<void> {
  await db.query(
    `INSERT INTO product_images (product_id, variant_id, url, alt, role, sort_order)
     VALUES ($1, $2, $3, 'رنگ', 'main', 0)`,
    [productId, variantId, url],
  );
}

describe('گروه‌بندیِ رنگ', () => {
  it('هر رنگ یک سواچ است، نه هر تنوع', async () => {
    await variant({ sku: 'A-1', colour: 'مشکی', stock: 3 });
    await variant({ sku: 'A-2', colour: 'آبی', stock: 2 });
    await variant({ sku: 'A-3', colour: 'قرمز', stock: 1 });

    const list = await colours.swatches(productId);
    expect(list).toHaveLength(3);
    expect(list.map((s) => s.name).sort()).toEqual(['آبی', 'مشکی', 'قرمز'].sort());
  });

  it('دو تنوعِ هم‌رنگ یک سواچ می‌شوند و هر دو را در خود دارند', async () => {
    const a = await variant({ sku: 'B-1', colour: 'مشکی', stock: 1 });
    const b = await variant({ sku: 'B-2', colour: 'مشکی', stock: 1 });

    const list = await colours.swatches(productId);
    expect(list).toHaveLength(1);
    expect(list[0]!.variantIds.sort()).toEqual([a, b].sort());
  });

  it('تنوعِ بی‌رنگ گم نمی‌شود — زیرِ «بدونِ رنگ» می‌آید', async () => {
    await variant({ sku: 'C-1', stock: 1 });
    const list = await colours.swatches(productId);
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe(NO_COLOUR);
  });

  it('کالایِ بی‌تنوع، سواچی ندارد (پرسیدنِ «کدام رنگ؟» بی‌معناست)', async () => {
    const list = await colours.swatches(productId);
    expect(list).toEqual([]);
  });
});

describe('کدِ رنگ', () => {
  it('نامِ فارسی به کد ترجمه می‌شود', async () => {
    await variant({ sku: 'D-1', colour: 'سرمه‌ای', stock: 1 });
    const list = await colours.swatches(productId);
    expect(list[0]!.hex).toBe('#1b2a4a');
  });

  it('رنگِ دستی (color_hex) بر واژه‌نامه مقدم است', async () => {
    await variant({ sku: 'E-1', colour: 'مشکی', hex: '#123456', stock: 1 });
    const list = await colours.swatches(productId);
    expect(list[0]!.hex).toBe('#123456');
  });

  it('رنگِ ناشناس، سواچ را نمی‌شکند — رنگِ خنثی می‌گیرد', async () => {
    await variant({ sku: 'F-1', colour: 'رنگِ عجیبِ جدید', stock: 1 });
    const list = await colours.swatches(productId);
    expect(list[0]!.hex).toBe(NEUTRAL_HEX);
    expect(list[0]!.name).toBe('رنگِ عجیبِ جدید');
  });
});

describe('تصویرِ مخصوصِ رنگ', () => {
  it('تصویرِ تنوع بر تصویرِ کالا مقدم است', async () => {
    await productImage();
    const v = await variant({ sku: 'G-1', colour: 'آبی', stock: 1 });
    await variantImage(v, '/media/blue.jpg');

    const list = await colours.swatches(productId);
    expect(list[0]!.imageUrl).toBe('/media/blue.jpg');
    expect(list[0]!.hasOwnImage).toBe(true);
  });

  it('بی‌تصویر، به تصویرِ کالا برمی‌گردد — نه به جایِ خالی', async () => {
    await productImage('/products/case-main.jpg');
    await variant({ sku: 'H-1', colour: 'آبی', stock: 1 });

    const list = await colours.swatches(productId);
    expect(list[0]!.imageUrl).toBe('/products/case-main.jpg');
    expect(list[0]!.hasOwnImage).toBe(false);
  });
});

describe('موجودی و چینش', () => {
  it('رنگِ موجود پیش از رنگِ تمام‌شده می‌آید', async () => {
    await variant({ sku: 'I-1', colour: 'قرمز', stock: 0 });
    await variant({ sku: 'I-2', colour: 'مشکی', stock: 4 });

    const list = await colours.swatches(productId);
    expect(list[0]!.name).toBe('مشکی');
    expect(list[0]!.outOfStock).toBe(false);
    expect(list[1]!.name).toBe('قرمز');
    expect(list[1]!.outOfStock).toBe(true);
  });

  it('رنگِ تمام‌شده پنهان نمی‌شود — خط می‌خورد', async () => {
    await variant({ sku: 'J-1', colour: 'قرمز', stock: 0 });
    const list = await colours.swatches(productId);
    expect(list).toHaveLength(1);
    expect(list[0]!.outOfStock).toBe(true);
  });

  it('سواچ، تنوعِ **موجودِ** آن رنگ را برمی‌گزیند', async () => {
    const sold = await variant({ sku: 'K-1', colour: 'مشکی', stock: 0 });
    const alive = await variant({ sku: 'K-2', colour: 'مشکی', stock: 7 });

    const list = await colours.swatches(productId);
    expect(list[0]!.variantId).toBe(alive);
    expect(list[0]!.variantId).not.toBe(sold);
    expect(list[0]!.available).toBe(7);
  });

  it('اگر هیچ‌کدام موجود نباشد، نخستین برگزیده می‌شود (با پرچمِ تمام‌شده)', async () => {
    await variant({ sku: 'L-1', colour: 'مشکی', stock: 0 });
    await variant({ sku: 'L-2', colour: 'آبی', stock: 0 });

    const list = await colours.swatches(productId);
    expect(list[0]!.variantId).toBeTruthy();
    expect(list[0]!.outOfStock).toBe(true);
  });
});

describe('برگزیدنِ تنوع با گوشیِ کاربر', () => {
  it('رنگ + مدلِ گوشی = تنوعِ درست', async () => {
    // مدلِ گوشی نیازمندِ برند است (brand_id)، پس نخست برند می‌سازیم
    const brand = await db.query<{ id: string }>(
      `INSERT INTO device_brands (name, slug) VALUES ('Apple', 'apple') RETURNING id`,
    );
    const model = await db.query<{ id: string }>(
      `INSERT INTO device_models (brand_id, name, slug) VALUES ($1, 'iPhone 13', 'iphone-13') RETURNING id`,
      [brand.rows[0]!.id],
    );
    const modelId = model.rows[0]!.id;

    const s23 = await variant({ sku: 'M-S23', colour: 'مشکی', stock: 5 });
    const i13 = await variant({ sku: 'M-13', colour: 'مشکی', stock: 5 });
    await db.query(
      `INSERT INTO product_compatibility (variant_id, device_model_id) VALUES ($1,$2), ($3,$2)`,
      [i13, modelId, s23],
    );

    const picked = await colours.pickVariant(productId, 'مشکی', modelId);
    expect(picked).toBe(i13);
  });

  it('بی‌مدل، همان تنوعِ پیش‌فرضِ رنگ', async () => {
    const only = await variant({ sku: 'N-1', colour: 'آبی', stock: 1 });
    expect(await colours.pickVariant(productId, 'آبی', null)).toBe(only);
  });
});
