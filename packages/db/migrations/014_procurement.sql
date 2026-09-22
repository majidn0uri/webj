-- ---------------------------------------------------------------------------
-- ۰۱۴ — تأمین و خرید: درخواستِ خرید → فاکتورِ خرید (KH) → رسیدِ انبار → برگشت به تأمین‌کننده (BS)
--
-- چرا این زنجیره جدا از «فاکتور خریدِ حسابداری» است؟
--   چون فاکتورِ خرید یک سندِ مالی است (بدهکار/بستانکار)، اما پیش از آن یک
--   جریانِ عملیاتی وجود دارد: کسی در انبار کمبود را می‌بیند و درخواست می‌دهد،
--   مدیر تأیید می‌کند، کالا می‌رسد و «رسید انبار» با مقدارِ واقعی ثبت می‌شود.
--   اگر این مراحل در پایگاه نباشند، مغایرتِ مقداری/قیمتی (BR-18) اصلاً دیده
--   نمی‌شود و موجودی بی‌دلیل بالا می‌رود (BR-19).
--
-- قواعدِ پیاده‌شده:
--   BR-16  هر افزایشِ موجودی باید سند داشته باشد
--   BR-17  میانگینِ موزونِ قیمتِ خرید پس از هر رسید به‌روزرسانی می‌شود
--   BR-18  مغایرتِ مقدار یا قیمت با فاکتور ثبت می‌شود و هشدار می‌رود
--   BR-19  بدون رسیدِ کالا، موجودی افزایش نمی‌یابد
--   BR-24  تأمین‌کننده باید شناسه‌ی ملی/اقتصادی/کد پستی/شبا داشته باشد
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- ۱) تأمین‌کنندگان (BR-24)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text        NOT NULL UNIQUE,           -- T-0001
  name                text        NOT NULL,
  store_name          text,
  kind                text        NOT NULL DEFAULT 'company'
                        CHECK (kind IN ('company','person')),

  -- شناسه‌های رسمی (الزامی برای صدورِ فاکتورِ رسمی)
  national_id         text        CHECK (national_id IS NULL OR national_id ~ '^[0-9]{11}$'),
  economic_code       text        CHECK (economic_code IS NULL OR economic_code ~ '^[0-9]{12}$'),
  registration_no     text,
  tax_file_no         text,

  contact_name        text,
  phone               text,
  mobile              text        CHECK (mobile IS NULL OR mobile ~ '^09[0-9]{9}$'),

  province            text,
  city                text,
  address             text,
  postal_code         text        CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{10}$'),

  -- پرداخت (شبا برای واریزِ وجهِ فاکتور)
  bank_name           text,
  sheba               text        CHECK (sheba IS NULL OR sheba ~ '^IR[0-9]{24}$'),
  account_no          text,

  settlement_terms    text        NOT NULL DEFAULT 'cash'
                        CHECK (settlement_terms IN ('cash','credit_15','credit_30','cheque')),
  credit_limit_rial   bigint      NOT NULL DEFAULT 0 CHECK (credit_limit_rial >= 0),
  lead_time_days      integer     NOT NULL DEFAULT 3 CHECK (lead_time_days >= 0),

  is_active           boolean     NOT NULL DEFAULT true,
  rating              smallint    CHECK (rating BETWEEN 1 AND 5),
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN suppliers.sheba IS
  'شبا با ۲۴ رقم پس از IR؛ برای واریزِ وجهِ فاکتورِ خرید (BR-24).';
COMMENT ON COLUMN suppliers.national_id IS
  'برای شخصِ حقوقی ۱۱ رقم؛ برای شخصِ حقیقی می‌تواند کد ملی باشد.';

CREATE INDEX IF NOT EXISTS idx_suppliers_active  ON suppliers (is_active, name);

-- ===========================================================================
-- ۲) درخواستِ خرید (از انباردار/اپراتور؛ تأیید با مدیر)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS purchase_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_no       text        NOT NULL UNIQUE,              -- PR-1405-0001
  requested_by     uuid        REFERENCES users (id),
  branch_id        uuid        REFERENCES branches (id),
  supplier_id      uuid        REFERENCES suppliers (id),    -- پیشنهاد، قطعی نیست

  status           text        NOT NULL DEFAULT 'pending_approval'
                     CHECK (status IN ('pending_approval','approved','rejected',
                                       'ordered','partially_received','received','cancelled')),
  priority         text        NOT NULL DEFAULT 'normal'
                     CHECK (priority IN ('low','normal','high','urgent')),
  source           text        NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','reorder_alert','customer_order')),
  reorder_alert_id uuid        REFERENCES reorder_alerts (id),

  expected_at      date,
  reason           text,

  decided_by       uuid        REFERENCES users (id),
  decided_at       timestamptz,
  decision_note    text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_status ON purchase_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_request_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid        NOT NULL REFERENCES purchase_requests (id) ON DELETE CASCADE,
  variant_id         uuid        NOT NULL REFERENCES product_variants (id),
  quantity           integer     NOT NULL CHECK (quantity > 0),
  ordered_quantity   integer     NOT NULL DEFAULT 0 CHECK (ordered_quantity >= 0),
  received_quantity  integer     NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  last_cost_rial     bigint,                                -- آخرین قیمتِ خرید برای مقایسه
  note               text,
  UNIQUE (request_id, variant_id)
);

COMMENT ON COLUMN purchase_request_items.received_quantity IS
  'با تأییدِ هر رسیدِ انبار به‌روزرسانی می‌شود تا وضعیتِ درخواست خودکار جلو برود.';

-- ===========================================================================
-- ۳) رسیدِ انبار (BR-16 , BR-18 , BR-19)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS goods_receipts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no          text        NOT NULL UNIQUE,             -- KH-1405-0001
  supplier_id         uuid        REFERENCES suppliers (id),
  purchase_invoice_id uuid        REFERENCES purchase_invoices (id),
  purchase_request_id uuid        REFERENCES purchase_requests (id),
  warehouse_id        uuid        NOT NULL REFERENCES warehouses (id),
  branch_id           uuid        REFERENCES branches (id),

  status              text        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','confirmed','discrepancy','cancelled')),

  supplier_invoice_no text,                                    -- شماره فاکتورِ تأمین‌کننده
  carrier             text,
  tracking_no         text,
  received_at         timestamptz NOT NULL DEFAULT now(),
  received_by         uuid        REFERENCES users (id),

  total_expected_qty  integer     NOT NULL DEFAULT 0,
  total_received_qty  integer     NOT NULL DEFAULT 0,
  total_damaged_qty   integer     NOT NULL DEFAULT 0,
  discrepancy_note    text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_wh ON goods_receipts (warehouse_id, received_at DESC);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id               uuid    NOT NULL REFERENCES goods_receipts (id) ON DELETE CASCADE,
  purchase_invoice_item_id uuid    REFERENCES purchase_invoice_items (id),
  variant_id               uuid    NOT NULL REFERENCES product_variants (id),

  expected_quantity        integer NOT NULL DEFAULT 0 CHECK (expected_quantity >= 0),
  received_quantity        integer NOT NULL CHECK (received_quantity >= 0),
  damaged_quantity         integer NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0),

  -- قیمتِ واقعیِ این رسید؛ مبنایِ میانگینِ موزون (BR-17)
  unit_cost_rial           bigint  NOT NULL DEFAULT 0 CHECK (unit_cost_rial >= 0),
  expiry_date              date,
  note                     text,
  UNIQUE (receipt_id, variant_id)
);

COMMENT ON COLUMN goods_receipt_items.damaged_quantity IS
  'تعدادِ معیوب/خرابِ همان کالا؛ به موجودیِ قابلِ فروش نمی‌آید و ضایعات ثبت می‌شود.';

-- ===========================================================================
-- ۴) برگشت به تأمین‌کننده (BS)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS supplier_returns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no         text        NOT NULL UNIQUE,                -- BS-1405-0001
  supplier_id       uuid        NOT NULL REFERENCES suppliers (id),
  goods_receipt_id  uuid        REFERENCES goods_receipts (id),
  warehouse_id      uuid        REFERENCES warehouses (id),

  status            text        NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested','sent','settled','cancelled')),
  total_rial        bigint      NOT NULL DEFAULT 0,
  reason            text        NOT NULL,
  created_by        uuid        REFERENCES users (id),
  settled_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_return_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id      uuid    NOT NULL REFERENCES supplier_returns (id) ON DELETE CASCADE,
  variant_id     uuid    NOT NULL REFERENCES product_variants (id),
  quantity       integer NOT NULL CHECK (quantity > 0),
  unit_cost_rial bigint  NOT NULL DEFAULT 0,
  reason         text
);

-- ===========================================================================
-- ۵) پیوندِ فاکتورِ خرید به تأمین‌کننده و درخواست
-- ===========================================================================
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS supplier_id          uuid REFERENCES suppliers (id),
  ADD COLUMN IF NOT EXISTS purchase_request_id  uuid REFERENCES purchase_requests (id);

-- ===========================================================================
-- ۶) شماره‌گذاری: PR (درخواست خرید) و T (تأمین‌کننده)
-- ===========================================================================
INSERT INTO document_counters (prefix, year, last_number) VALUES ('PR', 1405, 0)
  ON CONFLICT (prefix, year) DO NOTHING;
INSERT INTO document_counters (prefix, year, last_number) VALUES ('T', 1405, 0)
  ON CONFLICT (prefix, year) DO NOTHING;

-- پیش‌شماره‌ی تأمین‌کننده روی ردیفِ جدا (کد با پیشوندِ T)
INSERT INTO counters (scope, key, value) VALUES ('global', 'supplier', 0)
  ON CONFLICT (scope, key) DO NOTHING;
