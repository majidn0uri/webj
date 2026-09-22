-- دسترسی‌های عملیاتیِ ارسال و مدیریت چک
INSERT INTO permissions (key, name) VALUES
  ('shipping.read', 'مشاهده‌ی ارسال'),
  ('shipping.write', 'مدیریت ارسال'),
  ('checks.read', 'مشاهده‌ی چک‌ها'),
  ('checks.write', 'مدیریت چک‌ها')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.key = 'warehouse_keeper'
  AND p.key IN ('shipping.read', 'shipping.write', 'checks.read', 'checks.write')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.key = 'branch_manager'
  AND p.key IN ('shipping.read', 'shipping.write', 'checks.read', 'checks.write')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.key = 'super_admin'
ON CONFLICT DO NOTHING;
