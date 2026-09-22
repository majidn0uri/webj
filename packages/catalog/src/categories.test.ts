import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations, createDatabase, type Database } from '@set/db';

import { CategoryService, slugify } from './categories.js';

import { clearSearchCache } from './query-cache.js';

/**
 * آزمونِ درختِ دسته‌بندی.
 *
 * آنچه اینجا می‌سنجد «ذخیره و بازیابیِ یک ردیف» نیست؛ آن را هر کدی بلد است.
 * موضوع، خطاهایی است که در درخت‌ها همیشه رخ می‌دهند و چون در داده‌یِ کم
 * دیده نمی‌شوند، در بارِ واقعی بیرون می‌زنند:
 *
 *   • چرخه — دسته‌ای که زیرِ خودش برود و درخت را بی‌انتها کند؛
 *   • مسیرِ کهنه — پس از جابه‌جایی، نانِ راهنما نشانیِ پیشین را بدهد؛
 *   • شمارشِ نادرست — خریدار روی «شارژر» بزند و کالاهایِ زیردسته را نبیند؛
 *   • حذفِ بی‌تکلیف — دسته‌ای با کالا پاک شود و کالاهایش بی‌مسیر بمانند.
 */

let db: Database;
let categories: CategoryService;

/**
 * چرا یک پایگاهِ مشترک، نه یکی برایِ هر آزمون؟
 *
 * هر نمونه‌یِ پایگاهِ درون‌حافظه همه‌یِ ۲۹ مهاجرت را در خود دارد. با ۲۶
 * آزمون یعنی ۲۶ پایگاهِ کامل — و در این محیط (۲ گیگابایت) کارگرِ آزمون در
 * میانه کشته می‌شد و آزمون‌هایی بی‌تقصیر «ناکام» گزارش می‌شدند. پس یک
 * پایگاه می‌سازیم و پس از هر آزمون وضعیت را به نقطه‌یِ آغاز برمی‌گردانیم:
 * ارزان‌تر، و مهم‌تر، اینکه نتیجه‌یِ آزمون از حافظه‌یِ محیط مستقل بماند.
 */
let baseline: Array<{
  id: string; key: string; name: string; slug: string; parentId: string | null;
  depth: number; path: string; sortOrder: number; isActive: boolean;
}> = [];

beforeAll(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  categories = new CategoryService(db);
  const res = await db.query<{
    id: string; key: string; name: string; slug: string; parent_id: string | null;
    depth: number; path: string; sort_order: number; is_active: boolean;
  }>(`SELECT id, key, name, slug, parent_id, depth, path, sort_order, is_active
        FROM product_types ORDER BY depth`);
  baseline = res.rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    slug: row.slug,
    parentId: row.parent_id,
    depth: row.depth,
    path: row.path,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }));
});

afterAll(async () => {
  await db.close();
});

/** بازگردانی به وضعیتِ پس از مهاجرت — پیش از هر آزمونِ تازه */
afterEach(async () => {
  // ۱) کالاهایِ ساخته‌شده (با فرزندانشان)
  await db.query(`DELETE FROM product_variants`);
  await db.query(`DELETE FROM products`);

  // ۲) بازسازیِ دسته‌هایِ بنیادی‌ای که آزمون پاک کرده است — از ریشه به برگ
  for (const item of baseline) {
    await db.query(
      `INSERT INTO product_types (id, key, name, slug, parent_id, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [item.id, item.key, item.name, item.slug, item.parentId, item.sortOrder, item.isActive],
    );
  }

  // ۳) هر دسته‌یِ بنیادی به جایِ خود (تریگر مسیر و ژرفا را درست می‌کند)
  for (const item of baseline) {
    await db.query(
      `UPDATE product_types
          SET parent_id = $2, slug = $3, name = $4, sort_order = $5, is_active = $6
        WHERE id = $1`,
      [item.id, item.parentId, item.slug, item.name, item.sortOrder, item.isActive],
    );
  }

  // ۴) اکنون که دسته‌هایِ بنیادی سرِ جایشان‌اند، مازادِ آزمون پاک می‌شود
  const keep = baseline.map((item) => item.id);
  for (let round = 0; round < 4; round += 1) {
    const res = await db.query<{ id: string }>(
      `DELETE FROM product_types
        WHERE NOT (id = ANY($1::uuid[]))
          AND NOT EXISTS (SELECT 1 FROM product_types c
                           WHERE c.parent_id = product_types.id
                             AND NOT (c.id = ANY($1::uuid[])))
        RETURNING id`,
      [keep],
    );
    if (res.rows.length === 0) break;
  }
});

/** یک کالایِ منتشرشده در یک دسته می‌سازد (کالا نخست، سپس تنوعش) */
async function product(typeId: string, title = 'کالا'): Promise<string> {
  const row = await db.query<{ id: string }>(
    `INSERT INTO products (type_id, title, slug, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    [typeId, title, `p-${Math.random().toString(36).slice(2, 9)}`],
  );
  const id = row.rows[0]!.id;
  await db.query(
    `INSERT INTO product_variants (product_id, sku, price_rial) VALUES ($1, $2, 100000)`,
    [id, `SKU-${Math.random().toString(36).slice(2, 9)}`],
  );
  // دور‌زنِ سرویس: این آزمون‌ها کالا را با SQLِ خام می‌سازند (مثلِ اسکریپتِ
  // وارداتِ فروشنده)، و نوشتنِ خام کش را نمی‌شکند — قراردادِ رسمی همین است:
  // «تا TTL کهنه می‌ماند، دکمهٔ پنل همان لحظه درستش می‌کند». اینجا هم همان
  // دکمه را می‌زنیم تا آزمونیِ «شمارش» با کشِ درخت قاطی نشود.
  clearSearchCache(db);
  return id;
}

async function typeId(key: string): Promise<string> {
  const res = await db.query<{ id: string }>(`SELECT id FROM product_types WHERE key = $1`, [key]);
  return res.rows[0]!.id;
}

describe('درختِ آغازین', () => {
  it('پنج دسته‌یِ ریشه دارد و هر یک زیردسته‌هایی', async () => {
    const tree = (await categories.tree({ onlyWithProducts: false })).items;
    expect(tree.length).toBeGreaterThanOrEqual(5);
    expect(tree.every((node) => node.depth === 0)).toBe(true);

    const charger = tree.find((node) => node.key === 'charger');
    expect(charger?.children.map((child) => child.key)).toContain('wall-charger');
  });

  it('مسیر و ژرفا برایِ فرزندان درست نشسته است', async () => {
    const flat = await categories.flat();
    const wall = flat.find((item) => item.key === 'wall-charger');
    expect(wall?.depth).toBe(1);
    expect(wall?.path).toBe('/charger/wall-charger');
  });

  it('دسته‌یِ تهی در منویِ خریدار نمی‌آید', async () => {
    const all = (await categories.tree({ onlyWithProducts: false })).items;
    const shown = (await categories.tree({ onlyWithProducts: true })).items;
    // هیچ کالایی نساخته‌ایم، پس منویِ عمومی باید تهی باشد
    expect(all.length).toBeGreaterThan(0);
    expect(shown).toHaveLength(0);
  });
});

describe('شمارش', () => {
  it('کالایِ زیردسته در شمارشِ پدر هم می‌آید', async () => {
    const wall = await typeId('wall-charger');
    await product(wall);

    const tree = (await categories.tree({ onlyWithProducts: true })).items;
    const charger = tree.find((node) => node.key === 'charger');
    expect(charger?.totalCount).toBe(1);
    expect(charger?.ownCount).toBe(0);

    const child = charger?.children.find((node) => node.key === 'wall-charger');
    expect(child?.ownCount).toBe(1);
    expect(child?.totalCount).toBe(1);
  });

  it('کالایِ خودِ پدر و زیردسته با هم جمع می‌شود', async () => {
    await product(await typeId('charger'));
    await product(await typeId('wall-charger'));

    const tree = (await categories.tree({ onlyWithProducts: true })).items;
    const charger = tree.find((node) => node.key === 'charger');
    expect(charger?.totalCount).toBe(2);
    expect(charger?.ownCount).toBe(1);
  });

  it('کالایِ پیش‌نویس شمرده نمی‌شود', async () => {
    const id = await db.query<{ id: string }>(
      `INSERT INTO products (type_id, title, slug, status) VALUES ($1, 'پیش‌نویس', 'draft-1', 'draft') RETURNING id`,
      [await typeId('charger')],
    );
    expect(id.rows[0]).toBeTruthy();
    const tree = (await categories.tree({ onlyWithProducts: false })).items;
    const charger = tree.find((node) => node.key === 'charger');
    expect(charger?.ownCount).toBe(0);
  });
});

describe('ساخت', () => {
  it('دسته‌یِ تازه در جایِ درست می‌نشیند و مسیرش ساخته می‌شود', async () => {
    const parent = await typeId('cable');
    const created = await categories.create({ name: 'کابلِ مغناطیسی', parentId: parent });
    expect(created.depth).toBe(1);
    expect(created.path).toBe('/cable/' + created.slug);
    expect(created.parentId).toBe(parent);
  });

  it('نامِ تهی پذیرفته نمی‌شود', async () => {
    await expect(categories.create({ name: '  ' })).rejects.toThrow(/نامِ دسته/);
  });

  it('دو دسته با یک نام در یک سطح پذیرفته نمی‌شود', async () => {
    await categories.create({ name: 'تکراری' });
    await expect(categories.create({ name: 'تکراری' })).rejects.toThrow(/از پیش/);
  });

  it('سطحِ چهارم پذیرفته نمی‌شود (منو جایش نمی‌دهد)', async () => {
    const a = await categories.create({ name: 'سطح یک' });
    const b = await categories.create({ name: 'سطح دو', parentId: a.id });
    const c = await categories.create({ name: 'سطح سه', parentId: b.id });
    expect(c.depth).toBe(2);
    await expect(categories.create({ name: 'سطح چهار', parentId: c.id })).rejects.toThrow(/سه سطح/);
  });

  it('نامک از نامِ فارسی ساخته می‌شود', () => {
    expect(slugify('شارژرِ دیواری')).toBe('شارژر-دیواری');
    // نیم‌فاصله (ZWNJ) از نامک می‌رود: در نشانی دردسر می‌سازد و دو نویسه‌یِ
    // هم‌شکل پدید می‌آورد که بعداً یکسان یافتنِ دسته را خراب می‌کند.
    expect(slugify('  کابل   تایپ‌سی  ')).toBe('کابل-تایپسی');
  });
});

describe('جابه‌جایی', () => {
  it('انتقالِ شاخه، مسیرِ فرزندانش را هم درست می‌کند', async () => {
    const wall = await typeId('wall-charger');
    await categories.create({ name: 'شارژرِ سریع', parentId: wall });
    await categories.move(wall, await typeId('cable'));

    const flat = await categories.flat();
    const moved = flat.find((item) => item.key === 'wall-charger');
    expect(moved?.path).toBe('/cable/wall-charger');
    const grandchild = flat.find((item) => item.name === 'شارژرِ سریع');
    expect(grandchild?.path).toBe('/cable/wall-charger/' + grandchild?.slug);
    expect(grandchild?.depth).toBe(2);
  });

  it('چرخه رد می‌شود — دسته نمی‌تواند زیرِ فرزندِ خودش برود', async () => {
    const charger = await typeId('charger');
    const wall = await typeId('wall-charger');
    await expect(categories.move(charger, wall)).rejects.toThrow();
  });

  it('دسته نمی‌تواند زیرِ خودش برود', async () => {
    const charger = await typeId('charger');
    await expect(categories.move(charger, charger)).rejects.toThrow(/زیرِ خودش/);
  });

  it('جابه‌جایی به ریشه، ژرفا را صفر می‌کند', async () => {
    const wall = await typeId('wall-charger');
    const moved = await categories.move(wall, null);
    expect(moved.depth).toBe(0);
    expect(moved.path).toBe('/wall-charger');
  });

  it('جابه‌جایی‌ای که شاخه را زیرِ فرزندِ خودش ببرد، رد می‌شود', async () => {
    const a = await categories.create({ name: 'ریشه‌یِ آزمون' });
    const b = await categories.create({ name: 'میانی', parentId: a.id });
    const c = await categories.create({ name: 'برگِ آزمون', parentId: b.id });
    // b زیرِ c یعنی چرخه
    await expect(categories.move(b, c.id)).rejects.toThrow();
  });

  it('جابه‌جایی‌ای که ژرفا را از سه سطح بگذراند، رد می‌شود', async () => {
    const a = await categories.create({ name: 'شاخه‌یِ بلند' });
    const b = await categories.create({ name: 'میانی', parentId: a.id });
    const c = await categories.create({ name: 'برگ', parentId: b.id });
    // انتقالِ a (با دو طبقه زیرش) به زیرِ c یعنی ژرفایِ ۵ — روا نیست
    await expect(categories.move(a.id, c.id)).rejects.toThrow(/سه سطح/);
    // اما انتقالِ یک برگ به ریشه همیشه رواست
    await expect(categories.move(c.id, null)).resolves.toMatchObject({ depth: 0 });
  });
});

describe('نانِ راهنما', () => {
  it('نیاکان از ریشه تا خودِ گره می‌آیند', async () => {
    const { category, ancestors, children } = await categories.bySlug('wall-charger');
    expect(category.key).toBe('wall-charger');
    expect(ancestors.map((item) => item.key)).toEqual(['charger']);
    expect(children.length).toBeGreaterThanOrEqual(0);
  });

  it('دسته‌یِ ریشه نیاکانی ندارد', async () => {
    const { ancestors } = await categories.bySlug('charger');
    expect(ancestors).toHaveLength(0);
  });

  it('دسته‌یِ ناشناس خطا می‌دهد', async () => {
    await expect(categories.bySlug('ندارد-چنین-دسته')).rejects.toThrow(/یافت نشد/);
  });
});

describe('حذف', () => {
  it('دسته‌یِ تهی پاک می‌شود', async () => {
    const created = await categories.create({ name: 'موقت' });
    const result = await categories.remove(created.id);
    expect(result.removed).toBe(true);
  });

  it('دسته‌ای که کالا دارد، بی‌مقصد پاک نمی‌شود', async () => {
    await product(await typeId('charger'));
    const charger = await typeId('charger');
    await expect(categories.remove(charger)).rejects.toThrow(/منتقل کنید/);
  });

  it('با مقصد، کالاها منتقل می‌شوند و سپس دسته پاک می‌شود', async () => {
    await product(await typeId('charger'));
    const charger = await typeId('charger');
    const cable = await typeId('cable');
    // شارژر زیردسته هم دارد؛ پس مقصدِ آن‌ها را هم می‌دهیم
    const result = await categories.remove(charger, { moveProductsTo: cable, moveChildrenTo: cable });
    expect(result.movedProducts).toBe(1);
    expect(result.removed).toBe(true);

    const flat = await categories.flat();
    const moved = flat.find((item) => item.key === 'cable');
    expect(moved?.ownCount).toBe(1);
  });

  it('دسته‌ای که زیردسته دارد، بی‌مقصد پاک نمی‌شود', async () => {
    const charger = await typeId('charger');
    await expect(categories.remove(charger)).rejects.toThrow(/زیردسته/);
  });
});

describe('فیلترِ جستجو', () => {
  it('شناسه‌هایِ فرزندان برایِ فیلتر به دست می‌آیند', async () => {
    const charger = await typeId('charger');
    const ids = await categories.descendantIds('charger');
    expect(ids).toContain(charger);
    expect(ids).toContain(await typeId('wall-charger'));
    expect(ids).toContain(await typeId('car-charger'));
    expect(ids).not.toContain(await typeId('cable'));
  });

  it('یک برگ تنها خودش را برمی‌گرداند', async () => {
    const wall = await typeId('wall-charger');
    expect(await categories.descendantIds('wall-charger')).toEqual([wall]);
  });
});
