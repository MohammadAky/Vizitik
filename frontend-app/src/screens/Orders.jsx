import { useEffect, useState } from 'react';
import AppHeader from '../components/AppHeader.jsx';
import { api, apiSilent } from '../lib/api.js';
import { kv } from '../lib/db.js';
import { useLocalData } from '../lib/data.js';
import { formatPrice, toPersianNum } from '../lib/format.js';
import { methodFa } from '../lib/labels.js';

export default function Orders({ go }) {
  const { online } = useLocalData();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    (async () => {
      const cached = await kv.get('orders_cache').catch(() => null);
      if (cached) setOrders(cached);
      setLoading(false);
      if (online) {
        const fresh = await apiSilent('/orders');
        if (fresh) { setOrders(fresh); await kv.set('orders_cache', fresh).catch(() => {}); }
      }
    })();
  }, [online]);

  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return '—'; }
  }

  const open = orders.find((o) => o.id === openId);

  return (
    <>
      <AppHeader title="سفارشات و فاکتورها" sub={online ? 'برخط' : 'آفلاین — لیست محلی'} onMenu={go.onMenu} online={online} />
      <div className="content">
        {loading ? (
          <div className="empty">در حال بارگذاری…</div>
        ) : orders.length === 0 ? (
          <div className="empty"><span className="material-symbols-outlined">receipt_long</span>هنوز فاکتوری ثبت نشده است.</div>
        ) : (
          <div className="rows">
            {orders.map((o) => (
              <div className="row-item" key={o.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(o.id === openId ? null : o.id)}>
                <div style={{ minWidth: 0 }}>
                  <div className="t">{o.customer?.name || '—'}</div>
                  <div className="d">{o.invoiceNumber} · {fmtDate(o.orderDate)}</div>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div className="amount-debt" style={{ fontSize: 14 }}>{formatPrice(o.finalAmount)}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{toPersianNum(o.summary?.totalCartons || 0)} کارتن</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="modal-overlay" onClick={() => setOpenId(null)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>فاکتور {open.invoiceNumber}</h3>
              <button onClick={() => setOpenId(null)} aria-label="بستن"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="sheet-sub">{fmtDate(open.orderDate)} · {open.customer?.name}</div>
            <div style={{ maxHeight: '48vh', overflowY: 'auto' }}>
              {(open.items || []).map((it, i) => (
                <div key={i} className="lrow" style={{ borderBottom: '1px dashed var(--border)' }}>
                  <span>{it.productName} <span className="muted" style={{ fontSize: 11 }}>({toPersianNum(it.cartonCount)} کارتن + {toPersianNum(it.unitCount)} تکی)</span></span>
                  <b>{formatPrice(it.lineTotal)}</b>
                </div>
              ))}
              <hr className="divider" />
              <div className="lrow"><span className="k">جمع ناخالص</span><b>{formatPrice(open.subtotalAmount)}</b></div>
              <div className="lrow"><span className="k">تخفیف</span><b style={{ color: '#059669' }}>− {formatPrice(open.totalDiscountAmount)}</b></div>
              <div className="lrow"><span className="k">مبلغ نهایی</span><b>{formatPrice(open.finalAmount)} تومان</b></div>
              <hr className="divider" />
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>پرداخت‌ها</div>
              {(open.payments || []).map((p, i) => (
                <div key={i} className="lrow" style={{ fontSize: 13 }}>
                  <span className="k">{methodFa(p.method)}{p.check ? ` · چک ${p.check.checkNumber}` : ''}</span>
                  <b>{formatPrice(p.amount)}</b>
                </div>
              ))}
            </div>
            <button className="btn light" onClick={() => setOpenId(null)}>بستن</button>
          </div>
        </div>
      )}
    </>
  );
}
