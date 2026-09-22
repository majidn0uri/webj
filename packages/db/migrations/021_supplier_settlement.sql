-- ---------------------------------------------------------------------------
-- ۰۲۱ — تسویه‌یِ فاکتورِ خرید (بستنِ چرخه‌یِ خرید تا پرداخت)
--
-- چرا این مهاجرت؟ چون تا امروز «خرید» در سامانه نیمه تمام بود: فاکتورِ خرید
-- ثبت می‌شد، موجودی می‌آمد، بدهیِ تأمین‌کننده در حسابِ ۲۰۰۰ می‌نشست — و دیگر
-- هیچ. هیچ راهی برای گفتنِ «این فاکتور را پرداخت کردیم» نبود. پیامدش در یک
-- گزارش دیده می‌شد: سنِ بدهیِ تأمین‌کنندگان همیشه کلِ مبلغِ فاکتور را «باز»
-- نشان می‌داد، حتی برای فاکتورهایی که ماه‌ها پیش تسویه شده بودند. مدیری که
-- آن را می‌دید، یا وحشت می‌کرد یا یاد می‌گرفت به گزارش اعتماد نکند.
--
-- این مهاجرت سه چیز می‌آورد:
--   ۱) جدولِ supplier_payments: هر پرداخت با روش، مبلغ، تاریخ و سندِ پیوست.
--   ۲) حسابِ ۲۰۵۰ «اسنادِ پرداختنی»: چکِ پرداختی تا روزِ وصول، بدهیِ قطعیِ
--      شرکت نیست؛ وقتی چک داده می‌شود بدهی از «حساب‌های پرداختنی» به «اسنادِ
--      پرداختنی» منتقل می‌شود و هنگامِ پاس شدن، از حسابِ بانک خارج می‌گردد.
--      (بی‌این تفکیک، همزمان هم بدهکار نشان داده می‌شدیم و هم پول را داده
--      بودیم — یعنی ترازِ بدهی دروغ می‌گفت.)
--   ۳) دسترسیِ جدا برای ثبتِ پرداخت.
-- ---------------------------------------------------------------------------

-- ۱) سرفصلِ تازه: اسنادِ پرداختنی (چک‌هایِ پرداختی)
INSERT INTO accounts (code, name, type)
VALUES ('2050', 'اسنادِ پرداختنی (چک‌هایِ پرداختی)', 'liability')
ON CONFLICT (code) DO NOTHING;

-- ۲) جدولِ پرداخت‌ها
CREATE TABLE IF NOT EXISTS supplier_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    uuid NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  amount_rial   bigint NOT NULL,
  method        text NOT NULL,
  paid_at       timestamptz NOT NULL DEFAULT now(),
  reference_no  text,
  check_id      uuid REFERENCES checks(id),
  note          text,
  journal_entry_id uuid REFERENCES journal_entries(id),
  cleared_at    timestamptz,           -- فقط برای چک: زمانِ پاس شدن
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_payments_amount_check CHECK (amount_rial > 0),
  CONSTRAINT supplier_payments_method_check
    CHECK (method IN ('cash', 'bank', 'card', 'check'))
);

COMMENT ON TABLE supplier_payments IS
  'پرداخت‌هایِ واقعی به تأمین‌کنندگان؛ هر ردیف یک سندِ حسابداری دارد و مانده‌یِ فاکتور را کم می‌کند.';
COMMENT ON COLUMN supplier_payments.cleared_at IS
  'برای پرداختِ چکی: زمانی که چک پاس شد و از حسابِ بانک رفت. تا پیش از آن بدهی در اسنادِ پرداختنی است.';

CREATE INDEX IF NOT EXISTS ix_supplier_payments_invoice ON supplier_payments (invoice_id);
CREATE INDEX IF NOT EXISTS ix_supplier_payments_time ON supplier_payments (paid_at DESC);

-- یک چک را نمی‌توان دوبار خرج کرد (چه به دو فاکتور، چه دوبار به یک فاکتور)
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_payments_check
  ON supplier_payments (check_id) WHERE check_id IS NOT NULL;

-- ۳) دسترسی‌ها
INSERT INTO permissions (key, name) VALUES
  ('procurement.payment.read',  'مشاهده‌یِ پرداخت‌هایِ تأمین‌کنندگان'),
  ('procurement.payment.create', 'ثبتِ پرداخت به تأمین‌کننده')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'accountant', 'branch_manager')
   AND p.key = 'procurement.payment.read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'accountant')
   AND p.key = 'procurement.payment.create'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- یادداشت: تسویه‌شدنِ یک فاکتور از خودِ داده پیداست (payable_rial = ۰).
-- نیازی به ستونِ وضعیتِ تازه نیست؛ دو منبعِ حقیقت یعنی دو جا برای اشتباه.
-- ---------------------------------------------------------------------------
