import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { type AppConfig } from './config.js';
import { CONFIG, DB } from './tokens.js';
import { AUTH_SERVICE, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';
import type { AuthService } from '@set/auth';
import type { TokenService } from '@set/auth';
import type { AccessControl } from '@set/rbac';
import type { Database } from '@set/db';
import { AppError, formatToman } from '@set/shared-kernel';
import { recordAudit, publishEvent } from '@set/db';
import { effectiveVatBasisPoints } from '@set/orders';

const RegisterDto = z.object({
  mobile: z.string().min(10),
  fullName: z.string().min(3),
  password: z.string().min(8),
});

const LoginDto = z.object({ mobile: z.string().min(10), password: z.string().min(1) });
const RefreshDto = z.object({ refreshToken: z.string().min(10) });

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH_SERVICE) private readonly auth: AuthService,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('register')
  async register(@Body() body: unknown, @Req() req: FastifyRequest) {
    const input = RegisterDto.parse(body);
    const result = await this.auth.register(input);
    await this.auditAndPublish(result.user.id, 'user.registered', 'user', result.user.id, {
      mobile: result.user.mobile,
    }, req);
    return { user: result.user, accessToken: result.accessToken, refreshToken: result.refreshToken };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: FastifyRequest) {
    const input = LoginDto.parse(body);
    const result = await this.auth.login({
      mobile: input.mobile,
      password: input.password,
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
    await this.auditAndPublish(result.user.id, 'user.logged_in', 'user', result.user.id, null, req);
    return { user: result.user, accessToken: result.accessToken, refreshToken: result.refreshToken };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: unknown) {
    const { refreshToken } = RefreshDto.parse(body);
    const result = await this.auth.refresh(refreshToken);
    return { user: result.user, accessToken: result.accessToken, refreshToken: result.refreshToken };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Body() body: unknown) {
    const { refreshToken } = RefreshDto.parse(body);
    await this.auth.logout(refreshToken);
    return { ok: true };
  }

  /**
   * «من کی‌ام؟» — هویت، نقش‌ها و دسترسی‌هایِ مؤثرِ کاربرِ نشست.
   *
   * پنل با همین یک فراخوانی می‌فهمد کدام بخش‌ها را نشان دهد؛ بنابراین
   * دسترسی‌ها باید *واقعی* باشند (مستقیم + ارث‌بری)، نه فهرستی ثابت که
   * با تغییرِ نقش‌ها از اعتبار بیفتد.
   */
  @Get('me')
  async me(@Headers('authorization') authorization?: string) {
    const claims = await this.currentUser(authorization);
    const permissions = await this.access.permissionsFor(claims.sub, claims.branch);

    const { rows } = await this.db.query<{ full_name: string | null; is_active: boolean }>(
      `SELECT full_name, is_active FROM users WHERE id = $1`,
      [claims.sub],
    );
    const user = rows[0];

    return {
      id: claims.sub,
      mobile: claims.mobile,
      fullName: user?.full_name ?? null,
      isActive: user?.is_active ?? true,
      roles: claims.roles,
      branch: claims.branch,
      permissions,
      // نرخِ **مؤثر** (تنظیمِ پنل، وگرنه محیط) — همان که سفارش با آن حساب
      // می‌شود. پیش‌تر تنظیماتِ محیط گزارش می‌شد و اگر مدیر نرخ را در پنل
      // عوض می‌کرد، این پاسخ عددِ کهنه می‌داد: یک «سرِ درست» که عمداً گمراه
      // می‌کند بدتر از نبودِ آن است، پس یا درست باشد یا نباشد — اینجا درست است.
      vat_rate_bp: await effectiveVatBasisPoints(this.db),
    };
  }

  /** نمونه‌ی نمایشِ عددیِ پول با فرمتِ تومان (بخش Q-2) */
  @Get('me/sample-price')
  async sample(@Headers('authorization') authorization?: string) {
    await this.currentUser(authorization);
    return { rial: '2550000', display: formatToman(2_550_000n) };
  }

  private async currentUser(authorization?: string) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED', { message: 'توکن نامعتبر یا منقضی شده است' });
    return claims;
  }

  private async auditAndPublish(
    actorId: string,
    action: string,
    entity: string,
    entityId: string,
    after: unknown,
    req: FastifyRequest,
  ): Promise<void> {
    await recordAudit(this.db, { actorUserId: actorId, action, entity, entityId, after, ip: req.ip ?? null });
    await publishEvent(this.db, {
      aggregate: entity,
      aggregateId: entityId,
      eventType: action,
      payload: { after },
    });
  }
}
