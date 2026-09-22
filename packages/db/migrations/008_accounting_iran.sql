-- =====================================================================
-- حسابداریِ ایرانی (فاز ۸) — ارزش افزوده، هویتِ تأمین‌کننده، جلوگیری از ثبتِ تکراری
-- ---------------------------------------------------------------------
-- چرا این مهاجرت لازم است؟ چون فاکتورِ خرید در ایران سه چیز دارد که
-- مدلِ عمومیِ حسابداری ندارد:
--
--  ۱) «مالیات بر ارزش افزوده» (VAT) مبلغی جدا از بهای کالاست که
--     • جزوِ بهای تمام‌شده‌ی کالا نیست (نباید قیمتِ میانگین را خراب کند)،
--     • برایِ مؤدی یک «اعتبار» است که بعداً از مالیاتِ فروش کم می‌شود.
--     بنابراین در حسابی جدا (۱۳۰۰) بدهکار می‌شود، نه در حسابِ موجودی.
--
--  ۲) فاکتورِ رسمی باید «شناسه‌ی ملی» و «کدِ اقتصادیِ» فروشنده را داشته باشد
--     تا در سامانه‌ی مؤدیان قابلِ ارسال و استناد باشد. بدونِ آن، اعتبارِ
--     مالیاتی از سویِ سازمان رد می‌شود.
--
--  ۳) ثبتِ دوباره‌ی یک فاکتورِ تأمین‌کننده (تکرارِ سهوی یا عمدی) یکی از
--     رایج‌ترین راه‌هایِ بزرگ‌نماییِ هزینه و خروجِ پول است؛ این با یک
--     قیدِ یکتا در خودِ پایگاه‌داده بسته می‌شود، نه با یک شرط در کد.
-- =====================================================================

-- --- ارزش افزوده و هویتِ تأمین‌کننده روی فاکتورِ خرید
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS vat_rial             bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payable_rial         bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_national_id text   NULL,
  ADD COLUMN IF NOT EXISTS supplier_economic_code text NULL,
  ADD COLUMN IF NOT EXISTS supplier_postal_code text   NULL,
  ADD COLUMN IF NOT EXISTS supplier_invoice_no  text   NULL,
  ADD COLUMN IF NOT EXISTS issued_at            date   NULL,
  ADD COLUMN IF NOT EXISTS due_at               date   NULL;

-- --- سهمِ ارزش افزوده‌ی هر ردیف (برای گزارش‌گیری؛ در بهای کالا نمی‌نشیند)
ALTER TABLE purchase_invoice_items
  ADD COLUMN IF NOT EXISTS vat_rial bigint NOT NULL DEFAULT 0;

-- --- قیدِ یکتا: یک فاکتور از یک تأمین‌کننده فقط یک‌بار
-- چرا partial؟ چون فاکتورهایِ قدیمی یا فاقدِ شماره نباید جلویِ ثبت را بگیرند؛
-- قید فقط جایی اعمال می‌شود که هر دو شناسه موجود است و می‌توان قضاوت کرد.
CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_invoice_supplier_doc
  ON purchase_invoices (supplier_national_id, supplier_invoice_no)
  WHERE supplier_national_id IS NOT NULL AND supplier_invoice_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_purchase_invoices_issued
  ON purchase_invoices (issued_at DESC);

-- --- حسابِ «اعتبارِ مالیاتی»: ارزش افزوده‌ای که روی خرید پرداخت کرده‌ایم
-- و بعداً از مالیاتِ فروش کم می‌شود. نوعش «دارایی» است، چون طلب از دولت است.
INSERT INTO accounts (code, name, type) VALUES
  ('1300', 'اعتبار مالیاتیِ ارزش افزوده', 'asset'),
  ('4100', 'تخفیفاتِ فروش', 'revenue'),
  ('5200', 'هزینه‌ی مالی و کارمزدِ درگاه', 'expense')
ON CONFLICT (code) DO NOTHING;
