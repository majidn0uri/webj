/**
 * اظهارِ نوع برایِ `fontkit`.
 *
 * چرا این پرونده وجود دارد؟ چون نسخه‌یِ ۲ کتابخانه‌یِ `fontkit` نوع‌هایِ
 * تایپ‌اسکریپت همراه ندارد و بدونِ این اظهار، کلِ بسته با `any`ِ پنهان
 * واکاوی می‌شد — یعنی هیچ خطایِ تایپی در لغزش‌هایِ کوچک (مثلاً جابه‌جا
 * فرستادنِ دو آرگومانِ `layout`) گرفته نمی‌شد. اینجا فقط همان بخش‌هایی
 * تعریف شده که واقعاً به کار می‌رود؛ تعریفِ کاملِ یک کتابخانه‌یِ بزرگ،
 * خود به منبعِ خطا تبدیل می‌شود.
 */

declare module 'fontkit' {
  /** یک نگاره (گلیف) در قلم */
  export interface Glyph {
    id: number;
    /** پهنایِ پیشروی به واحدِ قلم (واحد در هر em) */
    advanceWidth?: number;
    /** کدهایِ یونیکدی که این نگاره نماینده‌یِ آن‌هاست */
    codePoints?: number[];
  }

  /** جایگاهِ یک نگاره پس از شکل‌دهی (شاملِ کرنینگ و نشانه‌ها) */
  export interface GlyphPosition {
    xAdvance?: number;
    yAdvance?: number;
    xOffset?: number;
    yOffset?: number;
  }

  /** حاصلِ شکل‌دهیِ یک رشته */
  export interface GlyphRun {
    glyphs: Glyph[];
    positions: GlyphPosition[];
    advanceWidth?: number;
  }

  /** زیرمجموعه‌ای از قلم که تنها نگاره‌هایِ به‌کاررفته را در بر می‌گیرد */
  export interface Subset {
    /** نگاره را به زیرمجموعه می‌افزاید و شناسه‌اش را برمی‌گرداند */
    includeGlyph(gid: number): number;
    /** پرونده‌یِ قلمِ زیرمجموعه را می‌سازد */
    encode(): Uint8Array;
  }

  export interface BoundingBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }

  export interface Font {
    unitsPerEm: number;
    ascent: number;
    descent: number;
    lineGap: number;
    capHeight: number;
    xHeight: number;
    /** زاویه‌یِ کجیِ قلم؛ برایِ واکشیِ «مورب بودن» در توصیف‌گرِ پی‌دی‌اف */
    italicAngle: number;
    bbox: BoundingBox;
    numGlyphs: number;
    postscriptName?: string;

    /**
     * شکل‌دهی و چینشِ یک رشته.
     *
     * `dir='ltr'` درخواست می‌شود تا `fontkit` وارونگیِ دو‌سویه‌یِ خود را
     * انجام ندهد (شرحِ کامل در `bidi.ts`).
     */
    layout(
      text: string,
      features?: unknown,
      script?: unknown,
      language?: unknown,
      dir?: 'ltr' | 'rtl',
    ): GlyphRun;

    createSubset(): Subset;
    getGlyph(id: number, codePoints?: number[]): Glyph;
  }

  /** باز کردنِ همگامِ یک پرونده‌یِ قلم */
  export function openSync(path: string): Font;
  /** ساختنِ قلم از رویِ بافر (برایِ قلم‌هایِ درون‌گذاری‌شده در پی‌دی‌اف) */
  export function create(buffer: Uint8Array | Buffer, postscriptName?: string): Font;
}
