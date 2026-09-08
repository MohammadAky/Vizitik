import { useState } from 'react';
import { api, authStorage } from '../lib/api.js';

const DEMO_PHONE = '09121234567';
const DEMO_PASS = '123456';

export default function Login({ onAuthed, goRegister }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: { phone: phone.trim(), password }
      });
      authStorage.setToken(data.accessToken);
      authStorage.setUser(data.user || null);
      onAuthed();
    } catch (err) {
      setError(err.message || 'ورود ناموفق بود. شبکه/سرور را بررسی کنید.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth" onSubmit={submit}>
      <div className="logo">
        <img src="/icons/icon-192.png" alt="ویزیتیک" />
      </div>
      <h1>ویزیتیک</h1>
      <p className="sub">سامانهٔ مدیریت ویزیتور پخش — ثبت سفارش، فاکتور و بار</p>

      {error && <div className="err">{error}</div>}

      <div className="field">
        <label>شماره موبایل</label>
        <input
          inputMode="tel"
          dir="ltr"
          placeholder="09121234567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div className="field">
        <label>رمز عبور</label>
        <input
          type="password"
          dir="ltr"
          placeholder="••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'در حال ورود…' : 'ورود'}
      </button>

      <div className="auth-foot">
        حساب ندارید؟{' '}
        <a href="#" onClick={(e) => { e.preventDefault(); goRegister(); }}>
          ثبت‌نام کنید
        </a>
        <br />
        <span className="muted" style={{ color: '#9db7c7' }}>
          نسخهٔ دمو: {DEMO_PHONE} / {DEMO_PASS}
        </span>
      </div>
    </form>
  );
}
