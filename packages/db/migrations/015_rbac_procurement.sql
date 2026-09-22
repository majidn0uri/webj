-- ---------------------------------------------------------------------------
-- ۰۱۵ — دسترسی‌هایِ تأمین و خرید
--
-- چرا این دسترسی‌ها جدا از «stock.adjust» و «purchase.invoice.approve» هستند؟
--   چون تأمین چهار کارِ متفاوت است که در سند به چهار نقشِ متفاوت سپرده شده:
--
--     مشاهده/ساختِ تأمین‌کننده  ← مدیر و حسابدار (کسی که قرار است پول بدهد)
--     ثبتِ درخواستِ خرید        ← انباردار و فروشنده (کسی که کمبود را می‌بیند)
--     تأییدِ درخواست            ← فقط مدیر (کسی که بودجه را قبول دارد)
--     صدورِ فاکتورِ خرید        ← حسابدار و مدیر
--     ثبتِ رسیدِ انبار          ← انباردار (و مدیر)
--     برگشت به تأمین‌کننده      ← انباردار (و مدیر)
--
--   اگر این‌ها یکی می‌شد، فروشنده‌ای که فقط «کمبود را گزارش می‌دهد» به ابزارِ
--   صدورِ فاکتور هم دسترسی پیدا می‌کرد — یعنی کنترلِ داخلی از بین می‌رفت.
-- ---------------------------------------------------------------------------

-- ۱) تعریفِ دسترسی‌ها
INSERT INTO permissions (key, name) VALUES
  ('procurement.supplier.read',   'مشاهده‌ی تأمین‌کنندگان'),
  ('procurement.supplier.create', 'ثبتِ تأمین‌کننده'),
  ('procurement.request.read',    'مشاهده‌ی درخواست‌های خرید'),
  ('procurement.request.create',  'ثبتِ درخواستِ خرید'),
  ('procurement.request.approve', 'تأیید/ردِ درخواستِ خرید'),
  ('procurement.invoice.create',  'صدورِ فاکتورِ خرید از درخواست'),
  ('procurement.receipt.read',    'مشاهده‌ی رسیدهای انبار'),
  ('procurement.receipt.create',  'ثبتِ رسیدِ انبار'),
  ('procurement.return.create',   'ثبتِ برگشت به تأمین‌کننده')
ON CONFLICT (key) DO NOTHING;

-- ۲) نگاشتِ نقش‌ها به دسترسی‌ها
--    مدیر کل: همه
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key = 'super_admin'
   AND p.key LIKE 'procurement.%'
ON CONFLICT DO NOTHING;

--    مدیر شعبه: همه جز ثبتِ تأمین‌کننده (تعریفِ طرفِ حساب با مدیر کل و حسابدار است)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key = 'branch_manager'
   AND p.key IN (
     'procurement.supplier.read',
     'procurement.request.read',
     'procurement.request.create',
     'procurement.request.approve',
     'procurement.invoice.create',
     'procurement.receipt.read',
     'procurement.receipt.create',
     'procurement.return.create'
   )
ON CONFLICT DO NOTHING;

--    حسابدار: تأمین‌کننده، درخواست (خواندن/تأییدِ هزینه) و فاکتور
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key = 'accountant'
   AND p.key IN (
     'procurement.supplier.read',
     'procurement.supplier.create',
     'procurement.request.read',
     'procurement.request.approve',
     'procurement.invoice.create',
     'procurement.receipt.read'
   )
ON CONFLICT DO NOTHING;

--    انباردار: درخواست می‌دهد، کالا می‌گیرد، معیوب را برمی‌گرداند — اما فاکتور نمی‌زند
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key = 'warehouse_keeper'
   AND p.key IN (
     'procurement.request.read',
     'procurement.request.create',
     'procurement.receipt.read',
     'procurement.receipt.create',
     'procurement.return.create'
   )
ON CONFLICT DO NOTHING;

--    فروشنده: فقط کمبود را گزارش می‌دهد و وضعیت را می‌بیند
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key = 'seller'
   AND p.key IN ('procurement.request.read', 'procurement.request.create')
ON CONFLICT DO NOTHING;
