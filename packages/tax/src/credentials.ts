/**
 * نگه‌داری و خواندنِ گواهیِ مؤدیان از پایگاه‌داده.
 *
 * این پرونده «لایه‌یِ دسترسی» است: گاوصندوق (vault.ts) می‌داند چگونه راز را
 * ببندد و بشناسد؛ اینجا می‌دانیم راز کجا می‌نشیند و کِی باطل می‌شود.
 *
 * یک قانونِ مهم: **هیچ تابعی کلیدِ خصوصی را برنمی‌گرداند مگر اینکه واقعاً
 * برایِ امضا لازم باشد.** وضعیت (`credentialStatus`) فقط ویژگی‌هایِ روشن را
 * می‌خواند و گاوصندوق را باز نمی‌کند — چون وضعیت در هر بارگذاریِ صفحه‌یِ
 * مالیات خوانده می‌شود و گشودنِ بی‌دلیلِ کلیدِ امضا، سطحِ حمله را بی‌سبب
 * بزرگ می‌کند.
 */

import { createSign } from 'node:crypto';

import type { Queryable } from '@set/db';

import {
  VaultError,
  describeCertificate,
  describePrivateKey,
  describePublicKey,
  expiryState,
  daysUntil,
  keyMatchesCertificate,
  looksLike,
  masterKeyFromEnv,
  openSecret,
  sealSecret,
  signAndVerifySample,
  type CredentialKind,
  type SealedSecret,
} from './vault.js';

interface CredentialRow {
  id: string;
  kind: CredentialKind;
  label: string;
  cipher_text: string;
  salt: string;
  iv: string;
  tag: string;
  fingerprint: string | null;
  cert_fingerprint: string | null;
  subject: string | null;
  issuer: string | null;
  serial_number: string | null;
  not_before: string | null;
  not_after: string | null;
  source: string;
  created_at: string;
}

export interface CredentialFacts {
  kind: CredentialKind;
  label: string;
  source: 'panel' | 'env';
  /** اثرانگشتِ کلیدِ عمومی — برایِ سنجیدنِ جفت‌بودن */
  fingerprint: string | null;
  /** اثرانگشتِ خودِ گواهی — همان که مرجع نشان می‌دهد */
  certFingerprint: string | null;
  subject: string | null;
  issuer: string | null;
  serialNumber: string | null;
  notBefore: string | null;
  notAfter: string | null;
  /** چند روز تا انقضا؛ فقط برایِ گواهی */
  daysRemaining: number | null;
  expiry: 'ok' | 'soon' | 'expired' | null;
  createdAt: string;
}

export interface VaultStatus {
  /** آیا کلیدِ اصلی در محیط هست؟ نباشد، گاوصندوق کلاً بسته است */
  vaultReady: boolean;
  vaultMessage: string | null;
  privateKey: CredentialFacts | null;
  certificate: CredentialFacts | null;
  publicKey: CredentialFacts | null;
  /** آیا کلیدِ خصوصی با گواهی جفت است؟ (بدونِ گشودنِ گاوصندوق) */
  pairMatches: boolean | null;
  /** پیام‌هایی که مدیر باید پیش از فعال‌سازیِ ارسالِ واقعی ببیند */
  warnings: string[];
  /** آماده‌یِ ارسالِ واقعی؟ */
  readyForProduction: boolean;
}

function toFacts(row: CredentialRow, now: Date): CredentialFacts {
  const notAfter = row.not_after ? new Date(row.not_after) : null;
  return {
    kind: row.kind,
    label: row.label,
    source: row.source === 'env' ? 'env' : 'panel',
    fingerprint: row.fingerprint,
    certFingerprint: row.cert_fingerprint,
    subject: row.subject,
    issuer: row.issuer,
    serialNumber: row.serial_number,
    notBefore: row.not_before ? new Date(row.not_before).toISOString() : null,
    notAfter: notAfter ? notAfter.toISOString() : null,
    daysRemaining: notAfter ? daysUntil(notAfter, now) : null,
    expiry: notAfter ? expiryState(notAfter, now) : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function activeRow(db: Queryable, kind: CredentialKind): Promise<CredentialRow | null> {
  const { rows } = await db.query<CredentialRow>(
    `SELECT id, kind, label, cipher_text, salt, iv, tag, fingerprint, cert_fingerprint, subject, issuer,
            serial_number, not_before, not_after, source, created_at
       FROM moadian_credentials
      WHERE kind = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [kind],
  );
  return rows[0] ?? null;
}

/**
 * جای‌گذاریِ یک کلید/گواهی.
 *
 * ترتیبِ کار مهم است: نخست می‌سنجیم (**پیش از** باطل کردنِ قبلی)، بعد
 * می‌نویسیم. چرا؟ چون اگر گواهیِ تازه خراب باشد و قبلی را باطل کرده باشیم،
 * فروشگاه میانِ دو گواهی می‌ماند و ارسال می‌ایستد. با این ترتیب، خطا یعنی
 * «هیچ تغییری رخ نداد» — همان ویژگی‌ای که در تراکنش‌ها به آن «اتمی» می‌گوییم.
 */
export async function saveCredential(
  db: Queryable,
  input: {
    kind: CredentialKind;
    pem: string;
    label?: string;
    userId?: string | null;
  },
): Promise<CredentialFacts> {
  const pem = (input.pem ?? '').trim();
  if (!pem) throw new VaultError('INVALID_PEM', 'متنِ خالی قابلِ ذخیره نیست.');
  if (!looksLike(input.kind, pem)) {
    throw new VaultError(
      'WRONG_KIND',
      input.kind === 'private_key'
        ? 'این متن شبیهِ کلیدِ خصوصی نیست؛ باید با «-----BEGIN … PRIVATE KEY-----» آغاز شود.'
        : input.kind === 'certificate'
          ? 'این متن شبیهِ گواهی نیست؛ باید با «-----BEGIN CERTIFICATE-----» آغاز شود.'
          : 'این متن شبیهِ کلیدِ عمومی نیست؛ باید با «-----BEGIN PUBLIC KEY-----» آغاز شود.',
    );
  }

  // شناسایی پیش از نوشتن: اگر اینجا خطا بدهد، چیزی تغییر نکرده است
  let fingerprint: string | null = null;
  let certFingerprint: string | null = null;
  let subject: string | null = null;
  let issuer: string | null = null;
  let serialNumber: string | null = null;
  let notBefore: Date | null = null;
  let notAfter: Date | null = null;

  if (input.kind === 'certificate') {
    const facts = describeCertificate(pem);
    fingerprint = facts.fingerprint;
    certFingerprint = facts.certFingerprint;
    subject = facts.subject;
    issuer = facts.issuer;
    serialNumber = facts.serialNumber;
    notBefore = facts.notBefore;
    notAfter = facts.notAfter;
  } else if (input.kind === 'private_key') {
    // اثرانگشتِ **کلیدِ عمومیِ برآمده از کلیدِ خصوصی** ذخیره می‌شود، نه خودِ
    // کلید. به این ترتیب می‌توان جفت‌بودنِ کلید و گواهی را بعدتر، بی‌گشودنِ
    // گاوصندوق، فقط با مقایسه‌یِ دو اثرانگشت فهمید.
    const facts = describePrivateKey(pem);
    if (!signingWorks(pem)) {
      throw new VaultError(
        'INVALID_PEM',
        'این کلیدِ خصوصی امضا نمی‌کند. اگر گذرواژه دارد، نخست آن را از روی کلید بردارید ' +
          '(openssl rsa -in key.pem -out key-nopass.pem) — سامانه به کلیدِ بی‌گذرواژه نیاز دارد.',
      );
    }
    fingerprint = facts.fingerprint;
  } else {
    fingerprint = describePublicKey(pem).fingerprint;
  }

  const master = masterKeyFromEnv();
  const sealed = sealSecret(pem, master);

  await db.query(`UPDATE moadian_credentials SET revoked_at = now() WHERE kind = $1 AND revoked_at IS NULL`, [
    input.kind,
  ]);

  const { rows } = await db.query<CredentialRow>(
    `INSERT INTO moadian_credentials
       (kind, label, cipher_text, salt, iv, tag, fingerprint, cert_fingerprint,
        subject, issuer, serial_number, not_before, not_after, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'panel',$14)
     RETURNING id, kind, label, cipher_text, salt, iv, tag, fingerprint, cert_fingerprint,
               subject, issuer, serial_number, not_before, not_after, source, created_at`,
    [
      input.kind,
      input.label ?? '',
      sealed.cipherText,
      sealed.salt,
      sealed.iv,
      sealed.tag,
      fingerprint,
      certFingerprint,
      subject,
      issuer,
      serialNumber,
      notBefore ? notBefore.toISOString() : null,
      notAfter ? notAfter.toISOString() : null,
      input.userId ?? null,
    ],
  );

  return toFacts(rows[0]!, new Date());
}

/** آیا این کلیدِ خصوصی واقعاً می‌تواند امضا کند؟ (گذرواژه‌دار نباشد) */
function signingWorks(privateKeyPem: string): boolean {
  try {
    const signer = createSign('RSA-SHA256');
    signer.update('ست‌شاپ');
    signer.sign(privateKeyPem);
    return true;
  } catch {
    return false;
  }
}

/** خواندنِ متنِ یک کلید/گواهی — فقط جایی که واقعاً لازم است (امضا/رمزنگاری) */
export async function loadCredentialPem(db: Queryable, kind: CredentialKind): Promise<string | null> {
  const row = await activeRow(db, kind);
  if (!row) return null;
  const master = masterKeyFromEnv();
  const sealed: SealedSecret = {
    cipherText: row.cipher_text,
    salt: row.salt,
    iv: row.iv,
    tag: row.tag,
  };
  return openSecret(sealed, master);
}

export async function revokeCredential(db: Queryable, kind: CredentialKind): Promise<boolean> {
  const res = await db.query(
    `UPDATE moadian_credentials SET revoked_at = now() WHERE kind = $1 AND revoked_at IS NULL`,
    [kind],
  );
  return (res.affectedRows ?? 0) > 0;
}

/**
 * وضعیتِ گاوصندوق برای پنل.
 *
 * این تابع هر بار که مدیر صفحه‌یِ مالیات را باز می‌کند اجرا می‌شود؛ برای
 * همین نه گاوصندوق را باز می‌کند و نه کاری با شبکه دارد.
 */
export async function credentialStatus(db: Queryable, now: Date = new Date()): Promise<VaultStatus> {
  let vaultReady = true;
  let vaultMessage: string | null = null;
  try {
    masterKeyFromEnv();
  } catch (err) {
    vaultReady = false;
    vaultMessage = err instanceof VaultError ? err.message : String(err);
  }

  const [privateRow, certRow, publicRow] = await Promise.all([
    activeRow(db, 'private_key'),
    activeRow(db, 'certificate'),
    activeRow(db, 'public_key'),
  ]);

  const privateKey = privateRow ? toFacts(privateRow, now) : null;
  const certificate = certRow ? toFacts(certRow, now) : null;
  const publicKey = publicRow ? toFacts(publicRow, now) : null;

  const pairMatches =
    privateKey?.fingerprint && certificate?.fingerprint
      ? privateKey.fingerprint === certificate.fingerprint
      : null;

  const warnings: string[] = [];
  if (!vaultReady) warnings.push(vaultMessage ?? 'گاوصندوق بسته است.');
  if (!privateKey) warnings.push('کلیدِ خصوصی بارگذاری نشده است.');
  if (!certificate) warnings.push('گواهی بارگذاری نشده است.');
  if (!publicKey) {
    warnings.push(
      'کلیدِ عمومیِ سازمان بارگذاری نشده است؛ بسته‌ها به‌جایِ رمزنگاری (JWE) فقط امضا می‌شوند.',
    );
  }
  if (pairMatches === false) {
    warnings.push(
      'کلیدِ خصوصی با گواهی جفت نیست (اثرانگشت‌ها یکی نیستند). ' +
        'این شایع‌ترین دلیلِ «امضایِ نامعتبر» در سامانه‌یِ مؤدیان است.',
    );
  }
  if (certificate?.expiry === 'expired') warnings.push('گواهی منقضی شده است.');
  if (certificate?.expiry === 'soon') {
    warnings.push(
      `گواهی ${certificate.daysRemaining} روزِ دیگر تمام می‌شود؛ ` +
        'صدورِ گواهیِ تازه زمان می‌برد، همین امروز آغاز کنید.',
    );
  }

  const readyForProduction =
    vaultReady &&
    Boolean(privateKey && certificate) &&
    pairMatches !== false &&
    certificate?.expiry === 'ok';

  return {
    vaultReady,
    vaultMessage,
    privateKey,
    certificate,
    publicKey,
    pairMatches,
    warnings,
    readyForProduction,
  };
}

/**
 * آزمونِ زنده: امضا می‌کند و با گواهی راستی‌آزمایی می‌کند.
 *
 * چرا جدا از وضعیت؟ چون این یکی گاوصندوق را باز می‌کند و کلید را به کار
 * می‌گیرد؛ نباید در هر بارگذاریِ صفحه رخ دهد، فقط وقتی مدیر دکمه‌یِ
 * «آزمایش» را می‌زند.
 */
export async function testSigning(db: Queryable): Promise<{
  ok: boolean;
  message: string;
  usedFallbackToEnv: boolean;
}> {
  const [privatePem, certPem] = await Promise.all([
    loadCredentialPem(db, 'private_key'),
    loadCredentialPem(db, 'certificate'),
  ]);
  if (!privatePem || !certPem) {
    return { ok: false, message: 'کلیدِ خصوصی یا گواهی بارگذاری نشده است.', usedFallbackToEnv: false };
  }
  const matches = keyMatchesCertificate(privatePem, certPem);
  if (!matches) {
    return {
      ok: false,
      message: 'کلیدِ خصوصی با این گواهی جفت نیست؛ امضا رد می‌شود.',
      usedFallbackToEnv: false,
    };
  }
  const signed = signAndVerifySample(privatePem, certPem);
  return signed
    ? { ok: true, message: 'امضا ساخته و با گواهی راستی‌آزمایی شد. این جفت آماده‌یِ ارسال است.', usedFallbackToEnv: false }
    : {
        ok: false,
        message: 'امضا ساخته شد اما با گواهی راستی‌آزمایی نشد.',
        usedFallbackToEnv: false,
      };
}
