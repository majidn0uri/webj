import { cache } from 'react';
import { adminGet } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

/**
 * «من کی‌ام؟» در سمتِ سرور.
 *
 * با `cache()` پیچیده شده است تا در یک رندر، چند صفحه/کامپوننت که همزمان به
 * هویت نیاز دارند یک فراخوانیِ مشترک داشته باشند — نه یکی برایِ ناوبری و
 * یکی برایِ هر صفحه.
 *
 * اگر فراخوانی شکست بخورد، استثنا پرتاب نمی‌شود: نبودِ هویت نباید کلِ پنل را
 * سفید کند. ناوبری در آن صورت فقط بخش‌هایِ عمومی را نشان می‌دهد و middleware
 * کاربر را به ورود می‌فرستد.
 */
export interface AdminIdentity {
  id: string;
  mobile: string;
  fullName: string | null;
  roles: string[];
  branch: string | null;
  permissions: string[];
}

export const getIdentity = cache(async (): Promise<AdminIdentity | null> => {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const me = await adminGet<AdminIdentity>('/auth/me', token);
    return { ...me, permissions: me.permissions ?? [] };
  } catch {
    return null;
  }
});

/** آیا کاربر این دسترسی را دارد؟ (مدیرِ کل همه را دارد) */
export function can(identity: AdminIdentity | null, permission: string): boolean {
  if (!identity) return false;
  return identity.permissions.includes(permission);
}
