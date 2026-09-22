-- ۰۳۰ — بسته‌بندی در چرخه‌یِ سفارش، و «اطلاع بده وقتی موجود شد»
--
-- دو خواسته‌یِ سند در یک مهاجرت، چون هر دو یک نقطه را هدف می‌گیرند:
-- «میانِ خرید و رسیدنِ کالا، مشتری در جریان باشد».
--
-- الف) **بسته‌بندی یک گامِ جدا است.** تا امروز سفارش از «تأییدشده» یک‌راست
--    به «ارسال‌شده» می‌رفت. یعنی انبار یا بسته را بسته‌بندی کرده و کدِ
--    رهگیری گرفته بود — و در این صورت بسته‌بندی در جایی ثبت نمی‌شد — یا
--    کالا بدونِ بسته‌بندیِ ثبت‌شده می‌رفت. در هر دو حالت، پرسشِ «این سفارش
--    بسته‌بندی شده یا نه؟» بی‌پاسخ می‌ماند؛ پرسشی که پشتیبان هر روز با آن
--    روبه‌روست.
--
-- ب) **«اطلاع بده وقتی موجود شد» جدولِ خودش را دارد.** جدولِ reorder_alerts
--    از پیش هست، اما آن برایِ **هشدارِ داخلیِ انبار** است: به کالا پیوند
--    می‌خورد (نه به تنوع)، برایِ هر کالا یکی است، و مشتری در آن راهی ندارد.
--    قاطی کردنِ این دو یعنی پیامی که باید به بیست مشتری برود، به یک هشدارِ
--    تکیِ داخلی تقلیل می‌یابد.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ۱) «بسته‌بندی» به چرخه افزوده می‌شود ────────────────────────────────────────
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_chk;
ALTER TABLE orders ADD CONSTRAINT orders_status_chk
  CHECK (status IN ('pending_payment','paid','confirmed','packing','processing',
                    'shipped','delivered','cancelled','refunded','returned'));

-- چه کسی، کی، و با چه یادداشتی بست
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS packed_at    timestamptz NULL,
  ADD COLUMN IF NOT EXISTS packed_by    uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS packing_note text NULL;

-- بسته‌بندی کامل است یا ناقص (کسریِ کالا): با یادداشت تنها نمی‌توان
-- گزارش گرفت، و کسری همان چیزی است که پشتیبان باید پیش از تماس بداند.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS packing_complete boolean NULL;

-- مهار: بسته‌بندیِ کامل/ناقص بدونِ زمان و بسته‌بند بی‌معناست
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_packed_chk;
ALTER TABLE orders ADD CONSTRAINT orders_packed_chk
  CHECK (
    (packed_at IS NULL AND packed_by IS NULL AND packing_complete IS NULL)
    OR (packed_at IS NOT NULL AND packed_by IS NOT NULL AND packing_complete IS NOT NULL)
  );

-- ۲) درخواستِ «خبرم کن وقتی موجود شد» ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id   uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  -- کالا را هم نگه می‌داریم: برایِ گزارشِ «چند نفر منتظرِ این کالایند» بی
  -- آنکه هر بار به جدولِ تنوع سر بزنیم.
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id  uuid NULL REFERENCES customers(id) ON DELETE CASCADE,
  phone        varchar(11) NULL,   -- برایِ کسی که حساب ندارد
  channel      text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','email')),
  email        text NULL,
  status       text NOT NULL DEFAULT 'waiting'
                 CHECK (status IN ('waiting','notified','cancelled')),
  source       text NOT NULL DEFAULT 'web' CHECK (source IN ('web','panel','pos')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  notified_at  timestamptz NULL,
  cancelled_at timestamptz NULL,
  note         text NULL,
  CONSTRAINT stock_notifications_contact_chk
    CHECK (customer_id IS NOT NULL OR phone IS NOT NULL OR email IS NOT NULL)
);

-- هر کس یک‌بار برایِ یک تنوع در صف می‌ماند؛ درخواستِ دوم همان درخواستِ
-- نخست است، نه صفِ دو نفره (وگرنه یک نفر چند پیام می‌گیرد).
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_notify_waiting_customer
  ON stock_notifications (variant_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_notify_waiting_phone
  ON stock_notifications (variant_id, phone) WHERE phone IS NOT NULL;

-- پرکاربردترین خواندن: «چه کسانی منتظرِ این تنوع‌اند؟»
CREATE INDEX IF NOT EXISTS ix_stock_notify_waiting
  ON stock_notifications (variant_id, status, created_at);
CREATE INDEX IF NOT EXISTS ix_stock_notify_status
  ON stock_notifications (status, created_at DESC);

-- ۳) تنظیم‌ها ────────────────────────────────────────────────────────────────
INSERT INTO store_settings (key, value, description) VALUES
  ('stock_notify_enabled',   'true', 'دکمه‌ی «خبرم کن وقتی موجود شد» روی صفحه‌ی کالا باشد؟'),
  ('stock_notify_max_per_variant', '200', 'بیشینه‌ی درخواستِ انباشته برایِ یک تنوع (جلویِ انباشتِ بی‌پایان)'),
  ('packing_required_before_ship', 'true', 'ارسال پیش از ثبتِ بسته‌بندی ممنوع باشد؟')
ON CONFLICT (key) DO NOTHING;

-- ۴) قالبِ پیامکِ «موجود شد» ──────────────────────────────────────────────────
-- چرا پیوند را برمی‌داریم؟ چون در پیامک، پیوند بی‌نشانیِ سایت بی‌معناست و
-- نشانی هم تنظیمی ندارد که همه‌جا درست باشد؛ تازه هر نویسه در پیامک هزینه
-- دارد. پیام باید همان یک جمله را بگوید: کالایِ تو آمد. مشتری خودش
-- می‌داند کجا برود، و اگر نه، نامِ فروشگاه در آغازِ پیام هست.
UPDATE sms_templates
   SET body = '{store}: کالای «{product}» که درخواست داشتید موجود شد.'
 WHERE key = 'product_back';

COMMIT;
