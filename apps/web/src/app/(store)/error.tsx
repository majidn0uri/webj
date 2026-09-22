'use client';

export default function StoreError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="st">
      <div className="container-x" style={{ padding: 'var(--st-9) var(--st-4)', textAlign: 'center' }}>
        <div style={{ fontSize: '4rem', marginBottom: 'var(--st-3)' }}>⚠️</div>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--st-800)', margin: '0 0 var(--st-2)' }}>
          خطایی رخ داد
        </h1>
        <p style={{ fontSize: '1.4rem', color: 'var(--st-500)', margin: '0 0 var(--st-4)', lineHeight: 2 }}>
          متأسفانه مشکلی پیش آمده است. لطفاً دوباره تلاش کنید.
        </p>
        <button
          onClick={reset}
          className="btn-p btn-p--primary"
          style={{ height: 48, fontSize: '1.4rem' }}
        >
          تلاش مجدد
        </button>
      </div>
    </div>
  );
}