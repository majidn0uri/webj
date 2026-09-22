/**
 * آزمونِ گاوصندوقِ گواهیِ مؤدیان.
 *
 * این آزمون‌ها درباره‌یِ «رمزنگاری درست است» نیست — کتابخانه‌یِ استاندارد آن
 * را تضمین می‌کند. درباره‌یِ این است که **فروشنده در لحظه‌یِ بارگذاریِ
 * گواهی، خطایِ درست را با پیامِ درست می‌بیند**: کلید با گواهی جفت نیست،
 * گواهی منقضی شده، کلید گذرواژه دارد، گاوصندوق قفل است. هرکدام از این‌ها در
 * دنیایِ واقعی یک روزِ کامل از عمرِ یک فروشگاه می‌گیرد، چون سامانه‌یِ سازمان
 * در پاسخ فقط می‌گوید «امضا نامعتبر است».
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, createDatabase, type Database } from '@set/db';

import {
  GOOD_CERTIFICATE,
  GOOD_PRIVATE_KEY,
  GOOD_PUBLIC_KEY,
  OTHER_CERTIFICATE,
  OTHER_PRIVATE_KEY,
} from './cert-fixtures.js';
import {
  credentialStatus,
  loadCredentialPem,
  revokeCredential,
  saveCredential,
  testSigning,
} from './credentials.js';
import {
  VaultError,
  daysUntil,
  describeCertificate,
  expiryState,
  keyMatchesCertificate,
  looksLike,
  masterKeyFromEnv,
  openSecret,
  sealSecret,
} from './vault.js';

/**
 * کلیدِ اصلی در این آزمون از محیط می‌آید (نه یک مقدارِ سخت‌نوشته): همان کاری
 * که نصبِ واقعی می‌کند. اگر کسی آزمون را بی‌آن اجرا کند، نخستین بررسی همان
 * را می‌سنجد — که خودش یکی از آزمون‌هاست.
 */
const MASTER = Buffer.alloc(32, 7);
const MASTER_B64 = MASTER.toString('base64');

let db: Database;
let hadMasterKey = false;

beforeAll(async () => {
  hadMasterKey = Boolean(process.env.SET_MASTER_KEY);
  process.env.SET_MASTER_KEY = MASTER_B64;
  db = createDatabase('memory://');
  await applyMigrations(db);
});

afterAll(async () => {
  if (hadMasterKey) process.env.SET_MASTER_KEY = MASTER_B64;
  else delete process.env.SET_MASTER_KEY;
  await db?.close();
});

describe('گاوصندوق — بستن و گشودن', () => {
  it('راز را می‌بندد و همان را باز می‌گرداند', () => {
    const sealed = sealSecret('کلیدِ خصوصیِ فروشگاه', MASTER);
    expect(sealed.cipherText).not.toContain('کلیدِ خصوصی');
    expect(openSecret(sealed, MASTER)).toBe('کلیدِ خصوصیِ فروشگاه');
  });

  it('هر بارگذاری نمک و بردارِ تازه می‌سازد (دو رکوردِ یکسان، دو متنِ متفاوت)', () => {
    const a = sealSecret('همان متن', MASTER);
    const b = sealSecret('همان متن', MASTER);
    expect(a.cipherText).not.toBe(b.cipherText);
    expect(a.salt).not.toBe(b.salt);
  });

  it('با کلیدِ اشتباه باز نمی‌شود — و این را با پیامِ خودش می‌گوید', () => {
    const sealed = sealSecret('راز', MASTER);
    const wrong = Buffer.alloc(32, 9);
    expect(() => openSecret(sealed, wrong)).toThrow(VaultError);
    try {
      openSecret(sealed, wrong);
    } catch (err) {
      expect((err as VaultError).code).toBe('DECRYPT_FAILED');
    }
  });

  it('دستکاریِ متنِ رمزشده را می‌گیرد (برچسبِ اصالت)', () => {
    const sealed = sealSecret('راز', MASTER);
    const tampered = { ...sealed, cipherText: sealed.cipherText.slice(0, -4) + 'AAAA' };
    expect(() => openSecret(tampered, MASTER)).toThrow(VaultError);
  });

  it('بی‌کلیدِ اصلی، گاوصندوق بسته است و پیامش راهنماست', () => {
    const saved = process.env.SET_MASTER_KEY;
    delete process.env.SET_MASTER_KEY;
    try {
      expect(() => masterKeyFromEnv()).toThrow(/SET_MASTER_KEY/);
    } finally {
      process.env.SET_MASTER_KEY = saved;
    }
  });

  it('کلیدِ اصلیِ کوتاه را نمی‌پذیرد (تا رمزنگاریِ نمایشی نسازیم)', () => {
    const saved = process.env.SET_MASTER_KEY;
    process.env.SET_MASTER_KEY = Buffer.from('کوتاه').toString('base64');
    try {
      expect(() => masterKeyFromEnv()).toThrow(VaultError);
    } finally {
      process.env.SET_MASTER_KEY = saved;
    }
  });
});

describe('شناختِ مدارک', () => {
  it('کلیدِ خصوصی، گواهی و کلیدِ عمومی را از هم باز می‌شناسد', () => {
    expect(looksLike('private_key', GOOD_PRIVATE_KEY)).toBe(true);
    expect(looksLike('certificate', GOOD_CERTIFICATE)).toBe(true);
    expect(looksLike('public_key', GOOD_PUBLIC_KEY)).toBe(true);
    // جابه‌جاییِ نوع: رایج‌ترین اشتباهِ هنگامِ بارگذاری
    expect(looksLike('private_key', GOOD_CERTIFICATE)).toBe(false);
    expect(looksLike('certificate', GOOD_PRIVATE_KEY)).toBe(false);
  });

  it('ویژگی‌هایِ گواهی را می‌خواند', () => {
    const facts = describeCertificate(GOOD_CERTIFICATE);
    expect(facts.subject).toContain('ست‌شاپ');
    expect(facts.serialNumber).toBeTruthy();
    expect(facts.fingerprint).toMatch(/^([0-9A-F]{2}:)+[0-9A-F]{2}$/);
    expect(facts.notAfter.getTime()).toBeGreaterThan(facts.notBefore.getTime());
  });

  it('جفت‌بودنِ کلید و گواهی را درست تشخیص می‌دهد', () => {
    expect(keyMatchesCertificate(GOOD_PRIVATE_KEY, GOOD_CERTIFICATE)).toBe(true);
    expect(keyMatchesCertificate(OTHER_PRIVATE_KEY, GOOD_CERTIFICATE)).toBe(false);
  });

  it('روزهایِ باقی‌مانده و وضعیتِ انقضا را درست می‌شمارد', () => {
    const now = new Date('2026-09-18T00:00:00Z');
    expect(daysUntil(new Date('2026-09-28T00:00:00Z'), now)).toBe(10);
    expect(daysUntil(new Date('2026-09-10T00:00:00Z'), now)).toBe(-8);
    expect(expiryState(new Date('2027-09-18T00:00:00Z'), now)).toBe('ok');
    expect(expiryState(new Date('2026-10-05T00:00:00Z'), now)).toBe('soon'); // ۱۷ روز
    expect(expiryState(new Date('2026-08-01T00:00:00Z'), now)).toBe('expired');
  });
});

describe('گاوصندوق با پایگاه‌داده', () => {
  it('بی‌هیچ مدركی، وضعیت می‌گوید چه کم است', async () => {
    const status = await credentialStatus(db);
    expect(status.vaultReady).toBe(true);
    expect(status.privateKey).toBeNull();
    expect(status.certificate).toBeNull();
    expect(status.readyForProduction).toBe(false);
    expect(status.warnings.join(' ')).toContain('کلیدِ خصوصی');
  });

  it('گواهی را می‌پذیرد و ویژگی‌هایش را نشان می‌دهد (بی‌گشودنِ کلید)', async () => {
    const saved = await saveCredential(db, { kind: 'certificate', pem: GOOD_CERTIFICATE, label: 'گواهیِ آزمون' });
    expect(saved.kind).toBe('certificate');
    expect(saved.subject).toContain('ست‌شاپ');
    expect(saved.expiry).toBe('ok');

    const status = await credentialStatus(db);
    expect(status.certificate?.label).toBe('گواهیِ آزمون');
    expect(status.certificate?.serialNumber).toBeTruthy();
    // نباید کلیدِ خصوصی را در پاسخِ وضعیت بفرستیم، حتی رمزشده
    expect(JSON.stringify(status)).not.toContain('PRIVATE KEY');
  });

  it('مدركِ ناهماهنگ با نوعش را رد می‌کند — و چیزی تغییر نمی‌کند', async () => {
    const before = await credentialStatus(db);
    await expect(saveCredential(db, { kind: 'certificate', pem: GOOD_PRIVATE_KEY })).rejects.toThrow(
      /گواهی نیست/,
    );
    const after = await credentialStatus(db);
    // نسخه‌یِ پیشین باید زنده مانده باشد: شکست نباید فروشگاه را بی‌گواهی بگذارد
    expect(after.certificate?.fingerprint).toBe(before.certificate?.fingerprint);
  });

  it('کلیدِ خصوصی را می‌پذیرد و اثرانگشتِ «عمومی‌اش» را نگه می‌دارد', async () => {
    const saved = await saveCredential(db, { kind: 'private_key', pem: GOOD_PRIVATE_KEY });
    expect(saved.fingerprint).toBeTruthy();
    expect(saved.fingerprint).toBe(await fingerprintOfCertificatePublicKey(GOOD_CERTIFICATE));

    const pem = await loadCredentialPem(db, 'private_key');
    expect(pem).toContain('PRIVATE KEY');
  });

  it('جفتِ درست: اثرانگشتِ کلیدِ عمومیِ هر دو یکی است و وضعیت می‌گوید جفت‌اند', async () => {
    // چرا این آزمون جداگانه است؟ چون خطایی که یک‌بار رخ داد همین‌جا پنهان
    // بود: اثرانگشتِ «خودِ گواهی» با اثرانگشتِ «کلیدِ عمومی‌اش» دو چیزِ
    // متفاوت است. تا وقتی فقط اثرانگشتِ کلیدِ خصوصی را می‌سنجیدیم، آزمون‌ها
    // سبز بودند و سامانه در عمل به هر جفتِ درستی می‌گفت «جفت نیست». پس اینجا
    // هر دو با هم بالا می‌روند و **جفت‌بودن** سنجیده می‌شود.
    await saveCredential(db, { kind: 'certificate', pem: GOOD_CERTIFICATE });
    await saveCredential(db, { kind: 'private_key', pem: GOOD_PRIVATE_KEY });
    await saveCredential(db, { kind: 'public_key', pem: GOOD_PUBLIC_KEY });

    const status = await credentialStatus(db);
    expect(status.pairMatches).toBe(true);
    expect(status.readyForProduction).toBe(true);
    expect(status.warnings).toEqual([]);

    // اثرانگشتِ کلیدِ عمومی: برایِ کلید و گواهی یکی
    expect(status.certificate?.fingerprint).toBe(status.privateKey?.fingerprint);
    // اثرانگشتِ خودِ گواهی: چیزی دیگر، و فقط برایِ گواهی معنا دارد
    expect(status.certificate?.certFingerprint).toBeTruthy();
    expect(status.certificate?.certFingerprint).not.toBe(status.certificate?.fingerprint);
    expect(status.privateKey?.certFingerprint ?? null).toBeNull();
  });

  it('جفت‌نبودنِ کلید و گواهی را در وضعیت می‌گوید', async () => {
    await saveCredential(db, { kind: 'private_key', pem: OTHER_PRIVATE_KEY });
    const status = await credentialStatus(db);
    expect(status.pairMatches).toBe(false);
    expect(status.readyForProduction).toBe(false);
    expect(status.warnings.join(' ')).toContain('جفت نیست');
  });

  it('آزمونِ امضا: با جفتِ درست می‌گذرد و با جفتِ غلط نه', async () => {
    await saveCredential(db, { kind: 'private_key', pem: OTHER_PRIVATE_KEY });
    const bad = await testSigning(db);
    expect(bad.ok).toBe(false);

    await saveCredential(db, { kind: 'private_key', pem: GOOD_PRIVATE_KEY });
    const good = await testSigning(db);
    expect(good.ok).toBe(true);
    expect(good.message).toContain('راستی‌آزمایی');
  });

  it('بارگذاریِ دوباره، نسخه‌یِ پیشین را باطل می‌کند — اما نگهش می‌دارد', async () => {
    // شمارش **نسبی** است، نه مطلق: پایگاهِ این پرونده در همه‌یِ آزمون‌ها
    // به‌اشتراک است، و شمردنِ «۲» هر آزمونِ تازه‌ای را که پیش از این یکی
    // چیزی بنشاند می‌شکست — بی‌آنکه خطایی در کار باشد. آنچه معنا دارد این
    // است: یک نسخه‌یِ زنده افزوده شده و یک نسخه باطل شده است.
    const count = async () => {
      const { rows } = await db.query<{ total: string; live: string }>(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE revoked_at IS NULL) AS live
           FROM moadian_credentials WHERE kind = 'public_key'`,
      );
      return { total: Number(rows[0]?.total ?? 0), live: Number(rows[0]?.live ?? 0) };
    };
    const before = await count();

    const first = await saveCredential(db, { kind: 'public_key', pem: GOOD_PUBLIC_KEY, label: 'یکم' });
    await saveCredential(db, { kind: 'public_key', pem: GOOD_PUBLIC_KEY, label: 'دوم' });
    const status = await credentialStatus(db);
    expect(status.publicKey?.label).toBe('دوم');

    const after = await count();
    expect(after.total).toBe(before.total + 2); // دو نسخه ثبت شد…
    // …و هنوز **فقط یکی** زنده است: بارگذاریِ دوم، نخستین را باطل کرده است.
    // (پیش از این هم یکی زنده بود — همان که نسخه‌یِ دوم جایش را گرفت.)
    expect(before.live).toBe(1);
    expect(after.live).toBe(1);
    expect(first.label).toBe('یکم');
  });

  it('ابطال، مدرك را از دسترسِ ارسال بیرون می‌برد', async () => {
    expect(await revokeCredential(db, 'public_key')).toBe(true);
    expect(await loadCredentialPem(db, 'public_key')).toBeNull();
    expect(await revokeCredential(db, 'public_key')).toBe(false);
  });

  it('گواهیِ رو‌به‌انقضا هشدار می‌دهد — پیش از آنکه دیر شود', async () => {
    await db.query(
      `UPDATE moadian_credentials
          SET not_after = now() + interval '12 days'
        WHERE kind = 'certificate' AND revoked_at IS NULL`,
    );
    const status = await credentialStatus(db);
    expect(status.certificate?.expiry).toBe('soon');
    expect(status.warnings.join(' ')).toMatch(/روزِ دیگر تمام می‌شود/);
  });
});

/** اثرانگشتِ کلیدِ عمومیِ درونِ گواهی — برای سنجیدن با کلیدِ خصوصی */
async function fingerprintOfCertificatePublicKey(certPem: string): Promise<string> {
  const { createHash, X509Certificate } = await import('node:crypto');
  const cert = new X509Certificate(certPem.trim());
  const der = cert.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return createHash('sha256').update(der).digest('hex').toUpperCase().replace(/(.{2})(?=.)/g, '$1:');
}
