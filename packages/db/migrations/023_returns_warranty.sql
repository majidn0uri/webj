-- ═══════════════════════════════════════════════════════════════════════════
-- ۰۲۳ — مرجوعی (RMA) و گارانتی
-- ---------------------------------------------------------------------------
-- چرا این جدول‌ها جدا از «سفارش» اند؟
-- چون مرجوعی سفارشِ منفی نیست. سفارش یک رخدادِ یک‌باره است: پول گرفته شد،
-- کالا رفت. مرجوعی یک «فرآیند» است با زمان‌بندی، بازرسی، تصمیمِ انسانی و
-- پیگیری. اگر آن را با یک ستونِ `status` در سفارش پیاده می‌کردیم:
--   • نمی‌فهمیدیم کدام ردیف‌ها برگشته‌اند (مرجوعیِ جزئیِ یک سفارشِ پنج‌ردیفه)؛
--   • نمی‌توانستیم دو مرجوعیِ جداگانه از یک سفارش داشته باشیم (یکی معیوب،
--     یکی انصراف)؛
--   • تاریخچه‌ی تصمیم‌ها گم می‌شد و در اختلاف با مشتری چیزی برای نشان‌دادن
--     نبود.
-- پس: مرجوعی موجودیتِ مستقل با شماره‌ی سند، ردیف، وضعیت و رخداد است.
--
-- حقِ انصراف: در فروشِ از راهِ دور، مشتری مهلت دارد بی‌دلیل کالا را برگرداند
-- (در ایران: ماده‌ی ۳۷ قانونِ تجارتِ الکترونیکی). این مهلت اینجا «تنظیم» است
-- نه عددِ ثابتِ کد، چون ممکن است فروشگاه بخواهد بخشنده‌تر باشد (دیجی‌کالا
-- فراتر از قانون رفته است). عددِ پیش‌فرض همان ۷ روز است.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS customer_returns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- شماره‌ی سند با صدورِ اتمیک (بدون MAX()+1) — RET-1405-000007
  return_no        text NOT NULL UNIQUE,

  order_id         uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id          uuid NULL REFERENCES users(id),
  branch_id        uuid NULL REFERENCES branches(id),

  -- انگیزه‌ی مرجوعی؛ رویِ مبلغ و مهلت اثر دارد:
  -- withdrawal = انصرافِ بی‌دلیل (مشتری مهلت دارد، کارمزد محتمل است)
  -- defective  = کالای معیوب/اشتباه (فروشنده مقصر است؛ بی‌مهلت و بی‌کارمزد)
  -- warranty   = ادعایِ گارانتی (مهلت = پایانِ گارانتی، نه ۷ روز)
  -- wrong_item = کالایِ اشتباه فرستاده‌شده (فروشنده مقصر است)
  kind             text NOT NULL DEFAULT 'withdrawal'
    CHECK (kind IN ('withdrawal', 'defective', 'warranty', 'wrong_item')),

  status           text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'in_transit',
                      'received', 'inspecting', 'refund_pending', 'refunded',
                      'closed', 'cancelled')),

  reason           text,                 -- دلیل از فهرستِ آماده
  customer_note    text,                 -- توضیحِ خودِ مشتری
  pickup_method    text NOT NULL DEFAULT 'courier'
    CHECK (pickup_method IN ('courier', 'in_person')),
  tracking_code    text,                 -- کدِ رهگیریِ مرسوله‌ی برگشتی

  requested_at     timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  decided_by       uuid REFERENCES users(id),
  decision_note    text,
  received_at      timestamptz,
  received_by      uuid REFERENCES users(id),
  refunded_at      timestamptz,
  refunded_by      uuid REFERENCES users(id),

  refund_method    text
    CHECK (refund_method IN ('original', 'bank_transfer', 'store_credit', 'exchange')),
  refund_rial      bigint NOT NULL DEFAULT 0 CHECK (refund_rial >= 0),
  restock_fee_rial bigint NOT NULL DEFAULT 0 CHECK (restock_fee_rial >= 0),

  -- پیوند به حسابداری: برگشت از فروش یک سند است، نه ویرایشِ سندِ فروش
  entry_id         uuid NULL REFERENCES journal_entries(id),

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_customer_returns_status  ON customer_returns (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS ix_customer_returns_order   ON customer_returns (order_id);
CREATE INDEX IF NOT EXISTS ix_customer_returns_user    ON customer_returns (user_id, requested_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- ردیف‌هایِ مرجوعی
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_return_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id     uuid NOT NULL REFERENCES customer_returns(id) ON DELETE CASCADE,
  -- ردیفِ مرجوعی به «ردیفِ سفارش» وصل است، نه به کالا به‌تنهایی: چون ممکن است
  -- یک سفارش دو بار از یک کالا خریده باشد (دو ردیف) و تنها یکی برگردد.
  order_item_id uuid NOT NULL REFERENCES order_items(id),
  variant_id    uuid NOT NULL REFERENCES product_variants(id),
  quantity      integer NOT NULL CHECK (quantity > 0),

  -- وضعیتِ کالا پس از بازرسی: تعیین می‌کند به موجودی برمی‌گردد یا نه،
  -- و آیا کارمزدِ بازگشت می‌خورد یا نه.
  condition     text NOT NULL DEFAULT 'unknown'
    CHECK (condition IN ('unknown', 'sellable', 'opened', 'damaged', 'defective', 'wrong_item')),
  restock       boolean NOT NULL DEFAULT true,
  refund_rial   bigint NOT NULL DEFAULT 0 CHECK (refund_rial >= 0),
  note          text,

  -- هر ردیفِ سفارش در یک مرجوعی یک بار می‌آید؛ مرجوعیِ دوم، درخواستِ دوم است
  UNIQUE (return_id, order_item_id)
);

CREATE INDEX IF NOT EXISTS ix_customer_return_items_return ON customer_return_items (return_id);
CREATE INDEX IF NOT EXISTS ix_customer_return_items_item   ON customer_return_items (order_item_id);

-- نگهبانِ «بیش‌مرجوعی»: هیچ‌کس — حتی با دسترسیِ مستقیم به پایگاه — نمی‌تواند
-- بیش از آنچه خریده شده مرجوع ثبت کند. این قید در کد هم هست، اما کد را
-- می‌توان دور زد؛ پایگاه را نه.
CREATE OR REPLACE FUNCTION guard_return_quantity() RETURNS trigger AS $$
DECLARE
  purchased integer;
  already   integer;
BEGIN
  SELECT oi.quantity INTO purchased FROM order_items oi WHERE oi.id = NEW.order_item_id;
  IF purchased IS NULL THEN
    RAISE EXCEPTION 'ردیفِ سفارش یافت نشد' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT COALESCE(SUM(ri.quantity), 0) INTO already
    FROM customer_return_items ri
    JOIN customer_returns rr ON rr.id = ri.return_id
   WHERE ri.order_item_id = NEW.order_item_id
     AND rr.status NOT IN ('cancelled', 'rejected')
     AND rr.id <> NEW.return_id;

  IF already + NEW.quantity > purchased THEN
    RAISE EXCEPTION
      'بیش از مقدارِ خریداری‌شده نمی‌توان مرجوع کرد (خرید: % ← پیش‌تر مرجوع‌شده: %)',
      purchased, already
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_return_items_quantity ON customer_return_items;
CREATE TRIGGER trg_customer_return_items_quantity
  BEFORE INSERT OR UPDATE ON customer_return_items
  FOR EACH ROW EXECUTE FUNCTION guard_return_quantity();

-- ─────────────────────────────────────────────────────────────────────────────
-- رخدادهایِ مرجوعی — «چه کسی، کی، چه گفت»
-- در اختلاف (مشتری می‌گوید فرستادم، فروشگاه می‌گوید نرسید) تنها چیزی که
-- کار می‌کند همین خطِ زمان است، نه یادآوریِ کارمند.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_return_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id   uuid NOT NULL REFERENCES customer_returns(id) ON DELETE CASCADE,
  event_type  text NOT NULL,
  from_status text,
  to_status   text,
  actor_id    uuid REFERENCES users(id),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_customer_return_events_return ON customer_return_events (return_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- گارانتی
-- ---------------------------------------------------------------------------
-- چرا «تاریخِ پایان» یک ستونِ ذخیره‌شده است و نه محاسبه در لحظه؟
-- چون می‌خواهیم رویِ آن ایندکس داشته باشیم («کدام گارانتی‌ها ماهِ دیگر تمام
-- می‌شوند») و چون پایگاه جلویِ ناهماهنگی‌اش را می‌گیرد:
--   CONSTRAINT ... CHECK (ends_at = starts_at + months)
-- یعنی هیچ‌کس نمی‌تواند تاریخِ پایان را دستی عوض کند مگر اینکه مدت را هم
-- عوض کند — و برعکس.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS warranties (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id    uuid NOT NULL REFERENCES product_variants(id),
  user_id       uuid NULL REFERENCES users(id),
  serial_no     text,
  provider      text NOT NULL DEFAULT 'manufacturer'
    CHECK (provider IN ('manufacturer', 'store', 'seller')),
  starts_at     date NOT NULL,
  months        integer NOT NULL CHECK (months > 0 AND months <= 120),
  ends_at       date NOT NULL,
  status        text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'claimed', 'expired', 'void')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT warranties_ends_chk
    CHECK (ends_at = (starts_at + make_interval(months => months))::date)
);

CREATE INDEX IF NOT EXISTS ix_warranties_ends  ON warranties (ends_at);
CREATE INDEX IF NOT EXISTS ix_warranties_user  ON warranties (user_id, ends_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- صورتحسابِ اصلاحی (اعتبارِ مالیاتیِ مرجوعی)
-- ---------------------------------------------------------------------------
-- وقتی فروش برمی‌گردد، ارزش‌افزوده‌ای که پرداخت شده نباید همچنان بدهی بماند؛
-- سازمان باید یک صورتحسابِ «اصلاحی» ببیند که به صورتحسابِ اصلی ارجاع می‌دهد.
-- یکتاییِ پیشین (هر سفارش یک صورتحساب) دیگر کافی نیست: هر سفارش می‌تواند
-- یک صورتحسابِ فروش داشته باشد و به‌ازایِ هر مرجوعی یک اصلاحی. پس یکتایی را
-- به دو یکتاییِ شرطی تبدیل می‌کنیم.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tax_invoices
  ADD COLUMN IF NOT EXISTS customer_return_id    uuid NULL REFERENCES customer_returns(id) ON DELETE CASCADE;
ALTER TABLE tax_invoices
  ADD COLUMN IF NOT EXISTS invoice_kind text NOT NULL DEFAULT 'sale'
    CHECK (invoice_kind IN ('sale', 'credit_note'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'tax_invoices'::regclass AND conname = 'tax_invoices_order_unique'
  ) THEN
    ALTER TABLE tax_invoices DROP CONSTRAINT tax_invoices_order_unique;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_invoices_sale
  ON tax_invoices (order_id) WHERE customer_return_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_invoices_credit
  ON tax_invoices (customer_return_id) WHERE customer_return_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- ۱) تنظیمات: مهلت و رفتارِ مرجوعی
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO store_settings (key, value, description) VALUES
  ('return_window_days', '7',
   'مهلتِ انصراف از خرید (روزِ تقویمی) — پیش‌فرض برابرِ حقِ انصرافِ قانونی است؛ اگر فروشگاه می‌خواهد بخشنده‌تر باشد، بیشتر کنید'),
  ('return_auto_approve_withdrawal', 'false',
   'پذیرشِ خودکارِ درخواستِ انصرافی که در مهلت و بی‌نقص است (بدونِ تأییدِ کارمند)'),
  ('return_restock_fee_bp', '0',
   'کارمزدِ بازگشتِ کالایِ بازشده/آسیب‌دیده در انصراف (ده‌هزارمِ مبلغِ ردیف؛ ۵۰۰ یعنی ۵٪) — برایِ کالایِ معیوب اعمال نمی‌شود'),
  ('warranty_default_months', '12',
   'مدتِ گارانتیِ پیش‌فرض (ماه) برایِ کالایی که مدتِ مشخص ندارد')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- ۲) دسترسی‌ها
-- ---------------------------------------------------------------------------
-- جداییِ «دیدن» از «تغییر دادن» اینجا معنا دارد: پشتیبان باید بتواند وضعیتِ
-- مرجوعی را به مشتری بگوید، اما نباید بتواند وجهی را برگرداند.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO permissions (key, name) VALUES
  ('returns.read',    'مشاهده‌یِ درخواست‌هایِ مرجوعی'),
  ('returns.manage',  'تأیید/رد، دریافت و بازگشتِ وجهِ مرجوعی'),
  ('warranty.read',   'مشاهده‌یِ گارانتیِ کالاها')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager', 'support', 'seller')
   AND p.key = 'returns.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager', 'accountant')
   AND p.key = 'returns.manage'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager', 'support', 'seller')
   AND p.key = 'warranty.read'
ON CONFLICT DO NOTHING;
