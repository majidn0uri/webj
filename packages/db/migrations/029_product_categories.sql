-- ۰۲۹ — درختِ دسته‌بندی
--
-- تا اینجا `product_types` یک فهرستِ تخت بود: پنج دسته، هیچ پیوندی میانشان.
-- برایِ فروشگاهی که قرار است هزاران کالا داشته باشد، تخت بودن یعنی دو چیز:
--
--   • منو همیشه پنج آیتم است، هرچقدر هم کالا اضافه شود؛
--   • خریدار نمی‌تواند «کم‌کم دقیق‌تر کند» — از «شارژر» مستقیم می‌افتد روی
--     صدها کالا، بی‌آنکه بتواند بگوید «شارژرِ دیواری می‌خواهم».
--
-- این مهاجرت همان جدول را درختی می‌کند، نه اینکه دسته‌بندیِ دومی بسازد.
-- چرا؟ چون کالا هم‌اکنون با `type_id` به این جدول پیوند خورده و قالبِ
-- ویژگی‌ها (spec_template) هم همین‌جاست. داشتنِ دو رده‌بندیِ موازی یعنی
-- پرسشِ بی‌پاسخِ «کالا واقعاً در کدام دسته است؟» و هم‌زمان دو منبعِ حقیقت.
--
-- چهار چیزی که درخت بدون آن‌ها خراب می‌شود، اینجا بسته شده است:
--
--   ۱. **چرخه** — دسته‌ای که زیرمجموعه‌یِ خودش شود، درخت را بی‌انتها می‌کند.
--      تریگر راه می‌رود تا بالا و اگر به خودش رسید، رد می‌کند.
--   ۲. **مسیر و ژرفا** — با هر جابه‌جایی، مسیرِ همه‌یِ فرزندان باید درست
--      شود؛ وگرنه نشانی‌هایِ کهنه می‌مانند و نانِ راهنما اشتباه می‌شود.
--   ۳. **نامکِ یکتا در سطح** — دو «شارژر» زیرِ یک پدر یعنی نشانیِ دوپهلو.
--   ۴. **حذفِ امن** — دسته‌ای که کالا دارد یا فرزند دارد، بی‌تکلیف پاک
--      نمی‌شود (مهارِ کلیدِ خارجی با RESTRICT).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ۱) ستون‌هایِ درخت ───────────────────────────────────────────────────────────
ALTER TABLE product_types
  ADD COLUMN IF NOT EXISTS parent_id   uuid    NULL REFERENCES product_types(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS slug        text    NULL,
  ADD COLUMN IF NOT EXISTS depth       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS path        text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sort_order  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS description text    NULL,
  ADD COLUMN IF NOT EXISTS image_url   text    NULL;

-- ۲) انتقالِ آنچه هست: نامک از کلید، و مسیر از نامک ───────────────────────────
UPDATE product_types SET slug = key WHERE slug IS NULL OR slug = '';
UPDATE product_types SET path = '/' || slug WHERE path IS NULL OR path = '';
UPDATE product_types SET depth = 0 WHERE parent_id IS NULL;

-- نام‌هایِ کوتاهِ فارسی به برچسب‌هایِ کامل‌تر — همان‌هایی که در منو می‌بینیم
UPDATE product_types SET name = 'شارژر و آداپتور'   WHERE key = 'charger';
UPDATE product_types SET name = 'کابل و مبدل'       WHERE key = 'cable';
UPDATE product_types SET name = 'قاب و کاور'        WHERE key = 'case';
UPDATE product_types SET name = 'گلس و محافظِ صفحه' WHERE key = 'glass';
UPDATE product_types SET name = 'پاوربانک'          WHERE key = 'powerbank';

ALTER TABLE product_types ALTER COLUMN slug SET NOT NULL;

-- ۲ب) نامکِ خودکار ───────────────────────────────────────────────────────────
-- چرا تریگر و نه «تغییرِ همه‌یِ کدهایی که دسته درج می‌کنند»؟ چون دسته را
-- هم‌اکنون چند جا می‌سازند: بذرافشانِ پایگاه، آزمون‌ها، و از این پس پنل.
-- الزامی کردنِ نامک بدونِ این تریگر یعنی شکستنِ همه‌یِ آن‌ها در همان لحظه،
-- و خطایی که در نخستین اجرا دیده می‌شود. پر کردنِ خودکار از «key» یعنی
-- نشانی همیشه هست، و هر جا بخواهیم بعداً بهترش می‌کنیم.
CREATE OR REPLACE FUNCTION fill_category_slug() RETURNS trigger AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := NEW.key;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_category_slug ON product_types;
CREATE TRIGGER trg_category_slug
  BEFORE INSERT OR UPDATE ON product_types
  FOR EACH ROW EXECUTE FUNCTION fill_category_slug();

-- ۳) مهارها ──────────────────────────────────────────────────────────────────
-- خود-پدری: ساده‌ترین حالتِ چرخه، بی‌هزینه با CHECK
ALTER TABLE product_types DROP CONSTRAINT IF EXISTS product_types_not_self;
ALTER TABLE product_types ADD CONSTRAINT product_types_not_self
  CHECK (parent_id IS NULL OR parent_id <> id);

-- نامک یکتا در سراسرِ درخت (نشانی باید یکتا باشد)
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_types_slug ON product_types (slug);

-- کلید یکتا در سطحِ هر پدر (دو «شارژر» زیرِ یک دسته ممنوع)
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_types_parent_key
  ON product_types (COALESCE(parent_id::text, '(root)'), key);

-- جستجوهایِ پرکاربرد: فرزندانِ یک پدر، و همه‌یِ دسته‌هایِ فعال رویِ درخت
CREATE INDEX IF NOT EXISTS ix_product_types_parent ON product_types (parent_id, sort_order, name);
CREATE INDEX IF NOT EXISTS ix_product_types_active ON product_types (is_active, depth, sort_order);

-- ۴) نگهبانِ چرخه ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prevent_category_cycle() RETURNS trigger AS $$
DECLARE
  cursor_id uuid := NEW.parent_id;
  steps     integer := 0;
BEGIN
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW.id THEN
      RAISE EXCEPTION 'چرخه در درختِ دسته‌ها: یک دسته نمی‌تواند زیرمجموعه‌یِ خودش باشد';
    END IF;
    SELECT parent_id INTO cursor_id FROM product_types WHERE id = cursor_id;
    steps := steps + 1;
    IF steps > 32 THEN
      RAISE EXCEPTION 'ژرفایِ درختِ دسته‌ها بیش از اندازه است (احتمالِ چرخه)';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_category_no_cycle ON product_types;
CREATE TRIGGER trg_category_no_cycle
  BEFORE INSERT OR UPDATE OF parent_id ON product_types
  FOR EACH ROW WHEN (NEW.parent_id IS NOT NULL)
  EXECUTE FUNCTION prevent_category_cycle();

-- ۵) بازسازیِ مسیر و ژرفا ─────────────────────────────────────────────────────
-- جابه‌جاییِ یک شاخه، مسیرِ همه‌یِ فرزندانش را عوض می‌کند. اگر این کار به
-- یادِ فراخوان‌دهنده سپرده شود، بالأخره یک بار فراموش می‌شود و نانِ راهنما
-- (breadcrumb) نشانی‌هایی می‌دهد که دیگر وجود ندارند.
CREATE OR REPLACE FUNCTION recalc_category_branch(root uuid) RETURNS void AS $$
DECLARE
  base_path  text;
  base_depth integer;
BEGIN
  -- نخست از ریشه به بالا می‌رویم تا مسیرِ خودِ گره معلوم شود
  WITH RECURSIVE up AS (
      SELECT id, parent_id, slug, 0 AS lvl
        FROM product_types WHERE id = root
    UNION ALL
      SELECT p.id, p.parent_id, p.slug, up.lvl + 1
        FROM product_types p JOIN up ON p.id = up.parent_id
  )
  SELECT '/' || COALESCE(string_agg(slug, '/' ORDER BY lvl DESC), ''), COALESCE(max(lvl), 0)
    INTO base_path, base_depth
    FROM up;

  -- سپس به پایین می‌آییم و همه‌یِ فرزندان را به‌روز می‌کنیم
  WITH RECURSIVE down AS (
      SELECT id, base_depth AS d, base_path AS p
        FROM product_types WHERE id = root
    UNION ALL
      SELECT c.id, down.d + 1, down.p || '/' || c.slug
        FROM product_types c JOIN down ON c.parent_id = down.id
  )
  UPDATE product_types t
     SET depth = down.d, path = down.p
    FROM down
   WHERE down.id = t.id;
END;
$$ LANGUAGE plpgsql;

-- تریگر تنها برایِ ستون‌هایی می‌آید که مسیر را عوض می‌کنند؛ به‌روزرسانیِ
-- خودِ depth و path دوباره آن را فرا نمی‌خواند (بنابراین بازگشتی نیست).
CREATE OR REPLACE FUNCTION recalc_category_after_change() RETURNS trigger AS $$
BEGIN
  PERFORM recalc_category_branch(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_category_recalc ON product_types;
CREATE TRIGGER trg_category_recalc
  AFTER INSERT OR UPDATE OF parent_id, slug ON product_types
  FOR EACH ROW EXECUTE FUNCTION recalc_category_after_change();

-- ۵ب) ریشه‌هایِ آغازین ───────────────────────────────────────────────────────
-- این پنج دسته تا امروز را «بذرافشانِ کاتالوگ» می‌ساخت. اما درخت باید پیش
-- از بذر هم درست باشد: فرزندانی که در ادامه می‌آیند باید پدری بیابند، و
-- منویِ فروشگاه نباید تا نخستین بذر، تهی بماند. از این پس رده‌بندی جزوِ
-- ساختار است و بذر تنها کالا می‌آورد.
INSERT INTO product_types (key, name, slug, sort_order)
SELECT v.key, v.name, v.key, v.ord
  FROM (VALUES
    ('charger',   'شارژر و آداپتور',   1),
    ('cable',     'کابل و مبدل',       2),
    ('case',      'قاب و کاور',        3),
    ('glass',     'گلس و محافظِ صفحه', 4),
    ('powerbank', 'پاوربانک',          5)
  ) AS v(key, name, ord)
 WHERE NOT EXISTS (SELECT 1 FROM product_types pt WHERE pt.key = v.key);

-- ۶) درختِ آغازین ────────────────────────────────────────────────────────────
-- زیردسته‌هایِ پرمعنا برایِ یک فروشگاهِ لوازمِ جانبی. کالاهایِ کنونی در
-- سطحِ نخست می‌مانند و هرچه بعداً اضافه شود در برگه‌ها جای می‌گیرد.
INSERT INTO product_types (key, name, slug, parent_id, sort_order)
SELECT v.key, v.name, v.slug, (SELECT id FROM product_types WHERE key = v.parent), v.ord
  FROM (VALUES
    ('wall-charger',        'شارژرِ دیواری',     'wall-charger',        'charger',   1),
    ('car-charger',         'شارژرِ فندکی',      'car-charger',         'charger',   2),
    ('wireless-charger',    'شارژرِ بی‌سیم',     'wireless-charger',    'charger',   3),
    ('cable-typec',         'کابلِ تایپ‌سی',     'cable-typec',         'cable',     1),
    ('cable-lightning',     'کابلِ لایتنینگ',    'cable-lightning',     'cable',     2),
    ('adapter',             'مبدل و رابط',       'adapter',             'cable',     3),
    ('case-silicone',       'قابِ سیلیکونی',     'case-silicone',       'case',      1),
    ('case-hard',           'قابِ سخت',          'case-hard',           'case',      2),
    ('case-folio',          'کاورِ کتابی',       'case-folio',          'case',      3),
    ('glass-ceramic',       'گلسِ سرامیکی',      'glass-ceramic',       'glass',     1),
    ('glass-privacy',       'گلسِ حریمِ خصوصی',  'glass-privacy',       'glass',     2),
    ('powerbank-standard',  'پاوربانکِ معمولی',  'powerbank-standard',  'powerbank', 1),
    ('powerbank-wireless',  'پاوربانکِ بی‌سیم',  'powerbank-wireless',  'powerbank', 2)
  ) AS v(key, name, slug, parent, ord)
 WHERE NOT EXISTS (SELECT 1 FROM product_types pt WHERE pt.key = v.key);

-- ۷) دسترسی‌ها ───────────────────────────────────────────────────────────────
-- دیدن برایِ همه‌یِ نقش‌ها (هر کسی در پنل باید بداند کالا کجاست)، ویرایش
-- برایِ مدیر، مدیرِ شعبه و فروشنده — چون جابه‌جاییِ دسته‌ها ظاهرِ فروشگاه را
-- عوض می‌کند و نباید دستِ هر نقشی باشد.
INSERT INTO permissions (key, name) VALUES
  ('categories.read',  'مشاهده‌یِ درختِ دسته‌بندی'),
  ('categories.write', 'ساخت، ویرایش و جابه‌جاییِ دسته‌ها')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager', 'seller', 'support', 'warehouse_keeper', 'accountant')
   AND p.key = 'categories.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager', 'seller')
   AND p.key = 'categories.write'
ON CONFLICT DO NOTHING;

COMMIT;
