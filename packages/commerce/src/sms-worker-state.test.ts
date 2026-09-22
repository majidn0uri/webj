import { describe, expect, it } from 'vitest';
import { resolveLoopIntervalMs, smsStateLines, type SmsSendConfig } from './sms-worker-state.js';

/** نمونه‌یِ کاملِ پیکربندی، با یک لایه‌یِ بازنویسی — تا آزمون‌ها خوانا بمانند */
function cfg(over: Partial<SmsSendConfig> = {}): SmsSendConfig {
  return {
    provider: 'kavenegar',
    apiKey: 'K-123',
    sender: '10008663',
    service: false,
    maxAttempts: 5,
    backoffMinutes: 10,
    timeoutMs: 10_000,
    allowInsecure: false,
    strictIranOnly: true,
    endpoints: {},
    extraHosts: [],
    enabled: true,
    dryRun: false,
    ...over,
  };
}

describe('resolveLoopIntervalMs — فاصلهٔ دورِ کارگر', () => {
  it('رقم‌هایِ لاتین و فارسی یکی‌اند', () => {
    expect(resolveLoopIntervalMs('90')).toBe(90_000);
    expect(resolveLoopIntervalMs('۳۰')).toBe(30_000);
  });

  it('پیش‌فرض ۶۰ ثانیه است و ورودیِ بی‌معنی آن را خراب نمی‌کند', () => {
    for (const raw of [undefined, '', '  ', 'abc', '0', '-5', 'NaN', 'Infinity']) {
      expect(resolveLoopIntervalMs(raw)).toBe(60_000);
    }
  });

  it('`0` و عددِ منفی «هرگز» یا «بی‌وقفه» نمی‌شوند', () => {
    // هر دو از همین ماشین‌ها گزارش شده‌اند: `POSTSALE_INTERVAL_SEC=`ِ خالی در
    // واحدِ systemd، و یک صفرِ عمدی برایِ «تستِ سریع». صفرِ اول بی‌صدا هیچ دوری
    // نمی‌زد و دومی پایگاه را در چرخهٔ بی‌وقفه می‌انداخت.
    expect(resolveLoopIntervalMs('0')).toBe(60_000);
    expect(resolveLoopIntervalMs('-5')).toBe(60_000);
  });

  it('به کف و سقف می‌چسبد', () => {
    expect(resolveLoopIntervalMs('1')).toBe(5_000);
    expect(resolveLoopIntervalMs('2')).toBe(5_000);
    expect(resolveLoopIntervalMs('86400')).toBe(3_600_000);
    expect(resolveLoopIntervalMs('3.7')).toBe(5_000);
  });
});

describe('smsStateLines — دو خطی که «چرا پیامک نمی‌رسد» را می‌بندد', () => {
  const text = (c: SmsSendConfig, counts: Record<string, number> = {}): string =>
    smsStateLines(c, counts).join('\n');

  it('بی‌سامانه: می‌گوید صف می‌پُر شود و چیزی نمی‌رود — و دروغ «فرستاد» نمی‌گوید', () => {
    const out = text(cfg({ provider: 'none' }), { pending: 5 });
    expect(out).toContain('❌');
    expect(out).toContain('هیچ پیامی');
    expect(out).toContain('تنظیمات ← پیامک');
    expect(out).toContain('صف: 5 در انتظار');
    expect(out).not.toContain('✅');
    // درمان هم باید در همان خط باشد، نه فقط تشخیص
    expect(out).toMatch(/درمان:/);
  });

  it('سامانه انتخاب شده ولی کلیدِ «ارسالِ پیامک» خاموش است', () => {
    const out = text(cfg({ enabled: false }), { pending: 2 });
    expect(out).toContain('خاموش');
    expect(out).toContain('⚠️');
    expect(out).not.toContain('این دور می‌فرستد');
  });

  it('روشن است ولی کلیدِ API خالی است', () => {
    const out = text(cfg({ apiKey: '' }), {});
    expect(out).toContain('کلیدِ دسترسی خالی');
    expect(out).toContain('پنل ← تنظیمات ← پیامک');
  });

  it('`SMS_DRY_RUN` خودش را لو می‌دهد', () => {
    const out = text(cfg({ dryRun: true }), {});
    expect(out).toContain('SMS_DRY_RUN');
    expect(out).toContain('به سامانه نمی‌رود');
  });

  it('همه‌چیز آماده: سقفِ تلاش و فاصله را هم می‌گوید', () => {
    const out = text(cfg(), {});
    expect(out).toContain('✅ این دور می‌فرستد');
    expect(out).toContain('کاوه‌نگار');
    expect(out).toContain('تا 5 تلاش');
    expect(out).toContain('10 دقیقه');
  });

  it('صفِ پر، راهِ بالاآوردنِ کارگر را هم یادآوری می‌کند', () => {
    // این همان حالتی است که در آن «قابلیت هست ولی وصل نیست» گفته می‌شود: در
    // تولید تایمرِ systemd کار را می‌کند، رویِ ماشینِ توسعه هیچ‌کس.
    const out = text(cfg(), { pending: 3, failed: 1 });
    expect(out).toContain('npm run start:worker');
    expect(out).toContain('setshop-postsale.timer');
    expect(out).toContain('4 پیام در انتظار این دور است');
  });

  it('وضعیت‌هایِ میانیِ صف گم نمی‌شوند', () => {
    const out = text(cfg(), { pending: 1, sending: 2, dead: 3, sent: 40 });
    expect(out).toContain('2 در حالِ ارسال');
    expect(out).toContain('3 ناامیدکننده');
    expect(out).toContain('40 فرستاده‌شده');
  });
});
