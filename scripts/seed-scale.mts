#!/usr/bin/env npx tsx
/**
 * کاشتنِ کالایِ ساختگی برایِ **اندازه‌گیریِ مقیاس** — نه برایِ نمایش.
 *
 * چرا این لازم است؟ چون هر عددی که رویِ کاتالوگِ پنج‌کالاییِ نمونه خوانده شود،
 * عددِ مقیاس نیست: «جستجو ۴ میلی‌ثانیه» رویِ پنج کالا یعنی «هیچ». پرسش‌هایی
 * که در این مخزن باز می‌شوند — «کشِ جستجو چقدر سود دارد؟»، «پویشِ دیسک رویِ
 * صدها‌هزار فایل؟» — تنها رویِ دادهٔ بزرگ جواب دارند. این ابزار همان داده را
 * می‌سازد، با نشانه‌ای که بشود تمیزش کرد (`slug like 'scale-%'`).
 *
 * نکتهٔ مهم: ستونِ `search_document` را **خودِ تریگرِ پایگاه** می‌نویسد (مهاجرتِ
 * ۰۱۰). این‌جا عمداً چیزی دربارهٔ آن نمی‌نویسیم — هم آزمونِ همین است که تریگر
 * کار می‌کند، هم تنها راهِ درست (سرویس‌ها هم مجاز به نوشتنِ مستقیم نیستند).
 *
 * اجرا:
 *   DB_URL="postgres://setshop@/setshop?host=$HOME/.setshop/pgrun&port=5433" \
 *     npx tsx scripts/seed-scale.mts --products 20000
 *   … npx tsx scripts/seed-scale.mts --clean
 */
import process from 'node:process';

import { createDatabase } from '@set/db';

const WORDS = [
  'شارژر', 'کابل', 'هدفون', 'پاوربانک', 'گلس', 'کیف', 'قاب', 'اسپیکر',
  'موس', 'کیبورد', 'شارژر فندکی', 'هوب', 'کارت حافظه', 'مبدل', 'استند',
  'بند ساعت', 'هندزفری', 'پد شارژ', 'رم', 'فلش', 'بک‌پک', 'قلم', 'آداپتور', 'رینگ‌لایت',
];
const BATCH = 2000;

function arg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const inline = hit.split('=')[1];
  if (inline !== undefined) return Number(inline);
  return Number(process.argv[process.argv.indexOf(hit) + 1] ?? fallback);
}

const db = createDatabase(process.env.DB_URL ?? '');
await db.query('SELECT 1');

const clean = process.argv.includes('--clean');
const total = Math.max(0, Math.min(500_000, arg('products', 20_000)));

const counts = async (): Promise<{ products: number; withDoc: number }> => {
  const { rows } = await db.query<{ products: string; with_doc: string }>(
    `SELECT (SELECT count(*) FROM products WHERE slug LIKE 'scale-%')::text AS products,
            (SELECT count(*) FROM products WHERE slug LIKE 'scale-%' AND length(search_document) > 0)::text AS with_doc`,
  );
  return { products: Number(rows[0]!.products), withDoc: Number(rows[0]!.with_doc) };
};

if (clean) {
  const before = await counts();
  // «ساختگی» با الگویِ slug شناخته می‌شود، پس هیچ ردیفِ واقعی دست نمی‌خورد.
  // `stock_items` باید اول برود: کلیدِ خارجی‌اش به `product_variants` بدونِ
  // cascade است و بی‌این، پاک‌کردنِ کالا با 23503 می‌ایستد — یعنی دقیقاً همان
  // «اسکریپتِ تمیزکردن که خودِ پایگاه را قفل می‌کند» که کسی سرِ شبِ انتشار
  // کشف می‌کند. اگر جدولِ دیگری (سفارشِ دستیِ تست، سبدِ رهاشده) جلو را گرفت،
  // نامِ قید را چاپ می‌کنیم تا معلوم شود کجا را باید باز کرد.
  const scaleVariants = `(SELECT v.id FROM product_variants v
                            JOIN products p ON p.id = v.product_id
                           WHERE p.slug LIKE 'scale-%')`;
  try {
    await db.query(`DELETE FROM stock_items WHERE variant_id IN ${scaleVariants}`);
    await db.query(`DELETE FROM product_compatibility WHERE variant_id IN ${scaleVariants}`);
    await db.query(`DELETE FROM products WHERE slug LIKE 'scale-%'`);
  } catch (error) {
    const where = (error as { constraint?: string; message?: string }) ?? {};
    console.error(
      `پاک نشد — ${where.constraint ? `قیدِ «${where.constraint}»` : 'خطایِ پایگاه'}: ` +
        `${where.message ?? String(error)}\n` +
        `راهنما: همان ردیف‌هایِ وابسته به تنوع‌هایِ «scale-%» را هم پاک کن (این اسکریپت products/variants/stock_items/compatibility را می‌شناسد).`,
    );
    await db.close();
    process.exit(1);
  }
  const after = await counts();
  console.log(`پاک شد: ${before.products - after.products} کالایِ ساختگی (باقی: ${after.products})`);
  await db.close();
  process.exit(0);
}

const started = Date.now();
const { rows: dims } = await db.query<{ n_types: string; n_brands: string; wh: string }>(
  `SELECT (SELECT count(*) FROM product_types)::text AS n_types,
          (SELECT count(*) FROM brands)::text AS n_brands,
          (SELECT id::text FROM warehouses ORDER BY id LIMIT 1) AS wh`,
);
const nTypes = Number(dims[0]!.n_types);
const nBrands = Number(dims[0]!.n_brands);
const warehouseId = dims[0]!.wh;
if (!warehouseId) throw new Error('انباری نیست — نخست `bash setup.sh db` را اجرا کن.');

let made = 0;
for (let from = 1; from <= total; from += BATCH) {
  const size = Math.min(BATCH, total - from + 1);
  // یک پرس‌وجوی دسته‌ای به‌جایِ حلقهٔ JS: بیست‌هزار `INSERT` تک‌تک، خودِ عاملِ
  // کندی می‌شد و عددِ اندازه‌گیری را خراب می‌کرد.
  await db.query(
    `WITH base AS (
       SELECT g.i,
              (SELECT id FROM product_types  ORDER BY id LIMIT 1 OFFSET (g.i % $3)) AS type_id,
              (SELECT id FROM brands         ORDER BY id LIMIT 1 OFFSET (g.i % $4)) AS brand_id,
              (SELECT w FROM unnest($2::text[]) WITH ORDINALITY AS t(w, ord)
                WHERE ord = (g.i % $5) + 1) AS word
         FROM generate_series(1, $1) AS g(i)
     ),
     p AS (
       INSERT INTO products (type_id, brand_id, title, slug, description, status, show_in_store)
       SELECT type_id, brand_id,
              word || ' ' || i::text,
              'scale-' || (i + $6),
              'کالایِ ساختگیِ آزمونِ مقیاس شمارهٔ ' || (i + $6) || ' — ' || word,
              'active', true
         FROM base
        ON CONFLICT (slug) DO NOTHING
       RETURNING id, slug
     ),
     v AS (
       INSERT INTO product_variants (product_id, sku, price_rial, attributes)
       SELECT id, upper(replace(slug, '-', '_')), 99_000 + (row_number() over ())::bigint * 1000, '{}'::jsonb
         FROM p
       RETURNING id, product_id
     )
     INSERT INTO stock_items (variant_id, warehouse_id, on_hand, reserved)
     SELECT v.id, $7::uuid, 40, (row_number() over ())::int % 7
       FROM v`,
    [size, WORDS, nTypes, nBrands, WORDS.length, from, warehouseId],
  );
  made += size;
  process.stdout.write(`  ${made}/${total}…\r`);
}

await db.query(`ANALYZE products`);
await db.query(`ANALYZE product_variants`);
const after = await counts();
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `\nکالایِ ساختگی: ${after.products} (سندِ جستجو رویِ ${after.withDoc} تا) در ${seconds} ثانیه\n` +
    `پاک‌کردن:  npx tsx scripts/seed-scale.mts --clean`,
);
await db.close();
