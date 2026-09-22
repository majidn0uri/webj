-- ============================================================================
-- یکپارچه‌سازیِ دسترسی‌ها — مهاجرتِ ۰۱۶
--
-- مسئله: دو فضایِ نام برایِ دسترسی‌ها در پایگاه بود.
--   • مهاجرتِ ۰۰۲ فضایِ قدیمی را ساخت: product.view، stock.view، order.view،
--     report.financial.view، purchase.invoice.approve، user.manage
--   • کدِ برنامه (seed-identity) فضایِ تازه را به کار می‌برد: product.read،
--     inventory.read، pos.sell، accounting.write و … که کنترل‌کننده‌ها واقعاً
--     همان‌ها را بررسی می‌کنند.
--
-- پی‌آمد: اگر پایگاه فقط با مهاجرت‌ها بالا می‌آمد (بدون اجرایِ بذرِ برنامه،
-- آن‌طور که در استقرارِ واقعی انتظار می‌رود)، هیچ نقشی — جز مدیرِ کل که در کد
-- همه‌چیز را مجاز می‌بیند — دسترسیِ کاربردی نداشت. دسترسی باید «داده» باشد و
-- با مهاجرت بیاید، نه محصولِ جنبیِ بالا آمدنِ برنامه.
--
-- این مهاجرت فضایِ تازه را در خودِ پایگاه می‌نشاند. فضایِ قدیمی حذف نمی‌شود:
-- کنترل‌کننده‌ها و آزمون‌ها هنوز به آن ارجاع می‌دهند و حذفش رفتار را می‌شکند.
-- ============================================================================

-- ۱) دسترسی‌هایِ فضایِ تازه (همان‌هایی که کنترل‌کننده‌ها صدا می‌زنند)
INSERT INTO permissions (key, name) VALUES
  ('product.read',     'مشاهده‌ی کالا'),
  ('product.write',    'ثبت و ویرایشِ کالا'),
  ('inventory.read',   'مشاهده‌ی موجودی'),
  ('inventory.adjust', 'تعدیلِ موجودی'),
  ('order.read',       'مشاهده‌ی سفارش'),
  ('order.write',      'تغییرِ سفارش'),
  ('order.refund',     'برگشتِ وجه'),
  ('accounting.read',  'مشاهده‌ی گزارشِ مالی'),
  ('accounting.write', 'ثبتِ سندِ حسابداری'),
  ('pos.read',         'مشاهده‌ی صندوق و گزارشِ شیفت'),
  ('pos.sell',         'فروشِ حضوری'),
  ('report.read',      'مشاهده‌ی گزارش‌ها')
ON CONFLICT (key) DO NOTHING;

-- ۲) فروشنده: می‌فروشد و می‌بیند؛ به ارقامِ مالی دسترسی ندارد
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'seller'
  AND p.key IN ('product.read','order.read','order.write','pos.read','pos.sell','inventory.read')
ON CONFLICT DO NOTHING;

-- ۳) انباردار: موجودی را می‌گرداند؛ نه می‌فروشد و نه به حسابداری دست می‌زند
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'warehouse_keeper'
  AND p.key IN ('product.read','inventory.read','inventory.adjust')
ON CONFLICT DO NOTHING;

-- ۴) حسابدار: دفترکل و گزارش؛ صندوق را برایِ مغایرت‌گیری «می‌بیند»، نمی‌فروشد
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'accountant'
  AND p.key IN ('product.read','order.read','accounting.read','accounting.write','report.read','pos.read')
ON CONFLICT DO NOTHING;

-- ۵) پشتیبان: فقط مشاهده
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'support' AND p.key IN ('product.read','order.read')
ON CONFLICT DO NOTHING;

-- ۶) مدیر کل: همه‌ی دسترسی‌هایِ تعریف‌شده (در پنل قابلِ تغییر است)
-- این خط پس از درجِ بالا اجرا می‌شود تا دسترسی‌هایِ تازه را هم در بر بگیرد.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.key = 'super_admin'
ON CONFLICT DO NOTHING;
