-- =====================================================================
-- مهاجرت ۰۱۳ — قواعدِ کسب‌وکارِ «دستورالعمل اجرایی فروشگاه»
-- ---------------------------------------------------------------------
-- این مهاجرت هر قاعده‌یِ شماره‌دارِ سند (BR-xx) را به یک ساختارِ داده
-- تبدیل می‌کند؛ جایی که سند «پیش‌فرض پیشنهادی» دارد، همان پیش‌فرض در
-- خودِ پایگاه نشانده شده تا سیستم از روزِ نخست بدون تنظیماتِ دستی کار کند.
--
--   BR-01..08  قیمت و تخفیف      → ستون‌هایِ تخفیف و قیمتِ همکاری
--   BR-10..16  موجودی            → نقطه‌ی سفارش + هشدارِ یک‌باره
--   BR-20..26  مشتری             → جدولِ customers (کد ملی یکتا)
--   BR-30..38  پرداخت و چک       → order_payment_lines + checks
--   BR-40..47  سفارش و مرجوعی    → shipments + returns
--   BR-60..64  دسترسی و امنیت    → store_settings + login lockout
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- ۱) مشتریان — کلید یکتا: کد ملی (BR-20) | شناسه‌ی ورود: موبایل
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  national_id         varchar(10) UNIQUE,           -- BR-20: کلید یکتا
  phone               varchar(11) UNIQUE NOT NULL,  -- BR-20: شناسه‌ی ورود
  full_name           text NOT NULL,
  kind                text NOT NULL DEFAULT 'online'
                        CHECK (kind IN ('in_person','online')),
  is_partner          boolean NOT NULL DEFAULT false,  -- BR-22: فقط مدیر
  partner_since       timestamptz NULL,
  partner_ended_at    timestamptz NULL,                -- BR-25
  is_active           boolean NOT NULL DEFAULT true,   -- BR-23: حذف ممنوع
  deactivated_reason  text NULL,
  -- سقف چک بازِ این همکار (ریال)؛ پیش‌فرض صفر یعنی «چک ممنوع» (BR-36)
  check_ceiling_rial  bigint NOT NULL DEFAULT 0 CHECK (check_ceiling_rial >= 0),
  -- اعتبار خریدِ حاصل از مرجوعی (ریال)؛ نقدی نیست و قابل واریز نیست
  credit_rial         bigint NOT NULL DEFAULT 0 CHECK (credit_rial >= 0),
  note                text NULL,
  created_by          uuid NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_customers_partner ON customers (is_partner) WHERE is_partner;

-- آدرس‌هایِ مشتری — کد پستیِ ۱۰ رقمی الزامی (الزامِ ملی)
CREATE TABLE IF NOT EXISTS customer_addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  receiver_name text NOT NULL,
  phone         varchar(11) NOT NULL,
  province      text NOT NULL,
  city          text NOT NULL,
  address       text NOT NULL,
  postal_code   char(10) NOT NULL CHECK (postal_code ~ '^[0-9]{10}$'),
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cust_addr ON customer_addresses (customer_id);

-- علاقه‌مندی‌ها
CREATE TABLE IF NOT EXISTS customer_wishlists (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  variant_id  uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, variant_id)
);

-- سفارش به اکانتِ مشتری وصل می‌شود (سابقه‌ی یکپارچه: حضوری + آنلاین)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id uuid NULL REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS ix_orders_customer ON orders (customer_id);

-- ---------------------------------------------------------------------
-- ۲) قیمت، تخفیف و نقطه‌ی سفارش (BR-01..08 , BR-15)
-- ---------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS reorder_point        integer NOT NULL DEFAULT 0,   -- BR-15
  ADD COLUMN IF NOT EXISTS discount_percent     integer NULL CHECK (discount_percent BETWEEN 1 AND 99),
  ADD COLUMN IF NOT EXISTS discount_amount_rial bigint   NULL CHECK (discount_amount_rial > 0),
  ADD COLUMN IF NOT EXISTS discount_starts_at   timestamptz NULL,             -- BR-03
  ADD COLUMN IF NOT EXISTS discount_ends_at     timestamptz NULL,             -- BR-03
  ADD COLUMN IF NOT EXISTS discount_on_partner  boolean NOT NULL DEFAULT false, -- BR-04
  ADD COLUMN IF NOT EXISTS max_discount_percent integer NOT NULL DEFAULT 0
    CHECK (max_discount_percent BETWEEN 0 AND 100),                            -- BR-05
  -- حالتِ دومِ قیمتِ همکاری: درصدی از قیمت فروش (بخش ۱۱)
  ADD COLUMN IF NOT EXISTS partner_price_percent integer NULL
    CHECK (partner_price_percent BETWEEN 1 AND 99),
  ADD COLUMN IF NOT EXISTS shelf_location text NULL,
  ADD COLUMN IF NOT EXISTS show_in_store  boolean NOT NULL DEFAULT true;

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS partner_price_rial bigint NULL CHECK (partner_price_rial >= 0), -- BR-02
  ADD COLUMN IF NOT EXISTS is_new_until      timestamptz NULL;  -- نشانِ «جدید» روی کارت

-- ---------------------------------------------------------------------
-- ۳) ماتریس و ردیف‌های پرداخت (BR-30 , BR-31)
--    چک وارد صندوق نمی‌شود (BR-35) → در این جدول با method='check' ثبت
--    می‌شود و در جمعِ نقدِ شیفت لحاظ نمی‌گردد.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_payment_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method       text NOT NULL CHECK (method IN
                 ('cash','pos_terminal','card_to_card','online','check','credit')),
  amount_rial  bigint NOT NULL CHECK (amount_rial > 0),
  reference_no text NULL,          -- شماره پیگیریِ کارت‌به‌کارت / رسیدِ کارت‌خوان
  check_id     uuid NULL,          -- پر می‌شود پس از ثبتِ چک (در ۰۱۳/۵ زیر)
  created_by   uuid NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_order_pay_lines ON order_payment_lines (order_id);

-- ---------------------------------------------------------------------
-- ۴) چک‌های دریافتی (BR-33..37 , BR-46)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS checks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_no       varchar(32) UNIQUE NOT NULL,      -- شماره چک: یکتا
  sayad_no       varchar(16) UNIQUE NOT NULL,      -- شناسه صیاد
  bank           text NOT NULL,
  amount_rial    bigint NOT NULL CHECK (amount_rial > 0),
  due_date       date NOT NULL,                    -- سررسید (میلادی در پایگاه، شمسی در رابط)
  drawer_id      uuid NOT NULL REFERENCES customers(id),  -- فقط همکار
  status         text NOT NULL DEFAULT 'in_circulation'
                   CHECK (status IN ('in_circulation','deposited','settled','transferred','bounced','void')),
  image_url      text NULL,
  -- سندِ مبدأ: فاکتور حضوری یا سفارش آنلاین (BR-34)
  document_type  text NULL CHECK (document_type IN ('FS','SO')),
  document_id    uuid NULL,
  -- تهاتر (خرج چک): به کدام فروشنده واگذار شد
  transferred_to text NULL,
  transferred_at timestamptz NULL,
  void_reason    text NULL,                        -- BR-61: ابطال با دلیل
  branch_id      uuid NULL REFERENCES branches(id),
  created_by     uuid NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_checks_drawer_status ON checks (drawer_id, status);
CREATE INDEX IF NOT EXISTS ix_checks_due ON checks (due_date) WHERE status IN ('in_circulation','deposited');

ALTER TABLE order_payment_lines
  ADD CONSTRAINT fk_order_pay_check FOREIGN KEY (check_id) REFERENCES checks(id);

-- تاریخچه‌ی تغییرِ وضعیتِ چک (BR-62)
CREATE TABLE IF NOT EXISTS check_status_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id    uuid NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  from_status text NULL,
  to_status   text NOT NULL,
  reason      text NULL,
  actor_id    uuid NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- ۵) مرسوله‌ها (BR-42 , BR-43) — بدون کد رهگیری ثبت نمی‌شود
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_no     text UNIQUE NOT NULL,               -- MS-1405-0001
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  carrier         text NOT NULL,                      -- پست، تیپاکس، پیک…
  tracking_code   text NOT NULL,                      -- BR-42
  cost_rial       bigint NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'sent'
                    CHECK (status IN ('sent','delivered','returned','lost')),
  shipped_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz NULL,
  receiver_name   text NULL,
  created_by      uuid NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ix_shipments_order ON shipments (order_id);

-- تعرفه‌ی ارسال: روش × شهر (BR-43)
CREATE TABLE IF NOT EXISTS shipping_tariffs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  method_key text NOT NULL,          -- post | tipax | courier
  method_label text NOT NULL,        -- پست پیشتاز | تیپاکس | پیک موتوری
  city       text NOT NULL,
  cost_rial  bigint NOT NULL CHECK (cost_rial >= 0),
  eta_days   integer NOT NULL DEFAULT 3,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (method_key, city)
);

-- ---------------------------------------------------------------------
-- ۶) مرجوعی (BR-44..47)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS returns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no     text UNIQUE NOT NULL,               -- MR-1405-0001
  source_type   text NOT NULL CHECK (source_type IN ('FS','SO')),
  source_id     uuid NOT NULL,
  customer_id   uuid NULL REFERENCES customers(id),
  status        text NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested','approved','rejected','completed')),
  reason        text NOT NULL,                      -- دلیلِ مشتری
  decision_note text NULL,                          -- نظرِ انباردار (BR-45)
  refund_method text NULL CHECK (refund_method IN
                  ('cash','pos_terminal','card_to_card','online','check_void','credit')),
  total_rial    bigint NOT NULL DEFAULT 0,
  journal_entry_id uuid NULL REFERENCES journal_entries(id),  -- BR-47
  requested_by  uuid NULL REFERENCES users(id),
  decided_by    uuid NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz NULL
);
CREATE INDEX IF NOT EXISTS ix_returns_source ON returns (source_type, source_id);

CREATE TABLE IF NOT EXISTS return_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id    uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  variant_id   uuid NOT NULL REFERENCES product_variants(id),
  quantity     integer NOT NULL CHECK (quantity > 0),
  unit_price_rial bigint NOT NULL CHECK (unit_price_rial >= 0),
  condition    text NOT NULL DEFAULT 'ok' CHECK (condition IN ('ok','damaged')),
  fate         text NULL CHECK (fate IN ('to_stock','scrap','to_supplier')),  -- BR-45
  reason       text NULL
);
CREATE INDEX IF NOT EXISTS ix_return_items ON return_items (return_id);

-- ---------------------------------------------------------------------
-- ۷) وضعیت‌هایِ سفارش: «تأییدشده» و «مرجوع‌شده» به چرخه افزوده می‌شود (BR-40)
-- ---------------------------------------------------------------------
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_chk;
ALTER TABLE orders ADD CONSTRAINT orders_status_chk
  CHECK (status IN ('pending_payment','paid','confirmed','processing',
                    'shipped','delivered','cancelled','refunded','returned'));

-- ---------------------------------------------------------------------
-- ۸) هشدارِ نقطه‌ی سفارش — یک‌بار برای هر رسیدن، نه هر روز (BR-15)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reorder_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id  uuid NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  level       integer NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  -- هر کالا در هر زمان فقط یک هشدارِ باز دارد
  UNIQUE NULLS NOT DISTINCT (product_id, variant_id, status) DEFERRABLE INITIALLY DEFERRED
);

-- ---------------------------------------------------------------------
-- ۹) تنظیمات فروشگاه — پیش‌فرض‌هایِ بخش ۱۱ نشانده می‌شوند
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS store_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  description text NOT NULL DEFAULT '',
  updated_by  uuid NULL REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO store_settings (key, value, description) VALUES
  ('sell_without_account',   'false', 'فروش حضوری بدون کد ملی (BR-26) — پیش‌فرض: ممنوع'),
  ('partner_price_mode',     'amount','ساختار قیمت همکاری: مبلغ ثابت | درصد'),
  ('discount_on_partner',    'false', 'اعمال تخفیف روی قیمت همکاری (BR-04) — پیش‌فرض: ندارد'),
  ('trend_definition',       'auto_14d','ترند: پرفروش‌های ۱۴ روز اخیر (خودکار)'),
  ('coupon_enabled',         'false', 'کوپن عمومی — فاز اول: ندارد'),
  ('show_price_to_guest',    'true',  'نمایش قیمت به مهمان — پیش‌فرض: ببیند'),
  ('reviews_enabled',        'true',  'نظرات مشتریان — فعال با تأیید مدیریت'),
  ('compare_enabled',        'false', 'مقایسه کالاها — فاز اول: ندارد'),
  ('blog_enabled',           'false', 'بلاگ/مجله — فاز دوم'),
  ('partner_check_online',   'after_receipt','ارسال سفارش چکی همکار: پس از دریافت چک (BR-34)'),
  ('return_window_days',     '7',     'مهلت مرجوعی (BR-44)'),
  ('reserve_minutes',        '15',    'رزرو موقت هنگام پرداخت آنلاین (BR-12)'),
  ('payment_expiry_hours',   '24',    'انقضای پرداخت سفارش (BR-32)'),
  ('default_check_ceiling',  '0',     'سقف چکِ پیش‌فرضِ همکاران (ریال) — شروع: صفر'),
  ('reorder_point_default',  '10',    'نقطه سفارش پیش‌فرض کالاها'),
  ('cash_diff_alert_rial',   '500000000','آستانه هشدار اختلاف صندوق (۵۰٬۰۰۰ تومان = ۵۰۰٬۰۰۰٬۰۰۰ ریال)'),
  ('sms_enabled',            'false', 'ارسال پیامک (تا زمان اتصال سامانه: غیرفعال)'),
  ('store_name',             'ست‌شاپ','نام فروشگاه در امضای پیامک‌ها'),
  ('store_phone',            '021-00000000','تلفنِ پشتیبانی در پیامکِ چک برگشتی')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- ۱۰) متن استاندارد پیامک‌ها (بخش ۶) — متن‌ها ویرایش‌پذیر، نه ثابت در کد
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_templates (
  key        text PRIMARY KEY,
  body       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sms_templates (key, body) VALUES
  ('welcome',        '{store}: حساب شما فعال شد. خوش آمدید!'),
  ('otp_login',      '{store} — کد ورود شما: {code} — اعتبار ۲ دقیقه'),
  ('order_paid',     'سفارش {order} ثبت شد و مبلغ {amount} تومان دریافت شد. در حال بررسی است — {store}'),
  ('order_confirmed','سفارش {order} تأیید شد و به‌زودی ارسال می‌شود — {store}'),
  ('order_shipped',  'سفارش {order} ارسال شد. کد رهگیری: {tracking} — {store}'),
  ('order_delivered','سفارش {order} تحویل شد. از خرید شما سپاسگزاریم — {store}'),
  ('check_due',      '{store}: یادآوری چک شماره {check} به مبلغ {amount} تومان، سررسید {date}.'),
  ('check_bounced',  '{store}: چک شماره {check} برگشت خورد. لطفاً تا ۳ روز برای تسویه تماس بگیرید: {phone}'),
  ('product_back',   '{store}: کالای «{product}» که درخواست داشتید موجود شد: {link}'),
  ('order_cancelled','سفارش {order} لغو شد. مبلغ {amount} تومان به همان روش پرداخت بازمی‌گردد (۱ تا ۷ روز کاری) — {store}'),
  ('invoice_issued', '{store}: فاکتور {invoice} به مبلغ {amount} تومان صادر شد. لینک: {link}')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS sms_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        varchar(11) NOT NULL,
  template_key text NULL REFERENCES sms_templates(key),
  body         text NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  provider_ref text NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz NULL
);
CREATE INDEX IF NOT EXISTS ix_sms_outbox_status ON sms_outbox (status, created_at);

-- ---------------------------------------------------------------------
-- ۱۱) نظرات مشتریان — با تأیید مدیریت
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id  uuid NULL REFERENCES customers(id) ON DELETE SET NULL,
  author_name  text NOT NULL,
  rating       smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body         text NOT NULL,
  is_approved  boolean NOT NULL DEFAULT false,
  approved_by  uuid NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_reviews_product ON product_reviews (product_id, is_approved);

-- ---------------------------------------------------------------------
-- ۱۲) شماره‌گذاری اسناد (KH, FS, SO, MS, CH, MR, BS) — سالِ شمسی
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_counters (
  prefix      text NOT NULL,
  year        integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prefix, year)
);

COMMIT;
