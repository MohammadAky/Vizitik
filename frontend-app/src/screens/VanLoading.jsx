import { useEffect, useState } from 'react';
import AppHeader from '../components/AppHeader.jsx';
import { useLocalData } from '../lib/data.js';
import { enqueue } from '../lib/sync.js';
import { api } from '../lib/api.js';
import { formatPrice, toPersianNum } from '../lib/format.js';

export default function VanLoading({ go }) {
  const { inventory, loading, online, reload } = useLocalData();
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!inventory.length) return;
    setDraft((prev) => {
      if (Object.keys(prev).length) return prev;
      const d = {};
      inventory.forEach((it) => { d[it.productId] = { c: it.quantityCartons || 0, u: it.quantityUnits || 0 }; });
      return d;
    });
  }, [inventory]);

  const step = (pid, which, dir) =>
    setDraft((prev) => {
      const d = { ...(prev || {}) };
      const cur = { ...(d[pid] || { c: 0, u: 0 }) };
      const item = inventory.find((i) => i.productId === pid);
      if (dir > 0) {
        const cap = which === 'c' ? (item?.quantityCartons || 0) : (item?.quantityUnits || 0);
        if ((cur[which] || 0) >= cap) return prev;
      }
      cur[which] = Math.max(0, (cur[which] || 0) + dir);
      d[pid] = cur;
      return d;
    });

  async function save() {
    const items = (inventory || []).map((it) => {
      const d = (draft && draft[it.productId]) || { c: 0, u: 0 };
      return { productId: it.productId, quantityCartons: d.c || 0, quantityUnits: d.u || 0 };
    });
    setSaving(true);
    setMsg('');
    try {
      if (online) {
        await api('/van-inventory/bulk', { method: 'PUT', body: { items }, timeout: 20000 });
        await reload({ sync: true });
        setMsg('بار خودرو ذخیره و همگام شد.');
      } else {
        await enqueue('VAN_BULK', { items });
        setMsg('آفلاین — بار در صف همگام‌سازی ذخیره شد.');
      }
    } catch {
      await enqueue('VAN_BULK', { items });
      setMsg('اتصال برقرار نشد؛ در صف همگام‌سازی ذخیره شد.');
    }
    setSaving(false);
    setTimeout(() => setMsg(''), 4000);
  }

  if (loading) {
    return (
      <>
        <AppHeader title="بارگیری خودرو" onMenu={go.onMenu} online={online} />
        <div className="content"><div className="empty">در حال خواندن موجودی…</div></div>
      </>
    );
  }

  return (
    <>
      <AppHeader title="بارگیری خودرو" sub="کارتن و تکیِ بارِ امروز" onMenu={go.onMenu} online={online} />
      <div className="content">
        {msg && (
          <div style={{ background: online ? '#ecfdf5' : '#fffbeb', color: online ? '#047857' : '#92400e', padding: 10, borderRadius: 12, marginBottom: 12, fontSize: 12.5 }}>{msg}</div>
        )}
        {inventory.length === 0 ? (
          <div className="empty">
            <span className="material-symbols-outlined">inventory_2</span>
            کالایی برای بارگیری موجود نیست.
          </div>
        ) : (
          inventory.map((it) => {
            const d = (draft && draft[it.productId]) || { c: 0, u: 0 };
            return (
              <div className="card" key={it.productId}>
                <div className="t">{it.productName}</div>
                <div className="d">{it.brand || ''} · کارتن {formatPrice(it.cartonPrice)} · تکی {formatPrice(it.unitPrice)}</div>
                <div style={{ display: 'flex', gap: 22, marginTop: 12 }}>
                  <Qty label="کارتن" n={d.c} plus={() => step(it.productId, 'c', 1)} minus={() => step(it.productId, 'c', -1)} />
                  <Qty label="تکی" n={d.u} plus={() => step(it.productId, 'u', 1)} minus={() => step(it.productId, 'u', -1)} />
                </div>
              </div>
            );
          })
        )}
        {inventory.length > 0 && (
          <button className="btn" onClick={save} disabled={saving} style={{ marginTop: 4 }}>
            <span className="material-symbols-outlined">save</span>
            {saving ? 'در حال ذخیره…' : 'ذخیرهٔ بار خودرو'}
          </button>
        )}
      </div>
    </>
  );
}

function Qty({ label, n, plus, minus }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{label}</div>
      <div className="qty-row">
        <button className="stepper" onClick={plus}><span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span></button>
        <span className="qty-val">{toPersianNum(n)}</span>
        <button className="stepper" onClick={minus}><span className="material-symbols-outlined" style={{ fontSize: 18 }}>remove</span></button>
      </div>
    </div>
  );
}
