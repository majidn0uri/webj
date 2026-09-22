import type { CounterStore, CounterHit, CounterValue } from './types.js';

interface Bucket {
  startedAt: number;
  windowMs: number;
  count: number;
}

/** آغازِ پنجره‌یِ هم‌راستا با مبدأِ زمان (مضربِ درازایِ پنجره) */
export function alignedWindowStart(now: Date, windowSeconds: number): number {
  const ms = windowSeconds * 1000;
  return Math.floor(now.getTime() / ms) * ms;
}

/**
 * شمارنده‌یِ درون‌فرآیندی.
 *
 * چرا هم‌راستا با مبدأِ زمان و نه «از نخستین درخواست»؟ چون با پنجره‌یِ
 * هم‌راستا، انقضا خودبه‌خود است: کلیدِ یکسان در پنجره‌یِ تازه به سطلِ تازه
 * می‌افتد و نیازی به زمان‌سنج (timer) یا پاک‌سازیِ دوره‌ای برایِ درستی نیست.
 *
 * بهایش: سقف ممکن است در بدترین حالت دو برابر به چشم آید (اگر تماس‌گیرنده
 * درست در مرزِ دو پنجره فشار بیاورد). برایِ خواندنِ عمومی — که کاربردِ این
 * شمارنده است — این خطا بی‌اهمیت است.
 *
 * کران‌دار بودنِ حافظه: شمارِ سطل‌ها سقف دارد (`maxBuckets`) و با پر شدن،
 * سطل‌هایِ منقضی دور ریخته می‌شوند. بی‌این سقف، یک حمله با هزاران نشانیِ
 * جعلی (از طریقِ سرآیندِ X-Forwarded-For) همین شمارنده را به ابزارِ پُر
 * کردنِ حافظه تبدیل می‌کرد — یعنی مهارگر، خودش عاملِ همان می‌شد که باید جلویش
 * را بگیرد.
 */
export class MemoryCounterStore implements CounterStore {
  readonly kind = 'memory' as const;

  private readonly buckets = new Map<string, Bucket>();
  private readonly maxBuckets: number;

  constructor(maxBuckets = 50_000) {
    this.maxBuckets = maxBuckets;
  }

  async incr(hit: CounterHit): Promise<CounterValue> {
    const id = `${hit.rule}|${hit.key}`;
    const startedAt = alignedWindowStart(hit.now, hit.windowSeconds);
    const windowMs = hit.windowSeconds * 1000;
    const bucket = this.buckets.get(id);

    if (!bucket || bucket.startedAt !== startedAt || bucket.windowMs !== windowMs) {
      if (this.buckets.size >= this.maxBuckets) this.sweep(hit.now.getTime());
      this.buckets.set(id, { startedAt, windowMs, count: 1 });
      return { count: 1, windowStartedAt: new Date(startedAt) };
    }

    bucket.count += 1;
    return { count: bucket.count, windowStartedAt: new Date(startedAt) };
  }

  async reset(rule?: string): Promise<number> {
    if (!rule) {
      const n = this.buckets.size;
      this.buckets.clear();
      return n;
    }
    let removed = 0;
    for (const key of [...this.buckets.keys()]) {
      if (key.startsWith(`${rule}|`)) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number {
    return this.buckets.size;
  }

  /** دور ریختنِ سطل‌هایی که پنجره‌شان گذشته است */
  private sweep(nowMs: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.startedAt + bucket.windowMs <= nowMs) this.buckets.delete(key);
    }
    // اگر پس از پاک‌سازی هنوز پر است (همه‌یِ سطل‌ها زنده‌اند)، کهن‌ترین‌ها
    // می‌روند: مهارگر باید زنده بماند، حتی اگر نادقیق شود.
    if (this.buckets.size >= this.maxBuckets) {
      const overflow = this.buckets.size - Math.floor(this.maxBuckets * 0.75);
      let dropped = 0;
      for (const key of this.buckets.keys()) {
        if (dropped >= overflow) break;
        this.buckets.delete(key);
        dropped += 1;
      }
    }
  }
}
