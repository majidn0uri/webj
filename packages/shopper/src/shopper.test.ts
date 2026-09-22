import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createDatabase, applyMigrations, type Database } from '@set/db';
import {
  cleanMobile,
  requestOtp,
  verifyOtp,
  sessionFromToken,
  logout,
  logoutEverywhere,
  claimGuestOrders,
  createAddress,
  listAddresses,
  updateAddress,
  deleteAddress,
  addToWishlist,
  listWishlist,
  removeFromWishlist,
  wishlistToCart,
  listOrders,
  getOrder,
  updateProfile,
  setPassword,
  loginWithPassword,
  OTP_MAX_ATTEMPTS,
} from './index.js';

/**
 * حسابِ کاربریِ مشتری.
 *
 * این آزمون‌ها فقط «کار می‌کند؟» را نمی‌پرسند؛ هر کدام یک ادعایِ امنیتی یا
 * یک رفتارِ بدِ احتمالی را می‌سنجد — چون حسابِ مشتری جایی است که یک اشتباهِ
 * کوچک به دسترسی به حریمِ دیگران یا از دست رفتنِ تاریخچه‌ی خرید می‌انجامد.
 *
 *   ۱) کدِ پیامکی هرگز به متنِ ساده در پایگاه نمی‌ماند
 *   ۲) کدِ تازه، کدِ پیشین را می‌سوزاند (ضدِ انباشت و حدس)
 *   ۳) تلاشِ پیاپی قفل می‌شود و محدودیتِ ساعتی اعمال می‌گردد
 *   ۴) نشانه‌ی نشست فقط به صورتِ درهمه است
 *   ۵) سفارشِ مهمان با همان شماره، پس از نخستین ورود به حساب پیوند می‌خورد
 *   ۶) نشانیِ پیش‌فرض همیشه دقیقاً یکی است (حتی پس از حذف)
 *   ۷) مشتری به سفارشِ دیگری دسترسی ندارد
 */

let db: Database;
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** کدِ ملیِ ۱۰رقمیِ معتبر برای آزمون — محاسبه می‌شود، حدس زده نمی‌شود */
function validNationalCode(): string {
  for (let last = 0; last <= 9; last += 1) {
    const candidate = '0076228966'.slice(0, 9) + String(last);
    // رقمِ کنترل با الگوریتمِ کدِ ملیِ ایران
    let sum = 0;
    for (let i = 0; i < 9; i += 1) sum += Number(candidate[i]) * (10 - i);
    const rem = sum % 11;
    if ((rem < 2 ? rem : 11 - rem) === Number(candidate[9])) return candidate;
  }
  throw new Error('ساختِ کدِ ملی ناموفق');
}

async function codeFor(mobile: string, purpose: 'login' | 'register' = 'register') {
  const res = await requestOtp(db, { mobile, purpose });
  if (!res.devCode) throw new Error('کد در حالتِ توسعه برنگشت');
  return res.devCode;
}

beforeAll(async () => {
  process.env.OTP_DEV_MODE = '1';
  db = await createDatabase('memory://');
  await applyMigrations(db);
});

afterAll(async () => {
  await db.close();
});

/** مشتریِ تازه با شماره‌ای یکتا برای همین اجرا */
/** یک کالا+تنوع برای آزمون‌ها: پایگاهِ آزمون خالی است و کالایی در آن نیست */
async function makeVariant(): Promise<string> {
  let { rows: type } = await db.query<{ id: string }>(`SELECT id FROM product_types LIMIT 1`);
  if (!type[0]) {
    const made = await db.query<{ id: string }>(
      `INSERT INTO product_types (key, name, spec_template)
       VALUES ('cable-${RUN}', 'کابل و شارژر', '[]'::jsonb) RETURNING id`,
    );
    type = made.rows;
  }
  const { rows: product } = await db.query<{ id: string }>(
    `INSERT INTO products (title, slug, type_id, status, reorder_point)
     VALUES ($1,$2,$3,'active',5) RETURNING id`,
    ['کابلِ آزمون', `cable-${RUN}`, type[0]!.id],
  );
  const { rows: variant } = await db.query<{ id: string }>(
    `INSERT INTO product_variants (product_id, sku, price_rial, attributes, is_active)
     VALUES ($1,$2,$3,$4::jsonb,true) RETURNING id`,
    [product[0]!.id, `CBL-${RUN}`.slice(0, 32), '150000', JSON.stringify({ color: 'مشکی' })],
  );
  return variant[0]!.id;
}

async function newCustomer(fullName = 'مشتریِ آزمون') {
  const mobile = `0991${Math.floor(1000000 + Math.random() * 8999999)}`.slice(0, 11);
  const code = await codeFor(mobile, 'register');
  const res = await verifyOtp(db, { mobile, code, purpose: 'register', fullName });
  return { mobile, ...res };
}

describe('یکسان‌سازیِ شمارهٔ همراه', () => {
  it('قالب‌هایِ گوناگونِ یک شماره را یکی می‌کند', () => {
    expect(cleanMobile('0912 333 4455')).toBe('09123334455');
    expect(cleanMobile('+989123334455')).toBe('09123334455');
    expect(cleanMobile('00989123334455')).toBe('09123334455');
    expect(cleanMobile('۰۹۱۲۳۳۳۴۴۵۵')).toBe('09123334455');
    expect(cleanMobile('9123334455')).toBe('9123334455'); // بدونِ صفرِ آغازین: همان می‌ماند تا اعتبارسنجی ردش کند
  });
});

describe('کدِ یک‌بارمصرف', () => {
  it('کد را با متنِ ساده در پایگاه نمی‌نویسد', async () => {
    const mobile = `0992${Math.floor(1000000 + Math.random() * 8999999)}`.slice(0, 11);
    const code = await codeFor(mobile, 'register');
    const { rows } = await db.query<{ code_hash: string }>(
      `SELECT code_hash FROM customer_otps WHERE mobile = $1`,
      [mobile],
    );
    expect(rows[0]!.code_hash).not.toContain(code);
    expect(rows[0]!.code_hash.startsWith('s1$')).toBe(true);
  });

  it('کدِ تازه، کدِ زنده‌ی پیشین را می‌سوزاند', async () => {
    const mobile = `0993${Math.floor(1000000 + Math.random() * 8999999)}`.slice(0, 11);
    const oldCode = await codeFor(mobile, 'register');
    const newCode = await codeFor(mobile, 'register');

    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM customer_otps WHERE mobile = $1 AND consumed_at IS NULL`,
      [mobile],
    );
    expect(rows[0]!.n).toBe('1');

    // کدِ کهنه پذیرفته نمی‌شود…
    await expect(verifyOtp(db, { mobile, code: oldCode, purpose: 'register' })).rejects.toThrow(
      /پیش‌تر استفاده شده/,
    );
    // …و مهم‌تر: تلاشی به کدِ زنده افزوده نشده، پس صاحبِ شماره می‌تواند وارد شود
    const ok = await verifyOtp(db, { mobile, code: newCode, purpose: 'register' });
    expect(ok.token.length).toBeGreaterThan(20);
  });

  it('کدِ نادرست شمارنده را بالا می‌برد و پس از سقف، کد را می‌سوزاند', async () => {
    const mobile = `0994${Math.floor(1000000 + Math.random() * 8999999)}`.slice(0, 11);
    const code = await codeFor(mobile, 'register');
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      const expected = OTP_MAX_ATTEMPTS - i - 1; // ۴، ۳، ۲، ۱، ۰
      await expect(verifyOtp(db, { mobile, code: wrong, purpose: 'register' })).rejects.toThrow(
        new RegExp(`${expected} تلاشِ دیگر`),
      );
    }
    // تلاشِ ششم: کد دیگر زنده نیست
    await expect(verifyOtp(db, { mobile, code: wrong, purpose: 'register' })).rejects.toThrow(
      /تلاش‌ها بیش از حد/,
    );
    // حتی کدِ درست هم پس از سوختن پذیرفته نمی‌شود
    await expect(verifyOtp(db, { mobile, code, purpose: 'register' })).rejects.toThrow();
  });

  it('بیش از ۵ درخواست در یک ساعت پذیرفته نمی‌شود', async () => {
    const mobile = `0995${Math.floor(1000000 + Math.random() * 8999999)}`.slice(0, 11);
    for (let i = 0; i < 5; i += 1) await requestOtp(db, { mobile, purpose: 'register' });
    await expect(requestOtp(db, { mobile, purpose: 'register' })).rejects.toThrow(/بیش از ۵ کد/);
  });

  it('ورود با شماره‌ای که حساب ندارد خطا می‌دهد، نه ساختِ حسابِ پنهانی', async () => {
    const mobile = `0996${Math.floor(1000000 + Math.random() * 8999999)}`.slice(0, 11);
    const code = await codeFor(mobile, 'login');
    await expect(verifyOtp(db, { mobile, code, purpose: 'login' })).rejects.toThrow(
      /حسابی ساخته نشده/,
    );
  });
});

describe('نشست', () => {
  it('نشانه فقط به صورتِ درهمه ذخیره می‌شود و نشستِ جعلی پذیرفته نیست', async () => {
    const c = await newCustomer();
    const { rows } = await db.query<{ token_hash: string }>(
      `SELECT token_hash FROM customer_sessions WHERE customer_id = $1`,
      [c.customerId],
    );
    expect(rows[0]!.token_hash).not.toContain(c.token);
    expect(rows[0]!.token_hash).toHaveLength(64); // sha256 به شکلِ هگز

    const session = await sessionFromToken(db, c.token);
    expect(session?.phone).toBe(c.mobile);

    expect(await sessionFromToken(db, c.token.slice(0, -1) + 'x')).toBeNull();
    expect(await sessionFromToken(db, null)).toBeNull();
  });

  it('خروج، نشست را می‌بندد و خروجِ سراسری همه‌ی نشست‌ها را', async () => {
    const c = await newCustomer();
    await logout(db, c.token);
    expect(await sessionFromToken(db, c.token)).toBeNull();

    const a = await verifyOtp(db, {
      mobile: c.mobile,
      code: await codeFor(c.mobile, 'login'),
      purpose: 'login',
    });
    const b = await verifyOtp(db, {
      mobile: c.mobile,
      code: await codeFor(c.mobile, 'login'),
      purpose: 'login',
    });
    expect(await sessionFromToken(db, a.token)).not.toBeNull();
    const closed = await logoutEverywhere(db, c.customerId);
    expect(closed).toBeGreaterThanOrEqual(2);
    expect(await sessionFromToken(db, b.token)).toBeNull();
  });
});

describe('سفارش‌هایِ مهمان', () => {
  it('سفارشِ بی‌صاحب با همان شماره، پس از نخستین ورود پیوند می‌خورد', async () => {
    const mobile = `0997${Math.floor(1000000 + Math.random() * 8999999)}`.slice(0, 11);

    // یک سفارشِ مهمان با همین شماره
    await db.query(
      `INSERT INTO orders (order_no, status, channel, customer_mobile, customer_name,
                           subtotal_rial, discount_rial, tax_rial, shipping_rial, total_rial)
       VALUES ($1,'pending_payment','web',$2,'مهمان',100000,0,9000,0,109000)`,
      [`S-${RUN}-GUEST`, mobile],
    );
    // و یک سفارشِ مهمان با شماره‌ی دیگر (نباید پیوند بخورد)
    await db.query(
      `INSERT INTO orders (order_no, status, channel, customer_mobile,
                           subtotal_rial, discount_rial, tax_rial, shipping_rial, total_rial)
       VALUES ($1,'pending_payment','web','09000000000',100000,0,9000,0,109000)`,
      [`S-${RUN}-OTHER`],
    );

    const code = await codeFor(mobile, 'register');
    const res = await verifyOtp(db, { mobile, code, purpose: 'register' });
    expect(res.claimedOrders).toBe(1);

    const mine = await listOrders(db, res.customerId);
    expect(mine.map((o) => o.orderNo)).toContain(`S-${RUN}-GUEST`);
    expect(mine.map((o) => o.orderNo)).not.toContain(`S-${RUN}-OTHER`);
    // تاریخ به شمسی برگشته است، نه میلادیِ خام
    expect(mine[0]!.createdAtShamsi).toMatch(/^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}$/);
  });

  it('سفارشِ دیگری در دسترس نیست', async () => {
    const c = await newCustomer();
    await expect(getOrder(db, c.customerId, `S-${RUN}-OTHER`)).rejects.toThrow(
      /در حسابِ شما نیست/,
    );
  });
});

describe('نشانی‌ها', () => {
  it('کدِ پستی و شمارهٔ همراه را بررسی می‌کند', async () => {
    const c = await newCustomer();
    const base = {
      receiverName: 'زهرا احمدی',
      phone: '09123334455',
      province: 'تهران',
      city: 'تهران',
      address: 'خیابانِ انقلاب، کوچه‌یِ دوازدهم، پلاکِ ۸',
      postalCode: '۱۲۳۴۵۶۷۸۹۰',
    };
    await expect(
      createAddress(db, c.customerId, { ...base, postalCode: '۱۲۳' }),
    ).rejects.toThrow(/کدِ پستی/);
    await expect(createAddress(db, c.customerId, { ...base, phone: '۱۲۳' })).rejects.toThrow(
      /همراه/,
    );
    await expect(
      createAddress(db, c.customerId, { ...base, address: 'کوتاه' }),
    ).rejects.toThrow(/دقیق/);

    const created = await createAddress(db, c.customerId, base);
    expect(created.postalCode).toBe('1234567890'); // ارقامِ فارسی یکسان شد
    expect(created.isDefault).toBe(true);
  });

  it('همیشه دقیقاً یک نشانیِ پیش‌فرض هست — حتی پس از افزودن و حذف', async () => {
    const c = await newCustomer();
    const base = {
      receiverName: 'علی رضایی',
      phone: '09120001122',
      province: 'اصفهان',
      city: 'اصفهان',
      address: 'خیابانِ چهارباغ، مجتمعِ آفتاب، واحدِ ۱۲',
    };
    const first = await createAddress(db, c.customerId, { ...base, postalCode: '1234567890' });
    const second = await createAddress(db, c.customerId, { ...base, postalCode: '8765432109' });

    let list = await listAddresses(db, c.customerId);
    expect(list.filter((a) => a.isDefault)).toHaveLength(1);
    expect(list.find((a) => a.id === second.id)!.isDefault).toBe(true);

    // حذفِ پیش‌فرض: پیش‌فرض به نشانیِ دیگر منتقل می‌شود، حساب بی‌نشانیِ پیش‌فرض نمی‌ماند
    await deleteAddress(db, c.customerId, second.id);
    list = await listAddresses(db, c.customerId);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(first.id);
    expect(list[0]!.isDefault).toBe(true);
  });

  it('نشانیِ دیگری قابلِ ویرایش و حذف نیست', async () => {
    const c = await newCustomer();
    const other = await newCustomer();
    const addr = await createAddress(db, other.customerId, {
      receiverName: 'دیگری',
      phone: '09120001122',
      province: 'تهران',
      city: 'تهران',
      address: 'نشانیِ محرمانهٔ شخصِ دیگر',
      postalCode: '1357924680',
    });
    await expect(
      updateAddress(db, c.customerId, addr.id, { city: 'دستکاری‌شده' }),
    ).rejects.toThrow(/در حسابِ شما نیست/);
    await expect(deleteAddress(db, c.customerId, addr.id)).rejects.toThrow(/در حسابِ شما نیست/);
  });
});

describe('علاقه‌مندی‌ها', () => {
  it('افزودنِ دوباره تکراری نمی‌سازد و حذف درست کار می‌کند', async () => {
    const c = await newCustomer();
    const variantId = await makeVariant();

    await addToWishlist(db, c.customerId, variantId);
    await addToWishlist(db, c.customerId, variantId);
    let list = await listWishlist(db, c.customerId);
    expect(list).toHaveLength(1);

    const cart = await wishlistToCart(db, c.customerId);
    expect(cart.variantIds.length + cart.unavailable.length).toBe(1);

    await removeFromWishlist(db, c.customerId, variantId);
    list = await listWishlist(db, c.customerId);
    expect(list).toHaveLength(0);
  });

  it('تنوعِ ناموجود پذیرفته نمی‌شود', async () => {
    const c = await newCustomer();
    await expect(addToWishlist(db, c.customerId, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      /وجود ندارد/,
    );
  });
});

describe('پروفایل و رمز', () => {
  it('کدِ ملیِ نادرست رد می‌شود و درست پذیرفته', async () => {
    const c = await newCustomer();
    await expect(updateProfile(db, c.customerId, { nationalId: '1234567890' })).rejects.toThrow(
      /کدِ ملی/,
    );
    const updated = await updateProfile(db, c.customerId, {
      fullName: 'مریم موسوی',
      nationalId: validNationalCode(),
    });
    expect(updated.fullName).toBe('مریم موسوی');
    expect(updated.nationalId).toBe(validNationalCode());
  });

  it('رمزِ کوتاه پذیرفته نیست و رمزِ درست راهِ دومِ ورود است', async () => {
    const c = await newCustomer();
    await expect(setPassword(db, c.customerId, '123')).rejects.toThrow(/۸ نویسه/);
    await setPassword(db, c.customerId, 'SetShop@1404');

    const ok = await loginWithPassword(db, { mobile: c.mobile, password: 'SetShop@1404' });
    expect(ok.customerId).toBe(c.customerId);
    await expect(
      loginWithPassword(db, { mobile: c.mobile, password: 'wrong-password' }),
    ).rejects.toThrow(/نادرست/);
    // پیامِ خطا نباید بگوید کدام یک (شماره یا رمز) اشتباه است — نشتِ اطلاعات
  });
});

describe('مسدود کردنِ حساب', () => {
  it('حسابِ مسدود حتا با کدِ درستِ پیامک نشست نمی‌گیرد', async () => {
    const c = await newCustomer();
    await db.query(`UPDATE customers SET is_active = false, deactivated_reason = $2 WHERE id = $1`, [
      c.customerId,
      'درخواستِ خودِ مشتری',
    ]);

    const code = await codeFor(c.mobile, 'login');
    await expect(verifyOtp(db, { mobile: c.mobile, code, purpose: 'login' })).rejects.toThrow(
      /مسدود/,
    );
  });

  it('مسدودی دلیل را هم در پیام می‌آورد تا اپراتورِ بعدی بداند چرا', async () => {
    const c = await newCustomer();
    await db.query(`UPDATE customers SET is_active = false, deactivated_reason = $2 WHERE id = $1`, [
      c.customerId,
      'سوءاستفاده از مرجوعی',
    ]);
    const code = await codeFor(c.mobile, 'login');
    await expect(verifyOtp(db, { mobile: c.mobile, code, purpose: 'login' })).rejects.toThrow(
      /سوءاستفاده از مرجوعی/,
    );
  });

  it('نشستِ پیشینِ مشتری بلافاصله بی‌اعتبار می‌شود (تا وقتِ انقضا نه)', async () => {
    const c = await newCustomer();
    expect(await sessionFromToken(db, c.token)).not.toBeNull();

    await db.query(`UPDATE customers SET is_active = false WHERE id = $1`, [c.customerId]);
    expect(await sessionFromToken(db, c.token)).toBeNull();
  });

  it('ورود با گذرواژه هم برایِ حسابِ مسدود بسته است', async () => {
    const c = await newCustomer();
    await setPassword(db, c.customerId, 'SetShop@1404');
    await db.query(`UPDATE customers SET is_active = false WHERE id = $1`, [c.customerId]);

    await expect(
      loginWithPassword(db, { mobile: c.mobile, password: 'SetShop@1404' }),
    ).rejects.toThrow(/مسدود/);
  });

  it('مسدودسازی نشست‌هایِ باز را باطل می‌کند (سوءاستفاده همان لحظه می‌ایستد)', async () => {
    const c = await newCustomer();
    // دو نشستِ هم‌زمان (مثلاً گوشی و رایانه)
    const second = await loginWithPasswordSetup(c);
    expect(second).not.toBeNull();

    await db.query(
      `UPDATE customer_sessions SET revoked_at = now(), revoke_reason = 'account_deactivated'
        WHERE customer_id = $1 AND revoked_at IS NULL`,
      [c.customerId],
    );
    expect(await sessionFromToken(db, second!)).toBeNull();
  });
});

/** ساختِ یک نشستِ دوم برای مشتری (بی‌نیاز از کدِ پیامک) */
async function loginWithPasswordSetup(c: { mobile: string; customerId: string }): Promise<string | null> {
  await setPassword(db, c.customerId, 'SetShop@1404');
  const res = await loginWithPassword(db, { mobile: c.mobile, password: 'SetShop@1404' });
  return res.token;
}
