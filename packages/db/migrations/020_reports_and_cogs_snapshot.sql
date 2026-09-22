-- ---------------------------------------------------------------------------
-- ۰۲۰ — گزارش‌هایِ مدیریتی: ثبتِ بهایِ تمام‌شده در لحظه‌یِ فروش، میانگیرِ
--       گزارش، و دسترسیِ گزارش‌ها
--
-- چرا این مهاجرت؟ چون سه گزارشِ اصلیِ مدیریت (سودِ ناخالص، گردشِ موجودی،
-- سنِ بدهی) روی داده‌ای حساب می‌شوند که تا امروز ثبت نمی‌شد:
--
--   ۱) «بهایِ تمام‌شده‌یِ هر ردیفِ فروش». دفترکل بهایِ کالای فروخته‌شده را
--      درست می‌دانست (از جدولِ ارزش‌گذاری، حسابِ ۵۰۰۰)، اما در ردیفِ سفارش
--      هیچ اثری از بها نبود؛ و حرکتِ خروجِ انبار هم با بهایِ صفر نوشته می‌شد
--      (ستون داشت، مقدار نمی‌گرفت). نتیجه این بود که «سودِ ناخالصِ هر کالا»
--      اصلاً قابلِ محاسبه نبود و هر گزارشی باید به بهایِ «میانگینِ امروز»
--      پناه می‌برد — که برای فروشِ سه ماه پیش غلط است، چون میانگینِ موزون با
--      هر خریدِ تازه عوض می‌شود. این مهاجرت بهایِ هر واحد را در همان لحظه‌یِ
--      خروج روی ردیفِ فروش می‌نشاند (عکسِ لحظه)، تا گزارشِ هر دوره با بهایِ
--      همان دوره حساب شود، نه با بهایِ امروز.
--
--   ۲) «میانگیرِ گزارش». این سه گزارش روی صدها هزار ردیف جمع می‌زنند. اجرایِ
--      دوباره‌یِ آن‌ها با هر بار باز کردنِ صفحه، هم پایگاه را زیرِ بار
--      می‌برد و هم پاسخ را کند می‌کند. جدولِ report_cache نتیجه را با کلیدِ
--      «نامِ گزارش + دوره» نگه می‌دارد و تا ۱۵ دقیقه معتبر است؛ دکمه‌یِ
--      «بازسازی» در پنل، میانگیر را نادیده می‌گیرد.
--
--   ۳) «دسترسیِ گزارش». سودِ ناخالص محرمانه است: فروشنده قیمتِ فروش را
--      می‌بیند، نه حاشیه‌یِ سودِ شرکت را. پس گزارش‌ها دسترسیِ جداگانه
--      می‌گیرند و به فروشنده داده نمی‌شود.
-- ---------------------------------------------------------------------------

-- ۱) بهایِ تمام‌شده‌یِ هر واحد در لحظه‌یِ فروش (عکسِ لحظه روی ردیفِ سفارش)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost_rial bigint NOT NULL DEFAULT 0;
COMMENT ON COLUMN order_items.unit_cost_rial IS
  'بهایِ میانگینِ موزونِ هر واحد در لحظه‌یِ خروج از انبار. با خریدهایِ بعد تغییر نمی‌کند؛ مبنایِ سودِ ناخالص است.';

-- گردشِ موجودی و سودِ ناخالص، هر دو بر پایه‌یِ «تنوع» جمع می‌زنند
CREATE INDEX IF NOT EXISTS ix_order_items_variant ON order_items (variant_id);

-- ۲) بهایِ هر واحد روی حرکتِ انبار (تا پیش از این همیشه صفر بود)
--     ستون از پیش بود؛ اینجا فقط توضیحش روشن می‌شود تا کسی دوباره صفر ننویسد.
COMMENT ON COLUMN stock_movements.unit_cost_rial IS
  'بهایِ هر واحد در لحظه‌یِ این حرکت. برایِ خروجِ فروش برابر است با میانگینِ موزونِ همان انبار.';

-- ۳) میانگیرِ گزارش‌ها
CREATE TABLE IF NOT EXISTS report_cache (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key    text NOT NULL,                    -- gross_profit | stock_turnover | debtors
  period_key    text NOT NULL,                    -- کلیدِ دوره + شعبه + دسته‌بندی (رشته‌یِ یکتا)
  payload       jsonb NOT NULL,                   -- خروجیِ آماده‌یِ گزارش
  row_count     integer NOT NULL DEFAULT 0,
  build_ms      integer NOT NULL DEFAULT 0,       -- زمانِ ساخت؛ برایِ پایشِ کندی
  generated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_key, period_key)
);
COMMENT ON TABLE report_cache IS
  'نتیجه‌یِ آماده‌یِ گزارش‌هایِ سنگین؛ تا ۱۵ دقیقه معتبر است و با «بازسازی» دور انداخته می‌شود.';
CREATE INDEX IF NOT EXISTS ix_report_cache_time ON report_cache (report_key, generated_at DESC);

-- ۴) دسترسی‌هایِ گزارش
INSERT INTO permissions (key, name) VALUES
  ('reports.read',   'مشاهده‌یِ گزارش‌هایِ مدیریتی'),
  ('reports.export', 'خروجی گرفتن از گزارش‌ها (CSV)')
ON CONFLICT (key) DO NOTHING;

--    مدیرِ کل، مدیرِ شعبه و حسابدار گزارش می‌بینند؛ خروجی گرفتن با مدیر و حسابدار است
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager', 'accountant')
   AND p.key = 'reports.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'accountant')
   AND p.key = 'reports.export'
ON CONFLICT DO NOTHING;

--    فروشنده: هیچ. حاشیه‌یِ سود و سنِ بدهیِ مشتریان به کارِ او ربطی ندارد
--    (و اگر ببیند، یعنی نشتِ اطلاعاتِ مالی در فروشگاه).

-- ---------------------------------------------------------------------------
-- یادداشت: بهایِ ردیف‌هایِ پیش از این مهاجرت از رویِ حرکت‌هایِ خروجِ فروش
-- پر می‌شود؛ اگر حرکتی نباشد، صفر می‌ماند و گزارش پایینِ صفحه هشدار می‌دهد:
-- «بهایِ تمام‌شده برای N ردیف ثبت نشده است».
-- ---------------------------------------------------------------------------
UPDATE order_items oi
   SET unit_cost_rial = sm.unit_cost_rial
  FROM stock_movements sm
 WHERE sm.reference_type = 'order'
   AND sm.reference_id = oi.order_id
   AND sm.variant_id = oi.variant_id
   AND sm.reason = 'sale'
   AND sm.unit_cost_rial > 0
   AND oi.unit_cost_rial = 0;
