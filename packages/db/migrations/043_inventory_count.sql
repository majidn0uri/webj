-- =====================================================================
-- شمارشِ فیزیکیِ انبار — ثبتِ مغایرت بین موجودیِ سیستم و شمارشِ واقعی
-- =====================================================================

CREATE TABLE IF NOT EXISTS inventory_counts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  status       text NOT NULL DEFAULT 'open',  -- open → closed
  note         text NULL,
  counted_by   uuid NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz NULL
);

CREATE TABLE IF NOT EXISTS inventory_count_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id       uuid NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  variant_id     uuid NOT NULL REFERENCES product_variants(id),
  system_qty     int NOT NULL,       -- موجودی سیستم در لحظه شروع شمارش
  counted_qty    int NULL,            -- تعداد شمارش‌شده (NULL = هنوز شمارش نشده)
  diff_qty       int GENERATED ALWAYS AS (COALESCE(counted_qty, system_qty) - system_qty) STORED,
  note           text NULL,
  UNIQUE (count_id, variant_id)
);

CREATE INDEX IF NOT EXISTS ix_inventory_count_items_count
  ON inventory_count_items (count_id);