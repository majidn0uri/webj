-- تخفیف حجمی — خرید بیشتر = تخفیف بیشتر
-- 045_volume_discount.sql

CREATE TABLE IF NOT EXISTS volume_discounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  min_quantity  integer NOT NULL CHECK (min_quantity >= 2),
  discount_type text NOT NULL CHECK (discount_type IN ('percent', 'amount')),
  discount_value bigint NOT NULL CHECK (discount_value > 0),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, min_quantity)
);

CREATE INDEX IF NOT EXISTS idx_volume_discounts_product ON volume_discounts(product_id) WHERE is_active;

COMMENT ON TABLE volume_discounts IS 'تخفیف حجمی — مثال: خرید ۳+ عدد = ۱۰٪ تخفیف';
COMMENT ON COLUMN volume_discounts.min_quantity IS 'حداقل تعداد برای اعمال تخفیف';
COMMENT ON COLUMN volume_discounts.discount_type IS 'percent = درصدی، amount = مبلغ ثابت به ریال';