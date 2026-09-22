-- پاک‌کردنِ سفارش‌هایِ آزمونِ بار (سناریویِ `--mix purchase`)
--
-- `node scripts/load-test.mjs --mix purchase` فروشِ **واقعی** می‌نویسد: سفارش،
-- پرداخت، و کسرِ موجودی. آن داده در پنلِ فروشنده می‌ماند و نمودارِ فروش را
-- جلو می‌اندازد. این فایل همان‌ها را برمی‌گرداند — و چون موجودی در مسیرِ
-- پرداخت کم شده، **اول برمی‌گرداند، بعد می‌کَند** (بی‌این، انبار یک‌بارکم می‌ماند).
--
--   psql "$DB_URL" -f scripts/purge-load-test-orders.sql
--
-- نامِ مشتریِ ثابتِ ابزار (`خریدارِ آزمون`) همان چیزی است که برایِ تشخیصِ
-- ردپایِ آزمون به کار می‌رود؛ اگر در `load-test.mjs` عوضش کردی، این‌جا هم عوض کن.
--
-- چرا `customer_name` و نه برچسبِ دیگری؟ چون ابزارِ بار همان چیزی را می‌نویسد که
-- یک مشتریِ واقعی می‌نویسد — برای همین هم آزمون، آزمون است و هم وفادار.

BEGIN;

CREATE TEMP TABLE doomed ON COMMIT DROP AS
  SELECT id, status FROM orders WHERE customer_name = 'خریدارِ آزمون';

-- ۱) موجودیِ فروخته‌شده به انبار برمی‌گردد (لغوشدنِ سفارشِ پرداخت‌شده در منطقِ
--    کسب‌وکار «بازگشتِ کالا از مشتری» است، پس از `on_hand` کم شده بود)
CREATE TEMP TABLE restock ON COMMIT DROP AS
  SELECT oi.variant_id, sum(oi.quantity)::int AS qty
    FROM order_items oi
    JOIN doomed d ON d.id = oi.order_id
   WHERE d.status = 'paid'
   GROUP BY 1;

UPDATE stock_items s
   SET on_hand = s.on_hand + r.qty, updated_at = now()
  FROM restock r
 WHERE s.variant_id = r.variant_id;

-- ۲) سفارش‌هایِ پرداخت‌نشده که رزرو را در دست دارند: رزرو آزاد شود.
--    (اگر زودتر از پنل «لغو» کرده باشی، `releaseStock` این کار را کرده و این
--    UPDATE هیچ نمی‌کند؛ بی‌ضرر است.)
UPDATE stock_items s
   SET reserved = GREATEST(0, s.reserved - r.qty), updated_at = now()
  FROM (
    SELECT oi.variant_id, sum(oi.quantity)::int AS qty
      FROM order_items oi
      JOIN doomed d ON d.id = oi.order_id
     WHERE d.status = 'pending_payment'
     GROUP BY 1
  ) r
 WHERE s.variant_id = r.variant_id;

-- ۳) خودِ ردپا. جدول‌هایِ فرزندِ `orders` همه `ON DELETE CASCADE` دارند، به‌جز
--    این دو که `SET NULL`‌اند و بی‌پاک‌کردنشان سطرِ یتیمِ گیج‌کننده می‌ماند.
DELETE FROM product_reviews    WHERE order_id IN (SELECT id FROM doomed);
DELETE FROM coupon_redemptions WHERE order_id IN (SELECT id FROM doomed);
DELETE FROM orders             WHERE id       IN (SELECT id FROM doomed);

COMMIT;

-- و سبدها: آزمونِ بار برایِ هر کوشش یک سبد می‌سازد. سبدِ بی‌استفاده با
-- `expires_at` از کار می‌افتد (همان‌جا که `cart.service` آن را رد می‌کند) و
-- رزروی هم که سفارشِ پرداخت‌نشده در دست دارد را آزادگرِ زمان‌بازمانده
-- (`releaseExpiredReservations`) پس می‌گیرد، پس دادهٔ آزمون «قفل» نمی‌ماند.
-- ردیف‌هایِ مُرده را هر وقت بخواهی می‌شود بی‌خطر ریخت — اینها دیگر هیچ‌وقت
-- خوانده نمی‌شوند:
--   DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE status = 'active' AND expires_at < now());
--   DELETE FROM carts      WHERE status = 'active' AND expires_at < now();
