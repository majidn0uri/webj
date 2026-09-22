-- =====================================================================
-- کاتالوگ: تصاویر، ویژگی‌های پویا، و آماده‌سازیِ جستجوی فارسی
-- =====================================================================

-- تصاویرِ کالا — چند تصویر برای هر کالا با ترتیبِ نمایش و نقش
CREATE TABLE IF NOT EXISTS product_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id  uuid NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  url         text NOT NULL,
  alt         text NOT NULL DEFAULT '',
  role        text NOT NULL DEFAULT 'gallery',   -- main|gallery|on-device|detail|video-poster
  sort_order  integer NOT NULL DEFAULT 0,
  width       integer NULL,
  height      integer NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_images_product ON product_images (product_id, sort_order);

-- تعریفِ ویژگی‌ها بر اساسِ نوعِ کالا (فرمِ پویا در پنل — بدون نیاز به کدنویسی)
CREATE TABLE IF NOT EXISTS attribute_defs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_id     uuid NOT NULL REFERENCES product_types(id) ON DELETE CASCADE,
  key         text NOT NULL,                 -- مثال: 'power_watt'
  label       text NOT NULL,                 -- مثال: 'توان (وات)'
  data_type   text NOT NULL DEFAULT 'text',  -- text|number|select|boolean
  options     jsonb NOT NULL DEFAULT '[]'::jsonb,
  unit        text NULL,
  is_filter   boolean NOT NULL DEFAULT false, -- در فیلترهای فروشگاه نمایش داده شود؟
  is_required boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  UNIQUE (type_id, key)
);

-- مقدارِ ویژگی‌ها برای هر کالا (JSONB برای انعطاف، با ایندکسِ GIN)
CREATE TABLE IF NOT EXISTS product_attributes (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  values     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"power_watt": 20, "cable_type": "type-c"}
  PRIMARY KEY (product_id)
);
CREATE INDEX IF NOT EXISTS ix_attributes_gin ON product_attributes USING gin (values);

-- ---------------------------------------------------------------------
-- جستجو: متنِ نرمال‌شده برای جستجوی فارسی
-- (در فاز بعد، OpenSearch جایگزین می‌شود؛ فعلاً نگارشِ قابل‌اتکا در خودِ پایگاه‌داده)
-- ---------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS search_key text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS ix_products_search_key ON products (search_key text_pattern_ops);

-- ایندکسِ سه‌حرفی (pg_trgm) برای جستجوی شبیه — اگر افزونه در دسترس نباشد، رد می‌شود
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') THEN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE INDEX IF NOT EXISTS ix_products_title_trgm ON products USING gin (title gin_trgm_ops);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm در دسترس نیست — جستجو با ILIKE انجام می‌شود';
END $$;

-- ایندکسِ ترکیبی برای پرکاربردترین فیلترِ فروشگاه: وضعیت + برند + قیمت
CREATE INDEX IF NOT EXISTS ix_products_active_brand ON products (status, brand_id);
CREATE INDEX IF NOT EXISTS ix_variants_price ON product_variants (price_rial) WHERE is_active = true;
