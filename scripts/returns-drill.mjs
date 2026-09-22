/**
 * مانورِ مرورگر برایِ صفحه‌یِ «مرجوعی و گارانتی».
 *
 * چرا جدا از ui-drill؟ چون این صفحه تعاملی است: باید دکمه‌یِ «جزئیات» را زد،
 * خطِ زمان را خواند و دید که دکمه‌یِ بازگشتِ وجه در وضعیتِ درست فعال است یا
 * نه. یک مانورِ خطی نمی‌تواند این را ثابت کند.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const WEB = process.env.WEB ?? 'http://127.0.0.1:3100';
const OUT = 'docs/drill';
const log = (m) => console.log(m);
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => console.log(`  ❌ ${m}`);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });

  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error') jsErrors.push(m.text());
  });

  // ── نشست: توکن از API و بعد کوکی در مرورگر (همان مسیرِ یک مدیر)
  const API = process.env.API ?? 'http://127.0.0.1:3000';
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile: '09120000000', password: 'SetShop-1405!' }),
  }).then((r) => r.json());
  if (!login.accessToken) throw new Error(`ورود ناموفق: ${JSON.stringify(login)}`);
  await page.setCookie({
    name: 'set_admin_token',
    value: login.accessToken,
    domain: '127.0.0.1',
    path: '/',
  });
  ok('نشستِ مدیر ساخته شد');

  // ── صفحه‌یِ مرجوعی ──────────────────────────────────────────────────────
  log('\n۲) صفحه‌یِ مرجوعی و گارانتی');
  await page.goto(`${WEB}/admin/returns`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.stat', { timeout: 15_000 });
  const stats = await page.$$eval('.stat', (cards) =>
    cards.map((c) => c.innerText.replace(/\s+/g, ' ').trim()),
  );
  stats.forEach((s) => log(`   · ${s}`));

  const alerts = await page.$$eval('.alert', (els) =>
    els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
  );
  if (alerts.length) alerts.forEach((a) => log(`   پیامِ صفحه: ${a.slice(0, 200)}`));

  const rowCount = await page.$$eval('.table tbody tr', (trs) => trs.length);
  log(`   ردیف‌هایِ فهرست: ${rowCount}`);
  if (rowCount > 0) ok('فهرستِ مرجوعی‌ها پر است');
  else bad('فهرست خالی است');

  // پیوند در ناوبری؟
  const navHasReturns = await page.evaluate(() =>
    [...document.querySelectorAll('a')].some((a) => (a.textContent ?? '').includes('مرجوعی')),
  );
  if (navHasReturns) ok('پیوندِ «مرجوعی» در ناوبریِ پنل هست');
  else bad('پیوندِ «مرجوعی» در ناوبری نیست');

  await page.screenshot({ path: `${OUT}/returns-list.png` });
  ok(`تصویر: ${OUT}/returns-list.png`);

  // ── باز کردنِ جزئیات ────────────────────────────────────────────────────
  log('\n۳) جزئیاتِ یک مرجوعی');
  const opened = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const target = buttons.find((b) => (b.textContent ?? '').includes('جزئیات'));
    if (!target) return false;
    target.click();
    return true;
  });
  if (!opened) {
    bad('دکمه‌یِ جزئیات پیدا نشد');
  } else {
    await new Promise((r) => setTimeout(r, 2000));
    const detailText = await page
      .$eval('.subpanel', (el) => el.innerText.replace(/\s+/g, ' ').trim())
      .catch(() => '');
    log(`   متنِ جزئیات: ${detailText.slice(0, 220)}`);

    if (/تاریخچه/.test(detailText)) ok('خطِ زمان (تاریخچه) نمایش داده شد');
    else bad('تاریخچه در جزئیات نیست');

    const hasInspectOrRefund = /بازگشتِ وجه|ثبتِ بازرسی/.test(detailText);
    if (hasInspectOrRefund) ok('دکمه‌یِ مرحله‌یِ بعد در دسترس است');
    else log('   (این مرجوعی در وضعیتی است که فعلاً عملی ندارد)');

    await page.screenshot({ path: `${OUT}/returns-detail.png` });
    ok(`تصویر: ${OUT}/returns-detail.png`);
  }

  // ── انجامِ یک مرجوعی تا آخر، از درونِ مرورگر ─────────────────────────────
  log('\n۴) انجامِ مرجوعی تا بازگشتِ وجه (در مرورگر)');
  const refunded = await page.evaluate(async () => {
    const clickByText = (text) => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes(text));
      if (!b) return false;
      b.click();
      return true;
    };
    if (!clickByText('بازگشتِ وجه')) return 'دکمه نبود';
    await new Promise((r) => setTimeout(r, 2500));
    return document.querySelector('.alert')?.textContent ?? '(بدون پیام)';
  });
  log(`   پیام پس از بازگشتِ وجه: ${String(refunded).slice(0, 120)}`);
  if (/برگشت داده شد|بازگشتِ وجه ثبت/.test(String(refunded))) ok('بازگشتِ وجه از پنل انجام شد');
  else bad(`بازگشتِ وجه انجام نشد: ${String(refunded).slice(0, 80)}`);

  // ── بخشِ گارانتی ────────────────────────────────────────────────────────
  log('\n۵) بخشِ گارانتی');
  // فیلتر را رویِ «همه» می‌گذاریم: پیش‌فرضِ صفحه «۳۰ روزِ آینده» است و درست
  // است که در بیشترِ روزها خالی باشد
  await page.evaluate(() => {
    const panel = [...document.querySelectorAll('.panel')].find((p) =>
      (p.innerText ?? '').includes('گارانتی'),
    );
    const select = panel?.querySelector('select');
    if (!select) return;
    const option = [...select.options].find((o) => (o.textContent ?? '').includes('همه'));
    if (option) {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await new Promise((r) => setTimeout(r, 2500));
  const warrantyRows = await page.evaluate(() => {
    const panel = [...document.querySelectorAll('.panel')].find((p) =>
      (p.innerText ?? '').includes('گارانتی'),
    );
    return panel ? panel.querySelectorAll('tbody tr').length : 0;
  });
  if (warrantyRows > 0) ok(`جدولِ گارانتی پر است: ${warrantyRows} ردیف`);
  else bad('جدولِ گارانتی خالی است');
  await page.screenshot({ path: `${OUT}/returns-warranty.png` });

  log('\n۶) خطاهایِ جاوااسکریپت');
  if (jsErrors.length === 0) ok('هیچ خطایی در مرورگر رخ نداد');
  else jsErrors.slice(0, 5).forEach((e) => bad(e.slice(0, 160)));

  await browser.close();
  log('\nپایانِ مانور.');
}

main().catch((e) => {
  console.error('دریل شکست خورد:', e);
  process.exit(1);
});
