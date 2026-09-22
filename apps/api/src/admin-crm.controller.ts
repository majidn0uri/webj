import { Body, Controller, Delete, Get, Headers, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppError, formatToman } from '@set/shared-kernel';
import type { Database } from '@set/db';
import { DB } from './tokens.js';
import {
  createInteraction, listInteractions, getInteraction, updateInteraction,
  listTags, createTag, assignTag, removeTag, customerTags,
  listSegments, createSegment, evaluateSegment,
  createFollowUp, listFollowUps, completeFollowUp, cancelFollowUp,
  logActivity, listActivities,
  crmStats, customer360,
} from '@set/crm';
import type { InteractionType } from '@set/crm';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import { TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/* ════════════════════════════════════════════════════════════════════════
   CRM Controller — مدیریت ارتباط با مشتری
   ════════════════════════════════════════════════════════════════════════ */

const CreateInteractionDto = z.object({
  customerId: z.string().uuid(),
  type: z.enum(['call_incoming','call_outgoing','meeting','email','whatsapp','sms','note','complaint','feedback','follow_up']),
  subject: z.string().min(2),
  body: z.string().nullish(),
  outcome: z.string().nullish(),
  priority: z.enum(['low','normal','high','urgent']).nullish(),
  nextAction: z.string().nullish(),
  nextActionAt: z.string().nullish(),
  orderId: z.string().uuid().nullish(),
  returnId: z.string().uuid().nullish(),
});

const CreateTagDto = z.object({
  name: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullish(),
  description: z.string().nullish(),
});

const CreateSegmentDto = z.object({
  name: z.string().min(2),
  description: z.string().nullish(),
  rules: z.record(z.unknown()),
});

const CreateFollowUpDto = z.object({
  customerId: z.string().uuid(),
  interactionId: z.string().uuid().nullish(),
  title: z.string().min(2),
  description: z.string().nullish(),
  dueAt: z.string(),
  assignedTo: z.string().uuid().nullish(),
});

@Controller('admin/crm')
export class AdminCrmController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  private async require(auth: string | undefined, resource: string, action: string): Promise<AccessClaims> {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    await this.access.assert({ userId: claims.sub, branchId: null }, resource, action);
    return claims;
  }

  /* ── Dashboard ──────────────────────────────────────────────────────── */

  @Get('stats')
  async stats(@Headers('authorization') auth?: string) {
    await this.require(auth, 'customers', 'read');
    return crmStats(this.db);
  }

  /* ── 360° ────────────────────────────────────────────────────────────── */

  @Get('customer/:id/360')
  async customer360View(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ) {
    await this.require(auth, 'customers', 'read');
    return customer360(this.db, id);
  }

  /* ── تعاملات ────────────────────────────────────────────────────────── */

  @Get('interactions')
  async listInteractionsApi(
    @Query('customerId') customerId: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Headers('authorization') auth?: string,
  ) {
    await this.require(auth, 'customers', 'read');
    if (!customerId) throw new AppError('VALIDATION', { message: 'customerId الزامی است.' });
    const items = await listInteractions(this.db, {
      customerId, type: type || undefined, limit: limit ? Number(limit) : undefined,
    });
    return { items };
  }

  @Post('interactions')
  async createInteractionApi(
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ) {
    const claims = await this.require(auth, 'customers', 'write');
    const input = CreateInteractionDto.parse(body);
    const id = await createInteraction(this.db, {
      ...input,
      nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : undefined,
      createdBy: claims.sub,
    });
    return { id, message: 'تعامل ثبت شد.' };
  }

  @Get('interactions/:id')
  async getInteractionApi(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ) {
    await this.require(auth, 'customers', 'read');
    const item = await getInteraction(this.db, id);
    if (!item) throw new AppError('NOT_FOUND');
    return item;
  }

  @Patch('interactions/:id')
  async updateInteractionApi(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('authorization') auth?: string,
  ) {
    await this.require(auth, 'customers', 'write');
    await updateInteraction(this.db, id, {
      subject: body.subject as string | undefined,
      body: body.body as string | undefined,
      outcome: body.outcome as string | undefined,
      priority: body.priority as string | undefined,
      nextAction: body.nextAction as string | undefined,
      nextActionAt: body.nextActionAt ? new Date(body.nextActionAt as string) : undefined,
    });
    return { message: 'بروزرسانی شد.' };
  }

  /* ── برچسب‌ها ────────────────────────────────────────────────────────── */

  @Get('tags')
  async listTagsApi(@Headers('authorization') auth?: string) {
    await this.require(auth, 'customers', 'read');
    return { items: await listTags(this.db) };
  }

  @Post('tags')
  async createTagApi(
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ) {
    await this.require(auth, 'customers', 'write');
    const input = CreateTagDto.parse(body);
    const id = await createTag(this.db, input);
    return { id, message: 'برچسب ایجاد شد.' };
  }

  @Post('tags/assign')
  async assignTagApi(
    @Body() body: { customerId: string; tagId: string },
    @Headers('authorization') auth?: string,
  ) {
    const claims = await this.require(auth, 'customers', 'write');
    await assignTag(this.db, body.customerId, body.tagId, claims.sub);
    return { message: 'برچسب اعمال شد.' };
  }

  @Delete('tags/assign')
  async removeTagApi(
    @Body() body: { customerId: string; tagId: string },
    @Headers('authorization') auth?: string,
  ) {
    await this.require(auth, 'customers', 'write');
    await removeTag(this.db, body.customerId, body.tagId);
    return { message: 'برچسب حذف شد.' };
  }

  @Get('customer/:id/tags')
  async customerTagsApi(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ) {
    await this.require(auth, 'customers', 'read');
    return { items: await customerTags(this.db, id) };
  }

  /* ── بخش‌بندی ────────────────────────────────────────────────────────── */

  @Get('segments')
  async listSegmentsApi(@Headers('authorization') auth?: string) {
    await this.require(auth, 'customers', 'read');
    return { items: await listSegments(this.db) };
  }

  @Post('segments')
  async createSegmentApi(
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ) {
    await this.require(auth, 'customers', 'write');
    const input = CreateSegmentDto.parse(body);
    const id = await createSegment(this.db, input);
    return { id, message: 'بخش ایجاد شد.' };
  }

  @Get('segments/:id/evaluate')
  async evaluateSegmentApi(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ) {
    await this.require(auth, 'customers', 'read');
    return { items: await evaluateSegment(this.db, id) };
  }

  /* ── یادآوری پیگیری ────────────────────────────────────────────────── */

  @Get('follow-ups')
  async listFollowUpsApi(
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
    @Headers('authorization') auth?: string,
  ) {
    await this.require(auth, 'customers', 'read');
    return {
      items: await listFollowUps(this.db, {
        status: status || undefined,
        assignedTo: assignedTo || undefined,
      }),
    };
  }

  @Post('follow-ups')
  async createFollowUpApi(
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ) {
    const claims = await this.require(auth, 'customers', 'write');
    const input = CreateFollowUpDto.parse(body);
    const id = await createFollowUp(this.db, {
      ...input,
      dueAt: new Date(input.dueAt),
      createdBy: claims.sub,
    });
    return { id, message: 'یادآوری ثبت شد.' };
  }

  @Post('follow-ups/:id/complete')
  async completeFollowUpApi(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ) {
    await this.require(auth, 'customers', 'write');
    await completeFollowUp(this.db, id);
    return { message: 'انجام شد.' };
  }

  @Post('follow-ups/:id/cancel')
  async cancelFollowUpApi(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ) {
    await this.require(auth, 'customers', 'write');
    await cancelFollowUp(this.db, id);
    return { message: 'لغو شد.' };
  }

  /* ── لاگ فعالیت ────────────────────────────────────────────────────── */

  @Get('customer/:id/activities')
  async listActivitiesApi(
    @Param('id') id: string,
    @Query('type') type?: string,
    @Headers('authorization') auth?: string,
  ) {
    await this.require(auth, 'customers', 'read');
    return { items: await listActivities(this.db, { customerId: id, type: type || undefined }) };
  }

  @Post('customer/:id/activities')
  async logActivityApi(
    @Param('id') id: string,
    @Body() body: { activityType: string; metadata?: Record<string, unknown> },
    @Headers('authorization') auth?: string,
  ) {
    await this.require(auth, 'customers', 'write');
    await logActivity(this.db, { customerId: id, activityType: body.activityType, metadata: body.metadata });
    return { message: 'فعالیت ثبت شد.' };
  }
}