import { randomUUID } from 'node:crypto';
import type { Database } from '@set/db';
import { AppError, normalizeMobile, isValidMobile } from '@set/shared-kernel';
import { hashPassword, verifyPassword, hashToken } from './password.js';
import type { TokenService, TokenPair, AccessClaims } from './jwt.js';

export interface RegisterInput {
  mobile: string;
  fullName: string;
  password: string;
}

export interface LoginInput {
  mobile: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuthResult extends TokenPair {
  user: { id: string; mobile: string; fullName: string; roles: string[] };
}

/**
 * پنجره‌ی ارفاقِ چرخش (ثانیه).
 *
 * چرا وجود دارد؟ چون چرخشِ بی‌درنگِ توکنِ تازه‌سازی با دنیایِ واقعی جور درنمی‌آید:
 * مرورگر چند برگه دارد، نکست پیوندها را پیش‌بارگیری می‌کند، و چند درخواست می‌توانند
 * همزمان با «یک» توکنِ تازه‌سازی برسند. اگر هر بار استفاده از توکنِ قبلی «سرقت»
 * انگاشته شود، کاربرِ بی‌گناهی که دو برگه باز کرده است کلِ خانواده‌اش می‌سوزد و
 * بی‌دلیل به صفحه‌ی ورود پرتاب می‌شود.
 *
 * با این پنجره:
 *   • استفاده‌ی دیررس از «همان نسلِ پیش» (تا ۶۰ ثانیه) پذیرفته می‌شود و زنجیره
 *     می‌چرخد — رفتارِ استانداردِ OAuth ۲.۱ برایِ کلاینت‌هایِ چندرشته‌ای؛
 *   • استفاده از نسل‌هایِ قدیمی‌تر (بیرونِ پنجره) همچنان نشت انگاشته می‌شود و
 *     کلِ خانواده باطل می‌گردد؛
 *   • خروج (که replaced_by ندارد) هرگز در این ارفاق راه نمی‌یابد.
 */
const REFRESH_GRACE_SECONDS = 60;

/** پس از چند کوششِ ناموفق، حساب برایِ مدتی بسته می‌شود */
const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

interface UserRow {
  id: string;
  mobile: string;
  full_name: string;
  password_hash: string | null;
  is_active: boolean;
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly tokens: TokenService,
  ) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    const mobile = normalizeMobile(input.mobile);
    if (!isValidMobile(mobile)) throw new AppError('VALIDATION', { details: { mobile: 'قالب موبایل درست نیست' } });
    if (input.password.length < 8) {
      throw new AppError('VALIDATION', { details: { password: 'رمز عبور حداقل ۸ نویسه' } });
    }

    const passwordHash = await hashPassword(input.password);
    let row: UserRow;
    try {
      const { rows } = await this.db.query<UserRow>(
        `INSERT INTO users (mobile, full_name, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, mobile, full_name, password_hash, is_active`,
        [mobile, input.fullName.trim(), passwordHash],
      );
      row = rows[0]!;
    } catch (e) {
      const msg = String((e as Error).message ?? '');
      if (msg.includes('ux_users_mobile_active') || msg.includes('duplicate key')) {
        throw new AppError('CONFLICT', { details: { mobile: 'این شماره قبلاً ثبت شده است' } });
      }
      throw e;
    }

    return this.issueForUser(row);
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const mobile = normalizeMobile(input.mobile);

    // ── قفلِ موقتِ حساب ───────────────────────────────────────────────────
    // چرا به مهارِ نرخِ نشانی بسنده نمی‌کنیم؟ چون آن سقف از «نشانی» می‌شمرد و
    // حمله‌یِ امروزی از یک نشانی نمی‌آید: هزار ربات، هر کدام یک کوشش. پس
    // شمارنده را به «خودِ حساب» می‌بندیم، نه به نشانی — هر حساب سهمیه‌یِ
    // خطایِ خودش را دارد.
    //
    // پنجره کوتاه است (۱۵ دقیقه) تا قفل به ابزارِ آزار تبدیل نشود: کسی که
    // رمزِ مدیر را پیدا می‌کند، ۱۵ دقیقه صبر می‌کند و دوباره می‌آید؛ اما کسی
    // که ۵ میلیون رمز را می‌آزماید، همان‌جا متوقف می‌شود.
    await this.assertNotLocked(mobile);

    const { rows } = await this.db.query<UserRow>(
      `SELECT id, mobile, full_name, password_hash, is_active FROM users WHERE mobile = $1 AND is_active = true`,
      [mobile],
    );
    const user = rows[0];

    const okPassword = user?.password_hash
      ? await verifyPassword(input.password, user.password_hash)
      : false;

    await this.db.query(
      `INSERT INTO login_attempts (mobile, ip, success, reason) VALUES ($1, $2, $3, $4)`,
      [mobile, input.ip ?? null, okPassword, okPassword ? null : 'bad_credentials'],
    );

    if (!user || !okPassword) {
      // پیامِ عمومی — نباید معلوم شود کدام بخش اشتباه بوده است
      throw new AppError('UNAUTHENTICATED', { message: 'شماره موبایل یا رمز عبور نادرست است' });
    }

    return this.issueForUser(user);
  }

  /**
   * اگر این شماره در ۱۵ دقیقه‌یِ گذشته بیش از اندازه رمزِ غلط زده باشد،
   * کوششِ تازه را بی‌هیچ بررسیِ رمزی رد می‌کنیم.
   *
   * دو نکته‌یِ ظریف:
   *   • شمارشِ کوششِ **ناموفق** است، نه همه‌یِ کوشش‌ها؛ وگرنه ورودِ موفقِ
   *     پشتِ هم (مثلاً چند دستگاه) حساب را قفل می‌کرد.
   *   • پیام همان پیامِ همیشگی است. گفتنِ «حساب قفل شد» یعنی تأییدِ اینکه
   *     این شماره در سامانه هست — همان نشتی که پیامِ «رمز غلط است» با دقت
   *     پنهانش می‌کند. مدت را می‌گوییم (برایِ اینکه کاربر بداند چه کند)،
   *     وجودِ حساب را نه.
   */
  private async assertNotLocked(mobile: string): Promise<void> {
    const { rows } = await this.db.query<{ failed: string }>(
      `SELECT COUNT(*)::text AS failed
         FROM login_attempts
        WHERE mobile = $1 AND success = false AND created_at > now() - interval '15 minutes'`,
      [mobile],
    );
    const failed = Number(rows[0]?.failed ?? 0);
    if (failed >= MAX_FAILED_LOGINS) {
      throw new AppError('RATE_LIMITED', {
        message: `کوششِ ورود بیش از اندازه بود. ${LOCK_MINUTES} دقیقه‌یِ دیگر دوباره بکوشید.`,
        details: { retryAfterSeconds: LOCK_MINUTES * 60 },
      });
    }
  }


  /**
   * چرخشِ توکنِ تازه‌سازی + تشخیصِ نشت:
   * اگر توکنی که قبلاً باطل شده دوباره استفاده شود، کلِ خانواده باطل می‌شود.
   */
  async refresh(refreshToken: string): Promise<AuthResult> {
    const claims = await this.tokens.verifyRefresh(refreshToken);
    if (!claims) throw new AppError('UNAUTHENTICATED', { message: 'توکن نامعتبر است' });

    const tokenHash = hashToken(refreshToken);
    const { rows } = await this.db.query<{
      id: string;
      user_id: string;
      family_id: string;
      revoked_at: string | null;
      replaced_by: string | null;
      expires_at: string;
    }>(
      `SELECT id, user_id, family_id, revoked_at, replaced_by, expires_at
         FROM refresh_tokens WHERE token_hash = $1`,
      [tokenHash],
    );
    const record = rows[0];

    if (!record) throw new AppError('UNAUTHENTICATED', { message: 'توکن شناخته‌شده نیست' });

    if (record.revoked_at) {
      const revokedAge = (Date.now() - new Date(record.revoked_at).getTime()) / 1000;
      const lateReplay =
        record.replaced_by !== null && revokedAge <= REFRESH_GRACE_SECONDS;

      // خروجِ صریحِ کاربر replaced_by ندارد و هرگز بخشوده نمی‌شود؛
      // استفاده‌ی دیررسِ درونِ پنجره ادامه می‌یابد و زنجیره دوباره می‌چرخد.
      if (!lateReplay) {
        // استفاده‌ی مجدد از توکنِ مصرف‌شده ⇒ احتمالِ سرقت ⇒ باطل کردنِ کل خانواده
        await this.db.query(
          `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
          [record.family_id],
        );
        throw new AppError('UNAUTHENTICATED', { message: 'نشتِ توکن شناسایی شد؛ لطفاً دوباره وارد شوید' });
      }
    }

    if (new Date(record.expires_at).getTime() < Date.now()) {
      throw new AppError('UNAUTHENTICATED', { message: 'توکن منقضی شده است' });
    }

    const { rows: userRows } = await this.db.query<UserRow>(
      `SELECT id, mobile, full_name, password_hash, is_active FROM users WHERE id = $1 AND is_active = true`,
      [record.user_id],
    );
    const user = userRows[0];
    if (!user) throw new AppError('UNAUTHENTICATED');

    // چرخشِ اتمیک: امضای توکنِ جدید، درجِ هشِ آن، و ابطالِ قبلی در یک تراکنش
    const newJti = randomUUID();
    const accessClaims = await this.buildAccessClaims(user);
    const [accessToken, newRefreshToken] = await Promise.all([
      this.tokens.signAccess(accessClaims),
      this.tokens.signRefresh({ sub: user.id, family: record.family_id, jti: newJti }),
    ]);

    await this.db.transaction(async (tx) => {
      const { rows: inserted } = await tx.query<{ id: string }>(
        `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '30 days')
         RETURNING id`,
        [user.id, record.family_id, hashToken(newRefreshToken)],
      );
      await tx.query(
        `UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $1 WHERE id = $2`,
        [inserted[0]!.id, record.id],
      );
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: this.tokens.accessTtlSeconds,
      refreshExpiresIn: this.tokens.refreshTtlSeconds,
      user: { id: user.id, mobile: user.mobile, fullName: user.full_name, roles: accessClaims.roles },
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
  }

  private async issueForUser(user: UserRow): Promise<AuthResult> {
    const familyId = randomUUID();
    const jti = randomUUID();
    const claims = await this.buildAccessClaims(user);
    const pair = await this.tokens.issuePair(claims, familyId, jti);
    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '30 days')`,
      [user.id, familyId, hashToken(pair.refreshToken)],
    );
    return {
      ...pair,
      user: { id: user.id, mobile: user.mobile, fullName: user.full_name, roles: claims.roles },
    };
  }

  private async buildAccessClaims(user: UserRow): Promise<AccessClaims> {
    const { rows } = await this.db.query<{ key: string }>(
      `SELECT r.key FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1`,
      [user.id],
    );
    return {
      sub: user.id,
      roles: rows.map((r) => r.key),
      branch: null,
      mobile: user.mobile,
    };
  }
}
