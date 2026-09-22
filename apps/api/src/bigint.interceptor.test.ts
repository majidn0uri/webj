import { describe, it, expect } from 'vitest';
import { of } from 'rxjs';
import { BigIntInterceptor } from './bigint.interceptor.js';

/**
 * چرا این آزمون؟ چون شکستِ این میان‌گیر «نمایشی» نیست: اگر BigInt به
 * سریال‌ساز برسد، کار در پایگاه انجام شده ولی پاسخ ۵۰۰ می‌رود؛ کاربر دوباره
 * تلاش می‌کند و آن کار دو بار ثبت می‌شود (دو برگشت از انبار، دو سندِ مالی).
 * پس اینجا درباره‌یِ جلوگیری از یک خطایِ مالیِ تکراری است، نه قالبِ پاسخ.
 */

const interceptor = new BigIntInterceptor();

async function run(data: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    interceptor
      .intercept({} as never, { handle: () => of(data) })
      .subscribe({ next: resolve, error: reject });
  });
}

describe('میان‌گیرِ BigInt', () => {
  it('مبلغِ ریالی را به رشته تبدیل می‌کند تا JSON نشکند', async () => {
    const out = (await run({ totalRial: 1_362_500n, totalToman: 136250 })) as Record<string, unknown>;
    expect(out.totalRial).toBe('1362500');
    expect(typeof out.totalRial).toBe('string');
    expect(out.totalToman).toBe(136250);
  });

  it('در ساختارهایِ تو‌در‌تو و آرایه‌ها هم کار می‌کند', async () => {
    const out = (await run({
      items: [{ priceRial: 10n, qty: 2 }, { priceRial: 20n, qty: 1 }],
      meta: { deep: { deeper: { amount: 99n } } },
    })) as { items: Array<{ priceRial: unknown }>; meta: { deep: { deeper: { amount: unknown } } } };
    expect(out.items[0]!.priceRial).toBe('10');
    expect(out.items[1]!.priceRial).toBe('20');
    expect(out.meta.deep.deeper.amount).toBe('99');
  });

  it('تاریخ و تهی را دست‌نخورده می‌گذارد', async () => {
    const when = new Date('2026-09-16T00:00:00Z');
    const out = (await run({ createdAt: when, note: null, nested: { ok: undefined } })) as {
      createdAt: unknown;
      note: unknown;
    };
    expect(out.createdAt).toBe(when); // همان شیء، نه یک شیءِ تازه
    expect(out.note).toBeNull();
  });

  it('ساختارِ بسیار عمیق یا چرخه‌ای را بی‌پایان دنبال نمی‌کند', async () => {
    const cyclic: Record<string, unknown> = { amount: 5n };
    cyclic.self = cyclic;
    // نباید قفل کند یا از حافظه بیرون بزند؛ توقف در عمقِ مجاز کافی است
    const out = (await run(cyclic)) as Record<string, unknown>;
    expect(out.amount).toBe('5');
  });
});
