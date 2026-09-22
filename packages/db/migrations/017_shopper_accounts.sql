-- ============================================================================
-- حسابِ کاربریِ مشتری — مهاجرتِ ۰۱۷
--
-- مسئله: تا اینجا «مشتری» فقط یک ردیف در جدولِ customers برای فروشِ حضوری و
--   اعتباری بود (کدِ ملی، سقفِ چک، اعتبار). خریدارِ آنلاین هیچ هویتی نداشت:
--   سفارش‌ها با «customer_mobile» ثبت می‌شدند و مشتری نمی‌توانست سفارشِ خودش
--   را ببیند، نشانی ذخیره کند، یا کالایی را برایِ بعد نشان‌دار کند.
--
-- تصمیمِ طراحی: به‌جای ساختنِ جدولِ دوم برای «خریدار»، همان جدولِ customers
--   گسترش می‌یابد. چرا؟
--
--   ۱) مشتری یکی است. همان آدمی که حضوری از صندوق می‌خرد بعداً آنلاین هم
--      می‌خرد؛ دو هویت یعنی دو تاریخچه، دو اعتبار، و دوباره‌کاری در دفترکل.
--   ۲) نشانی‌ها (customer_addresses) و علاقه‌مندی‌ها (customer_wishlists)
--      از پیش با customer_id کلید خورده‌اند؛ جدولِ تازه یعنی بازنویسیِ آن‌ها.
--   ۳) یکتاییِ شمارهٔ همراه در customers برقرار است و سفارش‌هایِ پیشین با
--      همین شماره به حساب پیوند می‌خورند (claimGuestOrders در بسته‌ی shopper).
--
--   آنچه جداست، «کیف پولِ اعتباری» نیست بلکه «احرازِ هویت» است: کدِ یک‌بارمصرف،
--   نشست و گذرواژه در سه جدول/ستونِ تازه می‌آیند تا هیچ بخشی از منطقِ اعتبار و
--   چک دست نخورد.
--
-- امنیت:
--   • کدِ پیامکی هرگز با متنِ ساده ذخیره نمی‌شود — فقط درهمه‌اش (code_hash)،
--     و درهمه با نمکِ تصادفیِ هر ردیف است (پس امکانِ جست‌وجویِrainbow هم نیست).
--   • نشانه‌ی نشست (token) هم فقط به صورتِ درهمه ذخیره می‌شود؛ با دسترسی به
--     پایگاه هم نمی‌توان «نشست ساخت»، چون اصلِ نشانه در جایی نیست.
--   • محدودیتِ تلاش و محدودیتِ تعدادِ کدِ فعال، خودِ پایگاه اعمال می‌کند، نه
--     فقط برنامه — چون برنامه ممکن است در آینده از مسیرِ دیگری صدا زده شود.
-- ============================================================================

-- --- ۱) ستون‌هایِ احراز روی خودِ مشتری ---------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS mobile_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- ایمیل اگر داده شود باید یکتا باشد (و رشته‌ی تهی مجاز نیست)
UPDATE customers SET email = NULL WHERE email IS NOT NULL AND btrim(email) = '';
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_key
  ON customers (email) WHERE email IS NOT NULL;

-- --- ۲) کدهایِ یک‌بارمصرف ----------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_otps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile        text NOT NULL,
  purpose       text NOT NULL CHECK (purpose IN ('login', 'register', 'reset')),
  code_hash     text NOT NULL,
  attempts      smallint NOT NULL DEFAULT 0,
  max_attempts  smallint NOT NULL DEFAULT 5,
  consumed_at   timestamptz,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  ip            text
);

-- برایِ یک شماره و یک منظور، فقط یک کدِ زنده می‌ماند. چرا؟ چون اگر پنج کدِ
-- زنده همزمان معتبر باشند، فضایِ حدس از ۱ در ۱۰۰هزار به ۵ در ۱۰۰هزار می‌رود و
-- کدهایِ کهنه هم تا دیر وقت قابلِ استفاده می‌مانند. درخواستِ کدِ تازه، کدِ پیشین
-- را در همان تراکنش می‌سوزاند (در packages/shopper) و این اندیس ضامنِ آن است
-- که هیچ مسیرِ دیگری نتواند دو کدِ زنده بسازد.
--
-- نکته‌یِ فنی: در پستگرس «محدودیتِ یکتایِ شرطی» وجود ندارد؛ یکتاییِ شرطی فقط
-- با اندیسِ یکتا (CREATE UNIQUE INDEX ... WHERE) ساخته می‌شود — برایِ همین اینجا
-- یک عبارتِ جداگانه است، نه یک CONSTRAINT در بدنه‌ی جدول.
CREATE UNIQUE INDEX IF NOT EXISTS customer_otps_one_live
  ON customer_otps (mobile, purpose) WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_otps_mobile_idx
  ON customer_otps (mobile, created_at DESC);

-- --- ۳) نشست‌هایِ مشتری ------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  user_agent    text,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);

CREATE INDEX IF NOT EXISTS customer_sessions_customer_idx
  ON customer_sessions (customer_id);
CREATE INDEX IF NOT EXISTS customer_sessions_expires_idx
  ON customer_sessions (expires_at);

-- --- ۴) یادداشت برایِ رهگیریِ سفارش ------------------------------------------
-- «تاریخچه‌ی وضعیت» از پیش هست (order_status_history). آنچه کم بود، امکانِ
-- یادداشتِ کوتاهِ مشتری روی سفارش است (مثل «زنگ نزنید، فقط پیامک»).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_note text,
  ADD COLUMN IF NOT EXISTS address_id uuid;

-- --- ۵) علاقه‌مندی: یکتاییِ (مشتری، تنوع) ------------------------------------
-- پیش از این ممکن بود یک کالا دو بار نشان‌دار شود؛ یکتایی را پایگاه تضمین
-- می‌کند تا برنامه مجبور نباشد هر بار چک کند.
CREATE UNIQUE INDEX IF NOT EXISTS customer_wishlists_unique
  ON customer_wishlists (customer_id, variant_id);
