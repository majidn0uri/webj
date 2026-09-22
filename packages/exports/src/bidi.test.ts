/**
 * آزمونِ موتورِ شکل‌دهی و ترتیبِ دیداری.
 *
 * این آزمون‌ها مهم‌ترین آزمون‌هایِ این بسته‌اند، چون خطایِ ترتیبِ دیداری
 * خطایی است که **در نگاهِ نخست دیده نمی‌شود**: سند چاپ می‌شود، متن اخراج
 * (extract) می‌شود، و تازه مشتری است که می‌بیند «فاکتور فروش» را به صورتِ
 * «فروشفاکتور» خوانده است. پس اینجا، به‌جایِ بررسیِ ظاهر، **ترتیبِ نگاره‌ها**
 * بررسی می‌شود — همان چیزی که رویِ کاغذ می‌نشیند.
 */

import { describe, expect, it } from 'vitest';
import * as fontkit from 'fontkit';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { directionalRuns, measureText, shapeVisual, visualString } from './bidi.js';

const here = dirname(fileURLToPath(import.meta.url));
const fontPath = join(here, '..', 'assets', 'Vazirmatn-Regular.ttf');
const font = fontkit.openSync(fontPath) as unknown as Parameters<typeof shapeVisual>[1];

/** نویسه‌هایی که رویِ کاغذ می‌نشینند، به ترتیبِ دیداری (چپ به راست) */
function glyphText(text: string): string {
  return shapeVisual(text, font)
    .map((glyph) => glyph.codePoints.map((code) => String.fromCodePoint(code)).join(''))
    .join('');
}

describe('ترتیبِ دیداری', () => {
  it('متنِ یک‌دستِ فارسی را وارونه می‌کند', () => {
    expect(visualString('فاکتور فروش')).toBe('شورف روتکاف');
    expect(glyphText('فاکتور فروش')).toBe('شورف روتکاف');
  });

  it('عدد را وارونه نمی‌کند — وگرنه ۱۲۵۰ می‌شود ۰۵۲۱', () => {
    expect(visualString('مبلغ: ۱٬۲۵۰٬۰۰۰ ریال')).toBe('لایر ۱٬۲۵۰٬۰۰۰ :غلبم');
    expect(visualString('سفارش 12345 ست‌شاپ')).toBe('پاش‌تس 12345 شرافس');
  });

  it('واژه‌یِ لاتین را حرف‌به‌حرف وارونه نمی‌کند', () => {
    expect(visualString('قاب iPhone 15 پرو')).toBe('ورپ iPhone 15 باق');
    expect(visualString('کد: SET-1405-0087')).toBe('SET-1405-0087 :دک');
  });

  it('کمانه‌ها را آینه می‌کند (پرانتزِ باز در خطِ راست‌چین)', () => {
    // در یک بندِ راست‌چین، «(تخفیف)» باید به صورتِ «)تخفیف(» دیده شود؛
    // وگرنه پرانتز‌ها وارونه می‌نشینند.
    expect(visualString('جمع (با تخفیف):')).toBe(':(فیفخت اب) عمج');
  });

  it('تکه‌بندی را به bidi-js می‌سپارد و مرزها را درست می‌سنجد', () => {
    const runs = directionalRuns('مبلغ: ۱٬۲۵۰٬۰۰۰ ریال', 'rtl');
    const kinds = runs.map((run) => `${run.rtl ? 'RTL' : 'LTR'}:${run.text}`);
    // دست‌کم سه تکه: متنِ فارسی، عدد، متنِ فارسی
    expect(runs.length).toBeGreaterThanOrEqual(3);
    expect(kinds.some((k) => k.startsWith('LTR') && k.includes('۱'))).toBe(true);
  });

  it('رشته‌یِ تهی و تک‌نویسه‌ای را بی‌خطا برمی‌گرداند', () => {
    expect(visualString('')).toBe('');
    expect(glyphText('')).toBe('');
    expect(glyphText('ا')).toBe('ا');
  });
});

describe('شکل‌دهی', () => {
  it('نگاره‌ها را به ترتیبِ دیداری می‌چیند و نویسه‌یِ اصلی را نگه می‌دارد', () => {
    // این ویژگیِ حیاتی است: نگاشتِ ToUnicode باید نویسه‌یِ **اصلی** را بدهد،
    // تا رونوشت‌برداری از پی‌دی‌اف همان متنِ منطقی را تحویل دهد.
    const glyphs = shapeVisual('ست‌شاپ', font);
    expect(glyphs.length).toBeGreaterThan(0);
    const joined = glyphs.map((g) => g.codePoints.map((c) => String.fromCodePoint(c)).join('')).join('');
    expect([...joined].reverse().join('')).toBe('ست‌شاپ');
  });

  it('نگاره‌هایِ نیم‌فاصله را حفظ می‌کند (شکلِ حروف در «ست‌شاپ» نباید پیوسته شود)', () => {
    const withZwnj = shapeVisual('ست‌شاپ', font).map((g) => g.gid).join(',');
    const without = shapeVisual('ستشاپ', font).map((g) => g.gid).join(',');
    expect(withZwnj).not.toBe(without);
  });

  it('پهنا را با اندازه‌یِ قلم می‌سنجد (دو برابرِ اندازه ≈ دو برابرِ پهنا)', () => {
    const one = measureText('فاکتور فروش', font, 10);
    const two = measureText('فاکتور فروش', font, 20);
    expect(one).toBeGreaterThan(0);
    expect(two).toBeCloseTo(one * 2, 5);
  });

  it('حافظه‌یِ شکل‌دهی همان نتیجه را برمی‌گرداند (نه نتیجه‌ای دیگر)', () => {
    const first = shapeVisual('مبلغ: ۱٬۲۵۰٬۰۰۰ ریال', font).map((g) => g.gid).join(',');
    const second = shapeVisual('مبلغ: ۱٬۲۵۰٬۰۰۰ ریال', font).map((g) => g.gid).join(',');
    expect(second).toBe(first);
  });
});
