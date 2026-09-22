/**
 * تاریخِ شمسی — همه‌چیز در پایگاه‌داده UTC و میلادی ذخیره می‌شود؛
 * تبدیل به شمسی فقط در لایه‌ی نمایش و گزارش انجام می‌شود (بخش Q-3).
 */
import { format, parse, getDate, getMonth, getYear, startOfMonth, endOfMonth, addDays, startOfDay, addMonths, getDaysInMonth, getDay } from 'date-fns-jalali';
import { toPersianDigits, toEnglishDigits } from './persian.js';

export type JalaliParts = { year: number; month: number; day: number };

/** قالب‌بندیِ شمسی؛ الگوها همان الگوهای date-fns هستند (yyyy/MM/dd و …) */
export function formatJalali(date: Date, pattern = 'yyyy/MM/dd', persianDigits = true): string {
  const out = format(date, pattern);
  return persianDigits ? toPersianDigits(out) : out;
}

/**
 * تبدیلِ هرچه پایگاه برگردانده (‏`Date`‎ یا رشته) به رشته‌یِ ‎`YYYY-MM-DD`‎.
 *
 * چرا لازم است؟ چون ستون‌هایِ ‎`date`‎ در پایگاه به‌صورتِ شیءِ ‎`Date`‎
 * می‌آیند. اگر کسی نداند و بخواهد با الحاقِ ‎`T00:00:00Z`‎ از آن رشته بسازد،
 * حاصل «تاریخِ نامعتبر» است و خطا جایی دورتر — در قالب‌بندیِ شمسی — رخ
 * می‌دهد. یک نگاشتِ درست در مرز، جلویِ این ردیابیِ شبانه را می‌گیرد.
 */
export function toIsoDate(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/**
 * تاریخِ شمسیِ یک ستونِ تاریخ — هرچه از پایگاه آمده باشد.
 *
 * نیمه‌شبِ UTC انتخاب شده تا جابه‌جاییِ منطقه‌یِ زمانی نتیجه را یک روز عقب یا
 * جلو نبرد (ایران نیم‌روز از UTC جلوتر است).
 */
export function jalaliDateOf(value: Date | string | null | undefined): string | null {
  const iso = toIsoDate(value);
  return iso ? formatJalali(new Date(`${iso}T00:00:00Z`)) : null;
}

/**
 * خواندنِ تاریخِ شمسی از رشته (مثلِ «۱۴۰۵/۰۶/۲۰») → شیءِ Date (میلادیِ UTC).
 *
 * چرا لازم است؟ چون کاربرِ ایرانی تاریخ را شمسی می‌نویسد، اما پایگاه‌داده
 * میلادی می‌خواهد. تبدیل باید در یک‌جا و با یک الگو انجام شود تا فرم‌های
 * مختلف هر کدام سازِ خود را نزنند. مقدارِ نامعتبر → null (نه یک تاریخِ غلط).
 */
export function parseJalali(input: string, pattern = 'yyyy/MM/dd'): Date | null {
  // کاربر با صفحه‌کلیدِ فارسی می‌نویسد؛ ارقام باید پیش از تجزیه لاتین شوند
  const cleaned = toEnglishDigits(String(input)).trim();
  if (!/^[\d\/\-\s]+$/.test(cleaned)) return null;
  const parsed = parse(cleaned, pattern, new Date());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function jalaliParts(date: Date): JalaliParts {
  return { year: getYear(date), month: getMonth(date) + 1, day: getDate(date) };
}

/** تاریخِ امروزِ شمسی به‌صورت رشته (برای نمایش در فرم‌ها و گزارش‌ها) */
export function jalaliToday(pattern = 'yyyy/MM/dd', persianDigits = true): string {
  return formatJalali(new Date(), pattern, persianDigits);
}

/** شروعِ روزِ شمسی به‌وقتِ UTC — برای گروه‌بندیِ گزارش‌های روزانه */
export function startOfJalaliDay(date: Date): Date {
  return startOfDay(date);
}

export function startOfJalaliMonth(date: Date): Date {
  return startOfMonth(date);
}

export function endOfJalaliMonth(date: Date): Date {
  return endOfMonth(date);
}

export function addJalaliDays(date: Date, days: number): Date {
  return addDays(date, days);
}

/** نمایشِ انسانی برای فاکتور: «۲۳ شهریور ۱۴۰۵، ساعت ۱۴:۳۰» */
export function formatJalaliLong(date: Date): string {
  return toPersianDigits(format(date, 'd MMMM yyyy، ساعت HH:mm'));
}

export { getYear, getMonth as jalaliMonthGetMonth };
/** شماره‌ی ماهِ شمسی (۱ تا ۱۲) — برای دوره‌های مالی */
export function jalaliMonth(date: Date): number {
  return getMonth(date) + 1;
}

/* ── ابزارهایِ تقویمِ شمسی (برایِ انتخابگرِ تاریخ) ──────────────────────── */

/** نامِ ماه‌هایِ شمسی (۱ تا ۱۲) */
export const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const;

/** روزهایِ هفته از شنبه (۰ تا ۶) — همان ترتیبِ تقویمِ ایرانی */
export const JALALI_WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'] as const;

/**
 * ساختِ شیءِ Date از اجزایِ شمسی (ماه ۱ تا ۱۲).
 *
 * چرا `new Date()` نیست؟ چون سازنده‌ی Date همیشه میلادی می‌داند؛
 * تنها راهِ قابلِ اعتماد برای ساختِ تاریخِ شمسی همین `parse` است.
 */
export function makeJalaliDate(year: number, month: number, day: number): Date | null {
  const parsed = parse(
    `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`,
    'yyyy/MM/dd',
    new Date(),
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** افزودنِ ماه به تاریخِ شمسی */
export function addJalaliMonths(date: Date, months: number): Date {
  return addMonths(date, months);
}

/** تعدادِ روزهایِ ماهِ شمسیِ تاریخِ داده‌شده (اسفندِ کبیسه ۳۰ است) */
export function jalaliDaysInMonth(date: Date): number {
  return getDaysInMonth(date);
}

/** روزِ هفته از دیدِ تقویمِ ایرانی: ۰=شنبه … ۶=جمعه */
export function jalaliWeekday(date: Date): number {
  return (getDay(date) + 1) % 7;
}
