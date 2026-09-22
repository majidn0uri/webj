-- مهاجرت ۰۱۰ — «سندِ جستجو» (search_document)
-- ─────────────────────────────────────────────────────────────────────────────
-- چرا لازم شد؟
--   تا اینجا جستجو فقط روی products.search_key (عنوان + مشخصات) می‌خورد، در حالی
--   که مهم‌ترین پرسشِ مشتریِ این فروشگاه این است: «برای گوشیِ من چی دارید؟».
--   نامِ گوشی در عنوانِ کالا نیست؛ در جدولِ سازگاری است. پس باید «سندِ جستجو»ی
--   هر کالا یک‌جا شامل این‌ها باشد:
--     عنوان + برند + نوعِ کالا + مشخصات + شناسه‌ی کالا (SKU) +
--     ویژگی‌ها + برند و مدلِ همه‌ی گوشی‌هایِ سازگار
--
-- چرا یک ستونِ ذخیره‌شده و نه محاسبه در لحظه‌ی پرس‌وجو؟
--   چون پیوستنِ پنج جدول در هر پرس‌وجوی جستجو، روی هزاران کالا و صدها پرس‌وجو در
--   ثانیه، همان چیزی است که باعث می‌شود جستجو کند شود. اینجا هزینه یک‌بار در
--   زمانِ نوشتن پرداخته می‌شود تا خواندن ارزان بماند.
--
-- نگه‌داری: تریگر. هیچ سرویسی مجاز نیست این ستون را مستقیماً بنویسد؛ تنها راهِ
-- تغییرش، تغییرِ داده‌ی واقعی است — پس نمی‌تواند با واقعیت ناسازگار شود.
-- ─────────────────────────────────────────────────────────────────────────────

-- ۱) نرمال‌سازی در پایگاه‌داده — همزادِ searchKey() در shared-kernel/src/persian.ts
--    قانون: هر متنی که وارد سندِ جستجو می‌شود باید از همین تابع بگذرد، وگرنه
--    «كابل» عربی و «کابل» فارسی دو واژه‌ی متفاوت می‌شوند.
CREATE OR REPLACE FUNCTION setshop_search_key(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(
          replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
            translate(coalesce(t, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
            'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا'), 'ٱ', 'ا'), 'ي', 'ی'), 'ى', 'ی'),
            'ك', 'ک'), 'ؤ', 'و'), 'ئ', 'ی'), 'ة', 'ه')
        ),
        '[ؐ-ًؚ-ٰٟۖ-ۭـ]', '', 'g')          -- اعراب، تشدید، کشیده
      , '[^0-9a-z؀-ۿ]', ' ', 'g')          -- هر چه حرف/رقم نیست → فاصله
    , '\s+', ' ', 'g')                     -- فاصله‌های تکراری → یکی
  )
$$;

-- ۲) ستون
ALTER TABLE products ADD COLUMN IF NOT EXISTS search_document text NOT NULL DEFAULT '';

COMMENT ON COLUMN products.search_document IS
  'سندِ نرمال‌شده‌ی جستجو: عنوان + برند + نوع + مشخصات + SKU + ویژگی‌ها + گوشی‌هایِ سازگار. فقط تریگر آن را می‌نویسد.';

-- ۳) تریگرِ خودِ products — چرا BEFORE و نه AFTER؟
--    چون با AFTER باید یک UPDATE دوم صادر می‌کردیم که دوباره همین تریگر را بالا
--    می‌آورد (بازگشت). در BEFORE مقدارِ NEW را پیش از نوشتن درست می‌کنیم؛
--    بی‌بازگشت و بی‌خواندنِ دوباره‌ی ردیف.
CREATE OR REPLACE FUNCTION setshop_products_set_search_document() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_brand  text;
  v_type   text;
  v_skus   text;
  v_attrs  text;
  v_device text;
BEGIN
  SELECT b.name INTO v_brand FROM brands b WHERE b.id = NEW.brand_id;
  SELECT pt.name INTO v_type FROM product_types pt WHERE pt.id = NEW.type_id;

  SELECT string_agg(pv.sku, ' ') INTO v_skus
    FROM product_variants pv WHERE pv.product_id = NEW.id;

  SELECT string_agg(pa.values::text, ' ') INTO v_attrs
    FROM product_attributes pa WHERE pa.product_id = NEW.id;

  -- نامِ گوشی‌هایِ سازگار: دلیلِ اصلیِ این مهاجرت
  SELECT string_agg(DISTINCT db2.name || ' ' || dm.name, ' ') INTO v_device
    FROM product_variants pv
    JOIN product_compatibility pc ON pc.variant_id = pv.id
    JOIN device_models dm         ON dm.id = pc.device_model_id
    JOIN device_brands db2        ON db2.id = dm.brand_id
   WHERE pv.product_id = NEW.id;

  NEW.search_document := setshop_search_key(
    concat_ws(' ',
      NEW.title,
      NEW.search_key,
      NEW.description,
      v_brand,
      v_type,
      v_skus,
      v_attrs,
      v_device
    )
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_products_search_document ON products;
CREATE TRIGGER trg_products_search_document
BEFORE INSERT OR UPDATE OF title, search_key, description, brand_id, type_id
ON products
FOR EACH ROW EXECUTE FUNCTION setshop_products_set_search_document();

-- ۴) تریگرِ جداولِ وابسته: اگر مشخصات، تنوع، ویژگی یا سازگاریِ یک کالا عوض شود،
--    سندِ جستجویِ همان کالا بازسازی می‌شود.
CREATE OR REPLACE FUNCTION setshop_touch_product_search_document() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_product_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'product_variants' THEN
    v_product_id := coalesce(NEW.product_id, OLD.product_id);
  ELSIF TG_TABLE_NAME = 'product_attributes' THEN
    v_product_id := coalesce(NEW.product_id, OLD.product_id);
  ELSIF TG_TABLE_NAME = 'product_compatibility' THEN
    -- سازگاری به «تنوع» وصل است؛ تنوع به کالا
    SELECT pv.product_id INTO v_product_id
      FROM product_variants pv
     WHERE pv.id = coalesce(NEW.variant_id, OLD.variant_id);
  END IF;

  IF v_product_id IS NOT NULL THEN
    -- چرا `SET title = title` و نه `SET search_document = search_document`؟
    -- چون تریگرِ بالا از نوعِ UPDATE OF title, search_key, … است: اگر ستونِ
    -- search_document را بنویسیم، تریگر بالا نمی‌آید و مقدار هرگز بازسازی
    -- نمی‌شود. نوشتنِ همان مقدارِ title هیچ تغییری در داده ایجاد نمی‌کند،
    -- اما تریگر را بالا می‌آورد تا سند را از نو بسازد.
    UPDATE products SET title = title WHERE id = v_product_id;
  END IF;

  RETURN NULL;  -- AFTER trigger: خروجی بی‌اهمیت است
END $$;

DROP TRIGGER IF EXISTS trg_variants_search_document ON product_variants;
CREATE TRIGGER trg_variants_search_document
AFTER INSERT OR UPDATE OR DELETE ON product_variants
FOR EACH ROW EXECUTE FUNCTION setshop_touch_product_search_document();

DROP TRIGGER IF EXISTS trg_attrs_search_document ON product_attributes;
CREATE TRIGGER trg_attrs_search_document
AFTER INSERT OR UPDATE OR DELETE ON product_attributes
FOR EACH ROW EXECUTE FUNCTION setshop_touch_product_search_document();

DROP TRIGGER IF EXISTS trg_compat_search_document ON product_compatibility;
CREATE TRIGGER trg_compat_search_document
AFTER INSERT OR UPDATE OR DELETE ON product_compatibility
FOR EACH ROW EXECUTE FUNCTION setshop_touch_product_search_document();

-- ۵) پر کردنِ داده‌ی موجود (backfill) — مهاجرت باید روی پایگاه‌داده‌ی پُر هم درست کار کند
--    نکته: `SET search_document = search_document` کافی نیست! تریگرِ بالا فقط روی
--    تغییرِ ستون‌هایِ معنادار (UPDATE OF title, …) بالا می‌آید، بنابراین باید یکی از
--    همان ستون‌ها در SET بیاید تا تریگر اجرا شود. مقدار عوض نمی‌شود؛ فقط بازسازی می‌گردد.
UPDATE products SET title = title;

-- ۶) ایندکس
--    الف) الگوی پیشوند (LIKE 'x%') برای تکمیلِ خودکار و تطبیقِ ابتدای واژه؛
--    ب) سه‌حرفی (pg_trgm) برای «شبیه» — اگر افزونه نباشد، رد می‌شود و جستجو با
--       LIKE/-position سرپا می‌ماند (کندتر، ولی درست).
CREATE INDEX IF NOT EXISTS ix_products_search_document
  ON products (search_document text_pattern_ops);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') THEN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE INDEX IF NOT EXISTS ix_products_search_document_trgm
      ON products USING gin (search_document gin_trgm_ops);
  ELSE
    RAISE NOTICE 'pg_trgm در دسترس نیست — جستجو بدون ایندکسِ سه‌حرفی ادامه می‌یابد';
  END IF;
END $$;
