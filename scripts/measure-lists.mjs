#!/usr/bin/env node
/**
 * سنجهٔ فهرست‌هایِ کاتالوگ — «دسته‌ها، برندها، دستگاه‌ها، رنگ‌ها».
 *
 * چرا این چهار تا؟ چون هر کدام در **هر** بازدیدِ ویترین خوانده می‌شود (منوی
 * دسته‌ها، فیلترِ برند، انتخابگرِ «گوشی شما چیست؟»، فیلترِ رنگ) و چون نتیجهٔ
 * آن‌ها فقط با نوشتنِ فروشنده عوض می‌شود — یعنی دقیقاً همان شکلِ پرسشی که کش
 * برایِ آن ساخته شده است (همان قرارداد `search_cache_seconds`).
 *
 * قبل/بعدِ کش چه را می‌سنجیم؟
 *   • `wallMs` — زمانِ کلِ درخواست (همیشه قابلِ اندازه‌گیری است، حتی بی‌کش).
 *   • `serviceMs` + `cached` — فقط وقتی خودِ پاسخ `tookMs`/`cached` داشته باشد
 *     (پس از کش)؛ در اندازه‌گیریِ «قبل» این دو صفر/صفر می‌شوند و عددِ قابلِ
 *     مقایسه `wallMs` است.
 *
 * اجرا:
 *   node scripts/measure-lists.mjs --rounds 150 --json var/list-before.json
 *   API=http://127.0.0.1:3000 node scripts/measure-lists.mjs
 */
import http from 'node:http';
import { writeFileSync } from 'node:fs';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const inline = hit.split('=')[1];
  if (inline !== undefined) return inline;
  return process.argv[process.argv.indexOf(hit) + 1] ?? fallback;
}

const API = String(arg('api', process.env.API ?? 'http://127.0.0.1:3000')).replace(/\/$/, '');
const ROUNDS = Math.max(1, Number(arg('rounds', 150)));
const OUT = arg('json', null);
const TOKEN = process.env.INTERNAL_API_TOKEN ?? '';

/** هر دور، هر چهار فهرست یک‌بار — همان کارکردی که یک صفحهٔ ویترین انجام می‌دهد */
const ENDPOINTS = [
  { name: 'categories', path: '/categories' },
  { name: 'brands', path: '/catalog/brands' },
  { name: 'devices', path: '/catalog/devices' },
  { name: 'colours', path: '/catalog/colours' },
];

function one(ep) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get(`${API}${ep.path}`, { headers: TOKEN ? { 'x-set-internal': TOKEN } : {} }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({
          ok: res.statusCode < 400,
          status: res.statusCode,
          wall: Date.now() - started,
          took: typeof json?.tookMs === 'number' ? json.tookMs : null,
          cached: json?.cached === true,
          cacheAge: typeof json?.cacheAgeMs === 'number' ? json.cacheAgeMs : null,
          error: json?.message ?? null,
        });
      });
    });
    req.on('error', (err) => resolve({ ok: false, status: 0, wall: Date.now() - started, error: err.code }));
    req.setTimeout(20_000, () => req.destroy(new Error('timeout')));
  });
}

/** گرم‌کردن: دو دورِ بی‌صدا تا تأخیرِ نخستینِ رندر/اتصال رویِ همهٔ نقاط بیفتد */
for (let i = 0; i < 2; i++) {
  await Promise.all(ENDPOINTS.map((ep) => one(ep)));
}

const per = Object.fromEntries(ENDPOINTS.map((ep) => [ep.name, []]));
for (let i = 0; i < ROUNDS; i++) {
  const batch = await Promise.all(ENDPOINTS.map((ep) => one(ep)));
  batch.forEach((o, k) => per[ENDPOINTS[k].name].push(o));
}

const p = (list, q) => (list.length ? list[Math.floor((list.length - 1) * q)] : 0);
const avg = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);

const summary = {
  rounds: ROUNDS,
  endpoints: Object.fromEntries(
    Object.entries(per).map(([name, out]) => {
      const wall = out.map((o) => o.wall).sort((a, b) => a - b);
      const took = out.map((o) => o.took).filter((v) => typeof v === 'number').sort((a, b) => a - b);
      const errors = out.filter((o) => !o.ok);
      const cached = out.filter((o) => o.cached).length;
      return [
        name,
        {
          requests: out.length,
        errors: errors.length,
        firstError: errors[0] ? `${errors[0].status} ${errors[0].error ?? ''}`.trim() : null,
        wallMs: { avg: +avg(wall).toFixed(2), p50: p(wall, 0.5), p95: p(wall, 0.95), max: wall.at(-1) ?? 0 },
          serviceMs: took.length ? { avg: +avg(took).toFixed(2), p50: p(took, 0.5), p95: p(took, 0.95), max: took.at(-1) ?? 0 } : null,
          fromCache: cached,
          cacheRate: +((cached / out.length) * 100).toFixed(1),
        },
      ];
    }),
  ),
};

if (OUT) {
  writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.error(`→ ${OUT}`);
}
console.log(JSON.stringify(summary, null, 1));
