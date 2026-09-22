/**
 * ریزبینیِ یک صفحه: چه بخش‌هایی دارد، کدام منبع خطا می‌دهد، و سبکِ
 * هر عنصرِ کلیدی چیست. برای وقتی که ممیزی چیزی را «مشکل» گزارش کرده
 * و باید دلیلش را دید.
 *
 * استفاده: node scripts/inspect-page.js "/" [عرض]
 */

import puppeteer from 'puppeteer-core';

const BASE = process.env.SITE_URL ?? 'http://127.0.0.1:3100';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/chromium';
const path = process.argv[2] ?? '/';
const width = Number(process.argv[3] ?? 1280);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});

const page = await browser.newPage();
await page.setViewport({ width, height: 900 });

const failed = [];
const ignorable = (u) => u.includes('_rsc=');
page.on('requestfailed', (r) => {
  if (!ignorable(r.url())) failed.push(`FAIL ${r.url().slice(0, 110)} — ${r.failure()?.errorText}`);
});
page.on('response', (r) => {
  if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 110)}`);
});

await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 30000 });

const info = await page.evaluate(() => {
  const out = { sections: [], styles: {}, fonts: [] };

  document.querySelectorAll('section, header, footer, nav').forEach((el) => {
    const heading = el.querySelector('h1,h2,h3');
    const r = el.getBoundingClientRect();
    out.sections.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 60),
      heading: heading ? (heading.textContent ?? '').trim().slice(0, 50) : null,
      height: Math.round(r.height),
      top: Math.round(r.top + window.scrollY),
    });
  });

  const probe = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      color: cs.color,
      background: cs.backgroundColor,
      backgroundImage: cs.backgroundImage.slice(0, 90),
      webkitTextFill: cs.webkitTextFillColor,
      backgroundClip: cs.webkitBackgroundClip || cs.backgroundClip,
      font: cs.fontFamily.slice(0, 40),
      size: `${Math.round(r.width)}×${Math.round(r.height)}`,
    };
  };

  out.styles = {
    h1: probe('h1'),
    heroTitle: probe('.hero__title'),
    body: probe('body'),
    firstCard: probe('[class*="card"]'),
  };

  out.fonts = Array.from(document.fonts).map((f) => `${f.family} ${f.weight} ${f.status}`).slice(0, 8);

  return out;
});

console.log(`\n=== ${path} در ${width}px`);
console.log('\nبخش‌ها:');
for (const s of info.sections) {
  console.log(`  ${s.tag}.${s.cls} — ارتفاع ${s.height} @ ${s.top}${s.heading ? ` — «${s.heading}»` : ''}`);
}
console.log('\nسبک‌ها:');
for (const [k, v] of Object.entries(info.styles)) {
  console.log(`  ${k}: ${v ? JSON.stringify(v) : '—'}`);
}
console.log('\nفونت‌ها:', info.fonts.join(' | ') || '—');
console.log('\nمنابعِ خطادار:');
console.log(failed.length ? failed.map((f) => '  ' + f).join('\n') : '  هیچ');

await browser.close();
