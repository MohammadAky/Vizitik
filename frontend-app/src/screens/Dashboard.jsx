import { useEffect, useState } from 'react';
import { useLocalData } from '../lib/data.js';
import { flushPendingQueue, getPending, networkState, subscribeSync } from '../lib/sync.js';
import { authStorage } from '../lib/api.js';
import { formatPrice, toPersianNum } from '../lib/format.js';

export default function Dashboard({ goView }) {
  const { customers, inventory, lastSync, loading, online, reload } = useLocalData();
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState('');

  const user = authStorage.user || {};

  useEffect(() => {
    getPending().then((l) => setPending(l.length)).catch(() => {});
    const un = subscribeSync((s) => {
      if (s.type === 'queue') setPending(s.count);
      if (s.type === 'syncing') setSyncing(s.syncing);
    });
    return un;
  }, []);

  async function doSync() {
    if (syncing) return;
    setToast('');
    const res = await flushPendingQueue();
    setSyncing(false);
    if (res.sent) {
      setToast(`${toPersianNum(res.sent)} مورد همگام شد.`);
      await reload({ sync: true });
      getPending().then((l) => setPending(l.length));
    } else {
      setToast(res.failed ? 'برخی موارد ناموفق ماند.' : 'چیزی برای همگام‌سازی نبود. بارگیری تازه شد.');
      await reload({ sync: true });
    }
    setTimeout(() => setToast(''), 4000);
  }

  const debtors = (customers || []).filter((c) => Number(c.currentDebt || 0) > 0);
  const totalCartons = (inventory || []).reduce((s, i) => s + (i.quantityCartons || 0), 0);
  const totalUnits = (inventory || []).reduce((s, i) => s + (i.quantityUnits || 0), 0);

  return (
    <>
      <header className="topbar">
        <div className="row">
          <div>
            <h1>سلام، {user.firstName || 'ویزیتور'}</h1>
            <div className="sub">
              {user.lastName || ''} · بار خودرو: {toPersianNum(totalCartons)} کارتن / {toPersianNum(totalUnits)} تکی
            </div>
          </div>
          <span className={`syncpill ${online ? 'live' : 'off'}`}>{online ? '● آنلاین' : '○ آفلاین'}</span>
        </div>
      </header>

      <div className="content">
        {toast && <div style={{ background: '#e8f7ee', color: '#166534', padding: 10, borderRadius: 10, marginBottom: 12, fontSize: 13 }}>{toast}</div>}

        {pending > 0 && (
          <div style={{ background: '#fff7e6', border: '1px solid #f0d9a8', color: '#8a6100', padding: 12, borderRadius: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 13 }}>{toPersianNum(pending)} مورد در صفِ همگام‌سازی آفلاین است.</div>
            <button className="btn primary" onClick={doSync} disabled={!online || syncing} style={{ marginTop: 8, background: 'var(--navy)', padding: 9 }}>
              {syncing ? 'در حال همگام‌سازی…' : online ? 'همگام‌سازی با سرور' : 'منتظر اتصال…'}
            </button>
          </div>
        )}

        <div className="grid2">
          <div className="card" onClick={() => goView('order')} style={{ cursor: 'pointer' }}>
            <div className="label">ثبت سفارش / فاکتور</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 8, color: 'var(--accent-2)' }}>شروع سفارش جدید ←</div>
          </div>
          <div className="card" onClick={() => goView('van')} style={{ cursor: 'pointer' }}>
            <div className="label">بار خودرو</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 8 }}>
              {toPersianNum(totalCartons)} کارتن · {toPersianNum(totalUnits)} تکی
            </div>
          </div>
        </div>

        <div className="grid2" style={{ marginTop: 12 }}>
          <div className="card" onClick={() => goView('customers')} style={{ cursor: 'pointer' }}>
            <div className="label">کل مشتریان</div>
            <div className="num">{toPersianNum((customers || []).length)} <small>مغازه</small></div>
          </div>
          <div className="card" onClick={() => goView('customers')} style={{ cursor: 'pointer' }}>
            <div className="label">بدهکاران</div>
            <div className="num" style={{ color: debtors.length ? 'var(--bad)' : 'var(--ok)' }}>
              {toPersianNum(debtors.length)} <small>مغازه</small>
            </div>
          </div>
        </div>

        <div className="section-title">مغازه‌های بدهکار برای پیگیری</div>
        {loading ? (
          <div className="placeholder">در حال خواندن داده…</div>
        ) : debtors.length === 0 ? (
          <div className="placeholder">
            {online ? 'موردی برای پیگیری نیست.' : 'دادهٔ محلی خالی است؛ با اتصال به اینترنت داده سینک می‌شود.'}
          </div>
        ) : (
          <div className="rows">
            {debtors.slice(0, 10).map((c) => (
              <div className="row-item" key={c.id}>
                <div>
                  <div className="t">{c.name}</div>
                  <div className="d">{c.address || ''}</div>
                </div>
                <div style={{ textAlign: 'left', fontWeight: 800, color: 'var(--bad)' }}>
                  {formatPrice(c.currentDebt)} <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>تومان</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {lastSync && <div className="muted" style={{ fontSize: 11, marginTop: 18, textAlign: 'center' }}>آخرین همگام‌سازی داده: {lastSync}</div>}
      </div>
    </>
  );
}
