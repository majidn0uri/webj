import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from '@nestjs/common';
import { AppError, formatJalali, formatToman, parseJalali } from '@set/shared-kernel';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import {
  createInvoiceForOrder,
  currentJalaliMonth,
  inquirePending,
  listQueue,
  productsMissingSstid,
  queueStats,
  readTaxSettings,
  rebuildUnsentCreditNote,
  retryNow,
  retryStuck,
  sendDueBatch,
  setProductSstid,
  vatReturn,
  clientForCredentials,
  clientForMode as resolveClient,
  credentialStatus,
  loadCredentialPem,
  revokeCredential,
  saveCredential,
  testSigning,
  VaultError,
  type CredentialKind,
  TAX_STATUS_LABEL,
} from '@set/tax';
import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * مالیات و سامانه‌یِ مؤدیان.
 *
 * چرا این مسیرها جدا از «گزارش‌ها» هستند؟ چون مخاطب و ریسک‌شان فرق دارد:
 *   • گزارش‌ها برای تصمیم‌اند (اگر یک روز عقب بمانند، چیزی جریمه نمی‌شود)؛
 *   • اینجا برایِ **تکلیفِ قانونی** است (ارسالِ نشدن یعنی جریمه و از دست رفتنِ
 *     اعتبارِ مالیاتیِ خریدار).
 * برای همین دسترسیِ جدا (`tax.send`) دارد: کسی که فقط می‌بیند نمی‌تواند
 * بفرستد، و ارسالِ دسته‌ای همیشه با ثبتِ نتیجه همراه است تا «فرستادیم یا نه»
 * هیچ‌وقت حدس نماند.
 *
 * یک قاعده‌یِ دیگر: هیچ مسیری به اینترنت وصل نمی‌شود مگر آنکه حالتِ
 * `production` تنظیم شده باشد. در حالتِ آزمایشی، ارسال شبیه‌سازی می‌شود تا مدیر
 * بتواند خطاهایِ داده‌ای را پیش از روزِ رسمی ببیند و درست کند.
 */

/** تاریخِ شمسی یا میلادی را به Date تبدیل می‌کند */
function toDate(input: string | undefined, fallback: Date, endOfDay = false): Date {
  if (!input) return fallback;
  const jalali = parseJalali(input);
  if (jalali) {
    if (endOfDay) return new Date(jalali.getTime() + 24 * 60 * 60 * 1000 - 1);
    return jalali;
  }
  const iso = new Date(input);
  if (!Number.isNaN(iso.getTime())) return iso;
  throw new AppError('VALIDATION', {
    message: `تاریخ نامعتبر است: «${input}». مانندِ ${formatJalali(new Date())} وارد کنید.`,
  });
}

@Controller('admin/tax')
export class AdminTaxController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  private async require(
    authorization: string | undefined,
    permission: 'tax.read' | 'tax.send' | 'tax.settings.update',
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    const [resource, action] = permission.split('.');
    await this.access.assert({ userId: claims.sub, branchId: null }, resource!, action!);
    return claims;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // گاوصندوقِ گواهی
  //
  // چرا این بخش اینجاست و در یک کنترلرِ جدا نیست؟ چون گواهی از تنظیماتِ مالیات
  // جدایی‌ناپذیر است: مدیر یک جا می‌آید تا ببیند «می‌توانم بفرستم یا نه»، و
  // همان‌جا باید بشود گواهی را بارگذاری کرد و آزمود. پراکندگیِ این دو یعنی
  // مدیر میانِ دو صفحه می‌گردد تا یک کار را انجام دهد.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * کلاینتِ واقعی: مدارک را از گاوصندوق می‌خواند، نه از مسیرِ فایل.
   *
   * ترتیبِ اهمیت: اگر گاوصندوق باز نباشد (نبودِ SET_MASTER_KEY) یا گواهی
   * بارگذاری نشده باشد، پیام باید بگوید دقیقاً چه کم است — نه اینکه با
   * یک خطایِ عمومیِ «ارسال ناموفق بود» مدیر را سرگردان کند.
   */
  private async productionClient(settings: { clientId: string; fiscalId: string }): Promise<ReturnType<typeof clientForCredentials>> {
    const [privateKeyPem, certificatePem, publicKeyPem] = await Promise.all([
      loadCredentialPem(this.db, 'private_key'),
      loadCredentialPem(this.db, 'certificate'),
      loadCredentialPem(this.db, 'public_key'),
    ]);
    return clientForCredentials({
      clientId: settings.clientId,
      fiscalId: settings.fiscalId,
      privateKeyPem,
      certificatePem,
      publicKeyPem,
    });
  }

  /** وضعیتِ گاوصندوق: چه داریم، تا کِی معتبر است، و چه کم است */
  @Get('certificate')
  async certificate(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization, 'tax.read');
    return credentialStatus(this.db);
  }

  /**
   * بارگذاریِ کلید یا گواهی.
   *
   * چرا «متن» (PEM) می‌گیریم و نه پرونده؟ چون فروشنده گواهی را معمولاً به
   * صورتِ یک فایلِ متنی از مرجع می‌گیرد؛ چسباندنِ متن در یک کادر ساده‌تر از
   * بالاگذاریِ فایل است، و در خطایِ «این فایل پرونده نیست» هم ابهامی نیست.
   */
  @Post('certificate')
  async uploadCertificate(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { kind?: string; pem?: string; label?: string },
  ) {
    const claims = await this.require(authorization, 'tax.settings.update');
    const kind = (body.kind ?? '') as CredentialKind;
    if (!['private_key', 'certificate', 'public_key'].includes(kind)) {
      throw new AppError('VALIDATION', {
        message: 'نوعِ مدرك باید یکی از «private_key»، «certificate» یا «public_key» باشد.',
      });
    }
    try {
      const facts = await saveCredential(this.db, {
        kind,
        pem: body.pem ?? '',
        label: body.label ?? '',
        userId: claims.sub,
      });
      return { saved: facts, status: await credentialStatus(this.db) };
    } catch (err) {
      if (err instanceof VaultError) {
        throw new AppError('VALIDATION', { message: err.message, details: { code: err.code } });
      }
      throw err;
    }
  }

  /** حذف/ابطالِ یک مدرك — برایِ تعویض یا پس از افشایِ احتمالی */
  @Post('certificate/revoke')
  async revokeCertificate(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { kind?: string },
  ) {
    await this.require(authorization, 'tax.settings.update');
    const kind = (body.kind ?? '') as CredentialKind;
    if (!['private_key', 'certificate', 'public_key'].includes(kind)) {
      throw new AppError('VALIDATION', { message: 'نوعِ مدرك نامعتبر است.' });
    }
    const revoked = await revokeCredential(this.db, kind);
    return { revoked, status: await credentialStatus(this.db) };
  }

  /**
   * آزمایشِ امضا: بی‌هیچ ارتباطی با سازمان.
   *
   * چرا این دکمه ارزشش را دارد؟ چون نخستین ارسالِ واقعی معمولاً در آخرین
   * روزِ مهلت انجام می‌شود؛ اگر همان‌جا معلوم شود کلید با گواهی جفت نیست،
   * فرصتِ اصلاح از دست رفته است. اینجا همان خطا را در یک ثانیه می‌بینیم.
   */
  @Post('certificate/test')
  async testCertificate(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization, 'tax.settings.update');
    return testSigning(this.db);
  }

  /** خلاصه‌یِ یک نگاه: چند صورتحساب در صف مانده و وضعیتِ تنظیمات چیست */
  @Get('summary')
  async summary(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization, 'tax.read');
    const [stats, settings, missing] = await Promise.all([
      queueStats(this.db),
      readTaxSettings(this.db),
      productsMissingSstid(this.db, 5),
    ]);
    return {
      queue: {
        ...stats,
        byStatusLabel: Object.fromEntries(
          Object.entries(stats.byStatus).map(([k, v]) => [
            TAX_STATUS_LABEL[k] ?? k,
            v,
          ]),
        ),
        oldestQueuedFa: stats.oldestQueuedAt
          ? formatJalali(new Date(stats.oldestQueuedAt), 'yyyy/MM/dd HH:mm')
          : null,
      },
      settings: {
        enabled: settings.enabled,
        mode: settings.mode,
        fiscalId: settings.fiscalId,
        nationalId: settings.nationalId,
        autoSend: settings.autoSend,
        ready: Boolean(settings.fiscalId && settings.nationalId && settings.postalCode),
      },
      missingSstid: { count: missing.length, samples: missing.map((p) => p.title) },
    };
  }

  /** اظهارنامه‌یِ ارزش‌افزوده در یک بازه (مالیاتِ برون‌داد − درون‌داد) */
  @Get('vat-return')
  async vat(
    @Headers('authorization') authorization: string | undefined,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.require(authorization, 'tax.read');
    const period = currentJalaliMonth();
    const fromDate = toDate(from, new Date(period.fromIso));
    const toDate_ = toDate(to, new Date(period.toIso), true);
    if (fromDate.getTime() >= toDate_.getTime()) {
      throw new AppError('VALIDATION', { message: 'تاریخِ آغاز باید پیش از پایان باشد.' });
    }
    const report = await vatReturn(this.db, {
      fromIso: fromDate.toISOString(),
      toIso: toDate_.toISOString(),
      key: period.key,
    });
    return {
      report,
      display: {
        from: formatJalali(fromDate),
        to: formatJalali(toDate_),
        outputVat: formatToman(BigInt(report.output.vatRial)),
        inputVat: formatToman(BigInt(report.input.vatRial)),
        netPayable: formatToman(
          report.netPayableRial.startsWith('-')
            ? -BigInt(report.netPayableRial.slice(1))
            : BigInt(report.netPayableRial),
        ),
        sales: formatToman(BigInt(report.output.salesRial)),
        purchases: formatToman(BigInt(report.input.purchasesRial)),
        direction: report.direction === 'payable' ? 'بدهکار' : 'بستانکار (اعتبار)',
      },
    };
  }

  /** فهرستِ صف با امکانِ پالایش بر پایه‌یِ وضعیت و دوره */
  @Get('invoices')
  async invoices(
    @Headers('authorization') authorization: string | undefined,
    @Query('status') status?: string,
    @Query('period') period?: string,
    /** «sale» یا «credit_note» — برای دیدنِ فقطِ صورتحساب‌هایِ اصلاحیِ مرجوعی */
    @Query('kind') kind?: string,
    @Query('limit') limit?: string,
  ) {
    await this.require(authorization, 'tax.read');
    const allowed = ['queued', 'sending', 'sent', 'accepted', 'rejected', 'failed'];
    const rows = await listQueue(this.db, {
      status: status && allowed.includes(status) ? (status as never) : null,
      periodKey: period ?? null,
      kind: kind === 'credit_note' ? 'credit_note' : kind === 'sale' ? 'sale' : null,
      limit: Math.min(500, Math.max(1, Number(limit ?? 100) || 100)),
    });
    return {
      invoices: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        kindLabel: r.kind === 'credit_note' ? 'اصلاحیِ مرجوعی' : 'فروش',
        orderNo: r.orderNo,
        periodKey: r.periodKey,
        taxid: r.taxid,
        status: r.status,
        statusLabel: TAX_STATUS_LABEL[r.status] ?? r.status,
        uid: r.uid,
        errorCode: r.errorCode,
        errorDetail: r.errorDetail,
        attempts: r.attempts,
        createdAtFa: formatJalali(new Date(r.createdAt), 'yyyy/MM/dd HH:mm'),
        sentAtFa: r.sentAt ? formatJalali(new Date(r.sentAt), 'yyyy/MM/dd HH:mm') : null,
      })),
    };
  }

  /**
   * ساختِ صورتحساب برای یک سفارش (بدونِ ارسال).
   *
   * ساخت از ارسال جداست تا مدیر بتواند پیش از فرستادن، بسته را ببیند و خطایش
   * را بخواند؛ و تا یک صورتحسابِ ناقص در صف نماند، ارسالِ دسته‌ای آن را رد می‌کند.
   */
  @Post('invoices/for-order/:orderId')
  async createForOrder(
    @Headers('authorization') authorization: string | undefined,
    @Param('orderId') orderId: string,
  ) {
    await this.require(authorization, 'tax.send');
    const result = await createInvoiceForOrder(this.db, orderId);
    return {
      ...result,
      message:
        result.validationErrors.length > 0
          ? `صورتحساب ساخته شد اما ${result.validationErrors.length} ایراد دارد و ارسال نمی‌شود.`
          : 'صورتحساب ساخته شد و در صفِ ارسال است.',
    };
  }

  /**
   * ارسالِ دسته‌ای + استعلامِ وضعیت.
   *
   * چرا هر دو با هم؟ چون ارسال قطعیت نمی‌آورد؛ استعلام می‌آورد. ترکیب‌شان در
   * یک فراخوان یعنی مدیر با یک کلیک از «در صف» به «تأییدشده» می‌رسد.
   */
  @Post('send-batch')
  async sendBatch(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { limit?: number } = {},
  ) {
    await this.require(authorization, 'tax.send');
    const settings = await readTaxSettings(this.db);
    if (!settings.fiscalId) {
      throw new AppError('VALIDATION', {
        message: 'پیش از ارسال، «شناسه‌یِ یکتایِ حافظه‌یِ مالیاتی» را در تنظیمات وارد کنید.',
      });
    }
    const client =
      settings.mode === 'production'
        ? await this.productionClient(settings)
        : resolveClient('sandbox');

    // ردیف‌هایی که در «در حالِ ارسال» مانده‌اند (خاموشیِ ناگهانی) آزاد می‌شوند
    const freed = await retryStuck(this.db, 15);

    const batch = await sendDueBatch(
      this.db,
      client,
      Math.min(100, Math.max(1, body.limit ?? 20)),
    );
    const inquiry = await inquirePending(this.db, client, 50);

    return {
      mode: settings.mode,
      freedStuckRows: freed,
      batch,
      inquiry,
      message: `ارسال: ${batch.sent} موفق، ${batch.failed} ناموفق. استعلام: ${inquiry.accepted} تأیید شد.${
        settings.mode === 'sandbox' ? ' (حالتِ آزمایشی: ارتباطِ واقعی برقرار نشد)' : ''
      }`,
    };
  }

  /**
   * تلاشِ دوباره برای یک صورتحسابِ ناموفق یا ردشده.
   *
   * دو علتِ کاملاً متفاوت با یک دکمه پاسخ داده می‌شود و مدیر نباید تفاوتشان
   * را بداند:
   *   • **خطایِ شبکه** (بسته درست بود، نرسید) → همان بسته دوباره در صف
   *     می‌رود؛
   *   • **خطایِ داده** (مثلِ نبودنِ شناسه‌یِ کالا) → بسته از نو ساخته می‌شود،
   *     چون فرستادنِ دوباره‌یِ همان بسته‌یِ ناقص فقط وقت و سریال مصرف می‌کند.
   */
  @Post('invoices/:id/retry')
  async retry(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    await this.require(authorization, 'tax.send');
    const rebuilt = await rebuildUnsentCreditNote(this.db, id);
    if (rebuilt.rebuilt) {
      return {
        message:
          rebuilt.validationErrors.length > 0
            ? `بسته از نو ساخته شد، اما هنوز ایراد دارد: ${rebuilt.validationErrors.join(' ')}`
            : 'بسته از نو ساخته شد و در صف قرار گرفت.',
        rebuilt: true,
        taxid: rebuilt.taxid,
      };
    }
    await retryNow(this.db, id);
    return { message: 'صورتحساب دوباره در صف قرار گرفت.', rebuilt: false };
  }

  /** کالاهایی که «شناسه‌یِ کالا/خدمت» ندارند — کارِ عقب‌افتاده‌یِ فروشگاه */
  @Get('missing-sstid')
  async missingSstid(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization, 'tax.read');
    const rows = await productsMissingSstid(this.db, 200);
    return { products: rows, count: rows.length };
  }

  /** ثبتِ شناسه‌یِ کالا/خدمت برای یک محصول */
  @Post('products/:id/sstid')
  async setSstid(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: { sstid?: string; unit?: string } = {},
  ) {
    await this.require(authorization, 'tax.settings.update');
    const sstid = String(body.sstid ?? '').trim();
    if (!sstid) {
      throw new AppError('VALIDATION', { message: 'شناسه‌یِ کالا/خدمت را وارد کنید.' });
    }
    await setProductSstid(this.db, { productId: id, sstid, unit: body.unit ?? undefined });
    return { message: 'شناسه‌یِ کالا/خدمت ثبت شد.' };
  }
}
