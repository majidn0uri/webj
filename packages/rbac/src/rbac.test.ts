import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, applyMigrations, type Database } from '@set/db';
import { createEnforcer, AccessControl } from './index.js';

let db: Database;
let ac: AccessControl;

const users: Record<string, string> = {};
let seq = 0;

async function seedUser(name: string): Promise<string> {
  // شماره‌ی یکتا و قطعی برای هر اجرا — مبنای شمارش در beforeEach صفر می‌شود
  const mobile = '0912' + String(100_000 + seq++).padStart(7, '0');
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (mobile, full_name) VALUES ($1, $2) RETURNING id`,
    [mobile, name],
  );
  return rows[0]!.id;
}

async function assignRole(userId: string, roleKey: string, branchId: string | null = null): Promise<void> {
  await db.query(
    `INSERT INTO user_roles (user_id, role_id, branch_id)
     SELECT $1, id, $3 FROM roles WHERE key = $2`,
    [userId, roleKey, branchId],
  );
}

beforeEach(async () => {
  seq = 0;
  db = createDatabase('memory://');
  await applyMigrations(db);
  ac = new AccessControl(await createEnforcer(db), db);

  users.seller = await seedUser('فروشنده');
  users.keeper = await seedUser('انباردار');
  users.accountant = await seedUser('حسابدار');
  users.manager = await seedUser('مدیر شعبه');
  users.admin = await seedUser('مدیر کل');
  users.nobody = await seedUser('بدون نقش');

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO branches (code, name) VALUES ('THR', 'تهران'), ('SHZ', 'شیراز') RETURNING id`,
  );
  users.branchTehran = rows[0]!.id;
  users.branchShiraz = rows[1]!.id;

  await assignRole(users.seller!, 'seller', users.branchTehran!);
  await assignRole(users.keeper!, 'warehouse_keeper', users.branchTehran!);
  await assignRole(users.accountant!, 'accountant', users.branchTehran!);
  await assignRole(users.manager!, 'branch_manager', users.branchTehran!);
  await assignRole(users.admin!, 'super_admin'); // سراسری
});

afterEach(async () => db.close());

describe('ماتریسِ دسترسی (RBAC)', () => {
  it('فروشنده کالا و سفارش را می‌بیند، اما موجودی را تعدیل نمی‌کند', async () => {
    const ctx = { userId: users.seller!, branchId: users.branchTehran! };
    expect(await ac.can(ctx, 'product', 'view')).toBe(true);
    expect(await ac.can(ctx, 'order', 'view')).toBe(true);
    expect(await ac.can(ctx, 'stock', 'adjust')).toBe(false);
  });

  it('انباردار موجودی را تعدیل می‌کند اما به گزارش مالی دسترسی ندارد', async () => {
    const ctx = { userId: users.keeper!, branchId: users.branchTehran! };
    expect(await ac.can(ctx, 'stock', 'adjust')).toBe(true);
    expect(await ac.can(ctx, 'report', 'financial.view')).toBe(false);
  });

  it('حسابدار به گزارش مالی دسترسی دارد', async () => {
    const ctx = { userId: users.accountant!, branchId: users.branchTehran! };
    expect(await ac.can(ctx, 'report', 'financial.view')).toBe(true);
    expect(await ac.can(ctx, 'purchase', 'invoice.approve')).toBe(true);
  });

  it('مدیر شعبه از سلسله‌مراتب، دسترسی‌هایِ زیرمجموعه را به ارث می‌برد', async () => {
    const ctx = { userId: users.manager!, branchId: users.branchTehran! };
    expect(await ac.can(ctx, 'stock', 'adjust')).toBe(true);   // از انباردار
    expect(await ac.can(ctx, 'order', 'refund.approve')).toBe(true);
    expect(await ac.can(ctx, 'user', 'manage')).toBe(false);   // مدیریت کاربر ندارد
  });

  it('مدیر کل همه‌جا دسترسی دارد', async () => {
    const ctx = { userId: users.admin!, branchId: null };
    expect(await ac.can(ctx, 'user', 'manage')).toBe(true);
    expect(await ac.can(ctx, 'report', 'financial.view')).toBe(true);
  });

  it('کاربرِ بدون نقش هیچ دسترسی ندارد', async () => {
    const ctx = { userId: users.nobody!, branchId: users.branchTehran! };
    expect(await ac.can(ctx, 'product', 'view')).toBe(false);
  });
});

describe('کلیدهایِ سه‌بخشی و فهرستِ دسترسی‌ها', () => {
  it('دسترسیِ تأمین با هر دو قراردادِ منبع/عمل پاسخ می‌دهد', async () => {
    const ctx = { userId: users.accountant!, branchId: users.branchTehran! };
    // قراردادِ کنترل‌کننده‌ی تأمین: منبع = procurement.request، عمل = read
    expect(await ac.can(ctx, 'procurement.request', 'read')).toBe(true);
    // قراردادِ قدیمی‌تر (منبع = procurement، عملِ مرکب) نیز باید زنده بماند
    expect(await ac.can(ctx, 'procurement', 'request.read')).toBe(true);
    // دسترسی‌ای که به این نقش داده نشده است
    expect(await ac.can(ctx, 'procurement.receipt', 'create')).toBe(false);
  });

  it('permissionsFor دسترسی‌هایِ مستقیم و ارث‌بری‌شده را برمی‌گرداند', async () => {
    // مدیرِ شعبه از سلسله‌مراتب، دسترسی‌هایِ فروشنده/انباردار/حسابدار را به ارث می‌برد
    const manager = await ac.permissionsFor(users.manager!, users.branchTehran!);
    expect(manager).toContain('pos.sell');        // از فروشنده
    expect(manager).toContain('inventory.adjust'); // از انباردار
    expect(manager).toContain('accounting.write'); // از حسابدار
    expect(manager).not.toContain('user.manage');  // مدیرِ شعبه کاربر نمی‌سازد

    // تکراری در فهرست نیست (هر کلید یک‌بار)
    expect(new Set(manager).size).toBe(manager.length);

    // مدیرِ کل همه‌ی دسترسی‌هایِ تعریف‌شده را دارد
    const admin = await ac.permissionsFor(users.admin!, null);
    const all = (
      await db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM permissions`)
    ).rows[0]!.n;
    expect(admin.length).toBe(Number(all));

    // کاربرِ بی‌نقش هیچ دسترسی‌ای ندارد — نه استثنا می‌افتد و نه چیزی برمی‌گردد
    expect(await ac.permissionsFor(users.nobody!, users.branchTehran!)).toEqual([]);
  });
});

describe('محدودیتِ شعبه (ABAC) — جلوگیری از نشتِ داده', () => {
  it('فروشنده‌ی تهران در شعبه‌ی شیراز نقشی ندارد', async () => {
    const ctx = { userId: users.seller!, branchId: users.branchTehran! };
    expect(await ac.can(ctx, 'order', 'view', users.branchTehran!)).toBe(true);
    expect(await ac.can(ctx, 'order', 'view', users.branchShiraz!)).toBe(false);
  });

  it('نقشِ سراسری در همه‌ی شعبه‌ها مؤثر است', async () => {
    const ctx = { userId: users.admin!, branchId: null };
    expect(await ac.can(ctx, 'order', 'view', users.branchShiraz!)).toBe(true);
  });

  it('assert در صورتِ عدم دسترسی خطای ERR-003 می‌دهد', async () => {
    const ctx = { userId: users.seller!, branchId: users.branchTehran! };
    await expect(ac.assert(ctx, 'stock', 'adjust')).rejects.toMatchObject({ code: 'ERR-003' });
    await expect(ac.assert(ctx, 'product', 'view')).resolves.toBeUndefined();
  });
});
