import { describe, expect, it } from 'vitest';

import { resolvePoolSize } from './client.js';

/**
 * اندازه‌یِ استخرِ اتصال، جدا از `pg.Pool` آزموده می‌شود — چون فاجعه‌ای که
 * این عدد می‌سازد (رمِ پر، API هنگ‌کرده) فقط زیرِ بار و رویِ ماشینِ کوچک
 * معلوم می‌شود، و هیچ‌کس نمی‌خواهد برایِ دیدنش بارِ تولید را تقلید کند.
 */
describe('resolvePoolSize', () => {
  it('با ماشین مقیاس می‌کند: دو برابرِ هسته‌ها', () => {
    expect(resolvePoolSize(undefined, 2)).toBe(4);
    expect(resolvePoolSize(undefined, 4)).toBe(8);
    expect(resolvePoolSize(undefined, 8)).toBe(16);
  });

  it('بینِ ۴ و ۲۰ نگه داشته می‌شود (جعبه‌یِ تک‌هسته‌ای و سرورِ ۶۴ هسته‌ای)', () => {
    expect(resolvePoolSize(undefined, 1)).toBe(4);
    expect(resolvePoolSize(undefined, 0)).toBe(4);
    expect(resolvePoolSize(undefined, 64)).toBe(20);
  });

  it('`DB_POOL_MAX` برنده است، ولی فقط اگر معنادار باشد', () => {
    expect(resolvePoolSize('10', 2)).toBe(10);
    expect(resolvePoolSize(' 30 ', 2)).toBe(30);
  });

  it('عددِ بی‌معنی استخرِ مرگ‌ساز نمی‌سازد — به پیش‌فرض برمی‌گردد', () => {
    // `Number('') === 0` و `max: 0` یعنی استخری که هیچ اتصالی نمی‌دهد:
    // سلامتی ۲۰۰ می‌دهد و اولین درخواست تا ابد در صف می‌خوابد.
    for (const bad of ['', '  ', '0', '-5', 'abc', 'Infinity', 'NaN', '9999']) {
      expect(resolvePoolSize(bad, 4), `bad=${JSON.stringify(bad)}`).toBe(8);
    }
  });
});
