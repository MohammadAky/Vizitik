import { useEffect, useMemo, useState } from 'react';
import { api, apiSilent } from '../lib/api.js';
import { kv } from '../lib/db.js';
import { useLocalData } from '../lib/data.js';
import { formatPrice, toPersianNum } from '../lib/format.js';
import { computeOrderTotals } from '../lib/pricing.js';
import { usePhpPage } from '../lib/usePhpPage.js';
import { showToast } from '../components/AppToast.jsx';
import BottomNav from '../components/BottomNav.jsx';

const fa = (n) => toPersianNum(Number(n || 0).toLocaleString('en-US'));
const digits = (s) => String(s || '').replace(/\D/g, '');

/**
 * مدیریت و اصلاح فاکتورها — پورت ۱:۱ از frontend/orders.php + js/orders.js
 * (هدر orders-header، جستجو، کارت فاکتور با pay-tagها، مودال ویرایش کامل با
 *  استپر اقلام/تخفیف پلکانی/تسهیم تسویه، و مودال چاپ فاکتور حرارتی)
 */
export default function Orders({ go }) {
  const page = usePhpPage('orders');
  const { online, reload } = useLocalData();
  const [orders, setOrders] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const cached = await kv.get('orders_cache').catch(() => null);
    if (cached) setOrders(cached);
    if (navigator.onLine) {
      const fresh = await apiSilent('/orders');
      if (Array.isArray(fresh)) {
        setOrders(fresh);
        kv.set('orders_cache', fresh).catch(() => {});
      }
    }
  }

  useEffect(() => {
    refresh();
    apiSilent('/products').then((p) => Array.isArray(p) && setCatalog(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const list = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    return (orders || []).map((ord) => {
      const invNo = ord.invoiceNumber || String(ord.id || '').slice(0, 8);
      const subtotal = Number(ord.subtotalAmount || 0);
      const discount = Number(ord.totalDiscountAmount || 0);
      const finalAmount = Number(ord.finalAmount || 0);
      let paidSum = 0;
      const tags = [];
      for (const p of ord.payments || []) {
        const amt = Number(p.amount || 0);
        paidSum += amt;
        if (p.method === 'CASH') tags.push({ cls: 'cash', text: `نقد: ${fa(amt)} ت` });
        if (p.method === 'CARD') tags.push({ cls: 'pos', text: `پوز: ${fa(amt)} ت` });
        if (p.method === 'CHECK') tags.push({ cls: 'check', text: `چک: ${fa(amt)} ت` });
      }
      const remaining = Math.max(0, finalAmount - paidSum);
      if (remaining > 0) tags.push({ cls: 'credit', text: `نسیه: ${fa(remaining)} ت` });
      return {
        raw: ord,
        id: ord.id,
        invNo,
        invDigits: digits(invNo),
        custName: (ord.customer && ord.customer.name) || 'مشتری',
        subtotal,
        discount,
        finalAmount,
        tags,
        date: toPersianNum(
          ord.orderDate
            ? new Date(ord.orderDate).toLocaleDateString('fa-IR') + ' ' + new Date(ord.orderDate).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
            : new Date().toLocaleDateString('fa-IR') + ' ' + new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
        )
      };
    }).filter((o) => {
      const q2 = (search || '').trim().toLowerCase();
      if (!q2) return true;
      return o.custName.toLowerCase().includes(q2) || String(o.invNo).includes(q2) || o.invDigits.includes(digits(q2));
    });
  }, [orders, search]);

  /* ================= ویرایش کامل فاکتور ================= */
  async function openFullEditOrderModal(orderId) {
    const inv = await apiSilent(`/orders/${orderId}/invoice`);
    const ord = (orders || []).find((o) => o.id === orderId) || {};
    if (!inv) {
      showToast('دریافت اطلاعات فاکتور با خطا مواجه شد.', 'error');
      return;
    }
    setEdit({
      orderId,
      invoice: inv,
      customerName: ord.customer?.name || 'مشتری',
      invoiceNumber: inv.invoiceNumber || ord.invoiceNumber || '',
      items: (inv.items || []).map((i) => ({
        productId: i.productId,
        productName: i.productName,
        brand: i.brand || 'میهن',
        unitsPerCarton: Number(i.unitsPerCarton || 24),
        cartonPrice: Number(i.cartonPrice || 0),
        unitPrice: Number(i.unitPrice || 0),
        cartonCount: Number(i.cartonCount || 0),
        unitCount: Number(i.unitCount || 0)
      })),
      discountPercentages: (inv.discountSteps || []).map((s) => Number(s.value)),
      cash: String(((ord.payments || []).find((p) => p.method === 'CASH') || {}).amount || ''),
      pos: String(((ord.payments || []).find((p) => p.method === 'CARD') || {}).amount || ''),
      check: String(((ord.payments || []).find((p) => p.method === 'CHECK') || {}).amount || ''),
      checkNumber: '',
      checkBank: '',
      newPercent: ''
    });
  }

  function patchEdit(p) {
    setEdit((e) => (e ? { ...e, ...p } : e));
  }

  function changeEditItem(idx, key, delta) {
    setEdit((e) => {
      const items = e.items.slice();
      items[idx] = { ...items[idx], [key]: Math.max(0, (items[idx][key] || 0) + delta) };
      return { ...e, items };
    });
  }

  function setEditItem(idx, key, val) {
    setEdit((e) => {
      const items = e.items.slice();
      items[idx] = { ...items[idx], [key]: Math.max(0, parseInt(val, 10) || 0) };
      return { ...e, items };
    });
  }

  function addSelectedProduct(selectValue) {
    if (!selectValue) return;
    const p = catalog.find((x) => x.id === selectValue);
    if (!p) return;
    setEdit((e) => ({
      ...e,
      items: [
        ...e.items,
        {
          productId: p.id,
          productName: p.name,
          brand: p.brand || 'میهن',
          unitsPerCarton: Number(p.unitsPerCartonDefault || 24),
          cartonPrice: Number(p.baseUnitPrice || 0) * Number(p.unitsPerCartonDefault || 1),
          unitPrice: Number(p.baseUnitPrice || 0),
          cartonCount: 1,
          unitCount: 0
        }
      ],
      addSelect: ''
    }));
  }

  const editTotals = useMemo(() => {
    if (!edit) return null;
    const t = computeOrderTotals(
      edit.items.map((i) => ({
        cartonCount: i.cartonCount,
        unitCount: i.unitCount,
        cartonPrice: i.cartonPrice,
        unitPrice: i.unitPrice
      })),
      edit.discountPercentages.map((v) => ({ type: 'percent', value: v }))
    );
    const paid = (Number(digits(edit.cash)) || 0) + (Number(digits(edit.pos)) || 0) + (Number(digits(edit.check)) || 0);
    return { ...t, credit: Math.max(0, t.finalAmount - paid) };
  }, [edit]);

  async function saveFullEditedOrder() {
    if (!edit) return;
    const valid = edit.items.filter((i) => i.cartonCount > 0 || i.unitCount > 0);
    if (valid.length === 0) {
      window.alert('فاکتور باید حداقل دارای یک قلم کالا با تعداد مثبت باشد.');
      return;
    }
    const payments = [];
    if (Number(digits(edit.cash)) > 0) payments.push({ method: 'CASH', amount: Number(digits(edit.cash)) });
    if (Number(digits(edit.pos)) > 0) payments.push({ method: 'CARD', amount: Number(digits(edit.pos)) });
    if (Number(digits(edit.check)) > 0) {
      payments.push({
        method: 'CHECK',
        amount: Number(digits(edit.check)),
        checkDetails: {
          checkNumber: edit.checkNumber || '---',
          bankName: edit.checkBank || 'بانک',
          dueDate: new Date().toISOString()
        }
      });
    }
    setSaving(true);
    try {
      await api(`/orders/${edit.orderId}`, {
        method: 'PUT',
        body: {
          items: valid.map((i) => ({ productId: i.productId, cartonCount: i.cartonCount, unitCount: i.unitCount })),
          discountSteps: (edit.discountPercentages || []).map((pct) => ({ type: 'percent', value: Number(pct) })),
          payments
        },
        timeout: 20000
      });
      setEdit(null);
      showToast('فاکتور ویرایش شد و انبار/حساب به‌روزرسانی گردید.', 'success');
      await refresh();
      await reload({ sync: true });
    } catch (err) {
      showToast(err.message || 'خطا در ثبت تغییرات فاکتور.', 'error');
    } finally {
      setSaving(false);
    }
  }

  /* ================= چاپ مجدد و ارسال به بله ================= */
  async function fetchAndPrintInvoice(orderId) {
    const inv = await apiSilent(`/orders/${orderId}/invoice`);
    if (!inv) {
      showToast('دریافت اطلاعات فاکتور با خطا مواجه شد.', 'error');
      return;
    }
    setReceipt(inv);
  }

  async function sendOrderToBale(orderId) {
    if (!window.confirm('آیا مایلید این فاکتور به پیام‌رسان بله فروشگاه و ویزیتور ارسال شود؟')) return;
    try {
      const data = await api(`/bale/send-invoice/${orderId}`, { method: 'POST' });
      showToast((data && data.message) || 'فاکتور با موفقیت به بله ارسال شد.', 'success');
    } catch (err) {
      showToast(err.message || 'خطا در ارسال فاکتور به بله.', 'error');
    }
  }

  return (
    <>
      {/* هدر صفحه سفارشات */}
      <header className="orders-header">
        <div className="header-title-box">
          <h1>{page.h1}</h1>
          <span className="header-sub">ویرایش تعداد کارتن/دانه، تخفیف، تسویه و چاپ</span>
        </div>

        <a href="#/dash" className="back-btn" aria-label="بازگشت به داشبورد" onClick={(e) => { e.preventDefault(); go('dash'); }}>
          <span className="material-symbols-outlined">arrow_forward</span>
        </a>
      </header>

      {/* محتوای اصلی صفحه سفارشات */}
      <main className="orders-content">
        {/* جستجو */}
        <div className="orders-search-box">
          <div className="search-input-wrap">
            <span className="material-symbols-outlined">search</span>
            <input
              type="text"
              id="orderSearchInput"
              placeholder="جستجوی نام مشتری یا شماره فاکتور..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* لیست فاکتورها */}
        <section className="orders-list" id="ordersListContainer">
          {list.length > 0 ? (
            list.map((ord) => (
              <article
                key={ord.id}
                className="order-card"
                id={`orderCard_${ord.id}`}
                data-id={ord.id}
                data-customer={ord.custName}
                data-inv={ord.invNo}
                data-inv-digits={ord.invDigits}
                data-final={ord.finalAmount}
                data-subtotal={ord.subtotal}
                data-discount={ord.discount}
              >
                <div className="order-card-header">
                  <div className="order-cust-info">
                    <div className="order-cust-avatar">
                      <span className="material-symbols-outlined">storefront</span>
                    </div>
                    <div>
                      <strong className="order-cust-name">{ord.custName}</strong>
                      <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>{ord.date}</div>
                    </div>
                  </div>
                  <span className="order-invoice-num">
                    #<span className="invoice-num">{toPersianNum(ord.invNo)}</span>
                  </span>
                </div>

                <div className="order-meta-grid">
                  <div className="order-meta-row">
                    <span>جمع ناخالص:</span>
                    <span>{fa(ord.subtotal)} ت</span>
                  </div>
                  {ord.discount > 0 && (
                    <div className="order-meta-row" style={{ color: '#ea580c' }}>
                      <span>تخفیف:</span>
                      <span>-{fa(ord.discount)} ت</span>
                    </div>
                  )}
                  <div className="order-meta-row highlight">
                    <span>مبلغ نهایی فاکتور:</span>
                    <strong>{fa(ord.finalAmount)} تومان</strong>
                  </div>
                </div>

                {/* وضعیت تسویه */}
                <div className="order-payments-tags">
                  {ord.tags.map((t, i) => (
                    <span key={i} className={`pay-tag ${t.cls}`}>
                      {t.text}
                    </span>
                  ))}
                </div>

                {/* دکمه‌های اقدام */}
                <div className="order-actions-row">
                  <button type="button" className="order-action-btn edit-full" onClick={() => openFullEditOrderModal(ord.id)}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit_note</span>
                    <span>ویرایش</span>
                  </button>
                  <button type="button" className="order-action-btn reprint" onClick={() => fetchAndPrintInvoice(ord.id)}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>print</span>
                    <span>چاپ</span>
                  </button>
                  <button type="button" className="order-action-btn send-bale" onClick={() => sendOrderToBale(ord.id)}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>smart_toy</span>
                    <span>بله</span>
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 16px',
                color: 'var(--text-muted)',
                fontSize: '13px',
                background: 'var(--surface)',
                borderRadius: '18px',
                border: '1.5px dashed var(--border)'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '40px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                receipt_long
              </span>
              <div>هنوز هیچ فاکتوری صادر نشده است.</div>
            </div>
          )}
        </section>
      </main>

      {/* نوار ناوبری پایینی */}
      <BottomNav items={page.nav.items} active={page.nav.active} onGo={go} />

      {/* مدال جامع ویرایش فاکتور */}
      <div className="modal-overlay" id="editFullOrderModal" style={{ display: edit ? 'flex' : 'none' }} onClick={(e) => { if (e.target === e.currentTarget) setEdit(null); }}>
        {edit && (
          <div className="edit-order-sheet">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid var(--border)',
                paddingBottom: '8px'
              }}
            >
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 800, margin: 0, color: 'var(--primary)' }}>ویرایش و اصلاح فاکتور</h3>
                <span id="editFullOrderSubtitle" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  فروشگاه {edit.customerName} (فاکتور #
                  <span className="invoice-num">{toPersianNum(edit.invoiceNumber)}</span>)
                </span>
              </div>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setEdit(null)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* ۱. بخش ویرایش اقلام و تعداد کالاها */}
            <div className="edit-section-card">
              <div className="edit-section-title">
                <span>📦 اقلام سفارش (تعداد کارتن و دانه)</span>
              </div>

              <div id="editOrderItemsList" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {edit.items.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '12px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    هیچ کالایی در سفارش وجود ندارد.
                  </div>
                ) : (
                  edit.items.map((item, idx) => {
                    const lineTotal = item.cartonCount * item.cartonPrice + item.unitCount * item.unitPrice;
                    return (
                      <div className="edit-item-row" id={`editItemRow_${idx}`} key={`${item.productId}_${idx}`}>
                        <div className="edit-item-header">
                          <div className="edit-item-name">
                            {item.productName} ({item.brand})
                          </div>
                          <button
                            type="button"
                            className="edit-item-delete-btn"
                            title="حذف کالا"
                            onClick={() => patchEdit({ items: edit.items.filter((_, k) => k !== idx) })}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete</span>
                          </button>
                        </div>

                        <div className="edit-steppers-grid">
                          <div className="stepper-box">
                            <div className="stepper-label">
                              <span>کارتن:</span>
                              <span>{toPersianNum(item.unitsPerCarton)} عددی</span>
                            </div>
                            <div className="stepper-controls">
                              <button type="button" className="stepper-btn" onClick={() => changeEditItem(idx, 'cartonCount', -1)}>-</button>
                              <input
                                type="number"
                                className="stepper-input"
                                min="0"
                                value={item.cartonCount}
                                onChange={(e) => setEditItem(idx, 'cartonCount', e.target.value)}
                              />
                              <button type="button" className="stepper-btn" onClick={() => changeEditItem(idx, 'cartonCount', 1)}>+</button>
                            </div>
                          </div>

                          <div className="stepper-box">
                            <div className="stepper-label">
                              <span>دانه (خرده):</span>
                              <span>سقف {toPersianNum(item.unitsPerCarton - 1)}</span>
                            </div>
                            <div className="stepper-controls">
                              <button type="button" className="stepper-btn" onClick={() => changeEditItem(idx, 'unitCount', -1)}>-</button>
                              <input
                                type="number"
                                className="stepper-input"
                                min="0"
                                max={item.unitsPerCarton - 1}
                                value={item.unitCount}
                                onChange={(e) => setEditItem(idx, 'unitCount', e.target.value)}
                              />
                              <button type="button" className="stepper-btn" onClick={() => changeEditItem(idx, 'unitCount', 1)}>+</button>
                            </div>
                          </div>
                        </div>

                        <div className="edit-item-footer">
                          <span>فی کارتن: {formatPrice(item.cartonPrice)}</span>
                          <strong>جمع: {formatPrice(lineTotal)}</strong>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* افزودن کالای جدید به فاکتور */}
              <div
                style={{
                  borderTop: '1px dashed var(--border)',
                  paddingTop: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)' }}>+ افزودن کالا به این فاکتور:</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <select
                    id="editAddProductSelect"
                    className="add-product-dropdown"
                    defaultValue=""
                    onChange={(e) => {
                      addSelectedProduct(e.target.value);
                      e.target.value = '';
                    }}
                  >
                    <option value="">انتخاب محصول از کاتالوگ...</option>
                    {catalog.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.brand || 'میهن'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* ۲. بخش تخفیفات پلکانی فاکتور */}
            <div className="edit-section-card">
              <div className="edit-section-title">
                <span>🎁 تخفیفات پلکانی فاکتور</span>
              </div>

              <div id="editDiscountStepsContainer" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {edit.discountPercentages.length === 0 ? (
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>هیچ تخفیف پلکانی ثبت نشده است.</span>
                ) : (
                  edit.discountPercentages.map((pct, i) => (
                    <span className="discount-chip" key={`${pct}_${i}`}>
                      پله {toPersianNum(i + 1)}: {toPersianNum(pct)}٪
                      <button
                        type="button"
                        className="discount-chip-remove"
                        onClick={() => patchEdit({ discountPercentages: edit.discountPercentages.filter((_, k) => k !== i) })}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>

              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
                <input
                  type="number"
                  id="editNewDiscountPercent"
                  placeholder="درصد تخفیف جدید (مثلاً ۳)"
                  min="1"
                  max="100"
                  value={edit.newPercent}
                  onChange={(e) => patchEdit({ newPercent: e.target.value })}
                  style={{
                    flex: 1,
                    height: '36px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    padding: '0 8px',
                    fontFamily: 'inherit',
                    fontSize: '11.5px'
                  }}
                />
                <button
                  type="button"
                  className="login-btn"
                  style={{ width: 'auto', height: '36px', padding: '0 12px', fontSize: '11.5px', background: '#ea580c' }}
                  onClick={() => {
                    const v = Number(edit.newPercent);
                    if (!v) return;
                    patchEdit({ discountPercentages: [...edit.discountPercentages, v], newPercent: '' });
                  }}
                >
                  + پله تخفیف
                </button>
              </div>
            </div>

            {/* ۳. خلاصه مالی و تسویه فاکتور */}
            <div className="edit-section-card">
              <div className="edit-section-title">
                <span>💳 خلاصه مالی و تسهیم تسویه</span>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  fontSize: '12px',
                  borderBottom: '1px dashed var(--border)',
                  paddingBottom: '6px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>جمع ناخالص:</span>
                  <strong id="editGrossSubtotalDisplay">{fa(editTotals?.subtotal)} ت</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#ea580c' }}>
                  <span>مجموع تخفیفات:</span>
                  <strong id="editTotalDiscountDisplay">
                    <span className="neg-amount">−{fa(editTotals?.totalDiscount)}</span> ت
                  </strong>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '13.5px',
                    fontWeight: 900,
                    color: 'var(--primary)',
                    paddingTop: '2px'
                  }}
                >
                  <span>مبلغ نهایی فاکتور:</span>
                  <strong id="editNetFinalDisplay">{fa(editTotals?.finalAmount)} ت</strong>
                </div>
              </div>

              {/* روش‌های پرداخت */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                {[
                  ['پرداخت نقدی (تومان):', '#16a34a', 'editFullCashInput', 'cash'],
                  ['کارتخوان / پوز (تومان):', '#2563eb', 'editFullPosInput', 'pos']
                ].map(([label, color, id, key]) => (
                  <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <label style={{ fontSize: '10.5px', fontWeight: 700, color }} htmlFor={id}>
                      {label}
                    </label>
                    <input
                      type="text"
                      id={id}
                      className="pay-amount-input"
                      value={edit[key]}
                      onChange={(e) => patchEdit({ [key]: digits(e.target.value) })}
                    />
                  </div>
                ))}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={{ fontSize: '10.5px', fontWeight: 700, color: '#d97706' }} htmlFor="editFullCheckInput">
                    چک صیادی (تومان):
                  </label>
                  <input
                    type="text"
                    id="editFullCheckInput"
                    className="pay-amount-input"
                    value={edit.check}
                    onChange={(e) => patchEdit({ check: digits(e.target.value) })}
                  />
                </div>

                <div
                  id="editFullCheckDetailsBox"
                  style={{
                    display: Number(digits(edit.check)) > 0 ? 'flex' : 'none',
                    flexDirection: 'column',
                    gap: '4px',
                    background: '#fffbeb',
                    padding: '6px',
                    borderRadius: '8px',
                    border: '1px solid #fef3c7'
                  }}
                >
                  <input
                    type="text"
                    id="editFullCheckNumber"
                    placeholder="شناسه صیادی ۱۶ رقمی..."
                    value={edit.checkNumber}
                    onChange={(e) => patchEdit({ checkNumber: e.target.value })}
                    style={{
                      height: '34px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      padding: '0 8px',
                      fontFamily: 'inherit',
                      fontSize: '11px'
                    }}
                  />
                  <input
                    type="text"
                    id="editFullCheckBank"
                    placeholder="نام بانک صادرکننده..."
                    value={edit.checkBank}
                    onChange={(e) => patchEdit({ checkBank: e.target.value })}
                    style={{
                      height: '34px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      padding: '0 8px',
                      fontFamily: 'inherit',
                      fontSize: '11px'
                    }}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    fontWeight: 800,
                    color: '#ea580c',
                    background: '#fff7ed',
                    padding: '6px 8px',
                    borderRadius: '8px'
                  }}
                >
                  <span>مانده در دفتر حساب (نسیه):</span>
                  <strong id="editFullCreditRemaining">{fa(editTotals?.credit)} ت</strong>
                </div>
              </div>
            </div>

            {/* دکمه‌های اقدام نهایی */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
              <button
                type="button"
                className="submit-order-btn"
                style={{ height: '44px', fontSize: '13.5px' }}
                id="saveFullOrderBtn"
                disabled={saving}
                onClick={saveFullEditedOrder}
              >
                <span className="material-symbols-outlined">save</span>
                <span>
                  {saving
                    ? 'در حال ثبت تغییرات فاکتور و همگام‌سازی انبار...'
                    : 'ذخیره تغییرات فاکتور و اعمال در انبار و حساب'}
                </span>
              </button>
              <button type="button" className="confirm-cancel-btn" style={{ height: '36px' }} onClick={() => setEdit(null)}>
                انصراف
              </button>
            </div>
          </div>
        )}
      </div>

      {/* مدال پرینت فاکتور حرارتی ۸۰ میلی‌متری */}
      <div className="invoice-modal-overlay" id="invoiceModal" style={{ display: receipt ? 'flex' : 'none' }}>
        <div className="thermal-invoice-container">
          <div className="thermal-invoice-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-symbols-outlined">receipt</span>
              <h3 style={{ fontSize: '15px', margin: 0 }}>فاکتور فروش (چاپ مجدد)</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }} onClick={() => setReceipt(null)}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className="thermal-receipt-paper" id="thermalReceiptPaper">
            {receipt && (
              <>
                <div className="receipt-title">ویزیتیک</div>
                <div className="receipt-sub receipt-center">فاکتور فروش گرم — {toPersianNum(receipt.invoiceNumber || '')}</div>
                <div className="receipt-divider"></div>
                <div className="receipt-center">
                  {(receipt.items || []).map((it, i) => (
                    <div className="receipt-row" key={i}>
                      <span>
                        {it.productName} ({toPersianNum(it.cartonCount)} کارتن{it.unitCount ? ` + ${toPersianNum(it.unitCount)} دانه` : ''})
                      </span>
                      <span>{fa(it.lineTotal)}</span>
                    </div>
                  ))}
                </div>
                <div className="receipt-row">
                  <span>جمع ناخالص:</span>
                  <span>{fa(receipt.subtotalAmount)} ت</span>
                </div>
                <div className="receipt-row">
                  <span>تخفیف:</span>
                  <span>-{fa(receipt.totalDiscountAmount)} ت</span>
                </div>
                <div className="receipt-row">
                  <strong>مبلغ قابل پرداخت:</strong>
                  <strong>{fa(receipt.finalAmount)} ت</strong>
                </div>
              </>
            )}
          </div>

          <div className="thermal-modal-actions">
            <button type="button" className="print-receipt-btn" onClick={() => window.print()}>
              <span className="material-symbols-outlined">print</span>
              <span>چاپ فاکتور حرارتی</span>
            </button>
            <button type="button" className="close-receipt-btn" onClick={() => setReceipt(null)}>
              بستن
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
