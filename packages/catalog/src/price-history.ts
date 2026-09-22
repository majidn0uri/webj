import type { Queryable } from '@set/db';

/**
 * تاریخچهٔ قیمت — «آیا فروشنده قیمت را بالا برد و بعد تخفیف زد؟»
 *
 * این پرسش بزرگ‌ترین دشمنِ اعتماد در فروشگاه‌هایِ آنلاین است.
 * جوابِ ساده: آخرین N نقطهٔ قیمتِ هر تنوع، با تاریخ.
 * جوابِ صادقانه: اگر جدولِ price_log خالی باشد، «هنوز ثبت نشده»
 * می‌گوییم — نه «تخفیف واقعی است».
 *
 * خروجی برایِ نمودارِ میله‌ای/خطی در صفحه‌یِ کالا آماده است
 * (هر نقطه: {date, priceRial}) اما اگر فقط یک نقطه بود،
 * «قیمت از ابتدا همین بوده» کافی است و نمودار لازم نیست.
 */

export interface PricePoint {
  date: string;      // YYYY-MM-DD — برایِ مرتب‌سازی و نمودار
  priceRial: number;
}

/**
 * آخرین تغییراتِ قیمتِ یک کالا (همهٔ تنوع‌هایش).
 *
 * چرا «همهٔ تنوع‌ها»؟ چون خریدار مدلِ خودش را می‌خواهد — اگر تنوعِ
 * آبی گران‌تر شده ولی تنوعِ مشکی ارزان‌تر، باید ببیند.
 *
 * @param productSlug نامکِ کالا
 * @param limit حداکثرِ نقاط (پیش‌فرض ۳۰ — یک ماه)
 */
export async function priceHistory(
  db: Queryable,
  productSlug: string,
  limit = 30,
): Promise<{ points: PricePoint[]; total: number }> {
  const { rows } = await db.query<{ date: string; price_rial: string }>(
    `SELECT to_char(date_trunc('day', pl.recorded_at), 'YYYY-MM-DD') AS date,
            MIN(pl.price_rial)::text AS price_rial
       FROM product_price_log pl
       JOIN product_variants v ON v.id = pl.variant_id
       JOIN products p ON p.id = v.product_id
      WHERE p.slug = $1
      GROUP BY date_trunc('day', pl.recorded_at)
      ORDER BY date_trunc('day', pl.recorded_at) DESC
      LIMIT $2`,
    [productSlug, limit],
  );

  return {
    points: rows.map((r) => ({ date: r.date, priceRial: Number(r.price_rial) })).reverse(),
    total: rows.length,
  };
}

/**
 * ثبتِ یک نقطهٔ قیمت — فراخوانی از updateProduct/createProduct.
 *
 * چرا این جدا از سرویسِ کاتالوگ است؟ چون «ثبت» و «خواندن» دو مسئولیت
 * متفاوت‌اند: ثبت باید اتمیک باشد (در همان تراکنشِ به‌روزرسانی)،
 * خواندن فقط خواندن است و می‌تواند cache شود.
 */
export async function recordPriceChange(
  db: Queryable,
  variantId: string,
  priceRial: string | bigint,
): Promise<void> {
  await db.query(
    `INSERT INTO product_price_log (variant_id, price_rial) VALUES ($1, $2)`,
    [variantId, String(priceRial)],
  );
}