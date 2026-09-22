import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createDatabase, applyMigrations, type Database } from '@set/db';
import { hashPassword, verifyPassword } from './password.js';
import { generateSecret, totp, verifyTotp, base32Encode, base32Decode } from './totp.js';
import { TokenService } from './jwt.js';
import { AuthService } from './service.js';

let db: Database;
const tokens = new TokenService({ secret: 'test-secret-key-for-unit-tests-only'.repeat(2) });
let auth: AuthService;

/**
 * یک پایگاه برایِ همه‌یِ آزمون‌ها، نه یکی برایِ هر آزمون.
 *
 * هر نمونه‌یِ پایگاهِ درون‌حافظه همه‌یِ ۳۰ مهاجرت را در خود دارد. با ۱۴
 * آزمون یعنی ۱۴ پایگاهِ کامل — و در این محیطِ ۲ گیگابایتی، کارگرِ آزمون در
 * میانه کشته می‌شد و آزمون‌هایی بی‌تقصیر «ناکام» یا ناتمام گزارش می‌شدند.
 * پس یک بار می‌سازیم و پس از هر آزمون، آنچه را آزمون نوشته پاک می‌کنیم.
 */
beforeAll(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  auth = new AuthService(db, tokens);
});

afterAll(async () => {
  await db.close();
});

/** بازگردانی به وضعیتِ آغازین — هر آزمون از نقطه‌ای پاک آغاز می‌کند */
afterEach(async () => {
  // نشستِ کاربر در `refresh_tokens` است (جدولِ جداگانه‌ای برای نشست نداریم)
  await db.query(`DELETE FROM refresh_tokens`);
  await db.query(`DELETE FROM users`);
  await db.query(`DELETE FROM login_attempts`);
});

describe('رمز عبور', () => {
  it('درهمه‌سازی و تأیید کار می‌کند و رمزِ اشتباه را رد می‌کند', async () => {
    const hash = await hashPassword('رمزِ-قوی-۱۲۳');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('رمزِ-قوی-۱۲۳', hash)).toBe(true);
    expect(await verifyPassword('اشتباه', hash)).toBe(false);
  });

  it('هر بار نمکِ متفاوت تولید می‌شود (دو درهمه‌ی یک رمز یکسان نیستند)', async () => {
    const a = await hashPassword('یکسان');
    const b = await hashPassword('یکسان');
    expect(a).not.toBe(b);
  });
});

describe('رمز یکبارمصرف (TOTP)', () => {
  it('کدِ تولیدشده معتبر است و کدِ اشتباه رد می‌شود', () => {
    const secret = generateSecret();
    const now = new Date();
    const code = totp(secret, now);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, { at: now })).toBe(true);
    expect(verifyTotp(secret, '000000', { at: now })).toBe(false);
  });

  it('کدِ مربوط به ۵ دقیقه پیش پذیرفته نمی‌شود', () => {
    const secret = generateSecret();
    const old = new Date(Date.now() - 5 * 60 * 1000);
    const code = totp(secret, old);
    expect(verifyTotp(secret, code, { at: new Date(), window: 1 })).toBe(false);
  });

  it('Base32 رفت و برگشت دارد', () => {
    const buf = Buffer.from([1, 2, 3, 250, 128]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
  });
});

describe('ثبت‌نام و ورود', () => {
  it('ثبت‌نام با موبایلِ ایرانی و صدور توکن', async () => {
    const result = await auth.register({ mobile: '09123456789', fullName: 'علی رضایی', password: 'رمزعبور۱۲۳' });
    expect(result.user.mobile).toBe('09123456789');
    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.expiresIn).toBe(15 * 60);
  });

  it('شماره تکراری رد می‌شود', async () => {
    await auth.register({ mobile: '09123456789', fullName: 'اولی', password: 'رمزعبور۱۲۳' });
    await expect(
      auth.register({ mobile: '09123456789', fullName: 'دومی', password: 'رمزعبور۱۲۳' }),
    ).rejects.toMatchObject({ code: 'ERR-005' });
  });

  it('قالبِ موبایل و کوتاهیِ رمز بررسی می‌شود', async () => {
    await expect(
      auth.register({ mobile: '12345', fullName: 'کسی', password: 'رمزعبور۱۲۳' }),
    ).rejects.toMatchObject({ code: 'ERR-001' });
    await expect(
      auth.register({ mobile: '09123456789', fullName: 'کسی', password: 'کوتاه' }),
    ).rejects.toMatchObject({ code: 'ERR-001' });
  });

  it('ورود با رمزِ درست موفق و با رمزِ غلط ناموفق است', async () => {
    await auth.register({ mobile: '09123456789', fullName: 'علی رضایی', password: 'رمزعبور۱۲۳' });
    const ok = await auth.login({ mobile: '09123456789', password: 'رمزعبور۱۲۳' });
    expect(ok.user.fullName).toBe('علی رضایی');

    await expect(
      auth.login({ mobile: '09123456789', password: 'اشتباه' }),
    ).rejects.toMatchObject({ code: 'ERR-004' });
  });

  it('تلاش‌های ناموفق ثبت می‌شوند (برای محدودسازی)', async () => {
    await auth.register({ mobile: '09123456789', fullName: 'علی', password: 'رمزعبور۱۲۳' });
    await auth.login({ mobile: '09123456789', password: 'غلط' }).catch(() => {});
    const { rows } = await db.query<{ success: boolean; reason: string | null }>(
      `SELECT success, reason FROM login_attempts ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows[0]?.success).toBe(false);
    expect(rows[0]?.reason).toBe('bad_credentials');
  });
});

describe('چرخش و امنیتِ توکن', () => {
  it('توکنِ تازه‌سازی می‌چرخد و استفاده‌ی دیررس در پنجره‌ی ارفاق مجاز است', async () => {
    const first = await auth.register({ mobile: '09123456789', fullName: 'علی', password: 'رمزعبور۱۲۳' });
    const rotated = await auth.refresh(first.refreshToken);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);

    // همان نسلِ پیش، درونِ پنجره‌ی ارفاق (چند برگه یا درخواستِ همزمان):
    // نباید کاربر را بیرون انداخت — زنجیره دوباره می‌چرخد
    const late = await auth.refresh(first.refreshToken);
    expect(late.refreshToken).not.toBe(rotated.refreshToken);

    // بیرونِ پنجره (نسلِ قدیمی) ⇒ استفاده‌ی مکرر رد می‌شود
    await db.query(
      `UPDATE refresh_tokens SET revoked_at = now() - interval '10 minutes' WHERE revoked_at IS NOT NULL`,
    );
    await expect(auth.refresh(first.refreshToken)).rejects.toMatchObject({ code: 'ERR-004' });
  });

  it('نشتِ توکن: استفاده از توکنِ باطل‌شده، کل خانواده را می‌بندد', async () => {
    const first = await auth.register({ mobile: '09123456789', fullName: 'علی', password: 'رمزعبور۱۲۳' });
    const second = await auth.refresh(first.refreshToken);
    const third = await auth.refresh(second.refreshToken);

    // مهاجم توکنِ قدیمی را «بیرونِ پنجره‌ی ارفاق» دوباره استفاده می‌کند
    await db.query(
      `UPDATE refresh_tokens SET revoked_at = now() - interval '10 minutes' WHERE revoked_at IS NOT NULL`,
    );
    await expect(auth.refresh(first.refreshToken)).rejects.toMatchObject({ code: 'ERR-004' });

    // حالا حتی توکنِ معتبرِ کاربر هم باید از کار بیفتد
    await expect(auth.refresh(third.refreshToken)).rejects.toMatchObject({ code: 'ERR-004' });
  });

  it('خروج، توکن را باطل می‌کند — حتی درونِ پنجره‌ی ارفاق', async () => {
    const session = await auth.register({ mobile: '09123456789', fullName: 'علی', password: 'رمزعبور۱۲۳' });
    await auth.logout(session.refreshToken);
    // خروج «جایگزین» ندارد؛ بنابراین برخلافِ چرخش، بلافاصله و برای همیشه رد می‌شود
    await expect(auth.refresh(session.refreshToken)).rejects.toMatchObject({ code: 'ERR-004' });
  });

  it('توکنِ دسترسی حاوی نقش‌هاست و با کلیدِ غلط تأیید نمی‌شود', async () => {
    await db.query(`INSERT INTO roles (key, name) VALUES ('seller', 'فروشنده') ON CONFLICT DO NOTHING`);
    const session = await auth.register({ mobile: '09123456789', fullName: 'علی', password: 'رمزعبور۱۲۳' });
    await db.query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = 'seller'`,
      [session.user.id],
    );

    const again = await auth.login({ mobile: '09123456789', password: 'رمزعبور۱۲۳' });
    const claims = await tokens.verifyAccess(again.accessToken);
    expect(claims?.roles).toContain('seller');
    expect(claims?.sub).toBe(session.user.id);

    const other = new TokenService({ secret: 'کلیدِ-دیگر-برای-تست' });
    expect(await other.verifyAccess(again.accessToken)).toBe(null);
  });
});

describe('قفلِ موقتِ حساب', () => {
  /**
   * چرا این آزمون‌ها؟ چون سقفِ مهارِ نرخ از «نشانی» می‌شمرد و حمله‌یِ امروزی
   * یک نشانی ندارد. این آزمون ثابت می‌کند شمارنده به «حساب» بسته شده است،
   * نه به نشانی: هشت کوششِ ناموفق از هشت نشانیِ گوناگون هم قفل می‌سازد.
   */
  const mobile = '09120000099';

  async function registerUser(password: string): Promise<void> {
    await db.query(
      `INSERT INTO users (mobile, full_name, password_hash, is_active)
       VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING`,
      [mobile, 'دارنده‌ی حساب', await hashPassword(password)],
    );
  }

  it('هشت کوششِ ناموفق از نشانی‌هایِ گوناگون، حساب را می‌بندد', async () => {
    await registerUser('رمز-درست-۱۲۳');

    for (let i = 0; i < 8; i++) {
      await expect(
        auth.login({ mobile, password: 'رمزِ-غلط', ip: `10.0.0.${i}` }),
      ).rejects.toMatchObject({ key: 'UNAUTHENTICATED' });
    }

    // نهمی حتی با رمزِ **درست** هم رد می‌شود — پیش از آنکه اصلاً رمز بررسی شود
    await expect(auth.login({ mobile, password: 'رمز-درست-۱۲۳', ip: '10.0.0.99' })).rejects.toMatchObject({
      key: 'RATE_LIMITED',
    });
  });

  it('کوششِ موفق شمارنده را بالا نمی‌برد (ورودِ پیاپی حساب را نمی‌بندد)', async () => {
    await registerUser('رمز-درست-۱۲۳');

    for (let i = 0; i < 5; i++) {
      const result = await auth.login({ mobile, password: 'رمز-درست-۱۲۳', ip: '10.0.0.50' });
      expect(result.accessToken).toBeTruthy();
    }

    // هنوز می‌توان وارد شد: آنچه قفل می‌سازد خطاست، نه ورود
    const again = await auth.login({ mobile, password: 'رمز-درست-۱۲۳', ip: '10.0.0.50' });
    expect(again.accessToken).toBeTruthy();
  });

  it('پیامِ قفل نمی‌گوید چنین حسابی وجود دارد یا نه', async () => {
    // شماره‌ای که اصلاً در سامانه نیست هم همان پیام را می‌گیرد
    await expect(auth.login({ mobile: '09120000098', password: 'هرچه', ip: '10.0.0.1' })).rejects.toMatchObject(
      { key: 'UNAUTHENTICATED' },
    );
  });
});
