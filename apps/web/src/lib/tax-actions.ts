'use server';

import { adminGet, adminPost, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

/**
 * کنش‌هایِ مالیات و سامانه‌یِ مؤدیان — سمتِ سرور.
 *
 * چرا از مسیرِ سرور؟ چون توکن در کوکیِ HttpOnly است و چون ارسالِ صورتحساب
 * یک «عملِ حساس» است: نباید بتوان آن را با یک درخواستِ دستی از کنسولِ مرورگر
 * تکرار کرد. اینجا هر عمل با اجازه‌یِ نقش سنجیده می‌شود و پیامِ خطا به فارسی
 * برمی‌گردد (سامانه‌یِ مؤدیان خطاها را با کدهایِ چندرقمی می‌گوید که برایِ
 * مدیر معنایی ندارد).
 */

export interface TaxQueueItem {
  id: string;
  /** «sale» (فروش) یا «credit_note» (اصلاحیِ مرجوعی) */
  kind: string;
  kindLabel: string;
  orderNo: string;
  periodKey: string;
  taxid: string | null;
  status: string;
  statusLabel: string;
  uid: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  attempts: number;
  createdAtFa: string;
  sentAtFa: string | null;
}

export interface TaxSettingsView {
  enabled: boolean;
  mode: string;
  fiscalId: string;
  nationalId: string;
  autoSend: boolean;
  ready: boolean;
}

export interface TaxSummary {
  queue: {
    byStatus: Record<string, number>;
    byStatusLabel: Record<string, number>;
    total: number;
    oldestQueuedFa: string | null;
  };
  settings: TaxSettingsView;
  missingSstid: { count: number; samples: string[] };
}

export interface VatReturnView {
  period: { key: string; fromIso: string; toIso: string };
  output: {
    salesRial: string;
    vatRial: string;
    orderCount: number;
    byRate: Array<{ ratePercent: string; taxableRial: string; vatRial: string; lines: number }>;
  };
  input: { purchasesRial: string; vatRial: string; invoiceCount: number };
  netPayableRial: string;
  direction: 'payable' | 'credit';
  warnings: Array<{ kind: string; count: number; detail: string }>;
}

export interface VatReturnPayload {
  report: VatReturnView;
  display: {
    from: string;
    to: string;
    outputVat: string;
    inputVat: string;
    netPayable: string;
    sales: string;
    purchases: string;
    direction: string;
  };
}

export type ActionResult<T = undefined> =
  | ({ ok: true; message: string } & (T extends undefined ? { data?: never } : { data: T }))
  | { ok: false; message: string };

async function messageOf(err: unknown): Promise<string> {
  if (err instanceof AdminApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return 'ارتباط با سامانه برقرار نشد؛ دوباره تلاش کنید.';
}

/** خلاصه‌یِ یک‌نگاه: صف، آمادگیِ تنظیمات، کالاهایِ بی‌شناسه */
export async function loadTaxSummary(): Promise<ActionResult<TaxSummary>> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
  try {
    const data = await adminGet<TaxSummary>('/admin/tax/summary', token);
    return { ok: true, message: 'بارگیری شد.', data };
  } catch (err) {
    return { ok: false, message: await messageOf(err) };
  }
}

/**
 * فهرستِ صف با پالایشِ وضعیت و نوع.
 *
 * چرا نوع؟ چون صورتحسابِ «اصلاحیِ مرجوعی» ردیفِ تازه‌ای در همان صف است و اگر
 * مدیر نتواند آن را از فروش جدا ببیند، یک اصلاحیِ ردشده میانِ صدها فروش گم
 * می‌شود — و اعتبارِ مالیاتیِ مشتری هم با آن.
 */
export async function loadTaxInvoices(
  status?: string,
  kind?: string,
): Promise<ActionResult<TaxQueueItem[]>> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
  try {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (kind) params.set('kind', kind);
    const q = params.toString() ? `?${params.toString()}` : '';
    const data = await adminGet<{ invoices: TaxQueueItem[] }>(`/admin/tax/invoices${q}`, token);
    return { ok: true, message: 'بارگیری شد.', data: data.invoices };
  } catch (err) {
    return { ok: false, message: await messageOf(err) };
  }
}

/** اظهارنامه‌یِ ارزش‌افزوده در یک بازه‌یِ شمسی */
export async function loadVatReturn(
  fromJalali?: string,
  toJalali?: string,
): Promise<ActionResult<VatReturnPayload>> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
  try {
    const params = new URLSearchParams();
    if (fromJalali) params.set('from', fromJalali);
    if (toJalali) params.set('to', toJalali);
    const qs = params.toString();
    const data = await adminGet<VatReturnPayload>(`/admin/tax/vat-return${qs ? `?${qs}` : ''}`, token);
    return { ok: true, message: 'بارگیری شد.', data };
  } catch (err) {
    return { ok: false, message: await messageOf(err) };
  }
}

/** ارسالِ دسته‌ای + استعلامِ وضعیت */
export async function sendTaxBatch(limit = 20): Promise<ActionResult<{ message: string }>> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
  try {
    const res = await adminPost<{ message: string }>('/admin/tax/send-batch', token, { limit });
    return { ok: true, message: res.message, data: res };
  } catch (err) {
    return { ok: false, message: await messageOf(err) };
  }
}

/** تلاشِ دوباره برای یک صورتحسابِ ناموفق یا ردشده */
export async function retryTaxInvoice(id: string): Promise<ActionResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
  try {
    const res = await adminPost<{ message: string }>(
      `/admin/tax/invoices/${id}/retry`,
      token,
      {},
    );
    return { ok: true, message: res.message ?? 'دوباره در صف قرار گرفت.' };
  } catch (err) {
    return { ok: false, message: await messageOf(err) };
  }
}

/** ساختِ صورتحساب برای یک سفارشِ پرداخت‌شده */
export async function createTaxInvoiceForOrder(orderId: string): Promise<ActionResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
  try {
    const res = await adminPost<{ message: string }>(
      `/admin/tax/invoices/for-order/${orderId}`,
      token,
      {},
    );
    return { ok: true, message: res.message ?? 'صورتحساب ساخته شد.' };
  } catch (err) {
    return { ok: false, message: await messageOf(err) };
  }
}

/** کالاهایی که «شناسه‌یِ کالا/خدمت» ندارند */
export async function loadMissingSstid(): Promise<
  ActionResult<Array<{ productId: string; title: string; sku: string | null }>>
> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
  try {
    const data = await adminGet<{
      products: Array<{ productId: string; title: string; sku: string | null }>;
    }>('/admin/tax/missing-sstid', token);
    return { ok: true, message: 'بارگیری شد.', data: data.products };
  } catch (err) {
    return { ok: false, message: await messageOf(err) };
  }
}

/** ثبتِ «شناسه‌یِ کالا/خدمت» برای یک محصول */
export async function setProductSstidAction(input: {
  productId: string;
  sstid: string;
  unit?: string;
}): Promise<ActionResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
  const sstid = String(input.sstid ?? '').trim();
  if (!sstid) return { ok: false, message: 'شناسه‌یِ کالا/خدمت را وارد کنید.' };
  try {
    const res = await adminPost<{ message: string }>(
      `/admin/tax/products/${input.productId}/sstid`,
      token,
      { sstid, unit: input.unit ?? 'عدد' },
    );
    return { ok: true, message: res.message ?? 'شناسه ثبت شد.' };
  } catch (err) {
    return { ok: false, message: await messageOf(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// گاوصندوقِ گواهیِ مؤدیان
//
// چرا این کنش‌ها در همین پرونده‌اند؟ چون گواهی از مالیات جدایی‌ناپذیر است:
// مدیر یک‌جا می‌آید تا ببیند «می‌توانم به سازمان بفرستم یا نه»، و همان‌جا
// باید بتواند گواهی را بارگذاری کند و بیازماید. پراکندگی یعنی جست‌وجویِ
// مدیر میانِ دو صفحه برایِ یک کار.
// ─────────────────────────────────────────────────────────────────────────────

export interface CredentialFactsView {
  kind: 'private_key' | 'certificate' | 'public_key';
  label: string;
  source: 'panel' | 'env';
  /** اثرانگشتِ کلیدِ عمومی — با آنِ کلیدِ خصوصی یکی است و جفت‌بودن را می‌سنجد */
  fingerprint: string | null;
  /** اثرانگشتِ خودِ گواهی — همان که سازمان نشان می‌دهد (فقط برایِ گواهی) */
  certFingerprint?: string | null;
  subject: string | null;
  issuer: string | null;
  serialNumber: string | null;
  notBefore: string | null;
  notAfter: string | null;
  daysRemaining: number | null;
  expiry: 'ok' | 'soon' | 'expired' | null;
  createdAt: string;
}

export interface VaultStatusView {
  vaultReady: boolean;
  vaultMessage: string | null;
  privateKey: CredentialFactsView | null;
  certificate: CredentialFactsView | null;
  publicKey: CredentialFactsView | null;
  pairMatches: boolean | null;
  warnings: string[];
  readyForProduction: boolean;
}

/** وضعیتِ گاوصندوقِ گواهی */
export async function loadCertificateStatus(): Promise<ActionResult<VaultStatusView>> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
  try {
    const data = await adminGet<VaultStatusView>('/admin/tax/certificate', token);
    return { ok: true, message: 'بارگیری شد.', data };
  } catch (err) {
    return { ok: false, message: await messageOf(err) };
  }
}

/**
 * بارگذاریِ کلید یا گواهی.
 *
 * چرا متنِ «پی‌ایی‌ام» می‌گیریم و نه پرونده؟ چون فروشنده گواهی را معمولاً
 * به‌صورتِ یک فایلِ متنی از مرجع می‌گیرد؛ گشودنش و چسباندنِ متن در یک کادر
 * ساده‌تر از بالاگذاریِ فایل است و در خطایِ «این پرونده درست نیست» هم ابهامی
 * نمی‌ماند.
 */
export async function uploadCredentialAction(input: {
  kind: 'private_key' | 'certificate' | 'public_key';
  pem: string;
  label?: string;
}): Promise<ActionResult<VaultStatusView>> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
  const pem = String(input.pem ?? '').trim();
  if (!pem) return { ok: false, message: 'متنِ کلید یا گواهی خالی است.' };
  // اندازه‌یِ سقف: یک کلیدِ ۴۰۹۶ بیتی کمتر از ۴ کیلوبایت است؛ بزرگ‌تر یعنی
  // اشتباهی رخ داده (مثلاً کلِ زنجیره کپی شده)
  if (pem.length > 20_000) {
    return { ok: false, message: 'این متن بیش از اندازه بلند است؛ فقط همان کلید/گواهی را بچسبانید.' };
  }
  try {
    const data = await adminPost<{ status: VaultStatusView }>('/admin/tax/certificate', token, {
      kind: input.kind,
      pem,
      label: input.label ?? '',
    });
    return { ok: true, message: 'ذخیره شد.', data: data.status };
  } catch (err) {
    return { ok: false, message: await messageOf(err) };
  }
}

export async function revokeCredentialAction(
  kind: 'private_key' | 'certificate' | 'public_key',
): Promise<ActionResult<VaultStatusView>> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
  try {
    const data = await adminPost<{ status: VaultStatusView }>('/admin/tax/certificate/revoke', token, { kind });
    return { ok: true, message: 'ابطال شد.', data: data.status };
  } catch (err) {
    return { ok: false, message: await messageOf(err) };
  }
}

/**
 * آزمایشِ امضا، بی‌هیچ ارتباطی با سازمان.
 *
 * ارزشِ این دکمه در این است که نخستین ارسالِ واقعی معمولاً در آخرین روزِ
 * مهلت انجام می‌شود؛ اگر همان‌جا معلوم شود کلید با گواهی جفت نیست، فرصتِ
 * اصلاح از دست رفته است.
 */
export async function testSigningAction(): Promise<ActionResult<{ signed: boolean; detail: string }>> {
  const token = await getSessionToken();
  if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
  try {
    const data = await adminPost<{ ok: boolean; message: string }>('/admin/tax/certificate/test', token, {});
    return { ok: true, message: data.message, data: { signed: data.ok, detail: data.message } };
  } catch (err) {
    return { ok: false, message: await messageOf(err) };
  }
}
