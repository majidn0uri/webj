'use client';

import { useState } from 'react';

export function FollowUpActions({ id }: { id: string }) {
  const [done, setDone] = useState(false);

  const act = async (action: 'complete' | 'cancel') => {
    const token = localStorage.getItem('admin_token') ?? '';
    await fetch(`/api/admin/crm/follow-ups/${id}/${action}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    setDone(true);
  };

  if (done) return <span className="sf-text-xs sf-color-ok">✅</span>;

  return (
    <div style={{ display: 'flex', gap: '0.25rem' }}>
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => act('complete')}>✅</button>
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => act('cancel')}>❌</button>
    </div>
  );
}