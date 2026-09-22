-- ---------------------------------------------------------------------------
-- ۰۱۹ — تنظیماتِ فروشگاه و مرکزِ پیامک
--
-- چرا این مهاجرت؟ چون «تنظیمات» در پایگاه بودند اما هیچ راهی برایِ تغییرشان
-- جز اجرایِ SQL نبود؛ و چون در ایران دو چیز برایِ ارسالِ پیامک و صدورِ
-- صورتحساب اجباری است و مدل نداشت:
--
--   ۱) شناسه‌یِ قالبِ پیامک: ارسال‌کننده‌هایِ ایرانی پیامک را با متنِ آزاد
--      نمی‌پذیرند؛ هر متن باید پیش‌تر تأیید شده باشد و هنگامِ ارسال با
--      «شناسه‌یِ قالبِ تأیید‌شده» فراخوانی شود. بدونِ این ستون، پیامکِ سامانه
--      در تولید عملاً فرستاده نمی‌شود — در حالی که در آزمایش درست به نظر
--      می‌رسید (چون آزمون‌ها فقط متن را می‌سازند).
--
--   ۲) شناسه‌یِ ملی و کدِ اقتصادیِ فروشگاه: صورتحسابِ الکترونیکی (سامانه‌ی
--      مؤدیان) بدونِ این دو پذیرفته نیست؛ و این‌ها را باید مدیرِ فروشگاه
--      وارد کند، نه برنامه‌نویس در متغیرِ محیطی.
-- ---------------------------------------------------------------------------

-- ۱) ستون‌هایِ تازه برایِ قالبِ پیامک
ALTER TABLE sms_templates ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE sms_templates ADD COLUMN IF NOT EXISTS provider_template_id text;
ALTER TABLE sms_templates ADD COLUMN IF NOT EXISTS variables text;

-- ۲) قالب‌هایِ پیش‌فرض — هر کدام با متغیرهایی که باید در متن باشند
--
--    چرا در مهاجرت و نه در کد؟ چون متنِ این پیام‌ها قرار است به‌دستِ مدیر
--    ویرایش شود؛ اگر در کد بود، هر ویرایش یعنی انتشارِ نسخه‌ی تازه.
INSERT INTO sms_templates (key, title, body, variables, is_active) VALUES
  ('welcome', 'خوش‌آمدگویی',
   '{store}؛ به خانواده‌ی ما خوش آمدید.',
   'store', true),
  ('otp_login', 'کدِ ورود',
   '{store}؛ کدِ ورود شما: {code}',
   'store, code', true),
  ('order_confirmed', 'تأییدِ سفارش',
   '{store}؛ سفارشِ {order} تأیید شد و در صفِ آماده‌سازی است.',
   'store, order', true),
  ('order_paid', 'پرداخت موفق',
   '{store}؛ پرداختِ سفارشِ {order} به مبلغ {amount} دریافت شد.',
   'store, order, amount', true),
  ('order_shipped', 'ارسالِ سفارش',
   '{store}؛ سفارشِ {order} ارسال شد. کدِ مرسوله: {tracking}',
   'store, order, tracking', true),
  ('order_delivered', 'تحویلِ سفارش',
   '{store}؛ سفارشِ {order} تحویل داده شد. از خریدِ شما سپاس‌گزاریم.',
   'store, order', true),
  ('order_cancelled', 'لغوِ سفارش',
   '{store}؛ سفارشِ {order} لغو شد و مبلغ {amount} بازگردانده می‌شود.',
   'store, order, amount', true),
  ('invoice_issued', 'صدورِ فاکتور',
   '{store}؛ فاکتورِ {invoice} به مبلغ {amount} صادر شد. مشاهده: {link}',
   'store, invoice, amount, link', true),
  ('check_due', 'سررسیدِ چک',
   '{store}؛ چکِ شماره {check} به مبلغ {amount} در تاریخ {date} سررسید دارد.',
   'store, check, amount, date', true),
  ('check_bounced', 'برگشتِ چک',
   '{store}؛ چکِ {check} برگشت خورد. پیگیری با: {phone}',
   'store, check, phone', true),
  ('product_back', 'موجود شدنِ کالا',
   '{store}؛ «{product}» دوباره موجود شد: {link}',
   'store, product, link', true)
ON CONFLICT (key) DO NOTHING;

-- ۳) کلیدهایِ تنظیماتِ تازه
--
--    نکته‌یِ مالیاتی: نرخِ ارزش‌افزوده هر سال در قانونِ بودجه تعیین می‌شود؛
--    پس مقدارِ پیش‌فرض «آخرین مقداری است که هنگامِ نگارش درست بوده» و باید
--    پیش از بهره‌برداری با بخشنامه‌یِ روز سنجیده شود. سامانه آن را از
--    تنظیمات می‌خواند، نه از کد.
INSERT INTO store_settings (key, value, description) VALUES
  ('store_address',        '',     'نشانیِ فروشگاه (روی فاکتور می‌آید)'),
  ('store_email',          '',     'رایانامه‌یِ فروشگاه'),
  ('store_national_id',    '',     'شناسه‌یِ ملیِ فروشگاه (برایِ صورتحسابِ الکترونیکی)'),
  ('store_economic_code',  '',     'کدِ اقتصادیِ فروشگاه (برایِ صورتحسابِ الکترونیکی)'),
  ('store_postal_code',    '',     'کدِ پستیِ فروشگاه'),
  ('vat_rate_percent',     '9',    'نرخِ ارزش‌افزوده به درصد (هر سال در قانونِ بودجه)'),
  ('payment_gateway',      'sandbox', 'درگاهِ پیش‌فرض: sandbox یا zarinpal یا idpay'),
  ('payment_sandbox_mode', 'true','درگاهِ آزمایشی؟ (در تولید باید false شود)'),
  ('zarinpal_merchant_id', '',     'کلیدِ درگاهِ زرین‌پال (محرمانه)'),
  ('idpay_api_key',        '',     'کلیدِ درگاهِ آی‌دی‌پی (محرمانه)'),
  ('sms_provider',         'none', 'ارسال‌کننده: none یا melipayamak یا kavenegar یا farazsms'),
  ('sms_api_key',          '',     'کلیدِ ارسال‌کننده‌ی پیامک (محرمانه)')
ON CONFLICT (key) DO NOTHING;

-- ۴) دسترسی‌ها
--
--    چرا «تنظیمات» از «پیامک» جداست؟ چون می‌توان به یک پشتیبان اجازه داد
--    متنِ پیامک‌ها را ویرایش کند بی‌آنکه بتواند کلیدِ درگاهِ پرداخت را عوض
--    کند. این تفکیک، کم‌ترین کاری است که در برابرِ «تغییرِ پنهانِ مقصدِ
--    پول» محافظت می‌کند.
INSERT INTO permissions (key, name) VALUES
  ('settings.read',       'مشاهده‌ی تنظیماتِ فروشگاه'),
  ('settings.write',      'تغییرِ تنظیماتِ فروشگاه'),
  ('sms.template.read',   'مشاهده‌ی قالب‌های پیامک'),
  ('sms.template.write',  'ویرایشِ قالب‌های پیامک'),
  ('sms.outbox.read',     'مشاهده‌ی وضعیتِ پیامک‌های ارسالی')
ON CONFLICT (key) DO NOTHING;

--    مدیر کل و مدیر شعبه: همه
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key IN ('super_admin', 'branch_manager')
   AND (p.key LIKE 'settings.%' OR p.key LIKE 'sms.%')
ON CONFLICT DO NOTHING;

--    فروشنده: دیدنِ تنظیمات و قالب‌ها، بی‌هیچ تغییری
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key = 'seller'
   AND p.key IN ('settings.read', 'sms.template.read', 'sms.outbox.read')
ON CONFLICT DO NOTHING;

--    حسابدار: دیدنِ تنظیمات (برایِ نرخِ مالیات و سقفِ چک) و پیامک‌ها
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.key = 'accountant'
   AND p.key IN ('settings.read', 'sms.template.read', 'sms.outbox.read')
ON CONFLICT DO NOTHING;
