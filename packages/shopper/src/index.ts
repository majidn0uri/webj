/**
 * حسابِ کاربریِ مشتری — بسته‌یِ shopper
 *
 * تا پیش از این، «مشتری» در سامانه فقط یک ردیفِ اعتباری برای فروشِ حضوری بود:
 * سفارشِ آنلاین با «شمارهٔ همراه + نام» ثبت می‌شد و خریدار هیچ راهی نداشت که
 * سفارشِ خودش را ببیند، نشانی‌اش را ذخیره کند یا کالایی را نشان‌دار کند.
 * این بسته آن هویت را می‌سازد — با همان جدولِ customers (توضیح در مهاجرتِ ۰۱۷)،
 * بدون آن‌که منطقِ اعتبار و چک دست بخورد.
 *
 * چهار تصمیمِ اساسی:
 *
 *   ۱) ورودِ بی‌رمز، اصل است (کدِ یک‌بارمصرف پیامکی)؛
 *      رمز عبور، انتخابِ دوم است. در ایران، رمز فراموش می‌شود و شمارهٔ همراه
 *      نه. با این حال کدِ پیامکی هرگز به‌تنهایی «حساب نمی‌سازد» مگر با رضایتِ
 *      صاحبِ شماره (همان وارد کردنِ کد).
 *
 *   ۲) کد و نشانه، هر دو فقط به صورتِ درهمه ذخیره می‌شوند.
 *      پیامد: دسترسی به پایگاه (حتی پشتیبانِ دزدیده‌شده) برایِ ساختنِ نشست کافی
 *      نیست. درهمه با نمکِ تصادفیِ هر ردیف است، پس جست‌وجویِ وارونه هم نمی‌کند.
 *
 *   ۳) کدِ تازه، کدِ پیشین را می‌سوزاند.
 *      اگر پنج کدِ زنده همزمان معتبر باشند، فضایِ حدس پنج برابر می‌شود و کدهایِ
 *      کهنه تا دیر وقت کار می‌کنند (مثلاً روی گوشیِ قدیمیِ فروخته‌شده).
 *
 *   ۴) سفارش‌هایِ مهمان، پس از نخستین ورود به حساب پیوند می‌خورند.
 *      مشتری‌ای که پیش از ساختنِ حساب خریده، نباید تاریخچه‌اش را از دست بدهد؛
 *      پیوند با شرطِ تطابقِ شمارهٔ همراه و نداشتنِ صاحبِ پیشین انجام می‌شود،
 *      نه با حدس و شباهت.
 */

import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Database, Queryable } from '@set/db';
import { AppError } from '@set/shared-kernel';
import {
  formatJalali,
  isValidIranianNationalId,
  isValidMobile,
  isValidPostalCode,
  normalizeMobile,
  toEnglishDigits,
} from '@set/shared-kernel';
import { hashPassword, verifyPassword } from '@set/auth';
import { enqueueSms } from '@set/commerce';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

// ===========================================================================
// ثابت‌ها — هر عدد اینجا یک تصمیم است، نه یک مقدارِ پیش‌فرض
// ===========================================================================

/** عمرِ کد: ۱۲۰ ثانیه — همان که در متنِ پیامک آمده («اعتبار ۲ دقیقه»). */
export const OTP_TTL_SECONDS = 120;

/** تلاشِ مجاز برایِ یک کد. پس از آن کد می‌سوزد و باید کدِ تازه خواست. */
export const OTP_MAX_ATTEMPTS = 5;

/**
 * بیشینه‌یِ کدهایِ قابلِ درخواست در یک ساعت برایِ یک شماره.
 * ۵ تا: بیشتر از نیازِ یک انسان (ارسال دوباره، اشتباه تایپی) و کمتر از آن
 * که بشود با آن مزاحمِ کسی شد یا هزینه‌ی پیامک تراشید.
 */
export const OTP_RATE_LIMIT_PER_HOUR = 5;

/** عمرِ نشستِ مشتری: ۳۰ روز — رسمِ فروشگاه‌هایِ ایرانی و کم‌دردسر برایِ موبایل. */
export const SESSION_TTL_DAYS = 30;

// ===========================================================================
// ابزارها
// ===========================================================================

/**
 * شمارهٔ همراه را یکسان می‌کند: ارقامِ فارسی → انگلیسی، ۹۸+/0098 → ۰،
 * و فاصله/خط‌تیره حذف می‌شود. چرا در ورودیِ عمومی؟ چون «۰۹۱۲ ۳۳۳ ۴۴۵۵»،
 * «۹۱۲۳۳۳۴۴۵۵» و «+989123334455» یک نفرند وگرنه سه حسابِ جدا می‌شدند.
 */
export function cleanMobile(input: string): string {
  const raw = toEnglishDigits(String(input ?? '')).replace(/[\s\-()]/g, '');
  let m = raw;
  if (m.startsWith('+98')) m = '0' + m.slice(3);
  else if (m.startsWith('0098')) m = '0' + m.slice(4);
  else if (m.startsWith('98') && m.length === 12) m = '0' + m.slice(2);
  return m;
}

/** درهمه‌یِ کد — scrypt با نمکِ تصادفی؛ متنِ کد هیچ‌جا نوشته نمی‌شود. */
async function otpHash(code: string): Promise<string> {
  const salt = randomBytes(12);
  const key = await scryptAsync(code, salt, 32);
  return ['s1', salt.toString('base64'), key.toString('base64')].join('$');
}

async function otpMatches(code: string, stored: string): Promise<boolean> {
  const [tag, saltB64, keyB64] = stored.split('$');
  if (tag !== 's1' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(code, Buffer.from(saltB64, 'base64'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function newCode(): string {
  // ۶ رقم با تولیدگرِ امن (randomInt از crypto)، نه Math.random —
  // Math.random قابلِ پیش‌بینی است و برایِ کدِ ورود به هیچ روی جایز نیست.
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** نشانه‌ی نشست: ۳۲ بایت تصادفی؛ فقط درهمه‌اش در پایگاه می‌ماند. */
function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sessionTokenHash(token: string): string {
  // قرار نیست بازیابی شود، فقط مقایسه — پس sha256 کافی و سریع است.
  // (نشانه خودش ۳۲ بایتِ تصادفی است، پس نیازی به کندکننده‌یِ scrypt نیست.)
  return createHash('sha256').update(token).digest('hex');
}

// ===========================================================================
// ۱) کدِ یک‌بارمصرف
// ===========================================================================

export type OtpPurpose = 'login' | 'register' | 'reset';

export interface RequestOtpInput {
  mobile: string;
  purpose?: OtpPurpose;
  ip?: string | null;
  /** نامِ فروشگاه برایِ متنِ پیامک */
  storeName?: string;
}

export interface RequestOtpResult {
  sent: boolean;
  expiresInSeconds: number;
  /** فقط وقتی OTP_DEV_MODE=1 باشد پر می‌شود — برای آزمودنِ خودکار و پیش‌نمایش */
  devCode?: string;
  note?: string;
}

/**
 * درخواستِ کد. کدِ پیشینِ همان شماره و همان منظور در همین تراکنش می‌سوزد،
 * و تعدادِ درخواست‌ها در یک ساعت محدود است (ضدِ مزاحمت و ضدِ هزینه).
 */
export async function requestOtp(
  db: Queryable,
  input: RequestOtpInput,
): Promise<RequestOtpResult> {
  const mobile = cleanMobile(input.mobile);
  const purpose: OtpPurpose = input.purpose ?? 'login';
  if (!isValidMobile(mobile)) {
    throw new AppError('VALIDATION', { message: 'شمارهٔ همراه معتبر نیست.' });
  }

  const { rows: recent } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM customer_otps
      WHERE mobile = $1 AND created_at > now() - interval '1 hour'`,
    [mobile],
  );
  if (Number(recent[0]?.n ?? '0') >= OTP_RATE_LIMIT_PER_HOUR) {
    throw new AppError('RATE_LIMITED', {
      message: 'در یک ساعت بیش از ۵ کد درخواست شده است؛ کمی بعد دوباره تلاش کنید.',
    });
  }

  // کدِ زنده‌ی پیشین باطل شود
  await db.query(
    `UPDATE customer_otps SET consumed_at = now()
      WHERE mobile = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [mobile, purpose],
  );

  const code = newCode();
  await db.query(
    `INSERT INTO customer_otps (mobile, purpose, code_hash, expires_at, ip, max_attempts)
     VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval, $5, $6)`,
    [mobile, purpose, await otpHash(code), String(OTP_TTL_SECONDS), input.ip ?? null, OTP_MAX_ATTEMPTS],
  );

  // OTP fallback: اگر صف پیامک fail کند، کد همچنان معتبر است
  // کارگر systemd بعداً retry می‌کند
  try {
    await enqueueSms(db, {
      phone: mobile,
      templateKey: 'otp_login',
      vars: { store: input.storeName ?? 'ست‌شاپ', code },
    });
  } catch (smsErr) {
    console.error('[OTP] enqueueSms failed, code still valid:', smsErr);
  }

  return {
    sent: true,
    expiresInSeconds: OTP_TTL_SECONDS,
    ...(process.env.OTP_DEV_MODE === '1' ? { devCode: code } : {}),
  };
}

/**
 * آیا این کد، کدی است که همین اخیر مصرف یا باطل شده است؟
 * (برای آن‌که کدِ کهنه، تلاش‌هایِ کدِ تازه را نسوزاند — توضیح در verifyOtp)
 */
async function isRecentlyConsumedCode(
  db: Queryable,
  mobile: string,
  purpose: OtpPurpose,
  code: string,
): Promise<boolean> {
  const { rows } = await db.query<{ code_hash: string }>(
    `SELECT code_hash FROM customer_otps
      WHERE mobile = $1 AND purpose = $2 AND consumed_at IS NOT NULL
        AND created_at > now() - interval '10 minutes'
      ORDER BY created_at DESC
      LIMIT 5`,
    [mobile, purpose],
  );
  for (const row of rows) {
    if (await otpMatches(code, row.code_hash)) return true;
  }
  return false;
}

export interface VerifyOtpInput {
  mobile: string;
  code: string;
  purpose?: OtpPurpose;
  fullName?: string | null;
  userAgent?: string | null;
  ip?: string | null;
}

export interface VerifyOtpResult {
  customerId: string;
  token: string;
  isNew: boolean;
  fullName: string | null;
  /** چند سفارشِ مهمان با این شماره به حساب پیوند خورد */
  claimedOrders: number;
  expiresAt: string;
}

/**
 * بررسیِ کد و ساختِ نشست.
 *
 * اگر مشتری تازه باشد: حساب در همین لحظه ساخته می‌شود — ثبت‌نام در ایران
 * نباید فرمِ جداگانه داشته باشد؛ پرداختِ نخست نام و نشانی را می‌گیرد.
 */
export async function verifyOtp(
  db: Database,
  input: VerifyOtpInput,
): Promise<VerifyOtpResult> {
  const mobile = cleanMobile(input.mobile);
  const purpose: OtpPurpose = input.purpose ?? 'login';
  const code = toEnglishDigits(String(input.code ?? '')).trim();

  if (!isValidMobile(mobile)) {
    throw new AppError('VALIDATION', { message: 'شمارهٔ همراه معتبر نیست.' });
  }

  // پیش‌ترمیز: اگر این کد همان کدی است که همین اخیر مصرف یا باطل شده، همان‌جا
  // رد می‌شود — «بی‌آن‌که تلاشی به کدِ زنده افزوده شود». چرا؟ چون کسی که کدِ
  // کهنه‌ای در دست دارد (مثلاً روی گوشیِ قدیمی) نباید بتواند با پنج تلاشِ
  // نادرست، کدِ تازه‌ی صاحبِ شماره را بسوزاند و او را پشتِ در نگه دارد.
  // این بررسی بیرون از تراکنش است تا هیچ اثری از خود به‌جا نگذارد.
  if (await isRecentlyConsumedCode(db, mobile, purpose, code)) {
    throw new AppError('VALIDATION', {
      message: 'این کد پیش‌تر استفاده شده است؛ کدِ تازه بخواهید.',
    });
  }

  // ── مرحله‌ی ۱: بررسیِ کد — در تراکنشی کوتاه و جداگانه ──────────────────────
  //
  // چرا جدا؟ چون شمارنده‌ی تلاش‌ها باید «بماند» حتی وقتی پاسخ خطاست. اگر این
  // بخش در همان تراکنشی می‌بود که در پایان خطا پرتاب می‌کند، پرتابِ خطا کلِ
  // تراکنش را برمی‌گرداند و با هر تلاشِ نادرست، شمارنده دوباره از صفر شروع
  // می‌شد — یعنی محدودیتِ تلاش عملاً بی‌اثر و حدس‌زدنِ کد ممکن.
  const otp = await db.transaction(async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      code_hash: string;
      attempts: number;
      max_attempts: number;
    }>(
      `SELECT id, code_hash, attempts, max_attempts
         FROM customer_otps
        WHERE mobile = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [mobile, purpose],
    );
    const row = rows[0];
    if (!row) return { state: 'missing' } as const;
    if (row.attempts >= row.max_attempts) {
      await tx.query(`UPDATE customer_otps SET consumed_at = now() WHERE id = $1`, [row.id]);
      return { state: 'burned' } as const;
    }
    if (!(await otpMatches(code, row.code_hash))) {
      await tx.query(`UPDATE customer_otps SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
      return {
        state: 'wrong',
        remaining: row.max_attempts - row.attempts - 1,
      } as const;
    }
    await tx.query(`UPDATE customer_otps SET consumed_at = now() WHERE id = $1`, [row.id]);
    return { state: 'ok' } as const;
  });

  // خطاها «بیرونِ» تراکنش پرتاب می‌شوند تا شمارنده پابرجا بماند.
  if (otp.state === 'missing') {
    throw new AppError('VALIDATION', {
      message: 'کد منقضی یا مصرف شده است؛ کدِ تازه بخواهید.',
    });
  }
  if (otp.state === 'burned') {
    throw new AppError('RATE_LIMITED', {
      message: 'تعدادِ تلاش‌ها بیش از حد بود؛ کدِ تازه بخواهید.',
    });
  }
  if (otp.state === 'wrong') {
    throw new AppError('VALIDATION', {
      message: `کد نادرست است. ${otp.remaining} تلاشِ دیگر دارید.`,
    });
  }

  // ── مرحله‌ی ۲: مشتری و نشست ───────────────────────────────────────────────
  return db.transaction(async (tx) => {
    // مشتری پیدا یا ساخته شود
    const { rows: existing } = await tx.query<{
      id: string;
      full_name: string | null;
      is_active: boolean;
      deactivated_reason: string | null;
    }>(`SELECT id, full_name, is_active, deactivated_reason FROM customers WHERE phone = $1`, [
      mobile,
    ]);
    // حسابِ مسدود: کد درست بود، اما نشستی ساخته نمی‌شود. چرا اینجا و نه در
    // مرحله‌یِ ۱؟ چون اگر پیش از بررسیِ کد رد می‌کردیم، پیامِ «حساب مسدود است»
    // به هر کسی که شماره را می‌داند نشان می‌داد که این شماره حساب دارد —
    // افشایِ اطلاعات. اینجا فقط کسی پیام را می‌بیند که کدِ پیامک را داشته است.
    if (existing[0] && (existing[0] as { is_active?: boolean }).is_active === false) {
      throw new AppError('FORBIDDEN', {
        message:
          (existing[0] as { deactivated_reason?: string | null }).deactivated_reason
            ? `حساب شما مسدود است: ${(existing[0] as { deactivated_reason?: string }).deactivated_reason}`
            : 'حساب شما مسدود است؛ با پشتیبانی تماس بگیرید.',
      });
    }

    let customerId = existing[0]?.id;
    let isNew = false;

    if (!customerId) {
      if (purpose === 'login') {
        throw new AppError('NOT_FOUND', {
          message: 'با این شماره حسابی ساخته نشده است؛ نخست ثبت‌نام کنید.',
        });
      }
      // full_name در جدول اجباری است (یک مشتری بی‌نام در دفترکل و فاکتور
      // بی‌معناست)؛ اگر نامی داده نشده، یک نامِ موقت و محترمانه می‌سازیم که
      // چهار رقمِ آخرِ شماره را دارد — نه کلِ شماره را (حریمِ خصوصی).
      const { rows: created } = await tx.query<{ id: string }>(
        `INSERT INTO customers (phone, full_name, kind, mobile_verified_at)
         VALUES ($1, $2, 'online', now())
         RETURNING id`,
        [mobile, input.fullName?.trim() || `مشتری ${mobile.slice(-4)}`],
      );
      customerId = created[0]!.id;
      isNew = true;
    } else {
      await tx.query(
        `UPDATE customers SET mobile_verified_at = now(), last_login_at = now() WHERE id = $1`,
        [customerId],
      );
    }

    const claimed = await claimGuestOrders(tx, customerId!, mobile);

    const token = newSessionToken();
    const { rows: sess } = await tx.query<{ expires_at: string }>(
      `INSERT INTO customer_sessions (customer_id, token_hash, user_agent, ip, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '${SESSION_TTL_DAYS} days')
       RETURNING expires_at`,
      [customerId, sessionTokenHash(token), input.userAgent ?? null, input.ip ?? null],
    );

    const { rows: named } = await tx.query<{ full_name: string | null }>(
      `SELECT full_name FROM customers WHERE id = $1`,
      [customerId],
    );

    return {
      customerId: customerId!,
      token,
      isNew,
      fullName: named[0]?.full_name ?? null,
      claimedOrders: claimed,
      expiresAt: sess[0]!.expires_at,
    };
  });
}

// ===========================================================================
// ۲) ورود با رمز (راهِ دوم) و نشست
// ===========================================================================

export interface PasswordLoginInput {
  mobile: string;
  password: string;
  userAgent?: string | null;
  ip?: string | null;
}

export async function loginWithPassword(
  db: Database,
  input: PasswordLoginInput,
): Promise<{ customerId: string; token: string; fullName: string | null; expiresAt: string }> {
  const mobile = cleanMobile(input.mobile);
  const { rows } = await db.query<{
    id: string;
    password_hash: string | null;
    full_name: string | null;
    is_active: boolean;
    deactivated_reason: string | null;
  }>(
    `SELECT id, password_hash, full_name, is_active, deactivated_reason
       FROM customers WHERE phone = $1`,
    [mobile],
  );
  const customer = rows[0];
  if (!customer || !customer.password_hash) {
    throw new AppError('UNAUTHENTICATED', { message: 'شماره یا رمز نادرست است.' });
  }
  if (!(await verifyPassword(input.password, customer.password_hash))) {
    throw new AppError('UNAUTHENTICATED', { message: 'شماره یا رمز نادرست است.' });
  }
  // مسدودی پس از درستیِ رمز بررسی می‌شود، نه پیش از آن: اگر پیش از آن رد
  // می‌کردیم، پیامِ «حساب مسدود است» به هر کسی که شماره را می‌داند می‌گفت
  // این شماره حساب دارد (نشتِ اطلاعات).
  if (customer.is_active === false) {
    throw new AppError('FORBIDDEN', {
      message: customer.deactivated_reason
        ? `حساب شما مسدود است: ${customer.deactivated_reason}`
        : 'حساب شما مسدود است؛ با پشتیبانی تماس بگیرید.',
    });
  }

  const token = newSessionToken();
  const { rows: sess } = await db.query<{ expires_at: string }>(
    `INSERT INTO customer_sessions (customer_id, token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '${SESSION_TTL_DAYS} days')
     RETURNING expires_at`,
    [customer.id, sessionTokenHash(token), input.userAgent ?? null, input.ip ?? null],
  );
  await db.query(`UPDATE customers SET last_login_at = now() WHERE id = $1`, [customer.id]);

  return {
    customerId: customer.id,
    token,
    fullName: customer.full_name,
    expiresAt: sess[0]!.expires_at,
  };
}

/** تعیین یا تغییرِ رمز — فقط پس از ورود (یا با کدِ یک‌بارمصرفِ reset). */
export async function setPassword(
  db: Queryable,
  customerId: string,
  password: string,
): Promise<void> {
  if (String(password ?? '').length < 8) {
    throw new AppError('VALIDATION', { message: 'رمز باید دست‌کم ۸ نویسه باشد.' });
  }
  await db.query(`UPDATE customers SET password_hash = $2 WHERE id = $1`, [
    customerId,
    await hashPassword(password),
  ]);
}

export interface ShopperSession {
  customerId: string;
  fullName: string | null;
  phone: string;
  nationalId: string | null;
  email: string | null;
  mobileVerified: boolean;
  isPartner: boolean;
}

/** بازیابیِ مشتری از نشانه؛ نشانه‌هایِ منقضی یا باطل «هیچ» برمی‌گردانند. */
export async function sessionFromToken(
  db: Queryable,
  token: string | null | undefined,
): Promise<ShopperSession | null> {
  if (!token) return null;
  const { rows } = await db.query<{
    customer_id: string;
    full_name: string | null;
    phone: string;
    national_id: string | null;
    email: string | null;
    mobile_verified_at: string | null;
    is_partner: boolean;
  }>(
    `SELECT c.id AS customer_id, c.full_name, c.phone, c.national_id, c.email, c.mobile_verified_at, c.is_partner
       FROM customer_sessions s
       JOIN customers c ON c.id = s.customer_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND c.is_active = true`,
    [sessionTokenHash(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    customerId: row.customer_id,
    fullName: row.full_name,
    phone: row.phone,
    nationalId: row.national_id,
    email: row.email,
    mobileVerified: row.mobile_verified_at != null,
    isPartner: (row as Record<string, unknown>).is_partner === true,
  };
}

export async function logout(db: Queryable, token: string): Promise<void> {
  await db.query(`UPDATE customer_sessions SET revoked_at = now() WHERE token_hash = $1`, [
    sessionTokenHash(token),
  ]);
}

/** باطل کردنِ همه‌ی نشست‌هایِ مشتری (پس از تغییرِ رمز یا گزارشِ سرقت). */
export async function logoutEverywhere(db: Queryable, customerId: string): Promise<number> {
  const res = await db.query(
    `UPDATE customer_sessions SET revoked_at = now()
      WHERE customer_id = $1 AND revoked_at IS NULL`,
    [customerId],
  );
  return res.affectedRows ?? 0;
}

// ===========================================================================
// ۳) پیوند دادنِ سفارش‌هایِ مهمان
// ===========================================================================

/**
 * سفارش‌هایی که با همین شماره ثبت شده‌اند ولی صاحب ندارند، به حساب پیوند
 * می‌خورند. شرطِ سخت: فقط سفارش‌هایِ بی‌صاحب و فقط با تطابقِ دقیقِ شماره.
 */
export async function claimGuestOrders(
  db: Queryable,
  customerId: string,
  mobile: string,
): Promise<number> {
  const res = await db.query(
    `UPDATE orders
        SET customer_id = $1
      WHERE customer_id IS NULL
        AND customer_mobile = $2`,
    [customerId, mobile],
  );
  return res.affectedRows ?? 0;
}

// ===========================================================================
// ۴) نشانی‌ها
// ===========================================================================

export interface AddressInput {
  receiverName: string;
  phone: string;
  province: string;
  city: string;
  address: string;
  postalCode: string;
  isDefault?: boolean;
}

export interface Address {
  id: string;
  receiverName: string;
  phone: string;
  province: string;
  city: string;
  address: string;
  postalCode: string | null;
  isDefault: boolean;
}

function assertAddress(input: AddressInput): void {
  const receiver = (input.receiverName ?? '').trim();
  if (receiver.length < 3) {
    throw new AppError('VALIDATION', { message: 'نامِ گیرنده باید دست‌کم ۳ نویسه باشد.' });
  }
  if (!isValidMobile(cleanMobile(input.phone))) {
    throw new AppError('VALIDATION', { message: 'شمارهٔ همراهِ گیرنده معتبر نیست.' });
  }
  if (!(input.province ?? '').trim() || !(input.city ?? '').trim()) {
    throw new AppError('VALIDATION', { message: 'استان و شهر را وارد کنید.' });
  }
  if ((input.address ?? '').trim().length < 10) {
    throw new AppError('VALIDATION', { message: 'نشانی باید دقیق باشد (دست‌کم ۱۰ نویسه).' });
  }
  const postal = toEnglishDigits(String(input.postalCode ?? '')).replace(/[\s\-]/g, '');
  if (!isValidPostalCode(postal)) {
    throw new AppError('VALIDATION', { message: 'کدِ پستی باید ۱۰ رقم باشد.' });
  }
}

export async function listAddresses(db: Queryable, customerId: string): Promise<Address[]> {
  const { rows } = await db.query<{
    id: string;
    receiver_name: string;
    phone: string;
    province: string;
    city: string;
    address: string;
    postal_code: string | null;
    is_default: boolean;
  }>(
    `SELECT id, receiver_name, phone, province, city, address, postal_code, is_default
       FROM customer_addresses
      WHERE customer_id = $1
      ORDER BY is_default DESC, created_at DESC`,
    [customerId],
  );
  return rows.map((r) => ({
    id: r.id,
    receiverName: r.receiver_name,
    phone: r.phone,
    province: r.province,
    city: r.city,
    address: r.address,
    postalCode: r.postal_code,
    isDefault: r.is_default,
  }));
}

export async function createAddress(
  db: Database,
  customerId: string,
  input: AddressInput,
): Promise<Address> {
  assertAddress(input);
  const postal = toEnglishDigits(String(input.postalCode)).replace(/[\s\-]/g, '');
  return db.transaction(async (tx) => {
    // «فقط یک نشانیِ پیش‌فرض» را پایگاه نمی‌تواند تضمین کند (چند ردیف با
    // is_default=true)، پس در یک تراکنش انجام می‌شود تا نیمه‌کاره نماند.
    if (input.isDefault !== false) {
      await tx.query(`UPDATE customer_addresses SET is_default = false WHERE customer_id = $1`, [
        customerId,
      ]);
    }
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO customer_addresses
         (customer_id, receiver_name, phone, province, city, address, postal_code, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        customerId,
        input.receiverName.trim(),
        cleanMobile(input.phone),
        input.province.trim(),
        input.city.trim(),
        input.address.trim(),
        postal,
        input.isDefault !== false,
      ],
    );
    const created = await listAddresses(tx, customerId);
    return created.find((a) => a.id === rows[0]!.id)!;
  });
}

export async function updateAddress(
  db: Database,
  customerId: string,
  addressId: string,
  patch: Partial<AddressInput>,
): Promise<Address> {
  return db.transaction(async (tx) => {
    const current = (await listAddresses(tx, customerId)).find((a) => a.id === addressId);
    if (!current) {
      throw new AppError('NOT_FOUND', { message: 'این نشانی در حسابِ شما نیست.' });
    }
    const merged: AddressInput = { ...current, ...patch } as AddressInput;
    assertAddress(merged);
    if (patch.isDefault) {
      await tx.query(`UPDATE customer_addresses SET is_default = false WHERE customer_id = $1`, [
        customerId,
      ]);
    }
    await tx.query(
      `UPDATE customer_addresses
          SET receiver_name = $3, phone = $4, province = $5, city = $6,
              address = $7, postal_code = $8,
              is_default = CASE WHEN $9 THEN true ELSE is_default END
        WHERE id = $1 AND customer_id = $2`,
      [
        addressId,
        customerId,
        merged.receiverName.trim(),
        cleanMobile(merged.phone),
        merged.province.trim(),
        merged.city.trim(),
        merged.address.trim(),
        toEnglishDigits(String(merged.postalCode)).replace(/[\s\-]/g, ''),
        patch.isDefault === true,
      ],
    );
    return (await listAddresses(tx, customerId)).find((a) => a.id === addressId)!;
  });
}

/** حذف؛ اگر نشانیِ پیش‌فرض حذف شود، نخستین نشانیِ باقی‌مانده پیش‌فرض می‌شود. */
export async function deleteAddress(
  db: Database,
  customerId: string,
  addressId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const wasDefault = (await listAddresses(tx, customerId)).find((a) => a.id === addressId)
      ?.isDefault;
    const res = await tx.query(`DELETE FROM customer_addresses WHERE id = $1 AND customer_id = $2`, [
      addressId,
      customerId,
    ]);
    if ((res.affectedRows ?? 0) === 0) {
      throw new AppError('NOT_FOUND', { message: 'این نشانی در حسابِ شما نیست.' });
    }
    if (wasDefault) {
      await tx.query(
        `UPDATE customer_addresses SET is_default = true
          WHERE id = (SELECT id FROM customer_addresses WHERE customer_id = $1 ORDER BY created_at LIMIT 1)`,
        [customerId],
      );
    }
  });
}

// ===========================================================================
// ۵) علاقه‌مندی‌ها
// ===========================================================================

/**
 * برچسبِ خوانایِ یک تنوع از رویِ ویژگی‌هایش.
 * چرا لازم است؟ چون جدولِ تنوع‌ها ستونِ «عنوان» ندارد — تفاوتِ تنوع‌ها در
 * ویژگی‌هاست (رنگ، اندازه، طول). اینجا همان ویژگی‌ها به زبانِ آدمیزاد درمی‌آیند.
 */
function variantLabel(attributes: unknown): string | null {
  if (!attributes) return null;
  let obj: Record<string, unknown> = {};
  if (typeof attributes === 'string') {
    try {
      obj = JSON.parse(attributes) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof attributes === 'object') {
    obj = attributes as Record<string, unknown>;
  } else {
    return null;
  }
  const parts = Object.entries(obj)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => {
      const key = PERSIAN_ATTRIBUTE_LABELS[k] ?? k;
      return `${key}: ${String(v)}`;
    });
  return parts.length ? parts.join(' · ') : null;
}

const PERSIAN_ATTRIBUTE_LABELS: Record<string, string> = {
  color: 'رنگ',
  size: 'اندازه',
  length: 'طول',
  capacity: 'ظرفیت',
  model: 'مدل',
  material: 'جنس',
};

export interface WishlistItem {
  variantId: string;
  productId: string;
  title: string;
  slug: string;
  variantTitle: string | null;
  priceRial: string | null;
  inStock: boolean;
  imageUrl: string | null;
  addedAt: string;
}

export async function listWishlist(db: Queryable, customerId: string): Promise<WishlistItem[]> {
  const { rows } = await db.query<{
    variant_id: string;
    product_id: string;
    title: string;
    slug: string;
    attributes: unknown;
    price_rial: string | null;
    stock: string | null;
    image_url: string | null;
    added_at: string;
  }>(
    `SELECT w.variant_id,
            p.id AS product_id,
            p.title,
            p.slug,
            v.attributes,
            v.price_rial::text AS price_rial,
            COALESCE(s.on_hand, 0)::text AS stock,
            (SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1) AS image_url,
            w.created_at AS added_at
       FROM customer_wishlists w
       JOIN product_variants v ON v.id = w.variant_id
       JOIN products p        ON p.id = v.product_id
       LEFT JOIN stock_items s ON s.variant_id = v.id
      WHERE w.customer_id = $1
      ORDER BY w.created_at DESC`,
    [customerId],
  );
  return rows.map((r) => ({
    variantId: r.variant_id,
    productId: r.product_id,
    title: r.title,
    slug: r.slug,
    variantTitle: variantLabel(r.attributes),
    priceRial: r.price_rial,
    inStock: Number(r.stock ?? '0') > 0,
    imageUrl: r.image_url,
    addedAt: r.added_at,
  }));
}

export async function addToWishlist(
  db: Queryable,
  customerId: string,
  variantId: string,
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM product_variants WHERE id = $1`,
    [variantId],
  );
  if (!rows[0]) {
    throw new AppError('NOT_FOUND', { message: 'این کالا وجود ندارد.' });
  }
  await db.query(
    `INSERT INTO customer_wishlists (customer_id, variant_id)
     VALUES ($1, $2)
     ON CONFLICT (customer_id, variant_id) DO NOTHING`,
    [customerId, variantId],
  );
}

export async function removeFromWishlist(
  db: Queryable,
  customerId: string,
  variantId: string,
): Promise<void> {
  await db.query(
    `DELETE FROM customer_wishlists WHERE customer_id = $1 AND variant_id = $2`,
    [customerId, variantId],
  );
}

/** درِ میان‌بر: «همه را به سبد بریز» — هر کدام که موجود نباشد، در فهرست برمی‌گردد. */
export async function wishlistToCart(
  db: Queryable,
  customerId: string,
): Promise<{ variantIds: string[]; unavailable: string[] }> {
  const items = await listWishlist(db, customerId);
  return {
    variantIds: items.filter((i) => i.inStock).map((i) => i.variantId),
    unavailable: items.filter((i) => !i.inStock).map((i) => i.variantId),
  };
}

// ===========================================================================
// ۶) سفارش‌هایِ مشتری و رهگیری
// ===========================================================================

export interface OrderSummary {
  orderNo: string;
  status: string;
  statusLabel: string;
  totalRial: string;
  itemCount: number;
  createdAt: string;
  createdAtShamsi: string | null;
  paidAt: string | null;
  trackingCode: string | null;
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_payment: 'در انتظارِ پرداخت',
  paid: 'پرداخت شد',
  confirmed: 'تأیید شد',
  processing: 'در حالِ آماده‌سازی',
  shipped: 'ارسال شد',
  delivered: 'تحویل داده شد',
  cancelled: 'لغو شد',
  refunded: 'مبلغ برگشت خورد',
};

export async function listOrders(db: Queryable, customerId: string): Promise<OrderSummary[]> {
  // یک پرس‌وجو برایِ همه‌ی سفارش‌ها — نه یک پرس‌وجو به‌ازایِ هر سفارش.
  // مشتری‌ای با ۲۰۰ سفارش در غیرِ این صورت ۲۰۱ رفت‌وبرگشت به پایگاه می‌زد
  // (خطایِ کلاسیکِ N+1 که درست در صفحه‌ای رخ می‌دهد که همه بازدید می‌کنند).
  const { rows } = await db.query<{
    order_no: string;
    status: string;
    total_rial: string;
    created_at: string;
    paid_at: string | null;
    item_count: string;
  }>(
    `SELECT o.order_no, o.status, o.total_rial::text AS total_rial,
            o.created_at, o.paid_at,
            COALESCE(SUM(oi.quantity), 0)::text AS item_count
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.customer_id = $1
      GROUP BY o.id, o.order_no, o.status, o.total_rial, o.created_at, o.paid_at
      ORDER BY o.created_at DESC`,
    [customerId],
  );

  return rows.map((r) => ({
    orderNo: r.order_no,
    status: r.status,
    statusLabel: ORDER_STATUS_LABELS[r.status] ?? r.status,
    totalRial: r.total_rial,
    itemCount: Number(r.item_count ?? '0'),
    createdAt: r.created_at,
    createdAtShamsi: formatJalali(new Date(r.created_at)),
    paidAt: r.paid_at,
    trackingCode: null,
  }));
}

export interface OrderTimelineEntry {
  fromStatus: string | null;
  toStatus: string;
  label: string;
  reason: string | null;
  createdAt: string;
}

export interface OrderDetail extends OrderSummary {
  items: Array<{
    variantId: string;
    title: string;
    quantity: number;
    unitPriceRial: string;
    totalRial: string;
  }>;
  subtotalRial: string;
  discountRial: string;
  taxRial: string;
  shippingRial: string;
  shippingAddress: Record<string, unknown> | null;
  customerNote: string | null;
  timeline: OrderTimelineEntry[];
}

export async function getOrder(
  db: Queryable,
  customerId: string,
  orderNo: string,
): Promise<OrderDetail> {
  const { rows } = await db.query<{
    id: string;
    order_no: string;
    status: string;
    subtotal_rial: string;
    discount_rial: string;
    tax_rial: string;
    shipping_rial: string;
    total_rial: string;
    created_at: string;
    paid_at: string | null;
    shipping_address: Record<string, unknown> | null;
    customer_note: string | null;
  }>(
    `SELECT id, order_no, status,
            subtotal_rial::text, discount_rial::text, tax_rial::text,
            shipping_rial::text, total_rial::text,
            created_at, paid_at, shipping_address, customer_note
       FROM orders
      WHERE customer_id = $1 AND order_no = $2`,
    [customerId, orderNo],
  );
  const order = rows[0];
  if (!order) {
    throw new AppError('NOT_FOUND', { message: 'این سفارش در حسابِ شما نیست.' });
  }

  const { rows: items } = await db.query<{
    variant_id: string;
    title: string;
    quantity: number;
    unit_price_rial: string;
    total_rial: string;
  }>(
    `SELECT oi.variant_id,
            COALESCE(p.title, '') AS title,
            oi.quantity,
            oi.unit_price_rial::text AS unit_price_rial,
            oi.total_rial::text AS total_rial
       FROM order_items oi
       LEFT JOIN product_variants v ON v.id = oi.variant_id
       LEFT JOIN products p        ON p.id = v.product_id
      WHERE oi.order_id = $1
      ORDER BY p.title`,
    [order.id],
  );

  const { rows: hist } = await db.query<{
    from_status: string | null;
    to_status: string;
    reason: string | null;
    created_at: string;
  }>(
    `SELECT from_status, to_status, reason, created_at
       FROM order_status_history
      WHERE order_id = $1
      ORDER BY created_at`,
    [order.id],
  );

  return {
    orderNo: order.order_no,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status] ?? order.status,
    totalRial: order.total_rial,
    itemCount: items.reduce((sum, i) => sum + Number(i.quantity), 0),
    createdAt: order.created_at,
    createdAtShamsi: formatJalali(new Date(order.created_at)),
    paidAt: order.paid_at,
    trackingCode: null,
    items: items.map((i) => ({
      variantId: i.variant_id,
      title: i.title,
      quantity: Number(i.quantity),
      unitPriceRial: i.unit_price_rial,
      totalRial: i.total_rial,
    })),
    subtotalRial: order.subtotal_rial,
    discountRial: order.discount_rial,
    taxRial: order.tax_rial,
    shippingRial: order.shipping_rial,
    shippingAddress: order.shipping_address,
    customerNote: order.customer_note,
    timeline: hist.map((h) => ({
      fromStatus: h.from_status,
      toStatus: h.to_status,
      label: ORDER_STATUS_LABELS[h.to_status] ?? h.to_status,
      reason: h.reason,
      createdAt: h.created_at,
    })),
  };
}

// ===========================================================================
// ۷) پروفایل
// ===========================================================================

export async function updateProfile(
  db: Queryable,
  customerId: string,
  patch: { fullName?: string | null; nationalId?: string | null; email?: string | null },
): Promise<{ fullName: string | null; nationalId: string | null; email: string | null }> {
  if (patch.nationalId != null && patch.nationalId !== '') {
    if (!isValidIranianNationalId(toEnglishDigits(patch.nationalId))) {
      throw new AppError('VALIDATION', { message: 'کدِ ملی معتبر نیست.' });
    }
  }
  await db.query(
    `UPDATE customers
        SET full_name   = COALESCE($2, full_name),
            national_id = COALESCE($3, national_id),
            email       = COALESCE($4, email),
            updated_at  = now()
      WHERE id = $1`,
    [customerId, patch.fullName ?? null, patch.nationalId ?? null, patch.email ?? null],
  );
  const { rows } = await db.query<{
    full_name: string | null;
    national_id: string | null;
    email: string | null;
  }>(`SELECT full_name, national_id, email FROM customers WHERE id = $1`, [customerId]);
  return {
    fullName: rows[0]?.full_name ?? null,
    nationalId: rows[0]?.national_id ?? null,
    email: rows[0]?.email ?? null,
  };
}
