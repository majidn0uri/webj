import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { attachClientIp } from './client-ip-hook.js';
import type { AppConfig } from './config.js';

/**
 * آزمونِ «اتّصالِ واقعی» — نه فقط تابعِ خالص.
 *
 * چرا با Fastifyِ زنده؟ چون ریشهٔ این باگ در **همان** لایه بود:
 * `trustProxy: true` در کارخانه‌یِ fastify، و هیچ آزمونِ واحدی getterِ `request.ip`
 * را نمی‌بیند. اینجا همان زنجیره می‌چرخد: سوکت → سرآیندها → `request.ip`، و
 * همان چیزی که مهارِ نرخ و لاگِ امنیتی می‌خوانند سنجیده می‌شود.
 */

let instance: FastifyInstance;
const seen = new Map<string, { ip: string; xff: string | null }>();

function configWith(over: Partial<AppConfig>): AppConfig {
  return {
    TRUSTED_PROXY_IPS: '',
    TRUST_WEB_CLIENT_IP: true,
    INTERNAL_API_TOKEN: '',
    ...over,
  } as AppConfig;
}

async function boot(config: Partial<AppConfig> = {}) {
  const app = Fastify({ trustProxy: false });
  attachClientIp(app, configWith(config));
  app.get('/probe', async (request) => {
    const id = request.headers['x-probe-id'] as string;
    seen.set(id, {
      ip: request.ip ?? '',
      xff: (request.headers['x-forwarded-for'] as string | undefined) ?? null,
    });
    return { ok: true };
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return app;
}

async function probe(app: FastifyInstance, port: number, headers: Record<string, string>) {
  const id = randomUUID();
  const res = await fetch(`http://127.0.0.1:${port}/probe`, { headers: { 'x-probe-id': id, ...headers } });
  expect(res.status).toBe(200);
  return seen.get(id)!;
}

beforeEach(() => {
  seen.clear();
});
afterEach(async () => {
  await instance?.close();
});

describe('قلابِ نشانیِ مشتری (بر رویِ سوکتِ زنده)', () => {
  it('بی‌فهرستِ اعتماد: سرآیندِ جعلیِ کلاینت نادیده گرفته می‌شود', async () => {
    instance = await boot({ TRUSTED_PROXY_IPS: '' });
    const port = (instance.server.address() as { port: number }).port;
    const out = await probe(instance, port, { 'x-forwarded-for': '1.1.1.1, 2.2.2.2', 'x-real-ip': '9.9.9.9' });
    // همتایِ واقعی ۱۲۷.۰.۰.۱ است و چون قابلِ اعتماد نیست، هیچ سرآیندی باور نمی‌شود
    expect(out.ip).toBe('127.0.0.1');
  });

  it('با پروکسیِ قابلِ اعتماد: آخرینِ مقدارِ افزوده‌شده (کارِ nginx) خوانده می‌شود', async () => {
    instance = await boot({ TRUSTED_PROXY_IPS: '127.0.0.1' });
    const port = (instance.server.address() as { port: number }).port;
    const out = await probe(instance, port, { 'x-forwarded-for': '192.0.2.1, 198.51.100.7, 203.0.113.42' });
    expect(out.ip).toBe('203.0.113.42');
  });

  it('تماسِ درونیِ وب: x-set-client-ip پذیرفته می‌شود', async () => {
    instance = await boot({ TRUSTED_PROXY_IPS: '', INTERNAL_API_TOKEN: 'sekret', TRUST_WEB_CLIENT_IP: true });
    const port = (instance.server.address() as { port: number }).port;
    const out = await probe(instance, port, {
      'x-set-internal': 'sekret',
      'x-set-client-ip': '31.56.70.9',
      'x-forwarded-for': '8.8.8.8',
    });
    expect(out.ip).toBe('31.56.70.9');
  });

  it('بی‌کلیدِ درونی، همان سرآیند هیچ قدرتی ندارد', async () => {
    instance = await boot({ TRUSTED_PROXY_IPS: '', INTERNAL_API_TOKEN: 'sekret' });
    const port = (instance.server.address() as { port: number }).port;
    const out = await probe(instance, port, { 'x-set-client-ip': '31.56.70.9' });
    expect(out.ip).toBe('127.0.0.1');
  });

  it('با تنظیمِ TRUST_WEB_CLIENT_IP=false، سرآیندِ وب هم بی‌اثر است', async () => {
    instance = await boot({ TRUSTED_PROXY_IPS: '', INTERNAL_API_TOKEN: 'sekret', TRUST_WEB_CLIENT_IP: false });
    const port = (instance.server.address() as { port: number }).port;
    const out = await probe(instance, port, { 'x-set-internal': 'sekret', 'x-set-client-ip': '31.56.70.9' });
    expect(out.ip).toBe('127.0.0.1');
  });
});
