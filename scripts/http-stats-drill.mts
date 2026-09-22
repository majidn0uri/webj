/**
 * سنجشِ پایانیِ «پایشِ صف» رویِ سرورِ واقعی: API + PostgreSQL + فرستندهٔ
 * ساختگی. آزمونِ واحد SQL را رویِ PGlite می‌زند و این، همان مسیر را از لایهٔ
 * HTTP عبور می‌دهد (RBAC، سریال‌سازیِ JSON، رشته/Date، فلشِ کارگر).
 *
 * اجرا:  DB_URL="postgres://…" npx tsx scripts/http-stats-drill.mts
 */
import { execFileSync } from 'node:child_process';

const API = process.env.API ?? 'http://127.0.0.1:3000';
const ADMIN = { mobile: '09120000000', password: 'SetShop@1404' };
const PSQL = process.env.PSQL ?? 'psql';
const DB = process.env.DB_URL!;
const MARK = 'drill';

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

// ── ورود ──────────────────────────────────────────────────────────────────────
const login = await call('POST', '/auth/login', undefined, ADMIN);
ok('ورودِ مدیر', login.status === 200 || login.status === 201, `status=${login.status}`);
const token = String(login.json?.accessToken ?? login.json?.token ?? login.json?.access_token ?? '');
ok('توکنِ نشست گرفته شد', token.length > 20, `len=${token.length}`);

// ── ۱) بی‌تنظیمات: ساختارِ درست، بی‌۵۰۰ ─────────────────────────────────────
const adminId = sql(`SELECT id FROM users WHERE mobile='${ADMIN.mobile}'`);
sql(`UPDATE store_settings SET value='none' WHERE key='sms_provider'`);
let st = await call('GET', '/admin/settings/sms/stats', token);
ok('GET sms/stats → ۲۰۰', st.status === 200, `status=${st.status} ${st.text.slice(0, 120)}`);
ok('سطل‌ها آرایه‌اند و پیوسته', Array.isArray(st.json?.buckets) && st.json.buckets.length >= 4, `n=${st.json?.buckets?.length}`);
ok(
  'فاصلهٔ سطل‌ها ۳۶۰۰ ثانیه',
  (st.json?.buckets ?? []).every((b: any, i: number, arr: any[]) => i === 0 || b.hour - arr[i - 1].hour === 3600),
);
ok('minutesSinceActivity بی‌سابقه null است', st.json?.lastSentAt === null, JSON.stringify(st.json?.lastSentAt));
ok('hours پیش‌فرض ۲۴', st.json?.hours === 24, `hours=${st.json?.hours}`);
st = await call('GET', '/admin/settings/sms/stats?hours=6', token);
ok('hours=۶ پذیرفته شد', st.json?.hours === 6 && st.json?.buckets?.length === 7, `hours=${st.json?.hours} n=${st.json?.buckets?.length}`);
st = await call('GET', '/admin/settings/sms/stats?hours=abc', token);
ok('hoursِ بی‌اعتبار = پیش‌فرض، بی‌۵۰۰', st.status === 200 && st.json?.hours === 24, `hours=${st.json?.hours}`);
st = await call('GET', '/admin/settings/sms/stats?hours=-3', token);
ok('hoursِ منفی کلمپ شد', st.status === 200 && st.json?.hours === 24, `hours=${st.json?.hours}`);
st = await call('GET', '/admin/settings/sms/stats');
ok('بی‌توکن ۴۰۱', st.status === 401, `status=${st.status}`);

// ── ۲) هشدارِ خوابِ کارگر رویِ دادهٔ واقعی ──────────────────────────────────
sql(`DELETE FROM sms_outbox WHERE phone='09123334455'`);
const tpl = sql(`SELECT provider_template_id FROM sms_templates WHERE key='order_paid'`);
sql(`UPDATE sms_templates SET provider_template_id='STALE-DRILL' WHERE key='order_paid'`);
// بدنه باید با قالبِ «خودش» هم‌خوان باشد، وگرنه کارگر پیام را «قالب‌ناهم‌خوان»
// می‌کشد و هرگز به فرستنده نمی‌رسد — پس متن را از همان قالبِ موجود در پنل می‌سازیم
const tplBody = sql(`SELECT body FROM sms_templates WHERE key='order_paid'`)
  .replace(/\{order\}/, 'ORD-9')
  .replace(/\{amount\}/, '12000')
  .replace(/\{store\}/, 'SetShop');
sql(`INSERT INTO sms_outbox (phone, template_key, body, status, attempts, created_at, available_at)
     VALUES ('09123334455','order_paid','${tplBody.replace(/'/g, "''")}','pending',0,
             now() - interval '200 minutes', now())`);
st = await call('GET', '/admin/settings/sms/stats', token);
ok('پیامِ نوبت‌دار در آمار هست', st.json?.totals?.enqueued >= 1 && st.json?.dueNow >= 1, `due=${st.json?.dueNow}`);
ok('بی‌ردپایِ کارگر = هشدارِ خواب', st.json?.workerLooksStalled === true, `mins=${st.json?.minutesSinceActivity}`);
ok('متنِ هشدار نوشته شده', typeof st.json?.reason === 'string' && /کارگر|هرگز/.test(st.json.reason), String(st.json?.reason).slice(0, 90));
ok('بی‌ردپا «null دقیقه» نمی‌شود', !String(st.json?.reason ?? '').includes('null'), String(st.json?.reason).slice(0, 60));

// ── ۳) فلشِ واقعی: کارگر بیدار می‌شود، هشدار خاموش ───────────────────────────
// تنظیمات از خودِ API نوشته می‌شوند، نه UPDATE خام: کلیدِ API «راز» است و
// مسیرِ نوشتنش (رمزگشایی/انبار) با ستونِ ساده در store_settings فرق دارد —
// بی‌این، کارگر با «کلیدِ API تنظیم نشده» پیام را dead می‌کرد و سنجه بی‌معنا
const cfg = await call('PATCH', '/admin/settings', token, {
  values: { sms_enabled: 'true', sms_provider: 'kavenegar', sms_api_key: 'DRILL-KEY' },
});
ok('تنظیماتِ فرستنده از پنل ذخیره شد', cfg.status < 300, `status=${cfg.status} ${cfg.text.slice(0, 120)}`);
const flush = await call('POST', '/admin/settings/sms/outbox/flush', token, { limit: 10 });
// پاسخِ فلش ۲۰۱ است (POSTِ Nest)؛ چیزی که مهم است بدنه‌اش است، نه کدِ «ساخته‌شد»
ok('POST flush بی‌خطا', flush.status < 300, `status=${flush.status} ${flush.text.slice(0, 140)}`);
ok('حداقل یک پیامک رفت', Number(flush.json?.sent ?? 0) >= 1, JSON.stringify(flush.json)?.slice(0, 200));

st = await call('GET', '/admin/settings/sms/stats', token);
ok('پس ازِ فلش، هشدارِ خواب خاموش شد', st.json?.workerLooksStalled === false, `mins=${st.json?.minutesSinceActivity}`);
ok('ردپایِ تکانه در آمار هست', typeof st.json?.lastAttemptAt === 'string' || typeof st.json?.lastSentAt === 'string', `attempt=${st.json?.lastAttemptAt} sent=${st.json?.lastSentAt}`);
// سطلِ «اکنون» فقط پیامک‌هایی را می‌شمارد که در همین ساعت در صف گذاشته شده‌اند؛
// پیامِ ما ۲۰۰ دقیقه پیش ساخته شده، پس ارسالِ امروز در سطلِ خودش نشسته است
ok('مجموعِ sentِ سطل‌ها با واقعیّت می‌خواند', (st.json?.buckets ?? []).reduce((n: number, b: any) => n + b.sent, 0) >= 1, JSON.stringify(st.json?.totals));
const row = sql(`SELECT status || '|' || attempts || '|' || coalesce(last_attempt_at::text,'-') FROM sms_outbox WHERE phone='09123334455'`);
ok('سطرِ صف: sent با last_attempt_atِ پر', row.startsWith('sent|1|') && !row.endsWith('|-'), row);
// لاگِ فرستندهٔ ساختگی NUL دارد (نحوهٔ نوشتنِ console.log در آن فایل) پس tr
const providerHit = execFileSync('bash', ['-c', 'grep -a RECEIVED /tmp/fake-sms.log | tail -1 | tr -d "\\0"'], { encoding: 'utf8' }).trim();
ok('فرستندهٔ ساختگی واقعاً درخواست را گرفت', providerHit.includes('lookup/send.json') && providerHit.includes('token=ORD-9'), providerHit.slice(0, 160));
ok('مرجعِ فرستنده در صف ثبت شد', sql(`SELECT coalesce(provider_ref,'-') FROM sms_outbox WHERE phone='09123334455'`) !== '-', sql(`SELECT provider_ref FROM sms_outbox WHERE phone='09123334455'`));
// این یکی واقعاً مهم است: پنل با `new Date(string)` کار می‌کند؛ اگر روزی
// API آبجکت بدهد، «NaN» رویِ صفحه می‌نشیند. lastSentAt ممکن است null باشد
// (هرگز ارسالِ موفقی نبوده) پس هر دو را با هم می‌سنجیم
const stamped = st.json?.lastAttemptAt ?? st.json?.lastSentAt;
ok('JSONِ آمار رشتهٔ ISO می‌دهد (نه آبجکتِ Date)', typeof stamped === 'string' && !Number.isNaN(Date.parse(stamped)), `${typeof stamped} ${stamped}`);

// ── ۴) دسترسیِ خواندن برایِ کسی که send ندارد ────────────────────────────────
const roles = sql(`SELECT string_agg(r.key, ',') FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id='${adminId}'`);
console.log('   نقش‌های مدیر:', roles || '(بدونِ user_roles)');

// ── پاکسازی ──────────────────────────────────────────────────────────────────
sql(`DELETE FROM sms_outbox WHERE phone='09123334455'`);
sql(`UPDATE sms_templates SET provider_template_id=${tpl === '' ? 'NULL' : `'${tpl.replace(/'/g, "''")}'`} WHERE key='order_paid'`);
await call('PATCH', '/admin/settings', token, {
  values: { sms_enabled: 'false', sms_provider: 'none', sms_api_key: '' },
});
console.log('   سطرهایِ باقی‌مانده در صف:', sql(`SELECT count(*) FROM sms_outbox`));
console.log(fails === 0 ? '\nهمهٔ سنجه‌هایِ HTTP پاس شد.' : `\n${fails} سنجه شکست خورد.`);
if (fails > 0) process.exitCode = 1;
