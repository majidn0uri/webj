import { describe, expect, it } from 'vitest';
import { ADMIN_NAV_GROUPS, ADMIN_NAV_ITEMS, isAdminRouteActive, visibleAdminItems } from './admin-navigation';

describe('ناوبری مدیریت', () => {
  it('هر مسیر دقیقاً در یک گروه قرار می‌گیرد', () => {
    const paths = ADMIN_NAV_GROUPS.flatMap((group) => group.paths);
    expect(new Set(paths).size).toBe(paths.length);
    expect([...paths].sort()).toEqual(ADMIN_NAV_ITEMS.map((item) => item.href).sort());
  });
  it('بدون مجوز فقط پیشخوان دیده می‌شود', () => {
    expect(visibleAdminItems([]).map((item) => item.href)).toEqual(['/admin']);
  });
  it('فقط پیوندهای مجاز را نشان می‌دهد', () => {
    expect(visibleAdminItems(['order.read']).map((item) => item.href)).toEqual(['/admin', '/admin/orders']);
  });
  it('جستجو هرگز دسترسی جدیدی آشکار نمی‌کند', () => {
    expect(visibleAdminItems([], 'مالیات')).toEqual([]);
    expect(visibleAdminItems(['tax.read'], 'مالیات')[0].href).toBe('/admin/tax');
  });
  it('جستجو برچسب و راهنما و حروف عربی را می‌پذیرد', () => {
    expect(visibleAdminItems(['product.read'], 'كالا')[0].href).toBe('/admin/products');
    expect(visibleAdminItems(['order.read'], 'حضوری')[0].href).toBe('/admin/orders');
    expect(visibleAdminItems(['customers.read'], 'crm')[0].href).toBe('/admin/crm');
  });
  it('پیشخوان فقط روی نشانی دقیق فعال است', () => {
    expect(isAdminRouteActive('/admin', '/admin')).toBe(true);
    expect(isAdminRouteActive('/admin/products', '/admin')).toBe(false);
  });
  it('زیربخش فعال می‌شود اما پیشوند مشابه خیر', () => {
    expect(isAdminRouteActive('/admin/products/123', '/admin/products')).toBe(true);
    expect(isAdminRouteActive('/admin/products-extra', '/admin/products')).toBe(false);
  });
});
