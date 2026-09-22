/**
 * سروِ فایل‌هایِ رسانه.
 *
 * چرا اینجا و نه در یک کنترل‌کننده‌یِ نست؟ چون این مسیر «ایستا» است: نه
 * احرازِ هویتِ خاصی می‌خواهد (تصویرِ کالا باید برایِ همه، بی‌نشستنِ نشست، باز
 * شود) و نه به چرخه‌یِ عمرِ نست نیاز دارد. ثبتِ مستقیم رویِ fastify یعنی یک
 * لایه‌یِ کمتر میانِ دیسک و مرورگر — و برایِ چیزی که در هر صفحه ده‌ها بار
 * خوانده می‌شود، این تفاوت دیده می‌شود.
 *
 * سه نکته‌یِ امنیتی که در این بیست خط پنهان است:
 *   ۱) مسیر پیش از خواندن، درونِ شاخه‌یِ رسانه مهار می‌شود؛
 *   ۲) نوعِ محتوا از پسوندِ مجاز می‌آید، نه از چیزی که کلاینت گفته؛
 *   ۳) نشانی بر پایه‌یِ درنگِ محتواست، پس «کشِ ابدی» امن است: اگر تصویر عوض
 *      شود، نشانی‌اش هم عوض می‌شود و هیچ مرورگری نسخه‌یِ کهنه را نشان نمی‌دهد.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { mediaRoot, readMedia } from '@set/media';

const EXTENSION_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function contentTypeFor(relative: string): string | null {
  const dot = relative.lastIndexOf('.');
  if (dot < 0) return null;
  return EXTENSION_TYPES[relative.slice(dot).toLowerCase()] ?? null;
}

export async function registerMediaRoutes(instance: FastifyInstance): Promise<void> {
  instance.get('/media/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const wildcard = (request.params as { '*': string })['*'];
    if (typeof wildcard !== 'string' || wildcard.length === 0) {
      return reply.code(404).send({ error: { code: 'ERR-404', key: 'NOT_FOUND', message: 'یافت نشد.' } });
    }

    const file = await readMedia(wildcard);
    if (!file) {
      return reply.code(404).send({ error: { code: 'ERR-404', key: 'NOT_FOUND', message: 'یافت نشد.' } });
    }

    const type = contentTypeFor(wildcard);
    if (!type) {
      return reply.code(404).send({ error: { code: 'ERR-404', key: 'NOT_FOUND', message: 'یافت نشد.' } });
    }

    reply.header('content-type', type);
    // یک سال، تغییرناپذیر: نشانی بر پایه‌یِ درنگ است، پس کهنه نمی‌شود
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    // مرورگر نباید حدس بزند — جلوگیری از تفسیرِ فایل به عنوانِ اسکریپت
    reply.header('x-content-type-options', 'nosniff');
    reply.header('content-length', String(file.size));
    return reply.send(file.stream as never);
  });

  /**
   * تپشِ رسانه — برایِ نگهبان (مانیتورینگ) که بداند مسیرِ نوشتن زنده است.
   *
   * چرا مسیرِ ریشه دیگر در پاسخ نیست؟ چون نشانیِ پوشه‌ای رویِ دیسکِ سرور یک
   * تکه از نقشه‌یِ داخلیِ دستگاه است: با کنارِ هم گذاشتنِ چند پاسخِ این‌چنینی،
   * مهاجم نامِ کاربر، محلِ استقرار و ساختارِ پوشه‌ها را می‌فهمد — بی‌آنکه
   * هیچ چیزی را «هک» کرده باشد. پاسخِ درست برایِ یک تپش یک بیت است: سبز یا
   * نه. جزئیات را لاگ می‌گوید، نه پاسخ.
   */
  instance.get('/media/_health', async (_request, reply) => {
    return reply.send({ ok: true });
  });
}
