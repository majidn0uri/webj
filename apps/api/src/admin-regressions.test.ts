import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@set/db';
import type { TokenService } from '@set/auth';
import type { AccessControl } from '@set/rbac';
import { AppError } from '@set/shared-kernel';
import { InventoryController } from './inventory.controller.js';
import { AdminAccountingController } from './admin-accounting.controller.js';

function dependencies(allowed: boolean) {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const verifyAccess = vi.fn().mockResolvedValue({ sub: 'actor' });
  const assert = vi.fn().mockImplementation(async () => {
    if (!allowed) throw new AppError('FORBIDDEN');
  });
  return {
    query, verifyAccess, assert,
    db: { query } as unknown as Database,
    tokens: { verifyAccess } as unknown as TokenService,
    access: { assert } as unknown as AccessControl,
  };
}

describe('نگهبان عملیات مدیریت — نه فقط رفع خطای نوع', () => {
  it('فهرست شمارش انبار نیازمند inventory.read است', async () => {
    const d = dependencies(true);
    const controller = new InventoryController(d.db, d.tokens, d.access);
    expect(await controller.listCounts('Bearer test')).toEqual({ counts: [] });
    expect(d.assert).toHaveBeenCalledWith({ userId: 'actor', branchId: null }, 'inventory', 'read');
  });
  it('شمارش انبار بدون نشست حتی به پایگاه دست نمی‌زند', async () => {
    const d = dependencies(true);
    await expect(new InventoryController(d.db, d.tokens, d.access).listCounts()).rejects.toMatchObject({ key: 'UNAUTHENTICATED' });
    expect(d.query).not.toHaveBeenCalled();
  });
  it('ثبت شمارش نیازمند inventory.write است و رد مجوز پیش از نوشتن اتفاق می‌افتد', async () => {
    const d = dependencies(false);
    await expect(new InventoryController(d.db, d.tokens, d.access).recordCount('count', { items: [] }, 'Bearer test')).rejects.toMatchObject({ key: 'FORBIDDEN' });
    expect(d.assert).toHaveBeenCalledWith({ userId: 'actor', branchId: null }, 'inventory', 'write');
    expect(d.query).not.toHaveBeenCalled();
  });
  it('انتقال انبار نیز نگهبان نوشتن دارد', async () => {
    const d = dependencies(false);
    await expect(new InventoryController(d.db, d.tokens, d.access).transfer({}, 'Bearer test')).rejects.toMatchObject({ key: 'FORBIDDEN' });
    expect(d.assert).toHaveBeenCalledWith({ userId: 'actor', branchId: null }, 'inventory', 'write');
    expect(d.query).not.toHaveBeenCalled();
  });
  it('ورود صورت‌حساب بانکی accounting.write می‌خواهد نه accounting.accounting', async () => {
    const d = dependencies(true);
    const controller = new AdminAccountingController(d.db, d.tokens, d.access);
    await controller.importBankStatement({ bankAccount: 'بانک آزمون', statements: [
      { date: '2026-09-22', description: 'واریز', amountRial: '1000', direction: 'credit' },
    ] }, 'Bearer test');
    expect(d.assert).toHaveBeenCalledWith({ userId: 'actor', branchId: null }, 'accounting', 'write');
    expect(d.query).toHaveBeenCalledOnce();
  });
  it('گزارش سن بدهی نگهبان خواندن دارد', async () => {
    const d = dependencies(false);
    await expect(new AdminAccountingController(d.db, d.tokens, d.access).agingReport('Bearer test')).rejects.toMatchObject({ key: 'FORBIDDEN' });
    expect(d.assert).toHaveBeenCalledWith({ userId: 'actor', branchId: null }, 'accounting', 'read');
    expect(d.query).not.toHaveBeenCalled();
  });
});
