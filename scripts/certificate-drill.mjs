#!/usr/bin/env node
/**
 * تمرینِ گاوصندوقِ گواهیِ مؤدیان — همان راهی که فروشنده می‌رود.
 *
 * آزمایشِ واحد می‌گوید «رمزنگاری و شناسایی درست کار می‌کنند»؛ این تمرین
 * می‌گوید **فروشنده می‌تواند بی‌کمکِ برنامه‌نویس گواهی را نصب کند**: پرونده‌ای
 * از مرجع را می‌چسباند، سامانه می‌پذیرد، نامِ فارسی‌اش را درست نشان می‌دهد،
 * جفت‌نبودنِ کلید و گواهی را همان لحظه می‌گوید، و امضا را بی‌هیچ ارتباطی با
 * سازمان می‌آزماید.
 *
 * چرا مدارک را در تمرین می‌سازیم (با openssl) و از پیش آماده نمی‌گذاریم؟
 *   چون آنچه فروشنده از مرجع می‌گیرد همین است: یک جفتِ تازه که تا امروز در
 *   هیچ پایگاهی نبوده. ساختنِ آن در تمرین یعنی «بارگذاریِ نخستین» هم آزموده
 *   می‌شود، نه فقطِ خواندنِ چیزی که از پیش بوده.
 *
 * اجرا:
 *   node scripts/certificate-drill.mjs
 *   (API روی ۳۰۰۰ باید بالا باشد و SET_MASTER_KEY در محیطش تعیین شده باشد)
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = process.env.API_BASE ?? 'http://127.0.0.1:3000';
const ADMIN = { mobile: '09120000000', password: 'SetShop-1405!' };

let failures = 0;
function check(label, ok, extra = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: res.status, data, text };
}

/** یک جفتِ کلید و گواهیِ تازه — همان چیزی که مرجع به فروشنده می‌دهد */
function makePair(dir, name, subject) {
  const keyPath = join(dir, `${name}.key`);
  const crtPath = join(dir, `${name}.crt`);
  try {
    execFileSync(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', crtPath,
       '-days', '365', '-subj', subject],
      { stdio: 'ignore' },
    );
  } catch {
    return null;
  }
  return { privateKey: readFileSync(keyPath, 'utf8'), certificate: readFileSync(crtPath, 'utf8') };
}

async function main() {
  console.log('── تمرینِ گاوصندوقِ گواهی ──\n');

  const login = await call('POST', '/auth/login', { body: ADMIN });
  const token = login.data?.accessToken;
  if (!token) {
    console.log('❌ ورودِ مدیر ناموفق بود؛ تمرین متوقف شد.');
    process.exit(1);
  }
  check('ورودِ مدیر', true);

  const dir = mkdtempSync(join(tmpdir(), 'setshop-cert-'));
  const good = makePair(dir, 'good', '/C=IR/ST=Tehran/O=ست‌شاپ/CN=forushgah');
  const other = makePair(dir, 'other', '/C=IR/O=فروشگاهِ دیگر/CN=digar');
  if (!good || !other) {
    console.log('❌ openssl در دسترس نیست؛ تمرین اجرا نشد.');
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  }

  try {
    // ۱) آغاز: هیچ مدركی نیست و پیام می‌گوید چه کم است
    const empty = await call('GET', '/admin/tax/certificate', { token });
    check('گاوصندوق باز است (SET_MASTER_KEY در محیط)', empty.data?.vaultReady === true,
      empty.data?.vaultMessage ?? '');
    check('بی‌مدرك: می‌گوید چه کم است',
      empty.data?.readyForProduction === false &&
      empty.data?.warnings.some((w) => w.includes('کلیدِ خصوصی')),
      `${empty.data?.warnings?.length ?? 0} هشدار`);

    // ۲) جابه‌جاییِ نوع: گواهی را در جایِ کلید گذاشتن (رایج‌ترین اشتباه)
    const swapped = await call('POST', '/admin/tax/certificate', {
      token,
      body: { kind: 'certificate', pem: good.privateKey },
    });
    check('مدركِ ناهماهنگ با نوع رد می‌شود', swapped.status === 400,
      `${swapped.status} ${swapped.data?.error?.message ?? ''}`);

    // ۳) بارگذاریِ درستِ گواهی — با نامِ فارسی
    const cert = await call('POST', '/admin/tax/certificate', {
      token,
      body: { kind: 'certificate', pem: good.certificate, label: 'گواهیِ آزمون' },
    });
    const certFacts = cert.data?.status?.certificate;
    check('گواهی پذیرفته شد', (cert.status === 200 || cert.status === 201) && Boolean(certFacts), String(cert.status));
    check('نامِ فارسیِ گواهی درست خوانده می‌شود',
      Boolean(certFacts?.subject?.includes('ست‌شاپ')), certFacts?.subject ?? '');
    check('اثرانگشت و سریال استخراج شدند',
      /^[0-9A-F]{2}(:[0-9A-F]{2})+$/.test(certFacts?.fingerprint ?? '') &&
      Boolean(certFacts?.serialNumber), certFacts?.fingerprint?.slice(0, 20) ?? '');
    check('تاریخِ اعتبار دارد', Boolean(certFacts?.notAfter && certFacts?.daysRemaining > 300),
      `${certFacts?.daysRemaining} روز`);

    // ۴) کلیدِ ناجفت: باید همان لحظه بگوید
    await call('POST', '/admin/tax/certificate', { token, body: { kind: 'private_key', pem: other.privateKey } });
    const mismatch = await call('GET', '/admin/tax/certificate', { token });
    check('جفت‌نبودنِ کلید و گواهی اعلام می‌شود',
      mismatch.data?.pairMatches === false &&
      mismatch.data?.warnings.some((w) => w.includes('جفت نیست')));

    const badSign = await call('POST', '/admin/tax/certificate/test', { token, body: {} });
    check('آزمایشِ امضا با جفتِ ناجفت رد می‌شود', badSign.data?.ok === false, badSign.data?.message ?? '');

    // ۵) کلیدِ درست: همه چیز باید سبز شود
    await call('POST', '/admin/tax/certificate', { token, body: { kind: 'private_key', pem: good.privateKey } });
    const paired = await call('GET', '/admin/tax/certificate', { token });
    check('کلیدِ درست با گواهی جفت می‌شود', paired.data?.pairMatches === true);

    const goodSign = await call('POST', '/admin/tax/certificate/test', { token, body: {} });
    check('امضا ساخته و با گواهی راستی‌آزمایی می‌شود', goodSign.data?.ok === true, goodSign.data?.message ?? '');

    // ۶) کلیدِ عمومیِ سازمان: بی‌آن فقط هشدار است، نه خطا
    const pub = execFileSync('openssl', ['x509', '-in', join(dir, 'good.crt'), '-pubkey', '-noout']).toString();
    await call('POST', '/admin/tax/certificate', { token, body: { kind: 'public_key', pem: pub } });
    const complete = await call('GET', '/admin/tax/certificate', { token });
    check('با سه مدرك، آماده‌یِ ارسالِ واقعی است',
      complete.data?.readyForProduction === true && complete.data?.warnings.length === 0,
      complete.data?.warnings?.join(' / ') ?? '');

    // ۷) کلیدِ خصوصی هرگز در خروجی نیست
    const raw = JSON.stringify(complete.data);
    check('کلیدِ خصوصی در هیچ پاسخی برنمی‌گردد', !raw.includes('PRIVATE KEY'));

    // ۸) ابطال: مدرك از دسترسِ ارسال بیرون می‌رود
    const revoked = await call('POST', '/admin/tax/certificate/revoke', {
      token,
      body: { kind: 'private_key' },
    });
    check('ابطالِ کلیدِ خصوصی', [200, 201].includes(revoked.status) && revoked.data?.status?.privateKey == null, String(revoked.status));

    const afterRevoke = await call('POST', '/admin/tax/certificate/test', { token, body: {} });
    check('پس از ابطال، آزمایشِ امضا می‌گوید چیزی نیست', afterRevoke.data?.ok === false,
      afterRevoke.data?.message ?? '');

    // ۹) دسترسی: فروشنده حقِ تغییرِ گواهی ندارد
    const seller = await call('POST', '/auth/login', {
      body: { mobile: '09120000001', password: 'SetShop@1404' },
    });
    const sellerToken = seller.data?.accessToken;
    if (sellerToken) {
      const denied = await call('POST', '/admin/tax/certificate/revoke', {
        token: sellerToken,
        body: { kind: 'certificate' },
      });
      check('فروشنده اجازه‌یِ ابطالِ گواهی ندارد (۴۰۳)', denied.status === 403, String(denied.status));
    }

    // ۱۰) پاک‌سازی: هرچه تمرین گذاشت برمی‌دارد
    for (const kind of ['certificate', 'public_key']) {
      await call('POST', '/admin/tax/certificate/revoke', { token, body: { kind } });
    }
    const cleaned = await call('GET', '/admin/tax/certificate', { token });
    check('در پایان چیزی در گاوصندوق نمی‌ماند',
      !cleaned.data?.certificate && !cleaned.data?.privateKey && !cleaned.data?.publicKey);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? '✅ تمرینِ گواهی سبز شد' : `❌ ${failures} مورد نیاز به بررسی دارد`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
