import { useState } from 'react';
import { api, authStorage } from '../lib/api.js';
import { store } from '../lib/db.js';

const DEMO_PHONE = '09121234567';
const DEMO_PASS = '123456';

// دادهٔ نمونه برای دیدن داشبوردِ آفلاین بدون نیاز به سرور (فقط برای پیش‌نمایش)
async function demoOfflineLogin(onAuthed) {
  const sampleCustomers = [
    { id: 'c1', name: 'سوپرمارکت نیلوفر', address: 'خیابان آزادی', phoneNumber: '02155667788', currentDebt: 2450000 },
    { id: 'c2', name: 'هایپرمارکت بهار', address: 'میدان ولیعصر', phoneNumber: '02188445566', currentDebt: 0 },
    { id: 'c3', name: 'سوپرمارکت ایران', address: 'خیابان شریعتی', phoneNumber: '02122334455', currentDebt: 830000 },
    { id: 'c4', name: 'بقالی امید', address: 'خیابان انقلاب', phoneNumber: '02166990011', currentDebt: 120000 }
  ];
  const sampleInventory = [
    { id: 'p1', name: 'مگنوم کلاسیک', cartonQty: 5, unitQty: 12 },
    { id: 'p2', name: 'کورنِتو', cartonQty: 3, unitQty: 0 },
    { id: 'p3', name: 'کترینگ ۴ کیلویی', cartonQty: 0, unitQty: 4 }
  ];
  await store.save('customers', sampleCustomers);
  await store.save('vanInventory', sampleInventory);
  authStorage.setToken('demo-offline-token');
  authStorage.setUser({ firstName: 'علی', lastName: 'حسینی', phone: DEMO_PHONE, role: 'VISITOR' });
  onAuthed();
}

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
      <button
        className="btn ghost"
        type="button"
        onClick={() => demoOfflineLogin(onAuthed)}
      >
        مشاهدهٔ دموی آفلاین (بدون سرور)
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
