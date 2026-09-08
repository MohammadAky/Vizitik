import { useEffect, useState } from 'react';
import { api, apiSilent, authStorage } from '../lib/api.js';
import { store, kv } from '../lib/db.js';
import { formatToman, formatPrice, toPersianNum } from '../lib/format.js';

export default function Dashboard({ goView }) {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [stats, setStats] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [lastSync, setLastSync] = useState('');

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);

    // ۱) اول از دیتابیس محلی (برای نمایش فوری حتی آفلاین)
    (async () => {
      const c = await store.load('customers').catch(() => []);
      const inv = await store.load('vanInventory').catch(() => []);
      const last = await kv.get('lastSync').catch(() => '');
      setCustomers(c);
      setInventory(inv);
      setLastSync(last || '');
    })();

    // ۲) همگام‌سازی در صورت آنلاین بودن
    refresh();
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const [st, cs, inv] = await Promise.all([
      apiSilent('/reports/dashboard'),
      apiSilent('/customers'),
      apiSilent('/van-inventory')
    ]);
    if (st) setStats(st);
    if (cs) {
      setCustomers(cs);
      await store.save('customers', cs);
    }
    if (inv) {
      setInventory(inv);
      await store.save('vanInventory', inv);
    }
    const now = new Date().toLocaleString('fa-IR');
    setLastSync(now);
    await kv.set('lastSync', now);
  }

  const debtors = (customers || []).filter((c) => Number(c.currentDebt || c.debt || 0) > 0);

  const statNum = (key, def = 0) => {
    const s = stats && stats[key];
    if (!s) return { value: def, suffix: '' };
    return typeof s === 'object' ? s : { value: s, suffix: '' };
  };

  const Card = ({ label, k }) => {
    const { value, suffix } = statNum(k);
    return (
      <div className="card">
        <div className="label">{label}</div>
        <div className="num">
          {formatPrice(value)}
          {suffix ? <small>{suffix}</small> : <small>تومان</small>}
        </div>
      </div>
    );
  };

  const user = authStorage.user || {};

  return (
    <>
      <header className="topbar">
        <div className="row">
          <div>
            <h1>سلام، {user.firstName || 'ویزیتور'}</h1>
            <div className="sub">
              {user.lastName || ''} · وضعیت بار: {toPersianNum(inventory.length)} قلم کالا
            </div>
          </div>
          <span className={`syncpill ${online ? 'live' : 'off'}`}>
            {online ? '● آنلاین' : '○ آفلاین'}
          </span>
        </div>
      </header>

      <div className="content">
        <div className="grid2">
          <Card label="فروش امروز" k="sales_today" />
          <Card label="فروش ماه جاری" k="monthly_sales" />
        </div>
        <div className="grid2" style={{ marginTop: 12 }}>
          <div className="card">
            <div className="label">بدهکاران</div>
            <div className="num">
              {toPersianNum(debtors.length)} <small>مغازه</small>
            </div>
          </div>
          <div className="card" onClick={() => goView('customers')} style={{ cursor: 'pointer' }}>
            <div className="label">کل مشتریان</div>
            <div className="num">
              {toPersianNum((customers || []).length)} <small>مغازه</small>
            </div>
          </div>
        </div>

        <div className="section-title">مغازه‌های بدهکار برای پیگیری</div>
        {debtors.length === 0 ? (
          <div className="placeholder">
            {online
              ? 'موردی برای پیگیری نیست.'
              : 'داده‌ای از قبل ذخیره نشده؛ هنگام آنلاین بودن اولین بار سینک می‌شود.'}
          </div>
        ) : (
          <div className="rows">
            {debtors.slice(0, 8).map((c) => (
              <div className="row-item" key={c.id}>
                <div>
                  <div className="t">{c.name}</div>
                  <div className="d">{c.address || ''}</div>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 800, color: 'var(--bad)', direction: 'ltr' }}>
                    {formatToman(c.currentDebt || c.debt || 0).value}
                    <small style={{ fontSize: 11, color: 'var(--muted)', marginRight: 2 }}>
                      {formatToman(c.currentDebt || c.debt || 0).suffix}
                    </small>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {lastSync && <div className="muted" style={{ fontSize: 11, marginTop: 18, textAlign: 'center' }}>آخرین همگام‌سازی: {lastSync}</div>}
      </div>
    </>
  );
}
