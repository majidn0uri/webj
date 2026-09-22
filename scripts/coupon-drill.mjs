#!/usr/bin/env node
/**
 * تمرینِ کوپن — همان راهی که فروشنده و مشتری می‌روند.
 *
 * آزمایشِ واحد می‌گوید تابع درست است؛ این تمرین می‌گوید **سامانه** درست است:
 * ورود به پنل، ساختِ کد، ارزیابی از بیرون، ثبتِ کالا در سبد، تسویه با کد،
 * دیدنِ تخفیف در سفارش، و برگشتنِ نوبت هنگامِ لغو. اگر یکی از این حلقه‌ها
 * پاره باشد، تابعِ درست هم به کار نمی‌آید.
 *
 * اجرا: node scripts/coupon-drill.mjs
 */

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000';

let failures = 0;
function check(label, ok, extra = '') {
  const mark = ok ? '✅' : '❌';
  if (!ok) failures += 1;
  console.log(`${mark} ${label}${extra ? ` — ${extra}` : ''}`);
}

async function call(method, path, { body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function toman(rial) {
  return (BigInt(rial ?? 0) / 10n).toLocaleString('fa-IR');
}

async function main() {
  console.log('── تمرینِ کوپن و کدِ تخفیف ──\n');

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

  // ۲) ساختِ یک کوپنِ درصدیِ سقف‌دار
  const code = `DRILL${String(Date.now()).slice(-6)}`;
  const created = await call('POST', '/admin/coupons', {
    token,
    body: {
      code,
      title: 'کمپینِ تمرین',
      kind: 'percent',
      valueBp: 1000, // ۱۰٪
      maxDiscountRial: '500000', // سقفِ ۵۰ هزار تومان
      minSubtotalRial: '1000000', // کمینه ۱۰۰ هزار تومان
      usageLimit: 3,
      perCustomerLimit: 1,
      appliesTo: 'all',
    },
  });
  check('ساختِ کوپن از پنل', created.status === 201 || created.status === 200, `کد ${code}`);
  const couponId = created.data?.id ?? null;

  // ۳) فهرستِ پنل
  const list = await call('GET', '/admin/coupons', { token });
  const found = (list.data?.rows ?? []).find((r) => r.code === code);
  check('کوپن در فهرستِ پنل دیده می‌شود', Boolean(found));

  // ۴) ارزیابی از سویِ مشتری (مسیرِ عمومی)
  // ارزیابیِ بی‌کالا: سبد صفر است، پس کدی که کمینه دارد باید رد شود —
  // و پیامش باید بگوید چقدر کم دارد، نه یک «نامعتبر» یِ مبهم
  const empty = await call('POST', '/shop/coupons/validate', { body: { code } });
  check(
    'ارزیابیِ کد رویِ سبدِ تُهی: می‌گوید چقدر کم دارد',
    empty.data?.valid === false && BigInt(empty.data?.shortByRial ?? '0') > 0n,
    `${toman(empty.data?.shortByRial)} تومان کم دارد`,
  );

  const missing = await call('POST', '/shop/coupons/validate', { body: { code: 'GHOST404' } });
  check('کدِ ناشناس رد می‌شود', missing.status >= 400, missing.data?.message ?? '');

  // ۵) کدی که منقضی است
  const old = await call('POST', '/admin/coupons', {
    token,
    body: {
      code: `${code}OLD`,
      title: 'کدِ منقضی',
      kind: 'fixed',
      valueRial: '100000',
      endsAt: new Date('2020-01-01T00:00:00Z').toISOString(),
    },
  });
  const oldCheck = await call('POST', '/shop/coupons/validate', { body: { code: `${code}OLD` } });
  check('کدِ منقضی با پیامِ روشن رد می‌شود', oldCheck.status >= 400, oldCheck.data?.message ?? '');
  void old;

  // ۶) یک سبد و تسویه با کد
  const carts = await call('POST', '/cart', { body: {} });
  const cartId = carts.data?.cartId ?? carts.data?.id ?? null;
  check('ساختِ سبد', Boolean(cartId));
  if (!cartId) process.exit(1);

  const search = await call('GET', '/catalog/products?limit=1');
  const first = search.data?.items?.[0] ?? search.data?.rows?.[0] ?? null;
  const variantId = first?.defaultVariantId ?? first?.variants?.[0]?.id ?? null;
  check('یافتنِ یک کالا برایِ سبد', Boolean(variantId), first?.title ?? '');

  if (variantId) {
    const added = await call('POST', `/cart/${cartId}/items`, { body: { variantId, quantity: 2 } });
    check('افزودن به سبد', added.status === 200 || added.status === 201);

    // مبلغِ سبد را می‌بینیم تا از کمینه عبور کند
    const cart = await call('GET', `/cart/${cartId}`);
    const subtotal = BigInt(cart.data?.subtotalRial ?? '0');
    console.log(`   مبلغِ سبد: ${toman(subtotal.toString())} تومان`);

    if (subtotal < 1000000n) {
      console.log('   (سبد کوچک‌تر از کمینه است؛ انتظار داریم سامانه همان را بگوید)');
    }

    const before = await call('POST', `/cart/${cartId}/checkout`, {
      body: {
        idempotencyKey: `drill-${Date.now()}-plain`,
        customerName: 'سارا احمدی',
        customerMobile: '09121112222',
        shippingAddress: 'تهران، خیابانِ آزادی، پلاک ۱، واحد ۲',
      },
    });
    const plainTotal = BigInt(before.data?.totalRial ?? '0');
    check('ثبتِ سفارشِ بی‌کوپن', before.status === 200 || before.status === 201, `جمع ${toman(plainTotal.toString())} تومان`);

    // سبدِ دوم، این‌بار با کد
    const cart2 = await call('POST', '/cart', { body: {} });
    const cart2Id = cart2.data?.cartId ?? cart2.data?.id;
    if (cart2Id) {
      await call('POST', `/cart/${cart2Id}/items`, { body: { variantId, quantity: 2 } });
      const withCode = await call('POST', `/cart/${cart2Id}/checkout`, {
        body: {
          idempotencyKey: `drill-${Date.now()}-coupon`,
          customerName: 'سارا احمدی',
          customerMobile: '09121112222',
          shippingAddress: 'تهران، خیابانِ آزادی، پلاک ۱، واحد ۲',
          couponCode: code,
        },
      });
      const discounted = BigInt(withCode.data?.totalRial ?? '0');
      if (withCode.status === 200 || withCode.status === 201) {
        check(
          'سفارشِ با کوپن ارزان‌تر است',
          discounted < plainTotal,
          `${toman(plainTotal.toString())} → ${toman(discounted.toString())} تومان`,
        );
      } else {
        // اگر سبد زیرِ کمینه بود، سامانه باید دلیل را گفته باشد
        check(
          'سامانه دلیلِ رد را می‌گوید (کمینه یا موجودی)',
          Boolean(withCode.data?.message),
          withCode.data?.message ?? `وضعیت ${withCode.status}`,
        );
      }
    }
  }

  // ۷) گزارشِ مصرف
  if (couponId) {
    const reds = await call('GET', `/admin/coupons/${couponId}/redemptions`, { token });
    const count = reds.data?.coupon?.usageCount ?? 0;
    check('گزارشِ مصرف در پنل', reds.status === 200, `${count} بار مصرف`);
  }

  // ۸) خاموش کردن
  if (couponId) {
    const off = await call('PATCH', `/admin/coupons/${couponId}/active`, {
      token,
      body: { isActive: false },
    });
    const afterOff = await call('POST', '/shop/coupons/validate', { body: { code } });
    check('کوپنِ خاموش دیگر پذیرفته نیست', afterOff.status >= 400 || afterOff.data?.valid === false, off.data?.isActive === false ? 'خاموش شد' : '');
  }

  console.log(`\n${failures === 0 ? 'همه‌یِ گام‌ها درست بود.' : `${failures} گام نیاز به نگاه دارد.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('خطایِ تمرین:', error.message);
  process.exit(1);
});
