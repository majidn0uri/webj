-- ۰۳۳ — مهارِ بار (Rate limiting) و دیده‌بانی
--
-- دو کاستی هم‌زمان بسته می‌شود:
--
-- ۱) **هیچ سقفی بر تعدادِ درخواست‌ها نبود.** یعنی یک اسکریپتِ ساده می‌توانست
--    در یک ثانیه هزار بار «کدِ یک‌بارمصرف» بفرستد (هزینه‌ی مستقیمِ پیامک)،
--    هزار کوپن را یکی‌یکی بیازماید (کد را حدس بزند)، یا هزار سبد به سفارش
--    ببندد و موجودی را قفل کند. این‌ها حمله‌یِ پیچیده‌ای نیست؛ نبودِ سقف،
--    ساده‌ترین اسکریپت را به حمله تبدیل می‌کند.
--
-- ۲) **هیچ آماری از رفتارِ سامانه ثبت نمی‌شد.** وقتی سامانه کند می‌شد، تنها
--    داده‌یِ موجود «احساسِ کندی» بود: نمی‌دانستیم کدام مسیر کند است، چند
--    درخواست در ثانیه می‌آید، چندتایشان خطا است، و کِی شروع شد. در مقیاسِ
--    «هزاران خریدارِ هم‌زمان»، بی‌داده ماندن یعنی حدس زدن.
--
-- سه جدول:
--   • `rate_limit_rules`    — قاعده‌ها؛ **از پنل ویرایش می‌شوند** (مدیر بی‌کد).
--   • `rate_limit_counters` — شمارنده‌یِ پنجره‌هایِ زمانی (برایِ قاعده‌هایِ
--                             حساس که باید میانِ چند نمونه‌ی API یکسان باشند).
--   • `rate_limit_events`   — ردِّ مسدودشدن‌ها؛ فقط برایِ این‌که مدیر بتواند
--                             بفهمد «چه کسی و کِی و کجا» بسته شد.
--
-- یک تصمیمِ مهم: قاعده‌ها دو «جایگاهِ شمارش» دارند (`store`):
--   • `memory` برایِ مسیرهایِ پُرفشار (فهرست، جستجو، برگه‌یِ کالا) — هر ردیفِ
--     درخواست نباید بهایِ یک نوشتن در پایگاه داشته باشد؛ سقفِ این قاعده‌ها
--     «تقریبی» است و با چند نمونه‌ی API به نسبتِ تعدادشان گشادتر می‌شود، که
--     برایِ خواندنِ عمومی پذیرفتنی است.
--   • `db` برایِ مسیرهایِ امنیتی (ورود، کدِ یک‌بارمصرف، کوپن، ثبتِ سفارش،
--     نظر) — این‌ها کم‌تعداد اما تعیین‌کننده‌اند و باید میانِ همه‌یِ نمونه‌ها
--     یکسان شمرده شوند. بهایش یک نوشتنِ سبک به‌ازایِ درخواست است.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ۱) قاعده‌هایِ مهارِ بار ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limit_rules (
  name            text PRIMARY KEY,
  title           text        NOT NULL,
  hint            text        NOT NULL DEFAULT '',
  max_requests    integer     NOT NULL CHECK (max_requests BETWEEN 1 AND 1_000_000),
  window_seconds  integer     NOT NULL CHECK (window_seconds BETWEEN 1 AND 86_400),
  -- ip = بر پایهٔ نشانیِ تماس‌گیرنده؛ ip_user = نشانی + نشست/توکن؛
  -- user = فقط نشست/توکن (بی‌نام‌ها با نشانی‌شان شناخته می‌شوند)
  scope           text        NOT NULL DEFAULT 'ip'
                              CHECK (scope IN ('ip', 'ip_user', 'user')),
  -- memory = در همین فرآیند (ارزان، تقریبی)؛ db = در پایگاه (یکسان در همه‌جا)
  store           text        NOT NULL DEFAULT 'memory'
                              CHECK (store IN ('memory', 'db')),
  is_enabled      boolean     NOT NULL DEFAULT true,
  updated_by      uuid        NULL REFERENCES users(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO rate_limit_rules (name, title, hint, max_requests, window_seconds, scope, store) VALUES
  ('public.read', 'خواندنِ عمومی (فهرست، برگه‌یِ کالا، دسته‌ها)',
   'سقفِ هر بازدیدکننده در یک دقیقه. تماس‌هایِ درونیِ وب (سرور به سرور) حساب نمی‌شوند.',
   600, 60, 'ip', 'memory'),
  ('search', 'جستجو',
   'جستجو گران‌ترین خواندنِ سامانه است؛ سقفش از بقیه‌یِ صفحه‌ها کمتر است.',
   120, 60, 'ip', 'memory'),
  ('public.write', 'تغییرهایِ عمومی (سبد، نشانی، دیدگاه)',
   'هر نوشتنِ بی‌نام؛ برایِ جلوگیری از انباشتِ سبدها و رکوردهایِ بی‌صاحب.',
   120, 60, 'ip', 'memory'),
  ('auth.login', 'ورود با رمز',
   'کوششِ ورود (پنل و فروشگاه). پایگاهِ داده هم هر کوشش را در login_attempts ثبت می‌کند.',
   10, 600, 'ip', 'db'),
  ('auth.otp', 'درخواستِ کدِ یک‌بارمصرف',
   'هر کد یک پیامک است و پیامک پول دارد؛ این سقف مستقیم جلویِ هزینه‌یِ ساختگی را می‌گیرد.',
   8, 600, 'ip', 'db'),
  ('coupon.validate', 'آزمودنِ کدِ تخفیف',
   'بدون این سقف می‌توان همه‌یِ کدهایِ کوتاه را یکی‌یکی آزمود تا یکی درآید.',
   30, 600, 'ip', 'db'),
  ('order.create', 'ثبتِ سفارش',
   'ثبتِ سفارش موجودی را رزرو می‌کند؛ سقفش جلویِ قفل‌کردنِ انبار با سفارشِ ساختگی را می‌گیرد.',
   10, 3600, 'ip_user', 'db'),
  ('review.create', 'نوشتنِ دیدگاه',
   'چند دیدگاه در یک ساعت از یک نشست، بیشترش تبلیغ است نه تجربه‌یِ خرید.',
   10, 3600, 'ip_user', 'db'),
  ('media.upload', 'بارگذاریِ تصویر',
   'هر بارگذاری یعنی خواندن، تغییر اندازه و نوشتن روی دیسک — گران‌ترین کارِ پنل.',
   40, 600, 'user', 'db')
ON CONFLICT (name) DO NOTHING;

-- ۲) شمارنده‌ها (فقط برایِ قاعده‌هایی با store = 'db') ────────────────────────
--
-- پنجره‌ها «هم‌راستا با مبدأِ زمان» اند (مضربِ ثابتِ window_seconds)، نه
-- «از نخستین درخواست». چرا؟ چون با پنجره‌یِ هم‌راستا، شمارنده در یک دستورِ
-- پایگاه به‌روزرسانی و هم‌زمان منقضی می‌شود (ON CONFLICT) — بی‌آنکه نیاز به
-- خواندن پیش از نوشتن یا قفلِ جداگانه باشد. ردیف‌هایِ قدیمی هم با یک شرطِ
-- ساده پاک می‌شوند.
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  rule_name          text        NOT NULL,
  bucket_key         text        NOT NULL,
  window_started_at  timestamptz NOT NULL,
  count              integer     NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (rule_name, bucket_key)
);

-- پاک‌سازی: ردیف‌هایِ کهنه‌تر از یک روز بی‌فایده‌اند (هر پنجره حداکثر یک روز است)
CREATE INDEX IF NOT EXISTS ix_rate_limit_counters_stale
  ON rate_limit_counters (window_started_at);

-- ۳) ردِّ مسدودشدن‌ها ───────────────────────────────────────────────────────
--
-- یک نکته‌یِ امنیتی: ثبتِ هر مسدودشدن یعنی یک مهاجم می‌تواند همین جدول را با
-- درخواست‌هایِ مسدودشده پر کند. پس به‌ازایِ هر «سطل در هر پنجره» فقط یک ردیف
-- نوشته می‌شود (کلیدِ یکتا) — یعنی جدول به اندازه‌یِ تعدادِ سطل‌ها رشد
-- می‌کند، نه به اندازه‌یِ تعدادِ حمله.
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id                 bigserial   PRIMARY KEY,
  rule_name          text        NOT NULL,
  bucket_key         text        NOT NULL,
  window_started_at  timestamptz NOT NULL,
  ip                 text        NULL,
  method             text        NULL,
  path               text        NULL,
  trace_id           text        NULL,
  seen               integer     NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_rate_limit_events_bucket
  ON rate_limit_events (rule_name, bucket_key, window_started_at);
CREATE INDEX IF NOT EXISTS ix_rate_limit_events_recent
  ON rate_limit_events (last_seen_at DESC);

-- ۴) کلیدِ روشن/خاموش و کلیدِ تماسِ درونی ────────────────────────────────────
--
-- `rate_limit_enabled`: اگر روزی مهارِ بار مشتریِ واقعی را بست، مدیر باید
-- بتواند در یک لحظه آن را خاموش کند — بی‌آنکه به سرور دسترسی داشته باشد.
INSERT INTO store_settings (key, value, description) VALUES
  ('rate_limit_enabled', 'true', 'مهارِ بار (محدود کردنِ شمارِ درخواست‌ها) روشن باشد؟'),
  ('observability_retention_days', '7', 'ردِّ درخواست‌ها و مسدودشدن‌ها چند روز نگه داشته شود؟')
ON CONFLICT (key) DO NOTHING;

-- ۵) دسترسی‌ها ───────────────────────────────────────────────────────────────
-- دیدنِ آمار برایِ مدیرِ کل و مدیرِ شعبه (کندی را باید همان کسی ببیند که
-- پاسخ‌گوست)، تغییرِ سقف‌ها فقط برایِ مدیرِ کل: سقف را اگر کسی بتواند کم
-- کند، می‌تواند فروشگاه را برایِ دیگران ببندد.
INSERT INTO permissions (key, name) VALUES
  ('observability.read',  'دیدنِ آمارِ سلامت و کندیِ سامانه'),
  ('observability.write', 'تغییرِ سقف‌هایِ مهارِ بار و پاک‌سازیِ قفل‌ها')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager')
   AND p.key = 'observability.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin')
   AND p.key = 'observability.write'
ON CONFLICT DO NOTHING;

COMMIT;
