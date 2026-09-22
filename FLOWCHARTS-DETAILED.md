# فلوچارت‌های دقیق — آیتم به آیتم

> هر مرحله: صفحه · نقش · ورودی · خروجی · مبدأ → مقصد · نتیجه

---

# فلوچارت ۱: فروش آنلاین — مشتری عادی

---

## ۱.۱ جستجو و مرور محصولات

| فیلد | مقدار |
|------|-------|
| **صفحه** | صفحه اصلی `/` و صفحه جستجو `/search` |
| **نقش** | بازدیدکننده (بدون احراز هویت) |
| **چگونه** | تایپ در باکس جستجو، کلیک روی دسته‌بندی، فیلتر برند/نوع/رنگ/قیمت |
| **ورودی** | متن جستجو (q)، فیلترها (brand, type, colour, device, available, discounted) |
| **خروجی** | لیست محصولات: id, title, slug, brand, minPriceRial, imageUrl, discountPercent, availableQty, colours |
| **مبدأ** | `GET /catalog/search?q=&brand=&type=&colour=&available=&discounted=&limit=&offset=` |
| **→ کنترلر** | `apps/api/src/catalog.controller.ts` → `search()` |
| **→ سرویس** | `packages/catalog/src/index.ts` → `CatalogService.search()` |
| **→ پایگاه** | جستجوی تمام‌متنی روی `search_key` محصولات + فیلتر روی `product_variants`, `stock_items`, `brands`, `product_types` |
| **→ کش** | `searchCachePolicy()` — اگر کش فعال باشد و تازه باشد، از کش برمی‌گردد |
| **→ مقصد** | کامپوننت `ProductCard` در صفحه نتایج |
| **نتیجه** | مشتری محصولات را می‌بیند، فیلتر می‌زند، مرتب می‌کند |

---

## ۱.۲ مشاهده صفحه محصول

| فیلد | مقدار |
|------|-------|
| **صفحه** | `/p/{slug}` |
| **نقش** | بازدیدکننده |
| **چگونه** | کلیک روی کارت محصول |
| **ورودی** | slug محصول (از URL) |
| **خروجی** | اطلاعات کامل: title, description, brand, images[], variants[], specs[], compatibleDevices[], price, discount, colours |
| **مبدأ** | `GET /catalog/products/{slug}` |
| **→ کنترلر** | `catalog.controller.ts` → `productBySlug()` |
| **→ سرویس** | `CatalogService.productBySlug()` |
| **→ پایگاه** | `products` + `product_variants` + `product_images` + `product_specs` + `product_compatibility` + `device_models` |
| **→ مقصد** | صفحه محصول: تصاویر، مشخصات فنی، لیست تنوعات، دکمه افزودن به سبد |
| **نتیجه** | مشتری محصول را کامل می‌بیند و تنوع مورد نظر را انتخاب می‌کند |

---

## ۱.۳ افزودن به سبد

| فیلد | مقدار |
|------|-------|
| **صفحه** | `/p/{slug}` — دکمه «افزودن به سبد» |
| **نقش** | بازدیدکننده |
| **چگونه** | انتخاب تنوع (رنگ/حافظه) + کلیک روی دکمه |
| **ورودی** | variantId, quantity (معمولاً ۱) |
| **خروجی** | cartId (در کوکی `set_cart`) + پاسخ موفقیت |
| **مبدأ** | `POST /cart/add` — از `addToCart()` در `cart-actions.ts` |
| **→ کنترلر** | `apps/api/src/cart.controller.ts` → `create()` یا `addItem()` |
| **→ سرویس** | `packages/cart/src/` — ایجاد سبد (اگر نیست) + افزودن آیتم |
| **→ پایگاه** | `carts` + `cart_items` — بررسی موجودی از `stock_items` |
| **→ مقصد** | کوکی `set_cart` = cartId — Badge سبد در هدر سایت آپدیت می‌شود |
| **نتیجه** | آیتم در سبد ذخیره شد، Badge عدد نشان می‌دهد |

---

## ۱.۴ صفحه سبد خرید

| فیلد | مقدار |
|------|-------|
| **صفحه** | `/cart` |
| **نقش** | بازدیدکننده |
| **چگونه** | کلیک روی آیکون سبد یا لینک سبد |
| **ورودی** | cartId (از کوکی) |
| **خروجی** | لیست آیتم‌ها + جمع + تخفیف + مالیات + ارسال + قابل پرداخت |
| **مبدأ** | `GET /cart/{id}` — از `getCart()` در `cart-actions.ts` |
| **→ کنترلر** | `cart.controller.ts` → `get()` |
| **→ سرویس** | CartService — خواندن آیتم‌ها + محاسبه قیمت با `calcLine()` + `sumLines()` |
| **→ پایگاه** | `cart_items` + `product_variants` + `products` — قیمت‌ها از DB می‌آید (نه از مرورگر) |
| **→ مقصد** | صفحه سبد: جدول آیتم‌ها، دکمه تغییر تعداد، دکمه حذف، باکس کد تخفیف |
| **نتیجه** | مشتری سبد را می‌بیند، تعداد را تغییر می‌دهد، کد تخفیف اعمال می‌کند |

---

## ۱.۵ اعمال کد تخفیف

| فیلد | مقدار |
|------|-------|
| **صفحه** | `/cart` — باکس کد تخفیف |
| **نقش** | بازدیدکننده |
| **چگونه** | تایپ کد + کلیک «اعمال» |
| **ورودی** | couponCode (رشته) |
| **خروجی** | تخفیف محاسبه‌شده + خطای احتمالی |
| **مبدأ** | `POST /cart/{id}/coupon` — از `applyCoupon()` در `cart-actions.ts` |
| **→ کنترلر** | `cart.controller.ts` → `applyCoupon()` |
| **→ سرویس** | `validateCoupon()` — بررسی کد، تاریخ، تعداد، مشتری، حداقل مبلغ |
| **→ محاسبه** | `applyCouponRecord()` — توزیع تخفیف بین ردیف‌ها بر اساس categoryId |
| **→ پایگاه** | `coupons` — خواندن شرایط + بررسی `coupon_redemptions` |
| **→ مقصد** | صفحه سبد: مبلغ تخفیف نمایش داده می‌شود، جمع کاهش می‌یابد |
| **نتیجه** | تخفیف اعمال شد یا خطای فارسی نمایش داده شد |

---

## ۱.۶ ورود / ثبت‌نام با OTP

| فیلد | مقدار |
|------|-------|
| **صفحه** | `/cart` — فرم ورود (قبل از checkout) یا صفحه `/login` |
| **نقش** | بازدیدکننده |
| **چگونه** | ۱. وارد کردن شماره موبایل → ارسال کد OTP · ۲. وارد کردن کد → تأیید |
| **ورودی مرحله ۱** | mobile (شماره موبایل), purpose ('login' یا 'register') |
| **خروجی مرحله ۱** | `sent: true`, `expiresInSeconds` |
| **مبدأ مرحله ۱** | `POST /shop/auth/otp/request` |
| **→ کنترلر** | `shopper.controller.ts` → `otpRequest()` |
| **→ سرویس** | `requestOtp()` — تولید کد ۶ رقمی + هش + ذخیره در `customer_otps` |
| **→ SMS** | `enqueueSms()` → قالب `otp_login` → sms_outbox → ارسال توسط کارگر |
| **→ مقصد** | پیامک به موبایل مشتری |
| | |
| **ورودی مرحله ۲** | mobile, code (کد ۶ رقمی), purpose, fullName (اختیاری) |
| **خروجی مرحله ۲** | customerId, token (نشست), isNew, claimedOrders, expiresAt |
| **مبدأ مرحله ۲** | `POST /shop/auth/otp/verify` |
| **→ کنترلر** | `shopper.controller.ts` → `otpVerify()` |
| **→ سرویس** | `verifyOtp()` — بررسی کد + محدودیت تلاش (۵ بار + ۵ دقیقه قفل) |
| **→ اگر تازه** | `INSERT INTO customers` → پیامک `welcome` |
| **→ اتصال مهمان** | `claimGuestOrders()` — سفارشات قبلی با همان شماره به حساب وصل می‌شود |
| **→ مقصد** | کوکی نشست + هدایت به صفحه قبل |
| **نتیجه** | مشتری وارد شد، سفارشات قبلی وصل شد |

---

## ۱.۷ صفحه Checkout (تسویه‌حساب)

| فیلد | مقدار |
|------|-------|
| **صفحه** | `/checkout` — فرم: نام، موبایل، آدرس، انتخاب درگاه |
| **نقش** | مشتری (وارد شده) |
| **چگونه** | پر کردن فرم + انتخاب درگاه + کلیک «پرداخت» |
| **ورودی** | customerName, customerMobile, shippingAddress, couponCode, gateway |
| **خروجی** | orderId + هدایت به درگاه پرداخت |
| **مبدأ** | `POST /orders` — از `checkout()` در `cart-actions.ts` |
| **→ کنترلر** | `cart.controller.ts` → `checkout()` |
| **→ بررسی اعتبار** | اگر همکار: بررسی `credit_rial` در برابر بدهی معوق |
| **→ سرویس** | `OrderService.createOrder()` — رزرو موجودی + ایجاد سفارش |
| **→ مراحل داخلی** | (در `packages/orders/src/index.ts`) |
| | ۱. بررسی کلید یکتایی (idempotencyKey) — جلوگیری از سفارش تکراری |
| | ۲. گرفتن شماره سفارش (اتمیک از `number_sequences`) |
| | ۳. عکس‌برداری از قیمت‌ها + محاسبه ردیف‌ها با `calcLine()` |
| | ۴. اعمال کوپن (اگر باشد) — `validateCoupon()` + `applyCouponRecord()` |
| | ۵. رزرو موجودی — `reserveStock()` → `stock_items.reserved += quantity` |
| | ۶. درج سفارش — `INSERT INTO orders` با وضعیت `pending_payment` |
| | ۷. درج ردیف‌ها — `INSERT INTO order_items` |
| | ۸. ثبت تاریخچه — `INSERT INTO order_status_history` |
| | ۹. انتشار رویداد — `order.placed` |
| | ۱۰. مصرف کوپن — `redeemCoupon()` |
| | ۱۱. تنظیم انقضای رزرو — `reservation_expires_at = now() + 15min` |
| **→ پایگاه** | `orders`, `order_items`, `order_status_history`, `events`, `coupon_redemptions`, `stock_items` |
| **→ مقصد** | `PaymentService.start()` → هدایت به درگاه |
| **نتیجه** | سفارش ثبت شد، موجودی رزرو شد، مشتری به بانک می‌رود |

---

## ۱.۸ پرداخت در درگاه

| فیلد | مقدار |
|------|-------|
| **صفحه** | صفحه بانک (زرین‌پال / آیدی‌پی / sandbox) |
| **نقش** | مشتری |
| **چگونه** | وارد کردن اطلاعات کارت + رمز پویا |
| **ورودی** | orderId (از مرحله قبل) |
| **خروجی** | authority (از درگاه) |
| **مبدأ** | `POST /payments/start` |
| **→ کنترلر** | `payments.controller.ts` → `start()` |
| **→ سرویس** | `PaymentService.start()` — ایجاد رکورد `payment` + گرفتن لینک درگاه |
| **→ پایگاه** | `payments` — status: 'pending', authority |
| **→ درگاه** | `gateway.start()` — ارسال به زرین‌پال/آیدی‌پی |
| **→ مقصد** | مرورگر به آدرس بانک هدایت می‌شود |
| **نتیجه** | مشتری در صفحه بانک است |

---

## ۱.۹ بازگشت از بانک + تأیید پرداخت

| فیلد | مقدار |
|------|-------|
| **صفحه** | `/pay/result` — صفحه نتیجه پرداخت |
| **نقش** | سیستم (خودکار — مرورگر به این صفحه برمی‌گردد) |
| **چگونه** | بانک مشتری را به callback برمی‌گرداند → صفحه `verify` را صدا می‌زند |
| **ورودی** | authority (از بانک), decision (برای sandbox) |
| **خروجی** | status: 'success' / 'failed' / 'already', orderNo, paymentId |
| **مبدأ** | `POST /payments/verify` |
| **→ کنترلر** | `payments.controller.ts` → `verify()` |
| **→ سرویس** | `PaymentService.verify()` — قفل ردیف + تأیید نزد درگاه |
| **→ اگر موفق** | `OrderService.confirmPaymentOn()` — در همان تراکنش: |
| | ۱. بررسی وضعیت (باید `pending_payment` باشد) |
| | ۲. بررسی مبلغ (باید مطابق باشد) |
| | ۳. خروج کالا از انبار — `confirmStock()` → `on_hand -= quantity`, `reserved -= quantity` |
| | ۴. محاسبه بهای تمام‌شده (WAC) → ثبت روی `order_items.unit_cost_rial` |
| | ۵. **سند حسابداری خودکار** — `postSaleOn()`: |
| |    بدهکار: بانک (1200) = مبلغ کل |
| |    بستانکار: درآمد فروش (4000) = خالص |
| |    بستانکار: ارزش افزوده (2100) = مالیات |
| |    بدهکار: بهای تمام‌شده (5000) = WAC |
| |    بستانکار: موجودی کالا (1000) = WAC |
| | ۶. ثبت پرداخت — `UPDATE payments SET status = 'success'` |
| | ۷. تغییر وضعیت سفارش — `UPDATE orders SET status = 'paid'` |
| | ۸. ثبت تاریخچه — `order_status_history` |
| | ۹. انتشار رویداد — `order.paid` |
| | ۱۰. ارسال به مؤدیان (اگر `moadian_auto_send` فعال) |
| **→ SMS** | ۲ پیامک: `order_paid` + `order_confirmed` → `sms_outbox` |
| **→ پایگاه** | `orders`, `order_items`, `payments`, `journal_entries`, `journal_lines`, `stock_items`, `stock_movements`, `order_status_history`, `events`, `sms_outbox` |
| **→ مقصد** | صفحه نتیجه: «پرداخت موفق بود» |
| **نتیجه** | سفارش پرداخت شد، کالا از انبار خارج شد، سند حسابداری ثبت شد، پیامک رفت |

---

## ۱.۱۰ بسته‌بندی

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت `/admin/orders` — دکمه «بسته‌بندی شد» |
| **نقش** | انباردار (`warehouse_staff`) |
| **چگونه** | مدیر سفارش را تأیید می‌کند (مرحله ۱.۱۱) سپس انباردار بسته‌بندی می‌کند |
| **ورودی** | orderId, complete (true/false), note |
| **خروجی** | وضعیت `packing` + لیست کسری‌ها |
| **مبدأ** | `POST /admin/orders/{id}/pack` |
| **→ UI** | `OrderActions.pack()` → `packOrder()` در `packing-actions.ts` |
| **→ کنترلر** | `packing.controller.ts` → `pack()` |
| **→ سرویس** | `PackingService.pack()` — بررسی موجودی + ثبت کسری |
| **→ پایگاه** | `orders` → status: 'packing', packed_at, packed_by, packing_complete, packing_note |
| **→ مقصد** | صفحه سفارشات: وضعیت «بسته‌بندی» + هشدار کسری (اگر باشد) |
| **نتیجه** | سفارش بسته‌بندی شد، کسری ثبت شد (اگر کالا کم باشد) |

---

## ۱.۱۱ تأیید سفارش توسط مدیر (جدید)

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت `/admin/orders` — دکمه «تأیید سفارش» |
| **نقش** | مدیر (`branch_manager` یا `super_admin`) |
| **چگونه** | کلیک روی دکمه «تأیید سفارش» برای سفارشات با وضعیت `paid` |
| **ورودی** | orderId |
| **خروجی** | وضعیت `confirmed` |
| **مبدأ** | `POST /admin/orders/{id}/confirm` |
| **→ UI** | `OrderActions.confirm()` → `confirmOrder()` در `packing-actions.ts` |
| **→ کنترلر** | `packing.controller.ts` → `confirm()` |
| **→ پایگاه** | `orders` → status: 'confirmed' + `order_status_history` |
| **→ مقصد** | سفارش در صف بسته‌بندی قرار می‌گیرد |
| **نتیجه** | سفارش تأیید شد، انباردار می‌تواند بسته‌بندی کند |

---

## ۱.۱۲ ارسال

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت `/admin/orders` — فرم کد رهگیری |
| **نقش** | انباردار |
| **چگونه** | وارد کردن کد رهگیری (حداقل ۶ کاراکتر) + کلیک «تأیید» |
| **ورودی** | orderId, carrier ('پست'), trackingCode (حداقل ۶ کاراکتر) |
| **خروجی** | وضعیت `shipped` + shipment_no + برچسب PDF |
| **مبدأ** | `POST /admin/orders/{id}/ship` |
| **→ UI** | `OrderActions.ship()` → `shipOrder()` در `packing-actions.ts` |
| **→ کنترلر** | `packing.controller.ts` → `ship()` |
| **→ سرویس** | `createShipment()` — بررسی کد رهگیری + ایجاد مرسوله |
| **→ پایگاه** | `shipments` (جدید), `orders` → status: 'shipped', `order_status_history` |
| **→ SMS** | `order_shipped` → `sms_outbox` |
| **→ برچسب** | PDF برچسب ارسال قابل دانلود |
| **→ مقصد** | صفحه سفارشات: وضعیت «ارسال‌شده» + کد رهگیری |
| **نتیجه** | سفارش ارسال شد، مشتری پیامک دریافت کرد |

---

## ۱.۱۳ تحویل

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت — دکمه «تحویل شد» |
| **نقش** | مدیر |
| **چگونه** | کلیک روی دکمه پس از تأیید تحویل توسط مشتری یا شرکت حمل |
| **ورودی** | shipmentId |
| **خروجی** | وضعیت `delivered` |
| **مبدأ** | `POST /admin/orders/{id}/deliver` |
| **→ کنترلر** | `packing.controller.ts` → `deliver()` |
| **→ سرویس** | `markDelivered()` |
| **→ پایگاه** | `shipments` → status: 'delivered', `orders` → status: 'delivered', `order_status_history` |
| **→ SMS** | `order_delivered` → `sms_outbox` |
| **نتیجه** | سفارش تحویل شد، مشتری پیامک تشکر دریافت کرد |

---

## ۱.۱۴ لغو سفارش

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت یا صفحه حساب مشتری |
| **نقش** | مدیر یا مشتری |
| **چگونه** | کلیک «لغو» + دلیل |
| **ورودی** | orderId, reason |
| **خروجی** | وضعیت `cancelled` |
| **مبدأ** | `POST /orders/{id}/cancel` |
| **→ کنترلر** | `orders.controller.ts` → `cancel()` |
| **→ سرویس** | `OrderService.cancel()` |
| **→ مراحل** | ۱. آزادسازی رزرو — `releaseStock()` → `reserved -= quantity` |
| | ۲. تغییر وضعیت — `cancelled` |
| | ۳. ثبت تاریخچه |
| | ۴. برگشت کوپن — `releaseCoupon()` |
| | ۵. انتشار رویداد — `order.cancelled` |
| **→ SMS** | `order_cancelled` → `sms_outbox` |
| **نتیجه** | سفارش لغو شد، موجودی آزاد شد، کوپن برگشت |

---

## ۱.۱۵ مرجوعی

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت `/admin/returns` |
| **نقش** | مشتری (درخواست) → مدیر (بررسی) → انباردار (دریافت) → مدیر (بازپرداخت) |

### مرحله ۱: درخواست مرجوعی

| فیلد | مقدار |
|------|-------|
| **صفحه** | `/account/orders/{orderNo}` — دکمه «درخواست مرجوعی» |
| **نقش** | مشتری |
| **ورودی** | orderId, variantId, quantity, reason |
| **مبدأ** | `POST /shop/returns` → `shopper.controller.ts` → `requestReturn()` |
| **→ سرویس** | `requestReturn()` — بررسی بازه مرجوعی (`withinReturnWindow()`) |
| **→ پایگاه** | `returns` + `return_items` — status: 'requested' |
| **نتیجه** | درخواست ثبت شد |

### مرحله ۲: تصمیم مدیر

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت `/admin/returns/{id}` |
| **نقش** | مدیر |
| **ورودی** | returnId, approve (true/false), decisionNote |
| **مبدأ** | `POST /admin/returns/{id}/decision` |
| **→ سرویس** | `decideReturn()` — audit log + SMS |
| **→ پایگاه** | `returns` → status: 'approved' یا 'rejected' |
| **→ SMS** | پیامک تأیید/رد به مشتری |
| **نتیجه** | مرجوعی تأیید یا رد شد |

### مرحله ۳: دریافت کالا

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت — دکمه «دریافت شد» |
| **نقش** | مدیر |
| **ورودی** | returnId, items (variantId, quantity, fate: to_stock/scrap/to_supplier) |
| **مبدأ** | `POST /admin/returns/{id}/receive` |
| **→ سرویس** | `receiveReturn()` → `completeReturn()` |
| **→ مراحل** | ۱. بازگشت موجودی به انبار (`on_hand += quantity`) |
| | ۲. ثبت `stock_movement` |
| | ۳. سند حسابداری معکوس (swap debit/credit سند اصلی فروش) |
| | ۴. بازپرداخت (bank/cash/credit/check_void) |
| | ۵. تغییر وضعیت به 'completed' |
| **→ پایگاه** | `returns`, `return_items`, `stock_items`, `stock_movements`, `journal_entries`, `journal_lines` |
| **نتیجه** | کالا برگشت به انبار، سند معکوس ثبت شد، بازپرداخت انجام شد |

### مرحله ۴: PDF فاکتور مرجوعی

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت — لینک دانلود PDF |
| **نقش** | مدیر |
| **ورودی** | returnId |
| **مبدأ** | `GET /admin/returns/{id}/pdf` |
| **→ کنترلر** | `admin-returns.controller.ts` → `returnPdf()` |
| **→ PDF** | `renderInvoicePdf()` — عنوان: «سند مرجوعی — بازپرداخت» |
| **خروجی** | فایل PDF |
| **نتیجه** | فاکتور مرجوعی قابل چاپ و بایگانی |

---

# فلوچارت ۲: فروش آنلاین — همکار (عمده‌فروشی)

> همه مراحل مانند مشتری عادی است، با این تفاوت‌ها:

---

## ۲.۱ نمایش قیمت همکاری

| فیلد | مقدار |
|------|-------|
| **صفحه** | همه صفحات فروشگاه (جستجو، دسته‌بندی، محصول) |
| **نقش** | همکار (وارد شده با `is_partner: true`) |
| **چگونه** | سیستم از توکن تشخیص می‌دهد → `isPartner: true` می‌فرستد |
| **ورودی** | توکن احراز هویت → `SELECT is_partner FROM customers WHERE user_id = $1` |
| **خروجی** | قیمت‌های متفاوت |
| **مبدأ** | `catalog.controller.ts` → `search()` و `list()` |
| **→ SQL** | `COALESCE(v.partner_price_rial, v.price_rial)` به جای `v.price_rial` |
| **→ منطق** | اگر `partner_price_rial` تنظیم شده → همان، وگرنه اگر `partner_price_percent` → درصدی از قیمت، وگرنه قیمت عادی |
| **→ تخفیف** | فقط اگر `discount_on_partner` فعال باشد |
| **نتیجه** | همکار قیمت ویژه می‌بیند |

---

## ۲.۲ بررسی سقف اعتبار در checkout

| فیلد | مقدار |
|------|-------|
| **صفحه** | `/checkout` — هنگام ثبت سفارش |
| **نقش** | همکار |
| **چگونه** | قبل از ثبت سفارش، سیستم بدهی معوق را با سقف اعتبار مقایسه می‌کند |
| **ورودی** | customerId (از نشست), credit_rial (از DB), total unpaid orders |
| **خروجی** | اجازه یا رد سفارش |
| **مبدأ** | `cart.controller.ts` → `checkout()` |
| **→ منطق** | `SELECT SUM(total_rial) FROM orders WHERE customer_id = $1 AND status NOT IN ('paid','delivered','cancelled','refunded')` |
| | اگر `unpaid >= credit_rial` → خطا: «سقف اعتبار پر شده» |
| **نتیجه** | همکار بدهکار نمی‌تواند سفارش جدید ثبت کند |

---

# فلوچارت ۳: فروش حضوری (POS)

---

## ۳.۱ گشایش شیفت

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت `/admin/pos` |
| **نقش** | فروشنده (`salesperson`) |
| **چگونه** | انتخاب انبار + وارد کردن موجودی اولیه صندوق + کلیک «گشایش» |
| **ورودی** | warehouseId, openingCashRial |
| **خروجی** | shiftId |
| **مبدأ** | `POST /pos/shifts/open` |
| **→ کنترلر** | `pos.controller.ts` → `open()` |
| **→ سرویس** | `PosService.openShift()` — بررسی شیفت باز قبلی |
| **→ پایگاه** | `pos_shifts` — status: 'open', opened_by, opening_cash_rial |
| **نتیجه** | شیفت باز شد، فروشنده می‌تواند بفروشد |

---

## ۳.۲ فروش + پرداخت فوری

| فیلد | مقدار |
|------|-------|
| **صفحه** | `/admin/pos` — فرم فروش |
| **نقش** | فروشنده |
| **چگونه** | انتخاب کالا + تعداد + مشتری (اختیاری) + روش پرداخت + کلیک «ثبت فروش» |
| **ورودی** | shiftId, items[{variantId, quantity}], paymentMethod, customerMobile, customerName |
| **خروجی** | orderId, orderNo, totalRial, status: 'paid' |
| **مبدأ** | `POST /pos/shifts/{id}/sell` |
| **→ UI** | `PosTerminal` → `posSellAction()` در `admin-actions.ts` |
| **→ کنترلر** | `pos.controller.ts` → `sell()` |
| **→ مراحل** | ۱. resolve customerId از customerMobile |
| | ۲. `PosService.sell()` → `OrderService.createOrder()` (channel: 'pos') |
| | ۳. اتصال سفارش به شیفت |
| | ۴. `confirmPayment()` فوری: |
| |    - خروج کالا از انبار |
| |    - سند حسابداری خودکار: |
| |      نقد → بدهکار صندوق (1100) |
| |      کارت/کارت‌به‌کارت → بدهکار بانک (1200) |
| |      چک → بدهکار اسناد دریافتنی (1400) |
| |      بستانکار درآمد فروش (4000) + ارزش افزوده (2100) + بهای تمام‌شده (5000) |
| | ۵. پیامک `order_paid` + `order_confirmed` |
| **→ پایگاه** | `orders`, `order_items`, `payments`, `journal_entries`, `journal_lines`, `stock_items`, `stock_movements`, `sms_outbox` |
| **→ مقصد** | UI: پیام موفقیت + دکمه «چاپ فاکتور» |
| **نتیجه** | فروش ثبت شد، پول دریافت شد، سند حسابداری ثبت شد، فاکتور قابل چاپ |

---

## ۳.۳ چاپ فاکتور POS

| فیلد | مقدار |
|------|-------|
| **صفحه** | `/admin/pos` — بعد از فروش، دکمه «🖨️ چاپ فاکتور» |
| **نقش** | فروشنده |
| **چگونه** | کلیک روی دکمه → باز شدن PDF در تب جدید → چاپ |
| **ورودی** | orderId (از پاسخ فروش) |
| **خروجی** | فایل PDF |
| **مبدأ** | `GET /admin/exports/orders/{id}/invoice.pdf` |
| **→ کنترلر** | `admin-export.controller.ts` → `orderInvoice()` |
| **→ PDF** | `renderInvoicePdf()` — شامل: شماره سفارش، تاریخ، ردیف‌ها، جمع، مالیات، مبلغ به حروف |
| **نتیجه** | فاکتور چاپ شد و به مشتری تحویل داده شد |

---

## ۳.۴ بستن شیفت

| فیلد | مقدار |
|------|-------|
| **صفحه** | `/admin/pos` — فرم بستن شیفت |
| **نقش** | فروشنده |
| **چگونه** | شمارش نقد صندوق + وارد کردن مبلغ + کلیک «بستن شیفت» |
| **ورودی** | shiftId, countedCashRial, note |
| **خروجی** | expectedCashRial, countedCashRial, differenceRial, salesCount, salesTotalRial |
| **مبدأ** | `POST /pos/shifts/{id}/close` |
| **→ سرویس** | `PosService.closeShift()` |
| **→ محاسبه** | expected = opening + cash_sales + net_movements |
| | difference = counted - expected |
| **→ پایگاه** | `pos_shifts` → status: 'closed', closing_cash_rial, expected_cash_rial, difference_rial |
| **نتیجه** | شیفت بسته شد، مغایرت ثبت شد |

---

# فلوچارت ۴: تأمین کالا

---

## ۴.۱ تعریف محصول

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت `/admin/products` → فرم ایجاد محصول |
| **نقش** | مدیر (`super_admin` یا `branch_manager`) |
| **چگونه** | پر کردن فرم + آپلود تصاویر + تعریف تنوعات + کلیک «ذخیره» |
| **ورودی** | typeKey, brandSlug, title, description, attributes, images[], variants[{sku, priceRial, attributes, compatibleModelIds}] |
| **خروجی** | productId + slug |
| **مبدأ** | `POST /catalog/products` |
| **→ کنترلر** | `catalog.controller.ts` → `create()` |
| **→ سرویس** | `CatalogService.createProduct()` — تولید slug + search_key + ثبت قیمت |
| **→ پایگاه** | `products`, `product_variants`, `product_images`, `product_specs`, `product_compatibility` |
| **→ قیمت** | ثبت `price_rial` روی هر تنوع + `recordPriceChange()` |
| **نتیجه** | محصول تعریف شد و در فروشگاه قابل مشاهده شد |

---

## ۴.۲ تعریف تأمین‌کننده

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت → تأمین‌کنندگان |
| **نقش** | مدیر |
| **ورودی** | name, phone, address, nationalId, economicCode, postalCode, settlementTerms |
| **خروجی** | supplierId |
| **مبدأ** | `POST /admin/procurement/suppliers` |
| **→ کنترلر** | `admin-procurement.controller.ts` |
| **→ پایگاه** | `suppliers` |
| **نتیجه** | تأمین‌کننده تعریف شد |

---

## ۴.۳ درخواست خرید

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت → درخواست خرید |
| **نقش** | مدیر یا انباردار |
| **ورودی** | supplierId, items[{variantId, quantity, unitCostRial}], note |
| **خروجی** | requestId |
| **مبدأ** | `POST /admin/procurement/requests` |
| **→ کنترلر** | `admin-procurement.controller.ts` |
| **→ پایگاه** | `purchase_requests`, `purchase_request_items` |
| **نتیجه** | درخواست خرید ثبت شد |

---

## ۴.۴ رسید خرید + ورود به انبار

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت → رسید خرید |
| **نقش** | انباردار |
| **چگونه** | دریافت فیزیکی کالا + ثبت رسید |
| **ورودی** | requestId, warehouseId, items[{variantId, quantity}] |
| **خروجی** | receiptId + موجودی آپدیت شده |
| **مبدأ** | `POST /admin/procurement/receipts` |
| **→ سرویس** | `receivePurchase()` |
| **→ مراحل** | ۱. افزایش موجودی انبار (`on_hand += quantity`) |
| | ۲. محاسبه WAC: `new_avg = (old_total + new_total) / (old_qty + new_qty)` |
| | ۳. ثبت `stock_movement` |
| | ۴. اطلاع‌رسانی به مشتریان منتظر (`StockAlertService.notifyForProduct()`) |
| **→ SMS** | `product_back` → مشتریانی که «خبرم کن» زده‌اند |
| **→ پایگاه** | `stock_items` (آپدیت WAC), `stock_movements`, `purchase_receipts`, `sms_outbox` |
| **نتیجه** | کالا وارد انبار شد، WAC آپدیت شد، مشتریان منتظر خبردار شدند |

---

## ۴.۵ فاکتور خرید + سند حسابداری

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت → فاکتور خرید |
| **نقش** | مدیر / حسابدار |
| **ورودی** | supplierId, warehouseId, invoiceNo, supplierNationalId, supplierEconomicCode, issuedAt, dueAt, items[{variantId, quantity, unitCostRial, extraCostRial, vatRial}] |
| **خروجی** | invoiceId + سند حسابداری |
| **مبدأ** | `POST /accounting/purchases` |
| **→ کنترلر** | `admin-accounting.controller.ts` → `createPurchaseInvoice()` |
| **→ سرویس** | `AccountingService.postPurchaseInvoice()` |
| **→ سند حسابداری خودکار** | |
| | بدهکار: موجودی کالا (1000) = بهای کالا |
| | بدهکار: ارزش افزوده خرید (1300) = مالیات پرداختی |
| | بستانکار: حساب پرداختنی (2000) = قابل پرداخت |
| **→ قید یکتا** | `supplier_national_id + supplier_invoice_no` — جلوگیری از تکرار |
| **→ پایگاه** | `purchase_invoices`, `purchase_invoice_items`, `journal_entries`, `journal_lines` |
| **→ PDF** | `GET /accounting/purchases/{id}/pdf` — فاکتور رسمی خرید |
| **نتیجه** | فاکتور خرید ثبت شد، سند حسابداری خودکار صادر شد، PDF قابل دانلود |

---

# فلوچارت ۵: حسابداری

---

## ۵.۱ سند دستی

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت `/admin/accounting` → ثبت سند |
| **نقش** | حسابدار (`accountant`) |
| **ورودی** | description, lines[{accountCode, debitRial, creditRial, description}] |
| **خروجی** | entryId, entryNo |
| **مبدأ** | `POST /accounting/journal` |
| **→ کنترلر** | `admin-accounting.controller.ts` → `postJournal()` |
| **→ سرویس** | `AccountingService.postJournal()` — بررسی تراز (debit = credit) |
| **→ پایگاه** | `journal_entries`, `journal_lines` |
| **نتیجه** | سند حسابداری ثبت شد |

---

## ۵.۲ برگشت سند

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت → جزئیات سند → دکمه «برگشت» |
| **نقش** | حسابدار |
| **ورودی** | entryId, reason |
| **خروجی** | سند معکوس جدید |
| **مبدأ** | `POST /accounting/journal/reverse` |
| **→ منطق** | ایجاد سند جدید با swap debit/credit + status: 'reversed' روی سند قبلی |
| **نتیجه** | سند قبلی برگشت خورد، سند معکوس ثبت شد |

---

## ۵.۳ ترازنامه آزمایشی

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت → گزارش‌ها → ترازنامه آزمایشی |
| **نقش** | حسابدار |
| **ورودی** | period (دوره مالی شمسی) |
| **خروجی** | لیست حساب‌ها با مانده بدهکار/بستانکار |
| **مبدأ** | `GET /accounting/trial-balance` |
| **→ سرویس** | `AccountingService.trialBalance()` |
| **→ منطق** | `SUM(debit_rial) - SUM(credit_rial)` برای هر حساب |
| **نتیجه** | مانده هر حساب نمایش داده شد، تراز بررسی شد |

---

# فلوچارت ۶: مالیات و مؤدیان

---

## ۶.۱ تنظیم گواهی مالیاتی

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت `/admin/tax` → تب گواهی |
| **نقش** | مدیر |
| **ورودی** | nationalId, economicCode, postalCode, personType |
| **خروجی** | certificateId |
| **مبدأ** | `POST /admin/tax/certificate` |
| **→ کنترلر** | `admin-tax.controller.ts` |
| **→ پایگاه** | `tax_certificates` |
| **نتیجه** | گواهی مالیاتی ذخیره شد |

---

## ۶.۲ ارسال صورتحساب به مؤدیان

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت `/admin/tax` → تب صورتحساب‌ها |
| **نقش** | مدیر یا خودکار (کارگر `setshop-tax.timer`) |
| **چگونه** | پس از پرداخت سفارش (اگر `moadian_auto_send` فعال) یا ارسال دستی/دسته‌ای |
| **ورودی** | orderId → اطلاعات خریدار، فروشنده، کالاها، مالیات |
| **خروجی** | وضعیت ارسال (success/pending/failed) |
| **مبدأ** | `POST /admin/tax/invoices` یا `POST /admin/tax/batch` یا خودکار |
| **→ سرویس** | `admin-tax.controller.ts` → ارسال به API مؤدیان |
| **→ کارگر** | `deploy/systemd/setshop-tax.timer` → `scripts/tax-worker.ts` — هر دور: آزادسازی + ارسال + استعلام |
| **→ پایگاه** | `tax_invoices` — status: 'sent'/'pending'/'failed' |
| **نتیجه** | صورتحساب به سامانه مؤدیان ارسال شد |

---

# فلوچارت ۷: پیامک

---

## ۷.۱ صف پیامک + ارسال

| فیلد | مقدار |
|------|-------|
| **نقش** | سیستم (خودکار) |
| **چگونه** | هر رویداد → `enqueueSms()` → `sms_outbox` → کارگر systemd → ارسال واقعی |
| **مراحل** | ۱. رویداد (مثلاً پرداخت) → `enqueueSms({phone, templateKey, vars})` |
| | ۲. `renderTemplate()` — جایگزینی متغیرها در متن قالب |
| | ۳. `INSERT INTO sms_outbox` — status: 'pending' |
| | ۴. کارگر (`setshop-postsale.timer`) → `pendingSms()` → خواندن صف |
| | ۵. `sendViaProvider()` → ارسال HTTP به کاوه‌نگار/ملی‌پیامک/فراز |
| | ۶. `markSent()` یا retry با فاصله فزاینده |
| **ارسال‌کنندگان** | `kavenegar` (با lookup)، `melipayamak` (متنی)، `farazsms` (متنی) |
| **→ پایگاه** | `sms_outbox`, `sms_templates`, `store_settings` |
| **نتیجه** | پیامک به مشتری ارسال شد |

---

# فلوچارت ۸: انبار و موجودی

---

## ۸.۱ شمارش فیزیکی انبار

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت `/admin/inventory` → شمارش |
| **نقش** | انباردار |

### مرحله ۱: ایجاد شمارش

| فیلد | مقدار |
|------|-------|
| **ورودی** | warehouseId |
| **خروجی** | countId + لیست آیتم‌ها با موجودی سیستم |
| **مبدأ** | `POST /inventory/counts` |
| **→ منطق** | عکس‌برداری از `stock_items.on_hand` → `inventory_count_items.system_qty` |
| **نتیجه** | شمارش ایجاد شد، موجودی فعلی سیستم ثبت شد |

### مرحله ۲: ثبت تعداد شمارش‌شده

| فیلد | مقدار |
|------|-------|
| **ورودی** | countId, items[{variantId, countedQty}] |
| **مبدأ** | `POST /inventory/counts/{id}/record` |
| **→ منطق** | `UPDATE inventory_count_items SET counted_qty = $1` |
| **نتیجه** | تعداد شمارش‌شده ثبت شد |

### مرحله ۳: بستن شمارش + نمایش مغایرت

| فیلد | مقدار |
|------|-------|
| **ورودی** | countId, note |
| **خروجی** | لیست مغایرت‌ها (sku, title, system_qty, counted_qty, diff_qty) |
| **مبدأ** | `POST /inventory/counts/{id}/close` |
| **→ منطق** | `diff_qty = counted_qty - system_qty` — فقط آیتم‌هایی که diff ≠ 0 |
| **نتیجه** | شمارش بسته شد، مغایرت‌ها نمایش داده شد |

---

## ۸.۲ انتقال بین انبارها

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت `/admin/inventory` → انتقال |
| **نقش** | انباردار |
| **ورودی** | fromWarehouseId, toWarehouseId, variantId, quantity |
| **خروجی** | پیام موفقیت |
| **مبدأ** | `POST /inventory/transfer` |
| **→ منطق** | اتمیک در تراکنش: |
| | ۱. بررسی موجودی مبدأ (`on_hand >= quantity`) |
| | ۲. کاهش از مبدأ (`on_hand -= quantity`) |
| | ۳. افزایش در مقصد (`on_hand += quantity`) |
| | ۴. لاگ `stock_movement` برای هر دو طرف |
| **→ پایگاه** | `stock_items` (هر دو انبار), `stock_movements` (دو رکورد) |
| **نتیجه** | موجودی منتقل شد، لاگ ثبت شد |

---

# فلوچارت ۹: مدیریت مشتریان

---

## ۹.۱ مشاهده لیست مشتریان

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت `/admin/customers` |
| **نقش** | مدیر |
| **ورودی** | فیلترها (نوع، همکار، جستجو) |
| **خروجی** | لیست مشتریان: id, fullName, phone, kind, isPartner, creditRial, checkCeilingToman, orderCount, totalSpent |
| **مبدأ** | `GET /admin/customers` |
| **→ کنترلر** | `admin-customers.controller.ts` → `list()` |
| **→ پایگاه** | `customers` + آمار از `orders` |
| **نتیجه** | مدیر لیست مشتریان را می‌بیند |

---

## ۹.۲ ثبت چک

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت → مشتری → ثبت چک |
| **نقش** | مدیر |
| **ورودی** | drawerId (مشتری), checkNo, sayadNo, bank, amountRial, dueDate |
| **خروجی** | checkId |
| **مبدأ** | `POST /admin/customers/{id}/checks` (از طریق checks API) |
| **→ سرویس** | `registerCheck()` — بررسی سقف (`checkCeiling()`) |
| **→ منطق** | ۱. شمارش چک‌های برگشتی → اگر برگشتی دارد → سقف صفر |
| | ۲. محاسبه مجموع چک‌های در گردش → بررسی سقف |
| | ۳. درج چک |
| **→ پایگاه** | `checks` — status: 'in_circulation', `check_status_logs` |
| **نتیجه** | چک ثبت شد |

---

## ۹.۳ تغییر وضعیت چک

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت → چک‌ها |
| **نقش** | مدیر |
| **ورودی** | checkId, toStatus (deposited/settled/bounced/transferred/void), reason |
| **خروجی** | وضعیت جدید |
| **مبدأ** | `changeCheckStatus()` |
| **→ منطق** | بررسی انتقال مجاز + آپدیت وضعیت + لاگ |
| **→ SMS** | اگر `bounced` → پیامک `check_bounced` به صاحب چک |
| **→ پایگاه** | `checks`, `check_status_logs`, `sms_outbox` |
| **نتیجه** | وضعیت چک تغییر کرد، پیامک برگشت ارسال شد (اگر برگشتی) |

---

# فلوچارت ۱۰: کوپن و تخفیف

---

## ۱۰.۱ ایجاد کوپن

| فیلد | مقدار |
|------|-------|
| **صفحه** | پنل مدیریت `/admin/coupons` → ایجاد |
| **نقش** | مدیر |
| **ورودی** | code, type (percent/amount), value, minSubtotalRial, maxUses, customerId, categoryId, expiresAt |
| **خروجی** | couponId |
| **مبدأ** | `POST /admin/coupons` |
| **→ کنترلر** | `admin-coupons.controller.ts` |
| **→ پایگاه** | `coupons` |
| **نتیجه** | کوپن تعریف شد |

---

## ۱۰.۲ اعتبارسنجی کوپن (هنگام checkout)

| فیلد | مقدار |
|------|-------|
| **صفحه** | `/checkout` یا `/cart` — هنگام اعمال کد تخفیف |
| **نقش** | مشتری |
| **ورودی** | couponCode, customerId, at (تاریخ فعلی) |
| **خروجی** | اطلاعات کوپن معتبر یا خطای فارسی |
| **سرویس** | `validateCoupon()` |
| **→ منطق** | ۱. کد کوپن پیدا شود |
| | ۲. فعال باشد |
| | ۳. تاریخ انقضا نگذشته باشد |
| | ۴. تعداد استفاده تمام نشده باشد |
| | ۵. مشتری مجاز باشد (اگر محدود شده) |
| | ۶. حداقل مبلغ سبد رعایت شده باشد |
| **→ محاسبه** | `applyCouponRecord()` — توزیع تخفیف بین ردیف‌ها بر اساس categoryId |
| **→ مصرف** | `redeemCoupon()` — ثبت مصرف در `coupon_redemptions` |
| **→ آزادسازی** | `releaseCoupon()` — اگر سفارش لغو شود |
| **نتیجه** | تخفیف اعمال شد یا خطای فارسی نمایش داده شد |

---

# فلوچارت ۱۱: امنیت

---

## ۱۱.۱ ورود به پنل مدیریت

| فیلد | مقدار |
|------|-------|
| **صفحه** | `/admin/login` |
| **نقش** | مدیر/کارمند |
| **ورودی** | mobile, code (OTP) |
| **خروجی** | token + redirect به پنل |
| **مبدأ** | `POST /admin/auth/otp/verify` |
| **→ منطق** | مانند ورود مشتری ولی با `admin_sessions` |
| **→ محدودیت** | ۵ تلاش + ۵ دقیقه قفل |
| **نتیجه** | ورود موفق → دسترسی بر اساس نقش |

---

## ۱۱.۲ بررسی دسترسی

| فیلد | مقدار |
|------|-------|
| **نقش** | سیستم (هر درخواست) |
| **چگونه** | توکن → `verifyAccess()` → `access.can()` → بررسی permission |
| **مثال** | `pos.sell` → فروشنده ✅، حسابدار ❌ |
| | `report.financial.view` → حسابدار ✅، فروشنده ❌ |
| | `orders.write` → مدیر ✅، انباردار ✅ |
| **نتیجه** | دسترسی اعطا یا رد شد (403) |

---

# خلاصه آمار نهایی

| فلوچارت | تعداد آیتم‌ها |
|---------|-------------|
| ۱. فروش آنلاین مشتری عادی | ۱۵ مرحله |
| ۲. فروش آنلاین همکار | ۲ تفاوت کلیدی |
| ۳. فروش حضوری POS | ۴ مرحله |
| ۴. تأمین کالا | ۵ مرحله |
| ۵. حسابداری | ۳ مرحله |
| ۶. مالیات | ۲ مرحله |
| ۷. پیامک | ۱ فرآیند |
| ۸. انبار | ۲ فرآیند (شمارش + انتقال) |
| ۹. مشتریان | ۳ مرحله |
| ۱۰. کوپن | ۲ مرحله |
| ۱۱. امنیت | ۲ مرحله |