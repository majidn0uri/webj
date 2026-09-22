import { describe, expect, it } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { AppErrorFilter } from './app-error.filter.js';

/**
 * یک «هاستِ ساختگی» تا بتوان خروجیِ فیلتر را بدون بالا آوردنِ سرورِ واقعی سنجید.
 * هدف: قفل‌کردنِ قراردادِ کدهای وضعیت (بخش Y) —
 * ۴۰۰ اعتبارسنجی · ۴۲۲ قاعده‌ی کسب‌وکار · ۴۰۹ تکراری · ۵۰۰ فقط خطایِ واقعاً داخلی.
 */
function fakeHost(traceId = 'trace-1') {
  const sent: { status?: number; body?: unknown } = {};
  const reply = {
    status(code: number) {
      sent.status = code;
      return {
        send(body: unknown) {
          sent.body = body;
        },
      };
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({ traceId }),
    }),
  } as unknown as ArgumentsHost;
  return { host, sent };
}

const filter = new AppErrorFilter({ NODE_ENV: 'test' } as never);

function run(exception: unknown) {
  const { host, sent } = fakeHost();
  filter.catch(exception, host);
  return sent;
}

function dbError(code: string) {
  return Object.assign(new Error(`خطای پایگاه‌داده ${code}`), { code });
}

function body(sent: { body?: unknown }): Record<string, never> {
  return (sent.body as { error: Record<string, never> }).error;
}

describe('فیلترِ خطا — ترجمه‌ی خطاهای خام به قراردادِ پاسخ', () => {
  it('قالبِ نامعتبر (مانندِ uuidِ خراب در نشانی) را ۴۰۰ می‌دهد، نه ۵۰۰', () => {
    // پیش از این یک شناسه‌ی بد مانند /orders/None باعث می‌شد
    // پایگاه‌داده کد 22P02 پرتاب کند و کاربر «خطای داخلی» ببیند.
    const sent = run(dbError('22P02'));
    expect(sent.status).toBe(400);
    expect(body(sent).code).toBe('ERR-001');
    expect(String(body(sent).message)).toContain('قالب');
  });

  it('مقدارِ تکراری (۲۳۵۰۵) را ۴۰۹ می‌دهد', () => {
    expect(run(dbError('23505')).status).toBe(409);
  });

  it('کلیدِ خارجیِ نامعتبر (۲۳۵۰۳) را ۴۰۰ می‌دهد، نه ۵۰۰', () => {
    expect(run(dbError('23503')).status).toBe(400);
  });

  it('نقضِ قید (۲۳۵۱۴) را ۴۰۰ می‌دهد', () => {
    expect(run(dbError('23514')).status).toBe(400);
  });

  it('خطای ناشناخته را ۵۰۰ می‌دهد، با traceId و بدون نشتِ پیامِ داخلی', () => {
    const sent = run(new Error('boom-interno'));
    expect(sent.status).toBe(500);
    expect(body(sent).traceId).toBe('trace-1');
    expect(JSON.stringify(sent.body)).not.toContain('boom-interno');
  });

  it('هر پاسخِ خطا traceId دارد تا در لاگ قابل پیگیری باشد', () => {
    expect(body(run(dbError('22P02'))).traceId).toBe('trace-1');
  });
});
