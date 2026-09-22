-- ─────────────────────────────────────────────────────────────────────────────
-- ۰۲۶ — رسانه: بارگذاریِ تصویر از پنل
-- ─────────────────────────────────────────────────────────────────────────────
--
-- چرا این مهاجرت؟ چون تا پیش از این، تصویرِ کالا یعنی «فایلی که در پوشه‌ی
-- public گذاشته شده» — یعنی فروشنده برایِ افزودنِ یک عکس باید به فایل‌هایِ
-- سرور دسترسی می‌داشت. این با اصلِ «مدیر همه‌چیز را از پنل انجام می‌دهد، بی‌آن
-- که برنامه‌نویسی بداند» سازگار نیست.
--
-- ۱) ستون‌هایِ تازه: سه اندازه‌یِ تصویر + پیش‌نمایشِ تار
-- ---------------------------------------------------------------------------
-- تصویری که فروشنده بار می‌گذارد با تصویری که مشتری می‌بیند یکی نیست: عکسِ
-- ۴۰۰۰ پیکسلیِ گوشی برایِ کاربری با اینترنتِ همراه یعنی اتلافِ وقت و حجم. پس
-- برایِ هر بارگذاری سه اندازه ساخته می‌شود و هر سه در همین جدول نشانی می‌گیرند.
--
-- `placeholder` یک data URIِ بسیار کوچک است (تصویرِ ۱۶ پیکسلیِ تار). فایده‌اش
-- این است که صفحه هنگامِ بارگیری «خالی و پریده» به نظر نمی‌رسد: پیش از رسیدنِ
-- تصویرِ اصلی، همان تارِ رنگی جایش را نگه می‌دارد.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS url_card    text,
  ADD COLUMN IF NOT EXISTS url_thumb   text,
  ADD COLUMN IF NOT EXISTS placeholder text,
  ADD COLUMN IF NOT EXISTS bytes       integer,
  ADD COLUMN IF NOT EXISTS mime        text;

-- نشانی‌یِ هر اندازه یکتاست: اگر دو کالا به یک فایل اشاره کنند، پاکسازی
-- می‌تواند تشخیص دهد که فایل هنوز استفاده می‌شود.
CREATE INDEX IF NOT EXISTS ix_product_images_url_card
  ON product_images (url_card) WHERE url_card IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_product_images_url_thumb
  ON product_images (url_thumb) WHERE url_thumb IS NOT NULL;

-- ۲) دسترسی‌ها
-- ---------------------------------------------------------------------------
-- «دیدنِ رسانه» را هر کسی که کالا می‌بیند دارد، اما «بارگذاری و پیوند دادن»
-- فقط کسی که کالا را ویرایش می‌کند. انباردار و حسابدار کالا درست نمی‌کنند،
-- پس نیازی به دسترسیِ بارگذاری ندارند.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO permissions (key, name) VALUES
  ('media.read',   'مشاهده‌یِ تصویرهایِ کالا'),
  ('media.upload', 'بارگذاری و پیوند دادنِ تصویرِ کالا')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager', 'seller', 'support', 'warehouse_keeper', 'accountant')
   AND p.key = 'media.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager', 'seller')
   AND p.key = 'media.upload'
ON CONFLICT DO NOTHING;
