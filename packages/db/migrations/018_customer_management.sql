-- ---------------------------------------------------------------------------
-- ۰۱۸ — مدیریتِ مشتریان در پنل
--
-- چرا این مهاجرت؟ چون مشتری اکنون یک «حسابِ کاربری» دارد (۰۱۷) اما هیچ ابزاری
-- برایِ دیدن و اداره‌اش در پنل نبود: اگر مشتری زنگ بزند و بگوید «سفارشم را
-- نمی‌بینم»، فروشنده راهی نداشت جز رفتنِ مستقیم به پایگاه داده — یعنی همان
-- «وابستگی به برنامه‌نویس» که قرار نبود وجود داشته باشد.
--
-- چرا سه دسترسی و نه یکی؟ چون سه کارِ متفاوت با سه سطحِ مسئولیت است:
--
--   customer.read       دیدنِ مشتری و سفارش‌هایش  ← فروشنده، حسابدار، انباردار
--   customer.write      ویرایشِ یادداشت/اعتبار/سقفِ چک ← مدیر و حسابدار
--   customer.deactivate مسدود کردنِ حساب           ← فقط مدیر
--
--   اگر این‌ها یکی می‌شد، فروشنده‌ای که باید فقط «جوابِ تلفن» بدهد می‌توانست
--   سقفِ اعتبارِ مشتری را بالا ببرد یا حسابش را ببندد — کنترلِ داخلی از بین
--   می‌رفت (اصلِ تفکیکِ وظایف).
-- ---------------------------------------------------------------------------

-- ۱) تعریفِ دسترسی‌ها
INSERT INTO permissions (key, name) VALUES
  ('customer.read',       'مشاهده‌ی مشتریان'),
  ('customer.write',      'ویرایشِ مشتری (یادداشت، اعتبار، سقفِ چک)'),
  ('customer.deactivate', 'مسدود/فعال کردنِ حسابِ مشتری')
ON CONFLICT (key) DO NOTHING;

-- ۲) نگاشتِ نقش‌ها به دسترسی‌ها
--    مدیر کل: همه
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key = 'super_admin'
   AND p.key LIKE 'customer.%'
ON CONFLICT DO NOTHING;

--    مدیر شعبه: همه (او مسئولِ رضایتِ مشتری در شعبه‌ی خود است)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key = 'branch_manager'
   AND p.key LIKE 'customer.%'
ON CONFLICT DO NOTHING;

--    حسابدار: دیدن + ویرایش (اعتبار و سقفِ چک ابزارِ مالی است، نه فروش)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key = 'accountant'
   AND p.key IN ('customer.read', 'customer.write')
ON CONFLICT DO NOTHING;

--    فروشنده و انباردار: فقط دیدن (پاسخ به مشتری، بی‌هیچ تغییری)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('seller', 'warehouse_keeper')
   AND p.key = 'customer.read'
ON CONFLICT DO NOTHING;

-- ۳) دلیلِ ابطالِ نشست
--
-- چرا لازم شد؟ وقتی مدیر حسابِ مشتری را مسدود می‌کند، نشست‌هایِ باز باید باطل
-- شوند — و اگر ندانیم «چرا باطل شده»، بعداً در پیگیریِ شکایت («چرا وسطِ خرید
-- بیرون افتادم؟») هیچ سندی نداریم. این ستون همان سند است.
ALTER TABLE customer_sessions ADD COLUMN IF NOT EXISTS revoke_reason text;
