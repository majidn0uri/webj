import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

/**
 * تبدیلِ سراسریِ BigInt به رشته در پاسخ‌ها.
 *
 * چرا لازم شد؟ چون همه‌ی مبالغ در این سامانه BIGINT (ریال) هستند و JSON
 * نمی‌تواند BigInt را سریال کند. اگر جایی یادمان برود آن را به رشته
 * تبدیل کنیم، رفتارِ سامانه چنین است:
 *
 *   کار در پایگاه انجام می‌شود  →  تراکنش «تعهد» می‌شود
 *   →  پاسخ به خطایِ ۵۰۰ می‌خورد  →  کاربر دوباره تلاش می‌کند
 *   →  کار دو بار انجام می‌شود (دو برگشت، دو سند، دو رزرو).
 *
 * یعنی یک اشتباهِ کوچکِ نمایشی، به خطایِ مالی تبدیل می‌شود. این میان‌گیر
 * آن رده را می‌بندد: هر BigInt در هر پاسخ، به رشته تبدیل می‌شود — با حفظِ
 * دقت، چون رشته است و در جاوااسکریپت هم گرد نمی‌شود.
 *
 * چرا «رشته» و نه «عدد»؟ چون مبلغ‌ها از ۲^۵۳ بزرگ‌تر می‌شوند و تبدیل به
 * Number یعنی از دست رفتنِ رقم‌هایِ پایانی؛ رشته امن است و سمتِ مرورگر با
 * همان قالب‌بندیِ تومان نمایش داده می‌شود.
 */
function normalize(value: unknown, depth = 0): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || value === undefined) return value;
  // تاریخ و بافر باید دست‌نخورده بمانند (تبدیلشان به شیء، خروجی را خراب می‌کند)
  if (value instanceof Date || value instanceof Buffer) return value;
  // بازگشت‌گریِ عمیق محدود است: پاسخِ سامانه قرار نیست گرافِ بی‌انتها باشد،
  // و همین محدودیت جلویِ قفل شدنِ فرآیند بر اثرِ ارجاعِ چرخه‌ای را می‌گیرد.
  if (Array.isArray(value)) return depth > 12 ? value : value.map((v) => normalize(v, depth + 1));
  if (typeof value === 'object') {
    if (depth > 12) return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = normalize(v, depth + 1);
    }
    return out;
  }
  return value;
}

@Injectable()
export class BigIntInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => normalize(data)));
  }
}
