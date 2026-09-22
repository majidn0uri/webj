#!/usr/bin/env node
/**
 * تمرینِ مهارِ بار و دیده‌بانی — همان راهی که مدیر و مهاجم می‌روند.
 *
 * آزمایشِ واحد می‌گوید «شمارنده درست می‌شمارد»؛ این تمرین می‌گوید
 * **سامانه** درست مهار می‌کند: سقف از پنل تغییر می‌کند و همان لحظه اِعمال
 * می‌شود، درخواستِ اضافه با ۴۲۹ و «چند ثانیه‌یِ دیگر» برمی‌گردد، تماسِ
 * درونیِ وب از سقفِ حاشیه‌ای معاف است، مسدودشدن در پایگاه ثبت می‌شود و با
 * «آزادسازی» درِ بسته باز می‌گردد.
 *
 * هرچه این تمرین تغییر می‌دهد، در پایان به حالتِ پیشین برمی‌گرداند — حتی
 * اگر در میانه خطا بیفتد (بخشِ finally).
 *
 * اجرا:
 *   INTERNAL_API_TOKEN="$(cat ~/var/internal-api-token)" node scripts/rate-limit-drill.mjs
 */

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000';
const INTERNAL = process.env.INTERNAL_API_TOKEN ?? '';

let failures = 0;
function check(label, ok, extra = '') {
  const mark = ok ? '✅' : '❌';
  if (!ok) failures += 1;
  console.log(`${mark} ${label}${extra ? ` — ${extra}` : ''}`);
}

async function call(method, path, { body, token, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return {
    status: res.status,
    data,
    headers: {
      retryAfter: res.headers.get('retry-after'),
      remaining: res.headers.get('x-ratelimit-remaining'),
      traceId: res.headers.get('x-trace-id'),
    },
  };
}

/** چند درخواستِ پیاپی — برایِ رسیدن به سقف */
async function hammer(times, method, path, options = {}) {
  const out = [];
  for (let i = 0; i < times; i += 1) out.push(await call(method, path, options));
  return out;
}

async function main() {
  console.log('── تمرینِ مهارِ بار و دیده‌بانی ──\n');

  // ۱) ورود به پنل
  const login = await call('POST', '/auth/login', {
    body: {
      mobile: process.env.ADMIN_MOBILE ?? '09120000000',
      password: process.env.ADMIN_PASSWORD ?? 'SetShop-1405!',
    },
  });
  const token = login.data?.accessToken ?? login.data?.token ?? null;
  check('ورودِ مدیر', Boolean(token), token ? '' : `وضعیت ${login.status}`);
  if (!token) process.exit(1);

  // ۲) دیدنِ سقف‌ها از پنل
  const before = await call('GET', '/admin/observability/limits', { token });
  const rules = before.data?.items ?? [];
  check('دیدنِ سقف‌ها از پنل', rules.length >= 8, `${rules.length} قاعده`);
  check('مهارِ بار روشن است', before.data?.enabled === true);

  const original = Object.fromEntries(
    rules.map((r) => [r.name, { maxRequests: r.maxRequests, windowSeconds: r.windowSeconds, isEnabled: r.isEnabled }]),
  );

  try {
    // ۳) سقفِ جستجو را از پنل بسیار کم می‌کنیم — بی‌راه‌اندازیِ دوباره
    const tightened = await call('PATCH', '/admin/observability/limits/search', {
      token,
      body: { maxRequests: 3, windowSeconds: 60 },
    });
    check('تغییرِ سقف از پنل', tightened.status === 200, `وضعیت ${tightened.status}`);

    const hits = await hammer(6, 'GET', '/catalog/search?q=قاب');
    const ok = hits.filter((h) => h.status === 429).length;
    const blocked = hits.filter((h) => h.status === 429);
    check('سه درخواستِ نخست گذشت و بقیه بسته شد', hits.slice(0, 3).every((h) => h.status === 200) && ok === 3,
      `${hits.map((h) => h.status).join('، ')}`);
    check('پاسخِ ۴۲۹ «چند ثانیه‌یِ دیگر» دارد', Number(blocked[0]?.headers.retryAfter ?? 0) > 0,
      `retry-after=${blocked[0]?.headers.retryAfter}`);
    check('پاسخِ مسدود پیامِ فارسی و شناسه‌یِ ردیابی دارد',
      Boolean(blocked[0]?.data?.error?.traceId) && /ثانیه/.test(blocked[0]?.data?.error?.message ?? ''),
      blocked[0]?.data?.error?.message ?? '');

    // ۴) تماسِ درونیِ وب از سقفِ حاشیه‌ای معاف است
    if (INTERNAL) {
      const internalHits = await hammer(5, 'GET', '/catalog/search?q=قاب', {
        headers: { 'x-set-internal': INTERNAL },
      });
      check('تماسِ درونیِ وب بسته نشد (سقفِ حاشیه‌ای)',
        internalHits.every((h) => h.status === 200),
        `${internalHits.map((h) => h.status).join('، ')}`);
    } else {
      console.log('⚠️  INTERNAL_API_TOKEN تعیین نشده — ردیفِ «تماسِ درونی» بررسی نشد');
    }

    // ۵) قاعده‌یِ پایگاهی (کوپن): مسدودشدن در پایگاه ثبت می‌شود
    await call('PATCH', '/admin/observability/limits/coupon.validate', {
      token,
      body: { maxRequests: 2, windowSeconds: 600 },
    });
    await call('POST', '/admin/observability/limits/coupon.validate/release', { token, body: {} });
    const couponHits = await hammer(4, 'POST', '/shop/coupons/validate', {
      body: { code: 'نیست' },
      token,
    });
    check('قاعده‌یِ پایگاهی هم مهار می‌کند',
      couponHits.filter((h) => h.status === 429).length === 2,
      `${couponHits.map((h) => h.status).join('، ')}`);

    const withEvents = await call('GET', '/admin/observability/limits', { token });
    const rows = withEvents.data?.blocked ?? [];
    check('مسدودشدن در پایگاه ثبت شد و در پنل دیده می‌شود',
      rows.some((r) => r.ruleName === 'coupon.validate'),
      `${rows.length} ردیف، آخرین: ${rows[0]?.ruleName ?? '—'} (${rows[0]?.seen ?? 0} بار)`);

    // ۶) آزادسازی: درِ بسته باز می‌شود
    const released = await call('POST', '/admin/observability/limits/coupon.validate/release', {
      token,
      body: {},
    });
    check('آزادسازی، شمارنده‌ها را پاک کرد', Number(released.data?.released ?? 0) > 0,
      `${released.data?.released ?? 0} سطل`);
    const afterRelease = await call('POST', '/shop/coupons/validate', {
      body: { code: 'نیست' },
      token,
    });
    check('پس از آزادسازی دوباره می‌شود درخواست فرستاد', afterRelease.status !== 429,
      `وضعیت ${afterRelease.status}`);

    // ۷) آمار: سامانه چیزی برایِ گفتن دارد
    const metrics = await call('GET', '/admin/observability/metrics', { token });
    const traffic = metrics.data?.traffic;
    check('آمارِ ترافیک گردآوری شده', (traffic?.totals.requests ?? 0) > 0,
      `${traffic?.totals.requests ?? 0} درخواست`);
    check('کندترین مسیرها با صدکِ ۹۵ گزارش می‌شوند',
      (traffic?.slowestRoutes ?? []).length > 0,
      traffic?.slowestRoutes?.[0] ? `${traffic.slowestRoutes[0].route} → ${traffic.slowestRoutes[0].p95Ms} میلی‌ثانیه` : '');
    check('حافظه و زمانِ کار هم گزارش می‌شوند',
      (metrics.data?.process?.rssMb ?? 0) > 0,
      `${metrics.data?.process?.rssMb} مگابایت، فشار: ${metrics.data?.process?.memoryPressure}`);

    // ۸) کلیدِ اضطراری: خاموشیِ سراسری
    const off = await call('PATCH', '/admin/observability/limits', { token, body: { enabled: false } });
    check('خاموش کردنِ اضطراری پذیرفته شد', off.data?.enabled === false);
    await call('POST', '/admin/observability/limits/search/release', { token, body: {} });
    const freeHits = await hammer(5, 'GET', '/catalog/search?q=قاب');
    check('با مهارِ خاموش، هیچ سقفی نیست', freeHits.every((h) => h.status === 200),
      `${freeHits.map((h) => h.status).join('، ')}`);
    await call('PATCH', '/admin/observability/limits', { token, body: { enabled: true } });
  } finally {
    // ۹) بازگردانیِ سقف‌ها — حتی اگر در میانه خطا افتاده باشد
    for (const [name, value] of Object.entries(original)) {
      await call('PATCH', `/admin/observability/limits/${name}`, { token, body: value });
    }
    const restored = await call('GET', '/admin/observability/limits', { token });
    const same = (restored.data?.items ?? []).every(
      (r) => original[r.name] && original[r.name].maxRequests === r.maxRequests,
    );
    check('سقف‌ها به حالتِ پیشین برگشتند', same);
    console.log('\n(سقفِ جستجو و کوپن در پایان به مقدارِ اصلی برگردانده شد)');
  }

  console.log(`\n${failures === 0 ? '✅ تمرینِ مهارِ بار و دیده‌بانی سبز شد' : `❌ ${failures} مورد نیاز به بررسی دارد`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
