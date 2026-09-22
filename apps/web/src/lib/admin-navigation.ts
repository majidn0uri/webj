export const ADMIN_NAV_ITEMS: Array<{ href: string; label: string; hint: string; permission: string | null }> = [
  { href: '/admin', label: 'پیشخوان', hint: 'نگاهِ کلی', permission: null },
  { href: '/admin/products', label: 'کالاها', hint: 'ثبت و ویرایش', permission: 'product.read' },
  { href: '/admin/orders', label: 'سفارش‌ها', hint: 'فروشِ آنلاین و حضوری', permission: 'order.read' },
  { href: '/admin/customers', label: 'مشتریان', hint: 'پرونده و اعتبار', permission: 'customer.read' },
  { href: '/admin/crm', label: 'CRM', hint: 'ارتباط با مشتری', permission: 'customers.read' },
  { href: '/admin/inventory', label: 'موجودی', hint: 'انبار و تعدیل', permission: 'inventory.read' },
  { href: '/admin/forecast', label: 'پیش‌بینی', hint: 'ABC و نقطه سفارش', permission: 'inventory.read' },
  { href: '/admin/pos', label: 'صندوق', hint: 'فروشِ حضوری', permission: 'pos.read' },
  { href: '/admin/procurement', label: 'تأمین و خرید', hint: 'درخواست تا رسید', permission: 'procurement.request.read' },
  { href: '/admin/accounting', label: 'حسابداری', hint: 'دفترکل و خرید', permission: 'accounting.read' },
  { href: '/admin/reports', label: 'گزارش‌ها', hint: 'سود، گردش، بدهی', permission: 'reports.read' },
  { href: '/admin/exports', label: 'خروجی‌ها', hint: 'اکسل و پی‌دی‌اف', permission: 'reports.export' },
  { href: '/admin/tax', label: 'مالیات', hint: 'مؤدیان و ارزش‌افزوده', permission: 'tax.read' },
  { href: '/admin/returns', label: 'مرجوعی', hint: 'مرجوعیِ کالا و گارانتی', permission: 'returns.read' },
  { href: '/admin/categories', label: 'دسته‌بندی', hint: 'درختِ دسته‌ها و منویِ فروشگاه', permission: 'categories.read' },
  { href: '/admin/reviews', label: 'نظرات', hint: 'تأیید و پاسخ به نظرِ خریداران', permission: 'reviews.read' },
  { href: '/admin/questions', label: 'پرسش‌ها', hint: 'پرسش و پاسخ محصولات', permission: 'catalog.read' },
  { href: '/admin/email', label: 'ایمیل', hint: 'SMTP و نوتیفیکیشن', permission: 'settings.read' },
  { href: '/admin/coupons', label: 'کوپن‌ها', hint: 'ساخت و پیگیریِ کدهایِ تخفیف', permission: 'coupons.read' },
  { href: '/admin/banners', label: 'ویترین', hint: 'بنرها و پیامِ بالایِ سایت', permission: 'banners.read' },
  { href: '/admin/search', label: 'جستجو و مترادف‌ها', hint: 'فرهنگِ واژه‌ها و چی کم داریم', permission: 'product.read' },
  { href: '/admin/observability', label: 'سلامت', hint: 'کندی، بار و سقف‌ها', permission: 'observability.read' },
  { href: '/admin/settings', label: 'تنظیمات', hint: 'فروشگاه و پیامک', permission: 'settings.read' },
  { href: '/admin/sms', label: 'پیامک‌ها', hint: 'ارسال‌ها و خطاها', permission: 'sms.outbox.read' },
];


export const ADMIN_NAV_GROUPS = [
  { label: 'نمای کلی', paths: ['/admin'] },
  { label: 'فروش و ارتباط با مشتری', paths: ['/admin/orders', '/admin/pos', '/admin/customers', '/admin/crm', '/admin/returns'] },
  { label: 'کاتالوگ و انبار', paths: ['/admin/products', '/admin/categories', '/admin/inventory', '/admin/forecast', '/admin/procurement'] },
  { label: 'مالی و گزارش‌ها', paths: ['/admin/accounting', '/admin/reports', '/admin/exports', '/admin/tax'] },
  { label: 'ویترین و بازاریابی', paths: ['/admin/banners', '/admin/coupons', '/admin/reviews', '/admin/questions', '/admin/search'] },
  { label: 'مدیریت سامانه', paths: ['/admin/settings', '/admin/email', '/admin/sms', '/admin/observability'] },
];

export function isAdminRouteActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`));
}

export function visibleAdminItems(permissions: string[], query = '') {
  const normalized = query.trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLocaleLowerCase('fa');
  return ADMIN_NAV_ITEMS.filter((item) =>
    (item.permission === null || permissions.includes(item.permission)) &&
    `${item.label} ${item.hint}`.toLocaleLowerCase('fa').includes(normalized),
  );
}
