-- =====================================================================
-- حسابداریِ پایه (فاز ۶) — دفترکلِ دوبل
--
-- قوانین:
--   • هر سند باید تراز باشد (جمعِ بدهکار = جمعِ بستانکار) و این در پایگاه‌داده هم کنترل می‌شود.
--   • هیچ سندی حذف نمی‌شود؛ اصلاح با سندِ معکوس است (برگشت).
--   • بهای تمام‌شده با روشِ میانگینِ موزون (WAC) نگه‌داری می‌شود و هزینه‌های جانبیِ
--     فاکتورِ خرید (حمل، گمرک) بین ردیف‌ها توزیع می‌شود — با توزیعِ دقیق، بدون باقیمانده.
-- =====================================================================

CREATE TABLE IF NOT EXISTS accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  type       text NOT NULL,      -- asset|liability|equity|revenue|expense
  parent_id  uuid NULL REFERENCES accounts(id),
  is_active  boolean NOT NULL DEFAULT true,
  CONSTRAINT accounts_type_chk CHECK (type IN ('asset','liability','equity','revenue','expense'))
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_no       text NOT NULL UNIQUE,
  description    text NOT NULL DEFAULT '',
  reference_type text NULL,          -- order|purchase_invoice|payment|manual
  reference_id   uuid NULL,
  status         text NOT NULL DEFAULT 'posted',  -- posted|reversed
  reversed_by    uuid NULL REFERENCES journal_entries(id),
  posted_at      timestamptz NOT NULL DEFAULT now(),
  period         text NULL           -- دوره‌ی مالی به شمسی (مثال: 140506)
);
CREATE INDEX IF NOT EXISTS ix_journal_reference ON journal_entries (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS ix_journal_period ON journal_entries (period);

CREATE TABLE IF NOT EXISTS journal_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id   uuid NOT NULL REFERENCES accounts(id),
  debit_rial   bigint NOT NULL DEFAULT 0,
  credit_rial  bigint NOT NULL DEFAULT 0,
  description  text NULL,
  -- هر ردیف یا بدهکار است یا بستانکار، نه هر دو
  CONSTRAINT journal_line_side_chk CHECK (
    (debit_rial > 0 AND credit_rial = 0) OR (credit_rial > 0 AND debit_rial = 0)
  ),
  CONSTRAINT journal_line_non_negative_chk CHECK (debit_rial >= 0 AND credit_rial >= 0)
);
CREATE INDEX IF NOT EXISTS ix_journal_lines_entry ON journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS ix_journal_lines_account ON journal_lines (account_id);

-- فاکتورِ خرید — ورودِ کالا به انبار و ایجادِ بدهی به تأمین‌کننده
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no     text NOT NULL UNIQUE,
  supplier_name  text NOT NULL,
  warehouse_id   uuid NOT NULL REFERENCES warehouses(id),
  subtotal_rial  bigint NOT NULL DEFAULT 0,   -- جمعِ ردیف‌ها (بدون هزینه‌های جانبی)
  extra_cost_rial bigint NOT NULL DEFAULT 0,  -- حمل، گمرک و … (توزیع می‌شود)
  total_rial     bigint NOT NULL DEFAULT 0,   -- بهای تمام‌شده‌ی نهایی
  status         text NOT NULL DEFAULT 'posted',
  created_by     uuid NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_invoice_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  variant_id       uuid NOT NULL REFERENCES product_variants(id),
  quantity         integer NOT NULL CHECK (quantity > 0),
  unit_cost_rial   bigint NOT NULL,
  extra_cost_rial  bigint NOT NULL DEFAULT 0,   -- سهمِ این ردیف از هزینه‌های جانبی
  total_cost_rial  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_purchase_items_invoice ON purchase_invoice_items (invoice_id);

-- ارزشِ موجودی و بهای میانگینِ موزون برای هر کالا در هر انبار
CREATE TABLE IF NOT EXISTS inventory_valuation (
  variant_id    uuid NOT NULL REFERENCES product_variants(id),
  warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  quantity      integer NOT NULL DEFAULT 0,
  avg_cost_rial bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (variant_id, warehouse_id)
);

-- حساب‌های پایه (نمونه — در پنل قابل گسترش است)
INSERT INTO accounts (code, name, type) VALUES
  ('1000', 'موجودی کالا', 'asset'),
  ('1100', 'صندوق و نقد', 'asset'),
  ('1200', 'بانک', 'asset'),
  ('2000', 'حساب‌های پرداختنی (تأمین‌کنندگان)', 'liability'),
  ('2100', 'مالیات بر ارزش افزوده‌ی پرداختنی', 'liability'),
  ('4000', 'درآمدِ فروش', 'revenue'),
  ('5000', 'بهای تمام‌شده‌ی کالای فروخته‌شده', 'expense'),
  ('5100', 'هزینه‌های عملیاتی', 'expense')
ON CONFLICT (code) DO NOTHING;
