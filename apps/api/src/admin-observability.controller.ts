import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AppError, formatJalali } from '@set/shared-kernel';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import { mediaHygiene, purgeExpiredData } from '@set/commerce';
import { listCacheStats, queryCacheStats } from '@set/catalog';
import { sanitizeRulePatch } from '@set/rate-limit';
import type { MetricsRegistry } from '@set/observability';

import { CONFIG, DB, TOKEN_SERVICE, ACCESS_CONTROL, RATE_LIMITER, METRICS } from './tokens.js';
import type { AppConfig } from './config.js';
import type { RateLimitBundle } from './rate-limit.js';

/**
 * دیده‌بانی و مهارِ بار — مسیرهایِ پنل.
 *
 * چرا این صفحه در پنل وجود دارد؟ چون دو پرسشِ همیشگیِ مدیر این‌هاست:
 *
 *   • «سایت کند است — **کجایش** کند است؟» بی‌داده، پاسخ حدس است: یا پایگاه
 *     را بد می‌نامیم یا شبکه را. اینجا کندترین مسیرها با صدکِ ۹۵ (نه
 *     میانگین، که یک کندیِ بزرگ را در میانِ هزار درخواستِ تند پنهان
 *     می‌کند) نشان داده می‌شوند.
 *
 *   • «این سقف‌ها دستِ کیست؟» سقفِ مهارِ بار مستقیم رویِ فروش اثر دارد:
 *     اگر کم باشد مشتریِ واقعی بسته می‌شود، اگر زیاد باشد هزینه و خطر
 *     می‌آید. پس باید **از پنل** و بی‌کد تغییر کند — با ثبتِ اینکه چه کسی
 *     و کِی تغییرش داد.
 *
 * خروجیِ «آمار» از حافظه‌یِ همین فرآیند است و خروجیِ «سقف‌ها» از پایگاه؛
 * در استقرارِ چندنمونه‌ای، آمارِ هر نمونه جدا است (و در مستند آمده)، اما
 * سقف‌ها و ردِّ مسدودشدن‌ها یکسان‌اند.
 */

interface RuleRow {
  name: string;
  title: string;
  hint: string;
  maxRequests: number;
  windowSeconds: number;
  scope: string;
  store: string;
  isEnabled: boolean;
  updatedAtShamsi: string | null;
  updatedByName: string | null;
  /** شمارِ سطل‌هایِ زنده — فقط برایِ جایگاهِ حافظه معنا دارد */
  liveBuckets: number | null;
}

interface BlockedRow {
  id: string;
  ruleName: string;
  bucketKey: string;
  ip: string | null;
  method: string | null;
  path: string | null;
  seen: number;
  lastSeenAtShamsi: string;
  traceId: string | null;
}

/** درخواستِ اجرایِ پاک‌سازی؛ `limit` سقفِ هر دور است، نه سقفِ کلِ کار */
const CleanupDto = z.object({ limit: z.number().int().min(1).max(50_000).optional() });

/**
 * اندازهٔ جدول‌ها — «چرا سنگین شده» بی‌حدس‌زدن.
 *
 * `pg_total_relation_size` ایندکس‌ها و TOAST را هم می‌شمارد، پس همان چیزی است
 * که رویِ دیسک جا می‌گیرد؛ شمارشِ سطر نصفِ ماجرا را هم نمی‌گوید.
 */
async function tableSizes(db: Database): Promise<Array<{ table: string; bytes: number; rows: number }>> {
  const { rows } = await db.query<{ t: string; bytes: string; rows: string }>(
    `SELECT c.relname AS t,
            pg_total_relation_size(c.oid)::text AS bytes,
            GREATEST(c.reltuples, 0)::bigint::text AS rows
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()
        AND c.relkind = 'r'
        AND c.relname IN ('sms_outbox','audit_logs','rate_limit_events','rate_limit_counters')
      ORDER BY pg_total_relation_size(c.oid) DESC`,
  );
  return rows.map((r) => ({ table: r.t, bytes: Number(r.bytes), rows: Number(r.rows) }));
}

@Controller('admin/observability')
export class AdminObservabilityController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
    @Inject(RATE_LIMITER) private readonly rateLimits: RateLimitBundle | null,
    @Inject(METRICS) private readonly metrics: MetricsRegistry,
  ) {}

  private async require(
    authorization: string | undefined,
    permission: 'observability.read' | 'observability.write',
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    const [resource, action] = permission.split('.');
    await this.access.assert({ userId: claims.sub, branchId: null }, resource!, action!);
    return claims;
  }

  /**
   * تپشِ سامانه — آنچه برایِ پاسخ به «کُند است» لازم است.
   *
   * حافظه هم اینجا گزارش می‌شود: در تجربه‌یِ واقعیِ این پروژه، نشانه‌یِ
   * پیش از هنگ‌کردن، بالا رفتنِ حافظه بود نه خطا. پس حافظه را کنارِ آمار
   * می‌گذاریم تا «کندی» و «پُر شدنِ حافظه» با هم دیده شوند.
   */
  @Get('metrics')
  async snapshot(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization, 'observability.read');

    const stats = this.metrics.snapshot();
    const proc = this.metrics.process();
    const blocks = this.rateLimits?.limiter.blockStats() ?? { total: 0, byRule: [] };

    let pendingOutbox = 0;
    try {
      const { rows } = await this.db.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM outbox_events WHERE sent_at IS NULL`,
      );
      pendingOutbox = Number(rows[0]?.n ?? 0);
    } catch {
      // نبودِ جدول (پایگاهِ بسیار کهنه) نباید صفحه را بشکند
      pendingOutbox = 0;
    }

    return {
      generatedAtShamsi: formatJalali(new Date(), 'yyyy/MM/dd HH:mm'),
      process: {
        ...proc,
        memoryPressure: proc.rssMb > 900 ? 'critical' : proc.rssMb > 600 ? 'high' : 'normal',
      },
      traffic: stats,
      rateLimit: {
        blockedTotal: blocks.total,
        blockedByRule: blocks.byRule,
        // قاعده‌هایِ حاشیه‌ای سطل‌هایشان در حافظه است؛ دیدنِ شمارشان یعنی
        // دیدنِ این‌که آیا کسی با هزاران نشانیِ جعلی در حالِ پر کردنشان هست
        memoryBuckets: null as number | null,
      },
      database: {
        kind: this.config.DB_URL === 'memory://' ? 'pglite (درون‌فرآیند)' : 'postgres',
        pendingOutbox,
      },
      /**
       * کشِ پرسش‌هایِ جستجو، در هر فرآیندِ API جداست (در تولید چند فرآیند پشتِ
       * nginx). بی‌دیدنِ «چند تا از کش آمد» نمی‌شود فهمید سود داده یا نه — و
       * «hits=0 با ترافیکِ بالا» خودش یک یافته است: یا کش خاموش است یا پرسش‌ها
       * تکراری نیستند (یا کلید عوض می‌شود).
       */
      searchCache: queryCacheStats(this.db as object),
      /** کشِ فهرست‌هایِ کاتالوگ (دسته‌ها/برندها/دستگاه‌ها/رنگ‌ها) — سیاستِ مشترک، آمارِ جدا */
      listCache: listCacheStats(this.db as object),
      shamsiNote: 'تاریخ‌ها شمسی‌اند؛ زمانِ پاسخ‌ها بر حسبِ میلی‌ثانیه.',
    };
  }

  /** سقف‌ها و ردِّ مسدودشدن‌ها */
  @Get('limits')
  async limits(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization, 'observability.read');

    const settings = await this.db.query<{ value: string }>(
      `SELECT value FROM store_settings WHERE key = 'rate_limit_enabled'`,
    );
    const enabled = settings.rows[0]?.value !== 'false' && this.config.RATE_LIMIT_ENABLED;

    const rules = await this.db.query<{
      name: string;
      title: string;
      hint: string;
      max_requests: number | string;
      window_seconds: number | string;
      scope: string;
      store: string;
      is_enabled: boolean;
      updated_at: string | null;
      updated_by_name: string | null;
    }>(
      `SELECT r.name, r.title, r.hint, r.max_requests, r.window_seconds, r.scope, r.store,
              r.is_enabled, r.updated_at::text, u.full_name AS updated_by_name
         FROM rate_limit_rules r
         LEFT JOIN users u ON u.id = r.updated_by
        ORDER BY r.name`,
    );

    const events = await this.db.query<{
      id: string | number;
      rule_name: string;
      bucket_key: string;
      ip: string | null;
      method: string | null;
      path: string | null;
      seen: number | string;
      last_seen_at: string;
      trace_id: string | null;
    }>(
      `SELECT id, rule_name, bucket_key, ip, method, path, seen,
              last_seen_at::text, trace_id
         FROM rate_limit_events
        ORDER BY last_seen_at DESC
        LIMIT 50`,
    );

    const rows: RuleRow[] = rules.rows.map((row) => ({
      name: row.name,
      title: row.title,
      hint: row.hint,
      maxRequests: Number(row.max_requests),
      windowSeconds: Number(row.window_seconds),
      scope: row.scope,
      store: row.store,
      isEnabled: row.is_enabled === true,
      updatedAtShamsi: row.updated_at ? formatJalali(new Date(row.updated_at), 'yyyy/MM/dd HH:mm') : null,
      updatedByName: row.updated_by_name ?? null,
      // شمارِ سطل‌هایِ زندهٔ قاعده‌هایِ حافظه‌ای را بعداً می‌آوریم؛ اینجا
      // فقط نشان می‌دهیم که این قاعده در حافظه است یا در پایگاه
      liveBuckets: null,
    }));

    const blocked: BlockedRow[] = events.rows.map((row) => ({
      id: String(row.id),
      ruleName: row.rule_name,
      bucketKey: row.bucket_key,
      ip: row.ip,
      method: row.method,
      path: row.path,
      seen: Number(row.seen),
      lastSeenAtShamsi: formatJalali(new Date(row.last_seen_at), 'yyyy/MM/dd HH:mm'),
      traceId: row.trace_id,
    }));

    return {
      enabled,
      internalCallsExempt: this.config.INTERNAL_API_TOKEN !== '',
      items: rows,
      blocked,
      // آمارِ مسدودشدن در این فرآیند — برایِ قاعده‌هایِ حافظه‌ای که ردی در
      // پایگاه ندارند، تنها نشانه همین است
      inProcessBlocks: this.rateLimits?.limiter.blockStats() ?? { total: 0, byRule: [] },
    };
  }

  /** کلیدِ اضطراری: اگر سقفی مشتریِ واقعی را بست، یک کلیک آن را خاموش می‌کند */
  @Patch('limits')
  async setEnabled(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const claims = await this.require(authorization, 'observability.write');
    const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

    await this.db.query(
      `INSERT INTO store_settings (key, value, description, updated_by)
       VALUES ('rate_limit_enabled', $1, 'مهارِ بار (محدود کردنِ شمارِ درخواست‌ها) روشن باشد؟', $2)
       ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value,
              updated_by = EXCLUDED.updated_by,
              updated_at = now()`,
      [enabled ? 'true' : 'false', claims.sub],
    );
    this.rateLimits?.invalidate();

    return { enabled };
  }

  /** ویرایشِ یک سقف — از پنل، بی‌تغییرِ کد */
  @Patch('limits/:name')
  async updateRule(
    @Headers('authorization') authorization: string | undefined,
    @Param('name') name: string,
    @Body() body: Record<string, unknown>,
  ) {
    const claims = await this.require(authorization, 'observability.write');

    // اعتبارسنجی اینجا (پیش از پایگاه) انجام می‌شود تا پیامش فارسی و روشن
    // باشد، نه یک خطایِ قیدِ پایگاه که مدیر نمی‌فهمد.
    const patch = sanitizeRulePatch({
      maxRequests: body.maxRequests,
      windowSeconds: body.windowSeconds,
      scope: body.scope,
      store: body.store,
      isEnabled: body.isEnabled,
    });

    const { rows } = await this.db.query<{ name: string; max_requests: string; window_seconds: string }>(
      `UPDATE rate_limit_rules
          SET max_requests = COALESCE($2, max_requests),
              window_seconds = COALESCE($3, window_seconds),
              scope = COALESCE($4, scope),
              store = COALESCE($5, store),
              is_enabled = COALESCE($6, is_enabled),
              updated_by = $7,
              updated_at = now()
        WHERE name = $1
        RETURNING name, max_requests::text, window_seconds::text`,
      [
        name,
        patch.maxRequests ?? null,
        patch.windowSeconds ?? null,
        patch.scope ?? null,
        patch.store ?? null,
        patch.isEnabled ?? null,
        claims.sub,
      ],
    );

    if (!rows[0]) throw new AppError('NOT_FOUND', { message: `قاعده‌ای به نامِ «${name}» نیست.` });
    this.rateLimits?.invalidate();

    return {
      item: {
        name: rows[0].name,
        maxRequests: Number(rows[0].max_requests),
        windowSeconds: Number(rows[0].window_seconds),
      },
    };
  }

  /**
   * آزادسازی — وقتی یک مشتریِ واقعی پشتِ سقف گیر کرده است.
   *
   * کاربردِ واقعی: یک اداره با یک نشانیِ اینترنت (NAT)، یا یک فروشنده که
   * در یک دقیقه ده سفارشِ حضوریِ پیاپی ثبت کرده. بی‌این دکمه، تنها راه
   * «صبر کردن» است — یعنی مدیرِ فروشگاه از ابزارِ خودش قفل شده باشد.
   */
  @Post('limits/:name/release')
  async releaseRule(
    @Headers('authorization') authorization: string | undefined,
    @Param('name') name: string,
    @Body() body: Record<string, unknown> = {},
  ) {
    await this.require(authorization, 'observability.write');

    const released = (await this.rateLimits?.limiter.release(name)) ?? 0;
    const bucketKey = typeof body.bucketKey === 'string' && body.bucketKey ? body.bucketKey : null;
    const { rows } = await this.db.query<{ n: string }>(
      `WITH cleared AS (
          DELETE FROM rate_limit_counters
           WHERE rule_name = $1 AND ($2::text IS NULL OR bucket_key = $2)
         RETURNING 1
       )
       SELECT COUNT(*)::text AS n FROM cleared`,
      [name, bucketKey],
    );

    return { released: released + Number(rows[0]?.n ?? 0), rule: name, bucketKey };
  }

  /**
   * گزارشِ «چه چیزی را می‌شود پاک کرد» — پیش‌نمایشِ بی‌حذف‌کردن.
   *
   * چرا جدا از «اجرا»؟ چون مدیر پیش ازِ زدنِ دکمهٔ خطر باید عدد ببیند، نه
   * وعده. برآورد از همان شمارشی می‌آید که `DELETE` می‌کُشد (با همان `LIMIT`)،
   * پس «پیش‌نمایش: ۲۰۰۰» با «اجرا: ۲۰۰۰» نمی‌جنگد.
   */
  @Get('cleanup')
  async cleanupPreview(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization, 'observability.read');
    const report = await purgeExpiredData(this.db, { dryRun: true });
    // رسانه جدا خوانده می‌شود و **فقط به‌عنوانِ پیش‌نمایش**: پاک‌کردنِ فایل
    // برگشت‌پذیر نیست، پس از همین صفحه انجام نمی‌شود — دکمه‌اش در صفحهٔ
    // تصویرِ کالا است (`POST /admin/media/cleanup`).
    const media = await mediaHygiene(this.db, { mode: 'report' });
    const sizes = await tableSizes(this.db);
    return { ...report, media, sizes };
  }

  /**
   * اجرایِ یک دورِ پاک‌سازی (دسته‌ای).
   *
   * ممیزی فقط «شمارش» را نگه می‌دارد، نه خودِ سطرها: اگر ردِّ این کار شاملِ
   * متنِ پیامک‌ها می‌شد، همان چیزی که قرار است حذف شود جایِ دیگری زنده می‌ماند.
   */
  @Post('cleanup')
  async cleanupRun(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const claims = await this.require(authorization, 'observability.write');
    const input = CleanupDto.parse(body ?? {});
    const report = await purgeExpiredData(this.db, {
      batchLimit: input.limit ?? 2_000,
      dryRun: false,
    });
    const total =
      report.tables.smsOutbox.removed +
      report.tables.auditLog.removed +
      report.tables.observability.removed;
    await this.db.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity, after_data, ip)
       VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [
        claims.sub,
        'admin.cleanup_ran',
        'store_settings',
        JSON.stringify({ total, policy: report.policy, batchLimit: report.batchLimit }),
        req.ip ?? null,
      ],
    );
    const media = await mediaHygiene(this.db, { mode: 'report' });
    return { ...report, media, sizes: await tableSizes(this.db) };
  }
}
