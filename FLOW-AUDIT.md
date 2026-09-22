# بازبینی فلوچارت جریان کار فروشگاه ست‌شاپ

## خلاصه وضعیت

| جریان | وضعیت | توضیح |
|-------|--------|-------|
| مرور کالا | ✅ سالم | صفحه اول، جستجو، دسته‌بندی، مقایسه |
| صفحه کالا | ✅ سالم | گالری، تنوعات، افزودن به سبد، نظرات، علاقه‌مندی |
| سبد خرید | ✅ اصلاح شد | CartBadge، شمارنده، هشدارها |
| تسویه و پرداخت | ✅ اصلاح شد | clearCartId بعد از startPayment، پیام خطا |
| حساب کاربری | ✅ سالم | OTP، سفارش‌ها، نشانی‌ها، علاقه‌مندی‌ها |
| پنل مدیریت | ✅ سالم | middleware، token refresh، ۲۵ صفحه |

---

## اصلاحات انجام شده

### 🔴 مشکل بحرانی ۱: clearCartId قبل از startPayment

**قبل:**
```
checkout() → clearCartId() → startPayment() → redirect()
```

**بعد:**
```
checkout() → startPayment() → clearCartId() → redirect()
```

**تأثیر:** اگر startPayment شکست بخورد، سبد هنوز موجود است و مشتری می‌تواند دوباره تلاش کند.

### 🔴 مشکل بحرانی ۲: CartBadge و /api/cart

**قبل:** CartBadge به `/api/cart` درخواست می‌زد ولی API فقط `GET /cart/:id` داشت → 404

**بعد:** مسیر `/api/cart/route.ts` ساخته شد که cartId را از کوکی می‌خواند و سبد را از API برمی‌گرداند.

### ⚠️ مشکل ۳: عدم پرداخت مجدد

**قبل:** اگر startPayment شکست می‌خورد، کاربر فقط orderNo می‌دید بدون هیچ پیام خطایی.

**بعد:** CheckoutForm پیام خطا + شماره سفارش + لینک به سفارش‌ها نشان می‌دهد.

### ⚠️ مشکل ۴: دکمه علاقه‌مندی روی کارت

**قبل:** هیچ دکمه‌ی علاقه‌مندی روی کارت کالا نبود.

**بعد:** دکمه ♡ روی هر کارت کالا اضافه شد (با WishlistButton component).

---

## فلوچارت کامل جریان‌ها

### ۱. جریان مرور و کشف کالا ✅

```
صفحه‌ی اول (/)
├── بنرهای تبلیغاتی (HeroBanners) ── از پنل مدیریت
├── انتخاب گوشی (DevicePicker) ──→ /device/{id}
├── نوار اعتماد (Trust) ── ۴ وعده
├── پرفروش‌ها (Trending) ── sort=trending
├── تخفیف‌دارها (Deals) ── discounted=1
├── برندها ──→ /search?brand={slug}
├── همه‌ی کالاها ── grid-p
└── دسته‌بندی گوشی‌ها ──→ /device/{id}

جستجو (/search?q=)
├── SearchSuggest (autocomplete در هدر)
├── فیلتر: برند، نوع، رنگ، قیمت، موجودی، گوشی
└── نتیجه ──→ ProductCard

دسته‌بندی (/c/{slug})
├── زیردسته‌ها
└── فهرست کالاها ──→ ProductCard

مقایسه (/compare?slugs=a,b,c)
├── جدول مشخصات
└── قیمت و موجودی
```

### ۲. جریان صفحه‌ی کالا ✅

```
/products/{slug}
├── نان (Breadcrumb) ──→ خانه > نوع > نام کالا
├── گالری تصاویر (ImageLightbox)
├── عنوان + برند + قیمت
├── انتخاب رنگ/تنوع (ColourSwatches)
├── تعداد + دکمه‌ی افزودن به سبد (AddToCartBox)
│     ├── انتخاب تنوع
│     ├── انتخاب تعداد (محدود به موجودی)
│     └── addToCart() server action
├── «خبرم کن» برای تنوعات ناموجود (StockAlertButton)
├── تاریخچه قیمت
├── تب‌ها: توضیحات / مشخصات / سازگاری / نظرات / پرسش و پاسخ
├── کالاهای هم‌خانواده
└── دیده‌شده‌های اخیر (RecentlyViewed - localStorage)
```

### ۳. جریان سبد خرید ✅ اصلاح شد

```
افزودن به سبد (AddToCartBox)
│
▼
addToCart() server action
├── ensureCart() ──→ POST /cart → cartId جدید
├── ذخیره cartId در کوکی HttpOnly (30 روز)
├── POST /cart/{cartId}/items {variantId, quantity}
└── revalidatePath('/cart')

شمارنده‌ی سبد (CartBadge - سمت کاربر)
├── fetch('/api/cart') ──→ /api/cart/route.ts ──→ API_ORIGIN/cart/{cartId}
└── نمایش عدد روی آیکون سبد

صفحه‌ی سبد (/cart)
├── فهرست کالاها با قیمت فعلی
├── هشدار تغییر قیمت (priceChanged)
├── هشدار کمبود موجودی (enoughStock)
├── محاسبه مالیات (vatPercent از تنظیمات پنل)
├── کد تخفیف (CouponBox)
└── فرم تسویه (CheckoutForm)
```

### ۴. جریان تسویه و پرداخت ✅ اصلاح شد

```
checkout() server action
├── اعتبارسنجی: نام، موبایل (09xxxxxxxxx)، نشانی
├── POST /cart/{cartId}/checkout
│     └── {idempotencyKey, customerName, customerMobile, shippingAddress, couponCode}
├── POST /payments/start {orderId, gateway}
│     └── {paymentId, authority, redirectUrl}
├── ✅ clearCartId() ──→ فقط بعد از موفقیت startPayment
└── redirect(redirectUrl) ──→ درگاه بانک

اگر startPayment شکست بخورد:
├── سبد هنوز موجود است ← مشتری می‌تواند دوباره تلاش کند
├── پیام خطا نمایش داده می‌شود
└── شماره سفارش + لینک به سفارش‌ها

درگاه آزمایشی (/pay/sandbox/{authority})
├── نمایش مبلغ و شماره سفارش
├── دکمه «پرداخت موفق» ──→ POST /api/payments/sandbox/{authority}/decision {paid}
├── دکمه «انصراف» ──→ {cancelled}
└── دکمه «خطا» ──→ {failed}

نتیجه‌ی پرداخت (/pay/result)
├── موفق: شماره پیگیری، مبلغ، وضعیت
├── ناموفق: پیام خطا + لینک تلاش مجدد
└── انصراف: توضیح + لینک بازگشت
```

### ۵. جریان حساب کاربری ✅

```
ورود (OTP):
├── وارد کردن شماره موبایل
├── POST /shop/auth/otp/request {mobile, purpose:'register'}
├── دریافت کد (پیامک)
├── وارد کردن کد
├── POST /shop/auth/otp/verify {mobile, code, purpose:'register'}
└── ذخیره توکن در کوکی HttpOnly (30 روز)

پیشخوان (/account):
├── سلام + نام کاربر
├── کارت سفارش‌ها (تعداد)
├── کارت نشانی‌ها (تعداد)
└── کارت علاقه‌مندی‌ها (تعداد)

سفارش‌ها (/account/orders):
├── فهرست سفارش‌ها با وضعیت و مبلغ
└── جزئیات سفارش (/account/orders/{orderNo}):
      ├── رهگیری (timeline)
      ├── فهرست کالاها
      ├── مبلغ، تخفیف، مالیات، ارسال
      └── نشانی ارسال

نشانی‌ها (/account/addresses):
├── فهرست نشانی‌ها
├── افزودن/ویرایش نشانی
└── حذف نشانی

علاقه‌مندی‌ها (/account/wishlist):
├── فهرست کالاهای نشان‌شده
└── حذف از علاقه‌مندی‌ها
```

### ۶. جریان پنل مدیریت ✅

```
ورود (/admin/login):
├── شماره تلفن + رمز عبور
└── POST /auth/login → توکن + refreshToken

Middleware (/admin/*):
├── بررسی توکن دسترسی
├── تازه‌سازی خودکار (کمتر از 2 دقیقه مانده)
├── هدایت به ورود اگر نامعتبر
└── تزریق توکن به API از طریق header

پنل (/admin):
├── داشبورد (آمار، نمودارها)
├── محصولات (CRUD + تصاویر + ویژگی‌ها)
├── سفارش‌ها (مدیریت وضعیت)
├── موجودی (پیش‌بینی + تأمین)
├── دسته‌بندی‌ها، مشتریان، نظرات، پرسش‌ها
├── کوپن‌ها، بنرها، تنظیمات، گزارش‌ها
└── ۲۵ صفحه مدیریتی
```

---

## نکات طراحی عمدی

| تصمیم | دلیل |
|-------|-------|
| تسویه بدون ورود (Guest Checkout) | کاهش اصطکاک؛ سفارش با شماره تلفن به حساب لینک می‌شود |
| هزینه ارسال در سرور محاسبه می‌شود | بستگی به نشانی و وزن دارد؛ محاسبه در مرورگر قابل دستکاری است |
| CartBadge سمت کاربر | صفحات قابل کش بمانند (reading cookie in server = dynamic) |
| RecentlyViewed در localStorage | نیاز به سرور ندارد؛ فقط برای همان دستگاه |
| OTP ورود | امن‌تر از رمز عبور؛ شماره تلفن = شناسه یکتا |

---

## Git History (مرتبط با فلوچارت)

```
48dfe4f Add wishlist button to product cards
3770bbc Fix critical checkout flow: clearCartId after startPayment, add /api/cart route
c151b7f Add error boundaries, loading states, and .env.example
5437c01 Clean globals.css: remove 161 duplicate storefront classes
83dc83e Third storefront CSS pass: complex patterns, cart/search layout classes
3315397 Second storefront CSS pass: +40 new utility classes, replace 44 more inline styles
0019d39 Complete storefront CSS overhaul: add 80+ utility classes, replace 181 inline styles
da0bc2e Complete admin CSS overhaul: replace ALL replaceable inline styles
```