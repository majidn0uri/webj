import { randomUUID } from 'node:crypto';

export * from './money.js';
export * from './persian.js';
export * from './jalali.js';
export * from './search.js';
export * from './errors.js';

type Prefix =
  | 'usr' | 'rol' | 'brn' | 'prd' | 'vrn' | 'img' | 'dev' | 'whs' | 'stk' | 'mov'
  | 'ord' | 'itm' | 'pay' | 'inv' | 'pur' | 'rmv' | 'shf' | 'evt' | 'aud';

/** شناسه‌ی خوانا با پیشوند — برای ردیابی در لاگ‌ها و پشتیبانی (مثلاً ord_3f2a…) */
/**
 * آیا این رشته یک UUID است؟
 *
 * چرا لازم است؟ چون مسیرهایی مانند ‎`/admin/returns/:id`‎ زیرمسیرهایِ هم‌نام
 * (مثل ‎`/admin/returns/warranties`‎) را هم می‌بلعند. اگر شناسه پیش از رفتن
 * به پایگاه بررسی نشود، پایگاه با خطایِ نوع روبه‌رو می‌شود و کاربر به‌جای
 * «یافت نشد»، «خطایِ داخلی» می‌بیند — و خطایِ داخلی یعنی کسی باید شبانه
 * لاگ بخواند.
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function newId(prefix: Prefix): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
