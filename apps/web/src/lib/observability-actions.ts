'use server';

import { revalidatePath } from 'next/cache';

import { adminGet, adminPost, adminPatch, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

/**
 * کنش‌هایِ دیده‌بانی و مهارِ بار — سمتِ سرور.
 *
 * چرا این صفحه را «یک کنش» نمی‌خوانیم و سه تا داریم؟ چون نیازهایشان یکی
 * نیست: آمار باید هر چند ثانیه تازه شود (و نباید کلِ صفحه را دوباره بسازد)،
 * اما تغییرِ سقف یک کنشِ کم‌بسامد و حساس است که باید کلِ صفحه را
 * بازسازی کند تا «چه کسی تغییرش داد» همان لحظه دیده شود.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface TrafficMetrics {
  startedAt: string;
  uptimeSeconds: number;
  totals: { requests: number; errors: number; errorRatePercent: number };
  statusClasses: Record<'2xx' | '3xx' | '4xx' | '5xx', number>;
  throughput: { avgPerSecond: number; peakPerSecond: number };
  latency: { avgMs: number; p95Ms: number; maxMs: number };
  topRoutes: RouteMetricsRow[];
  slowestRoutes: RouteMetricsRow[];
  trackedRoutes: number;
}

export interface RouteMetricsRow {
  method: string;
  route: string;
  count: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  lastSeenAt: string;
}

export interface MetricsPayload {
  generatedAtShamsi: string;
  process: {
    rssMb: number;
    heapUsedMb: number;
    uptimeSeconds: number;
    nodeVersion: string;
    memoryPressure: 'normal' | 'high' | 'critical';
  };
  traffic: TrafficMetrics;
  rateLimit: { blockedTotal: number; blockedByRule: Array<{ rule: string; count: number }>; memoryBuckets: number | null };
  database: { kind: string; pendingOutbox: number };
}

export interface LimitRow {
  name: string;
  title: string;
  hint: string;
  maxRequests: number;
  windowSeconds: number;
  scope: string;
  store: string;
  isEnabled: boolean;
  updatedAtShamsi: string | null;
  updatedByName: string | null;
  liveBuckets: number | null;
}

export interface BlockedRow {
  id: string;
  ruleName: string;
  bucketKey: string;
  ip: string | null;
  method: string | null;
  path: string | null;
  seen: number;
  lastSeenAtShamsi: string;
  traceId: string | null;
}

export interface LimitsPayload {
  enabled: boolean;
  internalCallsExempt: boolean;
  items: LimitRow[];
  blocked: BlockedRow[];
  inProcessBlocks: { total: number; byRule: Array<{ rule: string; count: number }> };
}

function messageOf(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'ارتباط با سامانه برقرار نشد؛ دوباره تلاش کنید.';
}

export async function metricsAction(): Promise<ActionResult<MetricsPayload>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const data = await adminGet<MetricsPayload>('/admin/observability/metrics', token);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function limitsAction(): Promise<ActionResult<LimitsPayload>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const data = await adminGet<LimitsPayload>('/admin/observability/limits', token);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** کلیدِ اضطراریِ مهارِ بار: اگر سقفی مشتریِ واقعی را بست، یک کلیک خاموشش می‌کند */
export async function setRateLimitEnabledAction(
  enabled: boolean,
): Promise<ActionResult<{ enabled: boolean }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const data = await adminPatch<{ enabled: boolean }>('/admin/observability/limits', token, {
      enabled,
    });
    revalidatePath('/admin/observability');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export interface LimitPatch {
  maxRequests?: number;
  windowSeconds?: number;
  scope?: string;
  store?: string;
  isEnabled?: boolean;
}

export async function updateLimitAction(
  name: string,
  patch: LimitPatch,
): Promise<ActionResult<{ name: string; maxRequests: number; windowSeconds: number }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const data = await adminPatch<{ item: { name: string; maxRequests: number; windowSeconds: number } }>(
      `/admin/observability/limits/${encodeURIComponent(name)}`,
      token,
      patch,
    );
    revalidatePath('/admin/observability');
    return { ok: true, data: data.item };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** آزادسازیِ قفل — برایِ مشتری‌ای که پشتِ NAT یا پشتِ چند سفارشِ پیاپی گیر کرده */
export async function releaseLimitAction(
  name: string,
  bucketKey?: string,
): Promise<ActionResult<{ released: number }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const data = await adminPost<{ released: number }>(
      `/admin/observability/limits/${encodeURIComponent(name)}/release`,
      token,
      bucketKey ? { bucketKey } : {},
    );
    revalidatePath('/admin/observability');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}
