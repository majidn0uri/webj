/**
 * نرمال‌سازیِ متن و عددِ فارسی — زیربنای جستجوی فارسی و اعتبارسنجی‌های ایرانی (بخش‌های AA و Z).
 * قانون: هرگز رشته‌ی خامِ ورودیِ کاربر را بدون عبور از این توابع جستجو یا ذخیره نکن.
 */
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ZERO_WIDTH = /[​-‍⁠﻿]/g;

export function toPersianDigits(input: string): string {
  return input
    .replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d)
    .replace(new RegExp(`[${ARABIC_DIGITS}]`, 'g'), (d) => PERSIAN_DIGITS[ARABIC_DIGITS.indexOf(d)] ?? d);
}

export function toEnglishDigits(input: string): string {
  return input
    .replace(new RegExp(`[${ARABIC_DIGITS}]`, 'g'), (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(new RegExp(`[${PERSIAN_DIGITS}]`, 'g'), (d) => String(PERSIAN_DIGITS.indexOf(d)));
}

/** نرمال‌سازیِ نمایشی: حروفِ عربی → فارسی، ارقام یکسان، حذفِ کشیده و نیم‌فاصله‌های زائد */
export function normalizePersian(input: string): string {
  return input
    .replace(/[آأإاٱ]/g, 'ا')
    .replace(/ي/g, 'ی')
    .replace(/ى/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ی')
    .replace(/ة/g, 'ه')
    .replace(TATWEEL, '')
    .replace(/[‌‍]/g, ' ') // نیم‌فاصله و پیوندِ بدون‌عرض را در نمایش به فاصله تبدیل کن
    .replace(/[\u200e\u200f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** نرمال‌سازی برای جستجو: سخت‌گیرانه‌تر از نمایش — حذفِ اعراب، یکسان‌سازیِ همزه و حذفِ فاصله‌ها */
export function normalizeForSearch(input: string): string {
  return toEnglishDigits(
    normalizePersian(input)
      .toLowerCase()
      .replace(DIACRITICS, '')
      .replace(/[ّْ]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/** کلیدِ یکتا برای جستجوی بی‌حساس‌به‌تفاوت (مانند فیلدِ tsvector در پایگاه‌داده) */
export function searchKey(input: string): string {
  return normalizeForSearch(input);
}

/** کد ملی ایران — الگوریتمِ کنترلیِ رسمی */
/**
 * کدِ ملیِ شخصِ حقیقی — ۱۰ رقم با رقمِ کنترل.
 *
 * الگوریتم: نه رقمِ نخست را در ضرایبِ ۱۰ تا ۲ ضرب و جمع کن؛ باقیمانده بر ۱۱
 * اگر کمتر از ۲ بود باید با رقمِ کنترل برابر باشد، وگرنه باید ۱۱ منهای آن باشد.
 */
export function isValidNationalCode(input: string): boolean {
  const code = toEnglishDigits(input).replace(/\D/g, '');
  if (code.length !== 10) return false;
  if (/^(\d)\1{9}$/.test(code)) return false;
  const check = Number(code[9]);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(code[i]) * (10 - i);
  const remainder = sum % 11;
  return remainder < 2 ? check === remainder : check === 11 - remainder;
}

/**
 * شناسه‌ی ملیِ شخصِ حقوقی (شرکت/مؤسسه) — ۱۱ رقم با رقمِ کنترل.
 *
 * الگوریتمِ رسمیِ سازمانِ ثبتِ اسناد:
 *   ۱) رقمِ دهگانِ شناسه (دهمین رقم) را با ۲ جمع کن.
 *   ۲) هر یک از ۱۰ رقمِ سمتِ چپ را با این مقدار جمع و در ضریبِ خود ضرب کن.
 *      ضرایب از چپ به راست: ۲۹، ۲۷، ۲۳، ۱۹، ۱۷ و همان الگو دوباره.
 *   ۳) مجموع را بر ۱۱ تقسیم کن؛ اگر باقیمانده ۱۰ شد آن را صفر بگیر.
 *   ۴) رقمِ کنترل (رقمِ یازدهم) باید با همان باقیمانده برابر باشد.
 *
 * نمونه‌یِ آزمایشیِ مستند: ۱۰۳۸۰۲۸۴۷۹۰
 *   (۱+۱۱)×۲۹ + (۰+۱۱)×۲۷ + (۳+۱۱)×۲۳ + (۸+۱۱)×۱۹ + (۰+۱۱)×۱۷
 * + (۲+۱۱)×۲۹ + (۸+۱۱)×۲۷ + (۴+۱۱)×۲۳ + (۷+۱۱)×۱۹ + (۹+۱۱)×۱۷ = ۳۴۳۲
 *   ۳۴۳۲ ÷ ۱۱ = ۳۱۲ و باقیمانده ۰ → رقمِ کنترل باید ۰ باشد (هست).
 *
 * چرا از کدِ ملیِ حقیقی جدا است؟ چون الگوریتم و طولِ آن دو فرق می‌کنند؛ اگر
 * شرکت‌ها را با الگوریتمِ ۱۰ رقمی بسنجیم، هر شناسه‌ی درستی رد می‌شود و فروشنده
 * مجبور می‌شود کنترل را دور بزند — یعنی کنترل عملاً از بین می‌رود.
 */
export function isValidLegalNationalId(input: string): boolean {
  const code = toEnglishDigits(input).replace(/\D/g, '');
  if (code.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(code)) return false;

  const weights = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17];
  const tensPlus2 = Number(code[9]) + 2;

  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (Number(code[i]) + tensPlus2) * weights[i]!;

  let remainder = sum % 11;
  if (remainder === 10) remainder = 0;
  return remainder === Number(code[10]);
}

/**
 * هر دو نوعِ شناسه: ۱۰ رقم (شخصِ حقیقی) یا ۱۱ رقم (شخصِ حقوقی).
 * برای فیلدهایی که فروشنده نمی‌داند طرفش شرکت است یا شخص (مانندِ تأمین‌کننده).
 */
export function isValidIranianNationalId(input: string): boolean {
  const code = toEnglishDigits(input).replace(/\D/g, '');
  if (code.length === 10) return isValidNationalCode(code);
  if (code.length === 11) return isValidLegalNationalId(code);
  return false;
}

/** رقمِ کنترلِ شناسه‌ی ۱۱ رقمی — برای ساختنِ داده‌ی آزمایشی و نمونه */
export function legalNationalIdControlDigit(first10: string): string {
  const code = toEnglishDigits(first10).replace(/\D/g, '');
  if (code.length !== 10) throw new Error('ده رقم لازم است');
  const weights = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17];
  const tensPlus2 = Number(code[9]) + 2;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (Number(code[i]) + tensPlus2) * weights[i]!;
  const remainder = sum % 11;
  return String(remainder === 10 ? 0 : remainder);
}

/** شِبای ایران — باید با IR شروع شود و الگوریتمِ mod-97 یک بدهد */
export function isValidSheba(input: string): boolean {
  const s = toEnglishDigits(input).replace(/[\s-]/g, '').toUpperCase();
  if (!/^IR\d{24}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const chunk of numeric.match(/\d{1,7}/g) ?? []) {
    remainder = Number(String(remainder) + chunk) % 97;
  }
  return remainder === 1;
}

/** شماره موبایل ایران: ۰۹xxxxxxxxx */
export function isValidMobile(input: string): boolean {
  const m = toEnglishDigits(input).replace(/[\s-]/g, '');
  return /^(\+98|0098|0)?9\d{9}$/.test(m);
}

export function normalizeMobile(input: string): string {
  const m = toEnglishDigits(input).replace(/[\s-]/g, '');
  return '0' + m.replace(/^(\+98|0098|0)/, '');
}

/** کد پستی ایران: ۱۰ رقم، بدون صفرِ پیشتازِ معنادار و بدون ارقامِ تکراریِ کامل */
export function isValidPostalCode(input: string): boolean {
  const p = toEnglishDigits(input).replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(p)) return false;
  if (/^(\d)\1{9}$/.test(p)) return false;
  return !p.startsWith('00');
}

/** شناسه/کد اقتصادی (ده تا چهارده رقم) — فقط بررسیِ ساختار، استعلام با مراجعِ رسمی */
export function looksLikeEconomicCode(input: string): boolean {
  const e = toEnglishDigits(input).replace(/\D/g, '');
  return e.length >= 10 && e.length <= 14;
}
