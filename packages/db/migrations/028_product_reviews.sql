-- ۰۲۸ — نظرات و امتیازِ مشتریان
--
-- جدولِ product_reviews از مهاجرتِ ۰۱۳ بود، اما هیچ کدی آن را به‌کار
-- نمی‌برد. این مهاجرت آن را به چیزی تبدیل می‌کند که یک فروشگاهِ جدی
-- لازم دارد — چهار چیز که جدولِ نخست نداشت:
--
--   ۱. **خریدِ تأیید‌شده**: پیوندِ نظر به سفارش. بی‌این پیوند، نشانِ
--      «خریدارِ واقعی» ادعاست نه واقعیت؛ و در بازاری که رقبا نظرِ ساختگی
--      می‌خرند، همین نشان تفاوتِ اصلی است.
--   ۲. **چرخه‌یِ نظر**: «تأییدشده / در انتظار / ردشده» به‌جایِ یک پرچمِ
--      خاموش-روشن — چون فروشنده باید بتواند نظرِ نامناسب را رد کند، نه
--      فقط پنهان.
--   ۳. **پاسخِ فروشنده**: پاسخ در خودِ نظر می‌نشیند تا زیرِ آن نمایش
--      داده شود.
--   ۴. **رأیِ «مفید بود»**: با مهارِ یکتا که نگذارد یک تن دو بار رأی
--      بدهد (با حساب یا بی‌حساب).
--
-- چرا ستون‌هایِ is_approved و approved_by را برمی‌داریم؟ چون با status
-- دو منبعِ حقیقت می‌ساختیم و هر کدی که یکی را فراموش می‌کرد، نظری را
-- پنهان یا فاش می‌کرد. یک منبعِ حقیقت بهتر از دو تاست — به‌ویژه وقتی
-- قیمتِ اشتباه، اعتمادِ مشتری است.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ۱) ستون‌هایِ تازه ────────────────────────────────────────────────────────────
ALTER TABLE product_reviews
  ADD COLUMN IF NOT EXISTS order_id             uuid NULL REFERENCES orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_verified_purchase boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status               text   NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS moderated_by         uuid   NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moderated_at         timestamptz NULL,
  ADD COLUMN IF NOT EXISTS moderation_note      text   NULL,
  ADD COLUMN IF NOT EXISTS seller_reply         text   NULL,
  ADD COLUMN IF NOT EXISTS replied_by           uuid   NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replied_at           timestamptz NULL,
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz NOT NULL DEFAULT now();

-- ۲) انتقالِ آنچه از پیش بوده باشد (جدول خالی است، اما مهاجرت باید درست باشد
--    روی هر پایگاهی که پیش از این نظری در آن نشسته) ────────────────────────────
UPDATE product_reviews
   SET status       = CASE WHEN is_approved THEN 'approved' ELSE 'pending' END,
       moderated_by = approved_by,
       moderated_at = CASE WHEN is_approved THEN now() ELSE NULL END
 WHERE is_approved AND status = 'pending';

-- ۳) مهارِ وضعیت ──────────────────────────────────────────────────────────────
ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS product_reviews_status_chk;
ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_status_chk
  CHECK (status IN ('pending', 'approved', 'rejected'));

-- پاسخِ فروشنده اگر داده شود، باید نویسنده و زمان هم داشته باشد
ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS product_reviews_reply_chk;
ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_reply_chk
  CHECK (seller_reply IS NULL OR (replied_by IS NOT NULL AND replied_at IS NOT NULL));

-- ۴) یک نظر برایِ هر مشتری برایِ هر کالا ───────────────────────────────────────
-- چرا یکتا؟ چون بدون آن یک تن می‌تواند با ده نظرِ پشتِ‌هم میانگینِ امتیاز را
-- بالا یا پایین بکشد. کسی که دو بار همان کالا را می‌خرد، نظرش را ویرایش
-- می‌کند، نه اینکه نظرِ تازه‌ای بگذارد.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_customer_product
  ON product_reviews (product_id, customer_id)
  WHERE customer_id IS NOT NULL;

-- ۵) ایندکس‌ها: پرکاربردترین خواندن‌ها ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_reviews_product_public
  ON product_reviews (product_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_reviews_status
  ON product_reviews (status, created_at DESC);

-- ۶) رأیِ «مفید بود / نبود» ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_review_votes (
  review_id    uuid        NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
  customer_id  uuid        NULL     REFERENCES customers(id) ON DELETE CASCADE,
  voter_token  text        NULL,     -- برایِ مهمان: نشانه‌یِ ناشناس در کوکی
  is_helpful   boolean     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- رأی یا از یک حساب است یا از یک نشانه؛ رأیِ بی‌هویت بی‌معناست
  CONSTRAINT product_review_votes_voter_chk
    CHECK (customer_id IS NOT NULL OR voter_token IS NOT NULL)
);

-- یک رأی برایِ هر رأی‌دهنده برایِ هر نظر
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_vote
  ON product_review_votes (review_id, COALESCE(customer_id::text, voter_token));
CREATE INDEX IF NOT EXISTS ix_review_votes_review
  ON product_review_votes (review_id);

-- ۷) تنظیم‌ها ─────────────────────────────────────────────────────────────────
INSERT INTO store_settings (key, value, description) VALUES
  ('reviews_require_approval', 'true', 'نظرِ تازه تا تأییدِ پنل روی سایت نیاید؟ (در فشارِ کاری می‌توان false کرد)'),
  ('reviews_only_buyers',      'true', 'فقط خریدارِ واقعیِ کالا بتواند نظر بنویسد؟ نشانِ «خریدِ تأیید‌شده» با این روشن می‌شود'),
  ('reviews_allow_guest_vote', 'true', 'مهمانِ بی‌حساب هم بتواند «مفید بود» بزند؟')
ON CONFLICT (key) DO NOTHING;

-- ۸) دسترسی‌ها ────────────────────────────────────────────────────────────────
-- «دیدنِ نظر» برایِ همه‌یِ نقش‌هایِ پنل است: پشتیبان، انباردار و حسابدار هم
-- باید بدانند مشتری چه می‌گوید. «تأیید و پاسخ» دستِ مدیر، مدیرِ شعبه،
-- فروشنده و پشتیبان است — پاسخ دادن به مشتری، کارِ پشتیبان است.
INSERT INTO permissions (key, name) VALUES
  ('reviews.read',  'مشاهده‌یِ نظرات و امتیازهایِ مشتریان'),
  ('reviews.write', 'تأیید، رد، پاسخ و حذفِ نظراتِ مشتریان')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager', 'seller', 'support', 'warehouse_keeper', 'accountant')
   AND p.key = 'reviews.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager', 'seller', 'support')
   AND p.key = 'reviews.write'
ON CONFLICT DO NOTHING;

COMMIT;
