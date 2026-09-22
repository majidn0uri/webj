/**
 * گِردآوریِ آمارِ درخواست‌ها — در همین فرآیند، با حافظه‌یِ کَران‌دار.
 *
 * چرا در حافظه و نه در پایگاه؟ چون آمار، «داده‌یِ لحظه» است: در هر ثانیه
 * چندصد بار نوشته می‌شود و ارزشش در همان چند دقیقه‌یِ آخر است. نوشتنش در
 * پایگاه یعنی افزودنِ یک نوشتنِ دیگر به مسیرِ داغ — یعنی همان کاری که آمار
 * قرار است کمک کند از شرّش خلاص شویم.
 *
 * بهای این انتخاب: هر نمونه‌یِ API آمارِ خودش را دارد و پنل باید آن‌ها را کنار
 * هم ببیند (در استقرارِ چندنمونه‌ای). این صادقانه گفته شده و در مستند آمده
 * است؛ جایگزینش (پایگاه) بهایِ سنگین‌تری دارد.
 *
 * حافظه چگونه کران‌دار می‌ماند؟
 *   • شمارِ مسیرها سقف دارد (`maxRoutes`) و با پر شدن، کهن‌ترین‌ها می‌روند؛
 *   • برایِ هر مسیر، به‌جایِ نگه داشتنِ همه‌یِ زمان‌ها، یک نمونه‌گیر
 *     (`samples`) داریم — زیرا صدکِ ۹۵ از چندصد نمونه هم درست درمی‌آید؛
 *   • پنجره‌یِ یک‌دقیقه‌ای، آرایه‌ای ثابت به درازایِ ۶۰ است و می‌چرخد.
 */

export interface RecordInput {
  method: string;
  /** **الگویِ** مسیر (`/products/:slug`)، نه مسیرِ واقعی */
  route: string;
  status: number;
  durationMs: number;
}

export interface RouteMetrics {
  method: string;
  route: string;
  count: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  lastSeenAt: string;
}

export interface MetricsSnapshot {
  startedAt: string;
  uptimeSeconds: number;
  totals: { requests: number; errors: number; errorRatePercent: number };
  statusClasses: Record<'2xx' | '3xx' | '4xx' | '5xx', number>;
  throughput: {
    /** میانگینِ درخواست در ثانیه در شصت ثانیه‌یِ گذشته */
    avgPerSecond: number;
    /** بیشینه‌یِ درخواست در یک ثانیه، در شصت ثانیه‌یِ گذشته */
    peakPerSecond: number;
  };
  latency: { avgMs: number; p95Ms: number; maxMs: number };
  /** پُرفشارترین مسیرها (بر پایه‌یِ شمارِ درخواست) */
  topRoutes: RouteMetrics[];
  /** کندترین مسیرها (بر پایه‌یِ صدکِ ۹۵) */
  slowestRoutes: RouteMetrics[];
  /** شمارِ مسیرهایِ زیرِ نظر — برایِ این‌که بدانیم آیا سقفِ مسیرها پر شده */
  trackedRoutes: number;
}

interface RouteBucket {
  method: string;
  route: string;
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  samples: number[];
  cursor: number;
  lastSeenAt: number;
}

/** صدک — با نمونه‌هایِ مرتب‌شده. `p` میانِ ۰ و ۱ است. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const clamped = Math.min(1, Math.max(0, p));
  const index = Math.ceil(clamped * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))] ?? 0;
}

function emptyClasses(): Record<'2xx' | '3xx' | '4xx' | '5xx', number> {
  return { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
}

export interface MetricsOptions {
  /** بیشینه‌یِ شمارِ مسیرهایِ زیرِ نظر */
  maxRoutes?: number;
  /** شمارِ نمونه‌یِ زمان برایِ هر مسیر (برایِ محاسبه‌یِ صدک) */
  sampleSize?: number;
  /** شمارِ نمونه برایِ صدکِ سراسری */
  globalSampleSize?: number;
  /** ساعت — برایِ آزمون‌پذیری */
  now?: () => number;
}

export class MetricsRegistry {
  private readonly routes = new Map<string, RouteBucket>();
  private readonly maxRoutes: number;
  private readonly sampleSize: number;
  private readonly globalSampleSize: number;
  private readonly now: () => number;
  private readonly startedAt: number;

  private requests = 0;
  private errors = 0;
  private totalMs = 0;
  private maxMs = 0;
  private readonly classes = emptyClasses();
  private globalSamples: number[] = [];
  private globalCursor = 0;
  /** شصت سطلِ یک‌ثانیه‌ای — پنجره‌یِ لغزان */
  private readonly seconds = new Array<{ sec: number; count: number }>(60)
    .fill({ sec: 0, count: 0 })
    .map(() => ({ sec: 0, count: 0 }));

  constructor(options: MetricsOptions = {}) {
    this.maxRoutes = options.maxRoutes ?? 300;
    this.sampleSize = options.sampleSize ?? 256;
    this.globalSampleSize = options.globalSampleSize ?? 1_024;
    this.now = options.now ?? (() => Date.now());
    this.startedAt = this.now();
  }

  record(input: RecordInput): void {
    const at = this.now();
    const error = input.status >= 500;

    this.requests += 1;
    this.totalMs += input.durationMs;
    if (input.durationMs > this.maxMs) this.maxMs = input.durationMs;
    if (error) this.errors += 1;

    const cls = `${Math.floor(input.status / 100)}xx`;
    if (cls === '2xx' || cls === '3xx' || cls === '4xx' || cls === '5xx') this.classes[cls] += 1;

    this.pushGlobalSample(input.durationMs);

    const slot = this.seconds[Math.floor(at / 1000) % 60];
    if (slot) {
      if (slot.sec !== Math.floor(at / 1000)) {
        slot.sec = Math.floor(at / 1000);
        slot.count = 0;
      }
      slot.count += 1;
    }

    const key = `${input.method} ${input.route}`;
    let bucket = this.routes.get(key);
    if (!bucket) {
      if (this.routes.size >= this.maxRoutes) this.evictOldest();
      bucket = {
        method: input.method,
        route: input.route,
        count: 0,
        errors: 0,
        totalMs: 0,
        maxMs: 0,
        samples: [],
        cursor: 0,
        lastSeenAt: at,
      };
      this.routes.set(key, bucket);
    }
    bucket.count += 1;
    bucket.totalMs += input.durationMs;
    if (error) bucket.errors += 1;
    if (input.durationMs > bucket.maxMs) bucket.maxMs = input.durationMs;
    bucket.lastSeenAt = at;
    this.pushSample(bucket, input.durationMs);
  }

  snapshot(): MetricsSnapshot {
    const at = this.now();
    const routes = [...this.routes.values()].map((bucket) => ({
      method: bucket.method,
      route: bucket.route,
      count: bucket.count,
      errors: bucket.errors,
      avgMs: bucket.count ? Math.round((bucket.totalMs / bucket.count) * 10) / 10 : 0,
      p95Ms: Math.round(percentile([...bucket.samples].sort((a, b) => a - b), 0.95) * 10) / 10,
      maxMs: bucket.maxMs,
      lastSeenAt: new Date(bucket.lastSeenAt).toISOString(),
    }));

    let inWindow = 0;
    let peak = 0;
    const currentSecond = Math.floor(at / 1000);
    for (const slot of this.seconds) {
      if (slot.sec >= currentSecond - 59) {
        inWindow += slot.count;
        if (slot.count > peak) peak = slot.count;
      }
    }

    const sortedGlobal = [...this.globalSamples].sort((a, b) => a - b);
    return {
      startedAt: new Date(this.startedAt).toISOString(),
      uptimeSeconds: Math.max(0, Math.round((at - this.startedAt) / 1000)),
      totals: {
        requests: this.requests,
        errors: this.errors,
        errorRatePercent: this.requests
          ? Math.round((this.errors / this.requests) * 1000) / 10
          : 0,
      },
      statusClasses: { ...this.classes },
      throughput: {
        avgPerSecond: Math.round((inWindow / 60) * 10) / 10,
        peakPerSecond: peak,
      },
      latency: {
        avgMs: this.requests ? Math.round((this.totalMs / this.requests) * 10) / 10 : 0,
        p95Ms: Math.round(percentile(sortedGlobal, 0.95) * 10) / 10,
        maxMs: this.maxMs,
      },
      topRoutes: [...routes].sort((a, b) => b.count - a.count).slice(0, 12),
      slowestRoutes: [...routes].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 12),
      trackedRoutes: this.routes.size,
    };
  }

  /** برایِ پنلِ سلامت: حافظه و زمانِ کار (چیزی که آمار به تنهایی نمی‌گوید) */
  process(): { rssMb: number; heapUsedMb: number; uptimeSeconds: number; nodeVersion: string } {
    const usage = process.memoryUsage();
    return {
      rssMb: Math.round(usage.rss / 1_048_576),
      heapUsedMb: Math.round(usage.heapUsed / 1_048_576),
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
    };
  }

  private pushSample(bucket: RouteBucket, durationMs: number): void {
    if (bucket.samples.length < this.sampleSize) {
      bucket.samples.push(durationMs);
      return;
    }
    bucket.samples[bucket.cursor % this.sampleSize] = durationMs;
    bucket.cursor = (bucket.cursor + 1) % this.sampleSize;
  }

  private pushGlobalSample(durationMs: number): void {
    if (this.globalSamples.length < this.globalSampleSize) {
      this.globalSamples.push(durationMs);
      return;
    }
    this.globalSamples[this.globalCursor % this.globalSampleSize] = durationMs;
    this.globalCursor = (this.globalCursor + 1) % this.globalSampleSize;
  }

  /** بیرون راندنِ کهن‌ترین مسیر — پیش از آنکه حافظه از سقف بگذرد */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of this.routes) {
      if (bucket.lastSeenAt < oldestAt) {
        oldestAt = bucket.lastSeenAt;
        oldestKey = key;
      }
    }
    if (oldestKey) this.routes.delete(oldestKey);
  }
}
