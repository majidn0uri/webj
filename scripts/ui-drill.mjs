/**
 * دریلِ واقعیِ رابط با مرورگرِ بی‌سر (Chromium + puppeteer-core).
 *
 * چرا این اسکریپت وجود دارد؟
 *   تست‌هایِ واحد، سرویس و API را می‌سنجند اما هیچ‌کدام ثابت نمی‌کنند که یک
 *   قطعه‌یِ سمتِ کاربر واقعاً رندر می‌شود و خطا نمی‌دهد. یک قطعه‌ی کاملاً
 *   سالم از نظرِ تایپ می‌تواند در مرورگر به‌خاطرِ واردکردنِ یک ماژولِ سروری
 *   یا یک هوکِ اشتباه سفید شود. این اسکریپت همان فاصله را می‌بندد:
 *   نشست می‌سازد، تب را باز می‌کند، مبلغ را با **ارقامِ فارسی** می‌نویسد
 *   (مدیرها این‌طور می‌نویسند) و نتیجه را از متنِ واقعیِ صفحه می‌خواند.
 *
 * هر بار خروجی‌اش دو تصویر در `docs/drill/` می‌گذارد تا رفتار «دیده» شود،
 * نه فقط گزارش.
 *
 * اجرا:  node scripts/ui-drill.mjs            (وب روی ۳۱۰۰ و API روی ۳۰۰۰ باشد)
 */

import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const API = process.env.API_URL ?? 'http://localhost:3000';
const MOBILE = '09120000000';
const PASSWORD = 'SetShop-1405!';
const OUT = 'docs/drill';

const log = (...a) => console.log(...a);
const ok = (m) => log(`  ✓ ${m}`);
const bad = (m) => {
  log(`  ✗ ${m}`);
  process.exitCode = 1;
};

async function main() {
  mkdirSync(OUT, { recursive: true });

  // ── نشست: همان مسیری که یک مدیر می‌رود (ورود، نه ساختِ توکنِ دستی)
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile: MOBILE, password: PASSWORD }),
  }).then((r) => r.json());
  const token = login.accessToken;
  if (!token) throw new Error(`ورود ناموفق: ${JSON.stringify(login)}`);
  ok('نشستِ مدیر ساخته شد');

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1100 });

  // خطاهایِ جاوااسکریپت: اگر قطعه‌ای در مرورگر بشکند، اینجا دیده می‌شود
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e.message ?? e)));
  page.on('console', (m) => {
    if (m.type() === 'error') jsErrors.push(m.text());
  });

  await page.setCookie({
    name: 'set_admin_token',
    value: token,
    domain: 'localhost',
    path: '/',
  });

  log('\n۱) باز کردنِ پنلِ حسابداری');
  await page.goto(`${WEB}/admin/accounting`, { waitUntil: 'networkidle2' });
  const title = await page.$eval('h1, h2', (el) => el.textContent.trim()).catch(() => '');
  log(`   عنوان: ${title}`);

  log('\n۲) رفتن به تبِ «فاکتورِ خرید»');
  const clickedTab = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      (x.textContent ?? '').includes('فاکتورِ خرید'),
    );
    if (!b) return false;
    b.click();
    return true;
  });
  if (!clickedTab) bad('تبِ فاکتورِ خرید پیدا نشد');
  else {
    await page.waitForSelector('.settlement', { timeout: 10_000 });
    ok('ستونِ تسویه رندر شد');
  }

  log('\n۳) باز کردنِ پنجره‌ی تسویه‌یِ نخستین فاکتور');
  await page.evaluate(() => document.querySelector('.settlement .btn').click());
  await page.waitForSelector('.settlement__panel', { timeout: 10_000 });
  await page.waitForFunction(
    () => document.querySelector('.settlement__head') !== null,
    { timeout: 10_000 },
  );
  const head = await page.$eval('.settlement__head', (el) =>
    el.innerText.replace(/\s+/g, ' ').trim(),
  );
  log(`   ${head}`);
  await page.screenshot({ path: `${OUT}/settlement-open.png` });
  ok('تصویر: docs/drill/settlement-open.png');

  log('\n۴) ثبتِ پرداخت با ارقامِ فارسی («۵۰۰۰۰» تومان)');
  // ارقامِ فارسی عمداً: مدیر با صفحه‌کلیدِ فارسی می‌نویسد و این باید کار کند
  await page.evaluate(() => {
    const input = document.querySelector('.settlement__form .field__input');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    setter.call(input, '۵۰۰۰۰');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.settlement__form button')].find((x) =>
      (x.textContent ?? '').includes('ثبتِ پرداخت'),
    );
    b.click();
  });
  await page.waitForFunction(
    () =>
      document.querySelector('.settlement__panel .alert--ok') !== null ||
      document.querySelector('.settlement__panel .alert--danger') !== null,
    { timeout: 20_000 },
  );
  const alertText = await page.$eval(
    '.settlement__panel .alert',
    (el) => el.innerText.trim(),
  );
  log(`   پاسخ: ${alertText}`);
  if (alertText.includes('ثبت شد')) ok('پرداخت با ارقامِ فارسی ثبت شد');
  else bad('پرداخت ثبت نشد');

  await new Promise((r) => setTimeout(r, 1200)); // تازه‌شدنِ فهرست
  const head2 = await page.$eval('.settlement__head', (el) =>
    el.innerText.replace(/\s+/g, ' ').trim(),
  );
  log(`   وضعیتِ پس از پرداخت: ${head2}`);
  const rows = await page.$$eval('.settlement__panel .table--inner tbody tr', (trs) =>
    trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()),
  );
  rows.forEach((r) => log(`   · ${r}`));
  await page.screenshot({ path: `${OUT}/settlement-paid.png` });
  ok('تصویر: docs/drill/settlement-paid.png');

  log('\n۵) وصولِ چک (اگر در فهرست چکی باشد)');
  const cleared = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.settlement__panel button')].find((x) =>
      (x.textContent ?? '').includes('وصول شد'),
    );
    if (!b) return false;
    b.click();
    return true;
  });
  if (cleared) {
    await new Promise((r) => setTimeout(r, 2000));
    const after = await page
      .$eval('.settlement__panel .alert', (el) => el.innerText.trim())
      .catch(() => '');
    log(`   پاسخ: ${after}`);
    ok('وصولِ چک اجرا شد');
  } else log('   (چکِ وصول‌نشده‌ای در این فاکتور نیست — رد می‌شود)');

  log('\n۶) خطاهایِ جاوااسکریپتِ صفحه:');
  if (jsErrors.length === 0) ok('هیچ خطایی در مرورگر رخ نداد');
  else {
    jsErrors.slice(0, 8).forEach((e) => log(`   ! ${e.slice(0, 180)}`));
    bad(`${jsErrors.length} خطا در مرورگر`);
  }

  // ── ۷) صفحه‌یِ مالیات ───────────────────────────────────────────────────
  log('\n۷) صفحه‌یِ مالیات و سامانه‌یِ مؤدیان');
  await page.goto(`${WEB}/admin/tax`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.stat', { timeout: 15_000 });
  const stats = await page.$$eval('.stat', (cards) =>
    cards.map((c) => c.innerText.replace(/\s+/g, ' ').trim()),
  );
  stats.slice(0, 3).forEach((s) => log(`   · ${s}`));

  const vatText = await page
    .$eval('.subpanel table', (t) => t.innerText.replace(/\s+/g, ' ').trim())
    .catch(() => '');
  if (vatText) log(`   اظهارنامه: ${vatText.slice(0, 160)}`);

  const taxRows = await page.$$eval('.table tbody tr', (trs) => trs.length);
  log(`   ردیف‌هایِ جدولِ صورتحساب‌ها: ${taxRows}`);
  await page.screenshot({ path: `${OUT}/tax-panel.png` });
  ok('تصویر: docs/drill/tax-panel.png');

  // ورود به فهرستِ ناوبری: آیا «مالیات» در منو هست؟
  const navHasTax = await page.evaluate(() =>
    [...document.querySelectorAll('a')].some((a) => (a.textContent ?? '').includes('مالیات')),
  );
  if (navHasTax) ok('پیوندِ «مالیات» در ناوبریِ پنل هست');
  else bad('پیوندِ «مالیات» در ناوبری نیست');

  await browser.close();
  log(`\nخروجی‌ها در ${OUT}/ ذخیره شد.`);
}

main().catch((e) => {
  console.error('دریل شکست خورد:', e);
  process.exit(1);
});
