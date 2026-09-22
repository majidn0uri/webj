import { describe, expect, it } from 'vitest';
import { PaymentService } from '@set/payments';
import { sandboxAllowed } from './payments.controller.js';

/**
 * آزمونِ «تطابقِ دو نگهبان».
 *
 * آنچه می‌شکند اگر این نباشد: مسیرِ HTTPِ تصمیمِ درگاهِ آزمایشی و خودِ سرویسِ
 * پرداخت، هر دو «آیا شبیه‌ساز آزاد است؟» را می‌پرسند. اگر یکی سخت‌تر باشد،
 * پیامکِ خطا «۴۰۳» است و آدم به‌جایِ پیدا‌کردنِ ناسازگاری، سراغِ کلیدِ درگاه
 * می‌رود — و رویِ یک نصبِ تازهٔ توسعه، هیچ آزمونی نمی‌شود.
 */
describe('sandboxAllowed — همان قاعده‌ای که سرویس می‌خواند', () => {
  const cases: Array<[string, string, '1' | '0', boolean]> = [
    ['توسعه، بی‌کلید', 'development', '0', true],
    ['آزمون، بی‌کلید', 'test', '0', true],
    ['تولید، بی‌کلید', 'production', '0', false],
    ['تولید، با کلیدِ صریح', 'production', '1', true],
  ];

  for (const [label, nodeEnv, flag, expected] of cases) {
    it(label, () => {
      expect(sandboxAllowed({ PAYMENT_ALLOW_SANDBOX: flag === '1', NODE_ENV: nodeEnv })).toBe(expected);
    });
  }

  it('با `PaymentService.config()` یکی است (هر دو از یک env)', () => {
    const saved = { nodeEnv: process.env.NODE_ENV, flag: process.env.PAYMENT_ALLOW_SANDBOX };
    try {
      for (const nodeEnv of ['development', 'test', 'production']) {
        for (const flag of ['1', '0', undefined]) {
          process.env.NODE_ENV = nodeEnv;
          if (flag === undefined) delete process.env.PAYMENT_ALLOW_SANDBOX;
          else process.env.PAYMENT_ALLOW_SANDBOX = flag;

          const svc = new PaymentService(null as never).config('http://localhost:3100');
          expect(svc.allowSandbox).toBe(
            sandboxAllowed({ PAYMENT_ALLOW_SANDBOX: flag === '1', NODE_ENV: nodeEnv }),
          );
        }
      }
    } finally {
      if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved.nodeEnv;
      if (saved.flag === undefined) delete process.env.PAYMENT_ALLOW_SANDBOX;
      else process.env.PAYMENT_ALLOW_SANDBOX = saved.flag;
    }
  });
});
