import { describe, it, expect } from 'vitest';
import { MetricsRegistry, percentile } from './metrics.js';
import { createRequestLogger, formatRequestLog, levelOf, outcomeOf } from './log.js';

describe('صدک', () => {
  it('مرزها را درست برمی‌گرداند', () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
  });
});

describe('گِردآوریِ آمار', () => {
  function registry(seconds = 1_700_000_000) {
    // ساعتِ ساختگی: آمار باید بی‌وابستگی به زمانِ واقعی آزمون‌پذیر باشد
    let clock = seconds * 1000;
    return { reg: new MetricsRegistry({ now: () => clock, maxRoutes: 4, sampleSize: 8 }), tick: (ms: number) => (clock += ms) };
  }

  it('شمارِ درخواست، خطا و وضعیت‌ها را جدا نگه می‌دارد', () => {
    const { reg } = registry();
    reg.record({ method: 'GET', route: '/products/:slug', status: 200, durationMs: 10 });
    reg.record({ method: 'GET', route: '/products/:slug', status: 404, durationMs: 20 });
    reg.record({ method: 'POST', route: '/orders', status: 500, durationMs: 900 });

    const snap = reg.snapshot();
    expect(snap.totals.requests).toBe(3);
    // فقط خطایِ ۵xx «خطا» ست: ۴۰۴ یعنی مشتری چیزی را اشتباه خواسته، نه اینکه سامانه خراب است
    expect(snap.totals.errors).toBe(1);
    expect(snap.statusClasses).toEqual({ '2xx': 1, '3xx': 0, '4xx': 1, '5xx': 1 });
    expect(snap.totals.errorRatePercent).toBe(33.3);
  });

  it('کندترین مسیر را با صدکِ ۹۵ نشان می‌دهد، نه با میانگین', () => {
    const { reg } = registry();
    // مسیری که بیشتر وقت‌ها تند است اما گاهی بسیار کند — میانگین این را پنهان می‌کند
    for (let i = 0; i < 10; i += 1) {
      reg.record({ method: 'GET', route: '/catalog/search', status: 200, durationMs: i === 9 ? 2_000 : 20 });
    }
    for (let i = 0; i < 10; i += 1) {
      reg.record({ method: 'GET', route: '/catalog/products', status: 200, durationMs: 120 });
    }

    const snap = reg.snapshot();
    expect(snap.slowestRoutes[0]?.route).toBe('/catalog/search');
    const search = snap.slowestRoutes.find((r) => r.route === '/catalog/search');
    expect(search?.p95Ms).toBeGreaterThan(1_000);
    // میانگینِ همان مسیر هنوز کوچک است — دقیقاً همان چیزی که صدک قرار است آشکار کند
    expect(search?.avgMs ?? 0).toBeLessThan(400);
  });

  it('پُرفشارترین مسیرها را بر پایه‌یِ شمار می‌چیند', () => {
    const { reg } = registry();
    reg.record({ method: 'GET', route: '/a', status: 200, durationMs: 1 });
    reg.record({ method: 'GET', route: '/b', status: 200, durationMs: 1 });
    reg.record({ method: 'GET', route: '/b', status: 200, durationMs: 1 });
    expect(reg.snapshot().topRoutes[0]).toMatchObject({ route: '/b', count: 2 });
  });

  it('گذرداد (درخواست بر ثانیه) بر پایه‌یِ شصت ثانیه‌یِ گذشته است', () => {
    const { reg, tick } = registry();
    for (let i = 0; i < 30; i += 1) {
      reg.record({ method: 'GET', route: '/a', status: 200, durationMs: 1 });
    }
    // پنجره‌ی لغزان: با گذشتِ زمان، همان سی درخواست از شصت ثانیه بیرون می‌رود
    expect(reg.snapshot().throughput.avgPerSecond).toBeGreaterThan(0);
    tick(120_000);
    expect(reg.snapshot().throughput.avgPerSecond).toBe(0);
  });

  it('حافظه کران‌دار است: مسیرِ کهن‌تر بیرون می‌رود تا جا برایِ تازه باز شود', () => {
    const { reg } = registry();
    for (const route of ['/a', '/b', '/c', '/d', '/e', '/f']) {
      reg.record({ method: 'GET', route, status: 200, durationMs: 1 });
    }
    const snap = reg.snapshot();
    expect(snap.trackedRoutes).toBe(4);
  });
});

describe('لاگِ ساخت‌یافته', () => {
  it('هر درخواست یک خطِ JSON با کلیدهایِ ثابت دارد', () => {
    const lines: string[] = [];
    const logger = createRequestLogger((line) => lines.push(line));

    logger.request({
      traceId: 'tr-1',
      method: 'GET',
      route: '/catalog/products',
      status: 200,
      durationMs: 12.4,
      ip: '5.5.5.5',
      outcome: 'ok',
    });

    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(parsed.traceId).toBe('tr-1');
    expect(parsed.level).toBe('info');
    expect(parsed.route).toBe('/catalog/products');
    expect(parsed.durationMs).toBe(12.4);
  });

  it('هیچ رازی در لاگ نمی‌ماند (بدنه، کوکی و توکن نوشته نمی‌شوند)', () => {
    const line = formatRequestLog({
      at: '2026-09-18T10:00:00.000Z',
      level: 'warn',
      outcome: 'blocked',
      traceId: 'tr-2',
      method: 'POST',
      route: '/auth/login',
      status: 429,
      durationMs: 3,
      ip: '5.5.5.5',
      rule: 'auth.login',
    });
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      ['at', 'durationMs', 'ip', 'level', 'method', 'outcome', 'route', 'rule', 'status', 'traceId'].sort(),
    );
  });

  it('سطحِ لاگ از سرشتِ پاسخ برمی‌آید', () => {
    expect(outcomeOf(200)).toBe('ok');
    expect(outcomeOf(302)).toBe('redirect');
    expect(outcomeOf(404)).toBe('client-error');
    expect(outcomeOf(429)).toBe('blocked');
    expect(outcomeOf(500)).toBe('error');
    expect(levelOf('error')).toBe('error');
    expect(levelOf('blocked')).toBe('warn');
    expect(levelOf('ok')).toBe('info');
  });
});
