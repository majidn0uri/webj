import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@set/db';
import type { TokenService } from '@set/auth';
import type { AccessControl } from '@set/rbac';
import type { FastifyReply } from 'fastify';
import { renderInvoicePdf } from '@set/exports';
import { getReturn } from '@set/returns';
import { AdminProcurementController } from './admin-procurement.controller.js';
import { AdminReturnsController } from './admin-returns.controller.js';

vi.mock('@set/exports', async (load) => ({
  ...await load<typeof import('@set/exports')>(),
  renderInvoicePdf: vi.fn(() => Buffer.from('%PDF-test')),
}));
vi.mock('@set/returns', async (load) => ({
  ...await load<typeof import('@set/returns')>(), getReturn: vi.fn(),
}));

const tokens = { verifyAccess: vi.fn().mockResolvedValue({ sub: 'actor' }) } as unknown as TokenService;
const access = { assert: vi.fn().mockResolvedValue(undefined) } as unknown as AccessControl;
function reply() {
  const send = vi.fn();
  const res = { header: vi.fn().mockReturnThis(), send };
  return { res: res as unknown as FastifyReply, send };
}
beforeEach(() => { vi.clearAllMocks(); });

describe('قرارداد خروجی PDF پنل', () => {
  it('خرید از سازنده مشترک با شماره، تاریخ و اقلام صحیح استفاده می‌کند', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ request_no: 'PR-1', supplier_name: 'تأمین‌کننده', created_at: '2026-09-22', status: 'approved' }] })
      .mockResolvedValueOnce({ rows: [{ title: 'قاب', sku: 'CASE', quantity: 3, last_cost_rial: '20000' }] });
    const { res, send } = reply();
    await new AdminProcurementController({ query } as unknown as Database, tokens, access).requestPdf('request-id', 'Bearer test', res);
    expect(renderInvoicePdf).toHaveBeenCalledWith(expect.objectContaining({ number: 'PR-1', issuedAt: expect.any(Date),
      lines: [{ title: 'قاب', sku: 'CASE', quantity: 3, unitPriceRial: 20000 }] }));
    expect(send).toHaveBeenCalledWith(Buffer.from('%PDF-test'));
  });
  it('مرجوعی چندعددی مبلغ را چندبرابر نمی‌کند و وضعیت پرداخت جعل نمی‌شود', async () => {
    vi.mocked(getReturn).mockResolvedValue({
      ret: { order_id: 'order-id', return_no: 'RET-1', requested_at: '2026-09-22', status: 'requested', refund_method: null },
      items: [{ title: 'قاب', sku: 'CASE', quantity: 3, refund_rial: '60000' }],
    } as Awaited<ReturnType<typeof getReturn>>);
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ order_no: 'ORDER-1', customer_name: 'مشتری' }] }).mockResolvedValueOnce({ rows: [] });
    const { res } = reply();
    await new AdminReturnsController({ query } as unknown as Database, tokens, access).returnPdf('return-id', 'Bearer test', res);
    expect(query.mock.calls[0]?.[1]).toEqual(['order-id']);
    expect(renderInvoicePdf).toHaveBeenCalledWith(expect.objectContaining({ number: 'RET-1', status: 'requested',
      lines: [{ title: 'قاب', sku: 'CASE', quantity: 3, unitPriceRial: 20000, totalRial: 60000 }] }));
  });
});
