'use client';

import { useEffect, useState } from 'react';

import { faDigits } from '@/lib/format';

import {
  loadReviewsForAdmin,
  moderateReview,
  replyToReview,
  type AdminReview,
} from '@/lib/review-actions';

/**
 * پنلِ نظرات.
 *
 * اینجا تصمیمِ اصلی این است: **در انتظار‌ها نخست می‌آیند**. فهرستی که
 * تازه‌ترین را بالا بیاورد، نظرِ تأییدنشده را در میانِ انبوهِ نظرهایِ
 * منتشرشده گم می‌کند — و «گم شدنِ نظرِ در انتظار» یعنی مشتری نوشته و
 * پاسخی ندیده. صفِ بررسی باید پیشِ چشم باشد، نه در انتهایِ فهرست.
 *
 * دوم: چرا رد کردن داریم نه فقط پنهان کردن؟ چون نظرِ بد را پاک کردن،
 * مشکل را پاک نمی‌کند — کالا همان است که بود. پاسخ دادن زیرِ نظرِ منتشرشده،
 * هم مشکل را می‌گوید و هم به خریدارِ بعدی نشان می‌دهد فروشنده پاسخ‌گو است.
 */

type Status = { tone: 'ok' | 'bad'; text: string } | null;

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'pending', label: 'در انتظار' },
  { key: 'approved', label: 'منتشرشده' },
  { key: 'rejected', label: 'ردشده' },
  { key: 'all', label: 'همه' },
];

function Stars({ value }: { value: number }) {
  return (
    <span className="stars" title={`${value} از ۵`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star} className={star <= value ? 'stars__on' : 'stars__off'}>
          ★
        </span>
      ))}
    </span>
  );
}

function DateCell({ iso }: { iso: string }) {
  const text = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(new Date(iso));
  return <span className="num">{text}</span>;
}

export function ReviewsPanel() {
  const [items, setItems] = useState<AdminReview[]>([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 });
  const [filter, setFilter] = useState('pending');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    void loadReviewsForAdmin({ status: filter }).then((result) => {
      if (result.ok) {
        setItems(result.data.items);
        setCounts(result.data.counts);
      } else setStatus({ tone: 'bad', text: result.message });
    });
  }, [filter]);

  async function decide(review: AdminReview, next: 'approved' | 'rejected') {
    setBusy(true);
    const result = await moderateReview(review.id, next);
    setBusy(false);
    if (result.ok) {
      setStatus({ tone: 'ok', text: result.data.message });
      const reloaded = await loadReviewsForAdmin({ status: filter });
      if (reloaded.ok) {
        setItems(reloaded.data.items);
        setCounts(reloaded.data.counts);
      }
    } else setStatus({ tone: 'bad', text: result.message });
  }

  async function sendReply(review: AdminReview) {
    if (replyText.trim().length === 0) {
      setStatus({ tone: 'bad', text: 'متنِ پاسخ را بنویسید.' });
      return;
    }
    setBusy(true);
    const result = await replyToReview(review.id, replyText);
    setBusy(false);
    if (result.ok) {
      setStatus({ tone: 'ok', text: result.data.message });
      setReplyFor(null);
      setReplyText('');
      const reloaded = await loadReviewsForAdmin({ status: filter });
      if (reloaded.ok) setItems(reloaded.data.items);
    } else setStatus({ tone: 'bad', text: result.message });
  }

  return (
    <div className="stack">
      {status ? (
        <div className={status.tone === 'ok' ? 'alert alert--ok' : 'alert alert--danger'}>{status.text}</div>
      ) : null}

      <div className="actions">
        {FILTERS.map((option) => (
          <button
            key={option.key}
            type="button"
            className={filter === option.key ? 'btn btn--sm' : 'btn btn--sm btn--ghost'}
            onClick={() => setFilter(option.key)}
          >
            {option.label}
            {option.key !== 'all' && counts[option.key as 'pending'] > 0 ? (
              <span className="num"> ({faDigits(String(counts[option.key as 'pending']))})</span>
            ) : null}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="empty">
          {filter === 'pending' ? 'همه‌یِ نظرها بررسی شده‌اند — صف خالی است.' : 'در این وضعیت نظری نیست.'}
        </p>
      ) : (
        <div className="stack">
          {items.map((review) => (
            <article className="card" key={review.id}>
              <div className="card__head">
                <div>
                  <strong>{review.authorName}</strong>
                  <Stars value={review.rating} />
                  {review.isVerifiedPurchase ? <span className="pill pill--ok">خریدِ تأییدشده</span> : null}
                  <span className={`pill pill--${review.status === 'approved' ? 'ok' : review.status === 'rejected' ? 'bad' : 'warn'}`}>
                    {review.status === 'approved' ? 'منتشرشده' : review.status === 'rejected' ? 'ردشده' : 'در انتظار'}
                  </span>
                </div>
                <span className="hint-cell">
                  <DateCell iso={review.createdAt} />
                </span>
              </div>

              <p className="u-mt-2 u-mb-2">{review.body}</p>

              {review.sellerReply ? (
                <p className="hint-cell">پاسخِ فروشگاه: {review.sellerReply}</p>
              ) : null}

              {replyFor === review.id ? (
                <div className="stack u-gap-2" >
                  <textarea
                    className="field__input"
                    rows={3}
                    value={replyText}
                    placeholder="پاسخِ فروشگاه…"
                    onChange={(event) => setReplyText(event.target.value)}
                  />
                  <div className="actions">
                    <button className="btn btn--sm" disabled={busy} onClick={() => void sendReply(review)}>
                      ثبتِ پاسخ
                    </button>
                    <button
                      className="btn btn--sm btn--ghost"
                      onClick={() => {
                        setReplyFor(null);
                        setReplyText('');
                      }}
                    >
                      انصراف
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="actions">
                {review.status !== 'approved' ? (
                  <button className="btn btn--sm" disabled={busy} onClick={() => void decide(review, 'approved')}>
                    انتشار
                  </button>
                ) : null}
                {review.status !== 'rejected' ? (
                  <button
                    className="btn btn--sm btn--ghost"
                    disabled={busy}
                    onClick={() => void decide(review, 'rejected')}
                  >
                    رد کردن
                  </button>
                ) : null}
                {replyFor !== review.id ? (
                  <button
                    className="btn btn--sm btn--ghost"
                    onClick={() => {
                      setReplyFor(review.id);
                      setReplyText(review.sellerReply ?? '');
                    }}
                  >
                    {review.sellerReply ? 'ویرایشِ پاسخ' : 'پاسخ دادن'}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
