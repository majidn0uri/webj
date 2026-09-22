-- =====================================================================
-- ۰۲۷ — ویترینِ فروشگاه: نوارِ اعلان، بنرِ اصلی و بنرهای میانی
-- =====================================================================
-- تا پیش از این، هر کمپین یا پیامِ تبلیغاتی یک تغییرِ کد بود: برایِ نوشتنِ
-- «ارسال رایگان بالای ۵۰۰ هزار تومان» در بالایِ سایت باید توسعه‌دهنده صدا
-- زده می‌شد. این دقیقاً نقطه‌ای بود که وعده‌یِ «فروشنده همه‌چیز را خودش
-- اداره می‌کند» در آن می‌شکست.
--
-- اینجا محتوایِ ویترین از کد جدا می‌شود: سه گونه جایگاه (نوارِ اعلان،
-- بنرِ اصلی، بنرِ میانی) که فروشنده خودش می‌سازد، زمان‌دار می‌کند،
-- جابه‌جا می‌کند و خاموش می‌کند.

CREATE TABLE IF NOT EXISTS store_banners (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- announcement = نوارِ باریکِ بالایِ سایت (متنی)
  -- hero         = بنر/اسلایدِ اصلیِ صفحه‌یِ نخست
  -- middle       = بنرِ میانیِ صفحه‌یِ نخست
  kind         text NOT NULL CHECK (kind IN ('announcement', 'hero', 'middle')),
  title        text NOT NULL DEFAULT '',
  body         text NOT NULL DEFAULT '',
  link_url     text,
  -- تصویر (برای hero و middle؛ نوارِ اعلان متنی است و تصویر ندارد)
  image_url    text,
  -- همان پیش‌نمایشِ تارِ رسانه: تا تصویر نیامده، جایش را نگه می‌دارد
  placeholder  text,
  -- رنگِ پس‌زمینه برایِ نوارِ اعلان (اختیاری؛ خالی = رنگِ پیش‌فرضِ پوسته)
  tone         text,
  sort_order   int  NOT NULL DEFAULT 0,
  -- بازه‌یِ نمایش: هر دو سر باز گذاشته شده‌اند (null یعنی بی‌مرز)
  starts_at    timestamptz,
  ends_at      timestamptz,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- نمایشِ هر جایگاه: فعال‌ها، به ترتیبِ دستی، و تازه‌ترین نخست
CREATE INDEX IF NOT EXISTS store_banners_slot_idx
  ON store_banners (kind, is_active, sort_order, created_at DESC);

-- یک قید که جلویِ اشتباهِ رایج را می‌گیرد: پایان پیش از آغاز
ALTER TABLE store_banners
  DROP CONSTRAINT IF EXISTS store_banners_window_chk;
ALTER TABLE store_banners
  ADD CONSTRAINT store_banners_window_chk
  CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at <= ends_at);

-- بنرِ میانی و اصلی بی‌تصویر، رویِ موبایل یک مربعِ بی‌نام می‌شود؛
-- قانون را در پایگاه نگه می‌داریم تا رابط هم مجبور به رعایتش باشد.
ALTER TABLE store_banners
  DROP CONSTRAINT IF EXISTS store_banners_image_chk;
ALTER TABLE store_banners
  ADD CONSTRAINT store_banners_image_chk
  CHECK (kind = 'announcement' OR image_url IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- دسترسی‌ها
--
-- «دیدن» برایِ همه (هر کسی که واردِ پنل می‌شود باید بتواند ببیند چه روی
-- سایت هست)، اما «نوشتن» فقط برایِ مدیر و مدیرِ شعبه — چون بنرِ صفحه‌یِ
-- نخست، ویترینِ فروشگاه است و نباید با هر دسترسیِ ویرایشی عوض شود.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO permissions (key, name) VALUES
  ('banners.read',  'مشاهده‌یِ بنرها و پیام‌هایِ ویترین'),
  ('banners.write', 'ساخت، ویرایش و انتشارِ بنرها و پیام‌هایِ ویترین')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager', 'seller', 'support', 'warehouse_keeper', 'accountant')
   AND p.key = 'banners.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager', 'seller')
   AND p.key = 'banners.write'
ON CONFLICT DO NOTHING;
