export * from './stock-alerts.js';
/**
 * @set/commerce — موتورِ قواعدِ کسب‌وکار (BR-xx)
 *
 * هر تابعِ این بسته، پیاده‌سازیِ مستقیمِ یک یا چند قاعده‌یِ شماره‌دارِ سند
 * «دستورالعمل اجرایی فروشگاه» است. نامِ قاعده در توضیحِ هر تابع آمده تا
 * گفتگو با برنامه‌نویس با کد انجام شود، نه با توضیحِ کلی.
 */

export * from './numbering.js';
export * from './settings.js';
export * from './customers.js';
export * from './pricing.js';
export * from './checks.js';
export * from './shipping.js';
export * from './returns.js';
export * from './sms.js';
export * from './sms-send.js';

/** نگاشتِ کدِ قاعده به پیاده‌ساز — برای ردیابی و مستندسازیِ خودکار */
export const RULE_MAP: ReadonlyArray<{ rule: string; implementedBy: string }> = [
  { rule: 'BR-01', implementedBy: 'pricing.resolvePrice' },
  { rule: 'BR-02', implementedBy: 'pricing.resolvePrice (fallback به قیمت فروش)' },
  { rule: 'BR-03', implementedBy: 'pricing.computePrice (بازه‌ی starts_at/ends_at)' },
  { rule: 'BR-04', implementedBy: 'pricing.computePrice (discount_on_partner)' },
  { rule: 'BR-05', implementedBy: 'pricing.computePrice (max_discount_percent + managerApproved)' },
  { rule: 'BR-06', implementedBy: 'orders (عکس‌برداریِ قیمت روی ردیف)' },
  { rule: 'BR-10', implementedBy: 'inventory (موجودی در سطحِ تنوع/رنگ)' },
  { rule: 'BR-12', implementedBy: 'orders.reservation_expires_at' },
  { rule: 'BR-13', implementedBy: 'inventory.availableQuantity' },
  { rule: 'BR-15', implementedBy: 'migration 013 reorder_point + reorder_alerts' },
  { rule: 'BR-20', implementedBy: 'customers.findOrCreateCustomer' },
  { rule: 'BR-21', implementedBy: 'customers.mergeCustomers' },
  { rule: 'BR-22', implementedBy: 'customers.setPartnerStatus' },
  { rule: 'BR-23', implementedBy: 'customers (is_active، حذف ممنوع)' },
  { rule: 'BR-25', implementedBy: 'customers.setPartnerStatus (کنترلِ چکِ باز)' },
  { rule: 'BR-26', implementedBy: 'customers.canSellWithoutAccount' },
  { rule: 'BR-31', implementedBy: 'migration 013 order_payment_lines' },
  { rule: 'BR-33', implementedBy: 'checks.checkCeiling (فقط همکار)' },
  { rule: 'BR-35', implementedBy: 'checks (چک در صندوق نمی‌آید)' },
  { rule: 'BR-36', implementedBy: 'checks.checkCeiling' },
  { rule: 'BR-37', implementedBy: 'checks.checkCeiling (برگشتی → سقف صفر)' },
  { rule: 'BR-40', implementedBy: 'migration 013 orders_status_chk' },
  { rule: 'BR-42', implementedBy: 'shipping.createShipment' },
  { rule: 'BR-43', implementedBy: 'shipping.tariffFor' },
  { rule: 'BR-44', implementedBy: 'returns.withinReturnWindow' },
  { rule: 'BR-45', implementedBy: 'returns.decideReturn' },
  { rule: 'BR-46', implementedBy: 'returns.completeReturn' },
  { rule: 'BR-47', implementedBy: 'returns.completeReturn (سندِ معکوس)' },
  { rule: 'BR-61', implementedBy: 'checks.changeCheckStatus(void) + audit_logs' },
  { rule: 'BR-62', implementedBy: 'audit_logs در همه‌ی عملیات' },
];
export * from './sms-diagnose.js';
export * from './sms-monitoring.js';
export * from './sms-worker-state.js';
export * from './housekeeping.js';
export * from './media-hygiene.js';
export * from './email.js';
