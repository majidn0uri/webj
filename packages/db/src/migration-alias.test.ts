import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { applyMigrations, getAppliedVersions } from './migrate.js';

let db: Database;
afterEach(async () => { await db?.close(); });
const current = '049_shipping_checks_permissions';
const legacy = '039_shipping_checks_permissions';

describe('اصلاح شماره مهاجرت بدون اجرای دوباره مجوزها', () => {
  it('نصب تازه نسخه ۰۴۹ را اجرا و اجرای دوم هیچ کاری نمی‌کند', async () => {
    db = createDatabase('memory://');
    expect(await applyMigrations(db)).toContain(current);
    expect(await applyMigrations(db)).toEqual([]);
    const versions = await getAppliedVersions(db);
    expect(versions.has(current)).toBe(true);
    expect(versions.has(legacy)).toBe(false);
  });

  it('نام تاریخی را نگه می‌دارد و مجوز لغوشده را بازنمی‌گرداند', async () => {
    db = createDatabase('memory://');
    await applyMigrations(db);
    await db.query('UPDATE schema_migrations SET version = $1 WHERE version = $2', [legacy, current]);
    await db.query(`DELETE FROM role_permissions WHERE permission_id IN
      (SELECT id FROM permissions WHERE key = 'shipping.write')`);
    expect(await applyMigrations(db)).toEqual([]);
    const versions = await getAppliedVersions(db);
    expect(versions.has(legacy)).toBe(true);
    expect(versions.has(current)).toBe(true);
    const result = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id WHERE p.key = 'shipping.write'`);
    expect(result.rows[0]?.n).toBe(0);
    expect(await applyMigrations(db)).toEqual([]);
  });
});
