import { useMemo, useState } from 'react';
import AppHeader from '../components/AppHeader.jsx';
import { useLocalData } from '../lib/data.js';
import { api } from '../lib/api.js';
import { store } from '../lib/db.js';
import { enqueue } from '../lib/sync.js';
import { computeOrderTotals, generateLocalUuid } from '../lib/pricing.js';
import { formatPrice, toPersianNum } from '../lib/format.js';

export default function NewOrder({ go }) {
  const { customers, inventory, online, reload } = useLocalData();
  const [custId, setCustId] = useState('');
  const [bag, setBag] = useState({});
  const [discounts, setDiscounts] = useState([]);
  const [cash, setCash] = useState('');
  const [pos, setPos] = useState('');
  const [check, setCheck] = useState('');
  const [checkNo, setCheckNo] = useState('');
  const [checkBank, setCheckBank] = useState('');
  const [payStep, setPayStep] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [discType, setDiscType] = useState('percent');
  const [discVal, setDiscVal] = useState('');

  const customer = customers.find((c) => c.id === custId);
  const sellable = useMemo(
    () => (inventory || []).filter((it) => (it.quantityCartons || 0) + (it.quantityUnits || 0) > 0),
    [inventory]
  );

  const rows = useMemo(
    () =>
      sellable.map((it) => {
        const b = bag[it.productId] || {};
        return {
          productId: it.productId, productName: it.productName,
          cartonPrice: Number(it.cartonPrice) || 0, unitPrice: Number(it.unitPrice) || 0,
          cartonCount: b.cartonCount || 0, unitCount: b.unitCount || 0
        };
      }),
    [sellable, bag]
  );
  const totals = useMemo(() => computeOrderTotals(rows, discounts), [rows, discounts]);
  const chosenCount = rows.filter((r) => r.cartonCount || r.unitCount).length;
  const paid = (Number(cash) || 0) + (Number(pos) || 0) + (Number(check) || 0);
  const credit = Math.max(0, totals.finalAmount - paid);

  const setCount = (pid, kind, delta) => {
    const item = sellable.find((i) => i.productId === pid);
    if (!item) return;
    const cap = kind === 'c' ? item.quantityCartons || 0 : item.quantityUnits || 0;
    const cur = (bag[pid] && bag[pid][kind]) || 0;
    const next = Math.max(0, cur + delta);
    if (next > cap) return;
    setBag({ ...bag, [pid]: { ...(bag[pid] || { cartonCount: 0, unitCount: 0 }), [kind]: next } });
  };

  const addDiscount = () => {
    const v = Number(discVal);
    if (!v || v <= 0) return;
    setDiscounts([...discounts, { type: discType, value: v }]);
    setDiscVal('');
  };

  async function deductLocalInventory(items) {
    const inv = (await store.load('vanInventory').catch(() => []));
    const next = inv.map((it) => {
      const f = items.find((i) => i.productId === it.productId);
      if (!f) return it;
      return { ...it, quantityCartons: Math.max(0, (it.quantityCartons || 0) - (f.cartonCount || 0)), quantityUnits: Math.max(0, (it.quantityUnits || 0) - (f.unitCount || 0)) };
    });
    await store.save('vanInventory', next);
  }

  async function submit() {
    if (!custId) return setResult({ ok: false, text: 'مشتری را انتخاب کنید.' });
    if (!chosenCount) return setResult({ ok: false, text: 'حداقل یک قلم کالا انتخاب کنید.' });
    setBusy(true);
    setResult(null);

    const payments = [];
    if (Number(cash) > 0) payments.push({ method: 'CASH', amount: Number(cash) });
    if (Number(pos) > 0) payments.push({ method: 'CARD', amount: Number(pos) });
    if (Number(check) > 0) payments.push({ method: 'CHECK', amount: Number(check), checkDetails: { checkNumber: checkNo || '۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶', bankName: checkBank || 'بانک', dueDate: new Date().toISOString() } });
    if (credit > 0) payments.push({ method: 'CREDIT', amount: credit });

    const items = rows.filter((r) => r.cartonCount || r.unitCount).map((r) => ({ productId: r.productId, cartonCount: r.cartonCount, unitCount: r.unitCount }));
    const payload = {
      localUuid: generateLocalUuid(), customerId: custId, items,
      discountSteps: discounts.filter((d) => Number(d.value) > 0).map((d) => ({ type: d.type, value: Number(d.value) })),
      payments
    };

    if (online) {
      try {
        const data = await api('/orders', { method: 'POST', body: payload, timeout: 20000 });
        await reload({ sync: true });
        setResult({ ok: true, text: `فاکتور ${data?.invoiceNumber || ''} ثبت و همگام شد.` });
        setBusy(false);
        return;
      } catch (err) {
        if (err && err.status) {
          setResult({ ok: false, text: 'خطای سرور: ' + (err.message || '') });
          setBusy(false);
          return;
        }
        // خطای شبکه → صف آفلاین
      }
    }
    // آفلاین
    await enqueue('ORDER', payload);
    await deductLocalInventory(items);
    await reload({ sync: false });
    setResult({ ok: true, offline: true, text: 'آفلاین — فاکتور در صف همگام‌سازی ذخیره و از بار محلی کسر شد.' });
    setBusy(false);
  }

  function reset() {
    setBag({}); setDiscounts([]); setCash(''); setPos(''); setCheck(''); setCheckNo(''); setCheckBank('');
    setPayStep(false); setResult(null); setCustId('');
  }

  return (
    <>
      <AppHeader title="ثبت فاکتور" sub={`${chosenCount} قلم · ${online ? 'برخط' : 'آفلاین'}`} onMenu={go.onMenu} online={online} />
      <div className="content" style={{ paddingBottom: 40 }}>
        {result && (
          <div style={{ background: result.ok ? '#ecfdf5' : '#fef2f2', color: result.ok ? '#047857' : '#b91c1c', padding: 12, borderRadius: 12, marginBottom: 12, fontSize: 12.5 }}>
            <div>{result.text}</div>
            {result.ok && <button className="btn small success" style={{ marginTop: 8 }} onClick={reset}><span className="material-symbols-outlined">add</span>سفارش جدید</button>}
          </div>
        )}

        {!payStep && (
          <>
            <div className="card">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>انتخاب مشتری</label>
                <select value={custId} onChange={(e) => setCustId(e.target.value)}>
                  <option value="">— انتخاب کنید —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {Number(c.currentDebt) > 0 ? `(بدهی ${formatPrice(c.currentDebt)})` : ''}
                    </option>
                  ))}
                </select>
                {customer && Number(customer.currentDebt) > 0 && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>ماندهٔ حساب قبلی: <b className="amount-debt" style={{ fontSize: 12 }}>{formatPrice(customer.currentDebt)}</b></div>
                )}
              </div>
            </div>

            {sellable.length === 0 ? (
              <div className="empty">
                <span className="material-symbols-outlined">inventory_2</span>
                کالایی با موجودی نیست. ابتدا از «بارگیری خودرو» بار را وارد کنید.
              </div>
            ) : (
              sellable.map((it) => {
                const b = bag[it.productId] || {};
                return (
                  <div className="card" key={it.productId}>
                    <div className="t">{it.productName}</div>
                    <div className="d">کارتن {formatPrice(it.cartonPrice)} · تکی {formatPrice(it.unitPrice)} · مانده: {toPersianNum(it.quantityCartons)} کارتن / {toPersianNum(it.quantityUnits)} تکی</div>
                    <div style={{ display: 'flex', gap: 22, marginTop: 12 }}>
                      <Qty label="کارتن" n={b.cartonCount || 0} plus={() => setCount(it.productId, 'c', 1)} minus={() => setCount(it.productId, 'c', -1)} />
                      <Qty label="تکی" n={b.unitCount || 0} plus={() => setCount(it.productId, 'u', 1)} minus={() => setCount(it.productId, 'u', -1)} />
                    </div>
                  </div>
                );
              })
            )}

            <div className="section-title">تخفیف‌های پلکانی</div>
            <div className="card">
              {discounts.length === 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>تخفیفی ثبت نشده است.</div>
              ) : (
                discounts.map((d, idx) => (
                  <div key={idx} className="lrow" style={{ borderBottom: '1px dashed var(--border)' }}>
                    <span>پلهٔ {toPersianNum(idx + 1)}: {d.type === 'percent' ? `${toPersianNum(d.value)}٪` : `${formatPrice(d.value)} تومان`}</span>
                    <button className="muted" style={{ color: 'var(--status-error)' }} onClick={() => setDiscounts(discounts.filter((_, i) => i !== idx))}><span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span></button>
                  </div>
                ))
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <select style={{ width: 'auto' }} value={discType} onChange={(e) => setDiscType(e.target.value)}>
                  <option value="percent">٪ درصدی</option>
                  <option value="fixed">تومان ثابت</option>
                </select>
                <input placeholder="مقدار" inputMode="numeric" value={discVal} onChange={(e) => setDiscVal(e.target.value)} />
                <button className="btn small light" onClick={addDiscount}>افزودن</button>
              </div>
            </div>

            <div className="card">
              <div className="lrow"><span className="k">جمع ناخالص</span><span className="v">{formatPrice(totals.subtotal)}</span></div>
              <div className="lrow"><span className="k">تخفیف ({toPersianNum(totals.discountSteps.length)} پله)</span><span className="v" style={{ color: '#059669' }}>− {formatPrice(totals.totalDiscount)}</span></div>
              <hr className="divider" />
              <div className="lrow"><span className="k">مبلغ نهایی</span><span className="v" style={{ fontSize: 17 }}>{formatPrice(totals.finalAmount)} تومان</span></div>
            </div>

            <button className="btn" disabled={!custId || !chosenCount} onClick={() => setPayStep(true)}>
              <span className="material-symbols-outlined">payments</span>
              ادامه به تسویه ({formatPrice(totals.finalAmount)})
            </button>
          </>
        )}

        {payStep && (
          <>
            <div className="section-title">تسویهٔ فاکتور — {customer?.name}</div>
            <div className="card">
              <PayRow icon="payments" label="نقدی" val={cash} set={setCash} />
              <PayRow icon="credit_card" label="پوز / کارت" val={pos} set={setPos} />
              <PayRow icon="checkbook" label="چک صیادی" val={check} set={setCheck} />
              {Number(check) > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input placeholder="شمارهٔ چک" value={checkNo} onChange={(e) => setCheckNo(e.target.value)} />
                  <input placeholder="نام بانک" value={checkBank} onChange={(e) => setCheckBank(e.target.value)} />
                </div>
              )}
            </div>
            <div className="card">
              <div className="lrow"><span className="k">مبلغ نهایی</span><span className="v">{formatPrice(totals.finalAmount)} تومان</span></div>
              <div className="lrow"><span className="k">جمع پرداخت‌ها</span><span className="v" style={{ color: '#059669' }}>{formatPrice(paid)}</span></div>
              <div className="lrow"><span className="k">ماندهٔ نسیه (دفتری)</span><span className="v" style={{ color: credit > 0 ? '#b45309' : '#059669' }}>{formatPrice(credit)}</span></div>
            </div>
            <div className="btn-row">
              <button className="btn light" onClick={() => setPayStep(false)}>بازگشت</button>
              <button className="btn" disabled={busy} onClick={submit}>
                {busy ? 'در حال ثبت…' : 'ثبت نهایی فاکتور'}
              </button>
            </div>
          </>
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

function PayRow({ label, val, set }) {
  return (
    <div className="lrow" style={{ alignItems: 'center' }}>
      <span className="k">{label}</span>
      <input inputMode="numeric" dir="ltr" placeholder="0" value={val} onChange={(e) => set(e.target.value)} style={{ width: '58%', padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', textAlign: 'left' }} />
    </div>
  );
}
