/**
 * گاوصندوقِ گواهیِ مؤدیان.
 *
 * چرا این ماژول وجود دارد؟
 *   چون بدونِ آن، راه‌اندازیِ ارسالِ واقعی یعنی «کلیدِ خصوصی را روی سرور
 *   بگذار و یک متغیرِ محیطی را به مسیرش اشاره بده» — کاری که فقط یک
 *   برنامه‌نویس می‌تواند بکند، و هر بار تعویضِ گواهی (سالانه) یک توقفِ
 *   خدمات است. فروشنده‌ای که قرار است «همه چیز را خودش در پنل مدیریت کند»
 *   نباید برای نصبِ گواهی منتظرِ کسی بماند.
 *
 * پس گواهی از **پنل** بارگذاری می‌شود و در پایگاه‌داده **رمزنگاری‌شده**
 * می‌نشیند. اما رمزنگاری به‌تنهایی کافی نیست: اگر کلیدِ رمزگشایی کنارِ
 * داده باشد (هر دو در یک پایگاه)، هر کسی که به پایگاه برسد به کلیدِ
 * خصوصیِ فروشگاه هم می‌رسد — یعنی می‌تواند به نامِ او صورتحساب امضا کند.
 * برای همین کلیدِ اصلی از **محیط** می‌آید (`SET_MASTER_KEY`)، نه از پایگاه:
 *   • نبودش = گاوصندوق قفل است و پیامش روشن است؛
 *   • دزدیده شدنِ یک نسخه‌یِ پایگاه (پشتیبان) به‌تنهایی کافی نیست.
 *
 * و چرا «بررسیِ جفت‌بودن» این‌قدر برجسته است؟ چون شایع‌ترین خطایِ واقعی در
 * راه‌اندازیِ مؤدیان این است: کلیدِ خصوصی از یک درخواست و گواهی از درخواستی
 * دیگر بارگذاری می‌شود. سامانه‌یِ سازمان هم در پاسخ فقط می‌گوید «امضا
 * نامعتبر است»، بی‌آنکه بگوید چرا. اینجا همان لحظه‌یِ بارگذاری گفته
 * می‌شود: «این کلید با این گواهی جفت نیست».
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  createSign,
  createVerify,
  X509Certificate,
  randomBytes,
  scryptSync,
} from 'node:crypto';

export type CredentialKind = 'private_key' | 'certificate' | 'public_key';

export const CREDENTIAL_KINDS: readonly CredentialKind[] = ['private_key', 'certificate', 'public_key'];

/** یک رکوردِ رمزنگاری‌شده: همان چیزی که در جدول می‌نشیند */
export interface SealedSecret {
  cipherText: string;
  iv: string;
  salt: string;
  tag: string;
}

export interface CertificateFacts {
  subject: string;
  issuer: string;
  serialNumber: string;
  /**
   * اثرانگشتِ **کلیدِ عمومیِ** گواهی.
   *
   * چرا این و نه اثرانگشتِ خودِ گواهی؟ چون قرار است با اثرانگشتِ کلیدِ
   * خصوصی سنجیده شود (هر دو از یک جفتِ کلید می‌آیند). اثرانگشتِ خودِ
   * گواهی با هیچ چیز قابلِ مقایسه نیست و اگر اینجا می‌نشست، سامانه همیشه
   * می‌گفت «جفت نیست» — همان خطایی که در نخستین اجرا دیدیم.
   */
  fingerprint: string;
  /** اثرانگشتِ خودِ گواهی (SHA-256 کلِ گواهی) — آنچه مرجع نشان می‌دهد */
  certFingerprint: string;
  notBefore: Date;
  notAfter: Date;
}

export interface PrivateKeyFacts {
  /** اثرانگشتِ کلیدِ عمومیِ برآمده از کلیدِ خصوصی — برای سنجیدن با گواهی */
  fingerprint: string;
}

export class VaultError extends Error {
  readonly code:
    | 'MASTER_KEY_MISSING'
    | 'INVALID_PEM'
    | 'WRONG_KIND'
    | 'KEY_CERT_MISMATCH'
    | 'DECRYPT_FAILED';

  constructor(code: VaultError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'VaultError';
  }
}

/**
 * کلیدِ اصلی را از محیط می‌خواند.
 *
 * چرا خطا «پرتاب» می‌شود و مقدارِ پیش‌فرض ندارد؟ چون یک کلیدِ پیش‌فرضِ
 * سخت‌نوشته یعنی هر نصبِ ست‌شاپ در جهان با یک کلید رمز می‌کند — و آن‌وقت
 * رمزنگاری فقط «نمایش» است، نه حفاظت. نبودنِ کلید باید با صدای بلند شکست
 * بخورد، نه با یک جایگزینِ بی‌صدا.
 */
export function masterKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.SET_MASTER_KEY?.trim();
  if (!raw) {
    throw new VaultError(
      'MASTER_KEY_MISSING',
      'کلیدِ اصلیِ گاوصندوق (SET_MASTER_KEY) تعیین نشده است. ' +
        'بدونِ آن گواهیِ مؤدیان نه ذخیره می‌شود و نه خوانده می‌شود.',
    );
  }
  // کلیدِ اصلی یک رشته‌یِ base64 از ۳۲ بایت است؛ پذیرشِ رشته‌یِ دلخواه هم
  // ممکن بود (با scrypt)، اما آن‌وقت اشتباه‌هایِ تایپی بی‌صدا می‌گذشتند.
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new VaultError(
      'MASTER_KEY_MISSING',
      'SET_MASTER_KEY باید ۳۲ بایتِ رمزگشایی‌شده‌یِ base64 باشد ' +
        `(اکنون ${key.length} بایت است).`,
    );
  }
  return key;
}

/** کلیدِ ویژه‌یِ هر رکورد: از کلیدِ اصلی و نمکِ تصادفیِ همان رکورد */
function deriveKey(master: Buffer, salt: Buffer): Buffer {
  return scryptSync(master, salt, 32);
}

/** رمزنگاریِ یک راز با AES-256-GCM */
export function sealSecret(plain: string, master: Buffer): SealedSecret {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(master, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const cipherText = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    cipherText: cipherText.toString('base64'),
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/**
 * گشودنِ یک راز.
 *
 * چرا «DECRYPT_FAILED» خطایِ جدا دارد؟ چون شکستِ گشودن دو معنایِ کاملاً
 * متفاوت دارد: کلیدِ اصلی عوض شده (فاجعه‌یِ پیکربندی) یا داده دستکاری شده
 * (فاجعه‌یِ امنیتی). در هر دو، پاسخِ درست «بی‌صدا رد شدن» نیست؛ باید بالا
 * بیاید تا کسی بفهمد گاوصندوق باز نمی‌شود.
 */
export function openSecret(sealed: SealedSecret, master: Buffer): string {
  try {
    const key = deriveKey(master, Buffer.from(sealed.salt, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.cipherText, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new VaultError(
      'DECRYPT_FAILED',
      'گشودنِ گاوصندوق ناموفق بود: یا کلیدِ اصلی عوض شده یا داده دستکاری شده است.',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// شناختِ گواهی و کلید
// ─────────────────────────────────────────────────────────────────────────────

function fingerprintOf(der: Buffer): string {
  return createHash('sha256').update(der).digest('hex').toUpperCase().replace(/(.{2})(?=.)/g, '$1:');
}

/**
 * متنِ درونِ گواهی را به فارسیِ درست برمی‌گرداند.
 *
 * چرا لازم است؟ چون مراجعِ ایرانی (از جمله GICA) نامِ سازمان را **فارسی** در
 * گواهی می‌نویسند، و کتابخانه‌یِ استاندارد این رشته را بایت‌به‌بایت (لاتین-۱)
 * برمی‌گرداند: «ست‌شاپ» می‌شود «Ø³Øªâ€ŒØ´Ø§Ù¾». نتیجه این بود که مدیر در
 * پنل، گواهیِ خودش را به‌شکلِ نامفهوم می‌دید و نمی‌توانست تشخیص دهد این
 * گواهیِ فروشگاهِ خودش است یا نه — در حالی که خودِ گواهی کاملاً درست بود.
 *
 * روش: هر بایت را یک کاراکترِ لاتین-۱ می‌گیریم و رشته را به یوتی‌اف-۸
 * بازخوانی می‌کنیم. برایِ نام‌هایِ انگلیسی این تبدیل بی‌اثر است (اسکی در هر دو
 * یکسان است)؛ و اگر نتیجه «نویسه‌یِ نامفهوم» داشت، همان رشته‌یِ خام را برمی‌گردانیم
 * تا از بدتر شدن جلوگیری کرده باشیم.
 */
function decodeX509Text(raw: string): string {
  // مرجعِ ایرانی نام را چندسطره می‌نویسد (C=…، ST=…، O=…)؛ برایِ چشمِ مدیر،
  // جداکننده‌یِ « / » از «رفتن به سطر بعد» بهتر است.
  const oneLine = raw.replace(/\s*\n\s*/g, ' / ').trim();
  if (!/[^\u0000-\u007F]/.test(oneLine)) return oneLine;
  const decoded = Buffer.from(oneLine, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? oneLine : decoded;
}

/** آیا این متن، کلید/گواهیِ درست از نوعِ خواسته‌شده است؟ */
export function looksLike(kind: CredentialKind, pem: string): boolean {
  const text = pem.trim();
  if (kind === 'private_key') {
    return /-----BEGIN (RSA )?PRIVATE KEY-----/.test(text) || /-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(text);
  }
  if (kind === 'certificate') return text.includes('-----BEGIN CERTIFICATE-----');
  return text.includes('-----BEGIN PUBLIC KEY-----') || text.includes('-----BEGIN RSA PUBLIC KEY-----');
}

/**
 * اطلاعاتِ گواهی را می‌خواند.
 *
 * چرا «تبار» (issuer) هم نگه داشته می‌شود؟ چون سازمان گواهی را از مرجعِ
 * خودش (مثلاً GICA) صادر می‌کند؛ اگر کسی گواهیِ خود-امضا بارگذاری کند،
 * در پنل همان لحظه دیده می‌شود و بعدتر در سامانه با خطایِ مبهم روبه‌رو
 * نمی‌شویم.
 */
export function describeCertificate(pem: string): CertificateFacts {
  try {
    const cert = new X509Certificate(pem.trim());
    return {
      subject: decodeX509Text(cert.subject.replace(/^subject:/i, '').trim()),
      issuer: decodeX509Text(cert.issuer.replace(/^issuer:/i, '').trim()),
      serialNumber: cert.serialNumber,
      fingerprint: fingerprintOf(Buffer.from(cert.publicKey.export({ type: 'spki', format: 'der' }))),
      certFingerprint: fingerprintOf(cert.raw),
      notBefore: new Date(cert.validFrom),
      notAfter: new Date(cert.validTo),
    };
  } catch {
    throw new VaultError('INVALID_PEM', 'این متن یک گواهیِ معتبر (X.509 PEM) نیست.');
  }
}

/** اثرانگشتِ کلیدِ عمومیِ برآمده از کلیدِ خصوصی */
export function describePrivateKey(pem: string): PrivateKeyFacts {
  try {
    const publicKey = createPublicKey(pem.trim());
    const der = publicKey.export({ type: 'spki', format: 'der' });
    return { fingerprint: fingerprintOf(Buffer.from(der)) };
  } catch {
    throw new VaultError('INVALID_PEM', 'این متن یک کلیدِ خصوصیِ معتبر (PEM) نیست.');
  }
}

export function describePublicKey(pem: string): { fingerprint: string } {
  try {
    const publicKey = createPublicKey(pem.trim());
    const der = publicKey.export({ type: 'spki', format: 'der' });
    return { fingerprint: fingerprintOf(Buffer.from(der)) };
  } catch {
    throw new VaultError('INVALID_PEM', 'این متن یک کلیدِ عمومیِ معتبر (PEM) نیست.');
  }
}

/**
 * آیا کلیدِ خصوصی با گواهی جفت است؟
 *
 * روش: کلیدِ عمومی را از هر دو می‌گیریم و اثرانگشت‌شان را می‌سنجیم. چرا
 * مقایسه‌یِ اثرانگشت و نه «امضا کن و ببین درست است»؟ چون آزمونِ امضا یک
 * پیامِ نمونه می‌خواهد و خطایش با خطایِ «متنِ غلط» یکی می‌شود؛ اثرانگشت
 * اما تکلیف را روشن می‌کند: این دو متعلق به یک جفتِ کلید هستند یا نه.
 */
export function keyMatchesCertificate(privateKeyPem: string, certificatePem: string): boolean {
  const fromKey = describePrivateKey(privateKeyPem).fingerprint;
  const cert = new X509Certificate(certificatePem.trim());
  const fromCert = fingerprintOf(Buffer.from(cert.publicKey.export({ type: 'spki', format: 'der' })));
  return fromKey === fromCert;
}

/**
 * آزمونِ زنده‌یِ جفت: امضا کن و با گواهی راستی‌آزمایی کن.
 *
 * چرا علاوه بر اثرانگشت؟ چون اثرانگشت فقط «جفت بودن» را می‌گوید، اما گاه
 * کلیدِ خصوصی **رمزگذاری‌شده** است (با گذرواژه) و کتابخانه در زمانِ امضا
 * شکست می‌خورد — خطایی که در لحظه‌یِ ارسالِ واقعی رخ می‌دهد، یعنی در
 * شلوغیِ آخرِ ماه. اینجا همان خطا را همان لحظه‌یِ بارگذاری می‌گیریم.
 */
export function signAndVerifySample(privateKeyPem: string, certificatePem: string): boolean {
  const message = `ست‌شاپ — آزمونِ امضا ${new Date().toISOString()}`;
  try {
    const signer = createSign('RSA-SHA256');
    signer.update(message);
    const signature = signer.sign(privateKeyPem.trim(), 'base64');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(message);
    return verifier.verify(certificatePem.trim(), signature, 'base64');
  } catch {
    return false;
  }
}

/** چند روز تا انقضا مانده است؟ (منفی یعنی منقضی شده) */
export function daysUntil(date: Date, now: Date = new Date()): number {
  return Math.floor((date.getTime() - now.getTime()) / 86_400_000);
}

/**
 * وضعیتِ گواهی را به زبانِ آدمیزاد می‌گوید.
 *
 * چرا «هشدار از ۳۰ روز»؟ چون صدورِ گواهیِ تازه در ایران اداری است و چند
 * روز تا چند هفته زمان می‌برد؛ اگر هشدار در روزِ انقضا برسد، یعنی ارسالِ
 * صورتحساب‌ها میانِ دو گواهی می‌ایستد.
 */
export function expiryState(notAfter: Date, now: Date = new Date()): 'ok' | 'soon' | 'expired' {
  const days = daysUntil(notAfter, now);
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'ok';
}
