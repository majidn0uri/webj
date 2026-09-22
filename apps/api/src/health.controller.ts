import { Controller, Get, Inject } from '@nestjs/common';
import { type AppConfig } from './config.js';
import { CONFIG, DB } from './tokens.js';
import type { Database } from '@set/db';
import { getAppliedVersions } from '@set/db';
import { effectiveVatBasisPoints } from '@set/orders';
import { formatJalaliLong, jalaliToday } from '@set/shared-kernel';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * زنده‌بودنِ فرآیند — بدون وابستگیِ خارجی.
   *
   * حافظه اینجا گزارش می‌شود چون در این معماری پایگاه‌داده (PGlite) درونِ همین
   * فرآیند است و حافظه‌اش روی همین شمارنده می‌افتد. دیدنِ روندِ آن تنها راهِ
   * پیش‌بینیِ «هنگ» است: وقتی حافظه پر شود، حلقهٔ رویداد قفل می‌کند و
   * هیچ خطایی پیش از آن ثبت نمی‌شود.
   */
  @Get()
  liveness() {
    const usage = process.memoryUsage();
    const rssMb = Math.round(usage.rss / 1_048_576);
    const heapMb = Math.round(usage.heapUsed / 1_048_576);

    return {
      status: 'ok',
      service: 'set-api',
      env: this.config.NODE_ENV,
      now_shamsi: formatJalaliLong(new Date()),
      memory: {
        rssMb,
        heapUsedMb: heapMb,
        // آستانه‌های هشدار: پیش از آن‌که فرآیند کشته شود دیده شوند
        pressure: rssMb > 900 ? 'critical' : rssMb > 600 ? 'high' : 'normal',
        note: 'حافظهٔ WASMِ پایگاه‌داده بیرون از هیپِ جاوااسکریپت است',
      },
    };
  }

  /** آمادگی برای دریافت ترافیک — پایگاه‌داده و مهاجرت‌ها را هم بررسی می‌کند */
  @Get('ready')
  async readiness() {
    await this.db.query('SELECT 1');
    const versions = [...(await getAppliedVersions(this.db))].sort();
    return {
      status: 'ready',
      database: this.config.DB_URL === 'memory://' ? 'pglite (in-process)' : 'postgres',
      migrations: versions,
      // نرخِ **جاری**، یعنی همان چیزی که ثبتِ سفارش با آن حساب می‌کند —
      // نه آنچه در محیطِ اجرا نشسته است. گزارشِ پیش‌فرض به‌جایِ مقدارِ مؤثر
      // همان اشتباهِ کوچکِ خطرناک است: دو عدد که با هم نمی‌خوانند و هیچ‌کدام
      // خطا نمی‌دهند. اگر پنل نرخ را عوض کرده باشد، اینجا هم باید عوض شود.
      vat_rate_bp: await effectiveVatBasisPoints(this.db),
      shamsi_date: jalaliToday(),
    };
  }
}
