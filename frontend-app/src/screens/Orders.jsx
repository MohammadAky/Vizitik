import { useEffect, useState } from 'react';
import { api, apiSilent } from '../lib/api.js';
import { kv } from '../lib/db.js';
import { formatPrice, toPersianNum } from '../lib/format.js';
import { useLocalData } from '../lib/data.js';

// تاریخچهٔ فاکتورها + مشاهدهٔ جزئیات (این بخش فقط-آنلاین جزئیات می‌گیرد؛ لیست از کشِ محلی می‌آید)
export default function Orders({ goBack }) {
  const { online } = useLocalData();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    (async () => {
      const cached = await kv.get('orders_cache').catch(() => null);
      if (cached) setOrders(cached);
      setLoading(false);
      if (online) {
        const fresh = await apiSilent('/orders');
        if (fresh) {
          setOrders(fresh);
          await kv.set('orders_cache', fresh).catch(() => {});
        }
      }
    })();
  }, [online]);

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return '—';
    }
  }

  const order = orders.find((o) => o.id === expandedId);

  return (
    <>
      <header className="topbar">
        <div className="row">
          <h1>تاریخچهٔ فاکتورها</h1>
          <button onClick={goBack} style={{ background: 'rgba(255,255,255,.15)', color: '#fff', padding: '6px 12px', borderRadius: 10 }}>بازگشت</button>
        </div>
        <div className="sub">{online ? '● آنلاین' : '○ آفلاین (لیست محلی)'}</div>
      </header>
      <div className="content">
        {loading ? (
          <div className="placeholder">در حال بارگذاری…</div>
        ) : orders.length === 0 ? (
          <div className="placeholder">هنوز فاکتوری ثبت نشده است.</div>
        ) : (
          <div className="rows">
            {orders.map((o) => (
              <div className="card" key={o.id} style={{ cursor: 'pointer' }} onClick={() => setExpandedId(o.id === expandedId ? null : o.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{o.customer?.name || '—'}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{o.invoiceNumber} · {fmtDate(o.orderDate)}</div>
                  </div>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 800, direction: 'ltr' }}>{formatPrice(o.finalAmount)} <small className="muted" style={{ fontSize: 11 }}>تومان</small></div>
                    <div className="muted" style={{ fontSize: 11 }}>{toPersianNum(o.summary?.totalCartons || 0)} کارتن</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {order && (
          <div className="terms-overlay" onClick={() => setExpandedId(null)}>
            <div className="terms-sheet" onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>فاکتور {order.invoiceNumber}</h3>
                <button onClick={() => setExpandedId(null)} style={{ background: 'none', fontSize: 18 }}>✕</button>
              </div>
              <div className="terms-scroll">
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{fmtDate(order.orderDate)} · {order.customer?.name}</div>

                {(order.items || []).map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px dashed var(--line)' }}>
                    <span>{it.productName} <span className="muted">({toPersianNum(it.cartonCount)} ک + {toPersianNum(it.unitCount)} ت)</span></span>
                    <b>{formatPrice(it.lineTotal)}</b>
                  </div>
                ))}

                <div style={{ marginTop: 8 }}>
                  <RowL label="جمع ناخالص"><b>{formatPrice(order.subtotalAmount)}</b></RowL>
                  <RowL label="تخفیف"><b style={{ color: 'var(--ok)' }}>− {formatPrice(order.totalDiscountAmount)}</b></RowL>
                  <RowL label="مبلغ نهایی"><b style={{ fontSize: 16 }}>{formatPrice(order.finalAmount)} تومان</b></RowL>
                </div>

                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>پرداخت‌ها:</div>
                  {(order.payments || []).map((p, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span>{methodFa(p.method)}{p.check ? ` (چک ${p.check.checkNumber})` : ''}</span>
                      <b>{formatPrice(p.amount)}</b>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function RowL({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14 }}>
      <span className="muted">{label}</span><span>{children}</span>
    </div>
  );
}
export function methodFa(m) {
  return ({ CASH: 'نقدی', CARD: 'کارت / پوز', CHECK: 'چک', CREDIT: 'نسیه (دفتری)' })[m] || m;
}
