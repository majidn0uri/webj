import { hashPassword } from '@set/auth';
import type { Database } from '@set/db';

/**
 * داده‌ی هویتیِ نمونه: شعبه، نقش‌ها، دسترسی‌ها و کاربرانِ آماده برای ورود به پنل.
 *
 * چرا اینجا و نه در packages/db؟
 * چون بسته‌ی auth خودش به db وابسته است؛ وارد کردنِ auth در db یک دورِ وابستگی
 * می‌ساخت. جایِ درستِ «ساختنِ کاربر با رمز» لایه‌ی برنامه است که به هر دو دسترسی دارد.
 *
 * همه‌ی درج‌ها تکرارپذیرند: اجرایِ دوباره چیزی را خراب یا تکراری نمی‌کند.
 */

/** نقش‌های سیستم — کلیدها با سلسله‌مراتبِ packages/rbac/src/index.ts هم‌خوان‌اند */
const ROLES: Array<[key: string, name: string]> = [
  ['super_admin', 'مدیر کل'],
  ['branch_manager', 'مدیر شعبه'],
  ['seller', 'فروشنده'],
  ['warehouse_keeper', 'انباردار'],
  ['accountant', 'حسابدار'],
  ['support', 'پشتیبان'],
];

/**
 * دسترسی‌ها به شکلِ «منبع.عمل» — همان قالبی که AccessControl.can می‌پذیرد.
 * فهرست دانه‌ریز نگه داشته شده تا در پنل بتوان به هر نقش ترکیبِ دلخواهی داد،
 * بدون تغییرِ کد.
 */
const PERMISSIONS: Array<[key: string, name: string]> = [
  ['product.read', 'دیدنِ کالا'],
  ['product.write', 'ثبت و ویرایشِ کالا'],
  ['inventory.read', 'دیدنِ موجودی'],
  ['inventory.adjust', 'تعدیلِ موجودی'],
  ['order.read', 'دیدنِ سفارش'],
  ['order.write', 'تغییرِ سفارش'],
  ['order.refund', 'برگشتِ وجه'],
  ['accounting.read', 'دیدنِ گزارشِ مالی'],
  ['accounting.write', 'ثبتِ سندِ حسابداری'],
  ['pos.read', 'مشاهده‌ی صندوق و گزارشِ شیفت'],
  ['pos.sell', 'فروشِ حضوری'],
  ['user.manage', 'مدیریتِ کاربران'],
  ['report.read', 'دیدنِ گزارش‌ها'],
  // خروجیِ اکسل/پی‌دی‌اف: داده‌یِ شرکت از سامانه بیرون می‌رود، پس دسترسیِ
  // جدا می‌خواهد — فروشنده فاکتور چاپ می‌کند (order.read کافی است) اما
  // گزارشِ فروش را خروجی نمی‌گیرد.
  ['reports.export', 'خروجی گرفتن از گزارش‌ها'],
  ['shipping.read', 'مشاهده‌ی ارسال'],
  ['shipping.write', 'مدیریت ارسال'],
  ['checks.read', 'مشاهده‌ی چک‌ها'],
  ['checks.write', 'مدیریت چک‌ها'],
];

/**
 * نگاشتِ نقش → دسترسی‌ها.
 * مدیرِ شعبه و مدیرِ کل عمداً دسترسیِ مستقیمِ کمی دارند، چون بقیه را از
 * سلسله‌مراتبِ نقش‌ها به ارث می‌برند؛ تکرارِ آن‌ها در اینجا باعث می‌شد
 * ارث‌بری در عمل آزمایش نشود.
 */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  support: ['product.read', 'order.read'],
  // فروشنده هم می‌فروشد و هم می‌بیند؛ pos.read کنارِ pos.sell است تا ناوبری
  // و گزارشِ شیفت برایِ کسی که حقِ فروش دارد پنهان نماند.
  seller: ['product.read', 'order.read', 'order.write', 'pos.read', 'pos.sell', 'inventory.read'],
  warehouse_keeper: ['product.read', 'inventory.read', 'inventory.adjust', 'shipping.read', 'shipping.write', 'checks.read', 'checks.write'],
  // حسابدار صندوق را «می‌بیند» (مغایرت‌گیریِ نقد) اما نمی‌فروشد.
  accountant: ['product.read', 'order.read', 'accounting.read', 'accounting.write', 'report.read', 'pos.read', 'reports.export'],
  branch_manager: ['user.manage', 'report.read', 'order.refund', 'reports.export'],
  // مدیرِ کل در AccessControl.can بدون نیاز به سیاست، همه‌چیز را مجاز می‌بیند.
  super_admin: [],
};

/** کاربرانِ نمونه — فقط در محیطِ توسعه ساخته می‌شوند */
const USERS: Array<{ mobile: string; name: string; role: string; password: string }> = [
  {
    mobile: '09120000000',
    name: 'مدیر کل',
    role: 'super_admin',
    password: process.env.ADMIN_PASSWORD ?? 'SetShop@1404',
  },
  {
    mobile: '09120000001',
    name: 'فروشنده‌ی شعبه',
    role: 'seller',
    password: process.env.SELLER_PASSWORD ?? 'SetShop@1404',
  },
  {
    mobile: '09120000002',
    name: 'انباردار',
    role: 'warehouse_keeper',
    password: process.env.KEEPER_PASSWORD ?? 'SetShop@1404',
  },
  {
    mobile: '09120000003',
    name: 'حسابدار',
    role: 'accountant',
    password: process.env.ACCOUNTANT_PASSWORD ?? 'SetShop@1404',
  },
];

export interface IdentitySeedSummary {
  branch: string;
  roles: number;
  permissions: number;
  users: Array<{ mobile: string; role: string }>;
}

export async function seedIdentity(db: Database): Promise<IdentitySeedSummary> {
  // --- شعبه‌ی پیش‌فرض
  let branchId = (
    await db.query<{ id: string }>(`SELECT id FROM branches ORDER BY created_at LIMIT 1`)
  ).rows[0]?.id;

  if (!branchId) {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO branches (code, name, city, is_active)
       VALUES ('THR-01', 'شعبه‌ی مرکزی', 'تهران', true) RETURNING id`,
    );
    branchId = inserted.rows[0]?.id;
  }

  // --- نقش‌ها
  for (const [key, name] of ROLES) {
    await db.query(
      `INSERT INTO roles (key, name, is_system) VALUES ($1, $2, true)
       ON CONFLICT (key) DO NOTHING`,
      [key, name],
    );
  }

  // --- دسترسی‌ها
  for (const [key, name] of PERMISSIONS) {
    await db.query(
      `INSERT INTO permissions (key, name) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, name],
    );
  }

  // --- اتصالِ نقش به دسترسی
  for (const [roleKey, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = (
      await db.query<{ id: string }>(`SELECT id FROM roles WHERE key = $1`, [roleKey])
    ).rows[0];
    if (!role) continue;

    for (const permKey of perms) {
      const perm = (
        await db.query<{ id: string }>(`SELECT id FROM permissions WHERE key = $1`, [permKey])
      ).rows[0];
      if (!perm) continue;

      await db.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [role.id, perm.id],
      );
    }
  }

  // --- کاربران و انتسابِ نقش
  const created: Array<{ mobile: string; role: string }> = [];

  for (const u of USERS) {
    // users.mobile یکتا نیست، پس نمی‌توان از ON CONFLICT استفاده کرد
    let user = (
      await db.query<{ id: string }>(`SELECT id FROM users WHERE mobile = $1`, [u.mobile])
    ).rows[0];

    if (!user) {
      const passwordHash = await hashPassword(u.password);
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO users (mobile, full_name, password_hash, is_active)
         VALUES ($1, $2, $3, true) RETURNING id`,
        [u.mobile, u.name, passwordHash],
      );
      user = inserted.rows[0];
      created.push({ mobile: u.mobile, role: u.role });
    }

    if (!user) continue;

    const role = (
      await db.query<{ id: string }>(`SELECT id FROM roles WHERE key = $1`, [u.role])
    ).rows[0];
    if (!role) continue;

    // نقشِ سراسری (branch_id تهی) تا در همه‌ی شعبه‌ها مؤثر باشد
    await db.query(
      `INSERT INTO user_roles (user_id, role_id, branch_id) VALUES ($1, $2, NULL)
       ON CONFLICT DO NOTHING`,
      [user.id, role.id],
    );
  }

  const count = async (table: string): Promise<number> => {
    const { rows } = await db.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM ${table}`);
    return Number(rows[0]!.c);
  };

  return {
    branch: branchId ?? '—',
    roles: await count('roles'),
    permissions: await count('permissions'),
    users: created,
  };
}
