-- 040 — ثبتِ تاریخچهٔ قیمت
-- «آیا فروشنده قیمت را بالا برد و بعد تخفیف زد؟» — این شک بزرگ‌ترین دشمنِ
-- اعتماد در فروشگاه‌های آنلاین است. با ثبتِ هر تغییرِ قیمت، خریدار می‌تواند
-- ببیند که قیمتِ فعلی واقعی است یا نه.

CREATE TABLE IF NOT EXISTS product_price_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id   uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  price_rial   bigint NOT NULL CHECK (price_rial >= 0),
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_log_variant
  ON product_price_log(variant_id, recorded_at DESC);

COMMENT ON TABLE product_price_log IS 'تاریخچهٔ قیمتِ تنوع‌ها — هر تغییر ثبت می‌شود';
COMMENT ON COLUMN product_price_log.price_rial IS 'قیمتِ ثبت‌شده (ریال) در لحظهٔ تغییر';