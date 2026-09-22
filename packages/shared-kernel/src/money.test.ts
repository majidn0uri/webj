import { describe, it, expect } from 'vitest';
import {
  tomanToRial, formatToman, percentOf, allocate, calcLine, sumLines, divRoundHalfUp,
} from './money.js';

describe('پول — ذخیره به ریال، نمایش به تومان', () => {
  it('تبدیل تومان به ریال، با ارقام فارسی و جداکننده', () => {
    expect(tomanToRial('45,000')).toBe(450_000n);
    expect(tomanToRial('۴۵۰۰۰')).toBe(450_000n);
    expect(tomanToRial(1250)).toBe(12_500n);
    expect(tomanToRial('12.5')).toBe(125n);
  });

  it('نمایشِ تومان با ارقام و جداکننده‌ی فارسی', () => {
    expect(formatToman(450_000n)).toBe('۴۵٬۰۰۰');
    expect(formatToman(450_000n, { digits: 'en' })).toBe('45,000');
    expect(formatToman(1_250_000n)).toBe('۱۲۵٬۰۰۰');
  });

  it('گردکردنِ نیم‌به‌بالا برای اعداد مثبت و منفی', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfUp(7n, 2n)).toBe(4n);
    expect(percentOf(1_000_000n, 900)).toBe(90_000n); // ۹٪
    expect(percentOf(1_000n, 5)).toBe(1n);            // ۰٫۰۵٪ = ۰٫۵ ریال → نیم‌به‌بالا
  });

  it('توزیعِ دقیق: مجموعِ خروجی دقیقاً برابرِ ورودی است (هیچ ریالی گم نمی‌شود)', () => {
    const a = allocate(1_000n, [1, 1, 1]);
    expect(a.reduce((s, x) => s + x, 0n)).toBe(1_000n);
    expect(a).toEqual([334n, 333n, 333n]);

    const b = allocate(10n, [1, 1, 1, 1, 1, 1]);
    expect(b.reduce((s, x) => s + x, 0n)).toBe(10n);

    const c = allocate(99_999n, [33, 33, 33]);
    expect(c.reduce((s, x) => s + x, 0n)).toBe(99_999n);
  });

  it('مالیات در سطحِ ردیف و بعد از تخفیف محاسبه می‌شود', () => {
    const line = calcLine({ unitPrice: 100_000n, quantity: 3, discount: 50_000n, taxBasisPoints: 900 });
    expect(line.gross).toBe(300_000n);
    expect(line.net).toBe(250_000n);        // تخفیف پیش از مالیات
    expect(line.tax).toBe(22_500n);         // ۹٪ از ۲۵۰٬۰۰۰ نه از ۳۰۰٬۰۰۰
    expect(line.total).toBe(272_500n);
  });

  it('جمعِ ردیف‌ها با بقیه‌ی محاسبات هم‌خوان است', () => {
    const lines = [
      calcLine({ unitPrice: 100_000n, quantity: 2, taxBasisPoints: 900 }),
      calcLine({ unitPrice: 50_000n, quantity: 1, discount: 10_000n, taxBasisPoints: 900 }),
    ];
    const sum = sumLines(lines);
    expect(sum.total).toBe(lines[0]!.total + lines[1]!.total);
    expect(sum.net).toBe(240_000n);
    expect(sum.tax).toBe(21_600n);
  });
});
