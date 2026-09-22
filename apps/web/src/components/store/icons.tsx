/**
 * مجموعه‌ی آیکون — همه درون‌خطی (Inline SVG).
 *
 * چرا درون‌خطی و نه قلم‌آیکون یا کتابخانه؟
 *   ۱) هیچ درخواستِ خارجی: سایت باید بدونِ اینترنتِ بین‌الملل کامل بالا بیاید؛
 *   ۲) اندازه و رنگ با `currentColor` و `font-size` از متن پیروی می‌کنند؛
 *   ۳) یک فایلِ فونتِ ۱۰۰ کیلوبایتی برای ده آیکون بارِ اضافی است.
 *
 * همه‌ی آیکون‌ها روی شبکه‌ی ۲۴ طراحی شده‌اند و با `currentColor` رنگ می‌گیرند.
 */
type P = { size?: number; className?: string; strokeWidth?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor' as const,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export function IconSearch({ size = 20, className, strokeWidth = 2 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function IconUser({ size = 20, className, strokeWidth = 2 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  );
}

export function IconCart({ size = 22, className, strokeWidth = 2 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H6" />
      <circle cx="10" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
    </svg>
  );
}

export function IconChevronDown({ size = 16, className, strokeWidth = 2 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function IconChevronLeft({ size = 16, className, strokeWidth = 2 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function IconGrid({ size = 18, className, strokeWidth = 2 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function IconTruck({ size = 20, className, strokeWidth = 1.8 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M2 7h11v9H2z" />
      <path d="M13 10h4.5L21 13v3h-8" />
      <circle cx="6" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </svg>
  );
}

export function IconShield({ size = 20, className, strokeWidth = 1.8 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M12 3l7 3v5.5c0 4.4-2.9 7.9-7 9.5-4.1-1.6-7-5.1-7-9.5V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function IconReturn({ size = 20, className, strokeWidth = 1.8 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M4 9h11a5 5 0 0 1 0 10H9" />
      <path d="M8 5L4 9l4 4" />
    </svg>
  );
}

export function IconPay({ size = 20, className, strokeWidth = 1.8 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M2.5 10h19" />
      <path d="M6 14.5h4" />
    </svg>
  );
}

export function IconStar({ size = 14, className, filled = true }: P & { filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden
      className={className}
    >
      <path d="M12 3.5l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17.4l-5.4 2.8 1.1-6.1L3.2 9.9l6.1-.8z" />
    </svg>
  );
}

export function IconPlus({ size = 18, className, strokeWidth = 2 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconMinus({ size = 18, className, strokeWidth = 2 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function IconTrash({ size = 18, className, strokeWidth = 1.8 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  );
}

export function IconCheck({ size = 18, className, strokeWidth = 2 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

export function IconPhone({ size = 18, className, strokeWidth = 1.8 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <rect x="6" y="2.5" width="12" height="19" rx="3" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}

export function IconFilter({ size = 18, className, strokeWidth = 1.8 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M3 6h18M6 12h12M10 18h4" />
    </svg>
  );
}

export function IconClose({ size = 18, className, strokeWidth = 2 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconHome({ size = 20, className, strokeWidth = 1.8 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}

export function IconBox({ size = 20, className, strokeWidth = 1.8 }: P) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M3 8l9-4.5L21 8v8l-9 4.5L3 16z" />
      <path d="M3 8l9 4.5L21 8M12 12.5V20" />
    </svg>
  );
}
