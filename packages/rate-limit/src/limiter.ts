import { bucketKey, findRule } from './rules.js';
import type {
  CallerIdentity,
  CounterStore,
  RateDecision,
  RateRule,
  RateStore,
} from './types.js';

/** تصمیمی که «هیچ قاعده‌ای برقرار نیست» را می‌گوید */
function openDecision(rule: string, key: string, now: Date): RateDecision {
  return {
    rule,
    allowed: true,
    limit: 0,
    remaining: 0,
    resetAt: now,
    retryAfterSeconds: 0,
    bucketKey: key,
  };
}

export interface RateLimiterOptions {
  /** جایگاهِ شمارش برایِ هر گونه‌یِ قاعده */
  stores: Record<RateStore, CounterStore>;
  /**
   * قاعده‌ها از کجا می‌آیند.
   *
   * تابع است (نه فهرست)، چون قاعده‌ها در پایگاه‌اند و مدیر در پنل عوضشان
   * می‌کند: مهارگر هر بار تازه‌ترین را می‌خواند و نیازی به راه‌اندازیِ دوباره‌ی
   * سامانه نیست.
   */
  rules: () => readonly RateRule[] | Promise<readonly RateRule[]>;
  /** اگر `false` باشد، هیچ سقفی اِعمال نمی‌شود (کلیدِ اضطراری در پنل) */
  enabled?: () => boolean | Promise<boolean>;
}

/**
 * مهارگرِ بار.
 *
 * تنها کاری که می‌کند: می‌شمارد و می‌گوید «بله» یا «نه، چند ثانیه‌یِ دیگر».
 * نه مسیر می‌شناسد (آن کارِ `ruleForRoute` است) و نه پاسخ می‌سازد (آن کارِ
 * قلابِ وب است). همین جدایی باعث می‌شود بشود کلِ منطقِ سقف را در چند آزمونِ
 * کوتاه و بی‌نیاز از سرور بررسی کرد.
 */
export class RateLimiter {
  private readonly stores: Record<RateStore, CounterStore>;
  private readonly rules: RateLimiterOptions['rules'];
  private readonly enabled: () => boolean | Promise<boolean>;

  /** شمارِ مسدودشدن‌ها از آغازِ این فرآیند — برایِ دیده‌بانیِ خودِ مهارگر */
  private readonly blockedByRule = new Map<string, number>();
  private blockedTotal = 0;

  constructor(options: RateLimiterOptions) {
    this.stores = options.stores;
    this.rules = options.rules;
    this.enabled = options.enabled ?? (() => true);
  }

  /** یک درخواست را می‌شمارد و تصمیم می‌گیرد */
  async check(ruleName: string, caller: CallerIdentity, now = new Date()): Promise<RateDecision> {
    if ((await this.enabled()) === false) {
      return openDecision(ruleName, bucketKey('ip', caller), now);
    }

    const rule = findRule(await this.rules(), ruleName);
    // قاعده‌یِ ناشناخته یعنی «سقفی برقرار نیست». خطرناک به نظر می‌رسد، اما
    // جایگزینش بدتر است: اگر ناشناخته را مسدود کنیم، یک تغییرِ ساده در نامِ
    // قاعده (یا ناهماهنگیِ پایگاه و کد) کلِ فروشگاه را می‌بندد.
    if (!rule || !rule.isEnabled) {
      return openDecision(ruleName, bucketKey(rule?.scope ?? 'ip', caller), now);
    }

    const key = bucketKey(rule.scope, caller);
    const store = this.stores[rule.store];
    const { count, windowStartedAt } = await store.incr({
      rule: rule.name,
      key,
      windowSeconds: rule.windowSeconds,
      now,
    });

    const resetAt = new Date(windowStartedAt.getTime() + rule.windowSeconds * 1000);
    const allowed = count <= rule.maxRequests;

    if (!allowed) {
      this.blockedTotal += 1;
      this.blockedByRule.set(rule.name, (this.blockedByRule.get(rule.name) ?? 0) + 1);
    }

    return {
      rule: rule.name,
      allowed,
      limit: rule.maxRequests,
      remaining: Math.max(0, rule.maxRequests - count),
      resetAt,
      // دست‌کم یک ثانیه: صفر یعنی مشتری بی‌درنگ دوباره بفرستد و دوباره بسته شود
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
      bucketKey: key,
    };
  }

  /** آزادسازیِ دستی از پنل («این مشتری پشتِ NATِ اداره گیر کرده») */
  async release(ruleName: string): Promise<number> {
    let released = 0;
    for (const store of [this.stores.memory, this.stores.db]) {
      released += await store.reset(ruleName);
    }
    return released;
  }

  /** آمارِ مسدودشدن‌ها در این فرآیند */
  blockStats(): { total: number; byRule: Array<{ rule: string; count: number }> } {
    return {
      total: this.blockedTotal,
      byRule: [...this.blockedByRule.entries()]
        .map(([rule, count]) => ({ rule, count }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
