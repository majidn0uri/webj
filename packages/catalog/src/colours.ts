/**
 * سواچِ رنگ — همان چیزی که خریدار پیش از خواندنِ هر واژه‌ای می‌بیند.
 *
 * چرا این قدر مهم است؟ چون در بازارِ لوازمِ جانبی، «رنگ» نخستین و پرتکرارترین
 * گزینه‌یِ انتخاب است. فروشگاهی که رنگ‌ها را در یک فهرستِ متنی پنهان کند،
 * خریدار را وامی‌دارد بخواند و حدس بزند («سرمه‌ای» یعنی چه آبی‌ای؟)؛ و هر
 * حدسی که او بزند، احتمالِ برگشتِ کالا را بالا می‌برد.
 *
 * تصمیم‌هایِ این سرویس:
 *
 *  ۱. **رنگ از ویژگیِ تنوع می‌آید، نه از یک جدولِ جدا**. جدولِ جدا یعنی دو
 *     منبعِ حقیقت برایِ یک چیز؛ ویژگی‌ها (`attributes`) همان جایی است که
 *     فروشنده رنگ را می‌نویسد.
 *  ۲. **هر رنگ یک تصویرِ خودش دارد** (ستونِ `product_images.variant_id`
 *     از پیش آماده بود). نبودِ تصویرِ ویژه خطا نیست — به تصویرِ اصلیِ کالا
 *     برمی‌گردیم، نه به جایِ خالی.
 *  ۳. **رنگِ تمام‌شده پنهان نمی‌شود، خط می‌خورد**. پنهان کردن یعنی خریدار
 *     گمان می‌برد آن رنگ اصلاً وجود ندارد؛ خط‌خوردن می‌گوید «هست، امّا
 *     فعلاً نیست» — و همین تفاوت است که او را به «خبرم کن» می‌رساند.
 *  ۴. **نام‌هایِ فارسی به کدِ رنگ ترجمه می‌شوند**. اگر نامی در واژه‌نامه
 *     نباشد، از خودِ تنوع (`color_hex`) خوانده می‌شود؛ و اگر آن هم نباشد،
 *     رنگِ خنثی — نه اینکه تنوعی بی‌دلیل ناپدید شود.
 */

import type { Database, Queryable } from '@set/db';

/**
 * واژه‌نامه‌یِ رنگ‌هایِ فارسی.
 *
 * چرا در کد و نه در پایگاه؟ چون این‌ها «نام» اند، نه «داده‌یِ فروشگاه»؛
 * فروشنده آن‌ها را ویرایش نمی‌کند، بلکه از میانشان برمی‌گزیند. و چون در کد
 * اند، فروشنده می‌تواند هر نامِ دلخواهی بنویسد و ما یا آن را می‌شناسیم یا
 * با رنگِ خنثی کنار می‌آییم — بی‌آنکه چیزی بشکند.
 */
const COLOUR_HEX: Record<string, string> = {
  مشکی: '#1f1f1f',
  سفید: '#f5f5f5',
  خاکستری: '#9e9e9e',
  نقره‌ای: '#c0c0c0',
  طلایی: '#d4a017',
  رزگلد: '#b76e79',
  سرمه‌ای: '#1b2a4a',
  آبی: '#1565c0',
  'آبی آسمانی': '#4fc3f7',
  فیروزه‌ای: '#26c6da',
  سبز: '#2e7d32',
  'سبز یشمی': '#00796b',
  قرمز: '#c62828',
  زرشکی: '#8e1b32',
  صورتی: '#ec407a',
  بنفش: '#6a1b9a',
  یاسی: '#9575cd',
  زرد: '#f9a825',
  نارنجی: '#ef6c00',
  قهوه‌ای: '#5d4037',
  کرم: '#efe0c0',
  بژ: '#d7ccc8',
  شفاف: '#e8f4f8',
};

/** اگر نامی در واژه‌نامه نبود یا رنگی نبود، این است */
export const NEUTRAL_HEX = '#bdbdbd';
/** برچسبی برایِ تنوع‌هایی که رنگ ندارند — تا بی‌دلیل گم نشوند */
export const NO_COLOUR = 'بدونِ رنگ';

export interface ColourSwatch {
  /** نامِ فارسیِ رنگ (یا «بدونِ رنگ») */
  name: string;
  /** کدِ رنگ برایِ نمایشِ گردیِ سواچ */
  hex: string;
  /** تنوعی که این رنگ برمی‌گزیند — نخستینِ موجود، وگرنه نخستین */
  variantId: string;
  /** همه‌یِ تنوع‌هایِ این رنگ (مثلاً رنگِ مشکی برایِ چند مدلِ گوشی) */
  variantIds: string[];
  sku: string | null;
  priceRial: number;
  available: number;
  /** تصویرِ ویژه‌یِ این رنگ؛ نبودش یعنی برگشت به تصویرِ کالا */
  imageUrl: string | null;
  imageCardUrl: string | null;
  imageThumbUrl: string | null;
  placeholder: string | null;
  /** آیا تصویر از خودِ تنوع است یا از کالا؟ (در رابط فرق دارد) */
  hasOwnImage: boolean;
  outOfStock: boolean;
}

interface VariantRow {
  id: string;
  sku: string | null;
  price_rial: string;
  attributes: { color?: string; color_hex?: string; colour?: string } | null;
  available: string;
  sort_order: string;
  image_url: string | null;
  url_card: string | null;
  url_thumb: string | null;
  placeholder: string | null;
}

function normalize(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** نامِ رنگ را به کد برمی‌گرداند — با پذیرشِ «colour» و واژه‌نامه و رنگِ دستی */
function hexOf(raw: string | undefined, explicit: string | undefined): string {
  if (explicit && /^#?[0-9a-f]{6}$/i.test(String(explicit).trim())) {
    const hex = String(explicit).trim();
    return hex.startsWith('#') ? hex : `#${hex}`;
  }
  if (!raw) return NEUTRAL_HEX;
  const key = Object.keys(COLOUR_HEX).find((name) => normalize(name) === normalize(raw));
  return key ? COLOUR_HEX[key]! : NEUTRAL_HEX;
}

function colourOf(attributes: VariantRow['attributes']): string {
  return attributes?.color ?? attributes?.colour ?? '';
}

export class ColourService {
  constructor(private readonly db: Database | Queryable) {}

  /**
   * سواچ‌هایِ یک کالا.
   *
   * ترتیب: نخست رنگ‌هایی که موجودند (تا خریدار به بن‌بست نخورد)، سپس
   * تمام‌شده‌ها، و در هر گروه به ترتیبِ ساختِ تنوع — که همان ترتیبی است که
   * فروشنده در پنل چیده است.
   */
  async swatches(productId: string): Promise<ColourSwatch[]> {
    const { rows } = await this.db.query<VariantRow>(
      `SELECT v.id,
              v.sku,
              v.price_rial,
              v.attributes,
              v.sort_order,
              COALESCE((SELECT SUM(s.on_hand - s.reserved)
                          FROM stock_items s WHERE s.variant_id = v.id), 0)::text AS available,
              img.url        AS image_url,
              img.url_card   AS url_card,
              img.url_thumb  AS url_thumb,
              img.placeholder AS placeholder
         FROM product_variants v
         LEFT JOIN LATERAL (
              SELECT i.url, i.url_card, i.url_thumb, i.placeholder
                FROM product_images i
               WHERE i.variant_id = v.id
               ORDER BY (i.role = 'main') DESC, i.sort_order ASC, i.created_at ASC
               LIMIT 1
         ) img ON TRUE
        WHERE v.product_id = $1 AND v.is_active = true
        ORDER BY v.sort_order ASC, v.sku ASC`,
      [productId],
    );

    if (rows.length === 0) return [];

    // تصویرِ اصلیِ کالا — پشتیبان برایِ رنگ‌هایی که تصویرِ ویژه ندارند
    const main = await this.db.query<{
      url: string | null;
      url_card: string | null;
      url_thumb: string | null;
      placeholder: string | null;
    }>(
      `SELECT url, url_card, url_thumb, placeholder
         FROM product_images
        WHERE product_id = $1 AND variant_id IS NULL
        ORDER BY (role = 'main') DESC, sort_order ASC, created_at ASC
        LIMIT 1`,
      [productId],
    );
    const fallback = main.rows[0] ?? { url: null, url_card: null, url_thumb: null, placeholder: null };

    // گروه‌بندی بر پایه‌یِ نامِ رنگ (بی‌رنگ‌ها جدا می‌مانند)
    const groups = new Map<string, VariantRow[]>();
    for (const row of rows) {
      const name = colourOf(row.attributes) || NO_COLOUR;
      const list = groups.get(name) ?? [];
      list.push(row);
      groups.set(name, list);
    }

    const swatches: ColourSwatch[] = [];
    for (const [name, list] of groups) {
      const firstAvailable = list.find((v) => Number(v.available) > 0) ?? list[0]!;
      const own = Boolean(firstAvailable.image_url);
      swatches.push({
        name,
        hex: hexOf(colourOf(firstAvailable.attributes), firstAvailable.attributes?.color_hex),
        variantId: firstAvailable.id,
        variantIds: list.map((v) => v.id),
        sku: firstAvailable.sku,
        priceRial: Number(firstAvailable.price_rial),
        available: Number(firstAvailable.available),
        imageUrl: own ? firstAvailable.image_url : fallback.url,
        imageCardUrl: own ? firstAvailable.url_card : fallback.url_card,
        imageThumbUrl: own ? firstAvailable.url_thumb : fallback.url_thumb,
        placeholder: own ? firstAvailable.placeholder : fallback.placeholder,
        hasOwnImage: own,
        outOfStock: Number(firstAvailable.available) <= 0,
      });
    }

    swatches.sort((a, b) => {
      if (a.outOfStock !== b.outOfStock) return a.outOfStock ? 1 : -1;
      return 0; // در هر گروه، همان ترتیبِ گروه‌بندی (ساخت)
    });
    return swatches;
  }

  /**
   * تنوعِ برگزیده پس از زدنِ یک سواچ.
   *
   * اگر رنگ چند تنوع داشته باشد (مثلاً مشکی برایِ S23 و برایِ ۱۳)، برگزیدنِ
   * رنگ به‌تنهایی کافی نیست؛ مدلِ گوشیِ برگزیده (که خریدار پیش‌تر انتخاب
   * کرده) تعیین می‌کند کدام تنوع. پس اینجا مدل را می‌گیریم و از میانِ
   * تنوع‌هایِ آن رنگ، آن را برمی‌گزینیم که با گوشیِ او سازگار است.
   */
  async pickVariant(
    productId: string,
    colour: string,
    deviceModelId?: string | null,
  ): Promise<string | null> {
    const swatches = await this.swatches(productId);
    const swatch = swatches.find((s) => s.name === colour) ?? swatches[0];
    if (!swatch) return null;
    if (swatch.variantIds.length === 1 || !deviceModelId) return swatch.variantId;

    const { rows } = await this.db.query<{ id: string }>(
      `SELECT v.id
         FROM product_variants v
         JOIN product_compatibility pc ON pc.variant_id = v.id
        WHERE v.id = ANY($1::uuid[]) AND pc.device_model_id = $2 AND v.is_active = true
        ORDER BY v.sort_order ASC, v.sku ASC
        LIMIT 1`,
      [swatch.variantIds, deviceModelId],
    );
    return rows[0]?.id ?? swatch.variantId;
  }
}
