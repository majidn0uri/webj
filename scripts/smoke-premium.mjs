/**
 * مرورگر واقعی، با دادهٔ محیط آزمایشی خودتان؛ حساب یا نشست جعلی نمی‌سازد.
 * WEB_URL، BROWSER_EXECUTABLE_PATH، ADMIN_MOBILE و ADMIN_PASSWORD از محیط.
 * اجرا: node scripts/smoke-premium.mjs (وب و API باید از پیش روشن باشند).
 */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const required = ['WEB_URL', 'BROWSER_EXECUTABLE_PATH', 'ADMIN_MOBILE', 'ADMIN_PASSWORD'];
for (const name of required) assert.ok(process.env[name], `${name} is required`);
const origin = process.env.WEB_URL;
const browser = await puppeteer.launch({
  executablePath: process.env.BROWSER_EXECUTABLE_PATH,
  headless: true,
  pipe: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', ...(process.env.BROWSER_EXTRA_ARGS?.split(' ').filter(Boolean) ?? [])],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const routes = ['/', '/search', '/cart', '/account', '/admin', '/admin/products', '/admin/orders', '/admin/settings',
  '/admin/inventory', '/admin/accounting', '/admin/procurement', '/admin/returns',
  '/admin/crm', '/admin/crm/tags', '/admin/crm/segments', '/admin/reports'];
try {
  await page.goto(`${origin}/admin/login`, { waitUntil: 'networkidle0' });
  await page.type('input[name="mobile"]', process.env.ADMIN_MOBILE);
  await page.type('input[name="password"]', process.env.ADMIN_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]'),
  ]);
  assert.equal(new URL(page.url()).pathname, '/admin', 'Admin login must succeed');
  for (const width of [360, 768, 1440]) {
    await page.setViewport({ width, height: 900 });
    for (const route of routes) {
      const response = await page.goto(`${origin}${route}`, { waitUntil: 'networkidle0', timeout: 60_000 });
      assert.equal(response.status(), 200, `${route} must render`);
      assert.equal(new URL(page.url()).pathname, route, `${route} must not silently redirect`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, `${route} overflows at ${width}px`);
      console.info(`PASS ${width}px ${route}`);
    }
  }
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${origin}/admin`, { waitUntil: 'networkidle0' });
  await page.click('.admin-navigation__toggle');
  assert.equal(await page.$eval('.admin-navigation__toggle', (el) => el.getAttribute('aria-expanded')), 'true');
  await page.type('.admin-nav-search input', 'کالا');
  const labels = await page.$$eval('.nav__item', (els) => els.map((el) => el.textContent));
  assert.ok(labels.length > 0 && labels.every((text) => text.includes('کالا')));
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('.admin-navigation__toggle', (el) => el.getAttribute('aria-expanded')), 'false');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.info(`PASS mobile navigation, search, Escape; ${routes.length * 3} responsive route checks`);
} finally {
  await browser.close();
}
