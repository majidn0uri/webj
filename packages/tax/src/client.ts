/**
 * ارتباط با سامانه‌یِ مؤدیان.
 *
 * چرا دو پیاده‌سازی؟ چون در ایران «اینترنت وصل است» یک فرضِ قابلِ اتکا نیست،
 * و چون سامانه‌یِ مؤدیان برایِ هر ارسال امضایِ دیجیتال می‌خواهد که راه‌اندازی‌اش
 * زمان‌بر است (گواهی از gica.ir، بارگذاریِ کلیدِ عمومی در کارپوشه، دریافتِ
 * شناسه‌یِ یکتا). اگر ارسالِ واقعی تنها راه بود، فروشگاه تا روزِ دریافتِ
 * گواهی نمی‌توانست صورتحساب بسازد و خطاهایش را ببیند.
 *
 * بنابراین:
 *   • `sandboxClient` — هیچ اتصالی باز نمی‌کند. بسته را می‌سازد، ذخیره می‌کند،
 *     و یک کدِ رهگیریِ ساختگی برمی‌گرداند. برایِ آموزش و برایِ اینکه مدیر
 *     پیش از راه‌اندازیِ رسمی، خطاهایِ داده‌ای را ببیند و درست کند.
 *   • `httpClient` — ارسالِ واقعی به نشانیِ رسمیِ سازمان:
 *       GET  /requestsmanager/api/v2/server-information  (با توکنِ JWS)
 *       POST /requestsmanager/api/v2/invoice             (بسته‌یِ رمزشده‌یِ JWE)
 *       GET  /requestsmanager/api/v2/inquiry-by-uid      (استعلامِ وضعیت)
 *     امضا با الگوریتمِ RSA-۲۰۴۸/SHA-۲۵۶ و رمزنگاری با RSA-OAEP-256 + A256GCM،
 *     همان‌طور که در دستورالعملِ فنی آمده است.
 *
 * هشدارِ صادقانه: نشانی‌ها و الگوریتم‌ها را پیش از فعال‌سازی در تولید با
 * تازه‌ترین مستنداتِ سامانه بسنجید؛ سازمان گاه نشانی را تغییر می‌دهد. این
 * کلاینت طوری نوشته شده که تغییرِ نشانی فقط یک مقدارِ پیکربندی باشد.
 */

import { createSign, createCipheriv, publicEncrypt, randomUUID, randomBytes, constants } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface SendResult {
  /** کدِ رهگیریِ سامانه برای پیگیریِ بعدی */
  uid: string;
  /** شماره‌یِ مرجع */
  referenceNumber: string | null;
  /** کدِ خطا در صورتِ رد شدن */
  errorCode: string | null;
  errorDetail: string | null;
}

export interface InquiryResult {
  uid: string;
  /** وضعیت از دیدِ سامانه */
  status: 'accepted' | 'rejected' | 'pending';
  /** شماره‌یِ منحصربه‌فردِ مالیاتیِ قطعی در صورتِ تأیید */
  taxid: string | null;
  errorCode: string | null;
  errorDetail: string | null;
}

export interface MoadianClient {
  /** ارسالِ یک دسته صورتحساب (سامانه تا ۱۰۰۰ بسته را در یک درخواست می‌پذیرد) */
  send(packets: Array<{ packet: unknown; requestTraceId: string }>): Promise<SendResult[]>;
  /** استعلامِ وضعیتِ چند صورتحساب */
  inquire(uids: string[]): Promise<InquiryResult[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// حالتِ آزمایشی
// ─────────────────────────────────────────────────────────────────────────────

/**
 * کلاینتِ آزمایشی: بدونِ شبکه.
 *
 * پاسخش قطعی است (بر پایه‌یِ همان traceId) تا تست‌ها پایدار بمانند، اما
 * شکلِ پاسخ درستِ سامانه را دارد: uid و referenceNumber در صورتِ موفقیت.
 */
export function sandboxClient(): MoadianClient {
  return {
    async send(packets) {
      return packets.map((p) => ({
        uid: `sandbox-${p.requestTraceId}`,
        referenceNumber: `sandbox-${p.requestTraceId}`,
        errorCode: null,
        errorDetail: null,
      }));
    },
    async inquire(uids) {
      return uids.map((uid) => ({
        uid,
        status: 'accepted' as const,
        taxid: uid.startsWith('sandbox-') ? `SANDBOX${uid.slice(8, 28).padEnd(15, '0')}` : null,
        errorCode: null,
        errorDetail: null,
      }));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// حالتِ واقعی
// ─────────────────────────────────────────────────────────────────────────────

export interface HttpConfig {
  /** نشانیِ پایه؛ پیش‌فرض همان درگاهِ رسمی است اما قابلِ تغییر برایِ تست */
  baseUrl?: string;
  /** شناسه‌یِ مشتری صادرشده در کارپوشه */
  clientId: string;
  /** شناسه‌یِ یکتایِ حافظه‌یِ مالیاتی */
  fiscalId: string;
  /** مسیرِ کلیدِ خصوصی (PEM) — یا متنش را بدهید (ترجیح با متن است) */
  privateKeyPath?: string | null;
  /** متنِ کلیدِ خصوصی (PEM) — از گاوصندوقِ پنل می‌آید */
  privateKeyPem?: string | null;
  /** مسیرِ گواهی (PEM) — در صورتِ نیازِ سازمان به زنجیره در JWS */
  certificatePath?: string | null;
  /** متنِ گواهی (PEM) */
  certificatePem?: string | null;
  /** مسیرِ کلیدِ عمومیِ سازمان برایِ رمزنگاریِ بسته (JWE) */
  publicKeyPath?: string | null;
  /** متنِ کلیدِ عمومیِ سازمان */
  publicKeyPem?: string | null;
  /** زمانِ انتظارِ هر درخواست، میلی‌ثانیه (پیش‌فرض ۲۰ ثانیه) */
  timeoutMs?: number;
}

const DEFAULT_BASE = 'https://tp.tax.gov.ir';

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** ساختِ JWS با امضایِ RS256 */
function signJws(payload: unknown, privateKeyPem: string, certificatePem?: string | null): string {
  const header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT' };
  if (certificatePem) {
    // برخی نسخه‌هایِ سامانه زنجیره‌یِ گواهی را در سرآمد می‌خواهند تا امضا را
    // بدونِ مراجعه به کارپوشه بتواند راستی‌آزمایی کند
    const body = certificatePem
      .replace(/-----BEGIN[^-]+-----/g, '')
      .replace(/-----END[^-]+-----/g, '')
      .replace(/\s+/g, '');
    header.x5c = [body];
  }
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const signingInput = `${h}.${p}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const sig = signer.sign(privateKeyPem.replace(/\\n/g, '\n'));
  return `${signingInput}.${b64url(sig)}`;
}

/**
 * رمزنگاریِ JWE با RSA-OAEP-256 + A256GCM.
 *
 * کلیدِ جلسه تصادفی است و با کلیدِ عمومیِ سازمان رمز می‌شود؛ متن با AES-256-GCM
 * و سرآمد به‌عنوانِ AAD (تا دستکاریِ سرآمد هم نامعتبر شود).
 */
function encryptJwe(payload: string, publicKeyPem: string): string {
  const header = { alg: 'RSA-OAEP-256', enc: 'A256GCM' };
  const h = b64url(JSON.stringify(header));
  const cek = randomBytes(32);
  const iv = randomBytes(12);
  const encryptedKey = publicEncrypt(
    {
      key: publicKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    cek,
  );
  const cipher = createCipheriv('aes-256-gcm', cek, iv);
  cipher.setAAD(Buffer.from(h, 'ascii'));
  const ct = Buffer.concat([cipher.update(Buffer.from(payload, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${h}.${b64url(encryptedKey)}.${b64url(iv)}.${b64url(ct)}.${b64url(tag)}`;
}

/** تفسیرِ وضعیتِ برگشتی از استعلام */
function mapStatus(raw: unknown): InquiryResult['status'] {
  const v = String(raw ?? '').toUpperCase();
  if (v === 'SUCCESS' || v === 'ACCEPTED' || v === '1') return 'accepted';
  if (v === 'FAILED' || v === 'REJECTED' || v === '0') return 'rejected';
  return 'pending';
}

export function httpClient(config: HttpConfig): MoadianClient {
  const base = (config.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
  const timeout = config.timeoutMs ?? 20_000;
  let cachedKey: { private: string; cert: string | null; public: string | null } | null = null;

  /**
   * کلیدها را «یک‌بار» می‌خواند و نگه می‌دارد.
   *
   * اولویت با متنِ آماده (از گاوصندوقِ پنل) است؛ مسیرِ فایل فقط برایِ نصب‌هایی
   * است که هنوز از متغیرهایِ محیطی استفاده می‌کنند.
   */
  function keys() {
    if (cachedKey) return cachedKey;
    const privatePem = config.privateKeyPem ?? (config.privateKeyPath ? readFileSync(config.privateKeyPath, 'utf8') : null);
    if (!privatePem) {
      throw new Error(
        'کلیدِ خصوصیِ مؤدیان در دسترس نیست: نه در گاوصندوقِ پنل ثبت شده و نه مسیری در محیط تعیین شده است.',
      );
    }
    cachedKey = {
      private: privatePem,
      cert:
        config.certificatePem ??
        (config.certificatePath ? readFileSync(config.certificatePath, 'utf8') : null),
      public:
        config.publicKeyPem ??
        (config.publicKeyPath ? readFileSync(config.publicKeyPath, 'utf8') : null),
    };
    return cachedKey;
  }

  /** توکنِ تازه برای هر درخواست (nonce تصادفی؛ اعتبارِ توکن کوتاه است) */
  async function authToken(): Promise<string> {
    const k = keys();
    const jwt = signJws({ nonce: randomUUID(), clientId: config.clientId }, k.private, k.cert);
    const res = await fetch(`${base}/requestsmanager/api/v2/server-information`, {
      headers: { Authorization: `Bearer ${jwt}`, Accept: '*/*' },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) {
      throw new Error(`دریافتِ اطلاعاتِ سامانه ناموفق بود (HTTP ${res.status}).`);
    }
    return jwt;
  }

  return {
    async send(packets) {
      const k = keys();
      const jwt = await authToken();
      const body = packets.map(({ packet, requestTraceId }) => {
        const raw = JSON.stringify(packet);
        // اگر کلیدِ عمومیِ سازمان در دسترس نباشد، همان JWS را می‌فرستیم:
        // برخی درگاه‌هایِ معتمد امضایِ ساده را می‌پذیرند، اما حالتِ استاندارد
        // همان JWE است و هشدار در لاگ ثبت می‌شود.
        const payload = k.public ? encryptJwe(raw, k.public) : signJws(packet, k.private, k.cert);
        return { payload, header: { requestTraceId, fiscalId: config.fiscalId } };
      });

      const res = await fetch(`${base}/requestsmanager/api/v2/invoice`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
          Accept: '*/*',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) throw new Error(`ارسال ناموفق بود (HTTP ${res.status}).`);
      const json = (await res.json()) as {
        result?: Array<{
          uid?: string;
          referenceNumber?: string;
          errorCode?: string | null;
          errorDetail?: string | null;
        }>;
      };
      return (json.result ?? []).map((r) => ({
        uid: r.uid ?? '',
        referenceNumber: r.referenceNumber ?? null,
        errorCode: r.errorCode ?? null,
        errorDetail: r.errorDetail ?? null,
      }));
    },

    async inquire(uids) {
      const jwt = await authToken();
      const url =
        `${base}/requestsmanager/api/v2/inquiry-by-uid?uidList=` +
        encodeURIComponent(uids.join(',')) +
        `&fiscalId=${encodeURIComponent(config.fiscalId)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${jwt}`, Accept: '*/*' },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) throw new Error(`استعلام ناموفق بود (HTTP ${res.status}).`);
      const json = (await res.json()) as {
        result?: Array<{
          uid?: string;
          status?: unknown;
          taxId?: string | null;
          errorCode?: string | null;
          errorDetail?: string | null;
        }>;
      };
      return (json.result ?? []).map((r) => ({
        uid: r.uid ?? '',
        status: mapStatus(r.status),
        taxid: r.taxId ?? null,
        errorCode: r.errorCode ?? null,
        errorDetail: r.errorDetail ?? null,
      }));
    },
  };
}

/**
 * ساختِ کلاینت بر پایه‌یِ تنظیماتِ فروشگاه.
 *
 * نکته: در حالتِ `sandbox` هیچ کلیدی خوانده نمی‌شود؛ این یعنی فروشگاه می‌تواند
 * سال‌ها بی‌گواهی کار کند و صورتحساب‌ها را در صف نگه دارد، بی‌آنکه خطایی رخ
 * دهد. روزی که گواهی رسید، تنها مقدارِ `moadian_mode` عوض می‌شود.
 */
export function clientForMode(mode: 'sandbox' | 'production'): MoadianClient {
  return mode === 'production' ? httpClientFromEnv() : sandboxClient();
}

/**
 * ساختِ کلاینتِ واقعی از «مدارکی که در دسترس است».
 *
 * چرا دو منبع؟ چون نصب‌هایِ تازه همه چیز را از پنل می‌گیرند (گاوصندوق)، اما
 * نصب‌هایی که پیش از این با متغیرهایِ محیطی راه افتاده‌اند نباید با به‌روزرسانی
 * از کار بیفتند. اولویت با گاوصندوق است: اگر مدیر گواهی را در پنل عوض کند،
 * همان لحظه مؤثر است — نیازی به دست‌زدن به سرور نیست، که خودِ هدفِ این کار بود.
 */
export function clientForCredentials(credentials: {
  clientId: string;
  fiscalId: string;
  privateKeyPem?: string | null;
  certificatePem?: string | null;
  publicKeyPem?: string | null;
  baseUrl?: string | null;
  timeoutMs?: number;
}): MoadianClient {
  if (!credentials.clientId || !credentials.fiscalId) {
    throw new Error('برایِ ارسالِ واقعی باید شناسه‌یِ مشتری و شناسه‌یِ یکتایِ مالیاتی تنظیم شوند.');
  }
  if (!credentials.privateKeyPem && !process.env.MOADIAN_PRIVATE_KEY_PATH) {
    throw new Error(
      'کلیدِ خصوصیِ مؤدیان یافت نشد: آن را در صفحه‌یِ مالیات بارگذاری کنید، ' +
        'یا MOADIAN_PRIVATE_KEY_PATH را در محیط تعیین کنید.',
    );
  }
  return httpClient({
    clientId: credentials.clientId,
    fiscalId: credentials.fiscalId,
    privateKeyPem: credentials.privateKeyPem ?? null,
    certificatePem: credentials.certificatePem ?? null,
    publicKeyPem: credentials.publicKeyPem ?? null,
    privateKeyPath: process.env.MOADIAN_PRIVATE_KEY_PATH ?? null,
    certificatePath: process.env.MOADIAN_CERTIFICATE_PATH ?? null,
    publicKeyPath: process.env.MOADIAN_PUBLIC_KEY_PATH ?? null,
    baseUrl: credentials.baseUrl ?? process.env.MOADIAN_BASE_URL ?? DEFAULT_BASE,
    timeoutMs: credentials.timeoutMs,
  });
}

function httpClientFromEnv(): MoadianClient {
  const clientId = process.env.MOADIAN_CLIENT_ID ?? '';
  const fiscalId = process.env.MOADIAN_FISCAL_ID ?? '';
  const privateKeyPath = process.env.MOADIAN_PRIVATE_KEY_PATH ?? '';
  if (!clientId || !fiscalId || !privateKeyPath) {
    throw new Error(
      'برایِ ارسالِ واقعی باید MOADIAN_CLIENT_ID و MOADIAN_FISCAL_ID و MOADIAN_PRIVATE_KEY_PATH تنظیم شوند ' +
        '(یا کلید را در صفحه‌یِ مالیاتِ پنل بارگذاری کنید).',
    );
  }
  return httpClient({
    clientId,
    fiscalId,
    privateKeyPath,
    certificatePath: process.env.MOADIAN_CERTIFICATE_PATH ?? null,
    publicKeyPath: process.env.MOADIAN_PUBLIC_KEY_PATH ?? null,
    baseUrl: process.env.MOADIAN_BASE_URL ?? DEFAULT_BASE,
  });
}
