'use client';

import { useState, useEffect, useCallback } from 'react';

interface Question {
  id: string;
  question: string;
  answer: string;
  customerName: string;
  createdAt: string;
}

/**
 * پرسش و پاسخ محصول — نمایش و ثبت
 *
 * پاسخ‌های تأییدشده نمایش داده می‌شود.
 * خریدار می‌تواند پرسش جدید ثبت کند.
 */
export function ProductQa({ productId }: { productId: string }) {
  const [items, setItems] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/shop/products/${productId}/questions?limit=20`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
      }
    } finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { load(); }, [load]);

  async function submit() {
    if (question.trim().length < 10) {
      setMsg('پرسش باید حداقل ۱۰ حرف باشد.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/shop/products/${productId}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), name: name.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg('✅ پرسش شما ثبت شد و پس از بررسی منتشر خواهد شد.');
        setQuestion('');
        setName('');
        setShowForm(false);
      } else {
        setMsg(`❌ ${data.message ?? 'خطا'}`);
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="qa">
      {loading && <p className="muted">در حال بارگذاری…</p>}

      {!loading && items.length === 0 && (
        <p className="muted sf-mb-1" >
          هنوز پرسشی برای این کالا ثبت نشده. اولین نفری باشید که می‌پرسد!
        </p>
      )}

      {items.map((q) => (
        <div key={q.id} className="qa__item">
          <div className="qa__q">
            <span className="qa__icon">❓</span>
            <div>
              <p className="qa__text">{q.question}</p>
              <span className="qa__meta">{q.customerName}</span>
            </div>
          </div>
          <div className="qa__a">
            <span className="qa__icon">✅</span>
            <div>
              <p className="qa__text">{q.answer}</p>
              <span className="qa__meta">پاسخ فروشگاه</span>
            </div>
          </div>
        </div>
      ))}

      {msg && (
        <div className="alert alert--info sf-mt-1 sf-mb-1 sf-text-base" >
          {msg}
        </div>
      )}

      {showForm ? (
        <div className="qa__form sf-mt-1" >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="نام شما (اختیاری)"
            className="sf-field__input" style={{ marginBottom: 8 }}
          />
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="پرسش خود را بنویسید…"
            rows={3}
            className="sf-field__input" style={{ marginBottom: 8, resize: 'vertical' }}
          />
          <div className="sf-flex sf-gap-1">
            <button className="btn btn--primary btn--sm" onClick={submit} disabled={busy}>
              ثبت پرسش
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => { setShowForm(false); setMsg(''); }}>
              انصراف
            </button>
          </div>
        </div>
      ) : (
        <button
          className="btn btn--ghost btn--sm sf-mt-1"
          
          onClick={() => setShowForm(true)}
        >
          ❓ پرسش جدید
        </button>
      )}
    </div>
  );
}