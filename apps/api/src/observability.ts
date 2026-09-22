import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';

import {
  recordBlocked,
  ruleForRoute,
  type Queryable,
  type RateLimiter,
  type RateRule,
} from '@set/rate-limit';
import { MetricsRegistry, createRequestLogger, type RequestLogger } from '@set/observability';

import type { AppConfig } from './config.js';
import { sessionKeyOf } from './rate-limit.js';

/**
 * دیده‌بانی و مهارِ بار — در سه قلاب (Hook) رویِ فستی‌فای.
 *
 * چرا قلاب و نه یک میان‌گیرِ نست (Interceptor)؟ چون آنچه اینجا اندازه گرفته
 * می‌شود باید **همه‌یِ** درخواست‌ها را ببیند: درخواستی که به مسیرِ درست
 * نرسیده (۴۰۴)، درخواستی که در میانه رد شده (۴۲۹)، و حتی تصویری که مستقیماً
 * از دیسک سِرو می‌شود. میان‌گیرهایِ نست فقط اطرافِ کنترلرهایِ نست‌اند؛
 * قلاب‌هایِ فستی‌فای یک پله پایین‌تر و فراگیرترند.
 *
 * ترتیبِ کار در هر درخواست:
 *   ۱. `onRequest`  — شناسه‌یِ ردیابی، زمان‌سنج، و مهارِ بار؛
 *   ۲. `onResponse` — اندازه‌گیری، لاگ، و سرآیندهایِ آگاهی‌بخش.
 */

/** آنچه در طولِ یک درخواست به یاد می‌ماند (رویِ خودِ شیءِ درخواست) */
interface RequestTrace {
  traceId: string;
  startedAt: bigint;
  decision?: {
    rule: string;
    allowed: boolean;
    limit: number;
    remaining: number;
    retryAfterSeconds: number;
    resetAt: Date;
    bucketKey: string;
  };
}

const TRACE = Symbol('set.trace');

function traceOf(request: FastifyRequest): RequestTrace | undefined {
  return (request as unknown as Record<symbol, RequestTrace | undefined>)[TRACE];
}

function pathOf(request: FastifyRequest): string {
  // الگویِ مسیر (`/products/:slug`) اگر مسیریابی انجام شده باشد؛ وگرنه مسیرِ خام.
  // الگو مهم است: اگر مسیرِ واقعی مبنا بود، هر کالا آمارِ خودش را می‌ساخت و
  // «کندترین مسیر» هیچ‌وقت دیده نمی‌شد.
  const pattern = request.routeOptions?.url;
  const raw = (pattern ?? request.url ?? '/').split('?')[0] ?? '/';
  return raw;
}

function isMonitorPath(path: string): boolean {
  return path === '/health' || path.startsWith('/health/');
}

export interface ObservabilityDeps {
  config: AppConfig;
  metrics: MetricsRegistry;
  db: Queryable;
  limiter?: RateLimiter;
  rules?: () => Promise<readonly RateRule[]>;
  logger?: RequestLogger;
}

export function registerObservability(
  instance: FastifyInstance,
  deps: ObservabilityDeps,
): { metrics: MetricsRegistry; logger: RequestLogger } {
  const logger = deps.logger ?? createRequestLogger((line) => process.stdout.write(`${line}\n`));
  const { metrics, config, limiter, rules, db } = deps;

  instance.addHook('onRequest', async (request, reply) => {
    const trace: RequestTrace = { traceId: randomUUID(), startedAt: process.hrtime.bigint() };
    (request as unknown as Record<symbol, RequestTrace>)[TRACE] = trace;
    // همان شناسه رویِ خودِ درخواست: صافیِ خطا (`AppErrorFilter`) آن را از
    // اینجا می‌خواند. دو جا نگه داشتنش تکرار است، اما جایگزینش این است که
    // خطاها بی‌شناسه بمانند — و بی‌شناسه یعنی بی‌ردیابی.
    (request as unknown as { traceId: string }).traceId = trace.traceId;

    // سرآیندِ پاسخ: هر پاسخی — حتی خطا — شناسه‌یِ ردیابی دارد تا پشتیبانی
    // بتواند شکایتِ مشتری را به خطِ لاگ بدوزد.
    void reply.header('x-trace-id', trace.traceId);

    if (!limiter) return;

    const path = pathOf(request);
    if (isMonitorPath(path)) return;

    const ruleName = ruleForRoute(request.method, path);
    if (!ruleName) return;

    const rule = rules ? (await rules()).find((r) => r.name === ruleName) : undefined;

    // تماسِ درونی (وب → API): از سقف‌هایِ حاشیه‌ای معاف است.
    // چرا فقط حاشیه‌ای؟ چون آن‌ها با «نشانی» شمرده می‌شوند و نشانیِ همه‌یِ
    // خریداران در لایه‌یِ وب یکی است.
    //
    // و سقف‌هایِ کسب‌وکاری؟ دقیق‌تر از آنچه یک‌زمان نوشته بودیم: با «نشست»
    // شمرده می‌شوند **اگر** نشستی باشد. خریدارِ واردنشده نشست ندارد، و سطلش
    // `ip::` می‌شود؛ پس بی‌نشانیِ واقعیِ مشتری، همه‌یِ خریدارانِ فروشگاه در یک
    // سطلِ واحد می‌نشینند (۱۰ سفارش در ساعت، برایِ کلِ فروشگاه — اندازه
    // گرفته‌شده در `--mix checkout`). راهِ درست، عبورِ نشانیِ مشتری از لایه‌یِ
    // وب است: `x-set-client-ip`، که تنها با کلیدِ درونی پذیرفته می‌شود
    // (`client-ip.ts`).
    const internalToken = config.INTERNAL_API_TOKEN;
    const presented = request.headers['x-set-internal'];
    const isInternal = internalToken !== '' && presented === internalToken;
    if (isInternal && (rule?.store ?? 'memory') === 'memory') return;

    const ip = request.ip || 'ناشناس';
    const decision = await limiter.check(
      ruleName,
      { ip, sessionKey: sessionKeyOf(request.headers as { authorization?: string; cookie?: string }) },
      new Date(),
    );
    trace.decision = decision;

    void reply.header('x-ratelimit-limit', String(decision.limit));
    void reply.header('x-ratelimit-remaining', String(decision.remaining));
    void reply.header(
      'x-ratelimit-reset',
      String(Math.floor(decision.resetAt.getTime() / 1000)),
    );

    if (decision.allowed || decision.limit === 0) return;

    // مسدود: پاسخِ ۴۲۹ با همان قالبِ خطایِ همیشگیِ سامانه
    void reply.header('retry-after', String(decision.retryAfterSeconds));
    void reply
      .status(429)
      .send({
        error: {
          code: 'RATE_LIMITED',
          key: 'rate_limited',
          message: `شمارِ درخواست‌هایِ شما از اندازه گذشت. ${decision.retryAfterSeconds} ثانیه‌یِ دیگر دوباره تلاش کنید.`,
          details: {
            rule: decision.rule,
            limit: decision.limit,
            retryAfterSeconds: decision.retryAfterSeconds,
            windowSeconds: rule?.windowSeconds ?? null,
          },
          traceId: trace.traceId,
        },
      });

    // ردِّ مسدودشدن فقط برایِ قاعده‌هایِ پایگاهی ثبت می‌شود: ثبتِ هر
    // مسدودشدنِ حاشیه‌ای یعنی یک نوشتن در پایگاه به‌ازایِ هر درخواستِ حمله —
    // یعنی مهارگر خودش ابزارِ فشار می‌شد.
    if ((rule?.store ?? 'memory') === 'db') {
      void recordBlocked(db, {
        rule: decision.rule,
        bucketKey: decision.bucketKey,
        windowStartedAt: new Date(decision.resetAt.getTime() - (rule?.windowSeconds ?? 60) * 1000),
        ip,
        method: request.method,
        path,
        traceId: trace.traceId,
      });
    }
  });

  instance.addHook('onResponse', async (request, reply) => {
    const trace = traceOf(request);
    const startedAt = trace?.startedAt ?? process.hrtime.bigint();
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const rounded = Math.round(durationMs * 10) / 10;
    const path = pathOf(request);
    const status = reply.statusCode;

    void reply.header('x-response-time', String(rounded));

    // مسیرِ نگهبان در آمار نمی‌آید: آماری که خودِ نگهبان می‌سازد، جایِ
    // آماری را که قرار است ببیند تنگ می‌کند.
    if (!isMonitorPath(path)) {
      metrics.record({ method: request.method, route: path, status, durationMs: rounded });
    }

    if (!config.REQUEST_LOG) return;
    if (isMonitorPath(path)) return;

    logger.request({
      traceId: trace?.traceId ?? 'بدون-ردیابی',
      method: request.method,
      route: path,
      status,
      durationMs: rounded,
      ip: request.ip || 'ناشناس',
      outcome:
        status === 429
          ? 'blocked'
          : status >= 500
            ? 'error'
            : status >= 400
              ? 'client-error'
              : status >= 300
                ? 'redirect'
                : 'ok',
      ...(trace?.decision && !trace.decision.allowed ? { rule: trace.decision.rule } : {}),
    });
  });

  return { metrics, logger };
}

/** برایِ آزمون‌پذیری و برایِ پنل: ساختِ قطعات به‌صورتِ جدا */
export function createObservabilityKit(config: AppConfig): {
  metrics: MetricsRegistry;
  logger: RequestLogger;
} {
  return {
    metrics: new MetricsRegistry(),
    logger: createRequestLogger((line) => {
      if (config.REQUEST_LOG) process.stdout.write(`${line}\n`);
    }),
  };
}

export type { FastifyReply };
