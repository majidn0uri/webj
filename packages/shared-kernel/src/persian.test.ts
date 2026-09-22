import { describe, it, expect } from 'vitest';
import {
  normalizeForSearch, normalizePersian, toPersianDigits, toEnglishDigits,
  isValidNationalCode, isValidSheba, isValidMobile, normalizeMobile, isValidPostalCode,
  isValidLegalNationalId, isValidIranianNationalId, legalNationalIdControlDigit,
} from './persian.js';

/** ساختِ کد ملیِ معتبر برای تست (به‌جای تکیه بر یک نمونه‌ی ثابت) */
function makeValidNationalCode(): string {
  for (let last = 0; last <= 9; last++) {
    const base = '0076228966'.slice(0, 9) + String(last);
    if (isValidNationalCode(base)) return base;
  }
  throw new Error('ساخت کد ملی ناموفق');
}

/** ساختِ شبای معتبر برای تست */
function makeValidSheba(): string {
  const body = '540105180021273113007'; // ۲۱ رقم
  const digits22 = body + '0';
  for (let cd = 1; cd < 99; cd++) {
    const candidate = 'IR' + String(cd).padStart(2, '0') + digits22;
    if (candidate.length === 26 && isValidSheba(candidate)) return candidate;
  }
  throw new Error('ساخت شبا ناموفق');
}

describe('نرمال‌سازیِ متنِ فارسی', () => {
  it('حروفِ عربی به فارسی تبدیل می‌شوند', () => {
    expect(normalizePersian('علي كريمي')).toBe('علی کریمی');
    expect(normalizePersian('موبايل')).toBe('موبایل');
  });

  it('ارقام و نویسه‌های زائد برای جستجو یکسان می‌شوند', () => {
    expect(toPersianDigits('1404')).toBe('۱۴۰۴');
    expect(toEnglishDigits('۱۴۰۴')).toBe('1404');
    const s = normalizeForSearch('کابل  شارژ آیفون ۱۳   پرو');
    // نرمال‌ساز «آ» را به «ا» می‌برد تا جستجوی «آیفون/ایفون» یکسان باشد
    expect(s).toBe('کابل شارژ ایفون 13 پرو');
    expect(s).toContain('13');
  });

  it('جستجو به تفاوتِ عربی/فارسی و اعراب حساس نیست', () => {
    expect(normalizeForSearch('قَابِ سیلیکونی')).toBe(normalizeForSearch('قاب سيليكوني'));
  });
});

describe('اعتبارسنجی‌های ایرانی (بخش AA)', () => {
  it('کد ملی: الگوریتمِ کنترلی درست کار می‌کند', () => {
    const valid = makeValidNationalCode();
    expect(isValidNationalCode(valid)).toBe(true);
    const broken = valid.slice(0, 9) + ((Number(valid[9]) + 1) % 10);
    expect(isValidNationalCode(broken)).toBe(false);
    expect(isValidNationalCode('1111111111')).toBe(false);
    expect(isValidNationalCode('12345')).toBe(false);
  });

  it('شبا: فقط شمای IR با mod-97 معتبر پذیرفته می‌شود', () => {
    const valid = makeValidSheba();
    expect(isValidSheba(valid)).toBe(true);
    expect(isValidSheba('IR00' + valid.slice(4))).toBe(false);
    expect(isValidSheba('TR320010009999901234567890')).toBe(false);
  });

  it('موبایل: قالب‌های مختلف پذیرفته و یکسان می‌شوند', () => {
    expect(isValidMobile('09123456789')).toBe(true);
    expect(isValidMobile('+989123456789')).toBe(true);
    expect(isValidMobile('00989123456789')).toBe(true);
    expect(isValidMobile('9123456789')).toBe(true);
    expect(isValidMobile('08123456789')).toBe(false);
    expect(normalizeMobile('+989123456789')).toBe('09123456789');
  });

  it('کد پستی: ۱۰ رقم و غیرتکراری', () => {
    expect(isValidPostalCode('1234567890')).toBe(true);
    expect(isValidPostalCode('۱۲۳۴۵۶۷۸۹۰')).toBe(true);
    expect(isValidPostalCode('1111111111')).toBe(false);
    expect(isValidPostalCode('12345')).toBe(false);
  });
});

describe('شناسه‌ی ملیِ حقوقی (۱۱ رقم)', () => {
  it('نمونه‌ی مستندشده معتبر است', () => {
    // ۱۰۳۸۰۲۸۴۷۹۰ — همان مثالِ آزمایشیِ الگوریتم: مجموع ۳۴۳۲ و باقیمانده ۰
    expect(isValidLegalNationalId('10380284790')).toBe(true);
    expect(isValidLegalNationalId('۱۰۳۸۰۲۸۴۷۹۰')).toBe(true); // ارقامِ فارسی هم پذیرفته شود
  });

  it('تغییرِ رقمِ کنترل رد می‌شود', () => {
    expect(isValidLegalNationalId('10380284791')).toBe(false);
    expect(isValidLegalNationalId('10380284799')).toBe(false);
  });

  it('طولِ اشتباه و کدهایِ تکراری رد می‌شوند', () => {
    expect(isValidLegalNationalId('1038028479')).toBe(false);   // ۱۰ رقم
    expect(isValidLegalNationalId('103802847901')).toBe(false);  // ۱۲ رقم
    expect(isValidLegalNationalId('11111111111')).toBe(false);
  });

  it('تابعِ ترکیبی هر دو نوع را می‌پذیرد', () => {
    expect(isValidIranianNationalId(makeValidNationalCode())).toBe(true);
    expect(isValidIranianNationalId('10380284790')).toBe(true);
    expect(isValidIranianNationalId('12345')).toBe(false);
  });

  it('رقمِ کنترلِ ساخته‌شده با الگوریتم سازگار است', () => {
    const base = '1086000000';
    const full = base + legalNationalIdControlDigit(base);
    expect(isValidLegalNationalId(full)).toBe(true);
  });
});
