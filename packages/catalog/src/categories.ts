/**
 * درختِ دسته‌بندی.
 *
 * چهار قاعده اینجا بیشتر از خودِ ساختارِ درخت اهمیت دارد، چون هر کدام
 * پاسخِ یک خطایِ واقعی است:
 *
 *  ۱. **کالاهایِ زیردسته‌ها را هم بشمار**. خریداری که روی «شارژر و آداپتور»
 *     می‌زند، انتظار دارد شارژرِ دیواری را هم ببیند — نه اینکه با پنج کالا
 *     روبه‌رو شود چون بقیه در زیردسته‌ها پنهان‌اند. پس شمارش و فیلتر «با
 *     فرزندان» است، مگر آنکه خواسته شود فقط خودش.
 *  ۲. **دسته‌یِ تهی نمایش داده نمی‌شود**. منویی که ده برگه‌یِ خالی نشان
 *     بدهد، خریدار را به بن‌بست می‌برد. چیزی که کالا ندارد (نه در خودش و نه
 *     در فرزندانش) در منو نمی‌آید — ولی در پنل هست، چون فروشنده باید بتواند
 *     پیشاپیش دسته بسازد.
 *  ۳. **جابه‌جایی مسیر را درست می‌کند**. انتقالِ یک شاخه، مسیرِ فرزندانش را
 *     هم عوض می‌کند؛ این در پایگاه (تریگر) انجام می‌شود، نه در اینجا، تا هیچ
 *     فراخوانی یادش نرود.
 *  ۴. **حذف بی‌تکلیف ممنوع**. دسته‌ای که کالا یا فرزند دارد پاک نمی‌شود مگر
 *     اینکه مقصدِ کالاها روشن باشد؛ وگرنه کالاهایش بی‌دسته می‌مانند و از
 *     هیچ مسیری پیدا نمی‌شوند.
 */

import { AppError } from '@set/shared-kernel';
import type { Database, Queryable } from '@set/db';

import { cachedList, clearSearchCache, searchCacheKey } from './query-cache.js';

export interface Category {
  id: string;
  key: string;
  name: string;
  slug: string;
  parentId: string | null;
  depth: number;
  path: string;
  sortOrder: number;
  isActive: boolean;
  description: string | null;
  imageUrl: string | null;
  /** شمارِ کالاهایِ خودِ دسته (بدونِ زیردسته‌ها) */
  ownCount: number;
  /** شمارِ کالاهایِ دسته **با** همه‌یِ زیردسته‌ها — آنچه خریدار می‌بیند */
  totalCount: number;
}

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

/** ردیفِ خامِ پایگاه */
interface Row {
  id: string;
  key: string;
  name: string;
  slug: string;
  parent_id: string | null;
  depth: number;
  path: string;
  sort_order: number;
  is_active: boolean;
  description: string | null;
  image_url: string | null;
  own_count: string | number | null;
  total_count: string | number | null;
}

function toCategory(row: Row): Category {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    slug: row.slug,
    parentId: row.parent_id,
    depth: Number(row.depth ?? 0),
    path: row.path ?? '',
    sortOrder: Number(row.sort_order ?? 0),
    isActive: Boolean(row.is_active),
    description: row.description,
    imageUrl: row.image_url,
    ownCount: Number(row.own_count ?? 0),
    totalCount: Number(row.total_count ?? 0),
  };
}

/** ژرفاترین سطحِ مجاز (۰ = ریشه) */
export const MAX_DEPTH = 2;

/** نامک را می‌سازد: فارسی را نگه می‌داریم (نشانیِ فارسی برایِ مشتری خواناتر است) */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * شمارشِ کالاها: مستقیم برایِ خودِ دسته، و بازگشتی برایِ زیردسته‌ها.
 *
 * چرا در یک پرس‌وجو؟ چون درختِ کالا برایِ هر بازدید خوانده می‌شود؛ اگر برای
 * هر گره یک پرس‌وجو می‌فرستادیم، ده گره یعنی ده رفت‌وبرگشت — و این همان
 * هزینه‌ای است که صفحه را در بارِ واقعی زمین می‌اندازد.
 */
const COUNT_SQL = `
  WITH RECURSIVE sub AS (
      SELECT id, id AS root_id FROM product_types
    UNION ALL
      SELECT c.id, sub.root_id FROM product_types c JOIN sub ON c.parent_id = sub.id
  ),
  totals AS (
      SELECT sub.root_id AS id, COUNT(DISTINCT p.id)::text AS n
        FROM sub
        LEFT JOIN products p ON p.type_id = sub.id AND p.status = 'active'
       GROUP BY sub.root_id
  )
`;

export class CategoryService {
  constructor(private readonly db: Database | Queryable) {}

  // ─────────────────────────────────────────────────────────────────────────
  // خواندنِ عمومی
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * درختِ کامل برایِ منو.
   *
   * `onlyWithProducts` پیش‌فرض است برایِ نمایشِ عمومی: دسته‌ای که در خودش و
   * در هیچ فرزندی کالایی ندارد، در منویِ خریدار نمی‌آید.
   */
  /**
   * درخت برایِ منویِ عمومی — کش‌شده با **همان سیاستِ کشِ جستجو**
   * (`search_cache_seconds`، §«کشِ پرسش‌هایِ پُرتکرار»).
   *
   * چرا گران‌ترینِ این چهار فهرست است؟ چون `fetchRows` برایِ **هر** دسته،
   * شمارِ کالاهایِ فعال را از نو می‌شمارد (`COUNT` رویِ `products`). رویِ
   * کاتالوگِ ۲۰٬۰۰ کالایی این یعنی چندین ده میلی‌ثانیه در **هر** بازدید —
   * در حالی که نتیجه فقط وقتی عوض می‌شود که فروشنده کالا یا دسته بسازد/بزند/
   * منتشر کند. آن نوشتن‌ها کش را می‌شکنند (پایینِ همین پرونده)، پس «منو
   * کهنه است» ممکن نیست؛ فقط «دوباره حساب نکردیم».
   *
   * برگشت، سه تکه‌ای است: `items` (همان درختِ قدیم)، `cached` و `cacheAgeMs`
   * — تا پاسخِ HTTP بگوید این بار از کش آمد یا نه (سنجه‌ها همین را می‌خوانند).
   */
  async tree(
    options: { onlyActive?: boolean; onlyWithProducts?: boolean } = {},
  ): Promise<{ items: CategoryNode[]; cached: boolean; cacheAgeMs: number }> {
    const onlyActive = options.onlyActive ?? true;
    const onlyWithProducts = options.onlyWithProducts ?? true;
    // کلید، هر دو گزینش را می‌بیند تا `?all=true` (منویِ پنل) با منویِ خریدار
    // یک کشِ اشتراکی نداشته باشند و «فیلتر زدم و همان منویِ قبلی را دیدم»
    // ممکن نشود.
    const key = searchCacheKey({ list: 'categories', onlyActive, onlyWithProducts });
    return cachedList(this.db, key, () => this.buildTree(onlyActive, onlyWithProducts));
  }

  private async buildTree(onlyActive: boolean, onlyWithProducts: boolean): Promise<CategoryNode[]> {
    const rows = await this.fetchRows({ onlyActive });
    const items = rows.map(toCategory);

    // مجموعِ هر گره = کالاهایِ خودش + فرزندانش (رویِ درخت بالا می‌رود)
    const byId = new Map(items.map((item) => [item.id, { ...item, children: [] as CategoryNode[] }]));
    const totals = new Map(items.map((item) => [item.id, item.ownCount]));
    for (const item of [...items].sort((a, b) => b.depth - a.depth)) {
      if (item.parentId) {
        totals.set(item.parentId, (totals.get(item.parentId) ?? 0) + (totals.get(item.id) ?? 0));
      }
    }
    for (const [id, node] of byId) node.totalCount = totals.get(id) ?? node.ownCount;

    const roots: CategoryNode[] = [];
    for (const item of items) {
      const node = byId.get(item.id)!;
      const parent = item.parentId ? byId.get(item.parentId) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    const sortTree = (nodes: CategoryNode[]): CategoryNode[] => {
      nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'fa'));
      for (const node of nodes) sortTree(node.children);
      return nodes;
    };
    sortTree(roots);

    // هر شاخه‌ای که در خودش و فرزندانش کالا ندارد، کنار می‌رود
    const prune = (nodes: CategoryNode[]): CategoryNode[] =>
      nodes
        .map((node) => ({ ...node, children: prune(node.children) }))
        .filter((node) => !onlyWithProducts || node.totalCount > 0);

    return onlyWithProducts ? prune(roots) : roots;
  }

  /** فهرستِ تخت با رعایتِ ترتیبِ درخت — برایِ پنل و برایِ آبشاریِ انتخابگرها */
  async flat(options: { onlyActive?: boolean } = {}): Promise<Category[]> {
    const rows = await this.fetchRows({ onlyActive: options.onlyActive ?? false });
    return rows
      .map(toCategory)
      .sort((a, b) => a.path.localeCompare(b.path, 'fa') || a.sortOrder - b.sortOrder);
  }

  private async fetchRows(options: { onlyActive: boolean }): Promise<Row[]> {
    const res = await this.db.query<Row>(
      `${COUNT_SQL}
       SELECT t.id, t.key, t.name, t.slug, t.parent_id, t.depth, t.path,
              t.sort_order, t.is_active, t.description, t.image_url,
              (SELECT COUNT(*)::text FROM products p WHERE p.type_id = t.id AND p.status = 'active') AS own_count,
              COALESCE(totals.n, '0') AS total_count
         FROM product_types t
         LEFT JOIN totals ON totals.id = t.id
        WHERE ($1::boolean = false OR t.is_active = true)
        ORDER BY t.depth, t.sort_order, t.name`,
      [options.onlyActive],
    );
    return res.rows;
  }

  /** یک گره با نیاکان (نانِ راهنما) و فرزندانش */
  async bySlug(
    slug: string,
    options: { onlyActive?: boolean } = {},
  ): Promise<{ category: Category; ancestors: Category[]; children: Category[] }> {
    const all = await this.flat({ onlyActive: options.onlyActive ?? true });
    const found = all.find((item) => item.slug === slug || item.key === slug);
    if (!found) throw new AppError('NOT_FOUND', { message: 'دسته یافت نشد.' });

    const ancestors: Category[] = [];
    let cursor = found.parentId;
    while (cursor) {
      const parent = all.find((item) => item.id === cursor);
      if (!parent) break;
      ancestors.unshift(parent);
      cursor = parent.parentId;
    }
    const children = all
      .filter((item) => item.parentId === found.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'fa'));

    return { category: found, ancestors, children };
  }

  /** شناسه‌هایِ یک گره و همه‌یِ فرزندانش — برایِ فیلترِ جستجو */
  async descendantIds(idOrSlug: string): Promise<string[]> {
    const res = await this.db.query<{ id: string }>(
      `WITH RECURSIVE sub AS (
          SELECT id FROM product_types WHERE (id::text = $1 OR slug = $1 OR key = $1)
        UNION
          SELECT c.id FROM product_types c JOIN sub ON c.parent_id = sub.id
       )
       SELECT id FROM sub`,
      [idOrSlug],
    );
    return res.rows.map((row) => row.id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // نوشتن (پنل)
  // ─────────────────────────────────────────────────────────────────────────

  async create(input: {
    name: string;
    key?: string;
    slug?: string;
    parentId?: string | null;
    description?: string | null;
    imageUrl?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  }): Promise<Category> {
    const name = (input.name ?? '').trim();
    if (name.length === 0) throw new AppError('VALIDATION', { message: 'نامِ دسته را بنویسید.' });

    const parentId = input.parentId ?? null;
    if (parentId) await this.ensureExists(parentId);

    // سه سطح (ریشه، گروه، برگ) — یعنی ژرفایِ ۰ تا ۲. سطحِ چهارم در منویِ
    // آبشاری جایی ندارد (منو ریشه و فرزندانش را نشان می‌دهد) و کالایی که در
    // آن بنشیند تنها از مسیرِ فیلتر پیدا می‌شود؛ جایی که خریدار دنبالش
    // نمی‌گردد. پس بهتر است از همان آغاز راهش ندهیم.
    const depth = parentId ? (await this.depthOf(parentId)) + 1 : 0;
    if (depth > MAX_DEPTH) {
      throw new AppError('VALIDATION', { message: 'ژرفایِ درخت بیش از سه سطح نمی‌شود؛ منو ناخوانا می‌گردد.' });
    }

    const key = (input.key ?? '').trim() || this.uniqueKey(name, parentId);
    const slug = slugify(input.slug ?? name) || this.uniqueKey(name, parentId);

    const duplicate = await this.db.query<{ id: string }>(
      `SELECT id FROM product_types WHERE slug = $1 OR key = $2`,
      [slug, key],
    );
    if (duplicate.rows.length > 0) {
      throw new AppError('VALIDATION', { message: 'دسته‌ای با این نام یا کلید از پیش هست.' });
    }

    const res = await this.db.query<{ id: string }>(
      `INSERT INTO product_types (key, name, slug, parent_id, sort_order, is_active, description, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        key,
        name,
        slug,
        parentId,
        input.sortOrder ?? await this.nextSortOrder(parentId),
        input.isActive ?? true,
        input.description ?? null,
        input.imageUrl ?? null,
      ],
    );
    const id = res.rows[0]?.id;
    if (!id) throw new AppError('INTERNAL', { message: 'دسته ساخته نشد؛ دوباره تلاش کنید.' });
    // منو تازه شد؛ کشِ درخت (و کشِ جستجو) را می‌شکنیم تا فروشنده **همین حالا**
    // دستهٔ تازه را ببیند — صبرِ TTL برایِ چیزی که او چند ثانیه پیش ساخت،
    // از نگاهش «باگ» است.
    clearSearchCache(this.db);
    return this.mustGet(id);
  }

  async update(
    id: string,
    patch: {
      name?: string;
      slug?: string;
      description?: string | null;
      imageUrl?: string | null;
      sortOrder?: number;
      isActive?: boolean;
    },
  ): Promise<Category> {
    await this.ensureExists(id);
    if (patch.name !== undefined && patch.name.trim().length === 0) {
      throw new AppError('VALIDATION', { message: 'نامِ دسته نمی‌تواند تهی باشد.' });
    }
    const res = await this.db.query<{ id: string }>(
      `UPDATE product_types
          SET name        = COALESCE($2, name),
              slug        = COALESCE($3, slug),
              description = CASE WHEN $4::boolean THEN $5::text ELSE description END,
              image_url   = CASE WHEN $6::boolean THEN $7::text ELSE image_url END,
              sort_order  = COALESCE($8, sort_order),
              is_active   = COALESCE($9, is_active)
        WHERE id = $1
        RETURNING id`,
      [
        id,
        patch.name?.trim() ?? null,
        patch.slug ? slugify(patch.slug) : null,
        patch.description !== undefined,
        patch.description ?? null,
        patch.imageUrl !== undefined,
        patch.imageUrl ?? null,
        patch.sortOrder ?? null,
        patch.isActive ?? null,
      ],
    );
    if (res.rows.length === 0) throw new AppError('NOT_FOUND', { message: 'دسته یافت نشد.' });
    clearSearchCache(this.db);
    return this.mustGet(id);
  }

  /**
   * جابه‌جاییِ یک شاخه زیرِ پدری دیگر.
   *
   * چرخه را پایگاه می‌گیرد (تریگر)، و مسیرِ فرزندان را هم خودش درست
   * می‌کند؛ اینجا تنها ژرفا را می‌سنجیم تا منو از سه سطح فراتر نرود.
   */
  async move(id: string, newParentId: string | null): Promise<Category> {
    await this.ensureExists(id);
    if (newParentId) {
      await this.ensureExists(newParentId);
      if (newParentId === id) {
        throw new AppError('VALIDATION', { message: 'دسته نمی‌تواند زیرِ خودش برود.' });
      }
      // ژرفایِ تازه = ژرفایِ پدر + ۱ + بلندترین دنباله‌یِ فرزندانِ این شاخه
      const parentDepth = await this.depthOf(newParentId);
      const branchHeight = await this.heightOf(id);
      if (parentDepth + 1 + branchHeight > MAX_DEPTH) {
        throw new AppError('VALIDATION', {
          message: 'با این جابه‌جایی، درخت از سه سطح ژرف‌تر می‌شود؛ نخست فرزندان را جابه‌جا کنید.',
        });
      }
    }

    const res = await this.db.query<{ id: string }>(
      `UPDATE product_types SET parent_id = $2 WHERE id = $1 RETURNING id`,
      [id, newParentId],
    );
    if (res.rows.length === 0) throw new AppError('NOT_FOUND', { message: 'دسته یافت نشد.' });
    // جابه‌جاییِ شاخه، «کالاهایِ این دسته و زیردسته‌ها» را هم جابه‌جا می‌کند —
    // یعنی هم درخت و هم نتایجِ `cat=`ِ جستجو عوض شدند؛ هر دو کش شکسته می‌شوند.
    clearSearchCache(this.db);
    return this.mustGet(id);
  }

  /** چیدنِ فرزندانِ یک پدر به ترتیبِ دلخواه */
  async reorder(parentId: string | null, ids: string[]): Promise<void> {
    for (let index = 0; index < ids.length; index += 1) {
      await this.db.query(`UPDATE product_types SET sort_order = $2 WHERE id = $1`, [ids[index], index]);
    }
    clearSearchCache(this.db);
  }

  /**
   * حذف — فقط اگر تهی باشد، یا اگر مقصدِ کالاها و فرزندانش روشن شده باشد.
   *
   * چرا این قدر سخت‌گیر؟ چون پاک کردنِ یک دسته با صد کالا، صد کالا را از
   * همه‌یِ مسیرهایِ پیدا کردن بیرون می‌اندازد؛ و فروشنده که فردا پشیمان
   * شود، چیزی برایِ بازگرداندن ندارد.
   */
  async remove(id: string, options: { moveProductsTo?: string | null; moveChildrenTo?: string | null } = {}): Promise<{
    removed: boolean;
    movedProducts: number;
    movedChildren: number;
  }> {
    const category = await this.mustGet(id);
    const children = (await this.flat({ onlyActive: false })).filter((item) => item.parentId === id);

    if (category.ownCount > 0) {
      const target = options.moveProductsTo;
      if (!target) {
        throw new AppError('VALIDATION', {
          message: `این دسته ${category.ownCount} کالا دارد؛ نخست کالاها را به دسته‌یِ دیگری منتقل کنید.`,
        });
      }
      await this.ensureExists(target);
    }
    if (children.length > 0 && !options.moveChildrenTo) {
      throw new AppError('VALIDATION', {
        message: `این دسته ${children.length} زیردسته دارد؛ نخست آن‌ها را جابه‌جا کنید.`,
      });
    }
    if (options.moveChildrenTo) await this.ensureExists(options.moveChildrenTo);

    let movedProducts = 0;
    let movedChildren = 0;

    if (options.moveProductsTo) {
      const res = await this.db.query<{ id: string }>(
        `UPDATE products SET type_id = $2 WHERE type_id = $1 RETURNING id`,
        [id, options.moveProductsTo],
      );
      movedProducts = res.rows.length;
    }
    if (options.moveChildrenTo) {
      const res = await this.db.query<{ id: string }>(
        `UPDATE product_types SET parent_id = $2 WHERE parent_id = $1 RETURNING id`,
        [id, options.moveChildrenTo],
      );
      movedChildren = res.rows.length;
    }

    const res = await this.db.query<{ id: string }>(`DELETE FROM product_types WHERE id = $1 RETURNING id`, [id]);
    if (res.rows.length > 0) {
      // کالاها هم جابه‌جا شدند (type_id)؛ پس کشِ جستجو هم باید برود، نه فقط درخت.
      clearSearchCache(this.db);
    }
    return { removed: res.rows.length > 0, movedProducts, movedChildren };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // کمکی
  // ─────────────────────────────────────────────────────────────────────────

  private async mustGet(id: string): Promise<Category> {
    const res = await this.db.query<Row>(
      `SELECT t.id, t.key, t.name, t.slug, t.parent_id, t.depth, t.path,
              t.sort_order, t.is_active, t.description, t.image_url,
              (SELECT COUNT(*)::text FROM products p WHERE p.type_id = t.id AND p.status = 'active') AS own_count,
              '0' AS total_count
         FROM product_types t WHERE t.id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) throw new AppError('NOT_FOUND', { message: 'دسته یافت نشد.' });
    return toCategory(row);
  }

  private async ensureExists(id: string): Promise<void> {
    const res = await this.db.query<{ id: string }>(`SELECT id FROM product_types WHERE id = $1`, [id]);
    if (res.rows.length === 0) throw new AppError('NOT_FOUND', { message: 'دسته‌یِ مقصد یافت نشد.' });
  }

  private async depthOf(id: string): Promise<number> {
    const res = await this.db.query<{ depth: number }>(`SELECT depth FROM product_types WHERE id = $1`, [id]);
    return Number(res.rows[0]?.depth ?? 0);
  }

  /** بلندترین دنباله‌یِ فرزندانِ یک گره (۰ یعنی برگ است) */
  private async heightOf(id: string): Promise<number> {
    const res = await this.db.query<{ h: string }>(
      `WITH RECURSIVE down AS (
          SELECT id, 0 AS h FROM product_types WHERE id = $1
        UNION ALL
          SELECT c.id, down.h + 1 FROM product_types c JOIN down ON c.parent_id = down.id
       )
       SELECT COALESCE(MAX(h), 0)::text AS h FROM down`,
      [id],
    );
    return Number(res.rows[0]?.h ?? 0);
  }

  private async nextSortOrder(parentId: string | null): Promise<number> {
    const res = await this.db.query<{ n: string }>(
      `SELECT COALESCE(MAX(sort_order) + 1, 0)::text AS n FROM product_types
        WHERE parent_id IS NOT DISTINCT FROM $1`,
      [parentId],
    );
    return Number(res.rows[0]?.n ?? 0);
  }

  /** کلیدی یکتا از نام — برایِ آنکه فروشنده مجبور نباشد کلیدِ لاتین بسازد */
  private uniqueKey(name: string, parentId: string | null): string {
    const base = slugify(name) || `cat-${Math.random().toString(36).slice(2, 8)}`;
    return parentId ? `${base}-${parentId.slice(0, 4)}` : base;
  }
}
