-- مهاجرت ۰۱۲ — درگاهِ پرداختِ ایرانی
-- ─────────────────────────────────────────────────────────────────────────────
-- مسئله: جدولِ payments تا اینجا فقط «یک ردیفِ موفق» بود؛ درگاه واقعی به چیزِ
-- بیشتری نیاز دارد، وگرنه پول و سفارش از هم جدا می‌افتند:
--   • authority  — شناسه‌ای که درگاه هنگامِ هدایتِ مشتری می‌دهد. باید یکتا باشد،
--                  چون درگاه ممکن است یک پرداخت را دوبار برگرداند (مثلاً کاربر
--                  دکمه‌ی بازگشت را بزند) و ما نباید دو بار سفارش را تسویه کنیم.
--   • ref_id / کدِ پیگیری — چیزی که به مشتری نشان می‌دهیم و در صورتِ اختلاف
--                  با بانک، مدرک است.
--   • card_pan   — چهار رقمِ آخرِ کارت؛ برای این‌که مشتری بداند با کدام کارت
--                  پرداخته. شماره‌ی کامل را هرگز ذخیره نمی‌کنیم (امنیت + قانون).
--   • تلاش‌ها    — هر درگاه‌رفتن یک ردیف است (ممکن است کاربر بارِ اول انصراف
--                  بدهد و بارِ دوم با درگاهِ دیگر پرداخت کند).
--   • کدِ خطا    — اگر پرداخت ناموفق بود، پیامِ فارسیِ درگاه ذخیره می‌شود تا در
--                  پنل بتوان دلیل را دید، نه این‌که فقط «ناموفق» بنویسد.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway text NOT NULL DEFAULT 'sandbox';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS authority text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS ref_id text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_pan_masked text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_code text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_message text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS callback_url text;

COMMENT ON COLUMN payments.authority IS
  'شناسه‌یِ یکتایِ تراکنش نزدِ درگاه (در زرین‌پال authority، در آی‌دی‌پی id).';
COMMENT ON COLUMN payments.status IS
  'pending (در انتظارِ بازگشت از درگاه) | success (تأیید شده) | failed (ناموفق یا انصراف) | reversed (برگشت خورده)';

-- یکتاییِ authority: جلوگیری از «تأییدِ دوبار» (double-verify)
CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_authority ON payments (authority) WHERE authority IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_payments_order ON payments (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_payments_status ON payments (status, created_at DESC);
