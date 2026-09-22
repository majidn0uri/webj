-- CRM + SMS permissions — اضافه کردن به RBAC
-- 048_rbac_crm_sms.sql

-- دسترسی‌های CRM
INSERT INTO permissions (key, name) VALUES
  ('customers.read',  'مشاهده‌ی مشتریان و CRM'),
  ('customers.write', 'ثبت تعامل و ویرایش CRM'),
  ('customers.manage', 'مدیریت برچسب و بخش‌بندی'),
  ('sms.outbox.read', 'مشاهده‌ی صف پیامک'),
  ('sms.outbox.send', 'ارسال و بازفرستی پیامک'),
  ('sms.template.read', 'مشاهده‌ی قالب پیامک'),
  ('sms.template.write', 'ویرایش قالب پیامک'),
  ('returns.read', 'مشاهده‌ی مرجوعی'),
  ('returns.write', 'ثبت و تغییر مرجوعی'),
  ('reviews.read', 'مشاهده‌ی نظرات'),
  ('reviews.write', 'تأیید و پاسخ نظرات'),
  ('coupons.read', 'مشاهده‌ی کوپن‌ها'),
  ('coupons.write', 'ساخت و ویرایش کوپن'),
  ('categories.read', 'مشاهده‌ی دسته‌بندی'),
  ('categories.write', 'ویرایش دسته‌بندی'),
  ('banners.read', 'مشاهده‌ی بنرها'),
  ('banners.write', 'ویرایش بنرها'),
  ('settings.read', 'مشاهده‌ی تنظیمات'),
  ('settings.write', 'ویرایش تنظیمات'),
  ('reports.export', 'خروجی اکسل و PDF'),
  ('tax.read', 'مشاهده‌ی مالیات'),
  ('tax.write', 'ثبت و ارسال مالیات'),
  ('observability.read', 'مشاهده‌ی سلامت سیستم'),
  ('inventory.write', 'ثبت تعدیل و شمارش انبار'),
  ('procurement.request.read', 'مشاهده‌ی درخواست خرید'),
  ('procurement.request.create', 'ثبت درخواست خرید'),
  ('procurement.request.approve', 'تأیید درخواست خرید'),
  ('procurement.receipt.read', 'مشاهده‌ی رسید خرید'),
  ('procurement.receipt.create', 'ثبت رسید خرید')
ON CONFLICT (key) DO NOTHING;

-- CRM → support
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'support'
  AND p.key IN ('customers.read', 'customers.write')
ON CONFLICT DO NOTHING;

-- CRM → branch_manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'branch_manager'
  AND p.key IN ('customers.read', 'customers.write', 'customers.manage',
                'sms.outbox.read', 'sms.outbox.send', 'sms.template.read',
                'returns.read', 'returns.write', 'reviews.read', 'reviews.write',
                'coupons.read', 'coupons.write', 'categories.read', 'categories.write',
                'banners.read', 'banners.write', 'settings.read', 'settings.write',
                'reports.export', 'tax.read', 'tax.write', 'observability.read',
                'inventory.write', 'procurement.request.read', 'procurement.request.create',
                'procurement.request.approve', 'procurement.receipt.read', 'procurement.receipt.create')
ON CONFLICT DO NOTHING;

-- super_admin gets all
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.key = 'super_admin'
ON CONFLICT DO NOTHING;