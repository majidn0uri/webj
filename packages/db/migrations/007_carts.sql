-- =====================================================================
-- سبدِ خرید (فاز ۷)
--
-- تصمیمِ کلیدی: سبد موجودی را قفل نمی‌کند.
--   • سبد فقط یک «فهرستِ آرزوهایِ قطعی‌شده» است؛ قفل کردنِ موجودی در سبد،
--     کالا را از دسترسِ بقیه خارج می‌کند بدون این‌که فروشی رخ داده باشد.
--   • تضمینِ «موجودی هست» در لحظه‌ی پرداخت و به‌صورتِ اتمیک انجام می‌شود
--     (همان موتورِ orders) — این همان چیزی است که فروشگاه‌هایِ قالبی ندارند.
--   • بنابراین سبد باید تغییرِ قیمت را هم صادقانه نشان دهد: قیمت در زمانِ
--     افزودن ذخیره می‌شود و در نمایش با قیمتِ فعلی مقایسه می‌گردد.
-- =====================================================================

CREATE TABLE IF NOT EXISTS carts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel      text NOT NULL DEFAULT 'web',
  user_id      uuid NULL REFERENCES users(id),
  branch_id    uuid NULL REFERENCES branches(id),
  status       text NOT NULL DEFAULT 'active',
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carts_status_chk CHECK (status IN ('active', 'checked_out', 'abandoned'))
);
CREATE INDEX IF NOT EXISTS ix_carts_user ON carts (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_carts_expires ON carts (expires_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS cart_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id        uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id     uuid NOT NULL REFERENCES product_variants(id),
  quantity       integer NOT NULL CHECK (quantity > 0 AND quantity <= 99),
  -- قیمت در لحظه‌ی افزودن؛ برای این‌که بتوانیم تغییرِ قیمت را به مشتری نشان دهیم
  price_at_add_rial  bigint NOT NULL,
  added_at       timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, variant_id)
);
CREATE INDEX IF NOT EXISTS ix_cart_items_cart ON cart_items (cart_id);
