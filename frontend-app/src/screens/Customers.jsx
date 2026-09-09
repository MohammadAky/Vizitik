import { useMemo, useState } from 'react';
import AppHeader from '../components/AppHeader.jsx';
import { useLocalData } from '../lib/data.js';
import { formatPrice, toPersianNum } from '../lib/format.js';

export default function Customers({ go }) {
  const { customers, online } = useLocalData();
  const [q, setQ] = useState('');
  const [onlyDebt, setOnlyDebt] = useState(false);

  const filtered = useMemo(() => {
    let list = customers || [];
    if (onlyDebt) list = list.filter((c) => Number(c.currentDebt || 0) > 0);
    if (q.trim()) {
      const s = q.trim();
      list = list.filter((c) =>
        (c.name || '').includes(s) || (c.phone || '').includes(s) || (c.address || '').includes(s)
      );
    }
    return list;
  }, [customers, q, onlyDebt]);

  const totalDebt = filtered.reduce((s, c) => s + Math.max(0, Number(c.currentDebt || 0)), 0);

  return (
    <>
      <AppHeader title="مشتریان" sub={online ? 'برخط' : 'آفلاین — دادهٔ محلی'} onMenu={go.onMenu} online={online} />
      <div className="content">
        <div className="field">
          <input placeholder="جستجوی نام، تلفن یا آدرس…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
          <button
            className={`btn small ${onlyDebt ? 'danger' : 'light'}`}
            onClick={() => setOnlyDebt((v) => !v)}
          >
            <span className="material-symbols-outlined">filter_alt</span>
            {onlyDebt ? 'همهٔ مشتریان' : 'فقط بدهکاران'}
          </button>
          <span className="muted" style={{ fontSize: 12, marginRight: 'auto' }}>
            {toPersianNum(filtered.length)} مشتری
            {totalDebt > 0 && <> · بدهی: {formatPrice(totalDebt)}</>}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="empty">
            <span className="material-symbols-outlined">group_off</span>
            مشتری‌ای یافت نشد.
          </div>
        ) : (
          <div className="rows">
            {filtered.map((c) => (
              <div className="row-item" key={c.id}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div className="t">{c.name}</div>
                    {Number(c.currentDebt) > 0 && <span className="badge danger">بدهکار</span>}
                  </div>
                  <div className="d">{c.phone || ''}{c.phone && c.address ? ' · ' : ''}{c.address || ''}</div>
                </div>
                {Number(c.currentDebt) > 0 && (
                  <div className="amount-debt" style={{ fontSize: 14 }}>{formatPrice(c.currentDebt)}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
