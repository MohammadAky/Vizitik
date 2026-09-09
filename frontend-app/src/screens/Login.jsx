import { useState } from 'react';
import { api, authStorage } from '../lib/api.js';
import { store, kv } from '../lib/db.js';
import { APP_NAME_FA } from '../lib/brand.js';

const DEMO_PHONE = '09121234567';
const DEMO_PASS = '123456';

// دادهٔ نمونه برای پیش‌نمایشِ آفلاین (فقط در نسخهٔ demo)
async function demoOfflineLogin(onAuthed) {
  const sampleCustomers = [
    { id: 'c1', name: 'سوپرمارکت نیلوفر', address: 'خیابان آزادی', phoneNumber: '02155667788', currentDebt: 2450000 },
    { id: 'c2', name: 'هایپرمارکت بهار', address: 'میدان ولیعصر', phoneNumber: '02188445566', currentDebt: 0 },
    { id: 'c3', name: 'سوپرمارکت ایران', address: 'خیابان شریعتی', phoneNumber: '02122334455', currentDebt: 830000 }
  ];
  const sampleInventory = [
    { productId: 'p1', productName: 'مگنوم کلاسیک', brand: 'میهن', cartonPrice: 480000, unitPrice: 22000, unitsPerCarton: 24, quantityCartons: 5, quantityUnits: 12 },
    { productId: 'p2', productName: 'کورنِتو', brand: 'میهن', cartonPrice: 240000, unitPrice: 10000, unitsPerCarton: 24, quantityCartons: 3, quantityUnits: 0 }
  ];
  const sampleOrders = [{
    id: 'o1', invoiceNumber: '۱۴۰۵-۰۰۱', orderDate: new Date().toISOString(),
    customer: { id: 'c1', name: 'سوپرمارکت نیلوفر' },
    summary: { totalCartons: 2, totalIndividualUnits: 0, totalItemsCount: 1 },
    items: [{ productName: 'مگنوم کلاسیک', cartonCount: 2, unitCount: 0, lineTotal: 960000 }],
    subtotalAmount: 960000, totalDiscountAmount: 48000, finalAmount: 912000,
    payments: [{ method: 'CASH', amount: 500000 }, { method: 'CREDIT', amount: 412000 }]
  }];
  const sampleChecks = [{ id: 'ch1', checkNumber: '۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶', bankName: 'بانک ملی', dueDate: new Date(Date.now() + 86400000 * 20).toISOString(), status: 'PENDING', amount: 1000000, customerName: 'سوپرمارکت نیلوفر' }];
  await store.save('customers', sampleCustomers);
  await store.save('vanInventory', sampleInventory);
  await kv.set('orders_cache', sampleOrders).catch(() => {});
  await kv.set('checks_cache', sampleChecks).catch(() => {});
  await kv.set('dashboard_cache', { todaySales: 912000, todayCollectedCash: 500000, todayOrdersCount: 1, totalOutstandingDebt: 3280000 }).catch(() => {});
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
      const data = await api('/auth/login', { method: 'POST', body: { phone: phone.trim(), password } });
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
    <div className="auth-wrap">
      <form className="auth" onSubmit={submit}>
        <div className="logo"><img src="/icons/icon-192.png" alt={APP_NAME_FA} /></div>
        <h1>{APP_NAME_FA}</h1>
        <p className="sub">سامانهٔ مدیریت ویزیتور پخش — ثبت سفارش، فاکتور و بار</p>

        {error && <div className="auth-error">{error}</div>}

        <div className="field">
          <label>شماره موبایل</label>
          <input inputMode="tel" dir="ltr" placeholder="09121234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label>رمز عبور</label>
          <input type="password" dir="ltr" placeholder="••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'در حال ورود…' : 'ورود به حساب'}</button>
        <button className="btn ghost" type="button" onClick={() => demoOfflineLogin(onAuthed)}>
          <span className="material-symbols-outlined">offline_bolt</span>
          مشاهدهٔ دموی آفلاین
        </button>

        <div className="auth-foot">
          حساب ندارید؟ <a href="#" onClick={(e) => { e.preventDefault(); goRegister(); }}>ثبت‌نام کنید</a>
        </div>
      </form>
    </div>
  );
}
