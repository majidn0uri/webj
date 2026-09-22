/**
 * لاگِ ساخت‌یافته — یک خطِ JSON به‌ازایِ هر درخواست.
 *
 * چرا JSON و نه یک جمله‌یِ دل‌نشین؟ چون خواننده‌یِ این لاگ آدم نیست: یک
 * گردآورنده (مانندِ Loki یا یک اسکریپتِ ساده‌یِ jq) است که باید بتواند
 * بدون حدس زدن، «مسیر» و «زمان» و «وضعیت» را جدا کند. جمله‌یِ دل‌نشین برای
 * آدم خوب است — آن را پنل نشان می‌دهد، نه لاگ.
 *
 * چرا نوشتن از بیرون تزریق می‌شود (`write`)? چون:
 *   • در برنامه، مقصد «خروجیِ استاندارد» است (تا هر سامانه‌یِ گردآوری آن را
 *     بگیرد)؛
 *   • در آزمون، مقصد یک آرایه است — پس می‌توان درستیِ لاگ را بی‌هیچ
 *     میان‌گیری بررسی کرد؛
 *   • و چون قانونِ پروژه می‌گوید در بسته‌ها `console.log` نباشد.
 *
 * امنیت: لاگ هرگز بدنه‌یِ درخواست، کوکی یا توکن را نمی‌نویسد. نشانیِ IP در
 * لاگ هست (برایِ ردیابیِ سوءاستفاده) اما در سامانه‌ای که تمامِ مشتریانش در
 * ایران‌اند، این همان چیزی است که برایِ پیگیریِ سفارشِ جعلی لازم است.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface RequestLogLine {
  at: string;
  level: LogLevel;
  /** شناسه‌یِ ردیابی — همان که در پاسخ هم هست، تا بتوان لاگ و شکایتِ مشتری را به هم دوخت */
  traceId: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  ip: string;
  outcome: 'ok' | 'redirect' | 'client-error' | 'blocked' | 'error';
  /** نامِ قاعده‌یِ مهارِ بار، فقط وقتی درخواست مسدود شده */
  rule?: string;
  /** پیام — فقط برایِ خطاها یا رویدادهایِ غیرعادی */
  message?: string;
}

/** برچسبِ سطح بر پایه‌یِ سرشتِ پاسخ، نه فقط کدش */
export function outcomeOf(status: number, blocked = false): RequestLogLine['outcome'] {
  if (blocked) return 'blocked';
  if (status >= 500) return 'error';
  if (status === 429) return 'blocked';
  if (status >= 400) return 'client-error';
  if (status >= 300) return 'redirect';
  return 'ok';
}

export function levelOf(outcome: RequestLogLine['outcome']): LogLevel {
  if (outcome === 'error') return 'error';
  if (outcome === 'blocked' || outcome === 'client-error') return 'warn';
  return 'info';
}

export function formatRequestLog(line: RequestLogLine): string {
  // ترتیبِ کلیدها ثابت است: هم برایِ خوانایی و هم برایِ این‌که تفاوتِ دو خط
  // در مرورگرِ لاگ، معنایش «تغییرِ مقدار» باشد نه «تغییرِ ترتیب».
  const payload: Record<string, unknown> = {
    at: line.at,
    level: line.level,
    outcome: line.outcome,
    method: line.method,
    route: line.route,
    status: line.status,
    durationMs: line.durationMs,
    ip: line.ip,
    traceId: line.traceId,
  };
  if (line.rule) payload.rule = line.rule;
  if (line.message) payload.message = line.message;
  return JSON.stringify(payload);
}

export interface RequestLogger {
  request(line: Omit<RequestLogLine, 'at' | 'level'>): void;
  /** رویدادِ غیرعادیِ بی‌ارتباط با یک درخواست (مثلِ از کار افتادنِ پایگاهِ مهارگر) */
  event(level: LogLevel, message: string, extra?: Record<string, unknown>): void;
}

export function createRequestLogger(write: (line: string) => void): RequestLogger {
  return {
    request(line) {
      const outcome = line.outcome;
      write(formatRequestLog({ ...line, at: new Date().toISOString(), level: levelOf(outcome) }));
    },
    event(level, message, extra) {
      write(
        JSON.stringify({
          at: new Date().toISOString(),
          level,
          outcome: 'event',
          message,
          ...(extra ?? {}),
        }),
      );
    },
  };
}
