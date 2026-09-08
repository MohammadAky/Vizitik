import { useEffect, useMemo, useState } from 'react';
import { useLocalData } from '../lib/data.js';
import { apiSilent, api } from '../lib/api.js';
import { enqueue } from '../lib/sync.js';
import { store } from '../lib/db.js';
import { computeOrderTotals, generateLocalUuid } from '../lib/pricing.js';
import { formatPrice, toPersianNum } from '../lib/format.js';

export default function NewOrder({ reloadHome }) {
  const { customers, inventory, online, reload } = useLocalData();
  const [custId, setCustId] = useState('');
  const [bag, setBag] = useState({}); // productId -> {cartonCount, unitCount}
  const [discounts, setDiscounts] = useState([]); // {type,value}
  const [cash, setCash] = useState('');
  const [pos, setPos] = useState('');
  const [check, setCheck] = useState('');
  const [checkNo, setCheckNo] = useState('');
  const [checkBank, setCheckBank] = useState('');
  const [showPay, setShowPay] = useState(false);
  const [result, setResult] = useState(null); // {ok, text, offline}
  const [busy, setBusy] = useState(false);
  const [discType, setDiscType] = useState('percent');
  const [discVal, setDiscVal] = useState('');

  const customer = customers.find((c) => c.id === custId);
  const custDebt = customer ? Number(customer.currentDebt || 0) : 0;

  // فقط کالاهایی که در بار موجودی مثبت دارند قابل فروش‌اند
  const sellable = useMemo(
    () => (inventory || []).filter((it) => (it.quantityCartons || 0) + (it.quantityUnits || 0) > 0),
    [inventory]
  );

  function setCount(pid, kind, delta) {
    const item = inventory.find((i) => i.productId === pid);
    if (!item) return;
    const cap = kind === 'c' ? item.quantityCartons || 0 : item.quantityUnits || 0;
    const cur = (bag[pid] && bag[pid][kind]) || 0;
    const next = Math.max(0, cur + delta);
    if (next > cap) return;
    const b = { ...bag };
    b[pid] = { ...(b[pid] || { cartonCount: 0, unitCount: 0 }), [kind]: next };
    setBag(b);
  }

  function addDiscount() {
    const v = Number(discVal);
    if (!v || v <= 0) return;
    setDiscounts([...discounts, { type: discType, value: v }]);
    setDiscVal('');
  }

  const itemRows = sellable.map((it) => {
    const counts = bag[it.productId] || { cartonCount: 0, unitCount: 0 };
    return {
      productId: it.productId,
      productName: it.productName,
      cartonPrice: Number(it.cartonPrice) || 0,
      unitPrice: Number(it.unitPrice) || 0,
      cartonCount: counts.cartonCount || 0,
      unitCount: counts.unitCount || 0,
      availC: it.quantityCartons || 0,
      availU: it.quantityUnits || 0
    };
  });

  const totals = useMemo(() => computeOrderTotals(itemRows, discounts), [itemRows, discounts]);

  const paid = (Number(cash) || 0) + (Number(pos) || 0) + (Number(check) || 0);
  const creditRemainder = Math.max(0, totals.finalAmount - paid);

  async function submit() {
    if (!custId) return setResult({ ok: false, text: 'مشتری را انتخاب کنید.' });
    if (itemRows.length === 0 || itemRows.every((i) => !i.cartonCount && !i.unitCount))
      return setResult({ ok: false, text: 'حداقل یک قلم کالا انتخاب کنید.' });
    setBusy(true);
    setResult(null);

    const payments = [];
    if (Number(cash) > 0) payments.push({ method: 'CASH', amount: Number(cash) });
    if (Number(pos) > 0) payments.push({ method: 'CARD', amount: Number(pos) });
    if (Number(check) > 0)
      payments.push({
        method: 'CHECK',
        amount: Number(check),
        checkDetails: {
          checkNumber: checkNo || '۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶',
          bankName: checkBank || 'بانک',
          dueDate: new Date().toISOString()
        }
      });
    if (creditRemainder > 0) payments.push({ method: 'CREDIT', amount: creditRemainder });

    const payload = {
      localUuid: generateLocalUuid(),
      customerId: custId,
      items: itemRows
        .filter((i) => i.cartonCount > 0 || i.unitCount > 0)
        .map((i) => ({ productId: i.productId, cartonCount: i.cartonCount, unitCount: i.unitCount })),
      discountSteps: discounts.filter((d) => Number(d.value) > 0).map((d) => ({ type: d.type, value: Number(d.value) })),
      payments
    };

    let offlineQueued = false;
    if (online) {
      try {
        const data = await api('/orders', { method: 'POST', body: payload, timeout: 20000 });
        await reload({ sync: true });
        setResult({ ok: true, text: `فاکتور ${data?.invoiceNumber || ''} ثبت و همگام شد.` });
      } catch (err) {
        if (err && err.status) {
          setResult({ ok: false, text: 'خطای سرور: ' + (err.message || '') });
          setBusy(false);
          return;
        }
        // خطای شبکه → صف آفلاین
        offlineQueued = true;
      }
    } else {
      offlineQueued = true;
    }

    if (offlineQueued) {
      await enqueue('ORDER', payload);
      await deductLocalInventory(payload.items);
      await reload({ sync: false });
      setResult({ ok: true, offline: true, text: 'آفلاین — فاکتور در صف همگام‌سازی ذخیره و از بار خودرو کسر شد.' });
    }
    setBusy(false);
  }

  // کسر اقلام از موجودیِ محلی (برای حالت آفلاین)
  async function deductLocalInventory(items) {
    const inv = (await store.load('vanInventory').catch(() => []));
    const next = inv.map((it) => {
      const found = items.find((i) => i.productId === it.productId);
      if (!found) return it;
      return {
        ...it,
        quantityCartons: Math.max(0, (it.quantityCartons || 0) - (found.cartonCount || 0)),
        quantityUnits: Math.max(0, (it.quantityUnits || 0) - (found.unitCount || 0))
      };
    });
    await store.save('vanInventory', next);
  }

  function reset() {
    setBag({});
    setDiscounts([]);
    setCash('');
    setPos('');
    setCheck('');
    setCheckNo('');
    setCheckBank('');
    setShowPay(false);
    setResult(null);
    setCustId('');
  }

  const chosenCount = itemRows.filter((i) => i.cartonCount || i.unitCount).length;

  return (
    <>
      <header className="topbar">
        <h1>ثبت سفارش و فاکتور</h1>
        <div className="sub">{online ? '● آنلاین' : '○ آفلاین'} · {chosenCount} قلم انتخاب‌شده</div>
      </header>
      <div className="content">
        {result && (
          <div style={{
            background: result.ok ? '#e8f7ee' : '#fdecec',
            color: result.ok ? '#166534' : '#7f1d1d',
            padding: 10, borderRadius: 10, marginBottom: 12, fontSize: 13
          }}>
            {result.text}
            {result.ok && <button onClick={reset} className="btn primary" style={{ marginTop: 8, background: 'var(--navy)', padding: 8 }}>سفارش جدید</button>}
          </div>
        )}

        <div className="card" style={{ marginBottom: 12 }}>
          <div className="label" style={{ fontSize: 12, color: 'var(--muted)' }}>انتخاب مشتری</div>
          <select value={custId} onChange={(e) => setCustId(e.target.value)} style={inputSel}>
            <option value="">— انتخاب کنید —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {Number(c.currentDebt) > 0 ? `(بدهی ${formatPrice(c.currentDebt)})` : ''}
              </option>
            ))}
          </select>
          {customer && custDebt > 0 && (
            <div style={{ fontSize: 12, color: 'var(--bad)', marginTop: 6 }}>ماندهٔ حساب قبلی: {formatPrice(custDebt)} تومان</div>
          )}
        </div>

        {!showPay ? (
          <>
            <div className="section-title">انتخاب کالا از بار خودرو</div>
            {sellable.length === 0 ? (
              <div className="placeholder">کالایی با موجودی برای فروش نیست. ابتدا در «کالا/بار» بارگیری کنید.</div>
            ) : (
              sellable.map((it) => {
                const b = bag[it.productId] || {};
                return (
                  <div className="card" key={it.productId} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{it.productName}</div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          کارتن {formatPrice(it.cartonPrice)} · تکی {formatPrice(it.unitPrice)} · موجودی: {toPersianNum(it.quantityCartons)} کارتن / {toPersianNum(it.quantityUnits)} تکی
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                      <Qty label="کارتن" n={b.cartonCount || 0} plus={() => setCount(it.productId, 'c', 1)} minus={() => setCount(it.productId, 'c', -1)} />
                      <Qty label="تکی" n={b.unitCount || 0} plus={() => setCount(it.productId, 'u', 1)} minus={() => setCount(it.productId, 'u', -1)} />
                    </div>
                  </div>
                );
              })
            )}

            <div className="section-title">تخفیف‌های پلکانی</div>
            <div className="card" style={{ marginBottom: 8 }}>
              {discounts.map((d, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px dashed var(--line)' }}>
                  <span>پلهٔ {toPersianNum(idx + 1)}: {d.type === 'percent' ? `${toPersianNum(d.value)}٪` : `${formatPrice(d.value)} تومان`}</span>
                  <button onClick={() => setDiscounts(discounts.filter((_, i) => i !== idx))} style={{ background: 'none', color: 'var(--bad)', fontWeight: 700 }}>حذف</button>
                </div>
              ))}
              {discounts.length === 0 && <div className="muted" style={{ fontSize: 12 }}>تخفیفی ثبت نشده است.</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <select value={discType} onChange={(e) => setDiscType(e.target.value)} style={smallSel}>
                  <option value="percent">٪ درصدی</option>
                  <option value="fixed">تومان ثابت</option>
                </select>
                <input inputMode="numeric" placeholder="مقدار" value={discVal} onChange={(e) => setDiscVal(e.target.value)} style={smallInput} />
                <button onClick={addDiscount} className="btn primary" style={{ padding: '10px 16px', width: 'auto' }}>افزودن</button>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 12 }}>
              <Row label="جمع ناخالص"><b>{formatPrice(totals.subtotal)}</b></Row>
              <Row label="مجموع تخفیف ({toPersianNum(totals.discountSteps.length)} پله)"><b style={{ color: 'var(--ok)' }}>− {formatPrice(totals.totalDiscount)}</b></Row>
              <Row label="مبلغ نهایی"><b style={{ fontSize: 16 }}>{formatPrice(totals.finalAmount)} تومان</b></Row>
            </div>

            <button className="btn primary" disabled={!custId || !chosenCount} onClick={() => setShowPay(true)}>
              ادامه به تسویه ({formatPrice(totals.finalAmount)})
            </button>
          </>
        ) : (
          <>
            <div className="section-title">تسویهٔ فاکتور</div>
            <div className="card" style={{ marginBottom: 12 }}>
              <PayRow label="نقدی" val={cash} set={setCash} />
              <PayRow label="پوز / کارت" val={pos} set={setPos} />
              <div style={{ margin: '6px 0' }}>
                <PayRow label="چک صیادی" val={check} set={setCheck} />
                {Number(check) > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <input placeholder="شمارهٔ چک" value={checkNo} onChange={(e) => setCheckNo(e.target.value)} style={smallInput} />
                    <input placeholder="نام بانک" value={checkBank} onChange={(e) => setCheckBank(e.target.value)} style={smallInput} />
                  </div>
                )}
              </div>
            </div>
            <div className="card" style={{ marginBottom: 12 }}>
              <Row label="مبلغ نهایی"><b>{formatPrice(totals.finalAmount)} تومان</b></Row>
              <Row label="جمع پرداخت‌ها"><b style={{ color: 'var(--ok)' }}>{formatPrice(paid)}</b></Row>
              <Row label="ماندهٔ نسیه (دفتری)"><b style={{ color: creditRemainder > 0 ? 'var(--warn)' : 'var(--ok)' }}>{formatPrice(creditRemainder)}</b></Row>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost" style={{ color: '#fff', background: '#6b7c8a', width: '40%' }} onClick={() => setShowPay(false)}>بازگشت</button>
              <button className="btn primary" disabled={busy} onClick={submit}>
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
      <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={plus} style={stepper}>+</button>
        <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 700 }}>{toPersianNum(n)}</span>
        <button onClick={minus} style={stepper}>−</button>
      </div>
    </div>
  );
}
function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 14 }}>
      <span className="muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}
function PayRow({ label, val, set }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
      <span style={{ fontSize: 14 }}>{label}</span>
      <input
        inputMode="numeric"
        dir="ltr"
        placeholder="0"
        value={val}
        onChange={(e) => set(e.target.value)}
        style={{ width: '55%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', textAlign: 'left' }}
      />
    </div>
  );
}
const stepper = { width: 32, height: 32, borderRadius: 9, background: '#eaf2f7', color: '#001d31', fontSize: 17, fontWeight: 700 };
const inputSel = { width: '100%', padding: 11, borderRadius: 10, border: '1px solid var(--line)', marginTop: 8, fontSize: 14, background: '#fff' };
const smallInput = { flex: 1, padding: '9px 10px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 14, minWidth: 0 };
const smallSel = { padding: '9px 10px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 14, background: '#fff' };
