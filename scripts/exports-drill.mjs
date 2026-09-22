#!/usr/bin/env node
/**
 * تمرینِ خروجی‌هایِ رسمی — همان راهی که مدیر و فروشنده می‌روند.
 *
 * آزمایشِ واحد می‌گوید «پرونده درست ساخته می‌شود»؛ این تمرین می‌گوید
 * **سامانه** درست تحویل می‌دهد: مرورگر با یک کوکیِ httpOnly (نه با توکنی در
 * دستِ جاوااسکریپت) پرونده را از راهِ وب می‌گیرد؛ نامِ پرونده درست است؛ نوعِ
 * پرونده درست است؛ حسابدار سودِ ناخالص را می‌گیرد و فروشنده نه؛ و بی‌نشست
 * هیچ چیز بیرون نمی‌رود.
 *
 * چرا از راهِ وب (:3100) و نه مستقیم از API (:3000)؟
 *   چون آنچه ممکن است بشکند، خودِ API نیست — **راهِ رسیدن به آن** است:
 *   میان‌افزار باید توکن را از کوکی بخواند و بازنویسیِ /api/* باید آن را به
 *   مسیرِ درست ببرد. آزمایشِ مستقیمِ API این لایه را نمی‌بیند.
 *
 * اجرا:
 *   node scripts/exports-drill.mjs
 *   (وب روی ۳۱۰۰ و API روی ۳۰۰۰ باید بالا باشند)
 */

const WEB = process.env.WEB_BASE ?? 'http://127.0.0.1:3100';
const API = process.env.API_BASE ?? 'http://127.0.0.1:3000';

const ADMIN = { mobile: '09120000000', password: 'SetShop-1405!' };
const SELLER = { mobile: '09120000001', password: 'SetShop@1404' };

let failures = 0;
function check(label, ok, extra = '') {
  const mark = ok ? '✅' : '❌';
  if (!ok) failures += 1;
  console.log(`${mark} ${label}${extra ? ` — ${extra}` : ''}`);
}

async function login(who) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(who),
  });
  const data = await res.json();
  return data?.accessToken ?? null;
}

/** دریافتِ پرونده از راهِ مرورگر: فقط کوکی، بی‌هیچ توکنی در دستِ جاوااسکریپت */
async function downloadAs(token, path) {
  const res = await fetch(`${WEB}${path}`, {
    headers: token ? { cookie: `set_admin_token=${token}` } : {},
  });
  const type = res.headers.get('content-type') ?? '';
  const disposition = res.headers.get('content-disposition') ?? '';
  const body = type.includes('json') ? await res.text() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, type, disposition, body };
}

/** نامِ پرونده از سربرگ — با ترجیحِ میدانِ یوتی‌اف‌هشت (فارسیِ درست) */
function fileNameOf(disposition) {
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }
  return /filename="([^"]+)"/i.exec(disposition)?.[1] ?? '';
}

async function main() {
  console.log('── تمرینِ خروجی‌هایِ رسمی ──\n');

  const adminToken = await login(ADMIN);
  const sellerToken = await login(SELLER);
  check('ورودِ مدیر و فروشنده', Boolean(adminToken && sellerToken));
  if (!adminToken || !sellerToken) {
    console.log('ورود نشد؛ تمرین متوقف شد.');
    process.exit(1);
  }

  // ۱) فهرستِ خروجی‌ها از راهِ وب
  const manifest = await downloadAs(adminToken, '/api/admin/exports/manifest');
  const items = JSON.parse(String(manifest.body)).items ?? [];
  check('فهرستِ خروجی‌ها از راهِ مرورگر', manifest.status === 200 && items.length >= 5,
    `${items.length} خروجی`);

  // ۲) هر خروجی با قالب‌هایش — از راهِ مرورگر
  const seen = [];
  for (const item of items) {
    for (const format of item.formats) {
      const res = await downloadAs(adminToken, `/api/admin/exports/${item.key}.${format}?from=1405/01/01`);
      const name = fileNameOf(res.disposition);
      const kind =
        format === 'xlsx' ? 'spreadsheetml' : 'pdf';
      const ok =
        res.status === 200 &&
        res.type.includes(kind) &&
        Buffer.isBuffer(res.body) &&
        res.body.length > 1000 &&
        /^[\w\-.]+$/.test(name);
      if (!ok) {
        check(`${item.label} (${format})`, false, `${res.status} ${res.type} ${name} ${res.body.length ?? 0} بایت`);
      } else {
        seen.push(`${name} (${res.body.length} بایت)`);
      }
    }
  }
  check('همه‌یِ خروجی‌ها با نوع و نامِ درست', seen.length === items.reduce((n, i) => n + i.formats.length, 0),
    `${seen.length} پرونده`);
  console.log(`   ${seen.join(' · ')}`);

  // ۳) امضایِ پرونده: اکسل باید «زیپ» باشد (PK) و پی‌دی‌اف «%PDF»
  const xlsx = await downloadAs(adminToken, '/api/admin/exports/orders.xlsx?from=1405/01/01');
  const pdf = await downloadAs(adminToken, '/api/admin/exports/orders.pdf?from=1405/01/01');
  check('امضایِ اکسل درست است (زیپ)', xlsx.body.slice(0, 2).toString() === 'PK');
  check('امضایِ پی‌دی‌اف درست است', pdf.body.slice(0, 4).toString() === '%PDF');

  // ۴) صافی اثر دارد: امسال در برابرِ سالِ پیش
  const wide = await downloadAs(adminToken, '/api/admin/exports/orders.xlsx?from=1405/01/01');
  const narrow = await downloadAs(adminToken, '/api/admin/exports/orders.xlsx?from=1405/06/20&to=1405/06/27');
  check('صافیِ بازه اثر دارد', wide.body.length !== narrow.body.length,
    `${wide.body.length} در برابرِ ${narrow.body.length} بایت`);

  // ۵) فاکتورِ تک‌سفارش، با نامِ فارسی
  const list = await (async () => {
    const res = await fetch(`${API}/admin/orders?limit=1&offset=0`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    return (await res.json()).items ?? [];
  })();
  if (list.length === 0) {
    check('سفارشی برایِ فاکتور یافت شد', false, 'پایگاه خالی است؛ scripts/seed-orders.ts را اجرا کن');
  } else {
    const invoice = await downloadAs(adminToken, `/api/admin/exports/orders/${list[0].id}/invoice.pdf`);
    const name = fileNameOf(invoice.disposition);
    check('فاکتور با نامِ فارسی و شماره‌یِ سفارش',
      invoice.status === 200 && name.includes('فاکتور') && name.endsWith('.pdf'), name);

    // ۶) دسترسی: فروشنده فاکتور دارد، سودِ ناخالص نه
    const sellerInvoice = await downloadAs(sellerToken, `/api/admin/exports/orders/${list[0].id}/invoice.pdf`);
    check('فروشنده فاکتورِ سفارش را می‌گیرد', sellerInvoice.status === 200, String(sellerInvoice.status));
  }

  const sellerProfit = await downloadAs(sellerToken, '/api/admin/exports/gross-profit.xlsx?from=1405/01/01');
  check('فروشنده به سودِ ناخالص نمی‌رسد (۴۰۳)', sellerProfit.status === 403, String(sellerProfit.status));

  const adminProfit = await downloadAs(adminToken, '/api/admin/exports/gross-profit.xlsx?from=1405/01/01&groupBy=brand');
  check('مدیر سودِ ناخالص را با گروه‌بندی می‌گیرد', adminProfit.status === 200, String(adminProfit.status));

  // ۷) بی‌نشست: خطا، آن هم «جی‌سان» نه برگه‌یِ ورود
  const anonymous = await downloadAs(null, '/api/admin/exports/orders.xlsx');
  check('بی‌نشست: ۴۰۱ و جی‌سان (نه تغییرمسیر به ورود)',
    anonymous.status === 401 && anonymous.type.includes('json'), `${anonymous.status} ${anonymous.type}`);

  console.log(`\n${failures === 0 ? '✅ تمرینِ خروجی‌ها سبز شد' : `❌ ${failures} مورد نیاز به بررسی دارد`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
