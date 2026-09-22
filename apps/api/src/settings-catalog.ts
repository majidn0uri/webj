/**
 * کارنامه‌ی تنظیمات — جایی که هر تنظیم «خودش را توصیف می‌کند».
 *
 * چرا این جدول لازم است؟ چون اگر تنظیمات فقط رشته‌هایی در `store_settings`
 * باشند، رابطِ کاربری نمی‌فهمد هر کدام چه نوعی دارد (عدد؟ بله/خیر؟ یکی از
 * چند گزینه؟)، چه مقداری معتبر است، و کدام‌ها محرمانه‌اند و نباید در خروجیِ
 * شبکه دیده شوند. نتیجه‌اش می‌شد یک فرمِ متنی که «۹» و «بله» و «هرچه خواستی»
 * را یکی می‌بیند و خطا را در بدترین لحظه (هنگامِ پرداخت) نشان می‌دهد.
 *
 * پس اینجا برایِ هر کلید تعریف می‌کنیم: برچسب، نوع، گزینه‌ها، راهنما، و
 * این‌که محرمانه هست یا نه. رابطِ کاربری فقط این کارنامه را می‌خواند.
 */

export type SettingType = 'text' | 'number' | 'boolean' | 'select' | 'secret';

export interface SettingDef {
  key: string;
  label: string;
  type: SettingType;
  group: SettingGroupKey;
  /** راهنمایی که زیرِ فیلد می‌آید — چرا این تنظیم وجود دارد */
  hint?: string;
  /** برایِ select: گزینه‌هایِ مجاز */
  options?: Array<{ value: string; label: string }>;
  /** مقدارِ پیش‌فرض اگر ردیفی در پایگاه نباشد */
  fallback: string;
  min?: number;
  max?: number;
  /** فقط رقم (مثلِ کدِ پستی و شناسه‌ی ملی) */
  digitsOnly?: boolean;
  /** شمارِ نویسه‌هایی که از کلیدِ محرمانه در پایان نمایش داده می‌شود */
  secretTail?: number;
}

export type SettingGroupKey = 'store' | 'orders' | 'tax' | 'gateway' | 'sms' | 'advanced';

export const GROUPS: Array<{ key: SettingGroupKey; title: string; hint: string }> = [
  { key: 'store', title: 'فروشگاه', hint: 'نام و نشانی‌ای که رویِ فاکتور و پیامک می‌رود' },
  { key: 'orders', title: 'سفارش و مشتری', hint: 'مهلت‌ها و رفتارِ خرید' },
  { key: 'tax', title: 'مالیات و مالی', hint: 'نرخِ ارزش‌افزوده، سقفِ چک، نقطه‌ی سفارش' },
  { key: 'gateway', title: 'درگاهِ پرداخت', hint: 'مقصدِ پول — با احتیاط تغییر کنید' },
  { key: 'sms', title: 'پیامک', hint: 'ارسال‌کننده و وضعیتِ پیام‌ها' },
  { key: 'advanced', title: 'پیشرفته', hint: 'کمتر استفاده می‌شود' },
];

const BOOL = [
  { value: 'true', label: 'بله' },
  { value: 'false', label: 'خیر' },
];

export const SETTINGS: SettingDef[] = [
  // ── فروشگاه ────────────────────────────────────────────────────────────
  { key: 'store_name', label: 'نامِ فروشگاه', type: 'text', group: 'store', fallback: 'ست‌شاپ',
    hint: 'در پیامک‌ها و فاکتور به‌جایِ {store} می‌نشیند.' },
  { key: 'store_phone', label: 'تلفنِ فروشگاه', type: 'text', group: 'store', fallback: '۰۲۱-۰۰۰۰۰۰۰۰' },
  { key: 'store_email', label: 'رایانامه', type: 'text', group: 'store', fallback: '' },
  { key: 'store_address', label: 'نشانی', type: 'text', group: 'store', fallback: '',
    hint: 'رویِ فاکتورِ رسمی چاپ می‌شود.' },
  { key: 'store_national_id', label: 'شناسه‌یِ ملی', type: 'text', group: 'store', fallback: '',
    digitsOnly: true, hint: 'برایِ صورتحسابِ الکترونیکیِ سامانه‌ی مؤدیان لازم است.' },
  { key: 'store_economic_code', label: 'کدِ اقتصادی', type: 'text', group: 'store', fallback: '',
    digitsOnly: true, hint: 'برایِ صورتحسابِ الکترونیکی لازم است.' },
  { key: 'store_postal_code', label: 'کدِ پستی', type: 'text', group: 'store', fallback: '',
    digitsOnly: true },

  // ── سفارش و مشتری ──────────────────────────────────────────────────────
  { key: 'return_window_days', label: 'مهلتِ مرجوعی (روز)', type: 'number', group: 'orders',
    fallback: '7', min: 0, max: 365, hint: '۷ روز مطابقِ قانونِ تجارتِ الکترونیکی است.' },
  { key: 'reserve_minutes', label: 'زمانِ رزروِ موجودی (دقیقه)', type: 'number', group: 'orders',
    fallback: '15', min: 0, max: 240,
    hint: 'موجودی هنگامِ ثبتِ سفارش رزرو می‌شود، نه هنگامِ افزودن به سبد.' },
  { key: 'payment_expiry_hours', label: 'مهلتِ پرداخت (ساعت)', type: 'number', group: 'orders',
    fallback: '24', min: 1, max: 720 },
  { key: 'sell_without_account', label: 'فروش بدونِ حسابِ کاربری', type: 'boolean', group: 'orders',
    fallback: 'false', options: BOOL },
  { key: 'show_price_to_guest', label: 'نمایشِ قیمت به بازدیدکننده', type: 'boolean', group: 'orders',
    fallback: 'true', options: BOOL },
  { key: 'coupon_enabled', label: 'کدِ تخفیف', type: 'boolean', group: 'orders',
    fallback: 'false', options: BOOL },
  { key: 'reviews_enabled', label: 'دیدگاه و امتیاز', type: 'boolean', group: 'orders',
    fallback: 'true', options: BOOL },

  // ── مالیات و مالی ──────────────────────────────────────────────────────
  { key: 'vat_rate_percent', label: 'نرخِ ارزش‌افزوده (درصد)', type: 'number', group: 'tax',
    fallback: '9', min: 0, max: 100,
    hint: 'هر سال در قانونِ بودجه تعیین می‌شود؛ پیش از بهره‌برداری با بخشنامه‌ی روز بسنجید.' },
  { key: 'default_check_ceiling', label: 'سقفِ چکِ پیش‌فرض (تومان)', type: 'number', group: 'tax',
    fallback: '0', min: 0 },
  { key: 'cash_diff_alert_rial', label: 'آستانه‌یِ هشدارِ اختلافِ صندوق (ریال)', type: 'number',
    group: 'tax', fallback: '500000000', min: 0 },
  { key: 'reorder_point_default', label: 'نقطه‌یِ سفارشِ پیش‌فرض', type: 'number', group: 'tax',
    fallback: '10', min: 0 },

  // ── سامانه‌یِ مؤدیان (صورتحسابِ الکترونیکی) ─────────────────────────────
  // این کلیدها «غیرمحرمانه»اند و در پایگاه می‌مانند تا مدیر بتواند از پنل
  // تغییرشان دهد. کلیدِ خصوصیِ امضاء و گواهی هرگز در پایگاه نیست (متغیرِ محیطی).
  { key: 'moadian_enabled', label: 'ارسالِ صورتحسابِ الکترونیکی', type: 'boolean',
    group: 'tax', fallback: 'false', options: BOOL,
    hint: 'روشن‌کردن به‌تنهایی کافی نیست: شناسه‌یِ یکتایِ حافظه و شناسه‌یِ ملیِ فروشنده هم لازم است.' },
  { key: 'moadian_mode', label: 'حالتِ ارسال', type: 'select', group: 'tax',
    fallback: 'sandbox',
    options: [
      { value: 'sandbox', label: 'آزمایشی (بدونِ ارتباط با سازمان)' },
      { value: 'production', label: 'واقعی (نیازمندِ گواهی و کلید)' },
    ],
    hint: 'در حالتِ آزمایشی هیچ اتصالی به سازمان برقرار نمی‌شود؛ بسته‌ها ساخته و ذخیره می‌شوند تا خطاهایِ داده‌ای پیش از روزِ رسمی دیده شود.' },
  { key: 'moadian_fiscal_id', label: 'شناسه‌یِ یکتایِ حافظه‌یِ مالیاتی', type: 'text',
    group: 'tax', fallback: '',
    hint: 'از کارپوشه‌یِ مالیاتی (بخشِ شناسه‌هایِ یکتا) دریافت می‌شود؛ مبنایِ ساختِ شماره‌یِ منحصربه‌فردِ مالیاتی است.' },
  { key: 'moadian_client_id', label: 'شناسه‌یِ مشتری (client id)', type: 'text',
    group: 'tax', fallback: '',
    hint: 'پس از ثبتِ روشِ ارسالِ مستقیم در سامانه صادر می‌شود.' },
  { key: 'moadian_taxpayer_national_id', label: 'شناسه‌یِ ملیِ فروشنده', type: 'text',
    group: 'tax', fallback: '',
    hint: 'اگر خالی بماند، از «شناسه‌یِ ملیِ فروشگاه» استفاده می‌شود.' },
  { key: 'moadian_auto_send', label: 'ارسالِ خودکار پس از پرداخت', type: 'boolean',
    group: 'tax', fallback: 'false', options: BOOL,
    hint: 'در حالتِ خاموش، صورتحساب ساخته و در صف می‌ماند تا حسابدار تأیید و بفرستد.' },

  // ── درگاهِ پرداخت ──────────────────────────────────────────────────────
  { key: 'payment_gateway', label: 'درگاهِ پیش‌فرض', type: 'select', group: 'gateway',
    fallback: 'sandbox',
    options: [
      { value: 'sandbox', label: 'آزمایشی (پولِ واقعی جابه‌جا نمی‌شود)' },
      { value: 'zarinpal', label: 'زرین‌پال' },
      { value: 'idpay', label: 'آی‌دی‌پی' },
    ],
    hint: 'تا زمانی که کلیدِ درگاه تأیید نشده، درگاهِ آزمایشی را نگه دارید.' },
  { key: 'payment_sandbox_mode', label: 'حالتِ آزمایشی', type: 'boolean', group: 'gateway',
    fallback: 'true', options: BOOL,
    hint: 'در تولید باید «خیر» باشد؛ وگرنه پرداخت‌هایِ واقعی شبیه‌سازی می‌شوند.' },
  { key: 'zarinpal_merchant_id', label: 'کلیدِ زرین‌پال', type: 'secret', group: 'gateway',
    fallback: '', secretTail: 4 },
  { key: 'idpay_api_key', label: 'کلیدِ آی‌دی‌پی', type: 'secret', group: 'gateway',
    fallback: '', secretTail: 4 },

  // ── پیامک ──────────────────────────────────────────────────────────────
  { key: 'sms_enabled', label: 'ارسالِ پیامک', type: 'boolean', group: 'sms',
    fallback: 'false', options: BOOL,
    hint: 'با «خیر»، پیامک‌ها در صف می‌مانند و فرستاده نمی‌شوند (برایِ محیطِ آزمایشی).' },
  { key: 'sms_provider', label: 'ارسال‌کننده', type: 'select', group: 'sms', fallback: 'none',
    options: [
      { value: 'none', label: 'هیچ (فقط صف)' },
      { value: 'melipayamak', label: 'ملی‌پیامک' },
      { value: 'kavenegar', label: 'کاوه‌نگار' },
      { value: 'farazsms', label: 'فراز‌اس‌ام‌اس' },
    ] },
  { key: 'sms_api_key', label: 'کلیدِ ارسال‌کننده', type: 'secret', group: 'sms', fallback: '',
    secretTail: 4,
    hint: 'کاوه‌نگار/فراز: کلیدِ API. ملی‌پیامک: «کاربری|گذرواژه». بی‌این، صف در جایِ خودش می‌ماند.' },
  { key: 'sms_sender', label: 'خطِ پیامک (فرستنده)', type: 'text', group: 'sms', fallback: '',
    hint: 'برایِ اکثرِ قالب‌ها لازم نیست؛ فقط وقتی لازم است که بخواهید متنِ آزاد (بی‌قالبِ تأییدشده) بفرستید — و آن هم معمولاً مجاز نیست.' },
  { key: 'sms_max_attempts', label: 'حداکثرِ تلاش برایِ هر پیامک', type: 'number', group: 'sms',
    fallback: '5', min: 1, max: 20,
    hint: 'بعد از این تعداد، پیام به «از تلاش ناامید شدیم» می‌رود تا یک شمارهٔ بد یا یک قطعیِ طولانی، صف را تا ابد سنگین نکند.' },
  { key: 'sms_retry_minutes', label: 'فاصلهٔ تلاشِ دوباره (دقیقه)', type: 'number', group: 'sms',
    fallback: '10', min: 1, max: 720,
    hint: 'فاصله دو‌برابر می‌شود (۱۰، ۲۰، ۴۰… و حداکثر یک روز) تا به سامانهٔ پایین‌آمده هجوم نرود.' },
  { key: 'sms_worker_stale_minutes', label: 'مهلتِ سکوتِ کارگرِ صف (دقیقه)', type: 'number', group: 'sms',
    fallback: '70', min: 5, max: 1440,
    hint: 'اگر پیامکِ نوبت‌دار باشد و تا این اندازه هیچ تکانی در صف ندیده باشیم، صفحهٔ پایش هشدار می‌دهد. عدد باید بزرگ‌تر از فاصلهٔ اجرایِ کارگر باشد (تایمرِ systemd یا cron): با ۲ دقیقه یک بار، ۱۵ کافی است؛ با ساعتی یک بار، ۷۰.' },
  { key: 'sms_outbox_retention_days', label: 'مهلتِ نگهداریِ پیامک‌هایِ تمام‌شده (روز)', type: 'number', group: 'sms',
    fallback: '60', min: 0, max: 3650,
    hint: 'پیامکِ فرستاده‌شده یا «ناامیدکننده» پس ازِ این مهلت از صندوق پاک می‌شود (صفِ زنده هرگز پاک نمی‌شود). ۰ یعنی هیچ‌وقت — با هزاران پیامک در سال، همین صفر علتِ کندیِ صفحهٔ صندوق می‌شود.' },
  { key: 'audit_log_retention_days', label: 'مهلتِ نگهداریِ ردِّ عملیات (روز)', type: 'number', group: 'sms',
    fallback: '0', min: 0, max: 36500,
    hint: '۰ یعنی همیشگی، که پیش‌فرضِ درست است: ردِّ عملیات برایِ اختلافِ مالی و حسابرسی لازم است. اگر سرور جایِ کمی دارد، عددی مثلِ ۱۰۹۵ (سه سال) بگذارید.' },
  { key: 'observability_retention_days', label: 'مهلتِ نگهداریِ آمارِ مهارِ بار (روز)', type: 'number', group: 'advanced',
    fallback: '7', min: 0, max: 365,
    hint: 'ردِّ مسدودشدن‌ها و سطل‌هایِ شمارش چند روز بمانند؟ ۰ یعنی پاک نشود. عددِ خیلی کوچک یعنی فرصتِ دیدنِ یک حملهٔ کُند از دست می‌رود؛ عددِ خیلی بزرگ یعنی میلیونها سطرِ بی‌استفاده.' },

  // ── بهداشتِ فایل‌ها (پیشرفته) ──────────────────────────────────────────
  // سه کلیدِ نگه‌داریِ ردیف‌ها در مهاجرتِ ۰۳۷ است؛ این سه، همان سیاست را به
  // دیسک تعمیم می‌دهند. `fallback`ها عمداً با `MEDIA_POLICY_DEFAULTS` در
  // `packages/commerce/src/media-hygiene.ts` یکی‌اند: اگر یکی شوند، پنل عددی
  // نشان می‌دهد که کد هیچ‌وقت آن را اعمال نمی‌کند.
  { key: 'media_grace_days', label: 'مهلتِ اعتمادِ فایلِ بی‌صاحب (روز)', type: 'number', group: 'advanced',
    fallback: '14', min: 0, max: 3650,
    hint: 'تصویری که هیچ ردیفی در پایگاه نمی‌خواهد چند روز بماند تا قطعی شود بی‌صاحب است؟ در همین پنجره ممکن است بارگذاری در جریان باشد یا پشتیبانی بازگردانی شده باشد. ۰ یعنی هرگز پاک نشود — و در این حالت پوشه پویش هم نمی‌شود.' },
  { key: 'media_autopurge', label: 'پاک‌سازیِ خودکارِ فایل‌ها', type: 'boolean', group: 'advanced',
    fallback: 'false', options: BOOL,
    hint: 'با «بله» کارگرِ پس از فروش فایل‌هایِ بی‌صاحبِ کهنه را خودش برمی‌دارد. با «خیر» (پیش‌فرض) فقط در پنل گزارش می‌شود و دکمهٔ «پاک‌سازی» در صفحهٔ تصویرها خودتان می‌زنید — چون فایلِ پاک‌شده برگشت ندارد.' },
  { key: 'media_scan_minutes', label: 'فاصلهٔ پویشِ پوشهٔ رسانه (دقیقه)', type: 'number', group: 'advanced',
    fallback: '360', min: 5, max: 10080,
    hint: 'پویشِ پوشه یعنی «برایِ هر فایل یک stat»؛ رویِ صدها‌هزار فایل این کارِ رایگانی نیست. تا این فاصله، پنل همان شمارشِ اخیر را نشان می‌دهد و دکمهٔ «از نو بررسی کن» کش را رد می‌کند.' },

  // ── سرعتِ جستجو (پیشرفته) ───────────────────────────────────────────────
  // عددِ پیش‌فرض از `SEARCH_CACHE_DEFAULT_SECONDS` در `packages/catalog/src/query-cache.ts`
  // می‌آید؛ اگر این‌جا یکی شوند، پنل عددی را نشان می‌دهد که کد هیچ‌وقت اعمالش نمی‌کند.
  { key: 'search_cache_seconds', label: 'عمرِ کشِ پرسش‌هایِ جستجو (ثانیه)', type: 'number', group: 'advanced',
    fallback: '15', min: 0, max: 3600,
    hint: 'یک پرسشِ پرتکرار (مثلِ «شارژر» رویِ کاتالوگِ بیست‌هزار کالایی) تا ۸۴ میلی‌ثانیه از وقتِ سرویس می‌گیرد و هشتاد درصدِ ترافیکِ جستجو چند واژهٔ تکراری است. در این پنجره پاسخِ همان پرسش از حافظهٔ خودِ سرور می‌آید. ۰ یعنی کشِ خاموش. کالایِ تازه، ویرایشِ کالا و مترادفِ تازه کش را همان لحظه می‌اندازند؛ آنچه از این مسیرها نمی‌گذرد (موجودی و قیمتِ تغییرکرده با سفارش) تا همین اندازه کهنه می‌ماند — که همان ۱۵ ثانیهٔ رندرِ برگهٔ نتایج است. تغییرِ این عدد تا ۵ ثانیه بعد اعمال می‌شود؛ دکمهٔ «خالی‌کردنِ کشِ جستجو» در پنلِ جستجو همان لحظه.' },

  // ── پیشرفته ────────────────────────────────────────────────────────────
  { key: 'partner_price_mode', label: 'شیوه‌یِ قیمتِ همکار', type: 'select', group: 'advanced',
    fallback: 'amount',
    options: [
      { value: 'amount', label: 'مبلغِ ثابت' },
      { value: 'percent', label: 'درصد' },
    ] },
  { key: 'trend_definition', label: 'تعریفِ کالایِ پرفروش', type: 'select', group: 'advanced',
    fallback: 'auto_14d',
    options: [
      { value: 'auto_14d', label: 'خودکار — ۱۴ روزِ گذشته' },
      { value: 'auto_30d', label: 'خودکار — ۳۰ روزِ گذشته' },
      { value: 'manual', label: 'دستی' },
    ] },
  { key: 'partner_check_online', label: 'بررسیِ آنلاینِ چکِ همکار', type: 'select',
    group: 'advanced', fallback: 'after_receipt',
    options: [
      { value: 'after_receipt', label: 'پس از دریافت' },
      { value: 'before_receipt', label: 'پیش از دریافت' },
    ] },
  { key: 'compare_enabled', label: 'مقایسه‌یِ کالاها', type: 'boolean', group: 'advanced',
    fallback: 'false', options: BOOL },
  { key: 'blog_enabled', label: 'وبلاگ/محتوا', type: 'boolean', group: 'advanced',
    fallback: 'false', options: BOOL },
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

export function settingDef(key: string): SettingDef | undefined {
  return BY_KEY.get(key);
}

export function isKnownSetting(key: string): boolean {
  return BY_KEY.has(key);
}

/**
 * کلیدهایی که در خروجیِ شبکه پوشانده می‌شوند.
 *
 * چرا؟ چون تنظیمات در یک صفحه‌ی مدیریت نمایش داده می‌شوند و آن صفحه ممکن
 * است رویِ صفحه‌یِ یک فروشنده باز باشد؛ فرستادنِ کلیدِ درگاه به مرورگر یعنی
 * هر افزونه یا اسکریپتی رویِ آن صفحه می‌تواند آن را بخواند. فروشنده فقط
 * باید بداند کلید «تنظیم شده» یا نه — نه این‌که چه است.
 */
export function maskSecret(def: SettingDef, value: string): string {
  if (def.type !== 'secret') return value;
  if (!value) return '';
  const tail = def.secretTail ?? 4;
  if (value.length <= tail) return '•'.repeat(value.length);
  return `${'•'.repeat(Math.min(8, value.length - tail))}${value.slice(-tail)}`;
}

export interface ValidationResult {
  ok: boolean;
  /** مقدارِ پاک‌شده (برایِ ذخیره) */
  value?: string;
  message?: string;
}

/**
 * اعتبارسنجیِ یک مقدار پیش از نوشتن.
 *
 * چرا اینجا و نه فقط در پایگاه؟ چون خطایِ نوع را باید همان لحظه به مدیر
 * نشان داد: اگر «مهلتِ مرجوعی» به‌جایِ عدد رشته بگیرد و بی‌سروصدا ذخیره
 * شود، نخستین جایی که خراب می‌شود محاسبه‌یِ مهلتِ مرجوعیِ یک سفارشِ واقعی
 * است — یعنی هفته‌ها بعد و با مشتریِ شاکی.
 */
export function validateSetting(key: string, raw: unknown): ValidationResult {
  const def = BY_KEY.get(key);
  if (!def) return { ok: false, message: `تنظیمِ «${key}» شناخته‌شده نیست.` };

  if (raw === null || raw === undefined) return { ok: true, value: '' };
  const value = String(raw).trim();

  if (def.type === 'boolean') {
    if (value === 'true' || value === 'false') return { ok: true, value };
    if (value === 'بله') return { ok: true, value: 'true' };
    if (value === 'خیر') return { ok: true, value: 'false' };
    return { ok: false, message: `${def.label}: فقط «بله» یا «خیر».` };
  }

  if (def.type === 'number') {
    // چرا تهی را رد می‌کنیم؟ چون Number('') برابرِ صفر است؛ اگر تهی را
    // بپذیریم، خالی گذاشتنِ «نرخِ ارزش‌افزوده» بی‌سروصدا نرخ را صفر می‌کند و
    // فاکتورها بدونِ مالیات صادر می‌شوند — خطایی که در پایانِ دوره‌ی مالیاتی
    // دیده می‌شود، یعنی خیلی دیر.
    if (value === '') {
      return { ok: false, message: `${def.label}: مقدار را وارد کنید.` };
    }
    // ارقامِ فارسی را هم می‌پذیریم: کاربرِ ایرانی با کیبوردِ فارسی می‌نویسد
    const normalized = value.replace(/[\u06F0-\u06F9]/g, (d) =>
      String.fromCharCode(d.charCodeAt(0) - 1728),
    );
    const n = Number(normalized);
    if (!Number.isFinite(n)) return { ok: false, message: `${def.label}: باید عدد باشد.` };
    if (def.min !== undefined && n < def.min) {
      return { ok: false, message: `${def.label}: کمتر از ${def.min} پذیرفته نیست.` };
    }
    if (def.max !== undefined && n > def.max) {
      return { ok: false, message: `${def.label}: بیش از ${def.max} پذیرفته نیست.` };
    }
    return { ok: true, value: String(n) };
  }

  if (def.type === 'select') {
    const allowed = (def.options ?? []).map((o) => o.value);
    if (!allowed.includes(value)) {
      return { ok: false, message: `${def.label}: گزینه‌یِ «${value}» مجاز نیست.` };
    }
    return { ok: true, value };
  }

  if (def.digitsOnly && value) {
    // ارقامِ فارسی به انگلیسی، و جداکننده‌هایِ نوشتاری (فاصله، خطِ تیره) حذف
    // می‌شوند: کدِ پستی را همه با فاصله می‌نویسند و رد کردنش بی‌دلیل است.
    const cleaned = value
      .replace(/[\u06F0-\u06F9]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1728))
      .replace(/[\s\-_.]/g, '');
    if (!/^\d*$/.test(cleaned)) {
      return { ok: false, message: `${def.label}: فقط رقم بپذیرید.` };
    }
    return { ok: true, value: cleaned };
  }

  return { ok: true, value };
}

/** متغیرهایِ لازمِ یک قالب را از متن استخراج می‌کند (مثلِ {store} و {code}) */
export function extractPlaceholders(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(/\{(\w+)\}/g)) found.add(m[1]!);
  return [...found].sort();
}
