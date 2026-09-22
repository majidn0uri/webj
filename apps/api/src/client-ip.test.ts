import { describe, expect, it } from 'vitest';

import { parseTrustedProxies, resolveClientIp } from './client-ip.js';

/**
 * آزمونِ نشانیِ بازدیدکننده.
 *
 * این آزمون از یک سوراخِ واقعی زاده شد: `trustProxy: true` نخستین مقدارِ
 * `X-Forwarded-For` را می‌پذیرد، و نخستین مقدار را خودِ کلاینت می‌نویسد. رویِ
 * همین دستگاه ثابت شد که یک سرآیندِ جعلی، هم مهارِ نرخ را دور می‌زند و هم لاگِ
 * امنیتی را جعل می‌کند. پس آنچه اینجا سنجیده می‌شود «فرمتِ صحیح» نیست؛
 * «قابلِ جعل نبودن» است.
 */

describe('نشانیِ بازدیدکننده', () => {
  it('از یک همسایه‌یِ ناامید، هیچ سرآیندی باور نمی‌شود', () => {
    const ip = resolveClientIp(
      { peer: '89.12.34.56', forwardedHeader: '10.0.0.1, 203.0.113.9', realIpHeader: '127.0.0.1' },
      parseTrustedProxies(''),
    );
    expect(ip).toBe('89.12.34.56');
  });

  it('ساختارشکنیِ مهارِ نرخ: جعلِ X-Forwarded-For نشانی را عوض نمی‌کند', () => {
    // همین سناریو پیش ازِ اصلاح، «سقفِ ۱۰ سفارش در ساعت» را بی‌نهايت می‌کرد
    const trusted = parseTrustedProxies('127.0.0.1');
    const attack = (n: number) =>
      resolveClientIp({ peer: '203.0.113.77', forwardedHeader: `10.0.0.${n}` }, trusted);
    expect(attack(1)).toBe('203.0.113.77');
    expect(attack(2)).toBe('203.0.113.77');
    expect(attack(250)).toBe('203.0.113.77');
  });

  it('پروکسیِ قابلِ اعتماد: آخرینِ مقدارِ افزوده‌شده خوانده می‌شود، نه نخستین', () => {
    // nginx: `proxy_add_x_forwarded_for` یعنی «هرچه کلاینت فرستاد، و در آخر
    // نشانیِ واقعی» — پس ۹.۹.۹.۹ مشتریِ واقعی است و ۱.۱.۱.۱ توهمِ مهاجم
    const ip = resolveClientIp(
      { peer: '127.0.0.1', forwardedHeader: '1.1.1.1, 2.2.2.2, 9.9.9.9' },
      parseTrustedProxies('127.0.0.1'),
    );
    expect(ip).toBe('9.9.9.9');
  });

  it('X-Real-IP (همان $remote_addr) بر XFF مقدم است', () => {
    const ip = resolveClientIp(
      { peer: '127.0.0.1', realIpHeader: '88.77.66.55', forwardedHeader: '1.1.1.1, 9.9.9.9' },
      parseTrustedProxies('127.0.0.1'),
    );
    expect(ip).toBe('88.77.66.55');
  });

  it('پیشوندِ شبکه هم پذیرفته می‌شود (وب و API در دو کانتینرِ یک میزبان)', () => {
    const trusted = parseTrustedProxies('172.17.0.0/16');
    expect(
      resolveClientIp({ peer: '172.17.0.3', forwardedHeader: '46.100.20.7' }, trusted),
    ).toBe('46.100.20.7');
    expect(resolveClientIp({ peer: '5.202.10.1', forwardedHeader: '46.100.20.7' }, trusted)).toBe(
      '5.202.10.1',
    );
  });

  it('نشانیِ socketِ IPv4-mapped (::ffff:…) پیش ازِ مقایسه پاک می‌شود', () => {
    const trusted = parseTrustedProxies('127.0.0.1');
    expect(
      resolveClientIp({ peer: '::ffff:127.0.0.1', forwardedHeader: '31.2.3.4' }, trusted),
    ).toBe('31.2.3.4');
  });

  it('تماسِ درونیِ وب: x-set-client-ip باور می‌شود، و بی‌آن بی‌اعتبار است', () => {
    const trusted = parseTrustedProxies('127.0.0.1');
    expect(
      resolveClientIp(
        { peer: '127.0.0.1', clientIpHeader: '31.2.3.4' },
        trusted,
        /* internal */ true,
      ),
    ).toBe('31.2.3.4');
    // از بیرون (بی‌کلیدِ درونی) همان سرآیند هیچ اعتباری ندارد
    expect(
      resolveClientIp(
        { peer: '203.0.113.77', clientIpHeader: '8.8.8.8' },
        trusted,
        /* internal */ false,
      ),
    ).toBe('203.0.113.77');
  });

  it('میانجیِ بی‌کلیدِ درونی هم نشانی را می‌رساند، اگر همتا قابلِ اعتماد باشد', () => {
    // «پیشنهادِ زنده‌یِ جستجو» عمداً بی‌کلیدِ درونی می‌زند تا از سقفِ خواندن
    // معاف نشود؛ امّا نشانی‌اش باید درست باشد، وگرنه سقفِ جستجو (۱۲۰ در
    // دقیقه) به یک سقفِ **جهانی** تبدیل می‌شود
    const trusted = parseTrustedProxies('127.0.0.1');
    expect(
      resolveClientIp({ peer: '127.0.0.1', clientIpHeader: '31.56.70.9' }, trusted, false),
    ).toBe('31.56.70.9');
    // و همان سرآیند از همتایِ ناامید، بی‌اثر است
    expect(
      resolveClientIp({ peer: '5.202.1.1', clientIpHeader: '8.8.8.8' }, trusted, false),
    ).toBe('5.202.1.1');
  });

  it('همسایه‌یِ بی‌نام به «ناشناس» نمی‌افتد بی‌آنکه داده از دست برود', () => {
    expect(resolveClientIp({ peer: '', forwardedHeader: '' }, parseTrustedProxies(''))).toBeNull();
  });

  it('فهرستِ تهی یعنی «هیچ پروکسی‌ای نیست» (نه «همه پروکسی‌اند»)', () => {
    expect(parseTrustedProxies(undefined)).toEqual([]);
    expect(parseTrustedProxies(' 127.0.0.1 , ::1 ')).toEqual(['127.0.0.1', '::1']);
    // این دو، همان تنظیمِ استقرارِ تک‌ماشینه‌یِ مستندات است
    expect(parseTrustedProxies('127.0.0.1,::1')).toContain('127.0.0.1');
  });
});
