-- =====================================================================
-- شمای اولیه — ست‌شاپ (فاز ۰)
-- قوانینِ سراسریِ این شِما:
--   • همه‌ی مبالغ BIGINT و به ریال هستند (هرگز عدد اعشاری برای پول).
--   • همه‌ی زمان‌ها timestamptz و به UTC ذخیره می‌شوند (نمایش شمسی در لایه‌ی UI).
--   • هیچ موجودیتِ تراکنشی حذفِ فیزیکی نمی‌شود؛ فقط بایگانی (بخش T).
--   • شماره‌گذاریِ اسناد هرگز با MAX()+1 یا COUNT()+1 انجام نمی‌شود (بخش Q-1).
-- =====================================================================

-- افزونه‌ها: در محیط‌هایی که در دسترس نیستند فقط اخطار می‌دهیم (نباید مهاجرت را بشکند)
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm در دسترس نیست — ادامه بدون آن';
END $$;

-- ---------------------------------------------------------------------
-- مهاجرت‌ها
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- شمارنده‌های اسناد — تنها مجوزِ صدور شماره (بخش Q-1)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS counters (
  scope       text NOT NULL DEFAULT 'global',
  key         text NOT NULL,
  value       bigint NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

-- ---------------------------------------------------------------------
-- سازمان: شعبه‌ها، کاربران، نقش‌ها، دسترسی‌ها (RBAC + ABAC)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  city         text NOT NULL DEFAULT 'تهران',
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile        text NOT NULL,
  email         text NULL,
  full_name     text NOT NULL,
  password_hash text NULL,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- یکتاییِ جزئی: موبایل فقط برای کاربرانِ فعال باید یکتا باشد (بخش T)
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_mobile_active
  ON users (mobile) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  name        text NOT NULL,
  is_system   boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS permissions (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key    text NOT NULL UNIQUE,      -- مثال: 'order.refund.approve'
  name   text NOT NULL
);

-- «نقشِ سراسری» یعنی branch_id تهی؛ چون ستونِ کلیدِ اصلی نمی‌تواند تهی باشد،
-- یکتایی را با ایندکس روی COALESCE برقرار می‌کنیم (یک کاربر می‌تواند یک نقش را
-- در چند شعبه داشته باشد، و یک نقشِ سراسری هم داشته باشد).
CREATE TABLE IF NOT EXISTS user_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  branch_id  uuid NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_roles_scope
  ON user_roles (user_id, role_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS ix_user_roles_user ON user_roles (user_id);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ---------------------------------------------------------------------
-- کاتالوگ: برندها، دستگاه‌ها، کالاها، تنوع‌ها، سازگاری
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brands (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  is_active  boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS device_brands (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name  text NOT NULL,
  slug  text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS device_models (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    uuid NOT NULL REFERENCES device_brands(id),
  name        text NOT NULL,             -- مثال: 'iPhone 13 Pro'
  slug        text NOT NULL,
  released_at date NULL,
  UNIQUE (brand_id, slug)
);

CREATE TABLE IF NOT EXISTS product_types (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL UNIQUE,     -- 'case' | 'charger' | 'lcd' | ...
  name         text NOT NULL,
  spec_template jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_id       uuid NOT NULL REFERENCES product_types(id),
  brand_id      uuid NULL REFERENCES brands(id),
  title         text NOT NULL,
  slug          text NOT NULL UNIQUE,
  description   text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'draft',  -- draft|active|archived
  search_vector text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_status_chk CHECK (status IN ('draft','active','archived'))
);
CREATE INDEX IF NOT EXISTS ix_products_status ON products (status);

-- تنوعِ کالا (رنگ/مدل/ظرفیت) — موجودی و قیمت در سطحِ تنوع است
CREATE TABLE IF NOT EXISTS product_variants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku          text NOT NULL UNIQUE,
  barcode      text NULL,
  attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_rial   bigint NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  CONSTRAINT variant_price_non_negative CHECK (price_rial >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_variants_barcode
  ON product_variants (barcode) WHERE barcode IS NOT NULL;

-- ماتریسِ سازگاری: هر تنوع با چند مدل گوشی (بسیار-به-بسیار)
CREATE TABLE IF NOT EXISTS product_compatibility (
  variant_id      uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  device_model_id uuid NOT NULL REFERENCES device_models(id) ON DELETE CASCADE,
  confidence      text NOT NULL DEFAULT 'exact',  -- exact|reported|unverified
  PRIMARY KEY (variant_id, device_model_id)
);
CREATE INDEX IF NOT EXISTS ix_compat_model ON product_compatibility (device_model_id);

-- ---------------------------------------------------------------------
-- انبار و موجودی — حرکات فقط الحاقی (append-only)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id  uuid NULL REFERENCES branches(id),
  name       text NOT NULL,
  is_default boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS stock_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id     uuid NOT NULL REFERENCES product_variants(id),
  warehouse_id   uuid NOT NULL REFERENCES warehouses(id),
  on_hand        integer NOT NULL DEFAULT 0,
  reserved       integer NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, warehouse_id),
  CONSTRAINT stock_on_hand_chk CHECK (on_hand >= 0),
  CONSTRAINT stock_reserved_chk CHECK (reserved >= 0 AND reserved <= on_hand)
);
CREATE INDEX IF NOT EXISTS ix_stock_warehouse ON stock_items (warehouse_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    uuid NOT NULL REFERENCES product_variants(id),
  warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  quantity      integer NOT NULL,
  reason        text NOT NULL,   -- purchase|sale|return|adjust|transfer|count
  reference_type text NULL,
  reference_id  uuid NULL,
  unit_cost_rial bigint NOT NULL DEFAULT 0,
  actor_user_id uuid NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_movements_variant ON stock_movements (variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_movements_created ON stock_movements (created_at DESC);

-- ---------------------------------------------------------------------
-- سفارش‌ها (اسکلتِ فاز ۰؛ تکمیل در فاز ۴)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no      text NOT NULL UNIQUE,
  user_id       uuid NULL REFERENCES users(id),
  branch_id     uuid NULL REFERENCES branches(id),
  channel       text NOT NULL DEFAULT 'web',   -- web|pos|phone
  status        text NOT NULL DEFAULT 'pending_payment',
  subtotal_rial bigint NOT NULL DEFAULT 0,
  discount_rial bigint NOT NULL DEFAULT 0,
  tax_rial      bigint NOT NULL DEFAULT 0,
  shipping_rial bigint NOT NULL DEFAULT 0,
  total_rial    bigint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_channel_chk CHECK (channel IN ('web','pos','phone'))
);
CREATE INDEX IF NOT EXISTS ix_orders_user ON orders (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id     uuid NOT NULL REFERENCES product_variants(id),
  quantity       integer NOT NULL CHECK (quantity > 0),
  unit_price_rial bigint NOT NULL,
  discount_rial  bigint NOT NULL DEFAULT 0,
  tax_rial       bigint NOT NULL DEFAULT 0,
  total_rial     bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_order_items_order ON order_items (order_id);

-- ---------------------------------------------------------------------
-- الگوی Outbox و ثبتِ حسابرسی
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate   text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type  text NOT NULL,
  payload     jsonb NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts    integer NOT NULL DEFAULT 0,
  sent_at     timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_outbox_unsent ON outbox_events (created_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NULL REFERENCES users(id),
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   uuid NULL,
  before_data jsonb NULL,
  after_data  jsonb NULL,
  ip          text NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_logs (entity, entity_id, created_at DESC);
