'use client';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' }}>
        خطا در پنل مدیریت
      </h2>
      <p style={{ color: '#666', marginBottom: '1.5rem' }}>
        {error.message || 'مشکلی پیش آمده است.'}
      </p>
      <button
        onClick={reset}
        className="btn btn--primary"
      >
        تلاش مجدد
      </button>
    </div>
  );
}