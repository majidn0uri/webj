import puppeteer from 'puppeteer-core';

/**
 * تمرینِ نظرات — با مرورگرِ واقعی.
 *
 * روند: خریدی «تحویل‌شده» برایِ مشتری می‌سازیم (تا نشانِ خریدِ تأییدشده
 * معنا داشته باشد)، سپس نظر می‌نویسیم، در پنل منتشر می‌کنیم، پاسخ
 * می‌دهیم، و رویِ صفحه‌یِ کالا می‌بینیمش. در پایان همه چیز پاک می‌شود.
 */

const B = 'http://127.0.0.1:3100';
const A = 'http://127.0.0.1:3000';
const ok = (m) => console.log('  ✅', m);
const bad = (m) => { console.log('  ❌', m); process.exitCode = 1; };

const api = async (path, options = {}) => {
  const res = await fetch(`${A}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  return res;
};

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
await page.setViewport({ width: 420, height: 900, isMobile: true });

// ── ۱) پیش‌نیاز: یک مشتری با خریدِ تحویل‌شده ────────────────────────────────
console.log('۱) ساختِ خریدار با خریدِ تحویل‌شده');

// نشستِ کارمند: برایِ خواندنِ صندوقِ پیامک (کدِ یک‌بارمصرف در آن است)
const staffLogin = await (await api('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ mobile: '09120000000', password: 'SetShop-1405!' }),
})).json();
const staffToken = staffLogin.accessToken;

const detail = await (await api('/catalog/products/powerbank-20000')).json();
const productId = detail.id;

// پاک‌سازیِ پیشین: اجرایِ شکست‌خورده‌یِ قبلی ممکن است نظری جا گذاشته باشد،
// و آن نظر گامِ «پیش از تأیید پیدا نیست» را نادرست می‌کرد.
{
  const { execSync: ex } = await import('node:child_process');
  const DB0 = 'postgres://setshop@/setshop?host=/tmp/setshop-pgrun&port=5433';
  const run0 = (sql) => ex(`/usr/lib/postgresql/18/bin/psql "${DB0}" -tAc ${JSON.stringify(sql)}`, { encoding: 'utf8' });
  run0(`DELETE FROM product_review_votes WHERE review_id IN (SELECT id FROM product_reviews WHERE product_id = '${productId}')`);
  run0(`DELETE FROM product_reviews WHERE product_id = '${productId}'`);
}
const variantId = detail.variants?.[0]?.id;
if (productId && variantId) ok(`کالا و تنوع یافت شد (${detail.variants.length} تنوع)`);
else bad('کالا یا تنوع پیدا نشد');

// ورودِ خریدار: کد به پیامک می‌رود و در این محیط در «صندوقِ خروجیِ پیامک»
// دیده می‌شود — همان‌جایی که مدیر در پنل می‌بیند.
const phone = `0912${Math.floor(1000000 + Math.random() * 8999999)}`;
// نخست ثبت‌نام (purpose: register) — ورود به‌تنهایی برایِ شماره‌یِ تازه
// کافی نیست و کارساز درست می‌گوید «نخست ثبت‌نام کنید».
await api('/shop/auth/otp/request', {
  method: 'POST', body: JSON.stringify({ mobile: phone, purpose: 'register' }),
});
const outbox = await (await fetch(`${A}/admin/settings/sms/outbox`, {
  headers: { authorization: `Bearer ${staffToken}` },
})).json();
const masked = phone.slice(0, 4) + '•••' + phone.slice(-3);
// صندوق را تازه‌ترین-نخست می‌چینیم: شماره‌ها در گزارش نقاب می‌شوند
// (۰۹۱۲•••۷۷۷) و دو شماره می‌توانند نقابی یکسان داشته باشند — اگر کهنه‌ترین
// را برمی‌داشتیم، کدی مصرف‌شده به دستمان می‌رسید.
const message = [...(outbox.items ?? [])]
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  .find((item) => item.phone === masked && item.templateKey === 'otp_login');
const code = /کد ورود شما: (\d+)/.exec(message?.body ?? '')?.[1];
if (!code) bad('کدِ ورود در صندوقِ پیامک پیدا نشد');

// همان purpose در تایید هم فرستاده می‌شود: کد با «register» خواسته شده و
// تاییدِ آن با پیش‌فرضِ «login» جور نمی‌آید (کدِ هر purpose جداست).
const login = await (await api('/shop/auth/otp/verify', {
  method: 'POST', body: JSON.stringify({ mobile: phone, code, purpose: 'register', fullName: 'خریدار آزمون' }),
})).json();
const customerToken = login.token;
if (customerToken) ok(`خریدار ساخته و وارد شد (کد ${code})`);
else bad('ورودِ خریدار ناموفق: ' + JSON.stringify(login).slice(0, 120));

// سفارشِ «تحویل‌شده» مستقیماً در پایگاه: راهِ عادی از درگاه می‌گذرد، ولی
// اینجا تنها پیش‌نیازِ آزمون است — می‌خواهیم نشانِ «خریدِ تأییدشده» را
// بیازماییم، نه درگاه را.
const { execSync } = await import('node:child_process');
const DB = 'postgres://setshop@/setshop?host=/tmp/setshop-pgrun&port=5433';
// برچسبِ دستور (مانندِ INSERT 0 1) همراهِ خروجی می‌آید؛ تنها نخستین
// شناسه‌یِ uuid را برمی‌داریم.
const psql = (sql) => {
  const out = execSync(`/usr/lib/postgresql/18/bin/psql "${DB}" -tAc ${JSON.stringify(sql)}`, { encoding: 'utf8' });
  return (out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ?? out.trim());
};
const orderId = psql(
  `INSERT INTO orders (order_no, customer_id, status, total_rial) SELECT 'DRILL-' || floor(random()*1000000)::text, c.id, 'delivered', 100000 FROM customers c WHERE c.phone = '${phone}' RETURNING id`,
);
if (orderId) {
  psql(`INSERT INTO order_items (order_id, variant_id, quantity, unit_price_rial, total_rial) VALUES ('${orderId}', '${variantId}', 1, 100000, 100000)`);
  ok('خریدِ تحویل‌شده ثبت شد');
} else bad('سفارش ساخته نشد');

// ── ۲) نظر نوشتن از سایت ──────────────────────────────────────────────────
console.log('۲) نوشتنِ نظر از صفحه‌یِ کالا');
await page.setCookie({ name: 'set_customer_token', value: customerToken, domain: '127.0.0.1', path: '/' });
await page.goto(`${B}/products/powerbank-20000`, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const hasSection = await page.$('#reviews');
hasSection ? ok('بخشِ نظرها در صفحه هست') : bad('بخشِ نظرها نیامد');

// متن یکتا برایِ هر اجرا: اگر اجرایی در میانه بشکند و نظری جا بگذارد،
// اجرایِ بعدی آن را با نظرِ خودش اشتباه نمی‌گیرد.
const stamp = Date.now().toString().slice(-6);
const body = `باتری واقعاً بیست هزار است و دو گوشی را هم‌زمان شارژ می‌کند [${stamp}]`;
await page.type('.rv__form textarea', body);
await page.evaluate(() => {
  const stars = [...document.querySelectorAll('.rv__star')];
  stars[4]?.click(); // پنج ستاره
});
await page.evaluate(() => {
  [...document.querySelectorAll('.rv__form button')].find((b) => b.textContent.includes('فرستادن'))?.click();
});
await new Promise((r) => setTimeout(r, 2500));
const alert = await page.$eval('.rv__form .alert', (e) => e.textContent.trim()).catch(() => null);
alert && alert.includes('ثبت شد') ? ok('نظر ثبت شد: ' + alert.slice(0, 60)) : bad('ثبت نشد: ' + alert);

// ── ۳) پیش از تأیید پیدا نیست ─────────────────────────────────────────────
console.log('۳) پیش از تأیید رویِ سایت نیست');
await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));
const hidden = await page.evaluate((t) => !document.body.textContent.includes(t), body.slice(0, 40));
hidden ? ok('در انتظار است و دیده نمی‌شود') : bad('پیش از تأیید نمایش داده شد!');

// ── ۴) پنل: انتشار و پاسخ ─────────────────────────────────────────────────
console.log('۴) پنل: انتشار و پاسخ');
await page.goto(`${B}/admin/login`, { waitUntil: 'domcontentloaded' });
await page.type('input[name=mobile]', '09120000000');
await page.type('input[name=password]', 'SetShop-1405!');
await page.click('button[type=submit]');
try { await page.waitForFunction(() => !location.pathname.startsWith('/admin/login'), { timeout: 20000 }); } catch {}
await page.goto(`${B}/admin/reviews`, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const panelHas = await page.evaluate((t) => document.body.textContent.includes(t), body.slice(0, 30));
panelHas ? ok('در صفِ بررسیِ پنل آمد') : bad('در پنل نیامد');

await page.evaluate(() => {
  const card = document.querySelector('.card');
  [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'انتشار')?.click();
});
await new Promise((r) => setTimeout(r, 2500));
// پس از انتشار، نظر از صفِ «در انتظار» بیرون می‌رود — همان رفتاری که
// می‌خواهیم؛ پس باید در فیلترِ «منتشرشده» دنبالش بگردیم.
const queueEmpty = await page.evaluate(() => document.body.textContent.includes('همه‌یِ نظرها بررسی شده‌اند'));
queueEmpty ? ok('از صفِ بررسی رفت') : bad('پس از انتشار در صف ماند');

await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('منتشرشده'))?.click();
});
await new Promise((r) => setTimeout(r, 2000));
const published = await page.evaluate(() => {
  const c = document.querySelector('.card');
  return c ? [...c.querySelectorAll('.pill')].some((p) => p.textContent.includes('منتشرشده')) : false;
});
published ? ok('در فهرستِ «منتشرشده» نشست') : bad('منتشر نشد');

// پاسخ
await page.evaluate(() => {
  const c = document.querySelector('.card');
  [...c.querySelectorAll('button')].find((b) => b.textContent.includes('پاسخ'))?.click();
});
await new Promise((r) => setTimeout(r, 800));
await page.type('.card textarea', 'سپاس از شما؛ ظرفیتِ واقعیِ این مدل با برچسبش یکی است.');
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ثبتِ پاسخ')?.click();
});
await new Promise((r) => setTimeout(r, 2500));
const replied = await page.evaluate(() => document.body.textContent.includes('سپاس از شما'));
replied ? ok('پاسخ ثبت شد') : bad('پاسخ ثبت نشد');

// ── ۵) رویِ سایت: متن، نشان و پاسخ ────────────────────────────────────────
console.log('۵) رویِ صفحه‌یِ کالا');
await page.goto(`${B}/products/powerbank-20000`, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const shown = await page.evaluate((t) => document.body.textContent.includes(t), body.slice(0, 40));
shown ? ok('نظر رویِ سایت آمد') : bad('روی سایت نیامد');
const badge = await page.evaluate(() => document.body.textContent.includes('خریدِ تأییدشده'));
badge ? ok('نشانِ «خریدِ تأییدشده» دیده می‌شود') : bad('نشان نیامد');
const reply = await page.evaluate(() => document.body.textContent.includes('پاسخِ فروشگاه'));
reply ? ok('پاسخِ فروشگاه زیرِ نظر است') : bad('پاسخ دیده نشد');
const avg = await page.$eval('.rv__score-num', (e) => e.textContent.trim()).catch(() => null);
avg ? ok(`میانگینِ کالا: ${avg}`) : bad('میانگین نمایش داده نشد');

// ── ۶) رأی دادن ───────────────────────────────────────────────────────────
console.log('۶) رأیِ «مفید بود»');
const before = await page.$eval('.rv__thumb .num', (e) => e.textContent.trim()).catch(() => '۰');
await page.click('.rv__thumb');
await new Promise((r) => setTimeout(r, 2000));
const after = await page.$eval('.rv__thumb .num', (e) => e.textContent.trim()).catch(() => '۰');
after !== before ? ok(`شمارنده عوض شد: ${before} → ${after}`) : bad(`شمارنده عوض نشد (${before})`);

// ── ۷) پاک‌سازی: آنچه ساختیم برمی‌داریم تا فروشگاه تمیز بماند ───────────────
console.log('۷) پاک‌سازی');
try {
  psql(`DELETE FROM product_review_votes WHERE review_id IN (SELECT id FROM product_reviews WHERE product_id = '${productId}')`);
  psql(`DELETE FROM product_reviews WHERE product_id = '${productId}'`);
  psql(`DELETE FROM order_items WHERE order_id = '${orderId}'`);
  psql(`DELETE FROM orders WHERE id = '${orderId}'`);
  psql(`DELETE FROM customer_sessions WHERE customer_id IN (SELECT id FROM customers WHERE phone = '${phone}')`);
  psql(`DELETE FROM customers WHERE phone = '${phone}'`);
  ok('همه چیزِ آزمون پاک شد');
} catch (e) {
  bad('پاک‌سازی ناقص ماند: ' + String(e).slice(0, 80));
}

console.log('۸) خطایِ جاوااسکریپت:', errors.length === 0 ? 'هیچ ✅' : errors.join(' | '));
await browser.close();
console.log(process.exitCode ? '\n💥 تمرین ناقص ماند' : '\n🎉 گام‌به‌گام درست بود');
