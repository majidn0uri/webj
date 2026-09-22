/**
 * هسته‌ی پول — همه‌ی مبالغ در پایگاه‌داده BIGINT و به «ریال» ذخیره می‌شوند (بخش Q-2 و U).
 * نمایش به کاربر همیشه به «تومان» است؛ محاسبات هرگز با عدد اعشاری انجام نمی‌شوند.
 */
export type Rial = bigint;

export const RIAL_PER_TOMAN = 10n;
/** واحدِ درصد: ۱ واحد = ۰٫۰۱٪ (مثلاً ۹٪ می‌شود ۹۰۰ واحد) */
export type BasisPoints = number;

/** تقسیم با گردکردنِ «نیم به بالا» (Half-Up) — برای اعداد منفی هم درست کار می‌کند */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('تقسیم بر صفر');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** تبدیلِ تومانِ ورودی کاربر به ریالِ ذخیره‌شده (ورودی می‌تواند فارسی/با جداکننده باشد) */
export function tomanToRial(toman: number | string): Rial {
  const raw = String(toman)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[,,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`مقدار تومان نامعتبر است: ${String(toman)}`);
  }
  const negative = raw.startsWith('-');
  const [intPart = '0', fracPart = ''] = raw.replace('-', '').split('.');
  const oneDecimal = (fracPart + '0').slice(0, 1);
  const rial = BigInt(intPart) * 10n + BigInt(oneDecimal);
  return negative ? -rial : rial;
}

/** درصد از مبلغ، با گردکردنِ نیم‌به‌بالا */
export function percentOf(amount: Rial, basisPoints: BasisPoints): Rial {
  return divRoundHalfUp(amount * BigInt(Math.round(basisPoints)), 10_000n);
}

/**
 * توزیعِ دقیقِ یک مبلغ روی چند سهم (مثل تخصیصِ تخفیف یا هزینه‌ی حمل به ردیف‌ها).
 * تضمین می‌کند که مجموعِ خروجی دقیقاً برابرِ ورودی باشد — هیچ ریالی گم نمی‌شود.
 */
export function allocate(total: Rial, weights: readonly number[]): Rial[] {
  const n = weights.length;
  if (n === 0) return [];
  const scale = 1_000_000n;
  const scaled = weights.map((w) => BigInt(Math.round(Math.abs(w) * 1e6)));
  const sumScaled = scaled.reduce((a, b) => a + b, 0n);
  if (sumScaled === 0n) return allocate(total, new Array<number>(n).fill(1));

  const out: Rial[] = scaled.map((w) => (total * w) / sumScaled);
  const remainders = scaled.map((w, i) => ({ i, r: (total * w) % sumScaled }));
  remainders.sort((a, b) => (a.r > b.r ? -1 : a.r < b.r ? 1 : a.i - b.i));

  let remainder = total - out.reduce((a, b) => a + b, 0n);
  let k = 0;
  while (remainder !== 0n && k < n * 2) {
    const idx = remainders[k % n]!.i;
    const step = remainder > 0n ? 1n : -1n;
    out[idx] = out[idx]! + step;
    remainder -= step;
    k++;
  }
  return out;
}

export interface LineInput {
  unitPrice: Rial;
  quantity: number;
  /** تخفیفِ سطحِ ردیف — طبق بخش U «قبل از مالیات» اعمال می‌شود */
  discount?: Rial;
  taxBasisPoints: BasisPoints;
}

export interface LineResult {
  gross: Rial;
  discount: Rial;
  /** مبنای مالیات = gross - discount */
  net: Rial;
  tax: Rial;
  total: Rial;
}

/** محاسبه‌ی یک ردیف: تخفیف پیش از مالیات، مالیات در سطحِ ردیف */
export function calcLine(input: LineInput): LineResult {
  const gross = input.unitPrice * BigInt(input.quantity);
  const discount = input.discount ?? 0n;
  const net = gross - discount;
  const tax = percentOf(net, input.taxBasisPoints);
  return { gross, discount, net, tax, total: net + tax };
}

export function sumLines(lines: readonly LineResult[]): {
  gross: Rial;
  discount: Rial;
  net: Rial;
  tax: Rial;
  total: Rial;
} {
  return lines.reduce(
    (acc, l) => ({
      gross: acc.gross + l.gross,
      discount: acc.discount + l.discount,
      net: acc.net + l.net,
      tax: acc.tax + l.tax,
      total: acc.total + l.total,
    }),
    { gross: 0n, discount: 0n, net: 0n, tax: 0n, total: 0n },
  );
}

/** نمایش به تومان — با ارقام فارسی و جداکننده‌ی هزارگانِ فارسی در حالت پیش‌فرض */
export function formatToman(
  rial: Rial,
  opts: { digits?: 'fa' | 'en'; separator?: boolean } = {},
): string {
  const { digits = 'fa', separator = true } = opts;
  const toman = divRoundHalfUp(rial, RIAL_PER_TOMAN);
  const negative = toman < 0n;
  const abs = (negative ? -toman : toman).toString();
  const sepChar = digits === 'fa' ? '٬' : ',';
  const withSep = separator ? abs.replace(/\B(?=(\d{3})+(?!\d))/g, sepChar) : abs;
  const body = digits === 'fa' ? withSep.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!) : withSep;
  return (negative ? '−' : '') + body;
}
