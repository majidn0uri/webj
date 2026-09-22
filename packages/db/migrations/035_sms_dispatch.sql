-- ۰۳۵ — پیامک: ارسالی راستین (تلاشِ دوباره، خطایِ آخر، «فقط ایران»)
--
-- چرا این مهاجرت لازم شد؟ چون صندوقِ پیامک تا اینجا «نوشتن» داشت و «خواندن»
-- نه: پیام در صف می‌نشست و هیچ فرستنده‌ای برنمی‌داشتش. برایِ ارسالِ واقعی سه
-- چیز لازم است که در جدول نبود:
--   • «چند بار تلاش شده» — بی‌این، یک شماره‌یِ بد یا یک قطعیِ اینترنت، پیام را
--     تا ابد در صفِ ابدی نگه می‌دارد و بارِ بی‌مورد رویِ سامانه می‌گذارد؛
--   • «خطایِ آخر» — بی‌این، مدیر فقط می‌بیند «شکست خورد» و نمی‌داند چرا (کلیدِ
--     غلط؟ قالبِ تأییدنشده؟ اعتبارِ تمام‌شده؟) و هر بار باید از نو حدس بزند؛
--   • «زمانِ تلاشِ بعد» — فاصله‌یِ فزاینده؛ همان الگویی که در outbox_events هست،
--     تا کارگرِ هر دو دقیقه، به یک سامانه‌یِ پایین‌آمده هجوم نبرد.
--
-- وضعیت‌هایِ تازه:
--   'sending'  رزِ کارگر است؛ اگر کارگر میانه‌یِ کار بمیرد، ۱۰ دقیقه بعد آزاد
--              می‌شود (تکرارِ ارسال ممکن است، ولی هیچ پیامی گم نمی‌شود — و
--              پیامکِ تکراری بهتر از پیامکِ نرسیده است، چون مشتریِ بی‌خبر،
--              کدِ ورودِ خود را هم نمی‌گیرد).
--   'dead'     از تلاش‌ها ناامید شدیم؛ در پنل دیده می‌شود و دستی آزاد می‌گردد.

ALTER TABLE sms_outbox DROP CONSTRAINT IF EXISTS sms_outbox_status_check;
ALTER TABLE sms_outbox ADD CONSTRAINT sms_outbox_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead'));

ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();

-- کارگر هر دور این را می‌خواند؛ با یک فهرستِ خطایِ عمومی، رویِ صدها هزار پیام
--ِ فرستاده‌شده، هر دور یک پیمایشِ کامل بود.
CREATE INDEX IF NOT EXISTS ix_sms_outbox_due
  ON sms_outbox (available_at)
  WHERE status IN ('pending', 'failed', 'sending');

-- «چند تا مانده؟» در پنل و در پایش، بی‌شمردنِ کلِ جدول
CREATE INDEX IF NOT EXISTS ix_sms_outbox_status_created
  ON sms_outbox (status, created_at DESC);

-- شمارشِ وضعیت‌ها در پنل، پس ازِ افزودنِ وضعیت‌هایِ تازه معنا دارد
COMMENT ON TABLE sms_outbox IS
  'صفِ پیامک‌ها — متن از sms_templates می‌آید و ارسالِ واقعی با کارگرِ پس از فروش انجام می‌شود';

-- ─────────────────────────────────────────────────────────────────────────────
-- دسترسیِ «ارسالِ دستیِ صف» — جدا از «دیدنِ صف»
--
-- چرا یک کلیدِ تازه؟ چون دکمهٔ «همین حالا بفرست» پولِ واقعیِ فروشگاه خرج
-- می‌کند (پیامک اعتبار می‌سوزاند) و به دستِ مشتری می‌رسد؛ دیدنِ صندوق یک چیز
-- است و زدنِ دکمهٔ ارسال، چیزِ دیگر. پس فروشنده و حسابدار همان «دیدن» را
-- نگه می‌دارند و ارسال، دستِ مدیر است.
INSERT INTO permissions (key, name) VALUES
  ('sms.outbox.send', 'ارسالِ دستیِ صفِ پیامک')
ON CONFLICT (key) DO NOTHING;

-- نقش‌هایی که در ۰۱۹ با LIKE 'sms.%' پوشش داده شده‌اند در نصبِ تازه خودکار
-- می‌گیرند؛ این سطر برایِ نصب‌هایِ موجود است که ۰۳۵ بعداً روی‌شان اجرا می‌شود.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager') AND p.key = 'sms.outbox.send'
ON CONFLICT DO NOTHING;
