export default function StoreLoading() {
  return (
    <div className="st">
      <div className="container-x" style={{ padding: 'var(--st-9) var(--st-4)', textAlign: 'center' }}>
        <div
          style={{
            width: 48, height: 48, margin: '0 auto var(--st-4)',
            border: '3px solid var(--st-200)', borderTopColor: 'var(--st-brand)',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }}
        />
        <p style={{ fontSize: '1.4rem', color: 'var(--st-500)' }}>در حال بارگذاری…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}