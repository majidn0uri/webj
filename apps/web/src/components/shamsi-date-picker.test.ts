import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ShamsiDatePicker } from './shamsi-date-picker';

/**
 * تستِ دود (smoke) برایِ انتخابگرِ تاریخِ شمسی:
 * مارکاپِ اولیه — trigger، ورودیِ مخفیِ فرم و حالتِ خالی.
 * (رفتارِ تقویمِ باز و کلیک، در مرورگر تست می‌شود؛ اینجا مرزِ SSR را نگه می‌داریم.)
 */
describe('ShamsiDatePicker — smoke SSR', () => {
  it('admin jalali با مقدار: trigger با تاریخِ فارسی', () => {
    const html = renderToString(
      createElement(ShamsiDatePicker, { value: '۱۴۰۵/۰۶/۲۰', onChange: () => {}, format: 'jalali' }),
    );
    expect(html).toContain('dp-trigger--admin');
    expect(html).toContain('۱۴۰۵/۰۶/۲۰');
    expect(html).not.toContain('type="hidden"');
  });

  it('حالتِ فرم (name): ورودیِ مخفیِ required برایِ FormData', () => {
    const html = renderToString(
      createElement(ShamsiDatePicker, { name: 'checkDueDate', format: 'iso', required: true, variant: 'store' }),
    );
    expect(html).toContain('dp-trigger--store');
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="checkDueDate"');
    expect(html).toContain('required');
  });

  it('مقدارِ خالی: placeholder با کلاسِ empty', () => {
    const html = renderToString(createElement(ShamsiDatePicker, { value: '', onChange: () => {} }));
    expect(html).toContain('dp-trigger__value--empty');
    expect(html).toContain('۱۴۰۵/۰۶/۲۰');
  });
});
