-- =====================================================================
-- جستجویِ فارسی (فاز ۹) — فرهنگِ مترادفِ مدیریت‌پذیر و ثبتِ جستجوها
-- ---------------------------------------------------------------------
-- دو جدول و سه تصمیم:
--
--  ۱) «فرهنگِ مترادف» در پایگاه‌داده باشد، نه فقط در کد. چون واژه‌هایِ
--     بازار تغییر می‌کنند و فروشنده باید بتواند بدونِ انتشارِ نسخه‌ی تازه،
--     یک املایِ تازه را به واژه‌یِ درست پیوند بزند. نسخه‌یِ کد فقط پیش‌فرضِ
--     کارخانه است که اینجا درج می‌شود.
--
--  ۲) «جستجویِ بی‌نتیجه» ثبت شود. بزرگ‌ترین هزینه‌یِ پنهانِ هر فروشگاه،
--     کالایی است که مشتری به‌دنبالش می‌گردد و پیدا نمی‌کند — چون دیده نمی‌شود.
--     با ثبتِ عبارت‌هایِ بی‌نتیجه، این تقاضا قابلِ اندازه‌گیری و تأمین می‌شود.
--
--  ۳) مترادف‌ها «نرمال‌شده» ذخیره می‌شوند (ستون *_key) تا مقایسه با
--     خروجیِ تابعِ نرمال‌سازی یکسان باشد؛ در غیر این صورت «كابل» (عربی)
--     با «کابل» (فارسی) برابر نمی‌شد.
-- =====================================================================

-- --- فرهنگِ مترادف‌ها
CREATE TABLE IF NOT EXISTS search_synonyms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term        text NOT NULL,              -- آنچه فروشنده می‌نویسد
  term_key    text NOT NULL,              -- همان، نرمال‌شده برای مقایسه
  canonical   text NOT NULL,              -- واژه‌یِ مقصد
  canonical_key text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_search_synonym UNIQUE (term_key, canonical_key)
);
CREATE INDEX IF NOT EXISTS ix_search_synonyms_canonical ON search_synonyms (canonical_key);

-- --- ثبتِ جستجوها (برای یافتنِ تقاضایِ پاسخ‌داده‌نشده)
CREATE TABLE IF NOT EXISTS search_queries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw         text NOT NULL DEFAULT '',   -- عبارتِ خامِ کاربر
  normalized  text NOT NULL DEFAULT '',   -- پس از نرمال‌سازی و گسترش
  results     integer NOT NULL DEFAULT 0, -- تعدادِ نتیجه
  channel     text NOT NULL DEFAULT 'web',
  device_model_id uuid NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_search_queries_created ON search_queries (created_at DESC);
-- ایندکسِ ویژه برای گزارشِ «جستجوهایِ بی‌نتیجه» — پرتکرارترین پرس‌وجویِ مدیر
CREATE INDEX IF NOT EXISTS ix_search_queries_empty ON search_queries (created_at DESC)
  WHERE results = 0;

-- --- پیش‌فرضِ کارخانه: مجموعه‌یِ مترادف‌هایِ بازارِ لوازمِ جانبیِ موبایل
-- (همان‌هایی که در packages/shared-kernel/src/search.ts هستند؛ اینجا هم درج
--  می‌شوند تا بتوان در پنل ویرایششان کرد.)
INSERT INTO search_synonyms (term, term_key, canonical, canonical_key) VALUES
  ('ایفون', 'ایفون', 'آیفون', 'آیفون'),
  ('iphone', 'iphone', 'آیفون', 'آیفون'),
  ('اپل', 'اپل', 'آیفون', 'آیفون'),
  ('سامسونق', 'سامسونق', 'سامسونگ', 'سامسونگ'),
  ('samsung', 'samsung', 'سامسونگ', 'سامسونگ'),
  ('شایومی', 'شایومی', 'شیائومی', 'شیائومی'),
  ('xiaomi', 'xiaomi', 'شیائومی', 'شیائومی'),
  ('هایووی', 'هایووی', 'هواوی', 'هواوی'),
  ('huawei', 'huawei', 'هواوی', 'هواوی'),
  ('شارجر', 'شارجر', 'شارژر', 'شارژر'),
  ('charger', 'charger', 'شارژر', 'شارژر'),
  ('اداپتور', 'اداپتور', 'آداپتور', 'آداپتور'),
  ('adapter', 'adapter', 'آداپتور', 'آداپتور'),
  ('کیبل', 'کیبل', 'کابل', 'کابل'),
  ('cable', 'cable', 'کابل', 'کابل'),
  ('هدفون', 'هدفون', 'هندزفری', 'هندزفری'),
  ('earphone', 'earphone', 'هندزفری', 'هندزفری'),
  ('ایربادز', 'ایربادز', 'هندزفری', 'هندزفری'),
  ('پاور بنک', 'پاور بنک', 'پاوربانک', 'پاوربانک'),
  ('powerbank', 'powerbank', 'پاوربانک', 'پاوربانک'),
  ('شارژر همراه', 'شارژر همراه', 'پاوربانک', 'پاوربانک'),
  ('کاور', 'کاور', 'قاب', 'قاب'),
  ('cover', 'cover', 'قاب', 'قاب'),
  ('case', 'case', 'قاب', 'قاب'),
  ('محافظ صفحه', 'محافظ صفحه', 'گلس', 'گلس'),
  ('glass', 'glass', 'گلس', 'گلس'),
  ('ضد ضربه', 'ضد ضربه', 'ضدضربه', 'ضدضربه'),
  ('shockproof', 'shockproof', 'ضدضربه', 'ضدضربه'),
  ('ضد آب', 'ضد آب', 'ضدآب', 'ضدآب'),
  ('waterproof', 'waterproof', 'ضدآب', 'ضدآب'),
  ('اورجینال', 'اورجینال', 'اصلی', 'اصلی'),
  ('original', 'original', 'اصلی', 'اصلی'),
  ('ژله‌ای', 'ژلهای', 'سیلیکونی', 'سیلیکونی'),
  ('silicone', 'silicone', 'سیلیکونی', 'سیلیکونی'),
  ('شارژر ماشین', 'شارژر ماشین', 'فندکی', 'فندکی'),
  ('car charger', 'car charger', 'فندکی', 'فندکی'),
  ('وایرلس', 'وایرلس', 'بیسیم', 'بیسیم'),
  ('wireless', 'wireless', 'بیسیم', 'بیسیم')
ON CONFLICT (term_key, canonical_key) DO NOTHING;
