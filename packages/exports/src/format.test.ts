/**
 * آزمونِ قالب‌بندی: عدد، پول، تاریخ، و حروف.
 *
 * مبلغ به حروف یک «تزیین» نیست: در یک صورتحساب، راهِ اصلیِ جلوگیری از
 * دست‌کاریِ رقم است. پس درستی‌اش به اندازه‌یِ درستیِ خودِ عدد اهمیت دارد و
 * اینجا آزمون می‌شود.
 */

import { describe, expect, it } from 'vitest';
import { formatJalali } from '@set/shared-kernel';
import {
  formatCell,
  groupDigits,
  jalaliOf,
  numberToPersianWords,
  numericValue,
  tomanDisplay,
} from './format.js';

describe('عدد و مبلغ', () => {
  it('هزارگان را با جداکننده‌یِ فارسی و ارقامِ فارسی می‌نویسد', () => {
    expect(groupDigits(1250000)).toBe('۱٬۲۵۰٬۰۰۰');
    expect(groupDigits(0)).toBe('۰');
    expect(groupDigits(-45000)).toBe('−۴۵٬۰۰۰');
    expect(groupDigits(1234567n)).toBe('۱٬۲۳۴٬۵۶۷');
  });

  it('مبلغ را به تومان نشان می‌دهد (ده ریال یک تومان)', () => {
    expect(tomanDisplay(125000)).toBe('۱۲٬۵۰۰');
    expect(tomanDisplay(0)).toBe('۰');
  });

  it('مقدارِ عددی را از هر نوعی بیرون می‌کشد', () => {
    expect(numericValue(1250)).toBe(1250);
    expect(numericValue(1250n)).toBe(1250);
    expect(numericValue('1,250')).toBe(1250);
    expect(numericValue('۱٬۲۵۰')).toBe(1250);
    expect(numericValue(null)).toBeNull();
    expect(numericValue('')).toBeNull();
    expect(numericValue('abc')).toBeNull();
  });

  it('سلول را بر پایه‌یِ نوع قالب می‌دهد', () => {
    expect(formatCell(1250000, 'money')).toBe('۱٬۲۵۰٬۰۰۰');
    expect(formatCell(9, 'percent')).toBe('۹٪');
    expect(formatCell(24, 'number')).toBe('۲۴');
    expect(formatCell(true, 'boolean')).toBe('بله');
    expect(formatCell(false, 'boolean')).toBe('خیر');
    expect(formatCell(null, 'text')).toBe('—');
  });
});

describe('مبلغ به حروف', () => {
  it('مرزها را درست می‌نویسد', () => {
    expect(numberToPersianWords(0)).toBe('صفر');
    expect(numberToPersianWords(1)).toBe('یک');
    expect(numberToPersianWords(10)).toBe('ده');
    expect(numberToPersianWords(11)).toBe('یازده');
    expect(numberToPersianWords(20)).toBe('بیست');
    expect(numberToPersianWords(35)).toBe('سی و پنج');
    expect(numberToPersianWords(100)).toBe('یکصد');
    expect(numberToPersianWords(125)).toBe('یکصد و بیست و پنج');
  });

  it('هزار و میلیون را با «و» درست می‌چیند', () => {
    expect(numberToPersianWords(1000)).toBe('یک هزار');
    expect(numberToPersianWords(2001)).toBe('دو هزار و یک');
    expect(numberToPersianWords(125000)).toBe('یکصد و بیست و پنج هزار');
    expect(numberToPersianWords(7672692)).toBe('هفت میلیون و ششصد و هفتاد و دو هزار و ششصد و نود و دو');
  });

  it('مبلغِ منفی را با «منفی» می‌نویسد', () => {
    expect(numberToPersianWords(-125)).toBe('منفی یکصد و بیست و پنج');
  });
});

describe('تاریخ', () => {
  it('تاریخ را شمسی نمایش می‌دهد', () => {
    const iso = '2026-09-17T00:00:00.000Z';
    // ۱۴۰۵/۰۶/۲۶ برابر است با ۱۷ سپتامبر ۲۰۲۶
    expect(jalaliOf(iso, false)).toBe('۱۴۰۵/۰۶/۲۶');
    expect(formatJalali(new Date(iso), 'yyyy/MM/dd')).toBe('۱۴۰۵/۰۶/۲۶');
    expect(jalaliOf(iso, true)).toMatch(/^۱۴۰۵\/۰۶\/۲۶ [۰-۹]{2}:[۰-۹]{2}$/);
  });

  it('تاریخِ نامعتبر را «—» می‌نویسد، نه «Invalid Date»', () => {
    expect(jalaliOf('not-a-date')).toBe('—');
    expect(jalaliOf(null)).toBe('—');
  });
});
