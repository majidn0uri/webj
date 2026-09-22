'use client';

import { useState, useEffect, useCallback } from 'react';

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  passSet: boolean;
}

interface QueueStats {
  pending: number;
  sentToday: number;
  failed: number;
}

export function EmailPanel() {
  const [config, setConfig] = useState<SmtpConfig | null>(null);
  const [configured, setConfigured] = useState(false);
  const [queue, setQueue] = useState<QueueStats>({ pending: 0, sentToday: 0, failed: 0 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [from, setFrom] = useState('');
  const [testEmail, setTestEmail] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('admin_token') ?? '';
    const headers = { 'Authorization': `Bearer ${token}` };

    const [cfgRes, qRes] = await Promise.all([
      fetch('/api/admin/email/config', { headers }),
      fetch('/api/admin/email/queue', { headers }),
    ]);

    if (cfgRes.ok) {
      const data = await cfgRes.json();
      setConfigured(data.configured);
      if (data.config) {
        setConfig(data.config);
        setHost(data.config.host ?? '');
        setPort(String(data.config.port ?? 587));
        setSecure(data.config.secure ?? false);
        setUser(data.config.user ?? '');
        setFrom(data.config.from ?? '');
      }
    }

    if (qRes.ok) {
      const data = await qRes.json();
      setQueue(data);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveConfig() {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/admin/email/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('admin_token') ?? ''}`,
        },
        body: JSON.stringify({ host, port: Number(port), secure, user, pass, from }),
      });
      if (res.ok) {
        setMsg('تنظیمات ذخیره شد.');
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        setMsg(err.message ?? 'خطا در ذخیره.');
      }
    } finally { setBusy(false); }
  }

  async function sendTest() {
    if (!testEmail) return;
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/admin/email/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('admin_token') ?? ''}`,
        },
        body: JSON.stringify({ to: testEmail }),
      });
      const data = await res.json().catch(() => ({}));
      setMsg(data.sent ? 'ایمیل تست ارسال شد.' : (data.message ?? 'ارسال نشد.'));
    } finally { setBusy(false); }
  }

  async function flushQueue() {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/admin/email/flush', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token') ?? ''}` },
      });
      const data = await res.json().catch(() => ({}));
      setMsg(`${data.sent ?? 0} ایمیل ارسال شد.`);
      load();
    } finally { setBusy(false); }
  }

  return (
    <>
      <header className="head">
        <h1 className="head__title">ایمیل و نوتیفیکیشن</h1>
        <p className="head__sub">تنظیمات SMTP و مدیریت صف ایمیل</p>
      </header>

      {msg ? <div className="alert alert--ok u-mb-4" >{msg}</div> : null}

      {/* آمار صف */}
      <section className="panel u-mb-4" >
        <div className="panel__head">
          <h2 className="panel__title">وضعیت صف</h2>
        </div>
        <div className="stats u-p-4" >
          <div className="stat">
            <p className="stat__label">در انتظار</p>
            <p className="stat__value num">{queue.pending}</p>
          </div>
          <div className="stat">
            <p className="stat__label">ارسال امروز</p>
            <p className="stat__value num">{queue.sentToday}</p>
          </div>
          <div className="stat">
            <p className="stat__label">ناموفق</p>
            <p className={queue.failed > 0 ? 'stat__value num bad' : 'stat__value num'}>{queue.failed}</p>
          </div>
        </div>
        {queue.pending > 0 ? (
          <div className="u-p-4 u-pt-0">
            <button className="btn btn--primary" onClick={flushQueue} disabled={busy}>
              ارسال صف ({queue.pending})
            </button>
          </div>
        ) : null}
      </section>

      {/* تنظیمات SMTP */}
      <section className="panel panel--pad u-mb-4" >
        <h2 className="panel__title u-mb-3" >تنظیمات SMTP</h2>
        {configured ? <p className="muted u-mb-3" >SMTP از قبل تنظیم شده.</p> : null}

        <div className="form__grid form__grid--2">
          <label className="field">
            <span className="field__label">سرور SMTP</span>
            <input className="field__input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.gmail.com" dir="ltr" />
          </label>
          <label className="field">
            <span className="field__label">پورت</span>
            <input className="field__input" value={port} onChange={(e) => setPort(e.target.value)} type="number" dir="ltr" />
          </label>
          <label className="field">
            <span className="field__label">نام کاربری</span>
            <input className="field__input" value={user} onChange={(e) => setUser(e.target.value)} placeholder="user@example.com" dir="ltr" />
          </label>
          <label className="field">
            <span className="field__label">رمز عبور</span>
            <input className="field__input" value={pass} onChange={(e) => setPass(e.target.value)} type="password" placeholder={config?.passSet ? '••••••••' : ''} dir="ltr" />
          </label>
          <label className="field">
            <span className="field__label">فرستنده (From)</span>
            <input className="field__input" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="فروشگاه <shop@example.com>" dir="ltr" />
          </label>
          <label className="field field--inline" >
            <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
            <span>SSL/TLS (پورت ۴۶۵)</span>
          </label>
        </div>

        <button className="btn btn--primary u-mt-3"  onClick={saveConfig} disabled={busy}>
          ذخیره تنظیمات
        </button>
      </section>

      {/* تست */}
      <section className="panel panel--pad">
        <h2 className="panel__title u-mb-3" >تست ارسال</h2>
        <div className="u-flex u-gap-2">
          <input
            className="field__input u-flex-1"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="test@example.com"
            dir="ltr"
          />
          <button className="btn btn--ghost" onClick={sendTest} disabled={busy || !testEmail}>
            ارسال تست
          </button>
        </div>
      </section>
    </>
  );
}