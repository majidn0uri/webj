import type { Database, Queryable } from '@set/db';
import { isValidMobile, normalizeMobile } from '@set/shared-kernel';
import { getSetting } from './settings.js';
import { renderTemplate, type SmsTemplateKey } from './sms.js';

/**
 * ارسالِ راستینِ پیامک — حلقه‌یِ «صف ← سامانه».
 *
 * تا پیش از این، `enqueueSms` پیام را در `sms_outbox` می‌نشاند و هیچ‌کس آن را
 * برنمی‌داشت؛ یعنی «ارسالِ پیامک» عملاً یک ادعا بود. این فایل همان حلقه است:
 * پیام‌هایِ رسیده را برمی‌دارد، به سامانه می‌فرستد، و نتیجه را (با خطایِ خوانا
 * و تلاشِ دوباره‌یِ فاصله‌دار) می‌نویسد.
 *
 * سه تصمیمِ ساختاری که نباید سرِ راحتی عوض شوند:
 *
 * ۱) **قالبِ تأییدشده، متنِ آزاد نیست.** سامانه‌هایِ ایرانی پیامِ متنِ آزاد را
 *    (مگر با شماره‌یِ سامانه‌ای/سازمانی) نمی‌پذیرند و اگر بپذیرند، بعداً مسدود
 *    می‌کنند. پس اگر قالب در پنل «شناسه‌یِ قالبِ ارسال‌کننده» داشت، با همان
 *    شناسه و متغیرها ارسال می‌شود (`lookup` در کاوه‌نگار)؛ اگر نداشت و متن
 *    جای‌نگهداری‌شده داشت، همان جای‌نگهداری‌ها را به‌عنوانِ متغیر می‌فرستیم؛
 *    و اگر هیچ‌کدام نبود، فرستادنِ متنِ آزاد **رد** می‌شود با پیامی که بگوید
 *    چه چیزی را در پنل پر کن — نه یک خطایِ مبهم از سمتِ سامانه.
 *
 * ۲) **`fetch` تزریق‌شدنی است، نه صدازدنِ مستقیم.** هم برایِ آزمون (که نمی‌توان
 *    به نامِ یک شرکتِ پیامکیِ واقعی بسته شد)، هم برایِ همین بندِ بعدی.
 *
 * ۳) **«فقط ایران» دیگر فقط یک پرچم در تنظیمات نیست.** `STRICT_IRAN_ONLY` تا
 *    پیشِ این در `apps/api/src/config.ts` خوانده می‌شد و **هیچ‌جا** به کار
 *    نمی‌رفت — یعنی یک ادعا در فایلِ تنظیمات. اینجا همان پرچم اجرا می‌شود:
 *    هر نشانیِ بیرون از فهرستِ سرویس‌هایِ ایرانی، پیش ازِ درخواست رد می‌شود.
 *    این همان چیزی است که اگر روزی کسی یک کتابخانه‌یِAnalytics یا CDN اضافه
 *    کند، سایت را به اینترنتِ بین‌الملل وابسته نمی‌کند.
 */

export type SmsProvider = 'none' | 'kavenegar' | 'melipayamak' | 'farazsms';

/** پاسخِ یک درخواستِ HTTP، در کمترینِ چیزی که این حلقه لازم دارد */
/** ارسال‌کننده‌هایِ شناخته‌شده — هر چیزِ دیگر بی‌سر‌و‌صدا به `none` برمی‌گردد */
export const SMS_PROVIDERS: readonly SmsProvider[] = ['none', 'kavenegar', 'melipayamak', 'farazsms'];

export interface HttpResponseLike {
  status: number;
  text(): Promise<string>;
}
export type HttpFetcher = (
  url: string,
  init?: Record<string, unknown>,
) => Promise<HttpResponseLike>;

/** نشانی‌هایی که «فقط ایران» آن‌ها را استثنا می‌کند: سرویس‌هایِ ایرانیِ ضروری */
export const IRAN_SERVICE_HOSTS: readonly string[] = [
  'api.kavenegar.com',
  'api.melipayamak.com',
  'sms.farazsms.com',
  'tax.gov.ir',
  'api.zarinpal.com',
  'sandbox.zarinpal.com',
  'idpay.ir',
  'api.idpay.ir',
];

export class OutsideIranError extends Error {
  readonly code = 'OUTSIDE_IRAN';
  constructor(readonly host: string) {
    super(
      `«فقط ایران» روشن است و «${host}» در فهرستِ سرویس‌هایِ ایرانی نیست. ` +
        `اگر سرویسِ ایرانیِ تازه‌ای است، به IRAN_SERVICE_HOSTS بیفزاییدش؛ ` +
        `اگر نیست، همین‌جا درست است که بیرون می‌ماند.`,
    );
    this.name = 'OutsideIranError';
  }
}

/**
 * یک نگهبان، سه کار: فقط https (کلیدِ پیامک رویِ http یعنی سرقتِ کلید در
 * همان شبکه)، فقط ایران (بیرون از فهرست، بی‌درخواست)، و timeout.
 *
 * نکته: `localhost` و IPهایِ داخلی آزادند — بی‌این نه آزمون می‌گذرد و نه
 * استقرارِ آزمایشیِ رویِ یک سرورِ داخلِ شبکه بالا می‌آید.
 */
export function guardRequest(
  url: string,
  opts: { strictIranOnly?: boolean; allowInsecure?: boolean; extraHosts?: string[] } = {},
): { fetchUrl: string; dispatcher?: unknown } {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  // فهرستِ بازِ آگاهانه: پیش‌فرض تهی است و تنها با SMS_EXTRA_HOSTS پر می‌شود.
  // بی‌این، پیغامِ «به فهرستِ مجاز بیفزاییدش» فقط ادعا بود؛ و بدونِ مهلتِ
  // درخواست، یک سامانهٔ پایین‌آمده کارگرِ oneshot را تا ابد نگه می‌داشت.
  const extra = (opts.extraHosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
  const allowed = IRAN_SERVICE_HOSTS.includes(host) || extra.includes(host);
  const local =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (u.protocol !== 'https:' && !local) {
    if (!opts.allowInsecure) {
      throw new Error(
        `«${host}» با http باز نمی‌شود: کلیدِ ارسالِ پیامک رویِ http یعنی ` +
          `دزدیده‌شدنِ همان کلید. یا https بگذارید یا SMS_ALLOW_INSECURE=1 (فقطِ آزمایش).`,
      );
    }
  }
  if (u.protocol === 'http:' && !local && opts.allowInsecure) {
    // آگاهانه: فقط برایِ سرورِ آزمایشیِ رویِ شبکه‌یِ داخلی
  }

  if (opts.strictIranOnly !== false && !local && !allowed) {
    throw new OutsideIranError(host);
  }
  return { fetchUrl: u.toString() };
}

/** میزبان‌هایِ مجازِ اضافه، از محیط (فقط برایِ سرورِ آزمایشی/آینه) */
export function extraHostsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.SMS_EXTRA_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/**
 * نگهبانِ نشانی + مهلت، در یک بسته؛ تا حلقهٔ کارگر و «آزمونِ دستیِ پنل»
 * دقیقاً از یک مسیر بگذرند — دو مسیرِ جدا، دو رفتارِ متفاوت می‌سازد.
 *
 * چرا مهلت را خودمان رقم نمی‌زنیم با `AbortSignal.timeout` و رهاکردنِ کار به
 * `fetch`؟ چون آن راه، فقط وقتی کار می‌کند که پیاده‌سازیِ پایینی به سیگنال
 * گوش دهد. یک `fetch` بی‌پاسخِ جاوااسکریپتی (یا بدلِ آزمونی) سیگنال را نادیده
 * می‌گیرد و کارگرِ `oneshot` تا ابد می‌خوابد — یعنی تایمرِ بعدی اجرا نمی‌شود و
 * صف پشتِ یک درخواستِ معلق می‌میرد. پس `Promise.race` با تایمرِ خودمان، و
 * سیگنال هم فرستاده می‌شود تا socket واقعاً بسته شود (بدورِ آن، هر دورِ کارگر
 * یک اتصالِ نشت‌کرده می‌گذارد).
 *
 * خطا «موقت» است: تأخیرِ سامانه دلیلِ دورانداختنِ پیامک از صف نیست.
 */
export function guardedFetchWithTimeout(
  cfg: Pick<SmsSendConfig, 'strictIranOnly' | 'allowInsecure' | 'timeoutMs' | 'extraHosts'>,
  fetchImpl?: HttpFetcher,
): HttpFetcher {
  const guarded = guardedFetch(fetchImpl ?? ((globalThis as { fetch: HttpFetcher }).fetch), {
    strictIranOnly: cfg.strictIranOnly,
    allowInsecure: cfg.allowInsecure,
    extraHosts: cfg.extraHosts ?? extraHostsFromEnv(),
  });
  const ms = cfg.timeoutMs;
  if (!Number.isFinite(ms) || ms <= 0) return guarded;

  return async (url, init) => {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      return await Promise.race([
        guarded(url, { ...(init ?? {}), signal: ac.signal }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new SmsProviderError(`سامانه در ${ms}ms پاسخ نداد (مهلتِ درخواست).`, true));
          }, ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      // لغو *فقط* وقتی مهلت رد شده: اگر برنده‌یِ مسابقه خودِ پاسخ باشد و اینجا
      // abort کنیم، بدنه‌یِ درخواستِ سالم در لحظه‌یِ خواندن (res.text()) می‌شکند
      if (timedOut) ac.abort();
    }
  };
}

/** پاسخِ یک درخواستِ تک‌بار به سامانه (بی‌صف، بی‌تلاشِ دوباره) */
export interface DispatchResult {
  ref: string | null;
  httpStatus: number;
  /** پاسخِ خامِ سامانه، کوتاه‌شده — فقط در «آزمونِ ارسال» به پنل می‌رود */
  raw: string;
}

/** همان نشانی + یک `fetch` که نگهبان از سرِش رد شده است */
export function guardedFetch(
  real: HttpFetcher,
  opts: { strictIranOnly?: boolean; allowInsecure?: boolean; extraHosts?: string[] } = {},
): HttpFetcher {
  return async (url, init) => {
    const { fetchUrl } = guardRequest(url, opts);
    return real(fetchUrl, init);
  };
}

/* ───────────────────────────────────────────────────────────────────────── */
/* تنظیمات — پنل مقدم بر محیط، و هیچ‌کدام «رازی در مخزن» نمی‌سازد          */
/* ───────────────────────────────────────────────────────────────────────── */

export interface SmsSendConfig {
  provider: SmsProvider;
  /** کاوه‌نگار/فراز: کلیدِ API — ملی‌پیامک: `username|password` */
  apiKey: string;
  /** خطِ سرویسِ پیامکی (کاوه‌نگار: فقط وقتی قالبِ تأییدنشده بخواهیم متنِ آزاد بفرستیم) */
  sender: string;
  /** کاوه‌نگار: فرستادن از «خطِ سرویس» به‌جایِ شماره‌یِ سازمانی */
  service: boolean;
  maxAttempts: number;
  backoffMinutes: number;
  timeoutMs: number;
  /** برایِ استقرارِ تستی رویِ سرورِ داخلی */
  allowInsecure: boolean;
  strictIranOnly: boolean;
  /** نشانی‌هایِ جایگزین (تست/سرورِ آینه‌ای) */
  endpoints: Partial<Record<SmsProvider, string>>;
  /** میزبان‌هایی که آگاهانه به فهرستِ «فقط ایران» افزوده شده‌اند */
  extraHosts: string[];
  enabled: boolean;
  /** اگر روشن باشد، بی‌اعتبار به sms_enabled، پیام‌ها در صف می‌مانند */
  dryRun: boolean;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'ok', 'بله']);

export async function readSmsSendConfig(
  db: Queryable,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SmsSendConfig> {
  const rawProvider = ((await getSetting(db, 'sms_provider')) || env.SMS_PROVIDER || 'none')
    .trim()
    .toLowerCase();
  // مقدارِ ناآشنا «ساکت» به none برمی‌گردد و کارگر در همان دور می‌گوید چرا:
  // فرستادنِ پیام به یک سامانه‌یِ اشتباه، از ردِّ صریح بدتر است
  const provider = (SMS_PROVIDERS as readonly string[]).includes(rawProvider)
    ? (rawProvider as SmsProvider)
    : 'none';
  const apiKey = ((await getSetting(db, 'sms_api_key')) || env.SMS_API_KEY || '').trim();
  const sender = ((await getSetting(db, 'sms_sender')) || env.SMS_SENDER || '').trim();
  const enabledRaw = (await getSetting(db, 'sms_enabled')) || 'false';

  const num = async (key: string, fallback: number): Promise<number> => {
    const v = Number((await getSetting(db, key)) || '');
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };

  return {
    provider,
    apiKey,
    sender,
    service: TRUTHY.has((env.SMS_KAVENEGAR_SERVICE ?? '').trim().toLowerCase()),
    maxAttempts: await num('sms_max_attempts', Number(env.SMS_MAX_ATTEMPTS ?? 5)),
    backoffMinutes: await num('sms_retry_minutes', Number(env.SMS_RETRY_MINUTES ?? 10)),
    timeoutMs: Number(env.SMS_TIMEOUT_MS ?? 10_000),
    allowInsecure: TRUTHY.has((env.SMS_ALLOW_INSECURE ?? '').trim().toLowerCase()),
    strictIranOnly: !(env.STRICT_IRAN_ONLY ?? 'true').trim().toLowerCase().match(/^(0|false|no|خیر)$/),
    extraHosts: extraHostsFromEnv(env),
    endpoints: {
      kavenegar: env.SMS_KAVENEGAR_URL?.trim() || undefined,
      melipayamak: env.SMS_MELI_URL?.trim() || undefined,
      farazsms: env.SMS_FARAZ_URL?.trim() || undefined,
    },
    enabled: TRUTHY.has(enabledRaw.trim().toLowerCase()),
    dryRun: TRUTHY.has((env.SMS_DRY_RUN ?? '').trim().toLowerCase()),
  };
}

/* ───────────────────────────────────────────────────────────────────────── */
/* قالب‌ها — «شناسه‌یِ ارسال‌کننده» و «متغیرهایِ لازمِ متن»                  */
/* ───────────────────────────────────────────────────────────────────────── */

export interface TemplateInfo {
  key: string;
  providerTemplateId: string | null;
  placeholders: string[];
}

/** جای‌نگهداری‌هایِ متن، به همان ترتیبی که در متن آمده‌اند */
export function placeholdersOf(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(/\{(\w+)\}/g)) if (!seen.includes(m[1]!)) seen.push(m[1]!);
  return seen;
}

export async function templateInfoFor(
  db: Queryable,
  keys: string[],
): Promise<Map<string, TemplateInfo>> {
  if (keys.length === 0) return new Map();
  const { rows } = await db.query<{
    key: string;
    provider_template_id: string | null;
    body: string;
  }>(
    `SELECT key, provider_template_id, body FROM sms_templates WHERE key = ANY($1::text[])`,
    [keys],
  );
  return new Map(
    rows.map((r) => [
      r.key,
      {
        key: r.key,
        providerTemplateId: r.provider_template_id,
        placeholders: placeholdersOf(r.body),
      },
    ]),
  );
}

/**
 * متنِ پیامک به «پارامترهایِ قالبِ سامانه» تبدیل می‌شود.
 *
 * چرا نه فرستادنِ خودِ متن؟ چون قالبِ تأییدشده چیزی است که سامانه می‌شناسد؛
 * متنِ ما برایِ نمایش و پیش‌نمایش است. اگر متنِ ما `{order}` و قالبِ سامانه
 * `{token}` باشد، ترتیبِ جای‌نگهداری‌ها تنها پلِ قابل‌اطمینان است — و بی‌پل،
 * ارسالِ متنِ آزاد رد می‌شود (بندِ ۱ بالایِ همین فایل).
 */
/**
 * قالبِ خام را به الگویِ منظم تبدیل می‌کند تا **مقادیرِ واقعی** را از متنِ
 * رندرشده بیرون بکشد.
 *
 * چرا این کار لازم است؟ چون `sms_outbox` فقط متنِ آماده را نگه می‌دارد و متغیرها
 * را نه — پس اگر مستقیمِ نامِ جای‌نگهداری‌ها را برایِ سامانه بفرستیم، چنین
 * درخواستی ساخته می‌شود: `token=order&token2=store` (و این دقیقاً همان باگی بود
 * که سنجشِ راستینِ این مسیر لو داد). با بازگرداندنِ الگو رویِ متنِ رندرشده،
 * مقدارِ درست می‌نشیند.
 *
 * محدودیتِ آگاهانه: تطبیق «هر چیزِ میانِ دو بخشِ ثابت» است، نه پارسرِ کامل؛
 * اگر فروشنده دو متغیرِ بی‌فاصله در متن بگذارد، ممکن است یکی‌شان کشیده نشود.
 * به همین دلیل مقدارِ ناجور در آزمون سنجیده می‌شود و اگر روزی لازم شد،
 * راهِ درستِ همان این است که `enqueueSms` خودِ متغیرها را هم در صف بنویسد.
 */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** بخش‌هایِ ثابتِ قالب و نامِ متغیرهایش، به همان ترتیبِ متن */
export function splitTemplate(rawTemplate: string): { literal: string; var: string }[] {
  const out: { literal: string; var: string }[] = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  for (const m of rawTemplate.matchAll(re)) {
    out.push({ literal: rawTemplate.slice(last, m.index), var: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < rawTemplate.length || out.length === 0) {
    out.push({ literal: rawTemplate.slice(last), var: '' });
  }
  return out;
}

export function extractVars(
  rendered: string,
  rawTemplate: string,
  order: string[],
): { ok: true; vars: string[] } | { ok: false; reason: string } {
  if (order.length === 0) {
    // قالبِ بی‌متغیر (مثلِ «حساب شما فعال شد») — چیزی برایِ فرستادن نیست و
    // این اشکال نیست؛ بسیاری از قالب‌هایِ تأییدشده بی‌متغیرند
    return { ok: true, vars: [] };
  }
  // الگو: هر بخشِ ثابت دست‌نشین، و پس ازِ هر متغیر «کمترینِ چیزی که جا بیفتد».
  // بخش‌ها از *همهٔ* قطعه‌هایِ قالب ساخته می‌شوند (نه فقط قطعه‌هایِ دارایِ
  // متغیر)، وگرنه دُمِ متن از الگو می‌افتد و هر رشته‌ای مطابق می‌شود.
  const all = splitTemplate(rawTemplate);
  let m: RegExpMatchArray | null = null;
  try {
    const pattern = all
      .map((part, i) => escapeRe(part.literal) + (part.var ? '(?<v' + i + '>.+?)' : ''))
      .join('');
    m = rendered.match(new RegExp('^' + pattern + '$', 's'));
  } catch {
    m = null;
  }
  if (!m?.groups) {
    return {
      ok: false,
      reason:
        'متنِ پیام با قالبِ خودش هم‌خوانی ندارد (قالب پس ازِ رندرِ متن عوض شده یا ' +
        'سطرِ صف دستی ویرایش شده است)؛ قالب و صف را هم‌روز کنید.',
    };
  }
  // ترتیبِ متغیرها در *قالب* مرجع است، و مقادیر از همان‌جا برداشته می‌شوند
  const vars = all
    .map((part, i) => (part.var ? String(m!.groups?.['v' + i] ?? '').trim() : null))
    .filter((v): v is string => v !== null);
  if (vars.length !== order.length) {
    // جای‌نگهداری‌هایِ متنِ ما و قالبِ خام یکی نباشند (مثلاً قالب عوض شده)،
    // صفِ مقادیر جابه‌جا می‌شود — خطرناک‌تر از فرستادنِ پیامکِ بی‌متغیر
    return {
      ok: false,
      reason: `تعدادِ متغیرِ قالب (${order.length}) با متنِ رندرشده (${vars.length}) نمی‌خواند.`,
    };
  }
  return { ok: true, vars };
}

export async function rawTemplates(
  db: Queryable,
  keys: string[],
): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const { rows } = await db.query<{ key: string; body: string }>(
    `SELECT key, body FROM sms_templates WHERE key = ANY($1::text[])`,
    [keys],
  );
  return new Map(rows.map((r) => [r.key, r.body]));
}

/**
 * آیا این سامانه با این تنظیمات «متنِ آزاد» می‌فرستد؟
 *
 * کاوه‌نگار (`send`)، ملی‌پیامک (`send/simple`) و فراز (`send`) هر سه یک مسیرِ
 * متنِ آزاد دارند و تنها چیزی که می‌خواهند یک **خطِ پیامک** تنظیم‌شده است. پس
 * «قالبِ تأییدنشده» سرنوشتِ پیامک نیست — فقط وقتی سرنوشت است که نه شناسهٔ قالب
 * داشته باشیم و نه خط.
 */
export function canSendFreeText(cfg: Pick<SmsSendConfig, 'sender' | 'service'>): boolean {
  // «خطِ سرویس» کافی نیست: کاوه‌نگارِ بی‌`sender` خودِ درخواست را رد می‌کند
  // (`sendViaKavenegar`)، و آزادکردنِ متنِ آزاد در آن حالت یعنی یک تلاشِ سوخته و
  // یک پیامکِ نزدیک‌تر به `dead`. تنها چیزی که مسیرِ متنِ آزاد را باز می‌کند،
  // همان خطِ پیامک است — که در پنل تنظیم می‌شود.
  return cfg.sender.trim() !== '';
}

export function varsForTemplate(
  body: string,
  info: TemplateInfo | undefined,
  rawTemplate?: string,
  /** از `sendDue` می‌آید: اگر سامانه «خطِ پیامک» دارد، متنِ آزاد مجاز است */
  policy: { allowFreeText?: boolean } = {},
): { ok: true; vars: string[] } | { ok: false; reason: string } {
  if (!info?.providerTemplateId) {
    // پیش از این، همین‌جا بی‌قید رد می‌شد («سامانه‌هایِ ایرانی متنِ آزاد را نمی‌پذیرند»).
    // آن جمله درست نبود و گران تمام شد: با کلیدِ معتبر و خطِ تنظیم‌شده، صفِ
    // `sms_outbox` **یک حرف هم نمی‌رفت** — یعنی دقیقاً همان «رخدادها ثبت
    // می‌شوند ولی پیامکی نمی‌رسد»ی که از بیرون، «وصل‌نشده» به‌نظر می‌آمد. دکمهٔ
    // «آزمونِ ارسال» در پنل (که مسیرِ خودش را می‌رود) سبز بود و صف، قرمزِ خاموش؛
    // دو پاسخِ متضاد به یک سوال.
    if (policy.allowFreeText) return { ok: true, vars: [] };
    return {
      ok: false,
      reason:
        `قالبِ «${info?.key ?? 'بی‌قالب'}» نه «شناسه‌یِ قالبِ ارسال‌کننده» دارد و نه «خطِ پیامک» — ` +
        `یکی از این دو لازم است: یا متنِ تأییدشده و شناسه‌اش را در تنظیمات ← پیامک ← قالب‌ها ` +
        `بگذارید، یا خطِ سرویس را در تنظیمات ← پیامک پر کنید تا متنِ آزاد فرستاده شود.`,
    };
  }
  const order = info.placeholders;
  if (order.length === 0) return { ok: true, vars: [] };
  if (!rawTemplate) return { ok: true, vars: [] };
  return extractVars(body, rawTemplate, order);
}

/* ───────────────────────────────────────────────────────────────────────── */
/* فرستنده‌ها                                                                */
/* ───────────────────────────────────────────────────────────────────────── */

export interface SendArgs {
  to: string;
  body: string;
  /** شناسه‌یِ قالبِ تأییدشده در سامانه (اگر نبود: ارسالِ متنِ آزاد یا رد) */
  templateId?: string;
  /** مقادیرِ جای‌نگهداریِ قالب، به ترتیبِ متن */
  vars?: string[];
}

export class SmsProviderError extends Error {
  constructor(
    message: string,
    /** آیا با تلاشِ دوباره ممکن است درست شود (قطعی/تأخیر) یا نه (کلیدِ غلط)؟ */
    readonly retryable = true,
    readonly status?: number,
    /** پاسخِ خامِ سامانه — چیزی که در «آزمونِ ارسال» به پنل نشان داده می‌شود،
     *  تا «اعتبار تمام شده» از «کلید غلط» و «قالب تأییدنشده» جدا شود */
    readonly raw?: string,
  ) {
    super(message);
    this.name = 'SmsProviderError';
  }
}

async function readJsonLike(res: HttpResponseLike): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return typeof JSON.parse(text) === 'object' && JSON.parse(text) !== null
      ? (JSON.parse(text) as Record<string, unknown>)
      : { raw: text };
  } catch {
    // بعضی سامانه‌ها در خطا HTML برمی‌گردانند؛ همان را در می‌نویسیم تا در پنل خوانده شود
    return { raw: text.slice(0, 400) };
  }
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

/** httpِ ۵xx و ۴۲۹ «شکستِ موقت» است؛ بقیه ۴xx یعنی تنظیم غلط و باید فریاد بزند */
function statusError(status: number, payload: Record<string, unknown>): SmsProviderError {
  const detail = firstString(
    (payload.errorMessage as string) ?? '',
    payload.message,
    payload.error,
    payload.description,
    payload.raw,
  );
  const retryable = status >= 500 || status === 429 || status === 408;
  return new SmsProviderError(
    `کدِ HTTP ${status}${detail ? ` — ${detail}` : ''}`,
    retryable,
    status,
    rawSnippet(payload),
  );
}

/**
 * کاوه‌نگار. دو مسیر دارد و تفاوتشان «هزینه» نیست، «قانون» است:
 *   • `lookup/send`  — قالبِ تأییدشده، بی‌نیاز از خطِ سرویس ✓
 *   • `send`         — متنِ آزاد، نیازمندِ «خطِ سرویس» که به شماره‌یِ سازمانی
 *                      وصل است؛ اگر نباشد، خودِ کاوه‌نگار رد می‌کند، پس ما
 *                      زودتر و روشن‌تر رد می‌کنیم.
 */
/** پاسخِ خام، کوتاه‌شده — برایِ «چرا نرفت؟» در پنل */
function rawSnippet(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload).slice(0, 600);
  } catch {
    return '«پاسخِ قابلِ نمایش نیست»';
  }
}

export async function sendViaKavenegar(
  args: SendArgs,
  cfg: Pick<SmsSendConfig, 'apiKey' | 'sender' | 'service'>,
  http: HttpFetcher,
  base = 'https://api.kavenegar.com/v1',
): Promise<DispatchResult> {
  if (!cfg.apiKey) throw new SmsProviderError('کلیدِ API کاوه‌نگار تنظیم نشده است.', false);
  const params = new URLSearchParams();
  const path = args.templateId ? 'lookup/send' : 'send';
  if (args.templateId) {
    params.set('template', args.templateId);
    // قراردادِ کاوه‌نگار: token، token2، token3 …
    (args.vars ?? []).forEach((v, i) => params.set(i === 0 ? 'token' : `token${i + 1}`, v));
  } else {
    if (!cfg.sender) {
      throw new SmsProviderError(
        'برایِ متنِ آزاد، «خطِ سرویسِ پیامکی» را در پنل تنظیم کنید (یا قالبِ تأییدشده بگذارید).',
        false,
      );
    }
    params.set('message', args.body.slice(0, 700));
  }
  params.set('receptor', args.to);
  if (cfg.service) params.set('service', '1');

  const url = `${base}/${cfg.apiKey}/${path}.json`;
  const res = await http(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const payload = await readJsonLike(res);
  if (res.status !== 200) throw statusError(res.status, payload);
  const returned = (payload.return as Record<string, unknown> | undefined) ?? payload;
  const code = Number(returned.statusCode ?? returned.code ?? 200);
  if (code !== 200) {
    throw new SmsProviderError(
      firstString(returned.errorMessage, payload.message, 'خطایِ ناشناخته از کاوه‌نگار')!,
      code >= 500,
      code,
      rawSnippet(payload),
    );
  }
  const entry = Array.isArray(returned.entries) ? (returned.entries as Record<string, unknown>[])[0] : undefined;
  return {
    ref: firstString(entry?.ticket, entry?.id, returned.messageId),
    httpStatus: res.status,
    raw: rawSnippet(payload),
  };
}

/** ملی‌پیامک — سرویسِ JSON (بی‌SOAP و بی‌وابستگیِ تازه) */
export async function sendViaMeliPayamak(
  args: SendArgs,
  cfg: Pick<SmsSendConfig, 'apiKey'>,
  http: HttpFetcher,
  base = 'https://api.melipayamak.com/api',
): Promise<DispatchResult> {
  const [username, ...rest] = cfg.apiKey.split('|');
  const password = rest.join('|');
  if (!username || !password) {
    throw new SmsProviderError(
      'در ملی‌پیامک، «کلیدِ ارسال‌کننده» باید «کاربری|گذرواژه» باشد.',
      false,
    );
  }
  const body = args.templateId
    ? // قالبِ کدگذاری‌شده: ملی‌پیامک هم مثلِ بقیه، متنِ آزاد را به‌سختی می‌پذیرد
      (() => {
        const p = new URLSearchParams();
        p.set('user_id', username);
        p.set('user_pass', password);
        p.set('to', args.to);
        p.set('op_code', args.templateId);
        (args.vars ?? []).forEach((v, i) => p.set(`p${i + 1}`, v));
        return p;
      })()
    : (() => {
        const p = new URLSearchParams();
        p.set('to', args.to);
        p.set('text', args.body.slice(0, 700));
        return p;
      })();

  const path = args.templateId ? `send/plan/${username}/${password}` : `send/simple/${username}/${password}`;
  const res = await http(`${base}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const payload = await readJsonLike(res);
  if (res.status !== 200) throw statusError(res.status, payload);
  const ref = firstString(payload.ReturnID, payload.returnID, payload.RetId);
  const errorCode = payload.ErrorCode ?? payload.errorCode;
  if (errorCode !== undefined && Number(errorCode) !== 0) {
    throw new SmsProviderError(
      firstString(payload.Message, payload.message, `کدِ خطا ${errorCode}`)!,
      Number(errorCode) >= 500,
      Number(errorCode),
      rawSnippet(payload),
    );
  }
  return { ref, httpStatus: res.status, raw: rawSnippet(payload) };
}

/** فراز‌اس‌ام‌اس — JSON با action=send */
export async function sendViaFaraz(
  args: SendArgs,
  cfg: Pick<SmsSendConfig, 'apiKey' | 'sender'>,
  http: HttpFetcher,
  base = 'https://sms.farazsms.com',
): Promise<DispatchResult> {
  if (!cfg.apiKey) throw new SmsProviderError('کلیدِ API فراز‌اس‌ام‌اس تنظیم نشده است.', false);
  if (args.templateId) {
    throw new SmsProviderError(
      'فراز‌اس‌ام‌اس در این نسخه با «شماره‌یِ خطِ سرویس + متن» کار می‌کند؛ قالبِ کدگذاری‌شده را در پنل بردارید.',
      false,
    );
  }
  if (!cfg.sender) {
    throw new SmsProviderError('برایِ فراز‌اس‌ام‌اس، «خطِ پیامک» (شماره‌یِ خط) را تنظیم کنید.', false);
  }
  const res = await http(`${base}/post.ashx?user=${encodeURIComponent(cfg.apiKey)}&action=send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msg: args.body.slice(0, 700), dst: [args.to], line: cfg.sender }),
  });
  const payload = await readJsonLike(res);
  if (res.status !== 200) throw statusError(res.status, payload);
  const info = firstString(payload.info, payload.message, payload.err);
  const sent = Number(payload.count ?? payload.sent ?? 0);
  if (res.status === 200 && sent === 0) {
    throw new SmsProviderError(info ?? 'فراز‌اس‌ام‌اس هیچ پیامی را نپذیرفت.', true);
  }
  return { ref: firstString(payload.uid, payload.ticket, info), httpStatus: res.status, raw: rawSnippet(payload) };
}

export async function dispatchOnce(
  cfg: SmsSendConfig,
  args: SendArgs,
  http: HttpFetcher,
  templateId?: string,
): Promise<DispatchResult> {
  const withTemplate = { ...args, templateId };
  switch (cfg.provider) {
    case 'kavenegar':
      return sendViaKavenegar(withTemplate, cfg, http, cfg.endpoints.kavenegar);
    case 'melipayamak':
      return sendViaMeliPayamak(withTemplate, cfg, http, cfg.endpoints.melipayamak);
    case 'farazsms':
      return sendViaFaraz(withTemplate, cfg, http, cfg.endpoints.farazsms);
    case 'none':
    default:
      throw new SmsProviderError('ارسال‌کننده‌ای انتخاب نشده است (تنظیمات ← پیامک ← ارسال‌کننده).', false);
  }
}

/* ───────────────────────────────────────────────────────────────────────── */
/* آزمونِ دستی — «کلیدم درست کار می‌کند؟» بی‌خریدِ بسته                     */
/* ───────────────────────────────────────────────────────────────────────── */

/**
 * مقدارهایِ نمونه برایِ هر جای‌نگهداری، تا مدیر **متنی را ببیند که مشتری
 * خواهد دید** — نه یک `{order}` خام. عمداً «نمونه» است و نه دادهٔ واقعی:
 * این پیام به شمارهٔ خودش می‌رود، پس سفارشِ جعلی در آن هیچ ضرری ندارد و
 * سودش این است که شکلِ نهاییِ پیام پیشِ چشمش باشد.
 */
/** رقمِ فارسی برایِ جمله‌هایِ خوانا — «1 پیام» در متنِ فارسی، باقی‌ماندهٔ
 * یک کارِ نیمه‌تمام است (پنل همه‌جا رقمِ فارسی نشان می‌دهد) */
export function faDigits(n: number | string): string {
  return String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);
}

export const SMS_SAMPLE_VARS: Record<string, string> = {
  order: 'ORD-1404',
  amount: '۱٬۲۵۰٬۰۰۰',
  code: '۴۸۲۱',
  tracking: 'TR-778899',
  invoice: 'INV-1024',
  link: 'forushgah.example/invoices/1024',
  check: '۱۲۳۴۵۶',
  date: '۱۴۰۴-۰۷-۲۷',
  product: 'هندزفری بلوتوثی',
  phone: '09120000000',
  store: 'ست‌شاپ',
};

export interface SmsTestInput {
  phone: string;
  /** اگر داده نشود، فعال‌ترین قالب برایِ آزمون انتخاب می‌شود */
  templateKey?: string;
  /** جای‌نگهدارهایِ دلخواه؛ نمونه‌ها در غیابشان به کار می‌روند */
  vars?: Record<string, string>;
}

export interface SmsTestResult {
  ok: boolean;
  phone: string;
  provider: string;
  templateKey: string | null;
  /** شناسه‌ای که به سامانه فرستاده شد (null یعنی متنِ آزاد رفت) */
  providerTemplateId: string | null;
  vars: string[];
  body: string;
  dryRun: boolean;
  elapsedMs: number;
  httpStatus: number | null;
  providerCode: number | null;
  ref: string | null;
  /** پاسخِ خامِ سامانه، کوتاه‌شده */
  raw: string | null;
  error: string | null;
  retryable: boolean | null;
  notes: string[];
}

/**
 * یک پیامکِ تک، بی‌صف و بی‌تلاشِ دوباره، با پاسخِ خامِ سامانه.
 *
 * چرا اصلاً لازم است؟ چون «پیامک نمی‌رسد» در فروشگاه‌هایِ ایرانی سه علتِ
 * کاملاً متفاوت دارد — کلیدِ غلط، قالبِ تأییدنشده، اعتبارِ تمام‌شده — و هر
 * سه در لاگِ کارگر یک شکل دیده می‌شوند. این مسیر همان یک تماس را با صدایِ
 * بلند و با پاسخِ خام برمی‌گرداند تا تشخیص، بی‌حدس‌زدن انجام شود.
 *
 * دو چیز عمداً اینجا نیست: نوشته‌شدن در `sms_outbox` (صفِ واقعی نباید با یک
 * آزمونِ تنظیمی آلوده شود) و نادیده‌گرفتنِ `sms_enabled` (اگر مدیر «خاموش»
 * گذاشته، حقِ او است که صف نرود؛ اما آزمونِ دستی یعنی «می‌خواهم ببینم
 * کار می‌کند یا نه» و روشن‌ترین پاسخ در همان لحظه، فرستادنِ همان یک پیام است
 * — و همین دلیلِ محدودسازی‌اش در کنترلر است: اعتبارِ واقعی می‌سوزاند).
 */
export async function sendSmsTest(
  db: Queryable,
  cfg: SmsSendConfig,
  input: SmsTestInput,
  fetchImpl?: HttpFetcher,
): Promise<SmsTestResult> {
  const startedAt = Date.now();
  // «اول بسنج، بعد نرمال کن»: نرمال‌کردنِ زودهنگام، بی‌اعتبار را قیافه‌یِ
  // معتبر می‌کند ('912…' → '0912…' ✓، اما '12345' → '012345' که پنل باید
  // همان اول رد کند، نه این‌که شمارهٔ تحریف‌شده را به سامانه بدهد)
  const rawPhone = String(input.phone ?? '').trim();
  const out: SmsTestResult = {
    ok: false,
    phone: isValidMobile(rawPhone) ? normalizeMobile(rawPhone) : rawPhone,
    provider: cfg.provider,
    templateKey: null,
    providerTemplateId: null,
    vars: [],
    body: '',
    dryRun: cfg.dryRun,
    elapsedMs: 0,
    httpStatus: null,
    providerCode: null,
    ref: null,
    raw: null,
    error: null,
    retryable: null,
    notes: [],
  };

  if (!isValidMobile(rawPhone)) {
    out.error = 'شماره معتبر نیست؛ شکلِ قابلِ قبول: 09123456789';
    out.elapsedMs = Date.now() - startedAt;
    return out;
  }

  if (cfg.provider === 'none') {
    out.error = 'ارسال‌کننده‌ای انتخاب نشده است (تنظیمات ← پیامک ← ارسال‌کننده).';
    out.elapsedMs = Date.now() - startedAt;
    return out;
  }
  if (!cfg.apiKey) {
    out.error =
      cfg.provider === 'melipayamak'
        ? '«کلیدِ ارسال‌کننده» خالی است؛ در ملی‌پیامک شکلش «کاربری|گذرواژه» است.'
        : '«کلیدِ ارسال‌کننده» خالی است؛ آن را در تنظیمات ← پیامک پر کنید.';
    out.elapsedMs = Date.now() - startedAt;
    return out;
  }

  // قالب: داده‌شده، یا فعال‌ترینِ فهرست (تا یک کلیک کافی باشد)
  const wanted = (input.templateKey ?? '').trim();
  const { rows } = await db.query<{ key: string; body: string; provider_template_id: string | null }>(
    wanted
      ? `SELECT key, body, provider_template_id FROM sms_templates WHERE key = $1`
      : `SELECT key, body, provider_template_id FROM sms_templates
          WHERE is_active = true ORDER BY key LIMIT 1`,
    wanted ? [wanted] : [],
  );
  const tpl = rows[0];
  if (!tpl) {
    out.error = wanted ? `قالبِ «${wanted}» در بانک نیست.` : 'هیچ قالبِ فعالی در پنل نیست.';
    out.elapsedMs = Date.now() - startedAt;
    return out;
  }
  out.templateKey = tpl.key;
  out.providerTemplateId = tpl.provider_template_id;

  // متن، با همان تابعِ مسیرِ واقعی (renderTemplate) تا چیزی که می‌بینیم
  // چیزی باشد که مشتری می‌گیرد — store_name هم از پنل خوانده می‌شود
  const names = placeholdersOf(tpl.body);
  const vars: Record<string, string> = {};
  for (const n of names) {
    vars[n] = input.vars?.[n]?.trim() || SMS_SAMPLE_VARS[n] || `«${n}»`;
  }
  try {
    out.body = await renderTemplate(db, tpl.key as SmsTemplateKey, vars);
  } catch (err) {
    out.error = (err as Error).message;
    out.elapsedMs = Date.now() - startedAt;
    return out;
  }

  if (!tpl.provider_template_id) {
    out.notes.push(
      canSendFreeText(cfg)
        ? 'این قالب «شناسهٔ قالبِ ارسال‌کننده» ندارد، پس **متنِ آزاد** با خطِ سرویس می‌رود (همان کاری که کارگرِ صف هم می‌کند).'
        : 'این قالب نه «شناسهٔ قالبِ ارسال‌کننده» دارد و نه «خطِ پیامک» تنظیم شده — پس در صفِ واقعی رد می‌شود. یکی از این دو را از پنل پر کنید.',
    );
    out.vars = [];
  } else {
    // همان استخراجِ مسیرِ واقعی: مقدارها از متنِ رندرشده، نه از نامِ متغیرها
    const raws = await rawTemplates(db, [tpl.key]);
    const prepared = varsForTemplate(out.body, { key: tpl.key, providerTemplateId: tpl.provider_template_id, placeholders: names }, raws.get(tpl.key));
    if (!prepared.ok) {
      out.error = prepared.reason;
      out.elapsedMs = Date.now() - startedAt;
      return out;
    }
    out.vars = prepared.vars;
  }

  if (cfg.dryRun) {
    out.ok = true;
    out.error = null;
    out.notes.push('SMS_DRY_RUN روشن است: درخواست ساخته شد اما به سامانه نرفت.');
    out.elapsedMs = Date.now() - startedAt;
    return out;
  }

  const http = guardedFetchWithTimeout(cfg, fetchImpl);
  try {
    const r = await dispatchOnce(
      cfg,
      { to: out.phone, body: out.body, vars: out.vars },
      http,
      out.providerTemplateId ?? undefined,
    );
    out.ok = true;
    out.httpStatus = r.httpStatus;
    out.providerCode = null;
    out.ref = r.ref;
    out.raw = r.raw;
    out.elapsedMs = Date.now() - startedAt;
    return out;
  } catch (err) {
    const e = err as { message?: string; status?: number; retryable?: boolean; raw?: string; name?: string };
    out.error = e.message ?? 'خطایِ ناشناخته';
    // کاوه‌نگار/ملی کدِ خطا را در بدنه می‌گذارند و نه در HTTP؛ پس هر دو فیلد
    // پر می‌شوند تا پنل بتواند بگوید «۴۰۴ از خودِ سامانه» یا «۵۰۲ از شبکه»
    out.httpStatus = typeof e.status === 'number' && e.status >= 100 && e.status <= 599 ? e.status : null;
    out.providerCode = typeof e.status === 'number' ? e.status : null;
    out.retryable = typeof e.retryable === 'boolean' ? e.retryable : null;
    out.raw = e.raw ?? null;
    out.elapsedMs = Date.now() - startedAt;
    if (e.name === 'OutsideIranError') {
      out.notes.push('پالایشِ «فقط ایران» جلویِ درخواست را گرفت؛ نشانیِ سامانه را در پنلِ تنظیمات ببینید.');
    }
    return out;
  }
}

/* ───────────────────────────────────────────────────────────────────────── */
/* حلقهٔ کارگر                                                               */
/* ───────────────────────────────────────────────────────────────────────── */

export interface DueRow {
  id: string;
  phone: string;
  body: string;
  template_key: string | null;
  attempts: number;
}

export interface ClaimOptions {
  limit: number;
  maxAttempts: number;
  /** «sending»ِ مانده از کارگرِ مرده، پس ازِ این مهلت آزاد می‌شود */
  staleSendingMinutes?: number;
}

/**
 * برداشتنِ دسته‌ای از صف، با قفل.
 *
 * `FOR UPDATE SKIP LOCKED` عمده است: دو کارگرِ هم‌زمان (یا کارگرِ systemd و یک
 * «ارسالِ دستی» از پنل) نباید یک پیام را دو بار بفرستند — پیامکِ تکراریِ
 * «کدِ ورود» بدتر از تأخیرِ آن است. بی‌`SKIP LOCKED`، کارگرِ دوم قفلِ اول را
 * منتظر می‌ماند و صفِ دو ثانیه‌ای به دقیقه‌ها می‌کشد.
 *
 * `available_at` در همین جا به «حالا + مهلتِ sending» می‌رود و ستونِ تازه‌ای
 * لازم نمی‌شود: اگر کارگر میانه‌یِ کار بمیرد، پیام پس ازِ آن مهلت **خودبه‌خود**
 * دوباره نوبت می‌گیرد (فراخوانیِ `releaseStaleSending` در آغازِ هر دور) — نه
 * این‌که تا ابد در وضعیتِ «در حالِ ارسال» بلوکه بماند.
 */
export async function claimDueMessages(
  db: Queryable,
  opts: ClaimOptions,
): Promise<DueRow[]> {
  const sendingTimeout = opts.staleSendingMinutes ?? 10;
  const { rows } = await db.query<DueRow>(
    `WITH picked AS (
       SELECT id FROM sms_outbox
        WHERE attempts < $2
          AND status IN ('pending','failed')
          AND available_at <= now()
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $1
     )
     UPDATE sms_outbox o
        SET status = 'sending',
            attempts = o.attempts + 1,
            -- ردپایِ «کارگر کی این را برداشت»: صفحهٔ پایش بی‌این، خوابِ کارگر
            -- را از «نوبتِ تلاشِ بعدی» حدس می‌زد و حدسش در قطعیِ سامانه غلط
            -- می‌شد (نوبتِ بعد به آینده نگاه می‌کند، نه به گذشته)
            last_attempt_at = now(),
            available_at = now() + ($3 || ' minutes')::interval
       FROM picked p WHERE o.id = p.id
     RETURNING o.id, o.phone, o.body, o.template_key, o.attempts`,
    [opts.limit, opts.maxAttempts, String(sendingTimeout)],
  );
  return rows;
}

/** پیام‌هایی که کارگرشان پیش ازِ نتیجه مرد — در آغازِ هر دور صدا زده می‌شود */
export async function releaseStaleSending(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE sms_outbox
        SET status = 'failed',
            last_error = 'کارگر پیش از گرفتنِ نتیجه متوقف شد؛ دوباره در صف نشست.'
      WHERE status = 'sending' AND available_at <= now()
      RETURNING id`,
  );
  return rows.length;
}

export interface SendResult {
  claimed: number;
  sent: number;
  failed: number;
  dead: number;
  skipped: number;
  notes: string[];
}

/**
 * یک دورِ ارسال. **بی‌اثر در تکرار نیست** — و عمداً هم نیست که باشد: پیامکِ
 * دوباره‌فرستاده‌شده بهتر از پیامکی است که هیچ‌وقت نرسیده (کدِ ورودِ گم‌شده
 * یعنی مشتریِ از دست رفته). در عوض «دو بار هم‌زمان» با قفلِ بالا ممکن نیست.
 */
export async function sendDue(
  db: Database,
  cfg: SmsSendConfig,
  deps: {
    fetchImpl?: HttpFetcher;
    limit?: number;
    /** ارسالِ دستیِ مدیر از پنل (و آزمون): «ارسالِ پیامک» را روشن فرض می‌کند */
    ignoreEnablement?: boolean;
  } = {},
): Promise<SendResult> {
  const result: SendResult = { claimed: 0, sent: 0, failed: 0, dead: 0, skipped: 0, notes: [] };

  if (cfg.provider === 'none') {
    result.notes.push('ارسال‌کننده انتخاب نشده؛ صف دست‌نخورده ماند.');
    return result;
  }
  // «خاموش» یعنی خاموش — بی‌هیچ استثنا؛ تنها راهِ ردکردنش پرچمِ صریحِ
  // ignoreEnablement است (کارگرِ دستیِ پنل و آزمون) و نه این‌که مثلاً
  // fetchِ تزریق‌شده خودش کلیدِ روشن‌کردن باشد: آن یک شگردِ آزمونی بود که
  // یک قاعدهٔ کسب‌وکار را بی‌صدا دور می‌زد.
  if (!cfg.enabled && !deps.ignoreEnablement) {
    result.notes.push('«ارسالِ پیامک» در پنل خاموش است؛ صف دست‌نخورده ماند.');
    return result;
  }

  const http = guardedFetchWithTimeout(cfg, deps.fetchImpl);

  const released = await releaseStaleSending(db);
  if (released > 0) result.notes.push(`${released} پیامِ گیرمانده از دورِ پیشین آزاد شد.`);

  const rows = await claimDueMessages(db, {
    limit: deps.limit ?? 20,
    maxAttempts: cfg.maxAttempts,
  });
  result.claimed = rows.length;
  if (rows.length === 0) return result;

  const keys = [...new Set(rows.map((r) => r.template_key).filter((k): k is string => !!k))];
  const templates = await templateInfoFor(db, keys);
  const raws = await rawTemplates(db, keys);

  for (const row of rows) {
    const info = row.template_key ? templates.get(row.template_key) : undefined;
    const prepared = varsForTemplate(row.body, info, row.template_key ? raws.get(row.template_key) : undefined, {
      allowFreeText: canSendFreeText(cfg),
    });

    if (!prepared.ok) {
      // عمداً «ناموفقِ موقت» و نه «ناامیدکننده» (مگر این‌که تلاش‌ها تمام شود):
      // علت‌هایِ این شاخه همه تنظیمی‌اند — قالبِ بی‌برچسب، متنِ دست‌خورده. به‌محضِ
      // این‌که مدیر در پنل شناسهٔ قالب را پر کند، پیامکِ همان سفارش در دورِ بعد
      // خودش می‌رود؛ اگر زود dead می‌شد، باید دستی دوباره در صف می‌نشست.
      await markFailed(db, row, cfg, prepared.reason);
      if (row.attempts >= cfg.maxAttempts) result.dead += 1;
      else result.failed += 1;
      result.notes.push(prepared.reason);
      continue;
    }

    if (cfg.dryRun) {
      await markFailed(db, row, cfg, 'حالتِ آزمایشی (SMS_DRY_RUN): به سامانه فرستاده نشد.');
      result.skipped += 1;
      continue;
    }

    try {
      const { ref } = await dispatchOnce(
        cfg,
        { to: row.phone, body: row.body, vars: prepared.vars },
        http,
        info?.providerTemplateId ?? undefined,
      );
      await db.query(
        `UPDATE sms_outbox
            SET status = 'sent', sent_at = now(), provider_ref = $1, last_error = NULL
          WHERE id = $2`,
        [ref, row.id],
      );
      result.sent += 1;
    } catch (error) {
      const message = (error as Error).message ?? 'خطایِ ناشناخته';
      const permanent = error instanceof SmsProviderError && !error.retryable;
      await markFailed(db, row, cfg, message, permanent);
      if (permanent || row.attempts >= cfg.maxAttempts) {
        result.dead += 1;
        result.notes.push(`${row.phone.slice(0, 4)}••• → ${message}`);
      } else {
        result.failed += 1;
      }
    }
  }

  return result;
}

async function markFailed(
  db: Queryable,
  row: DueRow,
  cfg: SmsSendConfig,
  message: string,
  permanent = false,
): Promise<void> {
  const exhausted = permanent || row.attempts >= cfg.maxAttempts;
  // فاصله‌یِ فزاینده: ۱×، ۲×، ۴×، … و سقفِ یک روز — همان الگویِ outbox_events
  const delay = Math.min(cfg.backoffMinutes * 2 ** Math.max(0, row.attempts - 1), 1_440);
  await db.query(
    `UPDATE sms_outbox
        SET status = $2, last_error = $3,
            available_at = now() + ($4 || ' minutes')::interval
      WHERE id = $1`,
    [row.id, exhausted ? 'dead' : 'failed', message.slice(0, 500), String(delay)],
  );
}

/** شمارشِ وضعیت‌ها — همان چیزی که پنل و `/admin/observability` نشان می‌دهد */
export async function smsQueueCounts(db: Queryable): Promise<Record<string, number>> {
  const { rows } = await db.query<{ status: string; n: string }>(
    `SELECT status, COUNT(*)::text AS n FROM sms_outbox GROUP BY status`,
  );
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}
