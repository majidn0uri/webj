import { describe, expect, it } from 'vitest';

import { expandSearchQuery } from './search.js';
import { searchKey } from './persian.js';

/**
 * فرهنگِ مترادفِ پنل (`search_synonyms`) از راهِ `extra` به این تابع می‌رسد.
 * دو قاعده دارد و آزمونِ همین دو قاعده اینجاست — چون «مترادف ثبت شد و اثر
 * نکرد» دقیقاً همان باگی است که فروشنده را از پنلِ جستجو می‌ترساند.
 */
const allTerms = (groups: string[][]) => groups.flat();

describe('expandSearchQuery + مترادف‌هایِ پنل', () => {
  it('تک‌واژه به گروه **افزوده** می‌شود، نه جایگزین (نتایج کم نمی‌شوند)', () => {
    const r = expandSearchQuery('شارجر', { 'شارجر': ['مبدل'] });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toContain('شارجر');
    expect(r.groups[0]).toContain('مبدل');
    expect(r.normalized).toContain('شارجر');
    expect(r.applied.some((a) => a.matched.includes('مبدل'))).toBe(true);
  });

  it('چندواژه **جایگزین** می‌شود (پیش از واکاوی به واژه‌ها)', () => {
    const without = expandSearchQuery('کابل شارژر سریع');
    const withPanel = expandSearchQuery('کابل شارژر سریع', { 'کابل شارژر': ['مبدل'] });

    expect(without.normalized).toContain('کابل');
    expect(withPanel.normalized).toContain('مبدل');
    expect(withPanel.normalized).not.toContain('کابل');
    expect(allTerms(withPanel.groups)).toContain('مبدل');
    expect(withPanel.applied.some((a) => a.input === 'کابل شارژر')).toBe(true);
  });

  it('کلیدها پیش از مقایسه نرمال می‌شوند — «كابل»ِ عربی همان «کابل» است', () => {
    const r = expandSearchQuery('کابل شارژر', { 'كابل شارژر': ['مبدل'] });
    expect(r.normalized).toBe('مبدل');

    // تک‌واژه هم همین‌طور: واژهٔ کلید با یایِ عربی ثبت شده، پرسش با یایِ فارسی.
    // توجّه: «آداپتور» در گروه با شکلِ نرمال‌شدهٔ خودش («اداپتور») می‌آید —
    // `searchKey` هم «آ» را یک‌دست می‌کند، پس انتظارات هم با `searchKey`.
    const single = expandSearchQuery('شارژر', { 'شارژر': ['آداپتور'] });
    expect(allTerms(single.groups)).toContain(searchKey('آداپتور'));
    expect(searchKey('كابل')).toBe(searchKey('کابل'));
  });

  it('بلندترین عبارت اول می‌آید (عبارتِ کوتاه‌ترِ داخلی، بلندِ پنلی را خراب نکند)', () => {
    const r = expandSearchQuery('کابل شارژر سریع', {
      'کابل شارژر سریع': ['مبدلِ فوری'],
      'شارژر سریع': ['بی‌فایده'],
    });
    expect(r.normalized).toContain('مبدل فوری');
    expect(r.normalized).not.toContain('بی‌فایده');
  });

  it('چند کلید که نرمال‌شان یکی است، ادغام می‌شوند (نه بازنویسیِ آخر)', () => {
    const r = expandSearchQuery('شارجر', { 'شارجر': ['مبدل'], 'شارجر ': ['رابط'] });
    expect(allTerms(r.groups)).toEqual(expect.arrayContaining(['مبدل', 'رابط']));
  });

  it('عبارتِ بی‌اثر ثبت‌شده ضرر ندارد: اگر در پرسش نبود، دست نمی‌خورد', () => {
    const plain = expandSearchQuery('کابل');
    const untouched = expandSearchQuery('کابل', { 'پاور بانک خراب‌شده': ['چیزی'] });
    expect(untouched.normalized).toBe(plain.normalized);
    expect(untouched.groups).toEqual(plain.groups);
  });
});
