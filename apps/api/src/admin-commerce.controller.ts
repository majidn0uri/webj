import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@set/shared-kernel';
import {
  changeCheckStatus,
  checkCeiling,
  listChecks,
  markShipmentIssue,
  shippingOptions,
  setTariff,
  tariffFor,
  registerCheck,
  transferCheck,
  type CheckStatus,
} from '@set/commerce';
import type { Database } from '@set/db';
import type { AccessClaims, TokenService } from '@set/auth';
import type { AccessControl } from '@set/rbac';
import { ACCESS_CONTROL, DB, TOKEN_SERVICE } from './tokens.js';

const Money = z.string().regex(/^\d+$/);
const TariffDto = z.object({
  methodKey: z.string().min(1).max(32),
  methodLabel: z.string().min(2).max(80),
  city: z.string().min(2).max(80),
  costRial: Money,
  etaDays: z.number().int().min(0).max(30).default(3),
});
const CheckDto = z.object({
  checkNo: z.string().min(1).max(32),
  sayadNo: z.string().regex(/^\d{16}$/),
  bank: z.string().min(2).max(80),
  amountRial: Money,
  dueDate: z.string().datetime({ offset: true }),
  drawerId: z.string().uuid(),
  documentType: z.enum(['FS', 'SO']).nullish(),
  documentId: z.string().uuid().nullish(),
  imageUrl: z.string().max(500).nullish(),
});
const StatusDto = z.object({
  status: z.enum(['in_circulation', 'deposited', 'settled', 'transferred', 'bounced', 'void']),
  reason: z.string().min(3).max(500).nullish(),
});
const IssueDto = z.object({
  status: z.enum(['returned', 'lost']),
  note: z.string().max(500).nullish(),
});

@Controller()
export class AdminCommerceController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  private async require(
    authorization: string | undefined,
    resource: 'shipping' | 'checks',
    action: 'read' | 'write',
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    await this.access.assert({ userId: claims.sub, branchId: null }, resource, action);
    return claims;
  }

  @Get('shipping/options')
  async options(@Query('city') city?: string) {
    if (!city?.trim()) throw new AppError('VALIDATION', { message: 'شهر لازم است.' });
    return { items: await shippingOptions(this.db, city) };
  }

  @Get('admin/shipping/tariffs')
  async tariffs(@Headers('authorization') authorization: string | undefined, @Query('city') city?: string) {
    await this.require(authorization, 'shipping', 'read');
    if (city) {
      const { rows } = await this.db.query(
        `SELECT * FROM shipping_tariffs WHERE city = $1 ORDER BY method_key`,
        [city.trim()],
      );
      return { items: rows };
    }
    const { rows } = await this.db.query(`SELECT * FROM shipping_tariffs ORDER BY city, method_key`);
    return { items: rows };
  }

  @Post('admin/shipping/tariffs')
  async createTariff(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    await this.require(authorization, 'shipping', 'write');
    const input = TariffDto.parse(body);
    await setTariff(this.db, { ...input, costRial: BigInt(input.costRial) });
    return { item: await tariffFor(this.db, input.methodKey, input.city) };
  }

  @Get('admin/shipping/shipments')
  async shipments(@Headers('authorization') authorization: string | undefined, @Query('orderId') orderId?: string) {
    await this.require(authorization, 'shipping', 'read');
    const params = orderId ? [orderId] : [];
    const where = orderId ? 'WHERE order_id = $1' : '';
    const { rows } = await this.db.query(`SELECT * FROM shipments ${where} ORDER BY shipped_at DESC LIMIT 200`, params);
    return { items: rows };
  }

  @Post('admin/shipping/shipments/:id/issue')
  async issue(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const claims = await this.require(authorization, 'shipping', 'write');
    const input = IssueDto.parse(body);
    return markShipmentIssue(this.db, { shipmentId: id, ...input, actorId: claims.sub });
  }

  @Get('admin/checks')
  async checks(
    @Headers('authorization') authorization: string | undefined,
    @Query('drawerId') drawerId?: string,
    @Query('status') status?: string,
  ) {
    await this.require(authorization, 'checks', 'read');
    if (status && !['in_circulation', 'deposited', 'settled', 'transferred', 'bounced', 'void'].includes(status)) {
      throw new AppError('VALIDATION', { message: 'وضعیت چک نامعتبر است.' });
    }
    return { items: await listChecks(this.db, { drawerId, status: status as CheckStatus | undefined }) };
  }

  @Get('admin/checks/ceiling/:customerId')
  async ceiling(@Headers('authorization') authorization: string | undefined, @Param('customerId') customerId: string) {
    await this.require(authorization, 'checks', 'read');
    return checkCeiling(this.db, customerId);
  }

  @Post('admin/checks')
  async register(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    const claims = await this.require(authorization, 'checks', 'write');
    const input = CheckDto.parse(body);
    return registerCheck(this.db, {
      ...input,
      amountRial: BigInt(input.amountRial),
      dueDate: new Date(input.dueDate),
      actorId: claims.sub,
    });
  }

  @Post('admin/checks/:id/status')
  async status(@Headers('authorization') authorization: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    const claims = await this.require(authorization, 'checks', 'write');
    const input = StatusDto.parse(body);
    return changeCheckStatus(this.db, { checkId: id, toStatus: input.status, reason: input.reason, actorId: claims.sub });
  }

  @Post('admin/checks/:id/transfer')
  async transfer(@Headers('authorization') authorization: string | undefined, @Param('id') id: string, @Body() body: unknown) {
    const claims = await this.require(authorization, 'checks', 'write');
    const toParty = z.object({ toParty: z.string().min(2).max(160) }).parse(body).toParty;
    return transferCheck(this.db, { checkId: id, toParty, actorId: claims.sub });
  }
}
