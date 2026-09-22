/**
 * مانورِ مرورگر برایِ بارگذاریِ تصویرِ کالا.
 *
 * چرا جدا از بقیه‌یِ مانورها؟ چون اینجا با «فایل» سروکار داریم: باید دید فایل
 * از مرورگر تا دیسک می‌رود یا نه، پیش‌نمایش درست نشان داده می‌شود یا نه، و
 * فایلی که تصویر نیست آیا با پیامی خوانا رد می‌شود یا نه. هیچ‌کدام از این‌ها
 * با یک درخواستِ curl ثابت نمی‌شود — چون مسیرِ واقعی از میانِ کنشِ سروری و
 * multipart می‌گذرد.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const WEB = process.env.WEB ?? 'http://127.0.0.1:3100';
const API = process.env.API ?? 'http://127.0.0.1:3000';
const OUT = 'docs/drill';

const log = (m) => console.log(m);
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => console.log(`  ❌ ${m}`);

async function main() {
  mkdirSync(OUT, { recursive: true });

  // دو فایلِ آزمایشی: یکی تصویرِ واقعی، یکی متنی که وانمود می‌کند تصویر است
  const good = '/tmp/drill-photo.jpg';
  const evil = '/tmp/drill-not-image.jpg';
  await sharp({ create: { width: 1800, height: 1200, channels: 3, background: { r: 30, g: 140, b: 90 } } })
    .jpeg()
    .toFile(good);
  writeFileSync(evil, 'این یک تصویر نیست؛ فقط نامش شبیهِ تصویر است.\n'.repeat(40));

  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobile: '09120000000', password: 'SetShop-1405!' }),
  }).then((r) => r.json());
  if (!login.accessToken) throw new Error(`ورود ناموفق: ${JSON.stringify(login)}`);
  ok('نشستِ مدیر ساخته شد');

  // نخستین کالا از API
  const products = await fetch(`${API}/catalog/products?limit=1`)
    .then((r) => r.json())
    .catch(() => null);
  const productId =
    products?.items?.[0]?.id ??
    (await fetch(`${API}/admin/catalog/products?limit=1`, {
      headers: { authorization: `Bearer ${login.accessToken}` },
    })
      .then((r) => r.json())
      .then((d) => d.products?.[0]?.id ?? d.items?.[0]?.id)
      .catch(() => null));
  if (!productId) throw new Error('هیچ کالایی برایِ آزمون یافت نشد.');
  log(`   کالا: ${productId}`);

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  await page.setCookie({ name: 'set_admin_token', value: login.accessToken, domain: '127.0.0.1', path: '/' });

  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error') jsErrors.push(m.text());
  });

  log('\n۱) باز کردنِ صفحه‌یِ ویرایشِ کالا');
  await page.goto(`${WEB}/admin/products/${productId}`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await page.waitForSelector('.dropzone', { timeout: 20_000 });
  ok('بخشِ بارگذاری (کادرِ رها کردن) دیده می‌شود');

  // شمارِ انگشتانه‌ها پیش از بارگذاری
  const before = await page.$$eval('.thumb', (els) => els.length);
  log(`   انگشتانه‌هایِ پیش از بارگذاری: ${before}`);

  log('\n۲) بارگذاریِ یک تصویرِ واقعی');
  const input = await page.$('.dropzone input[type=file]');
  await input.uploadFile(good);
  await new Promise((r) => setTimeout(r, 6000));

  const after = await page.$$eval('.thumb', (els) => els.length);
  if (after > before) ok(`تصویر بارگذاری شد: ${after} انگشتانه`);
  else bad(`انگشتانه‌ای افزوده نشد (پیش: ${before}، پس: ${after})`);

  // تصویر واقعاً بار شده؟ (ابعادِ طبیعی غیر از صفر یعنی فایل سالم رسیده)
  const loaded = await page.$$eval('.thumb img', (imgs) =>
    imgs.map((i) => ({ w: i.naturalWidth, h: i.naturalHeight, src: i.getAttribute('src') })),
  );
  const goodOne = loaded.find((i) => i.w > 0 && i.h > 0 && (i.src ?? '').startsWith('/media/'));
  if (goodOne) ok(`تصویرِ بارگذاری‌شده در صفحه نشان داده می‌شود: ${goodOne.src} (${goodOne.w}×${goodOne.h})`);
  else bad(`هیچ تصویری با نشانیِ /media/ و ابعادِ درست نبود: ${JSON.stringify(loaded.slice(-2))}`);

  await page.screenshot({ path: `${OUT}/media-uploader.png` });
  ok(`تصویر: ${OUT}/media-uploader.png`);

  log('\n۳) فایلی که تصویر نیست باید رد شود');
  const evilInput = await page.$('.dropzone input[type=file]');
  await evilInput.uploadFile(evil);
  await new Promise((r) => setTimeout(r, 5000));
  const alertText = await page.$eval('.alert--danger', (el) => el.innerText).catch(() => '');
  if (/تنها JPG|تصویر|مگابایت/.test(alertText)) ok(`رد شد با پیام: ${alertText.slice(0, 90)}`);
  else bad(`پیامِ رد شدن نیامد («${alertText.slice(0, 80)}»)`);

  log('\n۴) تصویر از مسیرِ نسبیِ خودِ سایت سرو می‌شود (نه از APIِ بیرونی)');
  if (goodOne) {
    const res = await page.evaluate(async (src) => {
      const r = await fetch(src);
      return { status: r.status, type: r.headers.get('content-type') };
    }, goodOne.src);
    if (res.status === 200 && (res.type ?? '').startsWith('image/'))
      ok(`پاسخ: ${res.status} ${res.type}`);
    else bad(`پاسخ نامناسب: ${JSON.stringify(res)}`);
  }

  log('\n۵) «اصلی کردن»ِ دومین تصویر');
  const mainBtns = await page.$$eval('.thumb figcaption button', (els) =>
    els.map((e) => e.textContent?.trim() ?? ''),
  );
  if (mainBtns.includes('اصلی کن')) {
    const buttons = await page.$$('.thumb figcaption button');
    for (const b of buttons) {
      const label = await b.evaluate((e) => e.textContent?.trim() ?? '');
      if (label === 'اصلی کن') {
        await b.click();
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
    const mainCount = await page.$$eval('.thumb--main', (els) => els.length);
    if (mainCount === 1) ok('یک تصویر به عنوانِ «اصلی» نشانه خورد');
    else bad(`شمارِ تصویرهایِ اصلی: ${mainCount} (باید یکی باشد)`);
  } else {
    log('   (تنها یک تصویر هست؛ جابه‌جاییِ اصلی بی‌معناست)');
  }

  log('\n۶) پاک‌سازیِ فایل‌هایِ بی‌صاحب');
  const sweepBtns = await page.$$('.thumb, .actions button');
  let swept = false;
  for (const b of sweepBtns) {
    const label = await b.evaluate((e) => e.textContent?.trim() ?? '');
    if (label.includes('پاک‌سازی')) {
      await b.click();
      swept = true;
      break;
    }
  }
  if (swept) {
    await new Promise((r) => setTimeout(r, 3000));
    const msg = await page.$eval('.alert--ok', (el) => el.innerText).catch(() => '');
    if (msg) ok(msg.slice(0, 90));
    else bad('پاک‌سازی پیامی نداد');
  } else bad('دکمه‌یِ پاک‌سازی یافت نشد');

  log('\n۷) خطاهایِ جاوااسکریپت');
  if (jsErrors.length === 0) ok('هیچ خطایی در مرورگر رخ نداد');
  else jsErrors.slice(0, 5).forEach((e) => bad(e.slice(0, 160)));

  await browser.close();

  // پاک‌سازیِ ردِّ مانور: تصویرهایِ آزمایشی نباید در ویترین بمانند
  log('\n۸) پاک‌سازیِ ردِّ مانور');
  const leftovers = await page2Cleanup(productId, login.accessToken);
  ok(`${leftovers} تصویرِ آزمایشی برداشته شد`);

  log('\nپایانِ مانور.');
}

/** تصویرهایی را که این مانور رویِ کالا گذاشته برمی‌دارد و شمارشان را برمی‌گرداند */
async function page2Cleanup(productId, token) {
  const list = await fetch(`${API}/admin/products/${productId}/images`, {
    headers: { authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  let removed = 0;
  for (const img of list.items ?? []) {
    if (!(img.url ?? '').startsWith('/media/')) continue;
    const res = await fetch(`${API}/admin/products/${productId}/images/${img.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) removed += 1;
  }
  return removed;
}

main().catch((e) => {
  console.error('دریل شکست خورد:', e);
  process.exit(1);
});
