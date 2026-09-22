import { describe, it, expect } from 'vitest';
import { loadConfig, corsOrigins } from './config.js';

/**
 * آزمون‌هایِ پیکربندی — آنچه اگر درست نباشد، هیچ لاگی نشان نمی‌دهد.
 *
 * یک کلیدِ امضایِ پیش‌فرض یک ضعفِ امنیتیِ «بی‌صدا» است: سامانه بالا می‌آید،
 * همه‌چیز کار می‌کند، و تنها کسی که می‌فهمد، کسی است که کلید را از پیش
 * می‌دانسته. همین بی‌صدایی است که این آزمون‌ها را لازم می‌کند.
 */

/** کمینه‌یِ تنظیماتی که تولید به آن نیاز دارد (بقیه پیش‌فرض دارند) */
const production = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({ NODE_ENV: 'production', ...extra }) as NodeJS.ProcessEnv;

const STRONG = 'سری-تصادفی-بلند-برای-امضا-که-در-تولید-تزریق-می‌شود-۱۴۰۵۰۶۲۷';

describe('کلیدِ امضا در تولید', () => {
  it('بی‌کلید بالا نمی‌آید — به‌جایِ سقوط در ابهام، همان آغاز خطا می‌دهد', () => {
    expect(() => loadConfig(production())).toThrow(/JWT_SECRET/);
  });

  it('کلیدِ توسعه را حتی اگر دستی تنظیم شده باشد رد می‌کند', () => {
    expect(() => loadConfig(production({ JWT_SECRET: 'dev-only-secret-change-me-in-production' }))).toThrow(
      /معتبر نیست/,
    );
  });

  it('کلیدِ کوتاه (کمتر از ۳۲ نویسه) را رد می‌کند', () => {
    // بیست نویسه: از کمینه‌یِ اعتبارسنجی (۱۶) می‌گذرد تا دقیقاً قانونِ تولید
    // آزموده شود، نه قانونِ قالب
    expect(() => loadConfig(production({ JWT_SECRET: 'ک'.repeat(20) }))).toThrow(/۳۲ نویسه/);
  });

  it('کلیدِ بلندِ تزریق‌شده پذیرفته است', () => {
    const config = loadConfig(production({ JWT_SECRET: STRONG }));
    expect(config.JWT_SECRET).toBe(STRONG);
  });

  it('در توسعه بی‌کلید هم بالا می‌آید (وگرنه هر اجرایِ محلی نیاز به تنظیم داشت)', () => {
    const config = loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(config.JWT_SECRET.length).toBeGreaterThan(0);
  });
});

describe('مبدأهایِ مجاز (CORS)', () => {
  it('بی‌تنظیم، همان نشانیِ فروشگاه است — نه «همه‌یِ دنیا»', () => {
    const config = loadConfig({ APP_URL: 'https://forushgah.example.com/' } as NodeJS.ProcessEnv);
    expect(corsOrigins(config)).toEqual(['https://forushgah.example.com']);
  });

  it('فهرستِ جدا‌شده با ویرگول پذیرفته و پیراسته می‌شود', () => {
    const config = loadConfig({
      APP_URL: 'https://a.example.com',
      CORS_ORIGINS: 'https://b.example.com/, https://c.example.com ,  ',
    } as NodeJS.ProcessEnv);
    expect(corsOrigins(config)).toEqual(['https://b.example.com', 'https://c.example.com']);
  });
});
