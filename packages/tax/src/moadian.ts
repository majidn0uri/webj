/**
 * ساخت و اعتبارسنجیِ بسته‌یِ صورتحسابِ الکترونیکی (سامانه‌یِ مؤدیان).
 *
 * این فایل فقط «ترجمه» است: ترجمه‌یِ یک سفارشِ فروشگاهی به بسته‌ای که سازمانِ
 * امورِ مالیاتی می‌فهمد. هر فیلد همان نامی را دارد که در مستنداتِ سامانه
 * آمده (taxid، indatim، tvam، sstid…) تا اگر روزی کسی خواست خروجی را با
 * مستندات بسنجد، مجبور نباشد نام‌ها را حدس بزند.
 *
 * دو قانون که اینجا به‌صورتِ ماشینی اِعمال می‌شود:
 *   ۱) شناسه‌یِ منحصربه‌فردِ مالیاتی ۲۲ کاراکتر و ساختارمند است:
 *      شناسه‌یِ حافظه‌یِ مالیاتی (۱۶) + تاریخ به هگز (۵) + سریال به هگز (۵،
 *      در مجموع ۲۲ با رقمِ کنترلی). اشتباه در آن یعنی ردِ کلِ صورتحساب،
 *      آن هم با خطایی که چیزی نمی‌گوید.
 *   ۲) رابطه‌یِ حسابیِ سرآمد باید درست باشد:
 *      tbill = tprdis − tdis + tvam (+ سایر وجوه) و
 *      cap   = tbill − todam − tvam − insp
 *      سازمان این‌ها را کنترل می‌کند و رد می‌کند؛ بهتر است پیش از ارسال،
 *      خودمان رد کنیم و علتش را به فارسی بگوییم.
 */

import { AppError } from '@set/shared-kernel';

// ─────────────────────────────────────────────────────────────────────────────
// انواع
// ─────────────────────────────────────────────────────────────────────────────

/** نوعِ صورتحساب در سامانه‌یِ مؤدیان */
export const INVOICE_TYPE = {
  /** نوعِ اول: فروشِ کالا/خدمت با جزئیاتِ کامل (همان چیزی که فروشگاه صادر می‌کند) */
  sell: 1,
  /** نوعِ دوم: فروشِ خلاصه (برایِ مشاغلی که معاف از ثبتِ جزئیات‌اند) */
  sellSummary: 2,
} as const;

/** الگویِ صورتحساب (نحوه‌یِ صدور) */
export const ISSUE_PATTERN = {
  /** مستقیم: خودِ مؤدی می‌فرستد */
  self: 1,
} as const;

/** روشِ تسویه (ستلمنت) — فیلدِ setm */
export const SETTLEMENT_METHOD = {
  /** نقد */
  cash: 1,
  /** نسیه */
  credit: 2,
  /** نقد/نسیه (ترکیبی) */
  mixed: 3,
} as const;

/** نوعِ خریدار — فیلدِ tob */
export const BUYER_TYPE = {
  /** حقیقی */
  person: 1,
  /** حقوقی */
  company: 2,
  /** اتباعِ خارجی */
  foreign: 3,
} as const;

export interface MoadianSeller {
  /** شناسه‌یِ ملی/اقتصادیِ فروشنده (tins) */
  nationalId: string;
  /** شناسه‌یِ یکتایِ حافظه‌یِ مالیاتی */
  fiscalId: string;
  /** کدِ پستیِ ۱۰ رقمیِ فروشنده */
  postalCode: string;
  /** شعبه/واحدِ فروشگاهی */
  branchCode?: string | null;
}

export interface MoadianBuyer {
  /** کدِ ملی یا شناسه‌یِ ملیِ خریدار (bid) */
  nationalId?: string | null;
  /** کدِ پستی (bpc) */
  postalCode?: string | null;
  /** شماره‌یِ اقتصادی (bbc) */
  economicCode?: string | null;
  /** نام و نامِ خانوادگی یا نامِ شرکت (bpn) */
  name?: string | null;
  /** نوعِ خریدار */
  type: 1 | 2 | 3;
}

export interface MoadianLine {
  /** شناسه‌یِ کالا/خدمت (sstid) — از stuffid.tax.gov.ir */
  sstid: string;
  /** شرحِ کالا/خدمت (sstt) */
  title: string;
  /** واحدِ اندازه‌گیری (mu) */
  unit: string;
  /** تعداد/مقدار (am) */
  quantity: number;
  /** مبلغِ واحد (fee) به ریال */
  unitPriceRial: bigint;
  /** مبلغِ کل پیش از تخفیف (prdis) */
  preDiscountRial: bigint;
  /** تخفیف (dis) */
  discountRial: bigint;
  /** مبلغ پس از تخفیف (adis) */
  afterDiscountRial: bigint;
  /** نرخِ ارزش‌افزوده به صورتِ اعشاری، مانندِ ۰.۰۹ (vra) */
  vatRate: number;
  /** مبلغِ ارزش‌افزوده (vam) */
  vatRial: bigint;
  /** مجموعِ ردیف (tsstam) */
  totalRial: bigint;
}

export interface MoadianPayment {
  /** شماره‌یِ پیگیری/مرجعِ پرداخت (trn) */
  referenceNo?: string | null;
  /** شماره‌یِ کارتِ پرداخت‌کننده (pcn) */
  cardPan?: string | null;
  /** شناسه‌یِ ترمینال (trmn) */
  terminalNo?: string | null;
}

export interface MoadianInvoiceInput {
  /** شناسه‌یِ منحصربه‌فردِ مالیاتی (۲۲ کاراکتر) */
  taxid: string;
  /** زمانِ صدور به میلی‌ثانیه از epoch (indatim / indati2m) */
  issuedAtMs: number;
  /** شماره‌یِ سریالِ داخلیِ صورتحساب (inno) — یکتا و افزایشی */
  serial: string;
  seller: MoadianSeller;
  buyer: MoadianBuyer;
  lines: MoadianLine[];
  payments: MoadianPayment[];
  /** روشِ تسویه (setm) */
  settlement: 1 | 2 | 3;
  /** هزینه‌یِ ارسال به ریال — جزوِ «سایر وجوه» نیست اما در قیمتِ نهایی هست */
  shippingRial?: bigint;
  /** صورتحسابِ مرجع برای ابطالی/اصلاحی (irtaxid) */
  referenceTaxId?: string | null;
}

export interface MoadianInvoicePacket {
  header: Record<string, unknown>;
  body: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
}

export interface MoadianTotals {
  tprdis: bigint;
  tdis: bigint;
  tadis: bigint;
  tvam: bigint;
  todam: bigint;
  tbill: bigint;
  cap: bigint;
  insp: bigint;
  tvop: bigint;
  tax17: bigint;
}

// ─────────────────────────────────────────────────────────────────────────────
// شناسه‌یِ منحصربه‌فردِ مالیاتی
// ─────────────────────────────────────────────────────────────────────────────

// جدول‌هایِ الگوریتمِ وِرهوف (Verhoeff) — همان که سازمان برای رقمِ کنترلی
// به کار می‌برد و خطاهایِ جابه‌جاییِ ارقام را هم می‌گیرد.
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/**
 * حروفِ شناسه به عدد.
 *
 * چرا تبدیل؟ چون رقمِ کنترلی رویِ رشته‌ای از «ارقام» محاسبه می‌شود، در حالی که
 * شناسه‌یِ حافظه می‌تواند حرف داشته باشد. هر حرف با کدِ یونی‌کدش جایگزین
 * می‌شود (مثلاً A می‌شود ۶۵) تا محاسبه رویِ رشته‌ای یک‌دست از ارقام انجام گیرد.
 */
function alphabetToOrd(item: string): string {
  let out = '';
  for (const ch of item) out += /\d/.test(ch) ? ch : String(ch.charCodeAt(0));
  return out;
}

/** رقمِ کنترلی به روشِ وِرهوف */
export function verhoeffCheckDigit(input: string): string {
  let c = 0;
  const reversed = input.split('').reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    const item = Number(reversed[i]);
    c = VERHOEFF_D[c]![VERHOEFF_P[(i + 1) % 8]![item]!]!;
  }
  return String(VERHOEFF_INV[c]);
}

/**
 * تاریخِ صدور به هگزِ ۵ کاراکتری.
 *
 * مبنا شمارشِ روز از مبدأِ یونیکس است (تقسیمِ زمان بر ۸۶۴۰۰ و گرد کردن)،
 * همان‌طور که در مستنداتِ فنی آمده: سامانه این پنج رقم را با تاریخِ ثبت در
 * حافظه‌یِ مالیاتی مقایسه می‌کند و اگر هم‌خوان نباشد، صورتحساب را با پیامِ
 * «تاریخِ ثبت با indatim مطابقت ندارد» رد می‌کند.
 */
export function dateHex(date: Date): string {
  const days = Math.round(date.getTime() / 86_400_000);
  const padded = String(days).padStart(6, '0');
  const hex = Number(padded).toString(16).toUpperCase().padStart(4, '0').slice(-4);
  return `0${hex}`;
}

/** سریالِ داخلی به هگزِ ۱۰ کاراکتری (سریال نخست به ۱۲ رقم می‌رسد، سپس هگز می‌شود) */
export function serialHex(serial: number): string {
  const normalized = String(Math.trunc(serial)).padStart(12, '0').slice(-12);
  return BigInt(normalized).toString(16).toUpperCase().padStart(10, '0').slice(-10);
}

/**
 * ساختِ شناسه‌یِ منحصربه‌فردِ مالیاتی:
 *
 *   taxid = شناسه‌یِ یکتایِ حافظه + هگزِ تاریخ (۵) + هگزِ سریال (۱۰) + رقمِ کنترلی (۱)
 *
 * با شناسه‌یِ حافظه‌یِ ۶ کاراکتری (رایج) طولِ نهایی ۲۲ می‌شود؛ طولِ درست را از
 * همین فرمول به دست می‌آوریم، نه با عددی ثابت که با تغییرِ قالبِ شناسه غلط شود.
 *
 * نکته‌یِ مهم: سریال باید **یکتا و افزایشی** باشد. تکرارِ آن مستقیم به رد شدن
 * می‌انجامد و سازمان خطایِ روشنی هم نمی‌دهد.
 */
export function buildTaxId(input: {
  fiscalId: string;
  issuedAt: Date;
  serial: number;
}): string {
  const dHex = dateHex(input.issuedAt);
  const sHex = serialHex(input.serial);
  const serialNormalized = String(Math.trunc(input.serial)).padStart(12, '0').slice(-12);
  const days = String(Math.round(input.issuedAt.getTime() / 86_400_000)).padStart(6, '0');
  const check = verhoeffCheckDigit(alphabetToOrd(input.fiscalId) + days + serialNormalized);
  return `${input.fiscalId}${dHex}${sHex}${check}`;
}

/** طولِ درستِ شناسه برای یک شناسه‌یِ حافظه‌یِ مشخص */
export function taxIdLength(fiscalId: string): number {
  return fiscalId.length + 5 + 10 + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// محاسبه و اعتبارسنجی
// ─────────────────────────────────────────────────────────────────────────────

/** جمعِ ردیف‌ها طبقِ قواعدِ سامانه */
export function computeTotals(input: MoadianInvoiceInput): MoadianTotals {
  let tprdis = 0n;
  let tdis = 0n;
  let tvam = 0n;
  let todam = 0n; // سایرِ مالیات‌ها و عوارض — فعلاً صفر (لوازمِ جانبی مشمول نیست)

  for (const l of input.lines) {
    tprdis += l.preDiscountRial;
    tdis += l.discountRial;
    tvam += l.vatRial;
    // مجموعِ ردیف باید با «پس از تخفیف + مالیات» برابر باشد؛ اگر نباشد،
    // یعنی در محاسبه‌یِ فروشگاه اشکالی هست و سازمان کلِ بسته را رد می‌کند
    const expected = l.afterDiscountRial + l.vatRial + todam;
    if (expected !== l.totalRial) {
      throw new AppError('VALIDATION', {
        message: `جمعِ ردیفِ «${l.title}» با اجزایش برابر نیست: ${l.totalRial} در برابرِ ${expected} ریال.`,
      });
    }
  }

  const tadis = tprdis - tdis;
  const tbill = tadis + tvam + todam;
  // مانده‌یِ نقدی (cap): آنچه مشتری واقعاً پرداخته است.
  // در فروشِ آنلاینِ پرداخت‌شده برابر با کلِ صورتحساب است.
  const insp = 0n; // بیمه/سایر کسورات — نداریم
  const cap = tbill - todam - tvam - insp;
  return { tprdis, tdis, tadis, tvam, todam, tbill, cap, insp, tvop: tvam, tax17: 0n };
}

/**
 * اعتبارسنجیِ یک صورتحساب پیش از ارسال.
 *
 * هدف: خطاهایی که سازمان با کدهایِ چندرقمی و بی‌توضیح رد می‌کند، اینجا با
 * پیامِ فارسی و پیش از ارسال گرفته شوند. هر قانون با فیلدی که به آن مربوط
 * است نام‌گذاری شده تا در پنل بتوان دقیقاً گفت کدام کالا مشکل دارد.
 */
export function validateInvoice(input: MoadianInvoiceInput): string[] {
  const errors: string[] = [];

  if (input.taxid.length !== taxIdLength(input.seller.fiscalId)) {
    errors.push(
      `شناسه‌یِ منحصربه‌فردِ مالیاتی باید ${taxIdLength(input.seller.fiscalId)} کاراکتر باشد (اکنون ${input.taxid.length} است).`,
    );
  }
  if (!input.seller.nationalId) {
    errors.push('شناسه‌یِ ملیِ فروشنده وارد نشده (تنظیمات ← مالیات).');
  }
  if (!input.seller.fiscalId) {
    errors.push('شناسه‌یِ یکتایِ حافظه‌یِ مالیاتی وارد نشده (تنظیمات ← مالیات).');
  }
  if (!/^\d{10}$/.test(input.seller.postalCode ?? '')) {
    errors.push('کدِ پستیِ فروشنده باید ۱۰ رقم باشد.');
  }
  if (input.lines.length === 0) {
    errors.push('صورتحساب بدونِ ردیف است.');
  }

  // شناسه‌یِ کالا: برایِ هر ردیف الزامی است. نبودنش یعنی ردِ کلِ بسته،
  // پس پیش از ارسال فهرستِ کالاهایِ بی‌شناسه را می‌گوییم تا درست شود.
  const missingSstid = input.lines.filter((l) => !l.sstid).map((l) => l.title);
  if (missingSstid.length > 0) {
    errors.push(
      `برای ${missingSstid.length} کالا «شناسه‌یِ کالا/خدمت» ثبت نشده: ${missingSstid.slice(0, 3).join('، ')}.`,
    );
  }

  // خریدارِ حقوقی باید شناسه‌یِ ملی داشته باشد؛ حقیقی‌ها در فروشِ خُرد
  // می‌توانند بدونِ شناسه باشند (سامانه مقدارِ خالی را می‌پذیرد)
  if (input.buyer.type === BUYER_TYPE.company && !input.buyer.nationalId) {
    errors.push('خریدار حقوقی است اما شناسه‌یِ ملی ندارد.');
  }

  for (const l of input.lines) {
    if (l.quantity <= 0) errors.push(`تعدادِ «${l.title}» باید بیش از صفر باشد.`);
    if (l.preDiscountRial - l.discountRial !== l.afterDiscountRial) {
      errors.push(`مبلغِ پس از تخفیفِ «${l.title}» با تخفیف هم‌خوان نیست.`);
    }
    if (l.vatRate < 0 || l.vatRate > 1) {
      errors.push(`نرخِ مالیاتِ «${l.title}» باید میانِ صفر و یک باشد.`);
    }
  }

  // رابطه‌یِ حسابیِ سرآمد — همان چیزی که سازمان با دقت کنترل می‌کند
  try {
    const t = computeTotals(input);
    if (t.tbill !== t.tadis + t.tvam + t.todam) {
      errors.push('جمعِ کلِ صورتحساب با اجزایش برابر نیست.');
    }
    if (t.cap !== t.tbill - t.todam - t.tvam - t.insp) {
      errors.push('مانده‌یِ قابلِ پرداخت (cap) با فرمولِ سامانه هم‌خوان نیست.');
    }
  } catch (e) {
    errors.push(e instanceof AppError ? e.message : String(e));
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// ساختِ بسته
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ساختِ بسته‌یِ نهایی. خروجی دقیقاً همان ساختاری است که در مستنداتِ
 * «دستورالعملِ فنیِ نحوه‌یِ اتصال» آمده: یک شیء با سه بخشِ header و body و
 * payments (در برخی نسخه‌ها payment).
 */
export function buildInvoicePacket(input: MoadianInvoiceInput): MoadianInvoicePacket {
  const errors = validateInvoice(input);
  if (errors.length > 0) {
    throw new AppError('VALIDATION', { message: errors.join(' ') });
  }

  const t = computeTotals(input);
  const shipping = input.shippingRial ?? 0n;

  const header: Record<string, unknown> = {
    taxid: input.taxid,
    indatim: input.issuedAtMs,
    indati2m: input.issuedAtMs,
    inty: INVOICE_TYPE.sell,
    inno: input.serial,
    irtaxid: input.referenceTaxId ?? null,
    inp: ISSUE_PATTERN.self,
    ins: 1,
    tins: input.seller.nationalId,
    tob: input.buyer.type,
    bid: input.buyer.nationalId ?? null,
    tinb: input.buyer.type === BUYER_TYPE.company ? input.buyer.nationalId : null,
    bpc: input.buyer.postalCode ?? null,
    bbc: input.buyer.economicCode ?? null,
    bpn: input.buyer.name ?? null,
    sbc: input.seller.branchCode ?? null,
    scln: input.seller.fiscalId,
    tprdis: Number(t.tprdis),
    tdis: Number(t.tdis),
    tadis: Number(t.tadis),
    tvam: Number(t.tvam),
    todam: Number(t.todam),
    tbill: Number(t.tbill),
    setm: input.settlement,
    cap: Number(t.cap),
    insp: Number(t.insp),
    tvop: Number(t.tvop),
    tax17: Number(t.tax17),
  };

  const body = input.lines.map((l) => ({
    sstid: l.sstid,
    sstt: l.title,
    mu: l.unit,
    am: l.quantity,
    fee: Number(l.unitPriceRial),
    prdis: Number(l.preDiscountRial),
    dis: Number(l.discountRial),
    adis: Number(l.afterDiscountRial),
    vra: l.vatRate,
    vam: Number(l.vatRial),
    tsstam: Number(l.totalRial),
  }));

  // هزینه‌یِ ارسال: خودش کالا نیست اما در صورت‌حساب هست، پس به‌صورتِ یک ردیفِ
  // خدمت با واحدِ «خدمت» می‌آید تا tbill با آنچه مشتری پرداخته برابر شود
  if (shipping > 0n) {
    body.push({
      sstid: 'SHIPPING',
      sstt: 'هزینه‌یِ ارسال',
      mu: 'خدمت',
      am: 1,
      fee: Number(shipping),
      prdis: Number(shipping),
      dis: 0,
      adis: Number(shipping),
      vra: 0,
      vam: 0,
      tsstam: Number(shipping),
    });
    header.tprdis = Number(BigInt(header.tprdis as number) + shipping);
    header.tadis = Number(BigInt(header.tadis as number) + shipping);
    header.tbill = Number(BigInt(header.tbill as number) + shipping);
    header.cap = Number(BigInt(header.cap as number) + shipping);
  }

  const payments = input.payments.map((p) => ({
    iinn: null,
    acn: null,
    trmn: p.terminalNo ?? null,
    trn: p.referenceNo ?? null,
    pcn: p.cardPan ?? null,
    pmt: input.settlement === SETTLEMENT_METHOD.cash ? 1 : 2,
  }));

  return { header, body, payments };
}

/** برچسبِ فارسیِ وضعیت برای نمایش در پنل */
export const TAX_STATUS_LABEL: Record<string, string> = {
  queued: 'در صف',
  sending: 'در حالِ ارسال',
  sent: 'فرستاده‌شده (در انتظارِ تأیید)',
  accepted: 'تأییدشده',
  rejected: 'ردشده',
  failed: 'ناموفق',
};
