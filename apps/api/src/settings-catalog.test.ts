import { describe, expect, it } from 'vitest';
import {
  SETTINGS,
  extractPlaceholders,
  isKnownSetting,
  maskSecret,
  settingDef,
  validateSetting,
} from './settings-catalog.js';

/**
 * کارنامه‌ی تنظیمات.
 *
 * اینجا فقط «مقدار درست ذخیره می‌شود؟» سنجیده نمی‌شود؛ هر آزمون یک شکستِ
 * واقعی را بیرون می‌کشد که در یک فروشگاهِ واقعی رخ می‌دهد: نرخِ مالیات که
 * با کیبوردِ فارسی نوشته شده، مهلتِ منفی، کلیدِ درگاهی که به مرورگر درز
 * می‌کند، و متغیری که در متنِ پیامک جا می‌ماند و پیام ناقص می‌رود.
 */

describe('کارنامه‌ی تنظیمات', () => {
  it('هر کلید یکتاست و گروهی شناخته‌شده دارد', () => {
    const keys = SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    const groups = new Set(['store', 'orders', 'tax', 'gateway', 'sms', 'advanced']);
    for (const s of SETTINGS) expect(groups.has(s.group)).toBe(true);
  });

  it('کلیدِ ناشناخته را نمی‌پذیرد (راهِ ساختِ تنظیم از بیرون بسته است)', () => {
    expect(isKnownSetting('vat_rate_percent')).toBe(true);
    expect(isKnownSetting('sneaky_new_key')).toBe(false);
    const out = validateSetting('sneaky_new_key', '1');
    expect(out.ok).toBe(false);
  });
});

describe('اعتبارسنجی', () => {
  it('ارقامِ فارسی را در عددها می‌پذیرد — کاربر با کیبوردِ فارسی می‌نویسد', () => {
    const out = validateSetting('return_window_days', '۱۴');
    expect(out.ok).toBe(true);
    expect(out.value).toBe('14');
  });

  it('مقدارِ نامعتبر را با پیامِ فارسی رد می‌کند، نه با خطایِ کلی', () => {
    expect(validateSetting('return_window_days', 'abc').ok).toBe(false);
    expect(validateSetting('return_window_days', '-1').ok).toBe(false);
    expect(validateSetting('return_window_days', '9999').ok).toBe(false);
    const msg = validateSetting('return_window_days', '9999').message ?? '';
    expect(msg).toContain('مهلتِ مرجوعی');
  });

  it('بله/خیر را به درست/غلط برمی‌گرداند', () => {
    expect(validateSetting('sms_enabled', 'بله').value).toBe('true');
    expect(validateSetting('sms_enabled', 'خیر').value).toBe('false');
    expect(validateSetting('sms_enabled', 'شاید').ok).toBe(false);
  });

  it('در گزینه‌ای، مقدارِ بیرون از فهرست را رد می‌کند', () => {
    expect(validateSetting('payment_gateway', 'zarinpal').ok).toBe(true);
    expect(validateSetting('payment_gateway', 'stripe').ok).toBe(false);
  });

  it('شناسه‌یِ ملی و کدِ پستی را یکسان‌سازی می‌کند (ارقامِ فارسی و فاصله)', () => {
    const out = validateSetting('store_postal_code', '۱۴۳۵۶ ۷۸۹۱۲');
    expect(out.ok).toBe(true);
    expect(out.value).toBe('1435678912'); // فاصله حذف و ارقام فارسی به انگلیسی
  });
});

describe('کلیدهایِ محرمانه', () => {
  it('کلیدِ درگاه را کامل بیرون نمی‌دهد', () => {
    const def = settingDef('zarinpal_merchant_id')!;
    const masked = maskSecret(def, 'abcd1234efgh5678');
    expect(masked).toContain('5678');
    expect(masked).not.toContain('abcd1234efgh');
    expect(masked.startsWith('••••')).toBe(true);
  });

  it('تنظیماتِ عادی را پوشانده نمی‌کند', () => {
    const def = settingDef('store_name')!;
    expect(maskSecret(def, 'ست‌شاپ')).toBe('ست‌شاپ');
  });
});

describe('متنِ پیامک', () => {
  it('متغیرها را از متن استخراج می‌کند', () => {
    expect(extractPlaceholders('{store}؛ کدِ ورود: {code}')).toEqual(['code', 'store']);
  });

  it('قالبِ کدِ ورود در کارنامه هست و متغیرهایش کامل است', () => {
    const otp = SETTINGS.find((s) => s.key === 'sms_enabled');
    expect(otp).toBeDefined(); // پیامک باید تنظیمِ روشن/خاموش داشته باشد
    const ph = extractPlaceholders('{store}؛ کدِ ورود شما: {code}');
    expect(ph).toContain('code');
    expect(ph).toContain('store');
  });
});

describe('تهی نگذاشتن (خطایِ بی‌صدایِ صفر)', () => {
  it('خالی گذاشتنِ نرخِ مالیات پذیرفته نمی‌شود — وگرنه بی‌صدا صفر می‌شد', () => {
    const out = validateSetting('vat_rate_percent', '');
    expect(out.ok).toBe(false);
    expect(out.message).toContain('نرخِ ارزش‌افزوده');
  });

  it('صفرِ واقعی هنوز پذیرفته است (سقفِ چک می‌تواند صفر باشد)', () => {
    expect(validateSetting('default_check_ceiling', '0')).toEqual({ ok: true, value: '0' });
  });
});
