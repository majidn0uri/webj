# گزارش مقایسه فلوچارت واقعی با پیاده‌سازی

> تاریخ: ۲۰۲۶-۰۹-۲۰
> روش: هر مرحله از فلوچارت‌های واقعی (BUSINESS-FLOWCHARTS.md) با کد موجود مقایسه شده است.

---

## ✅ مراحل کامل (پیاده‌سازی شده)

| مرحله | فلوچارت | پیاده‌سازی | وضعیت |
|-------|---------|-----------|-------|
| جستجو و فیلتر محصولات | ✅ | `catalog.search()` — تمام‌متنی، فیلتر، مرتب‌سازی، مترادف | ✅ |
| صفحه محصول + مشخصات فنی | ✅ | `catalog.productBySlug()` + compatibility | ✅ |
| انتخاب تنوع + بررسی موجودی | ✅ | `stock_items.available = on_hand - reserved` | ✅ |
| سبد خرید + کد تخفیف | ✅ | `cart` + `validateCoupon` + `applyCouponRecord` | ✅ |
| ورود / ثبت‌نام با OTP | ✅ | `shopper.register` + OTP + rate limit | ✅ |
| خرید مهمان + اتصال بعدی | ✅ | `claimGuestOrders()` در `shopper` | ✅ |
| آدرس ارسال | ✅ | `shipping_address` روی سفارش | ✅ |
| ثبت سفارش + رزرو موجودی | ✅ | `reserveStock()` + `createOrder()` | ✅ |
| انقضای رزرو (۱۵ دقیقه) | ✅ | `releaseExpiredReservations()` در `inventory` | ✅ |
| انتخاب درگاه پرداخت | ✅ | زرین‌پال، آیدی‌پی، sandbox | ✅ |
| تأیید پرداخت + خروج از انبار | ✅ | `confirmPayment()` → `confirmStock()` | ✅ |
| سند حسابداری فروش | ✅ | `postSaleOn()` — درآمد + بهای تمام‌شده + ارزش افزوده | ✅ |
| بسته‌بندی | ✅ | `PackingService.pack()` + کسری | ✅ |
| ارسال + کد رهگیری | ✅ | `createShipment()` + برچسب PDF | ✅ |
| تحویل | ✅ | `markDelivered()` | ✅ |
| فاکتور فروش PDF | ✅ | `GET /admin/exports/orders/:id/invoice.pdf` | ✅ |
| POS: گشایش شیفت | ✅ | `openShift()` | ✅ |
| POS: فروش + پرداخت فوری | ✅ | `sell()` → `confirmPayment()` | ✅ |
| POS: بستن شیفت + مغایرت | ✅ | `closeShift()` — expected vs counted | ✅ |
| POS: اتصال به حساب مشتری | ✅ | resolve `customerId` از `customerMobile` | ✅ |
| پرداخت با چک در POS | ✅ | SellDto: `cheque` → حساب 1400 | ✅ |
| قیمت همکاری در فروشگاه | ✅ | `isPartner` → `COALESCE(partner_price_rial, price_rial)` | ✅ |
| پیامک: پرداخت موفق | ✅ | POS sell + online verify → `order_paid` | ✅ |
| پیامک: ارسال سفارش | ✅ | `createShipment()` → `order_shipped` | ✅ |
| پیامک: تحویل سفارش | ✅ | `markDelivered()` → `order_delivered` | ✅ |
| پیامک: لغو سفارش | ✅ | `cancel()` → `order_cancelled` | ✅ |
| پیامک: موجود شدن کالا | ✅ | `StockAlertService.notifyForProduct()` → `product_back` | ✅ |
| تعریف محصول + تنوعات | ✅ | `CatalogService.createProduct()` | ✅ |
| تعریف دسته‌بندی درختی | ✅ | `CategoryService` + `descendantIds` | ✅ |
| تعریف تأمین‌کننده | ✅ | `suppliers` table + CRUD | ✅ |
| درخواست خرید | ✅ | `purchase_requests` + approval | ✅ |
| رسید خرید + ورود به انبار | ✅ | `receivePurchase()` + WAC | ✅ |
| فاکتور خرید + سند خودکار | ✅ | `postPurchaseInvoice()` + auto-journal | ✅ |
| PDF فاکتور خرید | ✅ | `GET /accounting/purchases/:id/pdf` | ✅ |
| دفتر کل دوبل | ✅ | `AccountingService` — journal, trial balance, P&L | ✅ |
| ترازنامه آزمایشی | ✅ | `trialBalance()` | ✅ |
| صورت سود و زیان | ✅ | `profitAndLoss()` | ✅ |
| گواهی مالیاتی | ✅ | `tax_certificates` table | ✅ |
| صورتحساب مالیاتی | ✅ | `tax_invoices` + `moadian_auto_send` | ✅ |
| ارسال به مؤدیان | ✅ | batch send + auto send | ✅ |
| مرجوعی: درخواست → تصمیم → تکمیل | ✅ | `requestReturn` → `decideReturn` → `completeReturn` | ✅ |
| مرجوعی: بازگشت موجودی به انبار | ✅ | `on_hand += quantity` در `completeReturn` | ✅ |
| مرجوعی: سند حسابداری معکوس | ✅ | سند معکوس (swap debit/credit) در `completeReturn` | ✅ |
| مرجوعی: بازپرداخت | ✅ | `refundMethod`: bank, cash, credit, check_void | ✅ |
| کوپن: دسته‌بندی | ✅ | `categoryId` + `categoryTreesByProduct` | ✅ |
| کوپن: محدودیت مشتری | ✅ | `customerId` در validation | ✅ |
| کوپن: آزادسازی پس از لغو | ✅ | `releaseCoupon()` در `cancel()` | ✅ |
| امنیت: RBAC | ✅ | `AccessControl` + `permissions` + `role_permissions` | ✅ |
| امنیت: rate limiting | ✅ | `@set/rate-limit` — ورود، ثبت‌نام، پرداخت | ✅ |
| امنیت: OTP محدود | ✅ | ۵ تلاش + ۵ دقیقه قفل | ✅ |

---

## ❌ مراحل ناقص یا missing

### بحرانی (بلافاصله باید رفع شود)

| مرحله | فلوچارت واقعی | پیاده‌سازی | مشکل |
|-------|---------------|-----------|------|
| **پیامک تأیید سفارش** | پس از ثبت سفارش → `order_confirmed` | ❌ هیچ‌جا trigger نشده | قالب موجوده ولی به هیچ رویدادی وصل نیست |
| **پیامک سررسید چک** | یادآوری قبل از سررسید → `check_due` | ❌ trigger نشده | قالب + جدول موجود ولی cron/trigger نیست |
| **پیامک برگشت چک** | پس از برگشت → `check_bounced` | ❌ trigger نشده | قالب موجود ولی به `checkStatus()` وصل نیست |

### مهم (باید رفع شود)

| مرحله | فلوچارت واقعی | پیاده‌سازی | مشکل |
|-------|---------------|-----------|------|
| **تأیید سفارش توسط مدیر** | مدیر سفارش را بررسی و تأیید می‌کند | ⚠️ وضعیت `confirmed` موجود ولی endpoint جدا ندارد | مستقیماً از `paid` به `packing` می‌رود |
| **فاکتور فروش حضوری** | POS فاکتور چاپ می‌کند | ⚠️ PDF موجود ولی دکمه چاپ در POS نیست | فروشنده باید بتواند فوری چاپ کند |
| **گزارش موجودی بحرانی** | مدیر باید ببیند چه کالاهایی کم هست | ⚠️ `stock_alerts` موجود ولی گزارش جدا ندارد | داشبورد باید هشدار نشان دهد |
| **فاکتور خرید + سفارش خرید** | سفارش خرید → دریافت → فاکتور | ⚠️ سه مرحله جدا هست ولی جریان خطی نیست | اتصال ضعیف بین مراحل |

### مطلوب (بهبود تجربه کاربری)

| مرحله | فلوچارت واقعی | پیاده‌سازی | مشکل |
|-------|---------------|-----------|------|
| **انتخاب روش ارسال** | مشتری روش ارسال را انتخاب می‌کند | ❌ صفحه checkout جدا ندارد | shipping فقط در مدیریت |
| **پیش‌بینی زمان تحویل** | ETA بر اساس روش ارسال | ⚠️ `eta_days` در tariff موجود ولی نمایش داده نمی‌شود | |
| **پیگیری سفارش توسط مشتری** | مشتری وضعیت سفارش را ببیند | ⚠️ صفحه حساب کاربری سفارشات را نشان می‌دهد ولی وضعیت دقیق نیست | |
| **مقایسه قیمت تأمین‌کنندگان** | مدیر قیمت‌های مختلف تأمین‌کننده را مقایسه کند | ❌ فقط یک تأمین‌کننده هر بار | |

---

## خلاصه آمار

| دسته | تعداد |
|------|-------|
| ✅ مراحل کامل | ۴۸ |
| ❌ بحرانی (missing) | ۳ |
| ⚠️ مهم (ناقص) | ۴ |
| 🔵 مطلوب (بهبود) | ۴ |

---

## اولویت رفع نواقص

### فوری (بحرانی):
1. اتصال پیامک `order_confirmed` به ثبت سفارش
2. اتصال پیامک `check_bounced` به تغییر وضعیت چک
3. ساخت cron job برای یادآوری `check_due`

### مهم:
4. افزودن endpoint تأیید سفارش توسط مدیر (confirmed)
5. افزودن دکمه چاپ فاکتور در صفحه POS
6. گزارش موجودی بحرانی در داشبورد
7. بهبود جریان سفارش خرید → دریافت → فاکتور

### مطلوب:
8. صفحه انتخاب روش ارسال در checkout
9. نمایش ETA به مشتری
10. صفحه پیگیری سفارش بهتر