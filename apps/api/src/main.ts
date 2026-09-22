import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import Fastify from 'fastify';
import compress from '@fastify/compress';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { AppModule } from './app.module.js';
import { AppErrorFilter } from './app-error.filter.js';
import { BigIntInterceptor } from './bigint.interceptor.js';
import { registerMediaRoutes } from './media-routes.js';
import { attachClientIp } from './client-ip-hook.js';
import { registerObservability } from './observability.js';
import { MAX_UPLOAD_BYTES } from '@set/media';
import { corsOrigins, type AppConfig } from './config.js';
import { CONFIG, DB, RATE_LIMITER, METRICS } from './tokens.js';
import type { Database } from '@set/db';
import type { MetricsRegistry } from '@set/observability';
import type { RateLimitBundle } from './rate-limit.js';

async function bootstrap(): Promise<void> {
  // ─────────────────────────────────────────────────────────────────────────
  // نمونه‌یِ fastify را خودمان می‌سازیم، پیش از آنکه نست مسیرها را بنشاند.
  //
  // چرا؟ چون افزونه‌یِ multipart یک «زمینه‌یِ بسته‌بندیِ تازه» می‌سازد. اگر آن
  // را پس از ثبتِ مسیرها ثبت می‌کردیم، مسیرها دکوراتورِ `req.file()` را نمی‌دیدند
  // و هر بارگذاری با خطایِ «isMultipart is not a function» شکست می‌خورد.
  // ─────────────────────────────────────────────────────────────────────────
  // `trustProxy: false` به‌عمد. پیش‌تر `true` بود، و `true` در fastify یعنی
  // «نخستینِ مقدارِ X-Forwarded-For را باور کن» — یعنی نشانی‌ای که خودِ
  // کلاینت نوشته است. با آن، مهارِ نرخِ «بر حسبِ نشانی» با یک سرآیند جعلی
  // بی‌اثر می‌شد و لاگِ امنیتی جعلی. نشانیِ درست (از پروکسیِ قابلِ اعتماد) را
  // خودمان در `attach-client-ip` می‌خوانیم؛ سند: `apps/api/src/client-ip.ts`.
  const instance: FastifyInstance = Fastify({ bodyLimit: 1_048_576, trustProxy: false });

  // فشرده‌سازیِ پاسخ‌هایِ متنی (JSON و …) با brotli/gzip.
  // فیلتر پیش‌فرض افزونه فقط محتوای فشرده‌پذیر (json/html/css/svg)
  // فشرده می‌شوند: تصویرها از پیش فشرده‌اند و استریمِ /media دست‌نخورده می‌ماند.
  // آستانه‌یِ ۱KB: فشرده‌کردنِ پاسخ‌هایِ تودرتی وقتِ سی‌پی‌یو می‌گیرد و فایده ندارد.
  await instance.register(compress, {
    threshold: 1024,
    encodings: ['br', 'gzip'],
  });

  await instance.register(multipart, {
    limits: {
      // اندازه‌یِ فایل را خودِ افزونه مهار می‌کند: پیش از آنکه کلِ تصویر به
      // حافظه برسد، بارگیری قطع می‌شود.
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
      fields: 4,
    },
  });

  // تصویرها پیش از مسیرهایِ نست ثبت می‌شوند تا با کمترین میانجی سرو شوند
  await registerMediaRoutes(instance);

  // نگاشتِ نوع: نمونه‌ای که خودمان ساخته‌ایم همان چیزی است که نست می‌پذیرد؛
  // تفاوت فقط در «نسخه‌یِ نوع» است (دو بسته به یک نسخه ارجاع می‌دهند اما
  // تایپ‌اسکریپت آن‌ها را یکی نمی‌بیند).
  const adapter = new FastifyAdapter(
    instance as unknown as ConstructorParameters<typeof FastifyAdapter>[0],
  );

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: ['error', 'warn', 'log'],
  });

  const config = app.get<AppConfig>(CONFIG);

  // ─────────────────────────────────────────────────────────────────────────
  // دیده‌بانی و مهارِ بار
  //
  // این قلاب‌ها باید پس از ساخته شدنِ نست بسته شوند، چون به پایگاه‌داده و
  // مهارگر نیاز دارند — و هر دو را خودِ نست می‌سازد (با اعمالِ مهاجرت‌ها).
  // بستنشان پیش از `listen` یعنی نخستین درخواست هم از همان ابتدا اندازه
  // گرفته و مهار می‌شود، نه از درخواستِ دوم.
  //
  // ترتیب: نخست ردیابی و مهار (پیش از هر کارِ دیگری)، سپس اندازه‌گیری در
  // هنگامِ پاسخ.
  // ─────────────────────────────────────────────────────────────────────────
  // نشانیِ بازدیدکننده **پیش از** همه‌چیز: هم مهارِ نرخ به آن نیاز دارد و هم
  // لاگ/ردیابی. بی‌این قلاب، `request.ip` نشانیِ پروکسی (یا نخستینِ سرآیندِ
  // جعلیِ کلاینت) می‌شد.
  attachClientIp(instance, config);

  const database = app.get<Database>(DB);
  const rateLimits = app.get<RateLimitBundle | null>(RATE_LIMITER);
  const metrics = app.get<MetricsRegistry>(METRICS);

  registerObservability(instance, {
    config,
    metrics,
    db: database,
    limiter: rateLimits?.limiter,
    rules: rateLimits?.rules,
  });

  app.useGlobalFilters(new AppErrorFilter(config));
  // هر پاسخ از این میان‌گیر می‌گذرد: هیچ BigIntی به سریال‌ساز نمی‌رسد
  app.useGlobalInterceptors(new BigIntInterceptor());
  // ─────────────────────────────────────────────────────────────────────────
  // مبدأهایِ مجاز: نه «همه»، که «فقط فروشگاه خودمان».
  //
  // `origin: true` یعنی «هر مبدأیی که درخواست داد همان را بازتاب بده»؛ همراه
  // با `credentials: true` یعنی هر سایتی در دنیا می‌تواند با کوکیِ نشستِ
  // کاربرِ واردشده از API بخواند بازتابِ مبدأ هم تصادفاً دقیقاً همان چیزی را
  // دور می‌زند که سیاستِ هم‌مبدأیی قرار بود جلویش را بگیرد.
  //
  // پس فهرستِ سفید: به‌طورِ پیش‌فرض همان `APP_URL`، و اگر مدیر نیاز دارد،
  // از `CORS_ORIGINS` (با ویرگول جدا).
  // ─────────────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: corsOrigins(config),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-set-internal', 'idempotency-key'],
    maxAge: 600,
  });

  // در توسعه برای دسترسی از بیرونِ محیطِ اجرا روی همه‌ی واسط‌ها گوش می‌دهد؛
  // در تولید باید پشتِ nginx و فقط روی لوکال‌هاست باشد (API_HOST=127.0.0.1).
  await app.listen({ port: config.PORT, host: config.API_HOST });

  console.log(`ست‌شاپ API روی ${config.API_HOST}:${config.PORT} گوش می‌دهد.`);
  console.log(`مسیرهای در دسترس: GET /health , GET /health/ready`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`دریافت ${signal} — خروجِ ایمن…`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
