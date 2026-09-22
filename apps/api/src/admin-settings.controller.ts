import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '@set/shared-kernel';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import {
  REQUIRED_VARS,
  SMS_SAMPLE_VARS,
  readSmsSendConfig,
  sendDue,
  sendSmsTest,
  smsQueueCounts,
  smsReadiness,
  smsStats,
  requeueSmsMessages,
  type SmsTemplateKey,
} from '@set/commerce';
import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';
import {
  GROUPS,
  SETTINGS,
  extractPlaceholders,
  maskSecret,
  settingDef,
  validateSetting,
} from './settings-catalog.js';

/**
 * تنظیماتِ فروشگاه و مرکزِ پیامک.
 *
 * دو قاعده در این مسیرها:
 *
 *  ۱) کلیدهایِ محرمانه هرگز به‌طورِ کامل به مرورگر نمی‌روند. مدیر باید بتواند
 *     ببیند «کلید تنظیم شده یا نه»، نه این‌که کلید چیست. (چرا؟ چون تنظیمات
 *     در صفحه‌ای نمایش داده می‌شوند که ممکن است رویِ رایانه‌یِ فروشنده باز
 *     باشد، و هر افزونه‌ای در مرورگر می‌تواند آن را بخواند.)
 *
 *  ۲) هیچ مسیری کلیدی را که در کارنامه نباشد نمی‌نویسد. در غیرِ این صورت هر
 *     کسی با دسترسیِ write می‌توانست کلیدهایِ تازه‌ای در پایگاه بسازد و
 *     رفتارِ سامانه را از بیرونِ کد تغییر دهد.
 */

type SettingAction =
  | 'read'
  | 'write'
  | 'template.read'
  | 'template.write'
  | 'outbox.read'
  | 'outbox.send';
// «بازگردانیِ صف» زیرِ همان `outbox.send` می‌ماند: هر دو «خرج‌کردنِ اعتبار»
// هستند و جداکردنشان یعنی دو دسترسی برایِ یک کارِ یکسان.

const UpdateSettingsDto = z.object({
  values: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

const FlushDto = z.object({
  limit: z.number().int().min(1).max(200).optional(),
});

const RequeueDto = z.object({
  templateKey: z.string().max(40).nullish(),
  limit: z.number().int().min(1).max(5000).optional(),
  force: z.boolean().optional(),
  includeWaiting: z.boolean().optional(),
});

const SmsTestDto = z.object({
  phone: z.string().min(4).max(20),
  /** اگر نیاید، فعال‌ترین قالب برایِ آزمون انتخاب می‌شود */
  templateKey: z.string().max(40).optional(),
  vars: z.record(z.string().max(60)).optional(),
});

/**
 * سقفِ «آزمونِ ارسال» — سادِه و در حافظه، بی‌مهارِ نرخِ پایگاه‌داده‌ای.
 *
 * چرا اصلاً لازم است؟ چون این مسیر اعتبارِ واقعی می‌سوزاند و با یک کلیدِ
 * آزمایشیِ نامحدود، یک حلقهٔ تصادفی رویِ شماره‌ها می‌تواند هزینه‌ساز شود؛
 * و چون هر کاربرِ لاگین‌کرده اینجا کلیدِ خودش را امتحان می‌کند، سقفِ «در
 * دقیقه» باید به نفر بسته شود، نه به IP (پشتِ یک NATِ اداری، همه یک IP‌اند).
 * پنج آزمون در ده دقیقه برایِ «روشن‌کردنِ پیامک» کافی است و جلویِ لغزشِ
 * انگشت رویِ دکمه را هم می‌گیرد.
 */
const TEST_WINDOW_MS = 10 * 60_000;
const TEST_MAX_PER_WINDOW = 5;
const testSends = new Map<string, { n: number; resetAt: number }>();

function throttleTestSend(userId: string): { allowed: boolean; left: number } {
  const now = Date.now();
  const hit = testSends.get(userId);
  if (!hit || hit.resetAt <= now) {
    testSends.set(userId, { n: 1, resetAt: now + TEST_WINDOW_MS });
    return { allowed: true, left: TEST_MAX_PER_WINDOW - 1 };
  }
  if (hit.n >= TEST_MAX_PER_WINDOW) return { allowed: false, left: 0 };
  hit.n += 1;
  // پاک‌سازیِ بی‌صدا: این نگاشت در فرایندِ API می‌ماند و بی‌رو‌کردن، با
  // هزاران کاربرِ پنل رشد می‌کند (هر چند کند؛ اما «کند» با «هرگز» فرق دارد)
  if (testSends.size > 512) {
    for (const [k, v] of testSends) if (v.resetAt <= now) testSends.delete(k);
  }
  return { allowed: true, left: TEST_MAX_PER_WINDOW - hit.n };
}

const TemplateDto = z.object({
  title: z.string().max(80).nullish(),
  body: z.string().min(3).max(500).optional(),
  providerTemplateId: z.string().max(60).nullish(),
  isActive: z.boolean().optional(),
});

@Controller('admin/settings')
export class AdminSettingsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  /**
   * نگاشتِ «آنچه این مسیر می‌خواهد» به «کلیدِ دسترسی در پایگاه».
   *
   * چرا نگاشت جدا است؟ چون کلیدهایِ دسترسی سه‌بخشی‌اند (`sms.template.read`)
   * و اگر رشته را ساده با نقطه بشکنیم، برایِ `'read'` (تک‌بخشی) بخشِ دوم
   * `undefined` می‌شود و بررسی با ۴۰۳ شکست می‌خورد — بی‌آنکه در ظاهر چیزی
   * بگوید: کاربری که واقعاً دسترسی دارد، پشتِ در می‌ماند.
   */
  private readonly PERMISSION: Record<SettingAction, [resource: string, action: string]> = {
    read: ['settings', 'read'],
    write: ['settings', 'write'],
    'template.read': ['sms.template', 'read'],
    'template.write': ['sms.template', 'write'],
    'outbox.read': ['sms.outbox', 'read'],
    // «آزادکردنِ یک سطل» در مهارِ بار فقط write می‌خواهد، اما اینجا یک چیزِ
    // دیگر است: پولِ واقعیِ فروشگاه خرجِ سامانهٔ پیامک می‌شود و پیام به دستِ
    // مشتری می‌رسد. پس دسترسی‌اش جداست و در نقشِ پیش‌فرضِ فروشنده نیست.
    'outbox.send': ['sms.outbox', 'send'],
  };

  private async requireUser(
    authorization: string | undefined,
    action: SettingAction,
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');

    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');

    const [resource, verb] = this.PERMISSION[action];
    await this.access.assert({ userId: claims.sub, branchId: null }, resource, verb);
    return claims;
  }

  /** کارنامه‌ی تنظیمات با مقدارهایِ کنونی (محرمانه‌ها پوشانده) */
  @Get()
  async list(@Headers('authorization') authorization: string | undefined) {
    await this.requireUser(authorization, 'read');

    const { rows } = await this.db.query<{ key: string; value: string; updated_at: string | null }>(
      `SELECT key, value, updated_at FROM store_settings`,
    );
    const stored = new Map(rows.map((r) => [r.key, r]));

    return {
      groups: GROUPS.map((g) => ({
        ...g,
        items: SETTINGS.filter((s) => s.group === g.key).map((def) => {
          const row = stored.get(def.key);
          const value = row?.value ?? def.fallback;
          return {
            key: def.key,
            label: def.label,
            type: def.type,
            hint: def.hint ?? null,
            options: def.options ?? null,
            value: maskSecret(def, value),
            /** آیا مقداری در پایگاه هست؟ (برایِ کلیدهایِ محرمانه مهم‌تر از خودِ مقدار) */
            isSet: Boolean(row?.value),
            updatedAt: row?.updated_at ?? null,
          };
        }),
      })),
    };
  }

  /**
   * به‌روزرسانیِ دسته‌ای.
   *
   * چرا دسته‌ای و نه تک‌تک؟ چون فرمِ تنظیمات یک‌جا ذخیره می‌شود؛ اگر هر کلید
   * درخواستی جدا باشد، نیمی از تغییرات می‌ماند و نیمی می‌رود و کاربر نمی‌فهمد
   * کدام ذخیره شد. اینجا «همه یا هیچ» است: یک تراکنش، و در صورتِ خطا هیچ‌چیز
   * نوشته نمی‌شود.
   */
  @Patch()
  async update(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    const claims = await this.requireUser(authorization, 'write');
    const input = UpdateSettingsDto.parse(body);

    const entries = Object.entries(input.values);
    if (entries.length === 0) throw new AppError('VALIDATION');

    // همه‌ی کلیدها پیش از نوشتن بررسی می‌شوند تا نیمی از فرم ذخیره نشود
    const prepared: Array<{ key: string; value: string; def: ReturnType<typeof settingDef> }> = [];
    for (const [key, raw] of entries) {
      const def = settingDef(key);
      if (!def) throw new AppError('VALIDATION', { message: `تنظیمِ «${key}» شناخته‌شده نیست.` });
      const checked = validateSetting(key, raw);
      if (!checked.ok) throw new AppError('VALIDATION', { message: checked.message });
      prepared.push({ key, value: checked.value ?? '', def });
    }

    const saved = await this.db.transaction(async (tx) => {
      for (const item of prepared) {
        await tx.query(
          `INSERT INTO store_settings (key, value, description, updated_by, updated_at)
           VALUES ($1, $2, COALESCE((SELECT description FROM store_settings WHERE key = $1), $3), $4, now())
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [item.key, item.value, item.def?.label ?? null, claims.sub],
        );
      }
      return prepared.length;
    });

    return { saved, by: claims.sub };
  }

  /* ────────────────────────────────────────────────────────────────────────
     مرکزِ پیامک
     ──────────────────────────────────────────────────────────────────────── */

  /** قالب‌ها با متغیرهایِ لازم — تا مدیر بداند کدام متغیر را نباید پاک کند */
  @Get('sms/templates')
  async templates(@Headers('authorization') authorization: string | undefined) {
    await this.requireUser(authorization, 'template.read');

    const { rows } = await this.db.query<{
      key: string;
      title: string | null;
      body: string;
      provider_template_id: string | null;
      is_active: boolean;
      updated_at: string | null;
    }>(
      `SELECT key, title, body, provider_template_id, is_active, updated_at
         FROM sms_templates ORDER BY key`,
    );

    return {
      items: rows.map((r) => {
        const placeholders = extractPlaceholders(r.body);
        const required = REQUIRED_VARS[r.key as SmsTemplateKey] ?? [];
        return {
          key: r.key,
          title: r.title,
          body: r.body,
          providerTemplateId: r.provider_template_id,
          isActive: r.is_active,
          placeholders,
          /** متغیرهایِ لازمی که در متن نیستند — در پنل هشدار داده می‌شوند */
          missingRequired: required.filter((v) => !placeholders.includes(v)),
          updatedAt: r.updated_at,
        };
      }),
    };
  }

  /**
   * ویرایشِ یک قالب.
   *
   * چرا «شناسه‌یِ قالبِ ارسال‌کننده» جداگانه است؟ چون ارسال‌کننده‌هایِ ایرانی
   * متنِ آزاد را نمی‌پذیرند: متن باید پیشاپیش تأیید شده باشد و هنگامِ ارسال
   * با شناسه‌اش فراخوانی شود. پس متنِ اینجا برایِ نمایش و پیش‌نمایش است و
   * شناسه، چیزی است که هنگامِ ارسال فرستاده می‌شود.
   */
  @Patch('sms/templates/:key')
  async updateTemplate(
    @Headers('authorization') authorization: string | undefined,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    const claims = await this.requireUser(authorization, 'template.write');
    const input = TemplateDto.parse(body);

    if (input.body !== undefined) {
      const missing = extractPlaceholders(input.body).length;
      if (input.body.length > 500) {
        throw new AppError('VALIDATION', { message: 'متنِ پیامک بیش از ۵۰۰ نویسه است.' });
      }
      // متغیرهایِ ناشناخته بی‌معناست اما خطا نیست؛ فقط در پیش‌نمایش خالی می‌ماند
      void missing;
    }

    const { affectedRows } = await this.db.query(
      `UPDATE sms_templates
          SET title = COALESCE($2, title),
              body = COALESCE($3, body),
              provider_template_id = COALESCE($4, provider_template_id),
              is_active = COALESCE($5, is_active),
              updated_at = now()
        WHERE key = $1`,
      [key, input.title ?? null, input.body ?? null, input.providerTemplateId ?? null, input.isActive ?? null],
    );
    if (affectedRows === 0) throw new AppError('NOT_FOUND');

    const { rows } = await this.db.query<{ body: string }>(
      `SELECT body FROM sms_templates WHERE key = $1`,
      [key],
    );
    const placeholders = extractPlaceholders(rows[0]?.body ?? '');
    const required = REQUIRED_VARS[key as SmsTemplateKey] ?? [];

    return {
      key,
      by: claims.sub,
      placeholders,
      missingRequired: required.filter((v) => !placeholders.includes(v)),
    };
  }

  /**
   * «آزمونِ ارسال» — یک پیامکِ تک به شماره‌یِ خودش، با پاسخِ خامِ سامانه.
   *
   * چرا در کنترلرِ تنظیمات و نه یک مسیرِ جدا؟ چون این کار «تنظیم کردن» نیست،
   * «مطمئن‌شدن از تنظیم» است؛ و پاسخِ درست برایِ «چرا پیامک نمی‌رسد؟» عدد و
   * متنِ خامِ سامانه است، نه یک تیکِ سبز.
   *
   * سه چیز عمداً اینجا هست: پوشاندنِ شماره در ممیزی، سقفِ پنج آزمونِ ده
   * دقیقه برایِ هر کاربر، و بی‌نوشته‌شدن در `sms_outbox` (صفِ واقعی نباید با
   * آزمون آلوده شود). و یک چیز عمداً اینجا نیست: `sms_enabled` — اگر کلِ
   * ارسال خاموش است، آزمونِ دستی یعنی «می‌خواهم همین حالا ببینم».
   */
  @Post('sms/test')
  async smsTest(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    const claims = await this.requireUser(authorization, 'outbox.send');
    const gate = throttleTestSend(claims.sub);
    if (!gate.allowed) {
      throw new AppError('RATE_LIMITED', {
        message: `برایِ هر حساب، ${TEST_MAX_PER_WINDOW} آزمون در هر ۱۰ دقیقه مجاز است (این پیامک اعتبار مصرف می‌کند).`,
      });
    }

    const input = SmsTestDto.parse(body ?? {});
    const cfg = await readSmsSendConfig(this.db);
    const result = await sendSmsTest(this.db, cfg, input);

    await this.db.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity, after_data)
       VALUES ($1,$2,$3,$4::jsonb)`,
      [
        claims.sub,
        'sms.test_sent',
        'store_settings',
        JSON.stringify({
          // شماره پوشانده می‌شود: ممیزی برایِ «چه کسی چه زمانی» است، نه
          // برایِ ساختنِ فهرستِ شماره‌ها
          phone: result.phone.length > 7 ? `${result.phone.slice(0, 4)}•••${result.phone.slice(-3)}` : result.phone,
          templateKey: result.templateKey,
          provider: result.provider,
          ok: result.ok,
          httpStatus: result.httpStatus,
          elapsedMs: result.elapsedMs,
        }),
      ],
    );

    return { ...result, remainingTests: gate.left, sampleVars: SMS_SAMPLE_VARS };
  }

  /**
   * «چرا پیامک نمی‌رسد؟» — چک‌لیستِ تنظیمات، شمارشِ صف و قالب‌هایِ مسدودکننده.
   *
   * چرا یک مسیرِ جدا و نه بزرگ‌کردنِ `GET /admin/settings`؟ چون این داده
   * «وضعیت» است نه «مقدارِ تنظیم»: خوانده‌شدنش هر بار باید ارائه‌دهنده،
   * کلیدِ تنظیم‌شده، قالب‌هایِ بی‌شناسه و صف را کنارِ هم بگذارد. اگر در همان
   * گروهِ تنظیمات می‌آمد، صفحهٔ تنظیمات (که مدیر بارها باز می‌کند) بهایِ این
   * چهار کوئری را می‌داد، بی‌این‌که چیزی لازم داشته باشد.
   */
  @Get('sms/readiness')
  async smsReadinessReport(@Headers('authorization') authorization: string | undefined) {
    await this.requireUser(authorization, 'outbox.read');
    const cfg = await readSmsSendConfig(this.db);
    return smsReadiness(this.db, cfg);
  }

  /**
   * پایشِ صف: نمودارِ ساعتی + «کارگرِ صف خوابیده است؟».
   *
   * چرا کنارِ «readiness» و نه درونِ آن؟ readiness می‌گوید «چه چیزی را پر
   * نکنده‌اید»؛ این می‌گوید «تنظیمات کامل است ولی چیزی نمی‌رود». بدونِ این،
   * تنها نشانهٔ خوابیدنِ تایمرِ systemd، صفِ پُرِ بی‌حرکت است که کسی نمی‌بیند.
   * `hours` را از کوئری می‌گیرد تا نمودارِ ۳ ساعته تا ۷ روزه را همان پنل
   * بسازد و پایگاه هم همان یک بازه را اسکن کند.
   */
  @Get('sms/stats')
  async smsStatsReport(
    @Headers('authorization') authorization: string | undefined,
    @Query('hours') hours: string | undefined,
  ) {
    await this.requireUser(authorization, 'outbox.read');
    const parsed = Number((hours ?? '').trim());
    return smsStats(this.db, Number.isFinite(parsed) && parsed > 0 ? { hours: parsed } : {});
  }

  /**
   * بازگرداندنِ پیام‌هایی که **به‌خاطرِ تنظیم** در صف مانده‌اند — پس ازِ این‌که
   * مدیر خانه‌اش را پر کرد.
   *
   * سه قاعده در `requeueSmsMessages` نوشته شده (پیامِ `sent` هرگز دست
   * نمی‌خورد؛ بی‌`force` فقط خطاهایِ تنظیمی برمی‌گردند؛ `attempts` صفر می‌شود)
   * و این مسیر جزئی‌ترین چیزِ ممکن را در ممیزی می‌نویسد: «چندتا، از چه
   * وضعیتی» — نه شماره‌ها.
   */
  @Post('sms/outbox/requeue')
  async requeueOutbox(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const claims = await this.requireUser(authorization, 'outbox.send');
    const input = RequeueDto.parse(body ?? {});
    const result = await requeueSmsMessages(this.db, {
      templateKey: input.templateKey ?? null,
      limit: input.limit ?? 500,
      force: input.force ?? false,
      includeWaiting: input.includeWaiting ?? false,
    });

    await this.db.query(
      // جدولِ ممیزی ستونِ user_agent ندارد (فقط ip) — پیش ازِ افزودنِ هر
      // ستونِ تازه به INSERT، \"\d audit_logs\" را ببینید: این مسیر در آزمونِ
      // واحد (PGlite روی memory://) اصلاً کوئری‌اش را اجرا نکرد و روی
      // PostgreSQLِ واقعی با ۵۰۰ ترکید.
      `INSERT INTO audit_logs (actor_user_id, action, entity, after_data, ip)
       VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [
        claims.sub,
        'sms.outbox_requeued',
        'sms_outbox',
        JSON.stringify({ ...result, templateKey: input.templateKey ?? null, force: input.force ?? false }),
        req.ip ?? null,
      ],
    );

    return { ...result, counts: await smsQueueCounts(this.db) };
  }

  /** صندوقِ پیامک‌ها: چه فرستاده شد، چه ماند، چه خطا خورد */
  @Get('sms/outbox')
  async outbox(
    @Headers('authorization') authorization: string | undefined,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    await this.requireUser(authorization, 'outbox.read');

    const take = Math.min(Math.max(Number(limit ?? 50) || 50, 1), 200);
    const filter = status && /^[a-z_]+$/.test(status) ? status : null;

    const { rows } = await this.db.query<{
      id: string;
      phone: string;
      template_key: string | null;
      body: string;
      status: string;
      provider_ref: string | null;
      attempts: number;
      last_error: string | null;
      available_at: Date;
      created_at: Date;
      sent_at: Date | null;
    }>(
      `SELECT id, phone, template_key, body, status, provider_ref, attempts, last_error,
              available_at, created_at, sent_at
         FROM sms_outbox
         ${filter ? 'WHERE status = $2' : ''}
        ORDER BY created_at DESC
        LIMIT $1`,
      filter ? [take, filter] : [take],
    );

    const { rows: counts } = await this.db.query<{ status: string; n: string }>(
      `SELECT status, COUNT(*) AS n FROM sms_outbox GROUP BY status`,
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        // شماره پوشانده می‌شود: این صفحه برایِ پیگیری است، نه برایِ استخراجِ
        // فهرستِ شماره‌هایِ مشتریان
        phone: r.phone.length > 7 ? `${r.phone.slice(0, 4)}•••${r.phone.slice(-3)}` : r.phone,
        templateKey: r.template_key,
        body: r.body,
        status: r.status,
        providerRef: r.provider_ref,
        /** «چند بار تلاش شده» و «آخر چه گفت» — بی‌این، رفعِ اشکالِ پیامک حدس است */
        attempts: r.attempts,
        lastError: r.last_error,
        /** زمانِ نوبتِ بعد (برایِ پیام‌هایِ شکست‌خورده) */
        nextAttemptAt: r.available_at,
        createdAt: r.created_at,
        sentAt: r.sent_at,
      })),
      counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
    };
  }

  /**
   * یک دورِ ارسالِ دستی — دکمهٔ «همین حالا بفرست» در پنل.
   *
   * چرا اصلاً هست؟ چون کارگرِ ما systemd-timer است و هر چند دقیقه یک بار
   * اجرا می‌شود؛ اگر مدیر تازه کلیدِ پیامک را پر کرده و می‌خواهد ببیند کار
   * می‌کند یا نه، نباید ده دقیقه منتظرِ تایمر بماند — و اگر اینترنتِ لحظه‌یِ
   * ارسال قطع بوده، پیامِ «کدِ ورود»ِ مشتری که پنج دقیقه مانده باشد، با
   * تایمرِ بعدی بی‌فایده است.
   *
   * دو نکته که در کد هم نوشته شده: «ارسالِ پیامک» در این مسیر نادیده گرفته
   * می‌شود (مدیر خودش زده «بفرست»، یعنی می‌خواهد)، و `sendDue` خودش
   * `FOR UPDATE SKIP LOCKED` می‌کند، پس اگر تایمر هم‌زمان در کار باشد،
   * پیامی دوبار فرستاده نمی‌شود.
   */
  @Post('sms/outbox/flush')
  async flushOutbox(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const claims = await this.requireUser(authorization, 'outbox.send');
    const input = FlushDto.parse(body ?? {});

    const config = await readSmsSendConfig(this.db);
    const result = await sendDue(this.db, config, {
      limit: input.limit ?? 20,
      ignoreEnablement: true,
    });

    return {
      by: claims.sub,
      provider: config.provider,
      dryRun: config.dryRun,
      maxAttempts: config.maxAttempts,
      ...result,
      // چرا دوباره شمارشِ کلِ صف برمی‌گردد؟ تا پنل پس ازِ زدنِ دکمه،
      // بدونِ یک درخواستِ تازه بداند «چند تا همچنان منتظر است»
      counts: await smsQueueCounts(this.db),
    };
  }
}
