import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="st">
      <div className="container-x" style={{ padding: 'var(--st-9) var(--st-4)', textAlign: 'center' }}>
        <div style={{ fontSize: '6rem', marginBottom: 'var(--st-3)' }}>🔍</div>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--st-800)', margin: '0 0 var(--st-2)' }}>
          صفحه یافت نشد
        </h1>
        <p style={{ fontSize: '1.4rem', color: 'var(--st-500)', margin: '0 0 var(--st-5)', lineHeight: 2, maxWidth: '40ch', marginInline: 'auto' }}>
          صفحه‌ای که دنبالش هستید وجود ندارد یا منتقل شده است.
        </p>
        <Link href="/" className="btn-p btn-p--primary" style={{ height: 48, fontSize: '1.4rem' }}>
          بازگشت به خانه
        </Link>
      </div>
    </div>
  );
}