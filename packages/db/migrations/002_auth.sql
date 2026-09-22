-- =====================================================================
-- احراز هویت و دسترسی (ادامه‌ی فاز ۰)
--   • رمز عبور هرگز ذخیره نمی‌شود؛ فقط حاصلِ scrypt با نمکِ تصادفی.
--   • توکنِ تازه‌سازی «می‌چرخد»: هر بار استفاده، قبلی باطل و جدید صادر می‌شود.
--   • تشخیصِ استفاده‌ی مجدد (Reuse Detection): اگر توکنِ باطل‌شده دوباره استفاده شد،
--     کلِ خانواده‌ی توکن‌ها باطل می‌شود (نشتِ توکن را مهار می‌کند).
-- =====================================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  user_agent   text NULL,
  ip           text NULL,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz NULL,
  replaced_by  uuid NULL REFERENCES refresh_tokens(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_refresh_user ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS ix_refresh_family ON refresh_tokens (family_id);

-- رمز یکبارمصوف (TOTP) — سcret به‌صورت رمزنگاری‌شده نگه‌داری می‌شود
CREATE TABLE IF NOT EXISTS mfa_secrets (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc  text NOT NULL,
  confirmed_at timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- تلاش‌های ورود — برای محدودسازی و گزارش‌های امنیتی
CREATE TABLE IF NOT EXISTS login_attempts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile     text NOT NULL,
  ip         text NULL,
  success    boolean NOT NULL,
  reason     text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_login_attempts_mobile ON login_attempts (mobile, created_at DESC);

-- ---------------------------------------------------------------------
-- نقش‌ها و دسترسی‌های پایه (نمونه — قابل ویرایش از پنل)
-- ---------------------------------------------------------------------
INSERT INTO roles (key, name, is_system) VALUES
  ('super_admin', 'مدیر کل', true),
  ('branch_manager', 'مدیر شعبه', true),
  ('warehouse_keeper', 'انباردار', true),
  ('seller', 'فروشنده', true),
  ('accountant', 'حسابدار', true),
  ('support', 'پشتیبان', true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO permissions (key, name) VALUES
  ('product.view', 'مشاهده‌ی کالا'),
  ('product.edit', 'ویرایش کالا'),
  ('product.price.edit', 'تغییر قیمت'),
  ('stock.view', 'مشاهده موجودی'),
  ('stock.adjust', 'تعدیل موجودی'),
  ('order.view', 'مشاهده سفارش'),
  ('order.refund.approve', 'تأیید بازگشت وجه'),
  ('purchase.invoice.approve', 'تأیید فاکتور خرید'),
  ('report.financial.view', 'مشاهده گزارش مالی'),
  ('user.manage', 'مدیریت کاربران')
ON CONFLICT (key) DO NOTHING;

-- فروشنده: مشاهده و فروش، بدون دسترسی مالی
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'seller' AND p.key IN ('product.view','stock.view','order.view')
ON CONFLICT DO NOTHING;

-- انباردار: موجودی و کالا
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'warehouse_keeper' AND p.key IN ('product.view','stock.view','stock.adjust')
ON CONFLICT DO NOTHING;

-- حسابدار: گزارش مالی و تأیید فاکتور خرید
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'accountant' AND p.key IN ('product.view','report.financial.view','purchase.invoice.approve')
ON CONFLICT DO NOTHING;

-- مدیر شعبه: همه‌چیز به‌جز مدیریت کاربران
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.key = 'branch_manager'
  AND p.key IN ('product.view','product.edit','product.price.edit','stock.view','stock.adjust',
                'order.view','order.refund.approve','purchase.invoice.approve','report.financial.view')
ON CONFLICT DO NOTHING;

-- مدیر کل: همه‌ی دسترسی‌های تعریف‌شده (در پنل قابل تغییر است)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.key = 'super_admin'
ON CONFLICT DO NOTHING;
