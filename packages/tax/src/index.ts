/**
 * بسته‌یِ مالیات — ارزش‌افزوده و سامانه‌یِ مؤدیان.
 *
 * ترتیبِ طبیعیِ استفاده:
 *   ۱) `createInvoiceForOrder` هنگامی که سفارش پرداخت شد (صورتحساب ساخته و در
 *      صف گذاشته می‌شود، بدونِ هیچ ارتباطِ شبکه‌ای).
 *   ۲) `sendDueBatch` در یک کارِ پس‌زمینه (هر چند دقیقه) صورتحساب‌هایِ صف را
 *      می‌فرستد و وضعیت را به «فرستاده‌شده» می‌برد.
 *   ۳) `inquirePending` وضعیتِ قطعی را از سازمان می‌پرسد و «تأییدشده» می‌کند.
 *   ۴) `vatReturn` اظهارنامه‌یِ دوره را می‌سازد و هشدارهایش را می‌گوید.
 */

export * from './moadian.js';
export * from './queue.js';
export * from './client.js';
export * from './vat.js';
export * from './submission.js';
export * from './credit.js';
export * from './vault.js';
export * from './credentials.js';
