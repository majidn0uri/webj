import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, applyMigrations, type Database } from '@set/db';

import { alignedWindowStart, MemoryCounterStore } from './memory-store.js';
import { DbCounterStore, recordBlocked } from './db-store.js';
import { RateLimiter } from './limiter.js';
import { bucketKey, ruleForRoute, sanitizeRulePatch, DEFAULT_RULES, mergeRules } from './rules.js';
import type { CounterStore, RateRule } from './types.js';

/** قاعده‌یِ آزمایشی — کوچک تا بشود مرزِ سقف را در چند گام دید */
function rule(over: Partial<RateRule> = {}): RateRule {
  return {
    name: 'test.rule',
    title: 'قاعده‌یِ آزمون',
    hint: '',
    maxRequests: 3,
    windowSeconds: 60,
    scope: 'ip',
    store: 'memory',
    isEnabled: true,
    ...over,
  };
}

describe('مهارِ بار — پنجره و سطل', () => {
  it('آغازِ پنجره با مبدأِ زمان هم‌راستا است (نه با نخستین درخواست)', () => {
    const a = new Date('2026-09-18T10:00:10.000Z');
    const b = new Date('2026-09-18T10:00:59.999Z');
    const c = new Date('2026-09-18T10:01:00.000Z');
    expect(alignedWindowStart(a, 60)).toBe(Date.parse('2026-09-18T10:00:00.000Z'));
    expect(alignedWindowStart(b, 60)).toBe(Date.parse('2026-09-18T10:00:00.000Z'));
    expect(alignedWindowStart(c, 60)).toBe(Date.parse('2026-09-18T10:01:00.000Z'));
  });

  it('کلیدِ سطل بر پایه‌یِ گستره ساخته می‌شود', () => {
    expect(bucketKey('ip', { ip: '5.1.2.3', sessionKey: 's1' })).toBe('5.1.2.3');
    expect(bucketKey('user', { ip: '5.1.2.3', sessionKey: 's1' })).toBe('s1');
    // بی‌نام: نشانی جایِ نشست را می‌گیرد، وگرنه همه‌یِ بی‌نام‌ها یک سطل می‌شدند
    expect(bucketKey('user', { ip: '5.1.2.3' })).toBe('5.1.2.3');
    expect(bucketKey('ip_user', { ip: '5.1.2.3', sessionKey: 's1' })).toBe('5.1.2.3::s1');
  });
});

describe('شمارنده‌یِ حافظه', () => {
  it('تا پایانِ پنجره می‌شمارد و با پنجره‌یِ تازه از نو آغاز می‌کند', async () => {
    const store = new MemoryCounterStore(100);
    const now = new Date('2026-09-18T10:00:00.000Z');
    const hit = { rule: 'r', key: 'k', windowSeconds: 60 };

    expect((await store.incr({ ...hit, now })).count).toBe(1);
    expect((await store.incr({ ...hit, now })).count).toBe(2);
    expect((await store.incr({ ...hit, now: new Date('2026-09-18T10:00:59Z') })).count).toBe(3);
    // یک ثانیه‌یِ دیگر، پنجره‌یِ تازه
    expect((await store.incr({ ...hit, now: new Date('2026-09-18T10:01:00Z') })).count).toBe(1);
  });

  it('حافظه را کران‌دار نگه می‌دارد (سطل‌هایِ منقضی دور ریخته می‌شوند)', async () => {
    const store = new MemoryCounterStore(8);
    const windowSeconds = 60;
    for (let i = 0; i < 20; i += 1) {
      await store.incr({
        rule: 'r',
        key: `ip-${i}`,
        windowSeconds,
        now: new Date(Date.parse('2026-09-18T10:00:00.000Z') + i),
      });
    }
    // بیست کلید در یک پنجره با سقفِ هشت سطل: مهارگر باید کیفیت را فدایِ
    // زنده‌ماندن کند، نه اینکه تا بی‌نهایت کلید بسازد.
    expect(store.size()).toBeLessThanOrEqual(8);
  });

  it('آزادسازی، سطل‌هایِ همان قاعده را پاک می‌کند و بقیه را نه', async () => {
    const store = new MemoryCounterStore(100);
    const now = new Date();
    await store.incr({ rule: 'a', key: 'k1', windowSeconds: 60, now });
    await store.incr({ rule: 'b', key: 'k2', windowSeconds: 60, now });
    expect(await store.reset('a')).toBe(1);
    expect(store.size()).toBe(1);
  });
});

describe('برگزیدنِ قاعده برایِ مسیر', () => {
  it('مسیرهایِ امنیتی قاعده‌یِ ویژه‌یِ خود را دارند', () => {
    expect(ruleForRoute('POST', '/shop/auth/otp/request')).toBe('auth.otp');
    expect(ruleForRoute('POST', '/auth/login')).toBe('auth.login');
    expect(ruleForRoute('POST', '/shop/auth/password')).toBe('auth.login');
    expect(ruleForRoute('POST', '/shop/coupons/validate')).toBe('coupon.validate');
    expect(ruleForRoute('POST', '/orders')).toBe('order.create');
    expect(ruleForRoute('POST', '/cart/9f0/checkout')).toBe('order.create');
    expect(ruleForRoute('POST', '/shop/reviews')).toBe('review.create');
  });

  it('جستجو از خواندنِ عادی جدا است (گران‌تر است)', () => {
    expect(ruleForRoute('GET', '/catalog/search')).toBe('search');
    expect(ruleForRoute('GET', '/catalog/products')).toBe('public.read');
  });

  it('مسیرِ سلامت مهار نمی‌شود — نگهبان نباید در پشتِ سقف گیر کند', () => {
    expect(ruleForRoute('GET', '/health')).toBeNull();
    expect(ruleForRoute('GET', '/health/ready')).toBeNull();
  });

  it('مسیرهایِ مدیریت مهار نمی‌شوند، جز بارگذاریِ تصویر که گران است', () => {
    expect(ruleForRoute('GET', '/admin/products')).toBeNull();
    expect(ruleForRoute('POST', '/admin/products/123/images')).toBe('media.upload');
  });

  it('نوشتنِ بی‌نام جدا از خواندن شمرده می‌شود', () => {
    expect(ruleForRoute('POST', '/cart')).toBe('public.write');
    expect(ruleForRoute('GET', '/products/:slug')).toBe('public.read');
  });

  it('پارامترِ مسیر، سطلِ جدا نمی‌سازد (الگو مبناست، نه مسیرِ واقعی)', () => {
    // اگر مسیرِ واقعی مبنا بود، هر کالا سقفِ خودش را می‌داشت و مهار بی‌اثر می‌شد
    expect(ruleForRoute('GET', '/products/case-silicon-matte')).toBe(
      ruleForRoute('GET', '/products/glass-ceramic-9h'),
    );
  });
});

describe('مهارگرِ بار', () => {
  function limiter(rules: RateRule[] = [rule()], enabled = true) {
    const memory = new MemoryCounterStore(100);
    return new RateLimiter({
      stores: { memory, db: memory },
      rules: () => rules,
      enabled: () => enabled,
    });
  }

  it('تا سقف اجازه می‌دهد و پس از آن با «چند ثانیه‌یِ دیگر» پاسخ می‌دهد', async () => {
    const l = limiter();
    const caller = { ip: '5.5.5.5' };
    const now = new Date('2026-09-18T10:00:00.000Z');

    expect((await l.check('test.rule', caller, now)).allowed).toBe(true);
    expect((await l.check('test.rule', caller, now)).allowed).toBe(true);
    const third = await l.check('test.rule', caller, now);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = await l.check('test.rule', caller, now);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
    expect(fourth.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('دو تماس‌گیرنده‌یِ متفاوت سهمِ هم را نمی‌خورند', async () => {
    const l = limiter();
    const now = new Date();
    for (let i = 0; i < 3; i += 1) await l.check('test.rule', { ip: '1.1.1.1' }, now);
    expect((await l.check('test.rule', { ip: '1.1.1.1' }, now)).allowed).toBe(false);
    expect((await l.check('test.rule', { ip: '2.2.2.2' }, now)).allowed).toBe(true);
  });

  it('قاعده‌یِ خاموش و قاعده‌یِ ناشناس راه را نمی‌بندند', async () => {
    const off = limiter([rule({ isEnabled: false })]);
    expect((await off.check('test.rule', { ip: '1.1.1.1' })).allowed).toBe(true);

    // ناشناس = بی‌سقف: ناهماهنگیِ نامِ قاعده نباید فروشگاه را ببندد
    const unknown = limiter([]);
    expect((await unknown.check('no.such.rule', { ip: '1.1.1.1' })).allowed).toBe(true);
  });

  it('کلیدِ اضطراری (خاموشیِ سراسری) هیچ سقفی اِعمال نمی‌کند', async () => {
    const l = limiter([rule()], false);
    const now = new Date();
    for (let i = 0; i < 10; i += 1) {
      expect((await l.check('test.rule', { ip: '1.1.1.1' }, now)).allowed).toBe(true);
    }
  });

  it('مسدودشدن‌ها را می‌شمارد و آزادسازی، سقف را از نو می‌سازد', async () => {
    const l = limiter();
    const now = new Date();
    for (let i = 0; i < 5; i += 1) await l.check('test.rule', { ip: '3.3.3.3' }, now);
    expect(l.blockStats().total).toBe(2);
    expect(l.blockStats().byRule[0]).toEqual({ rule: 'test.rule', count: 2 });

    expect(await l.release('test.rule')).toBeGreaterThan(0);
    expect((await l.check('test.rule', { ip: '3.3.3.3' }, now)).allowed).toBe(true);
  });

  it('سقفِ هر مسیر با قاعده‌یِ خودش است (ورود سخت‌گیرانه‌تر از خواندن)', async () => {
    const l = limiter(DEFAULT_RULES.map((r) => ({ ...r })));
    const now = new Date();
    // خواندن: ۶۰۰ مجاز است
    expect((await l.check('public.read', { ip: '4.4.4.4' }, now)).limit).toBe(600);
    // کدِ یک‌بارمصرف: ۸ مجاز، و در پایگاه شمرده می‌شود
    expect((await l.check('auth.otp', { ip: '4.4.4.4' }, now)).limit).toBe(8);
  });
});

describe('ادغام و اعتبارسنجیِ قاعده‌ها', () => {
  it('قاعده‌یِ تازه‌یِ پایگاه جایِ پیش‌فرض را می‌گیرد و بقیه می‌مانند', () => {
    const stored = mergeRules([rule({ name: 'auth.otp', maxRequests: 3 })]);
    expect(stored.find((r) => r.name === 'auth.otp')?.maxRequests).toBe(3);
    expect(stored.find((r) => r.name === 'public.read')?.maxRequests).toBe(600);
  });

  it('مقدارهایِ نادرستِ پنل پیش از رسیدن به پایگاه رد می‌شوند', () => {
    expect(() => sanitizeRulePatch({ maxRequests: 0 })).toThrow();
    expect(() => sanitizeRulePatch({ maxRequests: 2.5 })).toThrow();
    expect(() => sanitizeRulePatch({ windowSeconds: 0 })).toThrow();
    expect(() => sanitizeRulePatch({ scope: 'everyone' })).toThrow();
    expect(() => sanitizeRulePatch({ store: 'redis' })).toThrow();
    expect(sanitizeRulePatch({ maxRequests: 5, isEnabled: false })).toEqual({
      maxRequests: 5,
      isEnabled: false,
    });
  });
});

describe('شمارنده‌یِ پایگاهی', () => {
  let db: Database;

  beforeEach(async () => {
    db = createDatabase('memory://');
    await applyMigrations(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('همه‌یِ قاعده‌هایِ پیش‌فرض در پایگاه نشانده شده‌اند', async () => {
    const { rows } = await db.query<{ name: string; store: string }>(
      `SELECT name, store FROM rate_limit_rules ORDER BY name`,
    );
    expect(rows.length).toBe(DEFAULT_RULES.length);
    expect(rows.filter((r) => r.store === 'db').map((r) => r.name)).toContain('auth.otp');
  });

  it('بیست درخواستِ هم‌زمان دقیقاً بیست شمرده می‌شود (بدون سبقتِ خواندن/نوشتن)', async () => {
    const store = new DbCounterStore(db);
    const now = new Date();
    const counts = await Promise.all(
      Array.from({ length: 20 }, () =>
        store.incr({ rule: 'auth.otp', key: '5.5.5.5', windowSeconds: 600, now }),
      ),
    );
    // هر درخواست شمارشِ خودش را می‌بیند؛ بزرگ‌ترینشان باید ۲۰ باشد، نه کمتر
    const max = Math.max(...counts.map((c) => c.count));
    expect(max).toBe(20);
  });

  it('پنجره‌یِ تازه شمارنده را از نو می‌سازد', async () => {
    const store = new DbCounterStore(db);
    const first = new Date('2026-09-18T10:00:00.000Z');
    await store.incr({ rule: 'auth.otp', key: '6.6.6.6', windowSeconds: 60, now: first });
    await store.incr({ rule: 'auth.otp', key: '6.6.6.6', windowSeconds: 60, now: first });
    const after = await store.incr({
      rule: 'auth.otp',
      key: '6.6.6.6',
      windowSeconds: 60,
      now: new Date('2026-09-18T10:01:30.000Z'),
    });
    expect(after.count).toBe(1);
  });

  it('ردِّ مسدودشدن، یک ردیف به‌ازایِ هر پنجره است (حمله جدول را پر نمی‌کند)', async () => {
    const started = new Date();
    for (let i = 0; i < 50; i += 1) {
      await recordBlocked(db, { rule: 'auth.otp', bucketKey: '7.7.7.7', windowStartedAt: started });
    }
    const { rows } = await db.query<{ seen: number; n: string }>(
      `SELECT seen, (SELECT COUNT(*)::text FROM rate_limit_events) AS n FROM rate_limit_events`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.seen).toBe(50);
    expect(rows[0]?.n).toBe('1');
  });

  it('پاک‌سازی، سطل‌هایِ کهنه را می‌برد', async () => {
    const store = new DbCounterStore(db);
    await store.incr({
      rule: 'auth.otp',
      key: '8.8.8.8',
      windowSeconds: 60,
      now: new Date(Date.now() - 200_000),
    });
    expect(store.size()).toBe(-1); // اندازه در پایگاه معنا ندارد
    const removed = await store.prune(100);
    expect(removed).toBe(1);
  });

  it('اگر پایگاه پاسخ ندهد، مهارگر عبور می‌دهد (شکست = دسترسی)', async () => {
    const broken: ConstructorParameters<typeof DbCounterStore>[0] = {
      query: async () => {
        throw new Error('پایگاه در دسترس نیست');
      },
    };
    const store = new DbCounterStore(broken);
    const value = await store.incr({
      rule: 'auth.otp',
      key: '9.9.9.9',
      windowSeconds: 60,
      now: new Date(),
    });
    expect(value.count).toBe(1);
    expect(store.health().failures).toBe(1);
  });
});

describe('جایگاهِ شمارنده', () => {
  it('هر دو جایگاه یک قرارداد را پیاده می‌کنند', () => {
    const stores: CounterStore[] = [new MemoryCounterStore(10), new DbCounterStore({ query: async () => ({ rows: [] }) })];
    expect(stores.map((s) => s.kind)).toEqual(['memory', 'db']);
  });
});
