import { describe, expect, it } from 'vitest';

import {
  formatJalali,
  jalaliDateOf,
  jalaliDaysInMonth,
  jalaliParts,
  jalaliToday,
  jalaliWeekday,
  makeJalaliDate,
  parseJalali,
  toIsoDate,
  addJalaliMonths,
  JALALI_MONTHS,
  JALALI_WEEKDAYS,
} from './index.js';

/**
 * تاریخِ شمسی: کاربر شمسی می‌نویسد، پایگاه‌داده میلادی نگه می‌دارد.
 * این تست‌ها همان مرز را نگه می‌دارند — جایی که بیشترین خطا رخ می‌دهد.
 */
describe('تاریخِ شمسی', () => {
  it('رشته‌ی شمسی با ارقامِ فارسی را به تاریخ تبدیل می‌کند', () => {
    const d = parseJalali('۱۴۰۵/۰۶/۲۰');
    expect(d).not.toBeNull();
    expect(formatJalali(d!)).toBe('۱۴۰۵/۰۶/۲۰');
  });

  it('ارقامِ لاتین هم پذیرفته می‌شود (صفحه‌کلیدِ انگلیسی)', () => {
    const d = parseJalali('1405/06/20');
    expect(d).not.toBeNull();
    expect(formatJalali(d!)).toBe('۱۴۰۵/۰۶/۲۰');
  });

  it('تاریخِ نامعتبر به‌جای یک تاریخِ غلط، «تهی» برمی‌گرداند', () => {
    expect(parseJalali('۱۴۰۵/۱۳/۴۰')).toBeNull();
    expect(parseJalali('فردا')).toBeNull();
    expect(parseJalali('')).toBeNull();
  });

  it('امروز را شمسی نشان می‌دهد', () => {
    expect(jalaliToday()).toMatch(/^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}$/);
  });
});

describe('تبدیلِ ستونِ تاریخ به رشته و شمسی', () => {
  it('شیءِ Date را به ISO می‌برد، نه به «تاریخِ نامعتبر»', () => {
    // همان چیزی که پایگاه برایِ ستونِ date برمی‌گرداند
    const cell = new Date('2027-07-04T00:00:00.000Z');
    expect(toIsoDate(cell)).toBe('2027-07-04');
    expect(jalaliDateOf(cell)).toMatch(/^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}$/);
  });

  it('رشته‌یِ ISO را همان‌طور می‌پذیرد', () => {
    expect(toIsoDate('2027-07-04')).toBe('2027-07-04');
    expect(toIsoDate('2027-07-04T12:34:56Z')).toBe('2027-07-04');
  });

  it('تهی را تهی برمی‌گرداند (ستونِ بی‌مقدار)', () => {
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
    expect(jalaliDateOf(null)).toBeNull();
  });
});

describe('آل‌های تقویمِ شمسی (برایِ انتخابگرِ تاریخ)', () => {
  it('makeJalaliDate + jalaliParts یک‌سفرِ رفت‌وبرگشتِ درست‌اند', () => {
    const d = makeJalaliDate(1405, 6, 20);
    expect(d).not.toBeNull();
    expect(jalaliParts(d!)).toEqual({ year: 1405, month: 6, day: 20 });
  });

  it('ماه‌های ۱ تا ۶ سی‌ونز، ۷ تا ۱۱ سی و اسفند ۲۹ روز دارند (سالِ غیرکبیسه)', () => {
    for (let m = 1; m <= 6; m++) {
      expect(jalaliDaysInMonth(makeJalaliDate(1405, m, 1)!)).toBe(31);
    }
    for (let m = 7; m <= 11; m++) {
      expect(jalaliDaysInMonth(makeJalaliDate(1405, m, 1)!)).toBe(30);
    }
    expect(jalaliDaysInMonth(makeJalaliDate(1405, 12, 1)!)).toBe(29);
  });

  it('در سالِ کبیسه (۱۴۰۳) اسفند سی روز دارد', () => {
    expect(jalaliDaysInMonth(makeJalaliDate(1403, 12, 1)!)).toBe(30);
    expect(jalaliDaysInMonth(makeJalaliDate(1408, 12, 1)!)).toBe(30);
  });

  it('روزِ نامعتبر (اسفندِ ۳۰ در سالِ غیرکبیسه) «تهی» برمی‌گرداند', () => {
    expect(makeJalaliDate(1405, 12, 30)).toBeNull();
    expect(makeJalaliDate(1405, 13, 1)).toBeNull();
  });

  it('jalaliWeekday از شنبه می‌شمارد: ۰=شنبه … ۶=جمعه', () => {
    // ۱۴۰۵/۰۶/۰۱ یکشنبه است (getDay()=0) → در تقویمِ ایرانی خانه‌ی ۱
    expect(jalaliWeekday(makeJalaliDate(1405, 6, 1)!)).toBe(1);
    expect(jalaliWeekday(makeJalaliDate(1405, 6, 2)!)).toBe(2);
    expect(jalaliWeekday(makeJalaliDate(1405, 6, 7)!)).toBe(0); // شنبه
  });

  it('addJalaliMonths مرزِ سال را درست رد می‌کند', () => {
    const esfand1 = makeJalaliDate(1405, 12, 1)!;
    expect(jalaliParts(addJalaliMonths(esfand1, 1))).toEqual({ year: 1406, month: 1, day: 1 });
    expect(jalaliParts(addJalaliMonths(esfand1, -1))).toEqual({ year: 1405, month: 11, day: 1 });
  });

  it('نامِ ماه‌ها و روزهایِ هفته ۱۲/۷ المانِ درست دارند', () => {
    expect(JALALI_MONTHS).toHaveLength(12);
    expect(JALALI_MONTHS[0]).toBe('فروردین');
    expect(JALALI_MONTHS[11]).toBe('اسفند');
    expect(JALALI_WEEKDAYS).toHaveLength(7);
    expect(JALALI_WEEKDAYS[0]).toBe('ش');
    expect(JALALI_WEEKDAYS[6]).toBe('ج');
  });
});
