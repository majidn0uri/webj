import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, Inject,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, isAppError } from '@set/shared-kernel';
import { ZodError } from 'zod';
import { type AppConfig } from './config.js';
import { CONFIG } from './tokens.js';

/**
 * همه‌ی خطاها به یک شکلِ واحد برمی‌گردند: { error: { code, message, traceId } } (بخش Y).
 * هیچ خطای داخلی بدون ردیابی (traceId) به کاربر نمی‌رسد و هیچ استک‌تِریسی نشت نمی‌کند.
 */
@Catch()
export class AppErrorFilter implements ExceptionFilter {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest & { id?: string; traceId?: string }>();
    const traceId = request?.traceId ?? request?.id ?? 'بدون-ردیابی';

    const appError = this.toAppError(exception);
    const status = appError.http;

    if (status >= 500) {
      // خطای داخلی: لاگِ کامل در سرور، پیامِ عمومی برای کاربر
      console.error(`[${appError.code}] traceId=${traceId}`, exception);
    }

    void reply.status(status).send({
      error: {
        code: appError.code,
        key: appError.key,
        // پیام را تنها برایِ خطایِ داخلی (۵xx) می‌پوشانیم. خطایِ ۴xx را
        // خودمان برایِ کاربر نوشته‌ایم — «شما پیش از این درباره‌ی این کالا
        // نوشته‌اید» — و پوشاندنش در تولید یعنی کاربر به‌جایِ راهنما یک
        // جمله‌یِ بی‌ربط می‌بیند. در برابر، پیامِ خطایِ داخلی ممکن است
        // متنِ پایگاه یا مسیرِ پرونده باشد؛ آن را پنهان می‌کنیم.
        message:
          status >= 500 && this.config.NODE_ENV === 'production' ? appError.fa : appError.message,
        details: appError.details ?? null,
        traceId,
      },
    });
  }

  private toAppError(exception: unknown): AppError {
    if (isAppError(exception)) return exception;

    // خطای اعتبارسنجیِ zod → ۴۲۲ با جزئیاتِ هر فیلد، نه ۵۰۰
    if (exception instanceof ZodError) {
      return new AppError('VALIDATION', {
        message: 'داده‌های ارسالی معتبر نیست.',
        // قالبِ details آرایه است — همان‌طور که در بخشِ Y سند آمده
        details: exception.issues.map((issue) => ({
          field: issue.path.join('.') || '(ریشه)',
          message: faZodMessage(issue),
        })),
      });
    }

    // نقضِ قیدهای پایگاه‌داده → خطای ۴۲۲ با پیامِ روشن، نه ۵۰۰
    const dbError = exception as { code?: string; constraint?: string; detail?: string } | null;
    if (dbError && typeof dbError.code === 'string') {
      if (dbError.code === '23503') {
        return new AppError('VALIDATION', {
          message: 'یکی از شناسه‌های ارسالی به رکوردی معتبر اشاره نمی‌کند (کلید خارجی).',
          details: { constraint: dbError.constraint ?? null, dbCode: dbError.code },
        });
      }
      // 22P02 = قالبِ نامعتبر (مثلاً شناسه‌ای که uuid نیست).
      // بدون این شاخه، یک شناسه‌ی بد در نشانی به‌جای ۴۰۰، خطای ۵۰۰ می‌داد — نقضِ قراردادِ کدهای وضعیت (بخش Y).
      if (dbError.code === '22P02') {
        return new AppError('VALIDATION', {
          message: 'قالبِ یکی از مقادیر ارسالی با نوعِ مورد انتظار سازگار نیست.',
          details: { dbCode: dbError.code, hint: 'معمولاً شناسه معتبر نیست' },
        });
      }
      if (dbError.code === '23505') {
        return new AppError('CONFLICT', {
          message: 'این مقدار از قبل ثبت شده و تکراری است.',
          details: { constraint: dbError.constraint ?? null, dbCode: dbError.code },
        });
      }
      if (dbError.code === '23514') {
        return new AppError('VALIDATION', {
          message: 'مقدارِ واردشده با قوانینِ پایگاه‌داده سازگار نیست.',
          details: { constraint: dbError.constraint ?? null, dbCode: dbError.code },
        });
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const key =
        status === 404 ? 'NOT_FOUND'
        : status === 401 ? 'UNAUTHENTICATED'
        : status === 403 ? 'FORBIDDEN'
        : status === 400 ? 'VALIDATION'
        : 'INTERNAL';
      return new AppError(key as never, { message: exception.message });
    }
    return new AppError('INTERNAL');
  }
}

/** پیام‌های فارسی برای خطاهایِ رایجِ اعتبارسنجی */
function faZodMessage(issue: { code: string; message: string; minimum?: unknown }): string {
  switch (issue.code) {
    case 'too_small': return `باید دست‌کم ${issue.minimum} کاراکتر یا مقدار داشته باشد`;
    case 'too_big': return 'بیش از حدِ مجاز است';
    case 'invalid_string': return 'قالبِ مقدار معتبر نیست';
    case 'invalid_type': return 'نوعِ مقدار اشتباه است';
    case 'invalid_enum_value': return 'مقدار انتخابی مجاز نیست';
    default: return 'مقدار نامعتبر است';
  }
}
