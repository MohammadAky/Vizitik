import { useEffect, useMemo, useState } from 'react';
import AppHeader from '../components/AppHeader.jsx';
import { api, apiSilent } from '../lib/api.js';
import { kv } from '../lib/db.js';
import { useLocalData } from '../lib/data.js';
import { formatPrice, toPersianNum } from '../lib/format.js';
import { checkStatusFa, checkBadge } from '../lib/labels.js';

export default function Collections({ go }) {
  const { customers, online, reload } = useLocalData();
  const [tab, setTab] = useState('debt');
  const [checks, setChecks] = useState([]);
  const [selCust, setSelCust] = useState(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tab === 'checks' && online) refreshChecks();
    // eslint-disable-next-line
  }, [tab, online]);

  async function refreshChecks() {
    const fresh = await apiSilent('/reports/checks');
    if (fresh) { setChecks(fresh); await kv.set('checks_cache', fresh).catch(() => {}); }
    else { const c = await kv.get('checks_cache').catch(() => null); if (c) setChecks(c); }
  }

  const debtors = useMemo(
    () => (customers || []).filter((c) => Number(c.currentDebt || 0) > 0).sort((a, b) => b.currentDebt - a.currentDebt),
    [customers]
  );
  const totalDebt = debtors.reduce((s, c) => s + Number(c.currentDebt), 0);

  async function submitSettle() {
    const amt = Number(amount);
    if (!selCust || !amt || amt <= 0) return;
    if (!online) return setMsg({ ok: false, text: 'ثبت وصول نیاز به اینترنت دارد (دفتر حساب سمت سرور است).' });
    setBusy(true); setMsg(null);
    try {
      const r = await api(`/customers/${selCust.id}/settle`, { method: 'POST', body: { amount: amt, method } });
      setMsg({ ok: true, text: `${r.message || 'ثبت شد.'} مانده: ${formatPrice(r.currentDebt)}` });
      await reload({ sync: true });
      setSelCust(null);
    } catch (e) { setMsg({ ok: false, text: e.message || 'خطا در ثبت وصول' }); }
    setBusy(false);
  }

  async function setStatus(ch, status) {
    if (!online) return;
    try {
      await api(`/reports/checks/${ch.id}/status`, { method: 'PUT', body: { status } });
      await refreshChecks(); await reload({ sync: true });
    } catch (e) { setMsg({ ok: false, text: e.message || 'خطا' }); }
  }

  const openSettle = (c) => { setSelCust(c); setAmount(''); setMethod('CASH'); setMsg(null); };

  return (
    <>
      <AppHeader title="وصول مطالبات" sub={online ? 'برخط' : 'آفلاین'} onMenu={go.onMenu} online={online} />
      <div className="content">
        {msg && (
          <div style={{ background: msg.ok ? '#ecfdf5' : '#fef2f2', color: msg.ok ? '#047857' : '#b91c1c', padding: 10, borderRadius: 12, marginBottom: 12, fontSize: 12.5 }}>
            {msg.text}
          </div>
        )}

        <div className="btn-row" style={{ marginBottom: 14 }}>
          <button className={`btn small ${tab === 'debt' ? '' : 'light'}`} onClick={() => setTab('debt')}>بدهکاران ({toPersianNum(debtors.length)})</button>
          <button className={`btn small ${tab === 'checks' ? '' : 'light'}`} onClick={() => setTab('checks')}>چک‌ها ({toPersianNum(checks.length)})</button>
        </div>

        {tab === 'debt' ? (
          <>
            <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="k muted" style={{ fontSize: 13 }}>مجموع مطالبات بازار</span>
              <span className="amount-debt">{formatPrice(totalDebt)} <small className="muted" style={{ fontSize: 11 }}>تومان</small></span>
            </div>
            {debtors.length === 0 ? (
              <div className="empty"><span className="material-symbols-outlined">account_balance_wallet</span>موردی برای وصول نیست.</div>
            ) : (
              <div className="rows">
                {debtors.map((c) => (
                  <div className="row-item" key={c.id}>
                    <div style={{ minWidth: 0 }}>
                      <div className="t">{c.name}</div>
                      <div className="d">{c.phone || c.address || ''}</div>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div className="amount-debt" style={{ fontSize: 14 }}>{formatPrice(c.currentDebt)}</div>
                      <button className="btn small" style={{ marginTop: 6 }} onClick={() => openSettle(c)}><span className="material-symbols-outlined" style={{ fontSize: 16 }}>payments</span>دریافت وجه</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          checks.length === 0 ? (
            <div className="empty"><span className="material-symbols-outlined">checkbook</span>چکی ثبت نشده است.</div>
          ) : (
            <div className="rows">
              {checks.map((ch) => (
                <div className="card" key={ch.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="t">{ch.customerName || '—'}</div>
                      <div className="d">چک {ch.checkNumber} · {ch.bankName || ''} · سررسید {ch.dueDate ? new Date(ch.dueDate).toLocaleDateString('fa-IR') : '—'}</div>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div className="amount-debt" style={{ fontSize: 14 }}>{formatPrice(ch.amount)}</div>
                      <span className={`badge ${checkBadge(ch.status)}`} style={{ marginTop: 4 }}>{checkStatusFa(ch.status)}</span>
                    </div>
                  </div>
                  <div className="btn-row" style={{ marginTop: 12 }}>
                    {ch.status !== 'PASSED' && <button className="btn small success" onClick={() => setStatus(ch, 'PASSED')}>ثبت پاس‌شده</button>}
                    {ch.status === 'PENDING' && <button className="btn small danger" onClick={() => setStatus(ch, 'BOUNCED')}>برگشتی</button>}
                    {ch.status !== 'PENDING' && <button className="btn small light" onClick={() => setStatus(ch, 'PENDING')}>در جریان</button>}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {selCust && (
        <div className="modal-overlay" onClick={() => setSelCust(null)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <h3>دریافت وجه از {selCust.name}</h3>
            <div className="sheet-sub">ماندهٔ بدهی: <b className="amount-debt" style={{ fontSize: 13 }}>{formatPrice(selCust.currentDebt)}</b> تومان</div>
            <div className="field">
              <label>مبلغ دریافت‌شده (تومان)</label>
              <input inputMode="numeric" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            </div>
            <div className="field">
              <label>روش دریافت</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="CASH">نقدی</option>
                <option value="CARD">کارت / پوز</option>
                <option value="CHECK">چک</option>
              </select>
            </div>
            <button className="btn" onClick={submitSettle} disabled={busy}>{busy ? 'در حال ثبت…' : 'تأیید و ثبت وصول'}</button>
          </div>
        </div>
      )}
    </>
  );
}
