import 'reflect-metadata';
import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { loadConfig, type AppConfig } from './config.js';
import { CONFIG, DB } from './tokens.js';
import {
  AUTH_SERVICE,
  TOKEN_SERVICE,
  ACCESS_CONTROL,
  OUTBOX_WORKER,
  RATE_LIMITER,
  METRICS,
} from './tokens.js';
import { createDatabase, applyMigrations, startOutboxWorker, type Database } from '@set/db';
import { AuthService, TokenService } from '@set/auth';
import { createEnforcer, AccessControl } from '@set/rbac';
import { HealthController } from './health.controller.js';
import { AuthController } from './auth.controller.js';
import { CatalogController } from './catalog.controller.js';
import { OrdersController } from './orders.controller.js';
import { PosController } from './pos.controller.js';
import { AdminAccountingController } from './admin-accounting.controller.js';
import { InventoryController } from './inventory.controller.js';
import { CartController } from './cart.controller.js';
import { AdminController } from './admin.controller.js';
import { PaymentsController } from './payments.controller.js';
import { AdminProcurementController } from './admin-procurement.controller.js';
import { ShopperController } from './shopper.controller.js';
import { AdminCustomersController } from './admin-customers.controller.js';
import { AdminSettingsController } from './admin-settings.controller.js';
import { AdminReportsController } from './admin-reports.controller.js';
import { AdminTaxController } from './admin-tax.controller.js';
import { AdminReturnsController } from './admin-returns.controller.js';
import { AdminMediaController } from './admin-media.controller.js';
import { AdminBannersController } from './admin-banners.controller.js';
import { AdminSynonymsController } from './admin-synonyms.controller.js';
import { AdminCouponsController } from './admin-coupons.controller.js';
import { AdminReviewsController } from './admin-reviews.controller.js';
import { CategoriesController } from './categories.controller.js';
import { PackingController } from './packing.controller.js';
import { AdminObservabilityController } from './admin-observability.controller.js';
import { AdminCommerceController } from './admin-commerce.controller.js';
import { AdminExportController } from './admin-export.controller.js';
import { ShippingLabelController } from './shipping-label.controller.js';
import { QaController } from './qa.controller.js';
import { AdminEmailController } from './admin-email.controller.js';
import { AdminInventoryForecastController } from './admin-inventory-forecast.controller.js';
import { AdminCrmController } from './admin-crm.controller.js';
import { createRateLimiter } from './rate-limit.js';
import { MetricsRegistry } from '@set/observability';

@Module({
  controllers: [
    HealthController,
    AuthController,
    CatalogController,
    OrdersController,
    PosController,
    AdminAccountingController,
    InventoryController,
    CartController,
    AdminController,
    PaymentsController,
    AdminProcurementController,
    ShopperController,
    AdminCustomersController,
    AdminSettingsController,
    AdminReportsController,
    AdminTaxController,
    AdminReturnsController,
    AdminMediaController,
    AdminBannersController,
    AdminSynonymsController,
    AdminCouponsController,
    AdminReviewsController,
    CategoriesController,
    PackingController,
    AdminObservabilityController,
    AdminCommerceController,
    AdminExportController,
    ShippingLabelController,
    QaController,
    AdminEmailController,
    AdminInventoryForecastController,
    AdminCrmController,
  ],
  providers: [
    { provide: CONFIG, useFactory: (): AppConfig => loadConfig() },
    {
      provide: DB,
      inject: [CONFIG],
      useFactory: async (config: AppConfig): Promise<Database> => {
        const db = createDatabase(config.DB_URL);
        const applied = await applyMigrations(db);
        if (applied.length) console.log(`مهاجرت‌های اعمال‌شده: ${applied.join(', ')}`);

        // داده‌ی نمونه: فقط وقتی پایگاه‌داده خالی است (یک‌بار)، و هرگز در تولید
        // مگر اینکه صریحاً با SEED=1 خواسته شود.
        if (config.NODE_ENV !== 'production' || process.env.SEED === '1') {
          const { rows } = await db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM products`);
          if (rows[0]?.n === '0') {
            const { seedCatalog } = await import('@set/db');
            const summary = await seedCatalog(db);
            console.log(
              `داده‌ی نمونه: ${summary.products} کالا، ${summary.variants} تنوع، ` +
              `${summary.compatibilityRows} رابطه‌ی سازگاری، ${summary.deviceModels} مدل گوشی`,
            );
          }

          // هویت (شعبه، نقش‌ها، دسترسی‌ها، کاربرانِ پنل): همیشه اجرا می‌شود و تکرارپذیر است،
          // چون بدون نقش اصلاً نمی‌توان وارد پنل شد — حتی وقتی کاتالوگ از قبل پر است.
          const { seedIdentity } = await import('./seed-identity.js');
          const identity = await seedIdentity(db);
          if (identity.users.length) {
            console.log(
              `کاربرانِ نمونه: ${identity.users.map((u) => `${u.mobile} (${u.role})`).join('، ')}`,
            );
            console.log(
              `رمزِ همه‌ی کاربرانِ نمونه: ${process.env.ADMIN_PASSWORD ?? 'SetShop@1404'}`,
            );
          }
        }
        console.log(`پایگاه‌داده آماده است (${config.DB_URL})`);
        return db;
      },
    },
    {
      provide: TOKEN_SERVICE,
      inject: [CONFIG],
      useFactory: (config: AppConfig) =>
        new TokenService({
          secret: config.JWT_SECRET,
          issuer: 'set-shop',
        }),
    },
    {
      provide: ACCESS_CONTROL,
      inject: [DB],
      useFactory: async (db: Database) => new AccessControl(await createEnforcer(db), db),
    },
    {
      provide: AUTH_SERVICE,
      inject: [DB, TOKEN_SERVICE],
      useFactory: (db: Database, tokens: TokenService) => new AuthService(db, tokens),
    },
    {
      provide: OUTBOX_WORKER,
      inject: [DB],
      useFactory: (db: Database) =>
        startOutboxWorker(db, async (event) => {
          // در فاز بعد: ارسال به صفِ پیام/اعلان/همگام‌سازی. اینجا فقط ثبت می‌شود.
          console.log(`رخداد ارسال شد: ${event.event_type} (${event.aggregate}/${event.aggregate_id})`);
        }),
    },
    /**
     * مهارگرِ بار.
     *
     * چرا یک ارائه‌دهنده (Provider) است و نه یک نمونه‌یِ سراسری؟ چون به
     * پایگاه‌داده نیاز دارد و پایگاه‌داده را خودِ نست می‌سازد (با مهاجرت).
     * ساختنش در `main.ts` یعنی یا اتصالِ دوم به پایگاه، یا وابستگیِ پنهان به
     * ترتیبِ راه‌اندازی.
     */
    {
      provide: RATE_LIMITER,
      inject: [DB, CONFIG],
      useFactory: async (db: Database, config: AppConfig) =>
        createRateLimiter(db, {
          // کلیدِ اضطراری در تنظیماتِ فروشگاه است تا مدیر بتواند از پنل
          // خاموشش کند؛ مقدارِ آغازین از متغیرِ محیطی می‌آید.
          enabledSetting: async () => {
            if (!config.RATE_LIMIT_ENABLED) return false;
            const { rows } = await db.query<{ value: string }>(
              `SELECT value FROM store_settings WHERE key = 'rate_limit_enabled'`,
            );
            return rows[0]?.value !== 'false';
          },
        }),
    },
    {
      provide: METRICS,
      useFactory: () => new MetricsRegistry(),
    },
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(RATE_LIMITER) private readonly rateLimits: { stop: () => void } | null) {}

  async onApplicationShutdown(): Promise<void> {
    console.log('خاموش شدنِ ایمن — بستنِ کارگرها');
    this.rateLimits?.stop();
  }
}
