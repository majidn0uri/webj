-- ---------------------------------------------------------------------------
-- ۰۲۲ — مالیاتِ ایران: ارزش‌افزوده و سامانه‌یِ مؤدیان (صورتحسابِ الکترونیکی)
--
-- چرا این مهاجرت؟ چون فروش در ایران بدونِ صورتحسابِ الکترونیکی، فروشِ نیمه است.
-- از دی‌ماه ۱۴۰۲ «قانونِ پایانه‌هایِ فروشگاهی و سامانه‌یِ مؤدیان» برای همه
-- لازم‌الاجراست: هر فروش باید به سازمانِ امورِ مالیاتی فرستاده شود و یک
-- «شماره‌یِ منحصر‌به‌فردِ مالیاتی» بگیرد. فروشگاهی که این را نداشته باشد،
-- فروشش از نظرِ دارایی «کتمان‌شده» حساب می‌شود — یعنی جریمه، نه فقط نقصِ فنی.
--
-- سه خلأ که امروز در سامانه هست و این مهاجرت پر می‌کند:
--   ۱) هیچ شناسه‌ای برای «کالا/خدمت» رویِ محصول نداریم. سامانه‌یِ مؤدیان برای
--      هر ردیفِ صورتحساب یک «شناسه‌یِ کالا یا خدمت» (sstid) می‌خواهد که از
--      درگاهِ stuffid.tax.gov.ir گرفته می‌شود. بدونِ آن، ارسال ممکن نیست.
--   ۲) هیچ صفی برای ارسال نیست. اینترنت در ایران قطع می‌شود، سامانه‌یِ مؤدیان
--      گاه ساعت‌ها پاسخ نمی‌دهد، و قانون مهلتِ ارسال دارد. بنابراین ارسال باید
--      «صف + تلاشِ دوباره» داشته باشد، نه اینکه به اتمی‌بودنِ یک درخواستِ
--      شبکه‌ای گره بخورد. (تجربه‌یِ عملی: سامانه گاه پاسخِ موفق می‌دهد اما
--      پاسخ به دستِ ما نمی‌رسد؛ برای همین «فرستاده‌شده» از «تأییدشده» جداست.)
--   ۳) وضعیتِ ارسال جایی ثبت نمی‌شد؛ یعنی مدیر نمی‌توانست بگوید کدام فروش‌ها
--      به دارایی رفته و کدام مانده است.
--
-- اینجا فقط «ظرف» ساخته می‌شود: جدولِ صف، ستون‌هایِ شناسه‌یِ کالا، و دسترسی‌ها.
-- منطقِ ساختِ بسته‌یِ صورتحساب در packages/tax است.
-- ---------------------------------------------------------------------------

-- ۱) شناسه‌یِ کالا/خدمت و واحدِ اندازه‌گیری — برایِ هر ردیفِ صورتحساب لازم است
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tax_sstid text,
  ADD COLUMN IF NOT EXISTS tax_unit text NOT NULL DEFAULT 'عدد';

COMMENT ON COLUMN products.tax_sstid IS
  'شناسه‌یِ کالا/خدمت در سامانه‌یِ مؤدیان (از stuffid.tax.gov.ir)؛ بدونِ آن ارسالِ صورتحساب برای این کالا ممکن نیست.';
COMMENT ON COLUMN products.tax_unit IS
  'واحدِ اندازه‌گیری برایِ صورتحساب (فیلدِ mu)؛ پیش‌فرض «عدد».';

-- ۲) صفِ ارسالِ صورتحساب به سامانه‌یِ مؤدیان
CREATE TABLE IF NOT EXISTS tax_invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- هر سفارش دقیقاً یک صورتحساب دارد؛ این یکتایی جلویِ ارسالِ تکراری را
  -- می‌گیرد (تکراری یعنی رد شدن توسطِ سامانه، چون شماره‌یِ سریال تکراری است)
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_no          text NOT NULL,

  -- دوره‌یِ مالیاتی (سال/ماهِ شمسی، مانندِ ۱۴۰۵-۰۶) برای بستنِ اظهارنامه
  period_key        text NOT NULL,

  -- شناسه‌یِ ۲۲ رقمی که خودمان می‌سازیم: شناسه‌یِ حافظه‌یِ مالیاتی + تاریخِ
  -- هگز + سریالِ هگز + رقمِ کنترلی. سامانه آن را باز می‌گرداند.
  taxid             text,

  -- بسته‌یِ آماده‌یِ ارسال؛ نگه می‌داریم تا در صورتِ اختلاف با دارایی،
  -- دقیقاً همان چیزی که فرستاده شد قابلِ بازخوانی باشد
  payload           jsonb NOT NULL,

  status            text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'accepted', 'rejected', 'failed')),

  uid               text,              -- کدِ رهگیریِ سامانه (uid)
  reference_number  text,              -- شماره‌یِ مرجعِ پاسخ
  error_code        text,
  error_detail      text,

  attempts          integer NOT NULL DEFAULT 0,
  next_attempt_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  responded_at      timestamptz,

  CONSTRAINT tax_invoices_order_unique UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS tax_invoices_status_idx
  ON tax_invoices (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS tax_invoices_period_idx
  ON tax_invoices (period_key);

COMMENT ON TABLE tax_invoices IS
  'صفِ ارسالِ صورتحسابِ الکترونیکی به سامانه‌یِ مؤدیان؛ وضعیتِ هر فروش نزدِ سازمانِ امورِ مالیاتی.';

-- ۳) تنظیمات: غیرمحرمانه در پایگاه (کلیدها و متن‌هایِ رمز در محیط/فایل می‌مانند)
INSERT INTO store_settings (key, value, description) VALUES
  ('moadian_enabled', 'false',
   'ارسالِ خودکارِ صورتحساب به سامانه‌یِ مؤدیان'),
  ('moadian_mode', 'sandbox',
   'sandbox = بدونِ ارتباطِ شبکه‌ای (مناسبِ آموزش/تست)، production = ارسالِ واقعی'),
  ('moadian_fiscal_id', '',
   'شناسه‌یِ یکتایِ حافظه‌یِ مالیاتی (از کارپوشه‌یِ my.tax.gov.ir)'),
  ('moadian_client_id', '',
   'شناسه‌یِ مشتری (client id) صادرشده در سامانه‌یِ مؤدیان'),
  ('moadian_taxpayer_national_id', '',
   'شناسه‌یِ ملیِ فروشنده (همان store_national_id اگر تهی باشد)'),
  ('moadian_serial_start', '1',
   'نخستین شماره‌یِ سریالِ داخلیِ صورتحساب (یکتا و افزایشی)'),
  ('moadian_auto_send', 'false',
   'ارسالِ خودکار پس از پرداختِ موفقِ سفارش (بدونِ دخالتِ کاربر)')
ON CONFLICT (key) DO NOTHING;

-- ۴) دسترسی‌ها
INSERT INTO permissions (key, name) VALUES
  ('tax.read',            'مشاهده‌یِ وضعیتِ مالیاتی و اظهارنامه‌یِ ارزش‌افزوده'),
  ('tax.send',            'ارسال و تلاشِ دوباره‌یِ صورتحسابِ الکترونیکی'),
  ('tax.settings.update', 'تغییرِ تنظیماتِ مالیاتی')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'accountant', 'branch_manager')
   AND p.key = 'tax.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'accountant')
   AND p.key = 'tax.send'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key = 'super_admin'
   AND p.key = 'tax.settings.update'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- یادداشتِ امنیتی: کلیدِ خصوصیِ امضاء و گواهی در پایگاه نمی‌آیند. مسیرِ آن‌ها
-- از متغیرهایِ محیطی خوانده می‌شود (MOADIAN_PRIVATE_KEY_PATH و
-- MOADIAN_CERTIFICATE_PATH) و فایل‌ها بیرون از پوشه‌یِ پروژه نگه داشته
-- می‌شوند. اگر کلید در پایگاه بود، هر پشتیبانِ پایگاه یک کلیدِ امضایِ دارایی
-- هم داشت — و این یعنی به خطر افتادنِ کلِ اعتبارِ مالیاتی با یک نشتِ کوچک.
-- ---------------------------------------------------------------------------
