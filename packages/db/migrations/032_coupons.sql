-- ۰۳۲ — کوپن و کدِ تخفیف
--
-- چرا کوپن جدولِ خودش را دارد، با اینکه کالا از پیش تخفیف داشت؟ چون آن دو
-- دو پرسشِ متفاوت‌اند:
--
--   • تخفیفِ کالا می‌گوید «این کالا اکنون ارزان‌تر است» — رویِ قیمت است،
--     در بازه‌ای از تاریخ، و برایِ همه یکسان.
--   • کوپن می‌گوید «این سبد، اگر این کلمه را همراه داشت، ارزان‌تر است» —
--     رویِ سفارش است، با محدودیتِ دفعات، با سقف، و گاه برایِ کالا یا
--     دسته‌ای ویژه.
--
-- قاطی کردنشان یعنی یا نتوانیم بگوییم «این کوپن چند بار مصرف شد»، یا
-- تخفیفِ کالا را به دفعات محدود کنیم که معنایش را از دست می‌دهد.
--
-- نکته‌یِ مالیاتی: مالیات بر «خالصِ پس از تخفیف» بسته می‌شود، نه بر مبلغِ
-- پیش از آن (پایه‌یِ مالیات در قانونِ ارزش‌افزوده پس از تخفیف است). سامانه
-- این را در توزیعِ تخفیف رویِ ردیف‌ها انجام می‌دهد؛ اینجا تنها بسترش را
-- می‌سازیم.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ۱) خودِ کوپن ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- کد را بزرگ می‌نویسیم تا «OFF10» و «off10» یکی باشند: چاپِ رویِ کاغذ
  -- همیشه با دست‌نوشته‌یِ مشتری یکی نیست.
  code               text NOT NULL UNIQUE,
  title              text NOT NULL,
  description        text NULL,
  kind               text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  -- درصد را با «در ده‌هزار» نگه می‌داریم تا ۱۲٫۵٪ هم دقیق باشد و گرد کردن
  -- در میانه‌یِ محاسبه رخ ندهد (مانندِ نرخِ مالیات در همین پروژه).
  value_bp           integer NULL CHECK (value_bp IS NULL OR (value_bp > 0 AND value_bp <= 10000)),
  value_rial         bigint NULL CHECK (value_rial IS NULL OR value_rial > 0),
  min_subtotal_rial  bigint NOT NULL DEFAULT 0 CHECK (min_subtotal_rial >= 0),
  max_discount_rial  bigint NULL CHECK (max_discount_rial IS NULL OR max_discount_rial > 0),
  starts_at          timestamptz NULL,
  ends_at            timestamptz NULL,
  usage_limit        integer NULL CHECK (usage_limit IS NULL OR usage_limit > 0),
  usage_count        integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  per_customer_limit integer NOT NULL DEFAULT 1 CHECK (per_customer_limit > 0),
  applies_to         text NOT NULL DEFAULT 'all'
                       CHECK (applies_to IN ('all', 'product', 'category')),
  product_id         uuid NULL REFERENCES products(id) ON DELETE CASCADE,
  -- دسته‌ها همان درختِ product_types اند (مهاجرتِ ۰۲۹)
  category_id        uuid NULL REFERENCES product_types(id) ON DELETE CASCADE,
  is_active          boolean NOT NULL DEFAULT true,
  created_by         uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- یک کوپن یا درصدی است یا مبلغی، نه هر دو
  CONSTRAINT coupons_value_chk CHECK (
    (kind = 'percent' AND value_bp IS NOT NULL AND value_rial IS NULL)
    OR (kind = 'fixed' AND value_rial IS NOT NULL AND value_bp IS NULL)
  ),
  -- اگر کوپن ویژه‌یِ کالا یا دسته است، باید معلوم کند کدام
  CONSTRAINT coupons_scope_chk CHECK (
    (applies_to = 'all'      AND product_id IS NULL AND category_id IS NULL)
    OR (applies_to = 'product'  AND product_id  IS NOT NULL AND category_id IS NULL)
    OR (applies_to = 'category' AND category_id IS NOT NULL AND product_id  IS NULL)
  ),
  -- بازه اگر داده شود باید درست باشد (آغاز پیش از پایان)
  CONSTRAINT coupons_window_chk CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at <= ends_at)
);

CREATE INDEX IF NOT EXISTS ix_coupons_active ON coupons (is_active, code);
CREATE INDEX IF NOT EXISTS ix_coupons_ends ON coupons (ends_at);

-- ۲) مصرفِ کوپن ──────────────────────────────────────────────────────────────
-- چرا جدایِ سفارش؟ چون یک سفارش ممکن است یک کوپن داشته باشد و یک کوپن بسیاری
-- سفارش؛ و چون باید بتوان پرسید «این مشتری این کوپن را چند بار مصرف کرد»
-- بی‌آنکه در سفارش‌ها بگردیم.
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id     uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  order_id      uuid NULL REFERENCES orders(id) ON DELETE SET NULL,
  customer_id   uuid NULL REFERENCES customers(id) ON DELETE SET NULL,
  discount_rial bigint NOT NULL CHECK (discount_rial >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- یک کوپن برایِ یک سفارش یک‌بار مصرف می‌شود (دوباره مصرف یعنی تقلب)
  CONSTRAINT coupon_redemptions_order_uq UNIQUE (coupon_id, order_id)
);

CREATE INDEX IF NOT EXISTS ix_redemptions_coupon ON coupon_redemptions (coupon_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_redemptions_customer ON coupon_redemptions (coupon_id, customer_id);

-- ۳) کوپن رویِ سفارش ─────────────────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS coupon_id uuid NULL REFERENCES coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coupon_code text NULL;

CREATE INDEX IF NOT EXISTS ix_orders_coupon ON orders (coupon_id);

-- ۴) تنظیم: قابلیت هست، اکنون روشن است ───────────────────────────────────────
UPDATE store_settings
   SET value = 'true',
       description = 'کوپن/کدِ تخفیف در تسویه (پنل: زیرسیستمِ کوپن)'
 WHERE key = 'coupon_enabled';

INSERT INTO store_settings (key, value, description) VALUES
  ('coupon_stack_with_sale', 'true', 'کوپن رویِ کالایِ تخفیف‌دار هم اعمال شود؟')
ON CONFLICT (key) DO NOTHING;

-- ۵) دسترسی‌ها ───────────────────────────────────────────────────────────────
-- دیدن برایِ همه‌یِ نقش‌هایِ پنل (هر کسی باید بداند چه کمپینی هست)، ویرایش
-- برایِ مدیر و مدیرِ شعبه و فروشنده — چون کوپن مستقیم رویِ پول اثر دارد.
INSERT INTO permissions (key, name) VALUES
  ('coupons.read',  'مشاهده‌یِ کوپن‌ها و کدهایِ تخفیف'),
  ('coupons.write', 'ساخت، ویرایش و غیرفعال کردنِ کوپن‌ها')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager', 'seller', 'support', 'warehouse_keeper', 'accountant')
   AND p.key = 'coupons.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager', 'seller')
   AND p.key = 'coupons.write'
ON CONFLICT DO NOTHING;

COMMIT;
