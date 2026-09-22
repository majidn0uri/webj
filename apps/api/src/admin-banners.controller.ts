import { Body, Controller, Delete, Get, Headers, Inject, Param, Patch, Post } from '@nestjs/common';

import { AppError } from '@set/shared-kernel';
import { BannerService, type BannerKind } from '@set/content';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';

import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * بنرها و پیام‌هایِ ویترین.
 *
 * دو گونه مسیر اینجا کنار هم‌اند و این هم‌نشینی تصادفی نیست:
 *
 *   • مسیرِ **عمومی** (`GET /banners`) — سایت برایِ نمایشِ صفحه‌یِ نخست به آن
 *     نیاز دارد، پیش از آنکه کسی وارد شود. پس بی‌نیاز از نشست است، و فقط
 *     بنرهایِ «اکنون قابلِ نمایش» را می‌دهد: روشن، و در بازه. هیچ نشانی از
 *     بنرِ خاموش یا منقضی به بیرون درز نمی‌کند.
 *   • مسیرهایِ **پنل** (`/admin/banners`) — با دسترسیِ `banners.read` و
 *     `banners.write`، و برخلافِ مسیرِ عمومی **همه** چیز را می‌بینند؛ چون
 *     فروشنده باید بتواند بنرِ خاموش یا منقضی را هم ببیند تا ویرایشش کند یا
 *     دوباره به کارش بیندازد.
 */

const KINDS: BannerKind[] = ['announcement', 'hero', 'middle'];

function asKind(value: string): BannerKind {
  if (!KINDS.includes(value as BannerKind)) {
    throw new AppError('VALIDATION', { message: `گونه‌یِ بنر نامعتبر است: ${value}` });
  }
  return value as BannerKind;
}

/** تاریخ از رابط به‌صورتِ رشته می‌آید؛ تهی یعنی بی‌مرز */
function asDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new AppError('VALIDATION', { message: `تاریخ نامعتبر است: ${String(value)}` });
  }
  return date;
}

function text(value: unknown): string | undefined {
  return value === undefined ? undefined : value == null ? '' : String(value);
}

function optionalText(value: unknown): string | null | undefined {
  return value === undefined ? undefined : value == null ? null : String(value);
}

@Controller()
export class AdminBannersController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  private readonly banners = (): BannerService => new BannerService(this.db);

  private async require(
    authorization: string | undefined,
    permission: 'banners.read' | 'banners.write',
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    const [resource, action] = permission.split('.');
    await this.access.assert({ userId: claims.sub, branchId: null }, resource!, action!);
    return claims;
  }

  /** ── مسیرِ عمومی: آنچه سایت نشان می‌دهد ───────────────────────────── */

  @Get('banners')
  async publicBanners() {
    const banners = this.banners();
    const [announcements, heroes, middles] = await Promise.all([
      banners.visible('announcement'),
      banners.visible('hero'),
      banners.visible('middle'),
    ]);
    return { announcements, heroes, middles };
  }

  /** ── مسیرهایِ پنل ─────────────────────────────────────────────────── */

  @Get('admin/banners')
  async list(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization, 'banners.read');
    return { items: await this.banners().listAll() };
  }

  @Post('admin/banners')
  async create(@Headers('authorization') authorization: string | undefined, @Body() body: Record<string, unknown>) {
    const claims = await this.require(authorization, 'banners.write');
    const item = await this.banners().create({
      kind: asKind(String(body.kind ?? 'announcement')),
      title: text(body.title),
      body: text(body.body),
      linkUrl: optionalText(body.linkUrl),
      imageUrl: optionalText(body.imageUrl),
      placeholder: optionalText(body.placeholder),
      tone: optionalText(body.tone),
      sortOrder: body.sortOrder == null ? undefined : Number(body.sortOrder),
      startsAt: asDate(body.startsAt),
      endsAt: asDate(body.endsAt),
      isActive: body.isActive == null ? undefined : Boolean(body.isActive),
      createdBy: claims.sub,
    });
    return { item };
  }

  @Patch('admin/banners/:id')
  async update(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    await this.require(authorization, 'banners.write');
    const item = await this.banners().update(id, {
      kind: body.kind === undefined ? undefined : asKind(String(body.kind)),
      title: text(body.title),
      body: text(body.body),
      linkUrl: optionalText(body.linkUrl),
      imageUrl: optionalText(body.imageUrl),
      placeholder: optionalText(body.placeholder),
      tone: optionalText(body.tone),
      sortOrder: body.sortOrder == null ? undefined : Number(body.sortOrder),
      startsAt: asDate(body.startsAt),
      endsAt: asDate(body.endsAt),
      isActive: body.isActive == null ? undefined : Boolean(body.isActive),
    });
    if (!item) throw new AppError('NOT_FOUND', { message: 'بنر یافت نشد.' });
    return { item };
  }

  @Delete('admin/banners/:id')
  async remove(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    await this.require(authorization, 'banners.write');
    return { removed: await this.banners().remove(id) };
  }

  @Post('admin/banners/order')
  async reorder(@Headers('authorization') authorization: string | undefined, @Body() body: { ids?: string[] }) {
    await this.require(authorization, 'banners.write');
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string') : [];
    await this.banners().reorder(ids);
    return { message: 'ترتیبِ بنرها به‌روز شد.' };
  }
}
