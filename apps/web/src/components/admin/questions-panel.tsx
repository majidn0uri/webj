'use client';

import { useState, useEffect, useCallback } from 'react';

interface Question {
  id: string;
  product_id: string;
  product_title: string;
  question: string;
  answer: string | null;
  customer_name: string | null;
  is_public: boolean;
  created_at: string;
}

export function QuestionsPanel() {
  const [items, setItems] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<'all' | 'unanswered' | 'answered'>('unanswered');
  const [busy, setBusy] = useState(false);
  const [answerId, setAnswerId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/questions?status=${filter}&limit=50`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token') ?? ''}` },
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
      }
    } finally { setBusy(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function submitAnswer(id: string) {
    if (!answerText.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/admin/questions/${id}/answer`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('admin_token') ?? ''}`,
        },
        body: JSON.stringify({ answer: answerText.trim() }),
      });
      if (res.ok) {
        setMsg('✅ پاسخ ثبت شد');
        setAnswerId(null);
        setAnswerText('');
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        setMsg(`❌ ${err.message ?? 'خطا'}`);
      }
    } finally { setBusy(false); }
  }

  async function toggleVisibility(id: string) {
    await fetch(`/api/admin/questions/${id}/toggle`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token') ?? ''}` },
    });
    load();
  }

  const FILTERS = [
    { value: 'unanswered' as const, label: 'بدون پاسخ' },
    { value: 'answered' as const, label: 'پاسخ‌داده' },
    { value: 'all' as const, label: 'همه' },
  ];

  return (
    <>
      <header className="head">
        <h1 className="head__title">پرسش و پاسخ</h1>
        <p className="head__sub"><span className="num">{total}</span> پرسش</p>
      </header>

      <nav className="filters" aria-label="صافی">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={`chip${filter === f.value ? ' chip--active' : ''}`}
            onClick={() => setFilter(f.value)}
          >{f.label}</button>
        ))}
      </nav>

      {msg && <div className="alert alert--info u-mb-3" >{msg}</div>}

      <section className="panel">
        {busy && <p className="muted">در حال بارگذاری…</p>}
        {!busy && items.length === 0 && <p className="empty">پرسشی یافت نشد.</p>}

        {items.map((q) => (
          <div key={q.id} className="card q-card" >
            <div className="q-card__head">
              <div>
                <strong>{q.product_title}</strong>
                <span className="muted q-card__meta" >
                  {q.customer_name ?? 'ناشناس'} — {new Date(q.created_at).toLocaleDateString('fa-IR')}
                </span>
              </div>
              <div className="u-flex u-gap-1">
                <span className={`pill pill--${q.answer ? 'ok' : 'warn'}`}>
                  {q.answer ? 'پاسخ‌داده' : 'بدون پاسخ'}
                </span>
                {!q.is_public && <span className="pill pill--muted">مخفی</span>}
              </div>
            </div>

            <p className="q-body">{q.question}</p>

            {q.answer && (
              <div className="q-answer">
                <strong className="q-answer__label">پاسخ:</strong>
                <p className="u-mt-2">{q.answer}</p>
              </div>
            )}

            <div className="u-flex u-gap-2">
              {answerId === q.id ? (
                <div className="u-flex-1">
                  <textarea
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value)}
                    placeholder="پاسخ خود را بنویسید…"
                    rows={3}
                    className="q-textarea"
                  />
                  <div className="u-flex u-gap-2 u-mt-2">
                    <button className="btn btn--primary btn--sm" onClick={() => submitAnswer(q.id)} disabled={busy}>
                      ثبت پاسخ
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => { setAnswerId(null); setAnswerText(''); }}>
                      انصراف
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button className="btn btn--sm btn--primary" onClick={() => { setAnswerId(q.id); setAnswerText(''); }}>
                    {q.answer ? 'ویرایش پاسخ' : 'پاسخ دادن'}
                  </button>
                  <button className="btn btn--sm btn--ghost" onClick={() => toggleVisibility(q.id)}>
                    {q.is_public ? 'مخفی کردن' : 'نمایش دادن'}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}