#!/usr/bin/env node
/**
 * سنجهٔ سوّرِ جستجو — «میلی‌ثانیهٔ سرویس»، نه «میلی‌ثانیهٔ شبکه».
 *
 * چرا ابزارِ جدا از آزمونِ بار؟ چون آزمونِ بار «تجربهٔ خریدار» را می‌سنجد
 * (با رندر و شبکه و مهارِ نرخ)، ولی برایِ داوریِ یک تغییرِ سمتِ سرویس باید
 * همان `tookMs`ِ خودِ API را دید — وگرنه سودِ چند میلی‌ثانیه‌ای در نویزِ
 * رندرِ نکست گم می‌شود (و بدتر: عددی که در مستندات می‌نویسم باید معلوم باشد
 * از کجا آمده).
 *
 * دو حالت که فرقِ «کم‌کردنِ کارِ زائدِ هر درخواست» از «خوردنِ کش» را جدا می‌کند:
 *   --mode hot     همان چند عبارتِ پرتکرار (۸۰٪ِ ترافیکِ واقعی یک فروشگاه)
 *   --mode unique  هر درخواست یک عبارتِ تازه (هیچ کشی جواب نمی‌دهد)
 *
 * اجرا:
 *   node scripts/measure-search.mjs --requests 200 --mode hot
 *   API=http://127.0.0.1:3000 INTERNAL_API_TOKEN=… node scripts/measure-search.mjs
 */
import http from 'node:http';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const inline = hit.split('=')[1];
  if (inline !== undefined) return inline;
  return process.argv[process.argv.indexOf(hit) + 1] ?? fallback;
}

const API = String(arg('api', process.env.API ?? 'http://127.0.0.1:3000')).replace(/\/$/, '');
const N = Math.max(1, Number(arg('requests', 200)));
const MODE = String(arg('mode', 'hot'));
const TOKEN = process.env.INTERNAL_API_TOKEN ?? '';
const WORDS = ['شارژر', 'کابل', 'هدفون', 'پاوربانک', 'گلس', 'کیف', 'قاب', 'اسپیکر', 'موس', 'کیبورد'];

const url = (i) => {
  const q = MODE === 'unique' ? `${WORDS[i % WORDS.length]} ${1000 + i}` : WORDS[i % WORDS.length];
  return `${API}/catalog/search?q=${encodeURIComponent(q)}&limit=24`;
};

function one(i) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get(url(i), { headers: TOKEN ? { 'x-set-internal': TOKEN } : {} }, (res) => {
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
          took: json?.tookMs ?? null,
          cached: json?.cached === true,
          total: json?.total ?? null,
        });
      });
    });
    req.on('error', (err) => resolve({ ok: false, status: 0, wall: Date.now() - started, error: err.code }));
    req.setTimeout(20_000, () => req.destroy(new Error('timeout')));
  });
}

const out = [];
for (let i = 0; i < N; i++) out.push(await one(i));

const p = (list, q) => (list.length ? list[Math.floor((list.length - 1) * q)] : 0);
const took = out.map((o) => o.took).filter((v) => typeof v === 'number').sort((a, b) => a - b);
const wall = out.map((o) => o.wall).sort((a, b) => a - b);
const avg = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);
const cached = out.filter((o) => o.cached).length;
const errors = out.filter((o) => !o.ok);

console.log(
  JSON.stringify(
    {
      mode: MODE,
      requests: out.length,
      errors: errors.length,
      firstError: errors[0] ? `${errors[0].status} ${errors[0].error ?? ''}`.trim() : null,
      results: out[0]?.total ?? null,
      serviceMs: { avg: +avg(took).toFixed(2), p50: p(took, 0.5), p95: p(took, 0.95), max: took.at(-1) ?? 0 },
      wallMs: { avg: +avg(wall).toFixed(2), p50: p(wall, 0.5), p95: p(wall, 0.95) },
      fromCache: cached,
      cacheRate: +((cached / out.length) * 100).toFixed(1),
    },
    null,
    1,
  ),
);
