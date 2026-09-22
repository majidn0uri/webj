import type { Queryable } from '@set/db';
import { SMS_PROVIDERS, faDigits, type SmsSendConfig } from './sms-send.js';

/**
 * «چرا پیامک نمی‌رسد؟» — پاسخِ این سؤال در فروشگاهِ ایرانی معمولاً سه‌شاخه است:
 * ارائه‌دهنده/کلید، قالبِ تأییدنشده، یا اعتبارِ تمام‌شده. هر سه در لاگِ کارگر
 * یک شکل دیده می‌شوند، پس مدیر برایِ تشخیص باید یا لاگِ systemd باز کند یا —
 * بدتر — حدس بزند و هزینه بسوزاند.
 *
 * این فایل همان تشخیص را به یک صفحه تبدیل می‌کند: `smsReadiness` چک‌لیست
 * می‌سازد (چه چیزی جلویِ ارسال را گرفته، و دقیقاً کدام خانهٔ پنل باید پر شود)
 * و `requeueSmsMessages` پیام‌هایی را که **به‌خاطرِ تنظیم** در صف مانده‌اند، پس
 * ازِ پرکردنِ آن خانه، دوباره زنده می‌کند.
 *
 * چرا «دوباره زنده‌کردن» لازم است؟ چون `attempts` سقف دارد و پیامِ بی‌برچسب
 * پس از پنج تلاش به `dead` می‌رود — و آنجا با «قالب را پر کردم» **خودبه‌خود**
 * برنمی‌گردد؛ نوبتش هیچ‌وقت نمی‌رسد. بی‌این دکمه، رفعِ اشکالِ تنظیمی یعنی
 * دستی INSERT زد‌ن در جدول یا نوشتنِ اسکریپت. آن را «کاغذبازی» نمی‌گوییم،
 * می‌گوییم اشکالِ محصول.
 */

/** خانه‌هایِ چک‌لیست — «isReady» با «چرا نه» فرق دارد و مدیر دومی را می‌خواهد */
export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  severity: 'blocker' | 'warn' | 'info';
  hint: string | null;
}

export interface BlockedTemplate {
  key: string;
  title: string | null;
  providerTemplateId: string | null;
  /** پیام‌هایی که همین حالا پشتِ همین قالب خوابیده‌اند */
  blocked: number;
  placeholders: string[];
  isActive: boolean;
}

export interface SmsReadiness {
  provider: string;
  providerKnown: boolean;
  knownProviders: string[];
  enabled: boolean;
  hasApiKey: boolean;
  hasSender: boolean;
  dryRun: boolean;
  maxAttempts: number;
  backoffMinutes: number;
  checks: ReadinessCheck[];
  counts: Record<string, number>;
  blockedTemplates: BlockedTemplate[];
  /** پیام‌هایِ مسدودشده‌ای که با پرکردنِ قالب برمی‌گردند (پیش‌نویسِ دکمهٔ «بازگردانی») */
  requeueable: number;
  canSendNow: boolean;
}

/**
 * خطاهایِ «علتش تنظیم است و نه سامانه». ستونِ `last_error` را نگه می‌داریم و
 * همین الگو را می‌سنجیم؛ یعنی بازگردانیِ کور نمی‌کنیم: پیامکی که سامانه آن را
 * با «شماره در سیاه‌فهرست» رد کرده، با یک دکمه درست نمی‌شود و نباید
 * دوباره به صف برگردد تا فقط هزینه بسوزاند.
 */
const CONFIGISH_SOURCE =
  'قالب|شناسه|کلید|ارسال‌کننده|اعتبار|خطِ سرویس|متنِ آزاد|DRY_RUN|کارگر پیش از';
const CONFIGISH = new RegExp(CONFIGISH_SOURCE);

/** همان الگویی که SQL هم استفاده می‌کند — دو نسخه از یک قانون، دعواست */
export const CONFIGISH_SQL = CONFIGISH_SOURCE;

export function isConfigishError(error: string | null | undefined): boolean {
  return !!error && CONFIGISH.test(error);
}

/**
 * دروازهٔ «چه چیزی الان قابلِ بازگردانی است» — **همان** شرطی که
 * `requeueSmsMessages` اجرا می‌کند.
 *
 * چرا متنِ کوئری اینجا تکرار شده و به تابعِ مشترکِ واحدِ SQL تبدیل نشده؟ چون
 * کوئریِ تشخیص یک `SELECT … GROUP BY` است و کوئریِ بازگردانی یک
 * CTE با `FOR UPDATE SKIP LOCKED` — تنها چیزِ مشترک‌شان همین چند سطرِ شرط است
 * و بی‌نامیدنش در هر دو، تشخیص عددی نشان می‌دهد که دکمه هرگز برآورده نمی‌کند
 * (دقیقاً همان چیزی که مدیر را به باورِ «دکمه خراب است» می‌رساند).
 */
export const REQUEUE_GATE_SQL = `(
  status = 'dead'
  OR (status = 'sending' AND available_at <= now())
)`;

export async function smsReadiness(
  db: Queryable,
  cfg: SmsSendConfig,
  opts: { staleSendingMinutes?: number } = {},
): Promise<SmsReadiness> {
  const stale = opts.staleSendingMinutes ?? 10;

  // یک درخواست، همه‌یِ شمارش‌ها: این صفحه هر بار که مدیر «چرا نرسید؟» می‌پرسد
  // باز می‌شود و نباید چهار سفر به پایگاه برایش بسازیم
  const { rows } = await db.query<{
    status: string;
    n: string;
    configish: string;
    oldest: Date | null;
  }>(
    `SELECT status,
            COUNT(*)::text AS n,
                    COUNT(*) FILTER (
              WHERE ${REQUEUE_GATE_SQL}
                AND (last_error IS NULL OR last_error ~ '${CONFIGISH_SQL}')
            )::text AS configish,
            MIN(created_at) FILTER (WHERE status IN ('pending','failed','dead')) AS oldest
       FROM sms_outbox
      GROUP BY status`,
  );
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = Number(r.n);
  const pending = counts.pending ?? 0;
  const sending = counts.sending ?? 0;
  const dead = counts.dead ?? 0;
  const failed = counts.failed ?? 0;
  // «در صفِ مسدود» = پیام‌هایی که منتظرِ تنظیم‌اند، نه منتظرِ شبکه: نوبتشان
  // رسیده یا سقفِ تلاششان تمام شده، و بی‌دستی‌کردنِ مدیر هیچ‌وقت نمی‌روند
  const blockedByConfig = rows
    .filter((r) => r.status === 'failed' || r.status === 'dead')
    .reduce((n, r) => n + Number(r.configish), 0);
  // «قدیمی‌ترینِ پیامِ نرفته» از created_at خوانده می‌شود: اگر از available_at
  // می‌خواندیم، یک پیامکِ تازه که ۴۵ دقیقه در نوبتِ بک‌آف است «کارگر می‌خوابد»
  // گزارش می‌شد، در حالی که کارگر سالم است
  const oldestPending = rows.map((r) => r.oldest).filter(Boolean).sort()[0] ?? null;
  const waitingMinutes = oldestPending
    ? Math.max(0, Math.round((Date.now() - new Date(oldestPending).getTime()) / 60_000))
    : 0;

  const { rows: tpl } = await db.query<{
    key: string;
    title: string | null;
    body: string;
    provider_template_id: string | null;
    is_active: boolean;
    blocked: string;
  }>(
    `SELECT t.key, t.title, t.body, t.provider_template_id, t.is_active,
            COUNT(o.id) FILTER (
              WHERE o.status IN ('pending','failed','dead')
            )::text AS blocked
       FROM sms_templates t
       LEFT JOIN sms_outbox o ON o.template_key = t.key
      GROUP BY t.key
      ORDER BY blocked DESC, t.key`,
  );

  const providerKnown = (SMS_PROVIDERS as readonly string[]).includes(cfg.provider);
  const blockedTemplates: BlockedTemplate[] = tpl
    .filter((t) => !t.provider_template_id || Number(t.blocked) > 0)
    .map((t) => ({
      key: t.key,
      title: t.title,
      providerTemplateId: t.provider_template_id,
      blocked: Number(t.blocked),
      placeholders: [...new Set([...t.body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))],
      isActive: t.is_active,
    }));

  const checks: ReadinessCheck[] = [];
  checks.push({
    key: 'provider',
    label: 'ارائه‌دهنده انتخاب شده',
    ok: providerKnown && cfg.provider !== 'none',
    severity: 'blocker',
    hint: providerKnown && cfg.provider !== 'none'
      ? null
      : cfg.provider === 'none'
        ? 'تنظیمات ← پیامک ← «ارائه‌دهنده» را انتخاب کنید (کاوه‌نگار / ملی‌پیامک / فراز).'
        : `«${cfg.provider}» در فهرستِ پشتیبانی‌شده نیست؛ فهرست: ${SMS_PROVIDERS.join(' / ')}.`,
  });
  checks.push({
    key: 'api-key',
    label: 'کلیدِ ارسال پر است',
    ok: !!cfg.apiKey,
    severity: 'blocker',
    hint: cfg.apiKey
      ? null
      : cfg.provider === 'melipayamak'
        ? 'در ملی‌پیامک شکلِ کلید «کاربری|گذرواژه» است.'
        : 'تنظیمات ← پیامک ← «کلیدِ ارسال‌کننده».',
  });
  checks.push({
    key: 'enabled',
    label: '«ارسالِ پیامک» روشن است',
    ok: cfg.enabled,
    severity: 'warn',
    hint: cfg.enabled
      ? null
      : 'با «خاموش»، کارگر چیزی نمی‌فرستد و صف دست‌نخورده می‌ماند — «همین حالا بفرست» و «آزمونِ ارسال» تنها استثناهاوند.',
  });
  checks.push({
    key: 'dry-run',
    label: 'حالتِ آزمایشی خاموش است',
    ok: !cfg.dryRun,
    severity: 'warn',
    hint: cfg.dryRun
      ? 'SMS_DRY_RUN روشن است: صف خوانده می‌شود اما به سامانه نمی‌رود. برایِ ارسالِ راستاین خاموشش کنید.'
      : null,
  });
  checks.push({
    key: 'sender',
    label: 'قالب‌ها شناسهٔ سامانه دارند',
    ok: blockedTemplates.every((t) => !!t.providerTemplateId || t.blocked === 0),
    severity: 'warn',
    hint: (() => {
      const missing = blockedTemplates.filter((t) => !t.providerTemplateId);
      if (missing.length === 0) return null;
      return `${missing.length} قالب شناسهٔ «ارسال‌کننده» ندارد (${missing.slice(0, 3).map((m) => m.key).join('، ')}${missing.length > 3 ? '…' : ''}) — تنظیمات ← پیامک ← قالب‌ها.`;
    })(),
  });
  checks.push({
    key: 'queue',
    label: 'صفی برایِ ارسال هست',
    ok: pending + failed > 0,
    severity: 'info',
    hint:
      pending + failed > 0
        ? waitingMinutes > 30
          ? `${pending + failed} پیام در صف است و قدیمی‌ترینشان ${waitingMinutes} دقیقه است — اگر «ارسالِ پیامک» روشن است، کارگرِ systemd اجرا نمی‌شود.`
          : null
        : dead > 0
          ? 'صفی نوبت‌خوردنی نیست؛ پیام‌هایِ «ناامیدکننده» با دکمهٔ بازگردانی برمی‌گردند.'
          : 'پیامکی در صف نیست (یعنی رویدادی برایِ ارسال ثبت نشده).',
  });
  if (sending > 0) {
    checks.push({
      key: 'sending',
      label: 'هیچ پیامی در حالتِ «در حالِ ارسال» نمانده',
      ok: false,
      severity: 'warn',
      hint: `${sending} پیام «در حالِ ارسال» است؛ اگر کارگر میانه‌یِ کار مرده باشد، پس از ${stale} دقیقه خودش آزاد می‌شود.`,
    });
  }

  const blockers = checks.filter((c) => !c.ok && c.severity === 'blocker');
  // «آمادهٔ ارسال» یعنی دکمهٔ پنل کاری می‌کند؛ با «ارسالِ پیامک» خاموش،
  // «همین حالا بفرست» هم هیچ چیزی را برنمی‌دارد، پس نمی‌تواند «آماده» باشد —
  // هرچند خاموش‌بودنِ خودِ ارسال، بلاکرِ تنظیمات نیست و نباید باشد
  const canSendNow = blockers.length === 0 && !cfg.dryRun && cfg.enabled;

  return {
    provider: cfg.provider,
    providerKnown,
    knownProviders: [...SMS_PROVIDERS],
    enabled: cfg.enabled,
    hasApiKey: !!cfg.apiKey,
    hasSender: !!cfg.sender,
    dryRun: cfg.dryRun,
    maxAttempts: cfg.maxAttempts,
    backoffMinutes: cfg.backoffMinutes,
    checks,
    counts,
    blockedTemplates,
    requeueable: blockedByConfig,
    canSendNow,
  };
}

export interface RequeueOptions {
  limit?: number;
  /** فقط پیام‌هایِ پشتِ یک قالبِ خاص (وقتی مدیر تازه همان را پر کرده) */
  templateKey?: string | null;
  /** بازگرداندنِ حتی خطاهایِ سامانه هم (پیش‌فرض: فقط خطاهایِ تنظیمی) */
  force?: boolean;
  /** پیام‌هایِ نوبت‌نخوردهٔ «ناموفق» را هم آزاد کند (مهلتِ بک‌آف را صفر می‌کند) */
  includeWaiting?: boolean;
}

export interface RequeueResult {
  requeued: number;
  statuses: Record<string, number>;
  stillBlocked: number;
  /** چیزی که مدیر باید بعدِ این کار بفهمد، نه پیش از آن */
  notes: string[];
}

/**
 * بازگرداندنِ پیام‌هایِ مسدودشده به صف.
 *
 * سه قاعده که از رویِ راحتی برنداشته می‌شوند:
 *  • `attempts` صفر می‌شود (منطقش همین است: «اشکالِ قبلی درست شد»)، اما
 *    `last_error` نگه داشته نمی‌ماند — پاکش می‌کنیم تا صندوق گمراه‌کننده نشود؛
 *  • پیامکِ `sent` هرگز دست نمی‌خورد. حتی با force. دوباره‌فرستادنِ «کدِ
 *    پرداخت موفق» به مشتری، از ندیدنِ یک پیامکِ تأییدِ تأخیر‌دار بدتر است؛
 *  • بی‌`force` فقط خطاهایِ تنظیمی برمی‌گردند، تا یک دکمه به تنهایی
 *    هزینهٔ دوباره رویِ شماره‌هایِ مسدود نسوزاند.
 */
export async function requeueSmsMessages(
  db: Queryable,
  opts: RequeueOptions = {},
): Promise<RequeueResult> {
  const limit = Math.min(Math.max(Number(opts.limit ?? 500) || 500, 1), 5000);
  const notes: string[] = [];
  // پارامترها و شماره‌یِ $N در یک حلقه ساخته می‌شوند، نه با دست‌نوشت: «$2
  // ثابت» کنارِ یک فیلترِ اختیاری یعنی با اضافه‌شدنِ فیلتر، LIMIT و قالب
  // جابه‌جا شوند — خطایی که آزمونِ کوئریِ تنها هرگز نمی‌بیند.
  const gate = opts.includeWaiting
    // نسخهٔ «عجله‌دار»: مهلتِ بک‌آف را هم دور می‌زند. توجه که 'failed' در
    // حالتِ عادی اینجا نیست — نوبتش که برسد، خودِ کارگر برمی‌دارد و شمردنش
    // در «بازگردانده‌شد» یعنی عددِ دروغ در پنل.
    // «همین حالا برود» — سه حالتِ بلوکه‌شدن:
    //   • dead: سقفِ تلاش تمام شده و نوبتی نمی‌آید
    //   • failed با available_at در آینده: مهلتِ بک‌آف، و اگر مدیر خانه را
    //     پر کرده، منتظرِ ۴۰ دقیقه ماندنِ یک پیامِ تأییدِ سفارش معنایی ندارد
    //   • sendingِ گذشته: کارگر میانه‌یِ کار مرده و قفلش رها نشده
    // «pendingِ عادی» بی‌کار است، پس در هیچ حالتی فهرست نمی‌شود — وگرنه
    // شمارشِ «بازگردانده‌شد» عددِ دروغ می‌دهد.
    ? `(
        status IN ('dead','failed')
        OR (status = 'sending' AND available_at <= now())
      )`
    : REQUEUE_GATE_SQL;
  const where: string[] = [`(${gate})`];
  const params: unknown[] = [];
  if (!opts.force) {
    params.push(CONFIGISH_SQL);
    // دو استثنا روی الگو:
    //   • last_error = NULL → پیامکی که هنوز هیچ تلاشی نکرده، «خطایِ
    //     سامانه» ندارد که فیلترش کنیم؛
    //   • status = 'failed' → ذاتاً «خطایِ سامانه، فعلاً» است و در شاخه‌یِ
    //     includeWaiting فقط وقتی انتخاب می‌شود که مهلتِ بک‌آفش را دور بزنیم؛
    //     الگو را رویش سوارکردن یعنی همین حالت هیچ‌وقت بازنگردد.
    where.push(
      `(last_error IS NULL OR status = 'failed' OR last_error ~ $${params.length})`,
    );
  }
  if (opts.templateKey) {
    params.push(opts.templateKey);
    where.push(`template_key = $${params.length}`);
  }
  params.push(limit);

  const { rows } = await db.query<{ id: string; from_status: string }>(
    `WITH picked AS (
       SELECT id, status FROM sms_outbox
        WHERE ${where.join('\n          AND ')}
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $${params.length}
     )
     UPDATE sms_outbox o
        SET status = 'pending',
            attempts = 0,
            last_error = NULL,
            available_at = now()
       FROM picked p WHERE o.id = p.id
     RETURNING o.id, p.status AS from_status`,
    params,
  );

  const statuses: Record<string, number> = {};
  for (const r of rows) statuses[r.from_status] = (statuses[r.from_status] ?? 0) + 1;

  if (rows.length === 0) {
    notes.push(
      opts.force
        ? 'چیزی برایِ بازگردانی نبود (صف یا خالی است یا پیامک‌ها فرستاده شده‌اند).'
        : 'چیزی برایِ بازگردانی نبود؛ اگر پیام‌ها با خطایِ سامانه (نه تنظیم) رد شده‌اند، «اجباری» را بزنید — البته اول علتِ سامانه را برطرف کنید.',
    );
  } else {
    notes.push(
      `${rows.length} پیام دوباره در صف نشست (بدونِ خطاهایِ سامانه‌ای، بی‌«اجباری» ${
        opts.force ? '' : 'فیلتر شد'
      }).`,
    );
    if (statuses.dead) notes.push(`${faDigits(statuses.dead)} تا از «ناامیدکننده» برگشتند.`);
    if (statuses.sending) notes.push(`${faDigits(statuses.sending)} تا که «در حالِ ارسال» قفل شده بودند آزاد شدند.`);
  }

  const still = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM sms_outbox
      WHERE status IN ('failed','dead') AND last_error IS NOT NULL`,
  );

  return {
    requeued: rows.length,
    statuses,
    stillBlocked: Number(still.rows[0]?.n ?? 0),
    notes,
  };
}
