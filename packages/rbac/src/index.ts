import { newEnforcer, newModelFromString, type Enforcer } from 'casbin';
import type { Queryable } from '@set/db';

/**
 * کنترلِ دسترسی — ترکیبِ دو لایه:
 *  ۱) RBAC: کدام نقش، کدام کار را روی کدام منبع مجاز است (ماتریس در پایگاه‌داده، قابل ویرایش از پنل).
 *  ۲) ABAC: محدودیتِ شعبه — کاربر فقط بر داده‌های شعبه‌ی خودش دسترسی دارد (مگر نقشِ سراسری).
 *
 * چرا جدا؟ چون «فروشنده بتواند سفارش را ببیند» یک قانون است،
 * و «فروشنده فقط سفارشِ شعبه‌ی خودش را ببیند» قانونِ دیگری است.
 * قاطی کردنِ این دو در یکجا، منشأ نشتِ داده بین شعبه‌هاست.
 */

const MODEL = `
[request_definition]
r = sub, dom, obj, act

[policy_definition]
p = sub, dom, obj, act

[role_definition]
g = _, _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = (r.sub == p.sub || g(r.sub, p.sub, r.dom)) && (p.dom == '*' || p.dom == r.dom) && (p.obj == '*' || p.obj == r.obj) && (p.act == '*' || p.act == r.act)
`;

/**
 * سلسله‌مراتبِ نقش‌ها: [نقش, ارث‌می‌برد از]
 * جهت بسیار مهم است: g(نقش, ارث‌می‌برد) یعنی «نقش، نقشِ دوم را دارد»
 * و در نتیجه دسترسی‌های آن را به ارث می‌برد. برعکس نوشتنِ این رابطه یعنی
 * دادنِ دسترسیِ مدیر به فروشنده — یک نقصِ امنیتیِ خاموش.
 */
const HIERARCHY: Array<[role: string, inheritsFrom: string]> = [
  ['branch_manager', 'seller'],
  ['branch_manager', 'warehouse_keeper'],
  ['branch_manager', 'accountant'],
  ['branch_manager', 'support'],
  ['super_admin', 'branch_manager'],
];

/**
 * یک کلیدِ دسترسی را به یک یا دو جفتِ «منبع/عمل» می‌شکند.
 *
 * چرا دو حالت؟ چون در پایگاه‌داده دو قراردادِ هم‌زیست وجود دارد:
 *   • منبع.عمل          ← «pos.sell»، «inventory.read»
 *   • منبع.عملِ مرکب    ← «report.financial.view»، «purchase.invoice.approve»
 *     (کنترل‌کننده صدا می‌زند: can(ctx, 'report', 'financial.view'))
 *   • منبع.زیرمنبع.عمل  ← «procurement.request.read»
 *     (کنترل‌کننده صدا می‌زند: assert(ctx, 'procurement.request', 'read'))
 *
 * برایِ کلیدهایِ سه‌بخشی هر دو شکستن ثبت می‌شود تا هیچ‌کدام از دو قرارداد
 * بی‌صدا بی‌اثر نماند — شکستن در اولین نقطه، همه‌ی دسترسی‌هایِ تأمین را
 * خاموش می‌کرد (هر درخواستِ تأمین برایِ غیرِ مدیرِ کل ۴۰۳ می‌گرفت).
 */
function permissionSplits(permission: string): Array<[group: string, action: string]> {
  const first = permission.indexOf('.');
  if (first === -1) return [[permission, '*']];

  const last = permission.lastIndexOf('.');
  const byLast: [string, string] = [permission.slice(0, last), permission.slice(last + 1)];
  if (first === last) return [byLast];

  const byFirst: [string, string] = [permission.slice(0, first), permission.slice(first + 1)];
  return [byLast, byFirst];
}

export async function loadPolicyFromDb(enforcer: Enforcer, db: Queryable): Promise<void> {
  const { rows } = await db.query<{ role: string; permission: string }>(
    `SELECT r.key AS role, p.key AS permission
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id`,
  );

  for (const row of rows) {
    const splits = permissionSplits(row.permission);
    for (const [group, action] of splits) {
      await enforcer.addPolicy(row.role, '*', group, action);
    }
  }

  for (const [role, inheritsFrom] of HIERARCHY) {
    await enforcer.addNamedGroupingPolicy('g', role, inheritsFrom, '*');
  }
}

export async function createEnforcer(db: Queryable): Promise<Enforcer> {
  const model = newModelFromString(MODEL);
  const enforcer = await newEnforcer(model);
  await loadPolicyFromDb(enforcer, db);
  return enforcer;
}

export interface AccessContext {
  userId: string;
  /** شعبه‌ی پیش‌فرضِ کاربر (اگر نقشِ سراسری دارد می‌تواند null باشد) */
  branchId?: string | null;
}

export class AccessControl {
  constructor(
    private readonly enforcer: Enforcer,
    private readonly db: Queryable,
  ) {}

  /** نقش‌های مؤثرِ کاربر در یک شعبه (شاملِ نقش‌های سراسری) */
  async rolesFor(userId: string, branchId?: string | null): Promise<string[]> {
    const { rows } = await this.db.query<{ key: string }>(
      `SELECT r.key FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
          AND ($2::uuid IS NULL OR ur.branch_id IS NULL OR ur.branch_id = $2::uuid)`,
      [userId, branchId ?? null],
    );
    return [...new Set(rows.map((r) => r.key))];
  }

  async can(
    ctx: AccessContext,
    resource: string,
    action: string,
    branchId: string | null = ctx.branchId ?? null,
  ): Promise<boolean> {
    const roles = await this.rolesFor(ctx.userId, branchId);
    if (roles.length === 0) return false;
    if (roles.includes('super_admin')) return true;

    for (const role of roles) {
      if (await this.enforcer.enforce(role, '*', resource, action)) return true;
    }
    return false;
  }

  /**
   * همه‌ی دسترسی‌هایِ مؤثرِ یک کاربر — مستقیم و ارث‌بری‌شده از سلسله‌مراتبِ نقش‌ها.
   *
   * از casbin می‌پرسیم (‎getImplicitPermissionsForUser‎) تا سلسله‌مراتب در
   * یک‌جا تعریف بماند: اگر فردا «مدیرِ شعبه» دسترسیِ تازه‌ای بگیرد، این
   * فهرست خودبه‌خود درست می‌ماند و نیازی به نگاشتِ دوم در جایِ دیگر نیست.
   */
  async permissionsFor(userId: string, branchId?: string | null): Promise<string[]> {
    const roles = await this.rolesFor(userId, branchId);
    if (roles.length === 0) return [];

    // مدیرِ کل در `can` بی‌نیاز از سیاست مجاز است؛ در اینجا باید همان معنا را
    // به فهرست ترجمه کنیم، وگرنه رابطِ کاربر فکر می‌کند او هیچ دسترسی‌ای ندارد.
    if (roles.includes('super_admin')) {
      const { rows } = await this.db.query<{ key: string }>(`SELECT key FROM permissions ORDER BY key`);
      return rows.map((r) => r.key);
    }

    const out = new Set<string>();
    for (const role of roles) {
      // دامنه باید صریحاً «*» فرستاده شود؛ بی‌آن، casbin پیوندِ نقش‌ها را
      // (g(مدیر_شعبه، فروشنده، *)) در نظر نمی‌گیرد و فقط دسترسی‌هایِ مستقیم
      // برمی‌گردد — یعنی ارث‌بری در فهرست نادیده می‌ماند در حالی که در تصمیمِ
      // can() درست کار می‌کند.
      const policies = await this.enforcer.getImplicitPermissionsForUser(role, '*');
      for (const policy of policies) {
        const [, , resource, action] = policy;
        if (!resource || resource === '*') continue;
        out.add(action && action !== '*' ? `${resource}.${action}` : resource);
      }
    }
    return [...out].sort();
  }

  async assert(
    ctx: AccessContext,
    resource: string,
    action: string,
    branchId?: string | null,
  ): Promise<void> {
    const allowed = await this.can(ctx, resource, action, branchId);
    if (!allowed) {
      const { AppError } = await import('@set/shared-kernel');
      throw new AppError('FORBIDDEN', { details: { resource, action, branch: branchId ?? null } });
    }
  }
}
