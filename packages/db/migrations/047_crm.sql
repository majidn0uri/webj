-- CRM — مدیریت ارتباط با مشتری
-- 047_crm.sql

-- ============================================================
-- ۱) تعاملات مشتری (تماس، جلسه، ایمیل، یادداشت داخلی)
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_interactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN (
    'call_incoming',    -- تماس ورودی
    'call_outgoing',    -- تماس خروجی
    'meeting',          -- جلسه حضوری
    'email',            -- ایمیل
    'whatsapp',         -- واتساپ
    'sms',              -- پیامک
    'note',             -- یادداشت داخلی
    'complaint',        -- شکایت
    'feedback',         -- بازخورد / پیشنهاد
    'follow_up'         -- پیگیری
  )),
  subject       text NOT NULL,
  body          text NULL,
  outcome       text NULL,           -- نتیجه: تماس گرفته شد، پیامک داده شد، منتظر پاسخ، حل شد
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  next_action   text NULL,           -- اقدام بعدی پیشنهادی
  next_action_at timestamptz NULL,   -- زمان اقدام بعدی
  order_id      uuid NULL REFERENCES orders(id),    -- ارتباط با سفارش
  return_id     uuid NULL REFERENCES returns(id),    -- ارتباط با مرجوعی
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_interactions_customer ON customer_interactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_type ON customer_interactions(type);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_next ON customer_interactions(next_action_at) WHERE next_action_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_interactions_priority ON customer_interactions(priority) WHERE priority IN ('high','urgent');

-- ============================================================
-- ۲) برچسب‌های مشتری (VIP, دائم‌الشکایت, همکار فعال، ...)
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_tags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,        -- مثال: VIP
  color         text NOT NULL DEFAULT '#6b7280', -- رنگ hex برای نمایش
  description   text NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_tag_assignments (
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tag_id        uuid NOT NULL REFERENCES customer_tags(id) ON DELETE CASCADE,
  assigned_by   uuid NULL REFERENCES users(id),
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_tag_assign_customer ON customer_tag_assignments(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_tag_assign_tag ON customer_tag_assignments(tag_id);

-- ============================================================
-- ۳) بخش‌بندی مشتریان (Segments — خودکار بر اساس قوانین)
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_segments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,               -- مثال: مشتریان VIP
  description   text NULL,
  rules         jsonb NOT NULL DEFAULT '{}',  -- قوانین بخش‌بندی
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN customer_segments.rules IS 'قوانین JSON: {"minOrders":5,"minSpentRial":"10000000","isPartner":true}';

-- ============================================================
-- ۴) یادآوری پیگیری
-- ============================================================
CREATE TABLE IF NOT EXISTS follow_ups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  interaction_id uuid NULL REFERENCES customer_interactions(id),
  title         text NOT NULL,
  description   text NULL,
  due_at        timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled','overdue')),
  assigned_to   uuid NULL REFERENCES users(id),
  completed_at  timestamptz NULL,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_followups_due ON follow_ups(due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_crm_followups_assigned ON follow_ups(assigned_to) WHERE status = 'pending';

-- ============================================================
-- ۵) لاگ فعالیت مشتری (خودکار — مشاهده محصول، خرید، ...)
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  activity_type text NOT NULL,               -- view_product, add_to_cart, checkout, purchase, return_request, login
  metadata      jsonb NOT NULL DEFAULT '{}', -- {product_id, order_id, variant_id, ...}
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_activities_customer ON customer_activities(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_type ON customer_activities(activity_type, created_at DESC);

-- ============================================================
-- ۶) تگ‌های پیش‌فرض
-- ============================================================
INSERT INTO customer_tags (name, color, description) VALUES
  ('VIP', '#f59e0b', 'مشتری ویژه — خرید بالا'),
  ('همکار فعال', '#10b981', 'همکار با خرید منظم'),
  ('شکایت‌دار', '#ef4444', 'سابقه شکایت — نیاز به پیگیری ویژه'),
  ('بازگشتی', '#8b5cf6', 'مشتری که پس از غیبت بازگشته'),
  ('پرخطر', '#f97316', 'سابقه چک برگشتی یا بدهی معوق')
ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE customer_interactions IS 'تعاملات CRM — تماس، جلسه، یادداشت، شکایت';
COMMENT ON TABLE customer_tags IS 'برچسب‌های مشتری';
COMMENT ON TABLE customer_segments IS 'بخش‌بندی خودکار مشتریان';
COMMENT ON TABLE follow_ups IS 'یادآوری پیگیری CRM';
COMMENT ON TABLE customer_activities IS 'لاگ فعالیت مشتری — خودکار';