-- =====================================================================
-- سفارش و رزرو (فاز ۳-۴)
--
-- اصلِ حیاتی: موجودی «خوانده و سپس نوشته» نمی‌شود. رزرو با یک UPDATEِ شرطیِ اتمیک
-- انجام می‌شود که خودِ پایگاه‌داده آن را انجام می‌دهد؛ اگر موجودی کافی نباشد،
-- هیچ ردیفی تغییر نمی‌کند. این تنها راهِ مطمئن برای این است که
-- «هیچ سفارشِ پرداخت‌شده‌ای به‌دلیل ناموجودی لغو نشود» (هدفِ U6).
-- =====================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key text NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamptz NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason text NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address jsonb NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name text NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_mobile text NULL;

-- یکتاییِ کلیدِ یکتایی (Idempotency): جلوگیری از ثبتِ سفارشِ تکراری
-- هنگامِ دوبار کلیک کردن یا تلاشِ مجددِ شبکه
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_idempotency
  ON orders (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ایندکسِ پاک‌سازیِ رزروهای منقضی‌شده
CREATE INDEX IF NOT EXISTS ix_orders_reservation_expiry
  ON orders (reservation_expires_at) WHERE status = 'pending_payment' AND paid_at IS NULL;

-- ثبتِ وضعیتِ سفارش برای تاریخچه ( append-only )
CREATE TABLE IF NOT EXISTS order_status_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status text NULL,
  to_status   text NOT NULL,
  actor_user_id uuid NULL REFERENCES users(id),
  reason     text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_order_history ON order_status_history (order_id, created_at);

-- پرداخت‌ها (در فاز بعد به درگاهِ ایرانی وصل می‌شود)
CREATE TABLE IF NOT EXISTS payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_rial   bigint NOT NULL,
  method        text NOT NULL DEFAULT 'sandbox',  -- sandbox|zarinpal|idpay|nextpay|behpardakht
  status        text NOT NULL DEFAULT 'pending',  -- pending|success|failed|refunded
  reference_no  text NULL,
  gateway_response jsonb NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_amount_chk CHECK (amount_rial >= 0)
);
CREATE INDEX IF NOT EXISTS ix_payments_order ON payments (order_id);

-- محدودیتِ وضعیتِ سفارش
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_chk;
ALTER TABLE orders ADD CONSTRAINT orders_status_chk
  CHECK (status IN ('pending_payment','paid','processing','shipped','delivered','cancelled','refunded'));
