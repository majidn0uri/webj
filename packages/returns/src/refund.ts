import { divRoundHalfUp, percentOf, type Rial } from '@set/shared-kernel';

/**
 * محاسبه‌یِ وجهِ بازگشتی.
 *
 * چرا پیچیده‌تر از «تعداد × قیمت» است؟
 * چون مشتری ممکن است با تخفیف خریده باشد و ارزش‌افزوده پرداخته باشد. اگر کلِ
 * قیمت را برگردانیم، تخفیف را پس نداده‌ایم و مبلغی را بخشیده‌ایم که در سندِ
 * فروش هرگز به‌عنوان درآمد ثبت نشده؛ و اگر مالیات را برنگردانیم، مالیاتی را
 * به سازمان پرداخته‌ایم که فروشش انجام نشده است.
 *
 * پس مبلغِ درست = خالصِ واقعیِ پرداختی + ارزش‌افزوده‌ی واقعیِ پرداختی.
 *
 * قاعده‌یِ گردکردن: گردکردنِ نیم‌به‌بالا، همان قاعده‌یِ سراسریِ پروژه. و یک
 * استثنایِ مهم: اگر کلِ ردیف برمی‌گردد، دقیقاً همان مبلغی برمی‌گردد که در
 * سفارش ثبت شده — نه یک ریال کمتر یا بیشتر. (بدونِ این قاعده، برگشتِ کل
 * می‌توانست به‌خاطرِ گردکردنِ هر واحد، یک ریال متفاوت شود و حسابدار باید
 * دنبالِ ریالِ گمشده می‌گشت.)
 */

export interface RefundLineInput {
  /** فیِ واحد (بدونِ تخفیف) */
  unitPriceRial: Rial;
  /** تعدادِ کلِ خریداری‌شده در این ردیفِ سفارش */
  purchasedQuantity: number;
  /** تعدادی که این بار برمی‌گردد */
  returnedQuantity: number;
  /** تخفیفِ ثبت‌شده رویِ این ردیف */
  lineDiscountRial: Rial;
  /** ارزش‌افزوده‌ی ثبت‌شده رویِ این ردیف */
  lineTaxRial: Rial;
  /**
   * تعدادی که پیش‌تر (در مرجوعی‌هایِ زنده‌یِ دیگر) از همین ردیف برگشته است.
   *
   * چرا لازم است؟ چون بدونِ آن، سه مرجوعیِ جداگانه‌یِ «یک عدد از سه عدد» می‌تواند
   * رویِ هم از کلِ ردیف بیشتر برگرداند (هر بار گردکردنِ نیم‌به‌بالا یک ریال اضافه
   * می‌تراشد). سقفِ باقی‌مانده جلویِ این نشت را می‌گیرد.
   */
  alreadyReturnedQuantity?: number;
}

export interface RefundLineResult {
  /** خالصِ قابلِ بازگشت (پس از تخفیف) */
  netRial: Rial;
  /** ارزش‌افزوده‌ی قابلِ بازگشت */
  taxRial: Rial;
  /** جمع (همان که به مشتری برمی‌گردد) */
  grossRial: Rial;
}

export function refundLine(input: RefundLineInput): RefundLineResult {
  const purchased = BigInt(input.purchasedQuantity);
  const returned = BigInt(input.returnedQuantity);

  if (purchased <= 0n) {
    throw new Error('تعدادِ خریداری‌شده باید بیش از صفر باشد');
  }
  if (returned <= 0n || returned > purchased) {
    throw new Error('تعدادِ مرجوعی باید بینِ یک و تعدادِ خریداری‌شده باشد');
  }

  const grossBeforeDiscount = input.unitPriceRial * purchased;
  const netTotal = grossBeforeDiscount - input.lineDiscountRial;

  // برگشتِ کلِ ردیف: مبلغِ دقیقِ ثبت‌شده، بدونِ هیچ گردکردنی
  if (returned === purchased) {
    return {
      netRial: netTotal,
      taxRial: input.lineTaxRial,
      grossRial: netTotal + input.lineTaxRial,
    };
  }

  // برگشتِ جزئی: سهمِ هر واحد با گردکردنِ نیم‌به‌بالا
  const netPerUnit = divRoundHalfUp(netTotal, purchased);
  const taxPerUnit = divRoundHalfUp(input.lineTaxRial, purchased);

  // سقفِ باقی‌مانده: آنچه از این ردیف هنوز برنگشته است
  const already = BigInt(Math.max(0, input.alreadyReturnedQuantity ?? 0));
  const remainingNet = netTotal - netPerUnit * already;
  const remainingTax = input.lineTaxRial - taxPerUnit * already;

  let netRial = netPerUnit * returned;
  let taxRial = taxPerUnit * returned;
  if (netRial > remainingNet) netRial = remainingNet > 0n ? remainingNet : 0n;
  if (taxRial > remainingTax) taxRial = remainingTax > 0n ? remainingTax : 0n;

  return { netRial, taxRial, grossRial: netRial + taxRial };
}

/**
 * کارمزدِ بازگشت — فقط برایِ انصراف و فقط اگر کالا سالم برنگشته باشد.
 *
 * چرا این شرط؟ چون در انصرافِ قانونی، مشتری حق دارد کالا را برگرداند، اما حق
 * ندارد کالایِ آسیب‌دیده را به قیمتِ نو به ما بفروشد. و در عیبِ کالا یا
 * اشتباهِ ما، گرفتنِ کارمزد بی‌انصافی است.
 */
export function restockFeeOf(input: {
  netRial: Rial;
  feeBp: number;
  kind: 'withdrawal' | 'defective' | 'warranty' | 'wrong_item';
  condition: 'unknown' | 'sellable' | 'opened' | 'damaged' | 'defective' | 'wrong_item';
}): Rial {
  const sellerFault = input.kind === 'defective' || input.kind === 'wrong_item';
  if (sellerFault) return 0n;
  if (input.kind === 'warranty') return 0n;
  // فقط انصراف می‌ماند: کالایِ سالم (بازنشده) بی‌کارمزد است
  if (input.condition === 'sellable' || input.condition === 'unknown') return 0n;
  if (input.feeBp <= 0) return 0n;
  return percentOf(input.netRial, input.feeBp);
}
