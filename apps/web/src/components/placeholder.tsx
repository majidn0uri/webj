/**
 * تصویرِ جانشینِ محلی — هیچ درخواستی به اینترنت (الزامِ بخش AA).
 * وقتی عکاسیِ حرفه‌ای انجام شد، همین کامپوننت با <img> واقعی جایگزین می‌شود.
 */
export function ImagePlaceholder({ label, ratio = '1 / 1' }: { label: string; ratio?: string }) {
  return (
    <div
      style={{
        aspectRatio: ratio,
        background: 'var(--c-surface-2)',
        border: '1px solid var(--c-border)',
        borderRadius: 'var(--r-md)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--s-4)',
        textAlign: 'center',
      }}
      role="img"
      aria-label={`تصویرِ ${label}`}
    >
      <span style={{ color: 'var(--c-text-3)', fontSize: 'var(--fs-xs)', lineHeight: 1.6 }}>
        تصویرِ محصول
        <br />
        <span style={{ opacity: 0.7 }}>{label}</span>
      </span>
    </div>
  );
}
