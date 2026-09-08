import { useEffect, useMemo, useState } from 'react';
import { api, apiSilent } from '../lib/api.js';
import { kv } from '../lib/db.js';
import { useLocalData } from '../lib/data.js';
import { formatPrice, toPersianNum } from '../lib/format.js';

const CHECK_STATUS = {
  PENDING: { fa: 'در جریان وصول', cls: 'debt' },
  PASSED: { fa: 'پاس شده', cls: 'ok' },
  BOUNCED: { fa: 'برگشتی', cls: 'mut' }
};

export default function Collections({ reloadHome }) {
  const { customers, online, reload } = useLocalData();
  const [tab, setTab] = useState('debt'); // debt | checks
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
    if (fresh) {
      setChecks(fresh);
      await kv.set('checks_cache', fresh).catch(() => {});
    } else {
      const cached = await kv.get('checks_cache').catch(() => null);
      if (cached) setChecks(cached);
    }
  }

  const debtors = useMemo(
    () => (customers || []).filter((c) => Number(c.currentDebt || 0) > 0).sort((a, b) => b.currentDebt - a.currentDebt),
    [customers]
  );
  const totalDebt = debtors.reduce((s, c) => s + Number(c.currentDebt), 0);

  function openSettle(c) {
    setSelCust(c);
    setAmount('');
    setMethod('CASH');
    setMsg(null);
  }

  async function submitSettle() {
    const amt = Number(amount);
    if (!selCust || !amt || amt <= 0) return;
    if (!online) return setMsg({ ok: false, text: 'ثبت وصول نیاز به اتصال اینترنت دارد (محاسبهٔ دفتر حساب سمت سرور است).' });
    setBusy(true);
    setMsg(null);
    try {
      const r = await api(`/customers/${selCust.id}/settle`, { method: 'POST', body: { amount: amt, method } });
      setMsg({ ok: true, text: `${r.message || 'دریافت وجه ثبت شد.'} مانده: ${formatPrice(r.currentDebt)}` });
      await reload({ sync: true });
      setSelCust(null);
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'خطا در ثبت وصول' });
    } finally {
      setBusy(false);
    }
  }

  async function setCheckStatus(check, status) {
    if (!online) return alert('تغییر وضعیت چک نیاز به اینترنت دارد.');
    try {
      await api(`/reports/checks/${check.id}/status`, { method: 'PUT', body: { status } });
      await refreshChecks();
      await reload({ sync: true });
    } catch (e) {
      alert(e.message || 'خطا');
    }
  }

  return (
    <>
      <header className="topbar">
        <h1>وصول مطالبات</h1>
        <div className="sub">{online ? '● آنلاین' : '○ آفلاین'}</div>
      </header>
      <div className="content">
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button className={`navtab ${tab === 'debt' ? 'on' : ''}`} style={{ border: '1px solid var(--line)' }} onClick={() => setTab('debt')}>بدهکاران ({toPersianNum(debtors.length)})</button>
          <button className={`navtab ${tab === 'checks' ? 'on' : ''}`} style={{ border: '1px solid var(--line)' }} onClick={() => setTab('checks')}>چک‌ها ({toPersianNum(checks.length)})</button>
        </div>

        {msg && (
          <div style={{ background: msg.ok ? '#e8f7ee' : '#fdecec', color: msg.ok ? '#166534' : '#7f1d1d', padding: 10, borderRadius: 10, marginBottom: 12, fontSize: 13 }}>
            {msg.text}
            <button onClick={() => setMsg(null)} style={{ float: 'left', background: 'none', color: 'inherit' }}>✕</button>
          </div>
        )}

        {tab === 'debt' ? (
          <>
            <div className="card" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 13 }}>مجموع مطالبات بازار</span>
              <b style={{ color: 'var(--bad)', direction: 'ltr' }}>{formatPrice(totalDebt)} <small className="muted">تومان</small></b>
            </div>

            {debtors.length === 0 ? (
              <div className="placeholder">موردی برای وصول نیست.</div>
            ) : (
              <div className="rows">
                {debtors.map((c) => (
                  <div className="row-item" key={c.id}>
                    <div>
                      <div className="t">{c.name}</div>
                      <div className="d">{c.phone || c.address || ''}</div>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 800, color: 'var(--bad)', direction: 'ltr' }}>{formatPrice(c.currentDebt)} <small className="muted" style={{ fontSize: 11 }}>تومان</small></div>
                      <button className="btn primary" style={{ padding: '5px 12px', fontSize: 12, marginTop: 6, width: 'auto' }} onClick={() => openSettle(c)}>دریافت وجه</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {checks.length === 0 ? (
              <div className="placeholder">چکی ثبت نشده است.</div>
            ) : (
              <div className="rows">
                {checks.map((ch) => {
                  const st = CHECK_STATUS[ch.status] || CHECK_STATUS.PENDING;
                  return (
                    <div className="card" key={ch.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{ch.customerName || '—'}</div>
                          <div className="muted" style={{ fontSize: 11 }}>چک {ch.checkNumber} · {ch.bankName || ''} · سررسید {ch.dueDate ? new Date(ch.dueDate).toLocaleDateString('fa-IR') : '—'}</div>
                        </div>
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ fontWeight: 800, direction: 'ltr' }}>{formatPrice(ch.amount)} <small className="muted">تومان</small></div>
                          <span className={`badge ${st.cls}`}>{st.fa}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                        {ch.status !== 'PASSED' && <button className="btn" style={{ background: '#e8f7ee', color: '#166534', padding: '6px 10px', fontSize: 12 }} onClick={() => setCheckStatus(ch, 'PASSED')}>ثبت پاس‌شده</button>}
                        {ch.status === 'PENDING' && <button className="btn" style={{ background: '#fdecec', color: '#7f1d1d', padding: '6px 10px', fontSize: 12 }} onClick={() => setCheckStatus(ch, 'BOUNCED')}>برگشتی</button>}
                        {ch.status !== 'PENDING' && <button className="btn" style={{ background: '#eef3f7', color: 'var(--muted)', padding: '6px 10px', fontSize: 12 }} onClick={() => setCheckStatus(ch, 'PENDING')}>در جریان</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {selCust && (
        <div className="terms-overlay" onClick={() => setSelCust(null)}>
          <div className="terms-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>دریافت وجه از {selCust.name}</h3>
            <div className="muted" style={{ fontSize: 12, margin: '6px 0 12px' }}>ماندهٔ بدهی: <b style={{ color: 'var(--bad)' }}>{formatPrice(selCust.currentDebt)}</b> تومان</div>
            <div className="field">
              <label>مبلغ دریافت‌شده (تومان)</label>
              <input inputMode="numeric" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...inp, color: '#000', background: '#fff' }} placeholder="0" />
            </div>
            <div className="field">
              <label>روش دریافت</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} style={inp}>
                <option value="CASH">نقدی</option>
                <option value="CARD">کارت / پوز</option>
                <option value="CHECK">چک</option>
              </select>
            </div>
            <button className="btn primary" onClick={submitSettle} disabled={busy}>{busy ? 'در حال ثبت…' : 'تأیید و ثبت وصول'}</button>
          </div>
        </div>
      )}
    </>
  );
}

const inp = { width: '100%', padding: 11, borderRadius: 10, border: '1px solid var(--line)', fontSize: 14, background: '#fff' };
