import { useEffect, useState } from 'react';
import { useLocalData } from '../lib/data.js';
import { enqueue } from '../lib/sync.js';
import { api } from '../lib/api.js';
import { formatPrice, toPersianNum } from '../lib/format.js';

// «بارگیری/موجودی خودرو» — سهمیهٔ کارتن/تکی هر کالا
export default function VanLoading({ reloadHome }) {
  const { customers, inventory, loading, online } = useLocalData();
  const [draft, setDraft] = useState({}); // map productId -> {c,u}
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!inventory.length) return;
    setDraft((prev) => {
      if (prev && Object.keys(prev).length) return prev;
      const d = {};
      inventory.forEach((it) => {
        d[it.productId] = { c: it.quantityCartons || 0, u: it.quantityUnits || 0 };
      });
      return d;
    });
  }, [inventory]);

  async function save() {
    const items = (inventory || []).map((it) => {
      const d = (draft && draft[it.productId]) || { c: 0, u: 0 };
      return { productId: it.productId, quantityCartons: d.c || 0, quantityUnits: d.u || 0 };
    });
    setSaving(true);
    setMsg('');
    if (online) {
      try {
        await api('/van-inventory/bulk', { method: 'PUT', body: { items }, timeout: 20000 });
        // سینک دوبارهٔ موجودی از سرور
        await reloadHome();
        setMsg('ذخیره شد و همگام‌سازی انجام گردید.');
      } catch {
        setMsg('اتصال برقرار نشد؛ در صف آفلاین ذخیره شد.');
        await enqueue('VAN_BULK', { items });
      }
    } else {
      await enqueue('VAN_BULK', { items });
      setMsg('آفلاین هستید؛ تغییرات در صف همگام‌سازی ذخیره شد.');
    }
    setSaving(false);
    setTimeout(() => setMsg(''), 4000);
  }

  const step = (pid, which, dir) => {
    setDraft((prev) => {
      const d = { ...(prev || {}) };
      const cur = { ...(d[pid] || { c: 0, u: 0 }) };
      cur[which] = Math.max(0, (cur[which] || 0) + dir);
      d[pid] = cur;
      return d;
    });
  };

  if (loading) return <div className="content"><div className="placeholder">در حال خواندن موجودی…</div></div>;

  return (
    <>
      <header className="topbar">
        <h1>بارگیری / موجودی خودرو</h1>
        <div className="sub">{online ? '● آنلاین' : '○ آفلاین'} · سهمیهٔ کارتن و تکی را وارد و ذخیره کنید</div>
      </header>
      <div className="content">
        {msg && <div style={{ background: '#e8f7ee', color: '#166534', padding: '10px 12px', borderRadius: 10, marginBottom: 12, fontSize: 13 }}>{msg}</div>}
        {inventory.length === 0 ? (
          <div className="placeholder">کالایی برای بارگیری موجود نیست.</div>
        ) : (
          <div className="rows">
            {inventory.map((it) => {
              const d = (draft && draft[it.productId]) || { c: 0, u: 0 };
              return (
                <div className="card" key={it.productId} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{it.productName}</div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {it.brand || ''} · کارتن {formatPrice(it.cartonPrice)} · تکی {formatPrice(it.unitPrice)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
                    <div>
                      <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>کارتن</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button onClick={() => step(it.productId, 'c', 1)} style={stepper}>+</button>
                        <span style={{ minWidth: 30, textAlign: 'center', fontWeight: 700 }}>{toPersianNum(d.c)}</span>
                        <button onClick={() => step(it.productId, 'c', -1)} style={stepper}>−</button>
                      </div>
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>تکی (دانه)</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button onClick={() => step(it.productId, 'u', 1)} style={stepper}>+</button>
                        <span style={{ minWidth: 30, textAlign: 'center', fontWeight: 700 }}>{toPersianNum(d.u)}</span>
                        <button onClick={() => step(it.productId, 'u', -1)} style={stepper}>−</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {inventory.length > 0 && (
          <button className="btn primary" onClick={save} disabled={saving} style={{ marginTop: 12 }}>
            {saving ? 'در حال ذخیره…' : 'ذخیرهٔ بار خودرو'}
          </button>
        )}
      </div>
    </>
  );
}

const stepper = {
  width: 34, height: 34, borderRadius: 10, background: '#eaf2f7', color: '#001d31', fontSize: 18, fontWeight: 700
};
