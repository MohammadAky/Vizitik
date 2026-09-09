import { useEffect, useState } from 'react';
import AppHeader from '../components/AppHeader.jsx';
import { useLocalData } from '../lib/data.js';
import { apiSilent } from '../lib/api.js';
import { kv } from '../lib/db.js';
import { flushPendingQueue, getPending, subscribeSync } from '../lib/sync.js';
import { formatPrice, formatToman, toPersianNum } from '../lib/format.js';

export default function Dashboard({ go }) {
  const { customers, inventory, online, reload } = useLocalData();
  const [report, setReport] = useState(null);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    getPending().then((l) => setPending(l.length)).catch(() => {});
    const un = subscribeSync((s) => {
      if (s.type === 'queue') setPending(s.count);
      if (s.type === 'syncing') setSyncing(s.syncing);
    });
    return un;
  }, []);

  useEffect(() => {
    if (!online) {
      kv.get('dashboard_cache').then((v) => setReport(v)).catch(() => {});
      return;
    }
    apiSilent('/reports/dashboard').then((r) => {
      if (r) { setReport(r); kv.set('dashboard_cache', r).catch(() => {}); }
    });
  }, [online]);

  async function doSync() {
    if (syncing) return;
    setToast('');
    const res = await flushPendingQueue();
    setSyncing(false);
    if (res.sent) {
      setToast(`${toPersianNum(res.sent)} فاکتور/بارِ صف، همگام شد.`);
      await reload({ sync: true });
    } else {
      setToast(res.failed ? 'برخی موارد ناموفق ماند؛ دوباره تلاش کن.' : 'همه‌چیز همگام است. داده به‌روز شد.');
      await reload({ sync: true });
    }
    getPending().then((l) => setPending(l.length));
    setTimeout(() => setToast(''), 4000);
  }

  const debtors = (customers || []).filter((c) => Number(c.currentDebt || 0) > 0);
  const totalCartons = (inventory || []).reduce((s, i) => s + (i.quantityCartons || 0), 0);
  const totalUnits = (inventory || []).reduce((s, i) => s + (i.quantityUnits || 0), 0);
  const r = report || {};

  const statCard = (label, value, suffix, icon) => (
    <div className="stat-card tap" key={label}>
      <div className="label"><span className="material-symbols-outlined">{icon}</span>{label}</div>
      <div className="value">{value}<small>{suffix}</small></div>
    </div>
  );

  return (
    <>
      <AppHeader onMenu={go.onMenu} online={online} />
      <div className="content">
        {toast && <div style={{ background: '#ecfdf5', color: '#047857', padding: 10, borderRadius: 12, marginBottom: 12, fontSize: 12.5 }}>{toast}</div>}

        {pending > 0 && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: 12, borderRadius: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{toPersianNum(pending)} مورد در صفِ همگام‌سازی آفلاین</div>
            <button className="btn small success" style={{ marginTop: 8 }} onClick={doSync} disabled={!online || syncing}>
              <span className="material-symbols-outlined">sync</span>
              {syncing ? 'در حال همگام‌سازی…' : online ? 'همگام‌سازی با سرور' : 'منتظر اتصال…'}
            </button>
          </div>
        )}

        <div className="stat-grid">
          {statCard('فروش امروز', formatPrice(r.todaySales || 0), 'تومان', 'payments')}
          {statCard('دریافتی امروز', formatPrice(r.todayCollectedCash || 0), 'تومان', 'savings')}
          {statCard('فاکتورهای امروز', toPersianNum(r.todayOrdersCount || 0), 'فاکتور', 'receipt_long')}
          {statCard('مطالبات بازار', formatToman(r.totalOutstandingDebt || 0).value, formatToman(r.totalOutstandingDebt || 0).suffix, 'account_balance_wallet')}
        </div>

        <div className="action-grid">
          <button className="action-btn" onClick={() => go.nav('order')}>
            <span className="action-icon"><span className="material-symbols-outlined icon-fill">add_shopping_cart</span></span>
            <span>ثبت فاکتور جدید<br /><span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>فروش گرم و صدور فاکتور</span></span>
          </button>
          <button className="action-btn" onClick={() => go.nav('van')}>
            <span className="action-icon"><span className="material-symbols-outlined">local_shipping</span></span>
            <span>بار خودرو<br /><span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>{toPersianNum(totalCartons)} کارتن · {toPersianNum(totalUnits)} تکی</span></span>
          </button>
        </div>

        <div className="section-title">مغازه‌های بدهکار برای پیگیری</div>
        {debtors.length === 0 ? (
          <div className="empty">
            <span className="material-symbols-outlined">check_circle</span>
            {online ? 'موردی برای پیگیری نیست — همه تسویه‌اند.' : 'دادهٔ محلی خالی است؛ با اتصال، سینک می‌شود.'}
          </div>
        ) : (
          <div className="rows">
            {debtors.slice(0, 6).map((c) => (
              <div className="row-item" key={c.id} onClick={() => go.nav('collect')}>
                <div style={{ minWidth: 0 }}>
                  <div className="t">{c.name}</div>
                  <div className="d">{c.address || ''}</div>
                </div>
                <div style={{ textAlign: 'left' }} className="amount-debt">
                  {formatPrice(c.currentDebt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
