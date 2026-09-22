import type { FastifyInstance } from 'fastify';

import { parseTrustedProxies, resolveClientIp } from './client-ip.js';
import type { AppConfig } from './config.js';

/**
 * نشانیِ بازدیدکننده را **یک‌جا** تعیین می‌کند و رویِ `request.ip` می‌نشاند.
 *
 * چرا یک قلاب و نه `trustProxy`؟ سندِ کامل در `client-ip.ts` است؛ خلاصه‌اش:
 * fastify نخستینِ `X-Forwarded-For` را می‌خواند و آن را خودِ کلاینت نوشته.
 * با یک قلاب، همه‌یِ مصرف‌کننده‌ها (`rate limit`، `login_attempts`،
 * `audit_log`، `payments.meta`، لاگِ درخواست) یک نشانیِ **قابلِ اعتماد**
 * می‌بینند، نه هر کدام روایتِ خودش را.
 *
 * ترتیبِ ثبت مهم است: این قلاب باید **پیش از** `registerObservability` ثبت
 * شود، چون مهارِ نرخ در همان لحظه نشانی را می‌خواند.
 */
export function attachClientIp(instance: FastifyInstance, config: AppConfig): void {
  const trusted = parseTrustedProxies(config.TRUSTED_PROXY_IPS);
  const internalToken = config.INTERNAL_API_TOKEN;

  instance.addHook('onRequest', async (request) => {
    const presented = request.headers['x-set-internal'];
    const isInternal =
      config.TRUST_WEB_CLIENT_IP && internalToken !== '' && presented === internalToken;

    const real = resolveClientIp(
      {
        peer: request.socket?.remoteAddress ?? null,
        realIpHeader: (request.headers['x-real-ip'] as string | undefined) ?? null,
        forwardedHeader: (request.headers['x-forwarded-for'] as string | undefined) ?? null,
        clientIpHeader: (request.headers['x-set-client-ip'] as string | undefined) ?? null,
      },
      trusted,
      isInternal,
    );

    // `request.ip` در fastify یک getter است؛ با defineProperty می‌توان آن را
    // برایِ همین درخواست بازنویسی کرد، و از اینجا به بعد همه (شاملِ لاگرِ
    // ساخت‌یافته و هر `req.ip` در کنترلرها) همین را می‌بینند.
    Object.defineProperty(request, 'ip', {
      value: real ?? '',
      configurable: true,
      writable: false,
      enumerable: true,
    });
  });
}
