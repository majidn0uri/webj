-- ═══════════════════════════════════════════════════════════════════════════
-- ۰۲۵ — پیوندِ مرجوعی و گارانتی به «مشتری»
-- ---------------------------------------------------------------------------
-- `users` کارمندان‌اند و `customers` خریداران. مرجوعیِ ثبت‌شده از سویِ مشتری
-- باید به مشتری وصل باشد نه به کارمند — وگرنه نمی‌توان فهرستِ «مرجوعی‌هایِ
-- من» را درست و امن نشان داد (مشتری نباید مرجوعیِ دیگری را ببیند).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE customer_returns
  ADD COLUMN IF NOT EXISTS customer_id uuid NULL REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS ix_customer_returns_customer
  ON customer_returns (customer_id, requested_at DESC);

ALTER TABLE warranties
  ADD COLUMN IF NOT EXISTS customer_id uuid NULL REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS ix_warranties_customer ON warranties (customer_id, ends_at);
