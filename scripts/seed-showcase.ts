/**
 * نشاندنِ «داده‌یِ ویترین» — همان چیزی که رابطِ فروشگاه را دیدنی می‌کند.
 *
 * چرا اسکریپتی جدا؟
 *   سه ویژگیِ رابطِ خرید به داده‌ای وابسته‌اند که «در زمان» معنا دارد، نه در
 *   کد: برچسبِ تخفیف (بازه‌یِ زمانیِ درست)، برچسبِ «جدید» (تاریخِ انقضایِ
 *   نو بودن)، و هشدارِ «تنها N عدد مانده» (موجودیِ کم). نشاندنِ کاتالوگ این‌ها
 *   را نمی‌سازد — چون فروشگاهِ واقعی نباید از روزِ نخست تخفیف‌دار یا
 *   کم‌موجودی باشد. اما در محیطِ توسعه، بی‌ آن‌ها هیچ‌کس نمی‌تواند رابط را
 *   ببیند و بسنجد.
 *
 *   نخستین بار این داده با دست و چند دستورِ SQL ساخته شد؛ با نخستین
 *   بازنشانیِ محیط رفت و باید از نو پیدا و نوشته می‌شد. اینجا همان داده
 *   «کد» شده است تا بازسازی‌اش یک فرمان باشد، نه یک خاطره.
 *
 * اجرا:
 *   DB_URL="postgres://setshop@/setshop?host=/tmp/setshop-pgrun&port=5433" \
 *     npx tsx scripts/seed-showcase.ts
 *
 * بی‌خطر برای اجرایِ دوباره: همه‌یِ مقادیر «تعیین» می‌شوند (UPDATE)، نه
 * «افزوده»؛ هر بار اجرا همان نتیجه را می‌دهد.
 */

import { createDatabase } from '@set/db';

/** تخفیفِ جاری: ۱۵٪ رویِ قابِ سیلیکونی، از دیروز تا سی روزِ دیگر. */
const DISCOUNT = { slug: 'case-silicon-matte', percent: 15, days: 30 };
/** «جدید»: گلسِ سرامیکی تا بیست روزِ دیگر نو به‌شمار می‌رود. */
const NEW_UNTIL = { slug: 'glass-ceramic-9h', days: 20 };
/** موجودیِ کم: شارژر، سه عدد — تا هشدارِ «تنها ۳ عدد مانده» دیده شود. */
const LOW_STOCK = { slug: 'charger-20w-typec', onHand: 3 };

async function main(): Promise<void> {
  const url = process.env.DB_URL ?? 'memory://';
  if (url === 'memory://') {
    console.error('DB_URL تعیین نشده است. نمونه: postgres://setshop@/setshop?host=/tmp/setshop-pgrun&port=5433');
    process.exit(2);
  }

  const db = createDatabase(url);
  const report: string[] = [];

  try {
    // ۱. تخفیفِ جاری
    const discount = await db.query(
      `UPDATE products
          SET discount_percent = $2,
              discount_starts_at = now() - interval '1 day',
              discount_ends_at = now() + ($3 || ' days')::interval
        WHERE slug = $1
        RETURNING title`,
      [DISCOUNT.slug, DISCOUNT.percent, String(DISCOUNT.days)],
    );
    if (Number(discount.affectedRows ?? 0) > 0) {
      report.push(`تخفیفِ ${DISCOUNT.percent}٪ رویِ «${DISCOUNT.slug}» (تا ${DISCOUNT.days} روزِ دیگر)`);
    }

    // ۲. برچسبِ «جدید» — رویِ تنوع‌هاست، نه رویِ کالا
    const fresh = await db.query(
      `UPDATE product_variants v
          SET is_new_until = now() + ($2 || ' days')::interval
         FROM products p
        WHERE p.id = v.product_id AND p.slug = $1
        RETURNING v.sku`,
      [NEW_UNTIL.slug, String(NEW_UNTIL.days)],
    );
    if (Number(fresh.affectedRows ?? 0) > 0) {
      report.push(`برچسبِ «جدید» رویِ ${fresh.affectedRows} تنوع از «${NEW_UNTIL.slug}» (تا ${NEW_UNTIL.days} روزِ دیگر)`);
    }

    // ۳. موجودیِ کم — مستقیم رویِ انبار، چون موجودی «حاصلِ حرکت‌هاست» و
    //    اینجا هدف فقط دیده‌شدنِ آستانه‌یِ هشدار است.
    const stock = await db.query(
      `UPDATE stock_items s
          SET on_hand = $2, reserved = 0
         FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE s.variant_id = v.id AND p.slug = $1
        RETURNING v.sku`,
      [LOW_STOCK.slug, LOW_STOCK.onHand],
    );
    if (Number(stock.affectedRows ?? 0) > 0) {
      report.push(`موجودیِ «${LOW_STOCK.slug}» برابرِ ${LOW_STOCK.onHand} عدد (${stock.affectedRows} تنوع)`);
    }

    // ۴. رنگ‌ها: در نشاندنِ کاتالوگ رویِ تنوع‌ها نشسته‌اند، اما اگر کسی این
    //    اسکریپت را رویِ پایگاهِ تازه‌ای اجرا کند که رنگ ندارد، فیلترِ رنگ
    //    خالی می‌ماند. اینجا فقط «شمارش» می‌کنیم تا نبودشان دیده شود.
    const colours = await db.query<{ count: string }>(
      `SELECT COUNT(DISTINCT v.attributes->>'color')::text AS count
         FROM product_variants v
        WHERE v.attributes->>'color' IS NOT NULL`,
    );
    report.push(`رنگ‌هایِ موجود برایِ فیلتر: ${colours.rows[0]?.count ?? '0'}`);

    console.log('داده‌یِ ویترین نشانده شد:');
    for (const line of report) console.log(`  • ${line}`);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
