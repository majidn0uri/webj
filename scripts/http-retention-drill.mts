/**
 * سنجشِ HTTPِ «پیش‌نمایش/اجرایِ پاک‌سازی» + خوانده‌شدنِ سیاست از تنظیماتِ پنل.
 *
 * اجرا:  DB_URL="postgres://…" npx tsx scripts/http-retention-drill.mts
 * (API باید رویِ :3000 بالا باشد؛ پایگاهِ آزمایشی — سطرهایِ آزمون پاک می‌شوند)
 */
import { execFileSync } from 'node:child_process';

const API = process.env.API ?? 'http://127.0.0.1:3000';
const ADMIN = { mobile: '09120000000', password: 'SetShop@1404' };
const PSQL = process.env.PSQL ?? 'psql';
const DB = process.env.DB_URL!;
const PHONE = '09125556677';
const MARK = 'http-ret';

let fails = 0;
const ok = (name: string, cond: boolean, extra = ''): void => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

function sql(q: string): string {
  return execFileSync(PSQL, [DB, '-Atc', q], { encoding: 'utf8' }).trim();
}

async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* بدنهٔ غیر JSON */
  }
  return { status: res.status, json, text };
}

async function seed(): Promise<{ oldSent: string; oldPending: string }> {
  sql(`DELETE FROM sms_outbox WHERE phone='${PHONE}'`);
  sql(`INSERT INTO sms_outbox (phone, template_key, body, status, attempts, created_at)
       VALUES ('${PHONE}','order_paid','متنِ آزمونِ پاک‌سازی','sent',1, now() - interval '200 days'),
              ('${PHONE}','order_paid','متنِ آزمونِ پاک‌سازی','pending',0, now() - interval '200 days')`);
  const ids = sql(`SELECT id FROM sms_outbox WHERE phone='${PHONE}' AND status='sent'`).split('\n')[0]!;
  const pend = sql(`SELECT id FROM sms_outbox WHERE phone='${PHONE}' AND status='pending'`).split('\n')[0]!;
  return { oldSent: ids, oldPending: pend };
}

const login = await call('POST', '/auth/login', undefined, ADMIN);
const token = String(login.json?.accessToken ?? login.json?.token ?? '');
ok('ورودِ مدیر', token.length > 20, `status=${login.status}`);

// ── ۱) سیاست از پنل خوانده می‌شود (کلیدهای تازه شناخته‌اند، نه «تنظیمِ ناشناخته») ──
const patch = await call('PATCH', '/admin/settings', token, {
  values: { sms_outbox_retention_days: '۴۵', audit_log_retention_days: '0', observability_retention_days: '3' },
});
ok('ذخیرهٔ سه کلیدِ نگهداری از پنل', patch.status < 300, `status=${patch.status} ${patch.text.slice(0, 120)}`);
ok('مقدارِ فارسی به رقمِ لاتین تبدیل و ذخیره شد', sql(`SELECT value FROM store_settings WHERE key='sms_outbox_retention_days'`) === '45', sql(`SELECT value FROM store_settings WHERE key='sms_outbox_retention_days'`));

const stats = await call('GET', '/admin/settings/sms/stats', token);
ok('stats سیاست را هم می‌دهد', stats.json?.retention?.smsOutboxDays === 45, JSON.stringify(stats.json?.retention));

// ── ۲) پیش‌نمایش: بی‌حذف‌کردن، عددِ درست ────────────────────────────────────
const { oldSent, oldPending } = await seed();
let prev = await call('GET', '/admin/observability/cleanup', token);
ok('GET cleanup → ۲۰۰', prev.status === 200, `status=${prev.status} ${prev.text.slice(0, 120)}`);
ok('پیش‌نمایش یک پیامکِ تمام‌شده را می‌بیند', prev.json?.tables?.smsOutbox?.removed === 1, JSON.stringify(prev.json?.tables?.smsOutbox));
ok('پیش‌نمایش چیزی پاک نکرد', sql(`SELECT count(*) FROM sms_outbox WHERE id='${oldSent}'`) === '1');
ok('سیاست در پاسخ آمده', prev.json?.policy?.smsOutboxDays === 45 && prev.json?.policy?.auditLogDays === 0, JSON.stringify(prev.json?.policy));
ok('اندازهٔ جدول‌ها آمده', Array.isArray(prev.json?.sizes) && prev.json.sizes.length === 4, JSON.stringify(prev.json?.sizes));

// ── ۳) اجرا: فقط «تمام‌شدهٔ کهنه» می‌رود ────────────────────────────────────
const run = await call('POST', '/admin/observability/cleanup', token, { limit: 500 });
ok('POST cleanup → ۲۰۱/۲۰۰', run.status < 300, `status=${run.status} ${run.text.slice(0, 120)}`);
ok('یک پیامک پاک شد', run.json?.tables?.smsOutbox?.removed === 1, JSON.stringify(run.json?.tables?.smsOutbox));
ok('سطرِ sent رفت', sql(`SELECT count(*) FROM sms_outbox WHERE id='${oldSent}'`) === '0');
ok('صفِ زنده (pendingِ کهنه) ماند', sql(`SELECT count(*) FROM sms_outbox WHERE id='${oldPending}'`) === '1');
ok('پاسخ رقم‌هایِ جمله را با فارسی می‌دهد', !/۰|[0-9] (?:پیامک|سطر)/.test(run.json?.notes?.join?.(' ') ?? '') && String(run.json?.notes?.join?.(' ') ?? '').includes('۱'), JSON.stringify(run.json?.notes));
const auditRow = sql(`SELECT after_data::text FROM audit_logs WHERE action='admin.cleanup_ran' ORDER BY created_at DESC LIMIT 1`);
// `jsonb` پس ازِ هر دونقطه فاصله می‌گذارد، پس تطبیقِ «متنِ دقیق» شکننده است
ok('ممیزیِ اجرا نوشته شد (فقط شمارش)', /"total":\s*1/.test(auditRow) && auditRow.includes('policy'), auditRow.slice(0, 120));
ok('ممیزی هیچ شمارهٔ تلفنی ندارد', !/\d{11}/.test(auditRow), '');

// ── ۴) اعتبارسنجیِ ورودی ─────────────────────────────────────────────────────
let bad = await call('POST', '/admin/observability/cleanup', token, { limit: 99_999_999 });
ok('LIMITِ بی‌سقف رد می‌شود (نه اجرایِ بی‌حد)', bad.status >= 400, `status=${bad.status} ${bad.text.slice(0, 100)}`);
bad = await call('POST', '/admin/observability/cleanup', token, { limit: 0 });
ok('LIMIT صفر رد می‌شود', bad.status >= 400, `status=${bad.status}`);
bad = await call('GET', '/admin/observability/cleanup');
ok('بی‌توکن ۴۰۱', bad.status === 401, `status=${bad.status}`);

// ── ۵) فروشنده: دیدنِ پیش‌نمایش آزاده؟ اجرایِ پاک‌سازی نه ───────────────────
const sellerLogin = await call('POST', '/auth/login', undefined, { mobile: '09120000001', password: 'SetShop@1404' });
const sellerToken = String(sellerLogin.json?.accessToken ?? sellerLogin.json?.token ?? '');
ok('ورودِ فروشنده (گذرواژهٔ نمونه، برایِ همین آزمون)', sellerToken.length > 20, `status=${sellerLogin.status}`);
const sellerRead = await call('GET', '/admin/observability/cleanup', sellerToken);
// فروشنده نه `observability.read` دارد نه `write`: دیدنِ «چقدر جا لازم داریم»
// هم دستِ مدیرِ سامانه است — ۴۰۳ِ روشن، نه دادهٔ نصفه
ok('فروشنده پیش‌نمایشِ پاک‌سازی را نمی‌بیند (۴۰۳)', sellerRead.status === 403, `status=${sellerRead.status}`);
const sellerWrite = await call('POST', '/admin/observability/cleanup', sellerToken, { limit: 5 });
ok('فروشنده نمی‌تواند پاک‌سازی اجرا کند', sellerWrite.status === 403, `status=${sellerWrite.status}`);

// ── ۶) «۰» یعنی هرگز: با صفر، سطرهایِ کهنه می‌مانند ─────────────────────────
await call('PATCH', '/admin/settings', token, { values: { sms_outbox_retention_days: '0' } });
await seed();
const off = await call('POST', '/admin/observability/cleanup', token, { limit: 500 });
ok('با مهلتِ صفر چیزی پاک نشد', off.json?.tables?.smsOutbox?.removed === 0, JSON.stringify(off.json?.tables?.smsOutbox));
ok('و در آمارِ پنل هم «۰ موردِ آمادهٔ پاک‌سازی» است', (await call('GET', '/admin/settings/sms/stats', token)).json?.purgeable === 0, '');

// ── پاکسازی ─────────────────────────────────────────────────────────────────
await call('PATCH', '/admin/settings', token, {
  values: { sms_outbox_retention_days: '60', audit_log_retention_days: '0', observability_retention_days: '7' },
});
sql(`DELETE FROM sms_outbox WHERE phone='${PHONE}'`);
sql(`DELETE FROM audit_logs WHERE action='admin.cleanup_ran'`);
console.log('   سطرهایِ باقی‌مانده:', sql(`SELECT count(*) FROM sms_outbox`), 'صف،', sql(`SELECT value FROM store_settings WHERE key='sms_outbox_retention_days'`), 'روزِ نگهداری');
console.log(fails === 0 ? '\nهمهٔ سنجه‌هایِ HTTP پاس شد.' : `\n${fails} سنجه شکست خورد.`);
if (fails > 0) process.exitCode = 1;
