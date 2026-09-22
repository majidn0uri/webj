#!/usr/bin/env node
/**
 * آزمونِ بارِ ست‌شاپ — «چند هزار خریدارِ هم‌زمان» را اندازه می‌گیریم، نه ادعا می‌کنیم.
 *
 * چرا این دستگاه را خودمان نوشتیم و از ابزارِ آماده استفاده نکردیم؟
 *   چون آنچه می‌خواهیم بدانیم «چند درخواست در ثانیه به یک نشانی می‌رود»
 *   نیست — آن را هر ابزاری می‌گوید. مسئله این است: **یک خریدارِ واقعی چه
 *   می‌بیند وقتی سه هزار نفر هم‌زمان در فروشگاه‌اند؟** یعنی باید سناریو
 *   داشت (خانه ← دسته ← کالا ← جستجو ← افزودن به سبد)، مکثِ انسانی داشت،
 *   و درصدهایِ تأخیر را جداگانه برایِ هر گام گزارش کرد — چون کندیِ «برگه‌یِ
 *   کالا» با کندیِ «جستجو» یک معنا ندارد.
 *
 * دو عدد که با هم اشتباه می‌شوند و اینجا از هم جدا گزارش می‌شوند:
 *   • **خریدارِ هم‌زمان (virtual users)** — کسی که پشتِ مرورگر نشسته و بینِ
 *     دو کلیک مکث می‌کند.
 *   • **درخواستِ در جریان (in-flight)** — آنچه واقعاً رویِ سرور کار می‌کند.
 *     با مکثِ ۵۰۰ میلی‌ثانیه و پاسخِ ۵۰ میلی‌ثانیه، هر هزار خریدار تقریباً
 *     نود درخواستِ در جریان می‌سازند — نه هزار. ادعایِ درست همین دومی است.
 *
 * اجرا:
 *   node scripts/load-test.mjs --users 200 --duration 30
 *   node scripts/load-test.mjs --users 1000 --duration 60 --mix buy --json var/load.json
 *   node scripts/load-test.mjs --users 300 --duration 30 --mix checkout --json var/load.json   # با ثبتِ سفارش
 *   node scripts/load-test.mjs --users 40 --duration 20 --mix purchase                            # با پرداخت و سنجشِ موجودی
 *       --relax-limiter   ظرفیتِ خام (مهارکنندهٔ نرخ را موقتاً خاموش می‌کند و در پایان روشن می‌کند)
 *       --with-pages      برگه‌هایِ سایت را هم به سناریو می‌افزاید (با `next dev` نکنید: رندرِ توسعه می‌بلعد)
 *       --no-integrity    انبار را پس از آزمون نمی‌خواند (برایِ ماشینِ بی‌صلاحیتِ مدیر)
 *   node scripts/load-test.mjs --ramp 50,200,500,1000 --duration 30
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { loadavg, cpus } from 'node:os';

// ─────────────────────────────────────────────────────────────────────────────
// تنظیم‌ها از خطِ فرمان
// ─────────────────────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const inline = hit.split('=')[1];
  if (inline !== undefined) return inline;
  const at = process.argv.indexOf(hit);
  return process.argv[at + 1] ?? fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

/**
 * نشانیِ وب می‌تواند چندتا باشد (با ویرگول جدا شود).
 * چرا؟ چون در تولید، پشتِ nginx چند فرآیندِ وب می‌ایستند (Node تک‌رشته‌ای
 * است و بیش از یک هسته را به کار نمی‌گیرد). اگر ابزارِ اندازه‌گیری فقط یک
 * نشانی را بزند، ظرفیتِ کلِ دستگاه را نمی‌سنجد.
 */
const WEB_LIST = arg('web', 'http://127.0.0.1:3100')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);
const WEB = WEB_LIST[0];
const API = (arg('api', 'http://127.0.0.1:3000')).replace(/\/$/, '');
const DURATION = Number(arg('duration', 30));
const WARMUP = Number(arg('warmup', 5));
const THINK = Number(arg('think', 500));
const TIMEOUT = Number(arg('timeout', 15000));
/**
 * فیوزِ اشباع. اگر این‌قدر درخواست **پشتِ سرِ هم** شکست بخورد، سرویس دیگر
 * «کُند» نیست دارد می‌میرد، و ادامهٔ کوبیدن فقط ماشینِ آزمون را قفل می‌کند —
 * یک بار واقعاً شد: ۱۵۰ کاربر رویِ دو هسته، صفِ بیست‌اتصالیِ پایگاه، و ده
 * دقیقه‌ای که هیچ دستوری (حتی `ps`) تمام نشد. پس زود می‌ایستیم و همان را
 * گزارش می‌دهیم؛ عددِ به‌دست‌آمده بعدِ فیوز، سقفِ فروش نیست.
 */
const ABORT_AFTER = Math.max(5, Number(arg('abort-after', 60)) || 60);
const MIX = arg('mix', 'browse');
// `checkout` = «خریدِ کامل» (سبد ← افزودن ← تسویه ← رزروِ موجودی)
const RAMP = arg('ramp', '');
// «purchase» موجودی را هم می‌سنجد، پس به یک نشانهٔ خواندنِ انبار نیاز دارد.
// با `--no-integrity` این قسمت کنار گذاشته می‌شود (مثلاً رویِ ماشینِ CI).
const ADMIN_MOBILE = arg('admin-mobile', '09120000000');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? arg('admin-password', 'SetShop@1404');
const INTEGRITY = MIX === 'purchase' && !has('no-integrity');
/**
 * `--relax-limiter`: برایِ «ظرفیتِ خامِ سرور چقدر است».
 *
 * مهارکنندهٔ نرخ خودش یک قابلیتِ فروخته‌شده است، نه مزاحم؛ ولی وقتی ۹۰٪ِ یک
 * آزمونِ بار را ۴۲۹ می‌خورد، آنچه می‌سنجی خودِ مهارکننده است نه سرور. کلیدِ
 * اضطراریِ **همان پنل** (`PATCH /admin/observability/limits`) زده می‌شود و در
 * پایانِ اجرا حتماً برگردانده می‌شود — چون «خاموش کردنِ مهارکننده و رفتن»
 * یعنی یک سوراخِ باز در فروشگاه.
 */
const RELAX = has('relax-limiter');
/**
 * `--with-pages`: برگه‌هایِ رندرشده‌یِ سایت را به سناریویِ پول برگرداند.
 *
 * پیش‌فرض در `purchase` خاموش است، و دلیلش یک مشاهدهٔ اندازه‌گیری است نه
 * تنبلی: رندرِ برگه در حالتِ توسعه (`next dev`) بیست‌ونُه ثانیه هم شد، و آن
 * زمانِ ترجمهٔ برگه است نه توانِ سرور — گلوگاهِ واقعی (موجودی، قفلِ تراکنش،
 * درگاه) پشتِ آن پنهان می‌شود و آزمون فقط «timeout» گزارش می‌کرد. با ساختِ
 * تولیدیِ وب، همین گام‌ها را می‌توان سنجید.
 */
const WITH_PAGES = has('with-pages');
/**
 * شمارشِ پیامدهایِ کسب‌وکاری.
 *
 * چرا جدا از «خطا»؟ چون «موجودی کافی نیست» (۴۰۹) پاسخِ **درستِ** فروشگاه است:
 * نمی‌خواهد بیشتر از انبار بفروشد. اگر آن را خطا بشماریم، آزمونِ بار بدترین
 * دروغِ ممکن را می‌گوید — ۴۰ خریدار رویِ یک کالایِ ۷تایی = «۸۰٪ خطا» رویِ تابلو،
 * در حالی که سامانه درست کار کرده. همان قاعدهٔ ۴۲۹ (مهارِ نرخ)، این‌جا در
 * لایهٔ کسب‌وکار.
 */
const tally = { created: 0, paid: 0, cancelled: 0, soldOut: 0, startFailed: 0, verifyFailed: 0, turns: 0 };
const tallyTotals = { created: 0, paid: 0, cancelled: 0, soldOut: 0, startFailed: 0, verifyFailed: 0 };
const rollUpTally = () => {
  for (const k of Object.keys(tallyTotals)) {
    tallyTotals[k] += tally[k];
    tally[k] = 0;
  }
};
const LEVELS = RAMP ? RAMP.split(',').map((n) => Number(n.trim())).filter((n) => n > 0) : [Number(arg('users', 200))];
const JSON_OUT = arg('json', '');
/**
 * `--real-ip=127.0.0.1` یعنی «من همان nginx را بازی می‌کنم»: هر خریدارِ
 * ساختگی یک `X-Real-IP` یکتا می‌فرستد و API (با `TRUSTED_PROXY_IPS=127.0.0.1`)
 * آن را باور می‌کند. بی‌این، همه‌یِ خریداران رویِ یک سطلِ نشانی می‌نشینند و
 * سقف‌هایِ کسب‌وکاری (۱۰ سفارش در ساعت) به **سقفِ کلِ فروشگاه** تبدیل می‌شود —
 * که خودش یک یافته است، پس هر دو حالت را اندازه می‌گیریم: با این پرچم «توانِ
 * واقعی»، بی‌آن «چه بلایی سرِ خریدارانِ پشتِ یک نشانی (CGNAT) می‌آید».
 */
const REAL_IP_BASE = arg('real-ip', '');
const REAL_IP_ON = REAL_IP_BASE !== '' && REAL_IP_BASE !== 'off';

// ─────────────────────────────────────────────────────────────────────────────
// داده‌یِ زنده: اسلاگ‌ها را از خودِ فروشگاه می‌خوانیم تا سناریو واقعی باشد
// ─────────────────────────────────────────────────────────────────────────────
const agent = new http.Agent({ keepAlive: true, maxSockets: 4096, scheduling: 'lifo' });
const agentTls = new https.Agent({ keepAlive: true, maxSockets: 4096 });

function request(url, { method = 'GET', body, headers = {}, timeout = TIMEOUT, readBody = false } = {}) {
  return new Promise((done) => {
    const started = process.hrtime.bigint();
    const secure = url.startsWith('https');
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ ...result, ms: Number(process.hrtime.bigint() - started) / 1e6 });
    };
    const timer = setTimeout(() => finish({ ok: false, status: 0, error: 'timeout' }), timeout);

    try {
      const payload = body ? JSON.stringify(body) : null;
      const req = (secure ? https : http).request(
        url,
        {
          method,
          agent: secure ? agentTls : agent,
          headers: {
            ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
            'accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
            'user-agent': 'setshop-load-test',
            ...headers,
          },
        },
        (res) => {
          // بدنه فقط وقتی خوانده می‌شود که واقعاً به آن نیاز داریم (مثلاً
          // شناسه‌یِ سبد). در مسیرِ پرفشار، خواندنِ هر پاسخ هزینه‌یِ بی‌جاست.
          if (!readBody) {
            let size = 0;
            res.on('data', (chunk) => {
              size += chunk.length;
            });
            res.on('end', () => finish({ ok: res.statusCode < 400, status: res.statusCode, size }));
            return;
          }
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            try {
              json = JSON.parse(text);
            } catch {
              json = null;
            }
            finish({ ok: res.statusCode < 400, status: res.statusCode, size: Buffer.byteLength(text), json });
          });
        },
      );
      req.on('error', (err) => finish({ ok: false, status: 0, error: err.code ?? err.message }));
      if (payload) req.write(payload);
      req.end();
    } catch (err) {
      finish({ ok: false, status: 0, error: String(err?.message ?? err) });
    }
  });
}

async function discover() {
  const [products, categories] = await Promise.all([
    fetch(`${API}/catalog/products?limit=24`).then((r) => r.json()).catch(() => null),
    fetch(`${API}/categories`).then((r) => r.json()).catch(() => null),
  ]);
  const productSlugs = (products?.items ?? []).map((p) => p.slug).filter(Boolean);
  const categorySlugs = (categories?.items ?? categories ?? []).map((c) => c.slug).filter(Boolean);
  if (productSlugs.length === 0 || categorySlugs.length === 0) {
    console.log('❌ کاتالوگ خالی است؛ نخست فروشگاه را بذار (`scripts/seed-catalog.ts`).');
    process.exit(1);
  }
  return { productSlugs, categorySlugs };
}

// ─────────────────────────────────────────────────────────────────────────────
// سناریو: وزنِ هر گام از ترافیکِ واقعیِ یک فروشگاهِ کالا
// ─────────────────────────────────────────────────────────────────────────────
/** سبد را پر می‌کند — تسویه با سبدِ خالی «VALIDATION» است و چیزی نمی‌سنجد */
async function fillCart(state) {
  if (state.filled) return true;
  if (!state.cartId) return false;
  const res = await request(`${API}/cart/${state.cartId}/items`, {
    method: 'POST',
    body: { variantId: state.variantId, quantity: 1 },
    readBody: true,
    headers: { ...internalHeader(), ...shopperIpHeader(state) },
  });
  if (res.ok) state.filled = true;
  return res.ok;
}

function buildSteps({ productSlugs, categorySlugs }, mix, webList) {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  // گردشِ نوبتی میانِ نمونه‌هایِ وب — همان کاری که nginx می‌کند
  let turn = 0;
  const web = () => webList[turn++ % webList.length];

  // «فقط API»: رندرِ برگه را از سناریو برمی‌داریم تا بتوانیم بگوییم گلوگاه
  // در رندرِ سمتِ سرور است یا در خودِ سرویس. بی‌این جداسازی، هر دو را یکی
  // می‌بینیم و درمان را از رویِ حدس انتخاب می‌کنیم.
  if (mix === 'api') {
    // جستجو در این مخلوط وزن دارد، چون در واقعیّت «کندترینِ گامِ خریدار» همان
    // است و اندازه‌گیریِ گلوگاه بدونِ آن یعنی دیدنِ همه‌چیز به‌جز مسئله.
    //
    // توزیعِ پرسش‌ها «تک‌تکِ یکتا» نیست: در یک فروشگاهِ واقعی هشت‌دهِ درصدِ
    // جستجوها چند عبارتِ پرتکرار است («شارژر»، «گوشی سامسونگ»…). اگر هر
    // درخواستِ سناریو یک عبارتِ تصادفیِ یکتا باشد، هیچ کشی — و هیچ فهرست‌گیریِ
    // درستی — معنی ندارد و عددِ «بهبود» از رویِ داده‌ای ساخته می‌شود که در
    // تولید وجود ندارد. پس ۸ از هر ۱۰ پرسش از پنج عبارتِ داغ است.
    const hot = productSlugs.slice(0, 5).map((slug) => slug.split('-')[0]).filter(Boolean);
    const all = productSlugs.map((slug) => slug.split('-')[0]).filter(Boolean);
    let turn2 = 0;
    const queryOf = () => {
      const i = turn2++;
      const pool = i % 10 < 8 && hot.length > 0 ? hot : all;
      return encodeURIComponent(pool[i % pool.length] ?? 'گوشی');
    };
    return [
      { name: 'فهرستِ کالا (API)', weight: 35, run: () => request(`${API}/catalog/products?limit=24`, { headers: internalHeader() }) },
      {
        name: 'جستجو (API)',
        weight: 30,
        run: () => request(`${API}/catalog/search?q=${queryOf()}&limit=24`, { headers: internalHeader(), readBody: true }),
      },
      { name: 'دسته‌ها (API)', weight: 15, run: () => request(`${API}/categories`, { headers: internalHeader() }) },
      { name: 'برندها (API)', weight: 10, run: () => request(`${API}/catalog/brands`, { headers: internalHeader() }) },
      { name: 'بنرها (API)', weight: 10, run: () => request(`${API}/banners`, { headers: internalHeader() }) },
    ];
  }
  const steps = [
    {
      name: 'خانه',
      weight: 26,
      run: () => request(`${web()}/`),
    },
    {
      name: 'دسته‌بندی',
      weight: 26,
      run: () => request(`${web()}/c/${pick(categorySlugs)}`),
    },
    {
      name: 'برگه‌یِ کالا',
      weight: 32,
      run: () => request(`${web()}/products/${pick(productSlugs)}`),
    },
    {
      name: 'جستجو',
      weight: 16,
      run: () => request(`${web()}/search?q=${encodeURIComponent(pick(productSlugs).split('-')[0])}`),
    },
  ];

  // چرا دیگر دو نشانیِ API را مستقیم نمی‌زنیم؟ چون مرورگرِ خریدار آن‌ها را
  // صدا نمی‌زند: آن تماس‌ها از سرورِ نکست می‌آیند و کلیدِ داخلی دارند. زدنِ
  // بی‌کلید از یک نشانی یعنی افتادن در سقفِ «خواندنِ عمومیِ» یک بازدیدکننده
  // (۶۰۰ در دقیقه) — درست‌ترین رفتارِ سامانه، و در عین حال خطایِ اندازه‌گیری:
  // گلوگاهی را نشان می‌داد که در تولید وجود ندارد.


  if (mix === 'purchase') {
    if (!WITH_PAGES) {
      // گام‌هایِ رندرِ برگه از سناریو بیرون می‌روند (بالا توضیحِ کاملش هست)؛
      // خواندن‌ها از خودِ API می‌مانند تا بارِ «مغازه» هم روی سرور باشد.
      steps.length = 0;
    }
    // ── سناریویِ پول: کلِ مسیر، نه فقط «رزروِ موجودی» ─────────────────────
    // سبد ← افزودن ← تسویه ← شروعِ پرداخت ← تصمیمِ درگاهِ آزمایشی ← verify.
    // چرا این‌قدر طولانی؟ چون چیزی که در تولید می‌شکند همین‌جاست: دو خریدار
    // رویِ یک تنوع، یک `FOR UPDATE` رویِ سبد، یک ردیفِ `stock_items`، و مبلغی
    // که باید یک‌بار کسر شود نه دو‌بار. `checkout` (بی‌پرداخت) فقط نیمی از
    // داستان را می‌سنجد: سفارشِ پرداخت‌نشده ساختن «فروش» نیست.
    //
    // همه رویِ **یک تنوع** می‌خرند (همان variantId که سناریو کشف می‌کند) — عمداً:
    // مسابقه رویِ یک ردیف همان چیزی است که می‌خواهیم ببینیم زیرِ بار چه سرِ
    // موجودی می‌آید؛ اگر خریدها میانِ صد تنوع پخش شوند، قفل را نمی‌بینیم و
    // «توانِ فروش» عددی می‌شود که هیچ‌وقت در انبار آزموده نشده.
    const hdr = (state) => ({ ...internalHeader(), ...shopperIpHeader(state) });
    const cartOf = async (state) => {
      if (state.cartId) return state.cartId;
      const created = await request(`${API}/cart`, { method: 'POST', body: {}, readBody: true, headers: hdr(state) });
      if (created.ok) state.cartId = created.json?.cartId ?? null;
      return state.cartId;
    };

    steps.push({
      name: 'خریدِ کامل (سبد ← تسویه ← پرداخت ← تأییدِ درگاه)',
      weight: 100,
      write: true,
      run: async (state) => {
        const t0 = process.hrtime.bigint();
        const ms = () => Number(process.hrtime.bigint() - t0) / 1e6;
        const cartId = await cartOf(state);
        if (!cartId) return { ok: false, status: 0, ms: ms(), error: 'no-cart' };

        const added = await request(`${API}/cart/${cartId}/items`, {
          method: 'POST', body: { variantId: state.variantId, quantity: 1 }, headers: hdr(state),
        });
        if (!added.ok) return { ...added, ms: ms() };

        state.orderSeq = (state.orderSeq ?? 0) + 1;
        const co = await request(`${API}/cart/${cartId}/checkout`, {
          method: 'POST',
          readBody: true,
          body: {
            idempotencyKey: `load-${state.id}-${state.orderSeq}`,
            customerName: 'خریدارِ آزمون',
            customerMobile: `0912${String(state.shopperIndex).padStart(6, '0')}`,
            shippingAddress: 'تهران، خیابانِ آزادی، پلاکِ ۱۲ (آزمونِ بار)',
          },
          headers: hdr(state),
        });
        // سبدِ تسویه‌شده می‌میرد؛ بی‌این‌کردن، کوششِ بعدی CONFLICT می‌گیرد و
        // آزمون خودش را مسابقهٔ «تکراری‌بودنِ کلید» می‌کند، نه فروش.
        state.cartId = null;
        if (!co.ok) {
          if (Number(co.status) === 409) {
            tally.soldOut += 1; // ردِّ درست: موجودی تمام است
            return { ok: true, status: co.status, ms: ms(), rejection: 'out-of-stock' };
          }
          return { ...co, ms: ms() };
        }
        tally.created += 1;
        const orderId = co.json?.orderId ?? co.json?.id ?? null;
        if (!orderId) return { ok: false, status: 0, ms: ms(), error: 'no-order-id' };

        const started = await request(`${API}/payments/start`, {
          method: 'POST', readBody: true, body: { orderId, gateway: 'sandbox' }, headers: hdr(state),
        });
        if (!started.ok) {
          tally.startFailed += 1;
          return { ...started, ms: ms() };
        }
        const authority = started.json?.authority;
        if (!authority) return { ok: false, status: 0, ms: ms(), error: 'no-authority' };

        // یک‌دهمِ خریدها را درگاه «لغو» می‌کند. بی‌این، فقط بهترینِ حالت سنجیده
        // می‌شود؛ و رهاشدنِ رزرو پس از لغو دقیقاً همان جایی است که موجودی می‌تواند
        // گم شود (یا دو‌بار برگردد و فروشنده «کالایِ تمام‌شده» را دوباره بفروشد).
        const approve = ++tally.turns % 10 !== 0;
        const decided = await request(`${API}/payments/sandbox/${authority}/decision`, {
          method: 'POST', body: { decision: approve ? 'paid' : 'cancelled' }, headers: hdr(state),
        });
        if (!decided.ok) {
          tally.startFailed += 1;
          return { ...decided, ms: ms() };
        }

        const verified = await request(`${API}/payments/verify`, {
          method: 'POST', readBody: true, body: { authority, gateway: 'sandbox' }, headers: hdr(state),
        });
        if (!verified.ok) {
          tally.verifyFailed += 1;
          return { ...verified, ms: ms() };
        }
        if (approve) tally.paid += 1;
        else tally.cancelled += 1;
        return { ok: true, status: 200, ms: ms(), paid: approve };
      },
    });

    // دو گامِ خواندنی هم می‌آید، چون پرداختِ واقعی هیچ‌وقت در خلأ اتفاق نمی‌افتد:
    // در همان ثانیه‌ها عده‌ای در حالِ دیدنِ فهرست و جستجویند — و کشِ جستجو هم
    // باید زیرِ همین بار سنجیده شود، نه جدا از آن.
    steps.push({ name: 'فهرستِ کالا (API)', weight: 40, run: () => request(`${API}/catalog/products?limit=24`, { headers: internalHeader() }) });
    steps.push({ name: 'جستجو (API)', weight: 20, run: () => request(`${API}/catalog/search?q=${encodeURIComponent('کابل')}&limit=12`, { headers: internalHeader() }) });
    return steps;
  }

  if (mix === 'buy' || mix === 'checkout') {
    // سه گامِ نوشتنی: سبد، افزودن، و تسویه. «افزودن» تنها چیزی بود که پیش‌تر
    // سنجیده می‌شد؛ امّا چیزی که انبار را قفل می‌کند و پایگاهِ نوشتنی را به
    // چالش می‌کشد، تسویه است (`FOR UPDATE` رویِ سبد + رزروِ موجودی در یک
    // تراکنش). بی‌اندازه‌گیریِ آن، «توانِ فروشگاهی» یعنی توانِ «تماشایِ
    // فروشگاه». برایِ همین `checkout` از `buy` جداست: `buy` نوشتن‌هایِ سبکِ
    // سبد، `checkout` کلِ مسیرِ فروش.
    //
    // یک نکته که نخست اشتباه از آب درآمد: اگر «ساختنِ سبد» یک گامِ وزن‌دارِ
    // جدا باشد، خریدارِ ساختگی ۳۰٪ مواقع به «افزودن/تسویه» می‌رسد در حالی که
    // سبدی ندارد — و آن‌ها «no-cart» می‌شمارند، نه سنجش. پس سبد در همان
    // گامِ نوشتنی ساخته می‌شود و تأخیرِ کلِ روال در همان گام ثبت می‌شود؛
    // دقیقاً همان چیزی که خریدارِ واقعی تجربه می‌کند.
    async function ensureCart(state) {
      if (state.cartId) return null;
      const created = await request(`${API}/cart`, {
        method: 'POST',
        body: {},
        readBody: true,
        headers: { ...internalHeader(), ...shopperIpHeader(state) },
      });
      if (created.ok) state.cartId = created.json?.cartId ?? null;
      return created;
    }

    steps.push({
      name: 'افزودن به سبد',
      weight: 24,
      write: true,
      run: async (state) => {
        const startedAt = process.hrtime.bigint();
        const created = await ensureCart(state);
        if (created && !created.ok) return created;
        // بی‌سبد به `/cart/null/items` نمی‌زنیم: ۴۰۴ِ آن خطایِ سرور نیست،
        // خطایِ خودِ آزمون است و در آمار، توانِ نوشتن را خراب گزارش می‌کند
        if (!state.cartId) return { ok: false, status: 0, ms: 0, error: 'no-cart' };
        const res = await request(`${API}/cart/${state.cartId}/items`, {
          method: 'POST',
          body: { variantId: state.variantId, quantity: 1 },
          headers: { ...internalHeader(), ...shopperIpHeader(state) },
          // بدنه خوانده نمی‌شود: در ۳۰۰ خریدارِ هم‌زمان، صاف‌کردنِ JSONِ
          // «فهرستِ سبد» در هر بار فقط خودِ ابزارِ اندازه‌گیری را سنگین می‌کند.
        });
        return { ...res, ms: res.ms + Number(process.hrtime.bigint() - startedAt) / 1e6 };
      },
    });

    if (mix === 'checkout') {
      steps.push({
        name: 'تسویه (رزروِ موجودی)',
        weight: 16,
        write: true,
        run: async (state) => {
          const startedAt = process.hrtime.bigint();
          const created = await ensureCart(state);
          if (created && !created.ok) return created;
          // بی‌سبد، هر پرس‌وجویی به `/cart/null/items` می‌رود و ۴۰۴ می‌گیرد؛ آن را
          // «خطایِ سرور» نشانه نمی‌گیریم — خطایِ خودِ آزمون است
          if (!state.cartId) return { ok: false, status: 0, ms: 0, error: 'no-cart' };
          if (!(await fillCart(state))) return { ok: false, status: 0, ms: 0, error: 'empty-cart' };
          // کلیدِ یکتا برایِ هر کوشش: بی‌آن، دو کوششِ یک خریدار «تکراری»
          // (duplicate) شمرده می‌شود و توانِ نوشتن پایین‌تر از واقع گزارش می‌شد.
          state.orderSeq = (state.orderSeq ?? 0) + 1;
          const res = await request(`${API}/cart/${state.cartId}/checkout`, {
            method: 'POST',
            body: {
              idempotencyKey: `load-${state.id}-${state.orderSeq}`,
              customerName: 'خریدارِ آزمون',
              customerMobile: `0912${String(state.id).padStart(6, '0')}`,
              shippingAddress: 'تهران، خیابانِ آزادی، پلاکِ ۱۲ (نشانیِ آزمونِ بار)',
            },
            readBody: true,
            headers: { ...internalHeader(), ...shopperIpHeader(state) },
          });
          if (res.ok) {
            // سبدِ تسویه‌شده دیگر «فعال» نیست؛ خریدارِ ساختگی باید سبدِ تازه
            // باز کند، وگرنه گامِ بعد «CONFLICT» می‌گیرد و آزمون دروغ می‌گوید
            state.cartId = null;
            state.filled = false;
            state.checkedOut = (state.checkedOut ?? 0) + 1;
          }
          return { ...res, ms: res.ms + Number(process.hrtime.bigint() - startedAt) / 1e6 };
        },
      });
    }
  }

  return steps;
}

/**
 * سرآیندِ «تماسِ درونی» برایِ درخواست‌هایی که مستقیماً به API می‌زنیم.
 * در تولید این تماس‌ها از لایه‌یِ وب می‌آیند و همین سرآیند را دارند؛ بی‌آن،
 * ابزارِ آزمون مانندِ یک بازدیدکننده‌یِ ناشناس شمرده می‌شود.
 */
function internalHeader() {
  const token = process.env.INTERNAL_API_TOKEN ?? '';
  return token ? { 'x-set-internal': token } : {};
}

/** نشانیِ مشتریِ ساختگی (برایِ حالتِ «پروکسی جلویِ API است») */
function shopperIpHeader(state) {
  if (!REAL_IP_ON) return {};
  return { 'x-real-ip': `200.0.${Math.floor(state.shopperIndex / 250)}.${(state.shopperIndex % 250) + 1}` };
}

const weighted = (steps) => {
  const total = steps.reduce((sum, s) => sum + s.weight, 0);
  let roll = Math.random() * total;
  for (const step of steps) {
    roll -= step.weight;
    if (roll <= 0) return step;
  }
  return steps[steps.length - 1];
};

// ─────────────────────────────────────────────────────────────────────────────
// آمار
// ─────────────────────────────────────────────────────────────────────────────
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

function summarise(samples) {
  const latencies = samples.map((s) => s.ms).sort((a, b) => a - b);
  const errors = samples.filter((s) => !s.ok);
  const byStatus = errors.reduce((acc, e) => {
    const key = `${e.status || e.error}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const byStep = samples.reduce((acc, s) => {
    (acc[s.step] ??= { count: 0, totalMs: 0, errors: 0, cached: 0 });
    acc[s.step].count += 1;
    acc[s.step].totalMs += s.ms;
    if (!s.ok) acc[s.step].errors += 1;
    if (s.cached) acc[s.step].cached += 1;
    return acc;
  }, {});
  const bytes = samples.reduce((sum, s) => sum + (s.size ?? 0), 0);
  // ۴۲۹ «خطا» نیست، **مهارِ نرخ** است: مهارکننده‌یِ خودِ سرویس جلویِ مرگ را
  // گرفته. اگر آن را با ۵۰۰ها در یک سیب بشماریم، گزارشِ ظرفیت هر بار می‌گوید
  // «فروش از دست رفت» در حالی که فقط خریدارِ بیش از توانِ جعبه را رد کرده‌ایم.
  const throttled = errors.filter((e) => Number(e.status) === 429).length;
  const hardErrors = errors.length - throttled;
  return {
    requests: samples.length,
    errors: errors.length,
    throttled,
    hardErrors,
    errorRate: samples.length ? (hardErrors / samples.length) * 100 : 0,
    totalErrorRate: samples.length ? (errors.length / samples.length) * 100 : 0,
    byStatus,
    byStep: Object.entries(byStep)
      .map(([step, v]) => ({
        step,
        count: v.count,
        avgMs: v.totalMs / v.count,
        errors: v.errors,
        cached: v.cached,
      }))
      .sort((a, b) => b.avgMs - a.avgMs),
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    p99: percentile(latencies, 0.99),
    max: latencies.at(-1) ?? 0,
    bytes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// یک مرحله از آزمون با تعدادِ مشخصی خریدار
// ─────────────────────────────────────────────────────────────────────────────
async function runLevel(users, steps, variantId) {
  const samples = [];
  const stopAt = Date.now() + (WARMUP + DURATION) * 1000;
  const warmupUntil = Date.now() + WARMUP * 1000;
  const perSecond = new Map();
  // نمونه‌برداری از بارِ ماشین: اگر بار نزدیکِ شمارِ هسته‌ها باشد و توان
  // باز هم نیاید، گلوگاه «پردازنده» است؛ اگر بار کم باشد و توان نیاید،
  // جایی در انتظاریم (پایگاه، استخرِ اتصال، مهارِ نرخ) — و درمان فرق دارد.
  const loadSamples = [];
  const loadTicker = setInterval(() => loadSamples.push(loadavg()[0]), 500);
  let inFlight = 0;
  let strikes = 0;
  let aborted = '';
  let inFlightPeak = 0;
  let inFlightSum = 0;
  let inFlightTicks = 0;

  const ticker = setInterval(() => {
    inFlightSum += inFlight;
    inFlightTicks += 1;
  }, 100);

  async function shopper(shopperIndex) {
    const state = {
      cartId: null,
      variantId,
      shopperIndex,
      id: `${users}-${shopperIndex}-${Date.now()}`,
    };
    while (Date.now() < stopAt && !aborted) {
      const step = weighted(steps);
      const startedAt = Date.now();
      inFlight += 1;
      if (inFlight > inFlightPeak) inFlightPeak = inFlight;
      const res = await step.run(state);
      inFlight -= 1;
      if (res.ok) strikes = 0;
      else if ((strikes += 1) >= ABORT_AFTER && !aborted) {
        aborted = `${ABORT_AFTER} خطایِ پشتِ سرِ هم (پاسخِ خطا یا بی‌پاسخِ ${TIMEOUT / 1000} ثانیه‌ای)`;
      }
      if (startedAt >= warmupUntil) {
        const second = Math.floor((startedAt - warmupUntil) / 1000);
        perSecond.set(second, (perSecond.get(second) ?? 0) + 1);
        // نمونه‌ها محدود نگه داشته می‌شوند: یک میلیون رکورد در حافظه یعنی
        // خودِ ابزارِ اندازه‌گیری عاملِ کندی شود.
        if (samples.length < 400_000)
          samples.push({
            step: step.name,
            ok: res.ok,
            ms: res.ms,
            status: res.status,
            error: res.error,
            size: res.size,
            // پاسخ‌هایِ کش‌شده از خودِ بدنه خوانده می‌شوند (گام‌هایی که
            // readBody دارند) — تنها راهی که «بهبود» را به عددِ قابلِ باور
            // تبدیل می‌کند: نه «rps رفت بالا»، بلکه «N از M از کش آمد».
            cached: res.json?.cached === true,
          });
      }
      const think = THINK * (0.5 + Math.random());
      await new Promise((r) => setTimeout(r, think));
    }
  }

  const started = Date.now();
  await Promise.all(Array.from({ length: users }, (_u, i) => shopper(i)));
  clearInterval(ticker);
  clearInterval(loadTicker);
  const elapsedSec = (Date.now() - started - WARMUP * 1000) / 1000;
  const stats = summarise(samples);
  stats.users = users;
  stats.seconds = Math.max(elapsedSec, 0.001);
  stats.rps = stats.requests / stats.seconds;
  stats.inFlightAvg = inFlightTicks ? inFlightSum / inFlightTicks : 0;
  stats.inFlightPeak = inFlightPeak;
  stats.timeline = [...perSecond.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
  stats.loadAvg = loadSamples.length ? loadSamples.reduce((a, b) => a + b, 0) / loadSamples.length : 0;
  stats.aborted = aborted;
  stats.cores = cpus().length;
  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// گزارش
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (n, d = 0) => Number(n).toLocaleString('fa-IR', { minimumFractionDigits: d, maximumFractionDigits: d });

function report(stats, verdict) {
  const mixLabel =
    MIX === 'purchase'
      ? 'با خریدِ کامل **تا تأییدِ پرداخت** (موجودی + درگاهِ آزمایشی)'
      : MIX === 'checkout'
        ? 'با خریدِ کامل و ثبتِ سفارش (بی‌پرداخت)'
        : MIX === 'buy'
          ? 'با سبد (بی‌تسویه)'
          : 'فقط تماشا';
  console.log(`\n── ${fmt(stats.users)} خریدارِ هم‌زمان، ${fmt(DURATION)} ثانیه (مکثِ میانگین ${fmt(THINK)} میلی‌ثانیه، ${mixLabel}) ──`);
  console.log(`   درخواست‌ها: ${fmt(stats.requests)}  |  ${fmt(stats.rps, 1)} در ثانیه  |  خطا: ${fmt(stats.errors)} (${fmt(stats.errorRate, 2)}٪)`);
  console.log(`   تأخیر: میانه ${fmt(stats.p50)} | ۹۵٪ ${fmt(stats.p95)} | ۹۹٪ ${fmt(stats.p99)} | بیشینه ${fmt(stats.max)} میلی‌ثانیه`);
  console.log(`   درخواستِ در جریان: میانگین ${fmt(stats.inFlightAvg, 1)}، اوج ${fmt(stats.inFlightPeak)}  (این است آنچه سرور واقعاً هم‌زمان پردازش می‌کند)`);
  console.log(`   حجمِ جابه‌جا‌شده: ${fmt(stats.bytes / 1_000_000, 1)} مگابایت`);
  const loadPct = (stats.loadAvg / stats.cores) * 100;
  console.log(`   بارِ ماشین: ${fmt(stats.loadAvg, 2)} از ${fmt(stats.cores)} هسته (${fmt(loadPct)}٪) — ${loadPct > 80 ? 'پردازنده اشباع است' : loadPct < 40 ? 'پردازنده خلوت است؛ جایِ دیگری در انتظاریم' : 'پردازنده زیرِ بار است'}`);
  console.log(`   کندترین گام‌ها: ${stats.byStep.slice(0, 3).map((s) => `${s.step} ${fmt(s.avgMs)}ms`).join('  ·  ')}`);
  if (MIX === 'purchase') {
    // از آمارِ **همان پله**، نه از شمارندهٔ زنده: شمارندهٔ زنده درست پیش از
    // چاپ به `tallyTotals` منتقل و صفر شده، و چاپِ آن همه‌چیز را «۰» نشان
    // می‌داد در حالی که بلوکِ تمامیتِ موجودی عددِ درست را می‌گفت — دو عددِ
    // ناسازگار در یک گزارش، که بدترین شکلِ باورکردنی‌بودنِ ابزار است.
    const tl = stats.tally ?? tally;
    console.log(
      `   پیامدِ فروش: ${fmt(tl.paid)} پرداخت‌شده · ${fmt(tl.cancelled)} لغوِ درگاه · ${fmt(tl.soldOut)} ردِّ «موجودی نیست» · ${fmt(tl.created)} سفارش · پرداختِ ناموفق ${fmt(tl.startFailed + tl.verifyFailed)}`,
    );
    if (tl.soldOut > 0) {
      console.log(`   (این ${fmt(tl.soldOut)} «خطا» نیستند: فروشگاه نخواست بیشتر از انبار بفروشد.)`);
    }
    // «درخواست» در این سناریو یک چرخهٔ خرید است (۳ تا ۶ فراخوانی HTTP)، نه یک
    // فراخوانی. بی‌این یادداشت، عددِ rpsِ `purchase` با `api` قابلِ مقایسه نیست و
    // یکی دو بار در همین تاریخ، مقایسهٔ نادرستِ همان دو عدد را «سقوطِ توان» خوانده‌ایم.
    console.log(
      `   (هر «درخواست» در این سناریو = یک چرخهٔ خریدِ کامل، نه یک فراخوانی HTTP؛ برایِ سنجیدنش با سناریویِ api آن را در ~${tl.soldOut > 0 ? '۳' : '۶'} تا ۶ ضرب کن: ≈ ${fmt(stats.rps * 4, 1)} فراخوانیِ HTTP در ثانیه.)`,
    );
    if (stats.throttled > 0) {
      console.log('   ⚠️ سهمِ زیادی از این بار را مهارکننده رد کرده — برایِ سنجشِ ظرفیتِ خام، `--relax-limiter` (همان کلیدِ اضطراریِ پنل؛ پس از آزمون دوباره روشن می‌شود).');
    }
  }
  const served = stats.byStep.filter((s) => s.cached > 0);
  if (served.length > 0) {
    console.log(
      `   از کش: ${served.map((s) => `${s.step} ${fmt(s.cached)} از ${fmt(s.count)} (${fmt((s.cached / s.count) * 100)}٪)`).join('  ·  ')}`,
    );
  }
  if (stats.throttled > 0) {
    console.log(
      `   مهارِ نرخ: ${fmt(stats.throttled)} درخواست با ۴۲۹ رد شد (مهارکننده‌یِ خودِ سرویس — خطایِ برنامه نبود؛ یعنی این بار بیش از توانِ همین جعبه درخواست داشتیم)`,
    );
  }
  if (Object.keys(stats.byStatus).length) {
    const top = Object.entries(stats.byStatus).sort((a, b) => b[1] - a[1]).slice(0, 4);
    console.log(`   خطاها: ${top.map(([k, v]) => `${k}×${fmt(v)}`).join('  ·  ')}`);
  }
  if (stats.aborted) {
    console.log(`   فیوزِ اشباع: ${stats.aborted} — اجرا در همین‌جا متوقف شد`);
  }
  console.log(`   حکم: ${verdict}`);
}

/** حکم بر پایه‌یِ تجربه‌یِ خرید، نه میانگین: چیزی که خریدار حس می‌کند ۹۵٪ است */
function verdictOf(stats) {
  if (stats.aborted) return `⛔ فیوزِ اشباع: ${stats.aborted} — این عدد سقفِ فروش نیست، نشانه‌یِ جعبه‌ای است که بیش از توانش از آن خواسته‌ایم (بارِ پایین‌تر بیازمایید، یا استخرِ اتصال/هسته‌ها را زیاد کنید)`;
  if (stats.requests === 0) return '❌ هیچ درخواستی انجام نشد';
  if (stats.errorRate > 1) return `❌ خطایِ واقعی بیش از ۱٪ (${fmt(stats.errorRate, 2)}٪${stats.throttled ? `، بی‌شماریِ ${fmt(stats.throttled)} مهارِ نرخ` : ''}) — فروش در این بار از دست می‌رود`;
  if (stats.throttled > 0) return `⚠️ بی‌خطا، اما ${fmt(stats.throttled)} درخواست با ۴۲۹ رد شد — جعبه توانِ این بار را نداشت و مهارکننده درست کار کرد`;
  if (stats.p95 > 2000) return '❌ ۹۵٪ِ درخواست‌ها کندتر از ۲ ثانیه — خریدار صفحه را می‌بندد';
  if (stats.p95 > 800) return `⚠️ ۹۵٪ در ${fmt(stats.p95)} میلی‌ثانیه — زیرِ بار سنگین شده، اما هنوز قابلِ استفاده`;
  return '✅ زیرِ این بار روان است (۹۵٪ زیرِ ۸۰۰ میلی‌ثانیه، خطا زیرِ ۱٪)';
}

/** نشانهٔ خواندنِ انبار — همان مسیری که پنل می‌رود (ورودِ مدیرِ نمونه). */
async function adminAccessToken() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await request(`${API}/auth/login`, {
      method: 'POST',
      readBody: true,
      body: { mobile: ADMIN_MOBILE, password: ADMIN_PASSWORD },
    });
    if (res.ok && res.json?.accessToken) return res.json.accessToken;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

/** موجودیِ یک تنوع، از خودِ سرویس (نه از پایگاه: می‌خواهیم همان عددِ پنل را ببینیم) */
async function stockOf(stock) {
  const res = await request(`${API}/inventory/stock`, { headers: { authorization: `Bearer ${stock.adminToken}` } , readBody: true });
  if (!res.ok) return null;
  const item = (res.json?.items ?? []).find((i) => i.variant_id === stock.variantId);
  if (!item) return null;
  return { sku: item.sku, onHand: Number(item.on_hand), reserved: Number(item.reserved), available: Number(item.available) };
}

/**
 * حکمِ تمامیت — چیزی که بدونِ آن، «توانِ فروش» فقط یک عددِ rps است.
 *
 * سه چیز را می‌سنجیم، چون سه روشِ مختلف می‌شود در این مسیر اشتباه کرد:
 *   ۱) موجودی هرگز منفی نمی‌شود (فروشِ بیش از انبار = چک‌بی‌محل برای مشتری).
 *   ۲) کسریِ انبار **دقیقاً** برابرِ فروشِ تأییدشده است — نه بیشتر (کسرِ
 *      دوتایی: هم رزرو و هم کسرِ موجودی در یک مسیر) و نه کمتر (سفارشِ
 *      پرداخت‌شده‌ای که انبار را کم نکرده).
 *   ۳) رزروهایِ مانده با سفارش‌هایِ باز می‌خوانند، نه با هیچ — وگرنه «کالای
 *      تمام‌شده» در ویترین می‌ماند تا کارگرِ آزادسازی، که یعنی فروشِ رفته.
 *
 * لغوِ درگاه (`cancelled`) موجودی را **برمی‌گرداند**، پس در کسری شمرده نمی‌شود؛
 * اگر سامانه آن را برگرداند دو‌بار، عددِ این‌جا خودش می‌گوید (reserved منفی/کمتر).
 */
function integrityReport(stock) {
  const b = stock.before;
  const a = stock.after;
  console.log('\n── تمامیتِ موجودی (سناریویِ پول) ──');
  if (!a) {
    console.log('   ❌ خواندنِ انبار پس از آزمون ممکن نشد — سنجش ناتمام.');
    return;
  }
  console.log(`   تنوع: ${a.sku}`);
  console.log(
    `   پیش: on_hand ${fmt(b.onHand)} · reserved ${fmt(b.reserved)} · قابلِ فروش ${fmt(b.available)}` +
      `  |  پس: on_hand ${fmt(a.onHand)} · reserved ${fmt(a.reserved)} · قابلِ فروش ${fmt(a.available)}`,
  );
  const drop = b.onHand - a.onHand;
  const soldQty = tallyTotals.paid; // هر سفارش، یک عدد
  const pending = tallyTotals.created - tallyTotals.paid - tallyTotals.cancelled;
  const problems = [];
  if (a.onHand < 0) problems.push('موجودیِ منفی شد (فروشِ بیش از انبار)');
  if (a.reserved < 0) problems.push('رزروِ منفی شد (آزادسازیِ دوتایی)');
  if (drop !== soldQty) {
    problems.push(drop > soldQty
      ? `کسریِ انبار (${fmt(drop)}) بیشتر از فروشِ تأییدشده (${fmt(soldQty)}) است — کسرِ دوتایی؟`
      : `کسریِ انبار (${fmt(drop)}) کمتر از فروشِ تأییدشده (${fmt(soldQty)}) است — سفارشِ پرداخت‌شده‌ای که انبار را کم نکرده؟`);
  }
  if (a.reserved < pending) {
    problems.push(`رزروِ مانده (${fmt(a.reserved)}) از سفارش‌هایِ پرداخت‌نشده (${fmt(pending)}) کمتر است — رزرو زودتر آزاد شده یا شمارشِ ما می‌لنگد`);
  }
  console.log(`   فروشِ تأییدشده: ${fmt(soldQty)} · ردِّ «موجودی نیست»: ${fmt(tallyTotals.soldOut)} · لغوِ درگاه (بازگشتِ موجودی): ${fmt(tallyTotals.cancelled)}`);
  if (problems.length === 0) {
    console.log('   ✅ حسابِ انبار بست: کسری = فروش، و هیچ‌چه منفی نشد.');
    if (tallyTotals.soldOut > 0) {
      console.log(`   ✅ مهارِ موجودی کار کرد: ${fmt(tallyTotals.soldOut)} خریدار پاسخِ درستِ «موجودی کافی نیست» گرفت، نه سفارشِ شبح.`);
    }
  } else {
    for (const line of problems) console.log(`   ❌ ${line}`);
    process.exitCode = 2;
  }
}

let stockAdminToken = null;

async function main() {
  console.log('── آزمونِ بارِ ست‌شاپ ──');
  console.log(`   وب: ${WEB_LIST.join(' , ')}   API: ${API}`);
  const { productSlugs, categorySlugs } = await discover();
  const steps = buildSteps({ productSlugs, categorySlugs }, MIX, WEB_LIST);

  // یک تنوعِ واقعی برایِ افزودن به سبد
  const detail = await fetch(`${API}/catalog/products?limit=1`).then((r) => r.json()).catch(() => null);
  const variantId = detail?.items?.[0]?.defaultVariantId ?? null;
  if ((MIX === 'buy' || MIX === 'checkout' || MIX === 'purchase') && !variantId) {
    console.log('❌ تنوعی برایِ افزودن به سبد یافت نشد.');
    process.exit(1);
  }

  console.log(`   سناریو: ${steps.length} گام، ${productSlugs.length} کالا، ${categorySlugs.length} دسته`);

  // پیش‌آزماییِ گام‌هایِ خواندنی: یک بار هر گام زده می‌شود و اگر هرکدام
  // غیرموفق برگشت، اندازه‌گیری **شروع نمی‌شود**. بدونِ این، یک نشانیِ غلط
  // (مثلاً `/search` به‌جای `/catalog/search`) یک گزارشِ کامل با «۳۰٪ خطا»
  // می‌سازد که در بهترین حالت بی‌معنی است و در بدترین حالت واردِ مستندات می‌شود.
  // پیش‌آزماییِ سناریویِ پول: اگر درگاهِ آزمایشی فعال نباشد یا مسیرِ تسویه
  // بختک کند، بهتر است در یک درخواست بفهمیم تا بعد از ۳۰ ثانیه «۹۰٪ خطا».
  let limitsWereRelaxed = false;
  if (RELAX) {
    const tok = (stockAdminToken ??= await adminAccessToken());
    if (!tok) {
      console.log('   ⚠️ `--relax-limiter` بی‌اثر: ورودِ مدیر ممکن نشد؛ مهارکننده سرِ جایش می‌ماند.');
    } else {
      const off = await request(`${API}/admin/observability/limits`, {
        method: 'PATCH', readBody: true, body: { enabled: false }, headers: { authorization: `Bearer ${tok}` },
      });
      limitsWereRelaxed = off.ok && off.json?.enabled === false;
      console.log(
        limitsWereRelaxed
          ? '   🔓 مهارکنندهٔ نرخ برایِ این اجرا خاموش شد (`--relax-limiter`) — در پایان روشن می‌شود.'
          : '   ⚠️ خاموش‌کردنِ مهارکننده مجاز نبود (صلاحیت `observability.write` لازم است)؛ ارقام با مهارِ نرخ می‌آیند.',
      );
    }
  }

  if (MIX === 'api' || MIX === 'purchase') {
    const bad = [];
    let throttledProbes = 0;
    // نشانه‌یِ خریدارِ ساختگیِ این مرحله باید با کسی از خریدارهایِ اندازه‌گیری‌شده
    // قاطی نشود: اگر هر دو IPِ «۰» را بگیرند، پیش‌آزمایی با ۴۲۹ِ سهمِ همان
    // خریدار رد می‌شود و ابزار به جای «مسیر وصل است» می‌گوید «شکست خورد».
    let probeIndex = 900_000;
    for (const step of steps) {
      const probe = await step.run({ shopperIndex: probeIndex++, cartId: null, variantId, id: `probe-${probeIndex}` });
      // ۴۲۹ یعنی نشانی وجود دارد و مهارکننده کار می‌کند — پیش‌آزمایی برایِ
      // دیدنِ «۴۰۴/۵۰۰» است، نه برایِ دیدنِ سقفِ سهمیه.
      if (probe.status === 429) {
        throttledProbes += 1;
        continue;
      }
      if (!probe.ok) bad.push(`${step.name} → ${probe.status ?? probe.error}`);
    }
    if (bad.length > 0) {
      // ۴۰۹ در پیش‌آزماییِ `purchase` معنایِ خودش را دارد: «مسیر وصل است، ولی قفسه
      // خالی است». بی‌این تفکیک، ابزار بعد از هر آزمونِ تمام‌شده خودش را «خراب»
      // اعلام می‌کرد و آدم دنبالِ باگِ درگاه می‌گشت.
      const soldOutProbe = MIX === 'purchase' && bad.length === 1 && bad[0].endsWith('→ 409');
      if (!soldOutProbe) {
        console.log(`❌ پیش‌آزمایی شکست خورد: ${bad.join('  ·  ')}`);
        process.exit(1);
      }
      const gw = await request(`${API}/payments/gateways`, { headers: internalHeader(), readBody: true });
      const sandboxListed = (gw.json?.items ?? gw.json?.gateways ?? []).some?.((g) => (g.id ?? g) === 'sandbox');
      console.log(
        `   ⚠️ انبارِ این تنوع خالی است؛ آزمونِ تو فقط «ردِّ درست» را می‌سنجد، نه فروش.` +
          (sandboxListed
            ? ' درگاه‌ها زنده‌اند (sandbox در فهرست هست) پس مسیرِ پرداخت آماده است.'
            : ' ❌ فهرستِ درگاه‌ها هم پاسخِ درست نداد — پیش از سنجشِ پول، سرویسِ پرداخت را نگاه کن.'),
      );
      console.log('   برایِ دیدنِ فروشِ واقعی: از پنل موجودی را پر کن (`/admin/inventory`) یا `bash setup.sh db -y` بزن.');
      if (!sandboxListed) process.exit(1);
    }
    console.log(
      throttledProbes > 0
        ? `   پیش‌آزمایی: گام‌ها زنده‌اند (${fmt(throttledProbes)} تای آنها با ۴۲۹ رد شد — سهمیهٔ IP؛ برایِ اجرایِ تمام‌عیار --relax-limiter را بیازمایید)`
        : '   پیش‌آزمایی: همهٔ گام‌ها ۲۰۰',
    );
  }
  // پیش‌آزماییِ «purchase» یک خریدِ **واقعی** انجام می‌دهد (تا معلوم شود مسیرِ
  // پرداخت وصل است). اگر شمارنده‌اش بماند، یک «پرداخت‌شده» بی‌کسریِ انبار در
  // حسابِ تمامیت می‌آید و ابزار خودش را متهم به باگِ سرویس می‌کند. پس صفر می‌شود.
  tally.created = tally.paid = tally.cancelled = tally.soldOut = tally.startFailed = tally.verifyFailed = 0;
  if (MIX === 'purchase') {
    console.log('   (پیش‌آزمایی یک سفارشِ پرداخت‌شدهٔ آزمون در پایگاه می‌گذارد — با «لغو» از پنل پس می‌گیری.)');
  }
  if (WARMUP > 0) console.log(`   گرم‌کردن: ${fmt(WARMUP)} ثانیه (در آمار نمی‌آید)`);

  const results = [];
  // تمامیتِ موجودی: پیش از نخستین پله و پس از آخرین آن، انبارِ همان تنوع را
  // از خودِ سرویس می‌خوانیم (`GET /inventory/stock`). آنچه می‌خواهیم ببینیم
  // «چند rps» نیست — این است: آیا چیزی جز مقدارِ فروش‌رفته از انبار کم شد؟
  let stock = null;
  if (INTEGRITY) {
    stockAdminToken ??= await adminAccessToken();
    stock = { adminToken: stockAdminToken, before: null, after: null, variantId, sku: null };
    if (!stock.adminToken) {
      console.log('   ⚠️ تمامیتِ موجودی سنجیده نشد: ورودِ مدیر (`' + ADMIN_MOBILE + '`) ممکن نشد.');
    } else {
      stock.before = await stockOf(stock);
      console.log(
        stock.before
          ? `   انبار پیش از آزمون (${stock.before.sku}): on_hand ${fmt(stock.before.onHand)} · reserved ${fmt(stock.before.reserved)} · قابلِ فروش ${fmt(stock.before.available)}`
          : '   ⚠️ ردیفِ انبارِ آن تنوع در `stock_items` پیدا نشد؛ تمامیت سنجیده نمی‌شود.',
      );
    }
  }

  try {
    for (const users of LEVELS) {
      const stats = await runLevel(users, steps, variantId);
      stats.tally = { ...tally };
      rollUpTally();
      results.push(stats);
      report(stats, verdictOf(stats));
    }

    if (stock?.before) {
      stock.after = await stockOf(stock);
      integrityReport(stock);
    }
  } finally {
    // اگر اجرا وسطِ راه پرید، باز هم مهارکننده سرِ جایش برمی‌گردد — «خاموشکردنِ
    // موقت» که فراموش شود، همان سوراخی است که #18 را لازم کرد.
    if (limitsWereRelaxed && stockAdminToken) {
      await request(`${API}/admin/observability/limits`, {
        method: 'PATCH', readBody: true, body: { enabled: true }, headers: { authorization: `Bearer ${stockAdminToken}` },
      });
      limitsWereRelaxed = false;
      console.log('   🔒 مهارکنندهٔ نرخ دوباره روشن شد.');
    }
  }

  // نتیجه‌یِ نهایی: کجا می‌شکند؟
  if (results.length > 1) {
    console.log('\n── پله‌ها در یک نگاه ──');
    for (const s of results) {
      console.log(`   ${String(fmt(s.users)).padStart(6)} خریدار → ${fmt(s.rps, 1).padStart(8)} rps | ۹۵٪: ${fmt(s.p95).padStart(6)}ms | خطا ${fmt(s.errorRate, 2)}٪ | در جریان ${fmt(s.inFlightAvg, 1)}`);
    }
    const broken = results.find((s) => s.errorRate > 1 || s.p95 > 2000);
    const lastGood = results.filter((s) => s.errorRate <= 1 && s.p95 <= 2000).at(-1);
    console.log(
      broken
        ? `\n   سقفِ این دستگاه: ${fmt(lastGood?.users ?? 0)} خریدار (از اینجا به بعد: ${fmt(broken.users)} خریدار، ۹۵٪ = ${fmt(broken.p95)}ms، خطا ${fmt(broken.errorRate, 2)}٪)`
        : `\n   تا ${fmt(results.at(-1).users)} خریدار، هیچ پله‌ای نشکست.`,
    );
  }

  if (JSON_OUT) {
    mkdirSync(dirname(resolve(JSON_OUT)), { recursive: true });
    writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
    console.log(`\n   جزئیات: ${JSON_OUT}`);
  }

  // یادآوریِ صادقانه: این دستگاه، دستگاهِ تولید نیست
  console.log(
    `\nنکته: این عدد سقفِ **این دستگاهِ آزمون** است (${(await import('node:os')).cpus().length} هسته، ` +
      `${fmt((await import('node:os')).totalmem() / 1_073_741_824, 1)} گیگابایت حافظه)، نه سقفِ ست‌شاپ؛ ` +
      `وب، API و پایگاه‌داده همگی رویِ یک ماشین و در کنارِ خودِ ابزارِ اندازه‌گیری‌اند.`,
  );

  // یک تله‌یِ مشخصِ این ابزار: گام‌هایِ `web:` از خودِ سایت می‌گذرند، و سایتِ
  // در حالِ توسعه (`next dev`) هر برگه را یک‌بار ترجمه می‌کند. نتیجه: دو
  // ثانیه «تأخیر» که هیچ ربطی به توانِ سرور ندارد و آدم را به جایِ بهینه‌سازیِ
  // SQL به دنبالِ شبح می‌فرستد. اگر همین نشانه را دیدی، برگه‌ها را با ساختِ
  // تولیدی بسنج.
  const slowWeb = results
    .flatMap((r) => r.byStep)
    .filter((b) => !b.step.includes('(API)') && b.avgMs > 800);
  const fastApi = results
    .flatMap((r) => r.byStep)
    .filter((b) => b.step.includes('(API)') && b.avgMs < 200);
  if (slowWeb.length > 0 && fastApi.length > 0) {
    console.log(
      `⚠️ کندترین‌ها از گام‌هایِ خودِ سایت‌اند (${[...new Set(slowWeb.map((b) => b.step))].slice(0, 3).join('، ')}) در حالی که API سریع است — ` +
        `اگر «apps/web» با «next dev» بالا آمده، این هزینهٔ ترجمهٔ برگه در حالتِ توسعه است، نه توانِ سرور. ` +
        `برایِ سنجشِ واقعی: «npm run build -w @set/web && npm run start -w @set/web» (پیش‌نمایشِ زنده را از کار می‌اندازد؛ بعدش dev را برگردان).`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
