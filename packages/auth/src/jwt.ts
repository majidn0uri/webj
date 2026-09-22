import { SignJWT, jwtVerify } from 'jose';

/**
 * توکن‌ها: کوتاه‌عمر برای دسترسی، بلندعمر برای تازه‌سازی — و تازه‌سازی هر بار می‌چرخد.
 * امضا با HS256 و کلیدی که فقط از متغیرهایِ محیطی می‌آید (هرگز در کد ثابت نمی‌شود).
 */
export interface AccessClaims {
  sub: string;
  roles: string[];
  branch: string | null;
  mobile: string;
}

export interface RefreshClaims {
  sub: string;
  family: string;
  jti: string;
}

export interface TokenServiceOptions {
  secret: string;
  issuer?: string;
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export class TokenService {
  private readonly key: Uint8Array;
  private readonly issuer: string;
  private readonly accessTtl: number;
  private readonly refreshTtl: number;

  constructor(opts: TokenServiceOptions) {
    this.key = new TextEncoder().encode(opts.secret);
    this.issuer = opts.issuer ?? 'set-shop';
    this.accessTtl = opts.accessTtlSeconds ?? 15 * 60; // ۱۵ دقیقه
    this.refreshTtl = opts.refreshTtlSeconds ?? 30 * 24 * 3600; // ۳۰ روز
  }

  get accessTtlSeconds(): number {
    return this.accessTtl;
  }

  get refreshTtlSeconds(): number {
    return this.refreshTtl;
  }

  async signAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({ ...claims, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(this.issuer)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtl}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: this.issuer });
      if (payload.typ !== 'access') return null;
      return {
        sub: String(payload.sub),
        roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : [],
        branch: (payload.branch as string | null) ?? null,
        mobile: String(payload.mobile ?? ''),
      };
    } catch {
      return null;
    }
  }

  async signRefresh(claims: RefreshClaims): Promise<string> {
    return new SignJWT({ ...claims, typ: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(this.issuer)
      .setIssuedAt()
      .setExpirationTime(`${this.refreshTtl}s`)
      .sign(this.key);
  }

  async verifyRefresh(token: string): Promise<RefreshClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: this.issuer });
      if (payload.typ !== 'refresh') return null;
      return {
        sub: String(payload.sub),
        family: String(payload.family ?? ''),
        jti: String(payload.jti ?? ''),
      };
    } catch {
      return null;
    }
  }

  async issuePair(access: AccessClaims, family: string, jti: string): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccess(access),
      this.signRefresh({ sub: access.sub, family, jti }),
    ]);
    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTtl,
      refreshExpiresIn: this.refreshTtl,
    };
  }
}
