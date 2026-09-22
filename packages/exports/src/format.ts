/**
 * قالب‌بندیِ سلول‌ها — یک عدد، یک نمایش.
 * ============================================================================
 *
 * اینجا تصمیم‌هایی نشسته که در ظاهر کوچک‌اند و در عمل، تفاوتِ یک خروجیِ
 * حرفه‌ای با یک خروجیِ آماتور همین‌هاست:
 *
 *   - **ارقام فارسی، نه لاتین.** صورتحسابی که «1,250,000» چاپ کند، کنارِ
 *     بقیه‌یِ متنِ فارسی غریبه می‌نماید. اما — و این مهم است — در اکسل عدد
 *     باید **عدد** بماند (لاتین و قابلِ جمع‌بستن) و تنها نمایش فارسی شود؛
 *     وگرنه حسابدار نمی‌تواند رویِ ستون جمع ببندد.
 *
 *   - **تاریخ شمسی.** هیچ تاریخِ میلادی‌ای در خروجیِ فروشگاهِ ایرانی معنا
 *     ندارد؛ مشتری باید بتواند تاریخِ فاکتور را با تقویمِ خودش بخواند.
 *
 *   - **ریال، نه تومان.** واحدِ ستون‌ها ریال است (واحدِ پایگاه‌داده و
 *     سامانه‌ی مؤدیان). تومان فقط در جمع‌بندیِ فاکتور می‌آید، آن هم با
 *     برچسبِ روشن.
 */

import { formatJalali, formatToman, toEnglishDigits } from '@set/shared-kernel';
import type { CellValue, ColumnType } from './types.js';

/** ارقام فارسی برایِ رشته‌هایی که خودمان می‌سازیم (مثلِ درصد) */
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function toPersianDigits(input: string): string {
  return input.replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

/** جداکننده‌یِ هزارگانِ فارسی + ارقام فارسی */
export function groupDigits(value: number | bigint): string {
  const text = typeof value === 'bigint' ? value.toString() : String(Math.round(value));
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  return (negative ? '−' : '') + toPersianDigits(grouped);
}

/** مقدارِ عددیِ یک سلول — برایِ جمع و برایِ اکسل */
export function numericValue(value: CellValue): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.getTime();
  // ارقامِ فارسی هم باید خوانده شود: یک فروشنده ممکن است «۱٬۲۵۰» را از یک
  // برگه رونوشت کند و در سامانه بچسباند؛ اگر آن را نشناسیم، عدد می‌شود تهی.
  const cleaned = toEnglishDigits(String(value)).replace(/[٬,\s]/g, '').trim();
  if (cleaned === '') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** تاریخِ میلادی (رشته یا Date) → نمایشِ شمسی */
export function jalaliOf(value: Date | string | null | undefined, withTime = false): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return formatJalali(date, withTime ? 'yyyy/MM/dd HH:mm' : 'yyyy/MM/dd');
}

/**
 * نمایشِ یک سلول در پی‌دی‌اف.
 *
 * خروجی همیشه رشته است، چون پی‌دی‌اف فقط رشته می‌چیند؛ عدد بودن در اکسل
 * به کار می‌آید، نه اینجا.
 */
export function formatCell(value: CellValue, type: ColumnType = 'text'): string {
  if (value === null || value === undefined || value === '') return '—';

  switch (type) {
    case 'money': {
      const num = numericValue(value);
      return num === null ? String(value) : groupDigits(num);
    }
    case 'percent': {
      const num = numericValue(value);
      return num === null ? String(value) : `${toPersianDigits(String(num))}٪`;
    }
    case 'number': {
      const num = numericValue(value);
      return num === null ? String(value) : groupDigits(num);
    }
    case 'date':
      return jalaliOf(value as Date | string, false);
    case 'datetime':
      return jalaliOf(value as Date | string, true);
    case 'boolean':
      return value === true || value === 'true' ? 'بله' : 'خیر';
    default:
      return String(value);
  }
}

/**
 * نمایشِ مبلغ به تومان — برایِ جمع‌بندی‌هایی که کنارِ ریال می‌آید.
 *
 * چرا هر دو؟ چون مشتری با تومان فکر می‌کند و حسابدار با ریال کار می‌کند؛
 * نوشتنِ «۱۲٬۵۰۰ تومان (۱۲۵٬۰۰۰ ریال)» هر دو را بی‌ابهام راضی می‌کند.
 */
export function tomanDisplay(rial: number): string {
  const negative = rial < 0;
  const text = formatToman(BigInt(Math.round(Math.abs(rial))), { digits: 'fa', separator: true });
  return (negative ? '−' : '') + text;
}

/**
 * حروف به عدد — «یکصد و بیست و پنج هزار ریال» برایِ زیرِ فاکتور.
 *
 * فاکتورِ رسمیِ ایرانی معمولاً مبلغ را به حروف هم می‌نویسد تا دست‌کاریِ رقم
 * (مثلاً افزودنِ یک صفر) بی‌اثر شود. این تابع تا میلیارد را می‌نویسد.
 */
const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه', 'ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'یکصد', 'دوصد', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون'];

function threeDigitsToWords(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) parts.push(HUNDREDS[h]!);
  if (rest < 20) {
    if (rest > 0) parts.push(ONES[rest]!);
  } else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    parts.push(TENS[t]!);
    if (o > 0) parts.push(ONES[o]!);
  }
  return parts.join(' و ');
}

export function numberToPersianWords(value: number): string {
  if (value === 0) return 'صفر';
  let n = Math.floor(Math.abs(value));
  const groups: string[] = [];
  let scale = 0;
  while (n > 0 && scale < SCALES.length) {
    const chunk = n % 1000;
    if (chunk > 0) {
      const word = threeDigitsToWords(chunk);
      groups.unshift(`${word}${SCALES[scale] ? ` ${SCALES[scale]}` : ''}`);
    }
    n = Math.floor(n / 1000);
    scale += 1;
  }
  const joined = groups.join(' و ');
  return value < 0 ? `منفی ${joined}` : joined;
}
