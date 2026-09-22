import type { Database } from '@set/db';

/**
 * مقایسه‌یِ کالا — «این شارژر را با آن بگذار در کنارِ هم».
 *
 * چرا این صفحه را داریم؟ چون رقابت با دیجی‌کالا در «تعدادِ کالاها» نیست،
 * در تصمیمِ خریدار است: سه شارژرِ ۲۰ وات را یکی‌یکی باز کنی و در حافظه‌ات
 * نگه داری، یا یک بار در کنارِ هم ببینی. برایِ لوازمِ همراه — که تفاوت‌ها
 * پنهان در اعدادِ ریزند (توان، طولِ کابل، جنس) — این اختلافِ کوچک، خریدِ
 * درست را از خریدِ پشیمانی جدا می‌کند.
 *
 * دو تصمیم:
 *  ۱) **چهار سقف است، نه ده.** بیشتر از چهار ستون، جدول در موبایل قابل
 *     خواندن نیست. خریدار که پنج کالا می‌خواهد، خودش انتخاب می‌کند کدام
 *     چهارتایش مهم است — و این انتخاب، بخشی از تصمیم است.
 *  ۲) **سری‌های مشخصات، متحدِ کلیدهاست.** هر کالا ویژگی‌هایِ خودش را دارد
 *     (یکی «توان»، دیگری «طول»). جدول باید کلیدهایِ هر چهار را نشان دهد و
 *     جایی که کالایی ویژگی ندارد، «—» بنشیند — نه اینکه صفح‌ها را به هم
 *     براند. ترتیبِ کلیدها از نخستین کالا می‌آید (آنچه فروشنده برایش
 *     مهم‌تر دیده)، پس دو مقایسه با همان کالاها یکسان دیده می‌شود.
 */

export const COMPARE_MAX = 4;

export interface CompareItem {
  slug: string;
  title: string;
  brand: string | null;
  /** ارزان‌ترین تنوعِ فعال — همان عددی که رویِ صفحه‌یِ کالا دیده می‌شود */
  minPriceRial: number;
  /** برایِ «افزودن به سبد» از همین صفحه — ارزان‌ترین تنوعِ فعال */
  defaultVariantId: string | null;
  /** تخفیفِ جاری (فقط در بازهٔ اعتبار) — وگرنه null */
  discountPercent: number | null;
  /** موجودیِ قابلِ فروش (فروختنی: on_hand − reserved) */
  available: number;
  imageUrl: string | null;
  /** میانگینِ فقطِ نظراتِ منتشرشده — وگرنه null (امتیازی ثبت نشده) */
  rating: number | null;
  reviewCount: number;
}

export interface CompareSpecRow {
  /** کلیدِ ویژگی (مثلِ power_watt) — همان چیزی که فروشنده در پنل زد */
  key: string;
  /** مقدار برایِ هر کالا — null یعنی این کالا آن ویژگی را ثبت نکرده است */
  values: (string | number | null)[];
}

export interface CompareResult {
  /** به همان ترتیبی که نامک‌ها خواسته شدند — نخستین ستون، انتخابِ خریدار است */
  products: CompareItem[];
  specRows: CompareSpecRow[];
  /** «برندِ مدل» برایِ هر کالا — ستونِ سازگاری (برتریِ ما) */
  deviceModels: string[][];
}

interface ProductRow {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  min_price: string | null;
  default_variant: string | null;
  discount_percent: number | null;
  available: number;
  image_url: string | null;
  rating: number | null;
  review_count: number;
}

interface AttrRow {
  product_id: string;
  values: Record<string, unknown> | null;
}

interface DeviceRow {
  product_id: string;
  model: string;
}

/**
 * چهار کالا را برایِ مقایسه برمی‌گرداند.
 *
 * رفتارهایِ آگاهانه:
 *  • بیش از چهار نامک: چهارتایِ نخست (ترتیبِ درخواست) — خطا نمی‌دهیم؛
 *    خریداری که پنج پیوند را فرستاده، چیزی گناه‌آلود ندیده است.
 *  • نامکِ تکراری: یکی می‌شود — مقایسه‌یِ یک کالا با خودش بی‌معناست.
 *  • نامکِ ناموجود یا کالایِ غیرفعال: ساقط می‌شود. اگر کمتر از دو بماند،
 *    همان خالی برمی‌گردد و صفحه «دست‌کم دو کالا» می‌گوید.
 *  • کالاها به **ترتیبِ درخواست** برمی‌گردند (نه به ترتیبِ قیمت).
 */
export async function compare(db: Database, slugs: string[]): Promise<CompareResult> {
  const wanted = [...new Set(slugs.map((s) => s.trim()).filter(Boolean))].slice(0, COMPARE_MAX);
  if (!wanted.length) return { products: [], specRows: [], deviceModels: [] };

  const { rows } = await db.query<ProductRow>(
    `SELECT p.id, p.title, p.slug, b.name AS brand,
            (SELECT MIN(v.price_rial)::text FROM product_variants v
              WHERE v.product_id = p.id AND v.is_active = true) AS min_price,
            (SELECT v.id FROM product_variants v
              WHERE v.product_id = p.id AND v.is_active = true
              ORDER BY v.price_rial LIMIT 1) AS default_variant,
            (CASE WHEN (p.discount_starts_at IS NULL OR p.discount_starts_at <= now())
                    AND (p.discount_ends_at IS NULL OR p.discount_ends_at >= now())
                  THEN p.discount_percent END)::int AS discount_percent,
            COALESCE((SELECT SUM(s.on_hand - s.reserved) FROM stock_items s
                        JOIN product_variants v ON v.id = s.variant_id
                       WHERE v.product_id = p.id AND v.is_active = true), 0)::int AS available,
            img.url AS image_url,
            (SELECT ROUND(AVG(r.rating)::numeric, 1)::float FROM product_reviews r
              WHERE r.product_id = p.id AND r.status = 'approved') AS rating,
            (SELECT COUNT(*)::int FROM product_reviews r
              WHERE r.product_id = p.id AND r.status = 'approved') AS review_count
       FROM products p
       LEFT JOIN brands b ON b.id = p.brand_id
       LEFT JOIN LATERAL (
         SELECT url FROM product_images pi WHERE pi.product_id = p.id
          ORDER BY (pi.role <> 'main') ASC, pi.sort_order ASC LIMIT 1
       ) img ON true
      WHERE p.slug = ANY($1::text[]) AND p.status = 'active'`,
    [wanted],
  );

  // ترتیبِ درخواست، نه ترتیبِ پایگاه: نخستین ستونِ جدول انتخابِ خریدار است
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const ordered = wanted
    .map((s) => bySlug.get(s))
    .filter((r): r is ProductRow => r !== undefined);

  if (!ordered.length) return { products: [], specRows: [], deviceModels: [] };

  const ids = ordered.map((r) => r.id);

  const [attrRes, deviceRes] = await Promise.all([
    db.query<AttrRow>(`SELECT product_id, values FROM product_attributes WHERE product_id = ANY($1::uuid[])`, [ids]),
    db.query<DeviceRow>(
      `SELECT v.product_id, db.name || ' ' || dm.name AS model
         FROM product_compatibility pc
         JOIN product_variants v ON v.id = pc.variant_id
         JOIN device_models dm ON dm.id = pc.device_model_id
         JOIN device_brands db ON db.id = dm.brand_id
        WHERE v.product_id = ANY($1::uuid[])
        ORDER BY db.name, dm.name`,
      [ids],
    ),
  ]);

  const attrsById = new Map(attrRes.rows.map((r) => [r.product_id, r.values ?? {}]));
  const devicesByProduct: Record<string, string[]> = {};
  for (const row of deviceRes.rows) {
    (devicesByProduct[row.product_id] ??= []).push(row.model);
  }

  // متحِدِ کلیدها با ترتیبِ نخست‌دید: کلیدهایِ کالا۱، سپس تازه‌واردهایِ ۲، ۳، ۴
  const keys: string[] = [];
  for (const id of ids) {
    for (const key of Object.keys(attrsById.get(id) ?? {})) {
      if (!keys.includes(key)) keys.push(key);
    }
  }

  const attrRows = keys.map((key) => ({
    key,
    values: ordered.map((r) => {
      const v = (attrsById.get(r.id) ?? {})[key];
      return v === undefined || v === null ? null : (v as string | number);
    }),
  }));

  return {
    products: ordered.map((r) => ({
      slug: r.slug,
      title: r.title,
      brand: r.brand,
      minPriceRial: r.min_price !== null ? Number(r.min_price) : 0,
      defaultVariantId: r.default_variant,
      discountPercent: r.discount_percent,
      available: r.available,
      imageUrl: r.image_url,
      rating: r.rating,
      reviewCount: r.review_count,
    })),
    specRows: attrRows,
    deviceModels: ordered.map((r) => devicesByProduct[r.id] ?? []),
  };
}
