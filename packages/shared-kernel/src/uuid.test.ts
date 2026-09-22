import { describe, expect, it } from 'vitest';

import { isUuid } from './index.js';

/**
 * چرا برایِ یک تابعِ یک‌خطی آزمون می‌نویسیم؟
 *
 * چون این تابع نگهبانِ مرز است: اگر اشتباه کند، یا یک شناسه‌یِ درست را رد
 * می‌کند (مشتری مرجوعی‌اش را نمی‌بیند) یا یک رشته‌یِ نادرست را می‌پذیرد
 * (پایگاه خطایِ نوع می‌دهد و کاربر «خطایِ داخلی» می‌بیند). هر دو، خطایی
 * هستند که در ظاهر ربطی به این تابع ندارند و پیدا کردنشان ساعت‌ها طول
 * می‌کشد — مگر آنکه همین‌جا گیر بیفتند.
 */
describe('بررسیِ شناسه‌یِ یکتا (isUuid)', () => {
  it('شناسه‌یِ درست را می‌پذیرد', () => {
    expect(isUuid('d200f55e-0e80-416a-b2fa-a3238b3194f3')).toBe(true);
    expect(isUuid('D200F55E-0E80-416A-B2FA-A3238B3194F3')).toBe(true);
  });

  it('زیرمسیرهایِ هم‌نام را نمی‌پذیرد (مسیرِ ‎:id‎ آن‌ها را نمی‌بلعد)', () => {
    // این همان رشته‌ای است که مسیرِ ‎/admin/returns/warranties‎ به ‎:id‎ می‌داد
    expect(isUuid('warranties')).toBe(false);
    expect(isUuid('reference')).toBe(false);
    expect(isUuid('')).toBe(false);
  });

  it('رشته‌هایِ نزدیک به شناسه را رد می‌کند', () => {
    expect(isUuid('d200f55e-0e80-416a-b2fa-a3238b3194f')).toBe(false); // یک رقم کم
    expect(isUuid('d200f55e-0e80-416a-b2fa-a3238b3194f33')).toBe(false); // یک رقم زیاد
    expect(isUuid('d200f55e0e80416ab2faa3238b3194f3')).toBe(false); // بی‌خط‌تیره
    expect(isUuid('g200f55e-0e80-416a-b2fa-a3238b3194f3')).toBe(false); // نویسه‌یِ ناشناس
  });
});
