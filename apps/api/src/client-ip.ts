/**
 * نشانیِ واقعیِ بازدیدکننده — تنها وقتی به سرآیندهایِ «پیشِ من» اعتماد می‌کنیم
 * که درخواست **واقعاً** از یک پروکسیِ شناخته‌شده آمده باشد.
 *
 * چرا این یک مسئله است و نه وسواسِ امنیتی؟ چون `trustProxy: true` (که یک‌زمان
 * اینجا روشن بود) نخستین مقدارِ `X-Forwarded-For` را می‌پذیرد — و نخستین مقدار
 * را **خودِ کلاینت** نوشته است. سه پیامدِ واقعی داشت:
 *
 *   ۱. دورزدنِ مهارِ نرخ: `public.read`/`search`/`public.write` با «نشانی»
 *      شمرده می‌شوند. یک مهاجم با هر درخواست یک `X-Forwarded-For: 10.0.0.N`
 *      می‌فرستد و سقفش بی‌نهایت می‌شود (اندازه‌گیری شد: با سرآیندِ جعلی،
 *      `order.create` که ۱۰ در ساعت است، بی‌انتها پاسخِ ۲۰۱ می‌داد).
 *   ۲. جعلِ لاگِ امنیتی: `login_attempts.ip`، رویدادهایِ مهارِ نرخ، و
 *      `payments.meta.ip` از همین نشانی نوشته می‌شوند — یعنی مهاجم می‌تواند
 *      ردِپایش را به نشانیِ دیگری ببندد.
 *   ۳. خودِ-انکارِ سرویس (self-DoS): اگر روزی «سقف برایِ هر نشانی» به لیستِ
 *      سیاه تبدیل شود، نشانیِ جعلی، بی‌گناه را می‌بندد.
 *
 * قراردادِ درست، همان چیزی است که nginx در `deploy/nginx/setshop.conf` می‌فرستد:
 * `X-Forwarded-For: $proxy_add_x_forwarded_for` یعنی «همه‌یِ آنچه کلاینت
 * فرستاده، و **در آخر** نشانیِ واقعیِ مشتری». پس از آخر می‌خوانیم، آن هم تنها
 * وقتی همسایه‌یِ socket در فهرستِ اعتماد باشد. `X-Real-IP` (که همان `$remote_addr`
 * است) مرجعِ نخست است، چون ساختنش با سرآیندِ جعلی ممکن نیست — تنها در صورتی
 * که همدست باشد.
 */

/** نشانی‌هایِ قابلِ اعتماد (پروکسیِ هم‌ماشین، نشانیِ شبکه‌یِ وب، …) */
export function parseTrustedProxies(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * یک نشانیِ IPv4/IPv6 یا نامِ IP-نشان را به صورتِ «پیشوندِ /n» هم می‌پذیرد
 * (`10.0.0.0/8`)، چون در شبکه‌یِ ایران وب و API گاه در دو کانتینر رویِ یک
 * ماشین‌میزبان‌اند و نشانیِ داخلشان ثابت نیست.
 */
function matchesTrusted(peer: string, trusted: string[]): boolean {
  const normalizedPeer = peer.replace(/^::ffff:/, '');
  for (const entry of trusted) {
    const normalizedEntry = entry.replace(/^::ffff:/, '');
    if (normalizedEntry.includes('/')) {
      const [base, bitsRaw] = normalizedEntry.split('/');
      const bits = Number(bitsRaw);
      if (!Number.isFinite(bits) || !base) continue;
      if (sameCidrBlock(normalizedPeer, base, bits)) return true;
      continue;
    }
    if (normalizedPeer === normalizedEntry) return true;
  }
  return false;
}

/** مقایسه‌یِ پیشوندِ بیت‌به‌بیت برایِ IPv4 (IPv6 با همان قاعده، کوتاه‌شده) */
function sameCidrBlock(peer: string, base: string, bits: number): boolean {
  const toInt = (ip: string): number | null => {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
    return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
  };
  const a = toInt(peer);
  const b = toInt(base);
  if (a === null || b === null) return peer === base;
  const mask = bits <= 0 ? 0 : bits >= 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) >>> 0 === (b & mask) >>> 0;
}

export interface IpSources {
  /** نشانیِ همسایه (socket) — تنها چیزی که جعلش از بیرون ممکن نیست */
  peer?: string | null;
  realIpHeader?: string | null;
  forwardedHeader?: string | null;
  /** نشانیِ خودِ وب (لایه‌یِ Next) وقتی از راهِ پروکسیِ داخلی می‌زند */
  clientIpHeader?: string | null;
}

/**
 * نشانیِ بازدیدکننده را برمی‌گرداند؛ تهی یعنی «از دیدِ ما قابلِ اثبات نیست»
 * و فرستنده‌اش باید خودش تصمیم بگیرد (مهارِ نرخ «ناشناس» را در یک سطل می‌گذارد
 * — بی‌اعتبارترین حالتِ ممکن، نه ناامن‌ترینِ آن‌ها برایِ فروش).
 */
export function resolveClientIp(
  sources: IpSources,
  trusted: string[],
  /** آیا تماس با کلیدِ درونیِ وب آمده؟ (وب ← API، بی‌nginx) */
  internal = false,
): string | null {
  const peer = (sources.peer ?? '').trim().replace(/^::ffff:/, '');
  const peerIsTrusted = trusted.length > 0 && matchesTrusted(peer, trusted);
  const trustThisHop = internal || peerIsTrusted;
  if (!trustThisHop) {
    // هیچ سرآیندِ «پیشِ من» اعتبار ندارد — حتی اگر صادقانه به نظر برسد
    return peer || null;
  }

  // لایه‌یِ وب نشانیِ مشتری را در `x-set-client-ip` می‌گذارد. دو راهِ پذیرش،
  // دو استقرارِ متفاوت:
  //   • همتا در `TRUSTED_PROXY_IPS` باشد (وب و API رویِ یک شبکه‌یِ داخلی) —
  //     این راهِ مسیرهایِ بی‌کلیدِ درونی است، مثلِ میانجیِ «پیشنهادِ جستجو»،
  //     که عمداً بی‌کلید می‌زند تا از سقف‌هایِ عمومی معاف نشود؛
  //   • یا `internal` (کلیدِ درونی + `TRUST_WEB_CLIENT_IP`)، برایِ استقرارهایی
  //     که نشانیِ وب را در فهرستِ اعتماد نمی‌نویسند.
  // هر دو «fail-closed» اند: از بیرون، همان سرآیند هیچ قدرتی ندارد.
  if (internal || peerIsTrusted) {
    const fromWeb = (sources.clientIpHeader ?? '').split(',')[0]?.trim();
    if (fromWeb) return fromWeb;
  }

  const real = (sources.realIpHeader ?? '').split(',')[0]?.trim();
  if (real) return real;

  const chain = (sources.forwardedHeader ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // از آخر: آخرین مقدار را پروکسیِ قابلِ اعتماد افزوده است، نه کلاینت
  const last = chain.at(-1);
  return last ?? peer ?? null;
}
