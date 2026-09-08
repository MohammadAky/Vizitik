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
    { productId: 'p1', productName: 'مگنوم کلاسیک', brand: 'میهن', cartonPrice: 480000, unitPrice: 22000, unitsPerCarton: 24, quantityCartons: 5, quantityUnits: 12 },
    { productId: 'p2', productName: 'کورنِتو', brand: 'میهن', cartonPrice: 240000, unitPrice: 10000, unitsPerCarton: 24, quantityCartons: 3, quantityUnits: 0 },
    { productId: 'p3', productName: 'کترینگ ۴ کیلویی', brand: 'پاندا', cartonPrice: 1200000, unitPrice: 300000, unitsPerCarton: 4, quantityCartons: 0, quantityUnits: 4 }
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
