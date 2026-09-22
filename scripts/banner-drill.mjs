import puppeteer from 'puppeteer-core';
const B = 'http://127.0.0.1:3100';
const ok = (m) => console.log('  ✅', m);
const bad = (m) => { console.log('  ❌', m); process.exitCode = 1; };

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
await page.setViewport({ width: 420, height: 860, isMobile: true });

console.log('۱) ورود');
await page.goto(`${B}/admin/login`, { waitUntil: 'domcontentloaded' });
await page.click('input[name=mobile]', { clickCount: 3 }); // اگر چیزی از پیش بود، پاک
await page.type('input[name=mobile]', '09120000000');
await page.type('input[name=password]', 'SetShop-1405!');
await page.click('button[type=submit]');
// ورود یک «کنشِ سروری» است: رفت‌وبرگشتِ کاملِ صفحه نداریم، پس باید چشم‌به‌راهِ
// تغییرِ نشانی بمانیم، نه رویدادِ navigation.
try {
  await page.waitForFunction(() => !location.pathname.startsWith('/admin/login'), { timeout: 20000 });
} catch {}
if (!page.url().includes('/admin/login')) ok('وارد شد (' + new URL(page.url()).pathname + ')');
else {
  const msg = await page.$eval('.alert', (e) => e.textContent.trim()).catch(() => '(پیامی نیست)');
  bad('ورود ناموفق: ' + msg);
}

console.log('۲) رفتن به «ویترین» از منو');
await page.goto(`${B}/admin`, { waitUntil: 'domcontentloaded' });
const found = await page.$$eval('a', (as) => as.some((a) => a.getAttribute('href') === '/admin/banners'));
found ? ok('پیوندِ «ویترین» در منو هست') : bad('پیوندِ منو دیده نشد');
await page.goto(`${B}/admin/banners`, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));

console.log('۳) ساختِ پیام از پنل');
const title = `بنرِ آزمون ${Date.now()}`;
await page.type('.field__input', title);
const ta = await page.$('textarea.field__input');
if (ta) await ta.type('این پیام از پنل ساخته شد');
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'انتشار'); b.click(); });
await new Promise((r) => setTimeout(r, 2500));
const alert = await page.$eval('.alert', (e) => e.textContent.trim()).catch(() => null);
alert && alert.includes('ساخته شد') ? ok('پیام ساخته شد: ' + alert.trim()) : bad('ساخت ناموفق: ' + alert);

const rowHas = await page.evaluate((t) => document.body.textContent.includes(t), title);
rowHas ? ok('در فهرستِ پنل آمد') : bad('در فهرست نیامد');

console.log('۴) رویِ سایت');
await page.goto(`${B}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));
const live = await page.evaluate((t) => document.body.textContent.includes(t), title);
live ? ok('در نوارِ بالایِ سایت دیده شد') : bad('روی سایت نیامد');

console.log('۵) خاموش کردن و ناپدید شدن');
await page.goto(`${B}/admin/banners`, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate((t) => {
  const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes(t));
  [...row.querySelectorAll('button')].find((b) => b.textContent.includes('خاموش')).click();
}, title);
await new Promise((r) => setTimeout(r, 2500));
await page.goto(`${B}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));
const gone = await page.evaluate((t) => !document.body.textContent.includes(t), title);
gone ? ok('خاموش شد و از سایت رفت') : bad('هنوز روی سایت است');

console.log('۶) حذف (پاک‌سازی)');
await page.goto(`${B}/admin/banners`, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate((t) => {
  const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes(t));
  [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'حذف').click();
}, title);
try {
  await page.waitForFunction((t) => ![...document.querySelectorAll('tr')].some((r) => r.textContent.includes(t)),
    { timeout: 15000 }, title);
  ok('ردیف از فهرستِ پنل رفت');
} catch {
  const msg = await page.$eval('.alert', (e) => e.textContent.trim()).catch(() => '(پیامی نیست)');
  bad('حذف نشد — ' + msg);
}
// بارگیریِ دوباره: باید از کارساز هم رفته باشد، نه فقط از حافظه‌یِ صفحه
await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1000));
const reallyGone = await page.evaluate((t) => !document.body.textContent.includes(t), title);
reallyGone ? ok('پس از بارگیریِ دوباره هم نیست (واقعاً حذف شد)') : bad('در کارساز مانده است');

console.log('۷) خطایِ جاوااسکریپت:', errors.length === 0 ? 'هیچ ✅' : errors.join(' | '));
await browser.close();
console.log(process.exitCode ? '\n💥 تمرین ناقص ماند' : '\n🎉 گام‌به‌گام درست بود');
