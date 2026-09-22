-- =====================================================================
-- صندوقِ حضوری (POS) — همان موتور، کانالِ متفاوت (بخش J-10)
--
-- سه ویژگیِ تعیین‌کننده:
--   ۱) فروشِ حضوری از همان مسیرِ سفارش می‌رود: همان رزروِ اتمیک، همان مالیات، همان سند.
--   ۲) کارکردِ آفلاین: دستگاهِ صندوق می‌تواند بدون اینترنت بفروشد و بعداً همگام کند؛
--      هر فروش یک شناسه‌ی آفلاین دارد و تکراری پذیرفته نمی‌شود.
--   ۳) شیفت: بازگشایی با موجودیِ نقد، بستن با شمارشِ واقعی و اعلامِ مغایرت.
-- =====================================================================

CREATE TABLE IF NOT EXISTS pos_shifts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id          uuid NULL REFERENCES branches(id),
  warehouse_id       uuid NOT NULL REFERENCES warehouses(id),
  opened_by          uuid NOT NULL REFERENCES users(id),
  closed_by          uuid NULL REFERENCES users(id),
  opening_cash_rial  bigint NOT NULL DEFAULT 0,
  closing_cash_rial  bigint NULL,
  expected_cash_rial bigint NULL,
  difference_rial    bigint NULL,
  note               text NULL,
  status             text NOT NULL DEFAULT 'open',
  opened_at          timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz NULL,
  CONSTRAINT pos_shift_status_chk CHECK (status IN ('open','closed')),
  CONSTRAINT pos_shift_cash_chk CHECK (opening_cash_rial >= 0)
);
-- هر انبار فقط یک شیفتِ باز داشته باشد (ایندکسِ یکتای جزئی)
CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_shift_open
  ON pos_shifts (warehouse_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS pos_shift_movements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id    uuid NOT NULL REFERENCES pos_shifts(id) ON DELETE CASCADE,
  type        text NOT NULL,             -- payout|pickup|expense|float_in
  amount_rial bigint NOT NULL,
  reason      text NULL,
  actor_id    uuid NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_movement_amount_chk CHECK (amount_rial > 0)
);

-- اتصالِ سفارش به شیفت + شناسه‌ی آفلاین + روشِ پرداختِ حضوری
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shift_id uuid NULL REFERENCES pos_shifts(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS offline_id text NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method text NULL;

-- همگام‌سازیِ آفلاین: هر فروشِ آفلاین فقط یک بار ثبت می‌شود
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_offline
  ON orders (shift_id, offline_id) WHERE offline_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_orders_shift ON orders (shift_id);
