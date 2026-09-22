-- تاریخچه قیمت تأمین‌کنندگان — مقایسه قیمت خرید
-- 046_supplier_price_history.sql

CREATE TABLE IF NOT EXISTS supplier_price_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id     uuid NOT NULL REFERENCES suppliers(id),
  variant_id      uuid NOT NULL REFERENCES product_variants(id),
  unit_cost_rial  bigint NOT NULL CHECK (unit_cost_rial >= 0),
  source          text NOT NULL CHECK (source IN ('receipt', 'invoice', 'manual')),
  source_id       uuid NULL,                -- شناسه رسید یا فاکتور
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_price_variant ON supplier_price_history(variant_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_price_supplier ON supplier_price_history(supplier_id, variant_id);

COMMENT ON TABLE supplier_price_history IS 'تاریخچه قیمت خرید از تأمین‌کنندگان — برای مقایسه';
COMMENT ON COLUMN supplier_price_history.source IS 'receipt=رسید خرید، invoice=فاکتور خرید، manual=دستی';