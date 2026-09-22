'use server';

import { adminGet, adminPost, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

/**
 * کنش‌هایِ مرجوعی و گارانتی — سمتِ سرور.
 *
 * چرا از مسیرِ سرور؟ چون بازگشتِ وجه «عملِ خروجِ پول» است. اگر این فراخوان
 * از مرورگر مستقیم زده می‌شد، هر کسی با یک درخواستِ دستی می‌توانست مبلغی را
 * برگرداند و اثری از «چه کسی گفته» نمی‌ماند. اینجا توکن از کوکیِ HttpOnly
 * خوانده می‌شود و اجازه در سمتِ سرور (و در API با `returns.manage`) سنجیده
 * می‌شود.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface ReturnListItem {
  id: string;
  returnNo: string;
  orderNo: string;
  customerName: string | null;
  kind: string;
  kindLabel: string;
  status: string;
  statusLabel: string;
  itemCount: number;
  refundRial: string;
  refundToman: string;
  requestedAtJalali: string;
  refundedAt: string | null;
}

export interface ReturnDetail {
  return: {
    id: string;
    returnNo: string;
    orderNo: string;
    orderTotalToman: string;
    kind: string;
    kindLabel: string;
    status: string;
    statusLabel: string;
    reason: string | null;
    customerNote: string | null;
    decisionNote: string | null;
    trackingCode: string | null;
    refundMethod: string | null;
    refundToman: string;
    restockFeeToman: string;
    requestedAtJalali: string;
    decidedAt: string | null;
    receivedAt: string | null;
    refundedAt: string | null;
  };
  items: Array<{
    id: string;
    title: string;
    sku: string | null;
    quantity: number;
    condition: string;
    conditionLabel: string;
    restock: boolean;
    refundToman: string;
    note: string | null;
  }>;
  timeline: Array<{
    eventType: string;
    fromStatus: string | null;
    toStatus: string | null;
    note: string | null;
    createdAtJalali: string | null;
  }>;
}

export interface ReturnsReference {
  summary: {
    awaitingDecision: number;
    awaitingRefund: number;
    refundedCount: number;
    refundedToman: string;
    openCount: number;
    averageDaysToRefund: number | null;
  };
  kinds: Array<{ value: string; label: string; hint: string }>;
  statuses: Array<{ value: string; label: string }>;
  conditions: Array<{ value: string; label: string }>;
  refundMethods: Array<{ value: string; label: string }>;
  warrantiesExpiring: { count: number; samples: Array<{ title: string; endsAt: string; customer: string | null }> };
}

export interface WarrantyItem {
  id: string;
  orderNo: string;
  customerName: string | null;
  title: string;
  sku: string | null;
  serialNo: string | null;
  provider: string;
  startsAt: string;
  endsAt: string;
  endsAtJalali: string;
  months: number;
  status: string;
}

/**
 * توکنِ نشست. اگر نباشد، کاربر به ورود هدایت می‌شود — ادامه دادن با توکنِ
 * تهی فقط یک خطایِ گنگِ ۴۰۱ می‌ساخت.
 */
async function requireToken(): Promise<string> {
  const token = await getSessionToken();
  if (!token) throw new Error('نشست پایان یافته؛ دوباره وارد شوید.');
  return token;
}

function messageOf(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'خطایِ ناشناخته';
}

export async function loadReturnsReference(): Promise<ActionResult<ReturnsReference>> {
  try {
    const token = await requireToken();
    const data = await adminGet<ReturnsReference>('/admin/returns/reference', token);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function loadReturns(filter: {
  status?: string;
  kind?: string;
  q?: string;
}): Promise<ActionResult<ReturnListItem[]>> {
  try {
    const token = await requireToken();
    const query = new URLSearchParams();
    if (filter.status && filter.status !== 'all') query.set('status', filter.status);
    if (filter.kind && filter.kind !== 'all') query.set('kind', filter.kind);
    if (filter.q) query.set('q', filter.q);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const data = await adminGet<{ items: ReturnListItem[] }>(`/admin/returns${suffix}`, token);
    return { ok: true, data: data.items };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function loadReturnDetail(id: string): Promise<ActionResult<ReturnDetail>> {
  try {
    const token = await requireToken();
    const data = await adminGet<ReturnDetail>(`/admin/returns/${id}`, token);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function approveReturn(id: string, note: string): Promise<ActionResult<{ statusLabel: string }>> {
  try {
    const token = await requireToken();
    const data = await adminPost<{ statusLabel: string }>(`/admin/returns/${id}/decision`, token, {
      decision: 'approved',
      note: note || undefined,
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function rejectReturn(id: string, note: string): Promise<ActionResult<{ statusLabel: string }>> {
  try {
    const token = await requireToken();
    if (!note.trim()) return { ok: false, message: 'برایِ رد کردن، دلیل را بنویسید (مشتری آن را می‌خواند).' };
    const data = await adminPost<{ statusLabel: string }>(`/admin/returns/${id}/decision`, token, {
      decision: 'rejected',
      note,
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function markReturnInTransit(
  id: string,
  trackingCode: string,
): Promise<ActionResult<{ statusLabel: string }>> {
  try {
    const token = await requireToken();
    const data = await adminPost<{ statusLabel: string }>(`/admin/returns/${id}/transit`, token, {
      trackingCode: trackingCode || undefined,
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function receiveReturnItems(
  id: string,
  items: Array<{ itemId: string; condition: string; restock: boolean; note?: string }>,
): Promise<ActionResult<{ statusLabel: string; refundToman: string; restocked: number }>> {
  try {
    const token = await requireToken();
    const data = await adminPost<{ statusLabel: string; refundToman: string; restocked: number }>(
      `/admin/returns/${id}/receive`,
      token,
      { items },
    );
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function payRefund(
  id: string,
  method: string,
): Promise<ActionResult<{ statusLabel: string; refundToman: string }>> {
  try {
    const token = await requireToken();
    const data = await adminPost<{ statusLabel: string; refundToman: string }>(
      `/admin/returns/${id}/refund`,
      token,
      { method },
    );
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function loadWarranties(filter: {
  status?: string;
  expiringInDays?: string;
}): Promise<ActionResult<WarrantyItem[]>> {
  try {
    const token = await requireToken();
    const query = new URLSearchParams();
    if (filter.status && filter.status !== 'all') query.set('status', filter.status);
    if (filter.expiringInDays) query.set('expiringInDays', filter.expiringInDays);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const data = await adminGet<{ items: WarrantyItem[] }>(`/admin/returns/warranties${suffix}`, token);
    return { ok: true, data: data.items };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}
