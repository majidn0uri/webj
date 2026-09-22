import { redirect } from 'next/navigation';
import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';
import { SettingsPanel } from '@/components/admin/settings-panel';

export const dynamic = 'force-dynamic';

interface SettingsPayload {
  groups: Array<{
    key: string;
    title: string;
    hint: string;
    items: Array<{
      key: string;
      label: string;
      type: 'text' | 'number' | 'boolean' | 'select' | 'secret';
      hint: string | null;
      options: Array<{ value: string; label: string }> | null;
      value: string;
      isSet: boolean;
      updatedAt: string | null;
    }>;
  }>;
}

interface TemplatesPayload {
  items: Array<{
    key: string;
    title: string | null;
    body: string;
    providerTemplateId: string | null;
    isActive: boolean;
    placeholders: string[];
    missingRequired: string[];
    updatedAt: string | null;
  }>;
}

interface OutboxPayload {
  items: Array<{
    id: string;
    phone: string;
    templateKey: string | null;
    body: string;
    status: string;
    providerRef: string | null;
    attempts: number;
    lastError: string | null;
    nextAttemptAt: string | null;
    createdAt: string;
    sentAt: string | null;
  }>;
  counts: Record<string, number>;
}

/** پایشِ صف — جوابِ «تنظیمات کامل است، پس چرا چیزی نمی‌رود؟» */
interface StatsBucket {
  hour: number;
  enqueued: number;
  sent: number;
  failed: number;
  dead: number;
}

interface StatsPayload {
  hours: number;
  buckets: StatsBucket[];
  totals: { enqueued: number; sent: number; failed: number; dead: number };
  lastSentAt: string | null;
  lastAttemptAt: string | null;
  dueNow: number;
  inBackoff: number;
  staleAfterMinutes: number;
  minutesSinceActivity: number | null;
  workerLooksStalled: boolean;
  reason: string | null;
  stuckDead: number;
  retention: { smsOutboxDays: number; auditLogDays: number; observabilityDays: number };
  purgeable: number;
}

/** وضعیتِ آماده‌به‌ارسال — همان چیزی که «چرا پیامک نمی‌رسد؟» را جواب می‌دهد */
interface ReadinessItem {
  key: string;
  label: string;
  ok: boolean;
  severity: 'blocker' | 'warn' | 'info';
  hint: string | null;
}

interface ReadinessPayload {
  provider: string;
  providerKnown: boolean;
  enabled: boolean;
  hasApiKey: boolean;
  hasSender: boolean;
  dryRun: boolean;
  maxAttempts: number;
  backoffMinutes: number;
  checks: ReadinessItem[];
  counts: Record<string, number>;
  blockedTemplates: Array<{
    key: string;
    title: string | null;
    providerTemplateId: string | null;
    blocked: number;
    placeholders: string[];
    isActive: boolean;
  }>;
  requeueable: number;
  canSendNow: boolean;
}

/**
 * تنظیمات و مرکزِ پیامک.
 *
 * چرا همه‌ی داده‌ها در یک بارگیری می‌آیند؟ چون مدیر وقتی می‌خواهد «پیامکِ
 * تأییدِ سفارش» را ویرایش کند، هم‌زمان می‌خواهد بداند پیامک‌ها اصلاً ارسال
 * می‌شوند یا نه (تنظیمِ sms_enabled) و صندوق چه وضعی دارد. سه بارگیریِ جدا
 * یعنی سه بار انتظار برایِ تصمیمی که یک‌باره گرفته می‌شود.
 *
 * یک نکته‌یِ امنیتی: «می‌تواند بنویسد؟» از دسترسیِ settings.write جدا
 * می‌خوانیم تا اگر فروشنده فقط اجازه‌ی دیدن دارد، فرم‌ها غیرفعال شوند —
 * نه این‌که پر شوند و هنگامِ ذخیره با خطا روبه‌رو شود (تجربه‌ای که کاربر را
 * به اشتباه می‌اندازد: «پس چرا گذاشتی پر کنم؟»).
 */
export default async function SettingsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const [settingsRes, templatesRes, outboxRes, readinessRes, statsRes] = await Promise.allSettled([
    adminGet<SettingsPayload>('/admin/settings', token),
    adminGet<TemplatesPayload>('/admin/settings/sms/templates', token),
    adminGet<OutboxPayload>('/admin/settings/sms/outbox?limit=50', token),
    // با allSettled، نه await: تشخیصِ وضعیت نباید صفحهٔ تنظیمات را پایین بکشد —
    // اگر مسیرش خطا داد، مدیر همچنان می‌تواند قالب‌ها و کلیدها را ویرایش کند
    adminGet<ReadinessPayload>('/admin/settings/sms/readiness', token),
    adminGet<StatsPayload>('/admin/settings/sms/stats', token),
  ]);

  if (settingsRes.status === 'rejected') {
    const err = settingsRes.reason;
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
    if (err instanceof AdminApiError && err.status === 403) {
      return (
        <div className="alert alert--danger">
          شما اجازه‌ی دیدنِ تنظیمات را ندارید. از مدیرِ سامانه دسترسیِ
          <code className="code"> settings.read </code>
          را درخواست کنید.
        </div>
      );
    }
    return <div className="alert alert--danger">تنظیمات در دسترس نیست.</div>;
  }

  const canWrite = await (async () => {
    // بررسیِ واقعیِ دسترسی: یک واکشیِ سبک با PATCH روی یک کلیدِ بی‌اثر نمی‌زنیم؛
    // به‌جایش از نقشِ نشست می‌پرسیم.
    try {
      const me = await adminGet<{ permissions?: string[] }>('/auth/me', token);
      return (me.permissions ?? []).includes('settings.write');
    } catch {
      return false;
    }
  })();

  return (
    <SettingsPanel
      groups={settingsRes.value.groups}
      templates={templatesRes.status === 'fulfilled' ? templatesRes.value.items : []}
      outbox={outboxRes.status === 'fulfilled' ? outboxRes.value.items : []}
      outboxCounts={outboxRes.status === 'fulfilled' ? outboxRes.value.counts : {}}
      readiness={readinessRes.status === 'fulfilled' ? readinessRes.value : null}
      stats={statsRes.status === 'fulfilled' ? statsRes.value : null}
      canWrite={canWrite}
    />
  );
}
