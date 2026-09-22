-- =====================================================================
-- ۰۴۱ — صف ایمیل (email_queue)
-- =====================================================================
-- ایمیل‌های ارسال‌نشده وقتی SMTP تنظیم نیست یا ارسال ناموفق بوده.
-- با flush_queue پردازش می‌شوند.

BEGIN;

CREATE TABLE IF NOT EXISTS email_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_address      text NOT NULL,
  subject         text NOT NULL,
  html            text NOT NULL,
  text_body       text NOT NULL,
  event_type      text NOT NULL,
  attempts        integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz NULL,
  sent_at         timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_email_queue_pending
  ON email_queue (created_at)
  WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS product_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id uuid NULL REFERENCES customers(id) ON DELETE SET NULL,
  question    text NOT NULL,
  answer      text NULL,
  answered_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  answered_at timestamptz NULL,
  is_public   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_pq_product ON product_questions (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_pq_unanswered ON product_questions (created_at) WHERE answer IS NULL AND is_public = true;

COMMIT;