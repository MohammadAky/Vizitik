import { useEffect, useMemo, useState } from 'react';
import { api, apiSilent } from '../lib/api.js';
import { kv } from '../lib/db.js';
import { useLocalData } from '../lib/data.js';
import { toPersianNum } from '../lib/format.js';
import { usePhpPage } from '../lib/usePhpPage.js';
import BottomNav from '../components/BottomNav.jsx';

const fa = (n) => toPersianNum(Number(n || 0).toLocaleString('en-US'));
const METHODS = [
  ['CASH', 'نقدی', 'payments', 'mCashBtn'],
  ['CARD', 'کارتخوان / پوز', 'point_of_sale', 'mPosBtn'],
  ['CHECK', 'چک صیادی', 'fact_check', 'mCheckBtn']
];

/**
 * وصول مطالبات و دفتر حساب — پورت ۱:۱ از frontend/collections.php
 * (هدر + بنر مجموع طلب بازار، دو تب بدهی/چک، کارت بدهکار با دکمه وصول،
 *  کارت چک‌های دریافتی و مودال «ثبت دریافت وجه» با سه روش پرداخت)
 * چک‌ها همان‌جا از پرداخت‌های سفارشات (method=CHECK) استخراج می‌شوند — همان منطق PHP.
 */
export default function Collections({ go }) {
  const page = usePhpPage('collect');
  const { customers, online, reload } = useLocalData();
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('debtors');
  const [settle, setSettle] = useState(null);
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const cached = await kv.get('orders_cache').catch(() => null);
      if (cached) setOrders(cached);
      if (navigator.onLine) {
        const fresh = await apiSilent('/orders');
        if (Array.isArray(fresh)) {
          setOrders(fresh);
          kv.set('orders_cache', fresh).catch(() => {});
        }
      }
    })();
  }, [online]);

  const { debtors, totalMarketDebt, checks } = useMemo(() => {
    const d = [];
    let total = 0;
    for (const c of customers || []) {
      const debt = Number(c.currentDebt || 0);
      if (debt > 0) {
        d.push({ ...c, debt });
        total += debt;
      }
    }
    const ch = [];
    for (const ord of orders || []) {
      for (const p of ord.payments || []) {
        if ((p.method || '') === 'CHECK' && p.check) {
          ch.push({
            ...p.check,
            customerName: (ord.customer && ord.customer.name) || 'مشتری',
            amount: p.amount || 0
          });
        }
      }
    }
    return { debtors: d, totalMarketDebt: total, checks: ch };
  }, [customers, orders]);

  function openSettleModal(c) {
    setSettle(c);
    setMethod('CASH');
    setAmount('');
    setNotes('');
  }

  async function submitSettlement() {
    if (!settle) return;
    const value = parseFloat((amount || '').replace(/[^0-9]/g, '')) || 0;
    if (value <= 0) {
      window.alert('لطفاً مبلغ دریافتی معتبر وارد نمایید.');
      return;
    }
    setBusy(true);
    try {
      const data = await api(`/customers/${settle.id}/settle`, {
        method: 'POST',
        body: { amount: value, method, notes: (notes || '').trim() }
      });
      window.alert(data?.message || 'دریافت وجه با موفقیت ثبت شد و مانده بدهی مشتری کسر گردید.');
      setSettle(null);
      await reload({ sync: true });
    } catch (err) {
      window.alert(err.message || 'خطا در ثبت دریافت وجه.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* هدر صفحه وصول مطالبات */}
      <header className="collections-header">
        <div className="header-top-row">
          <div className="header-title-box">
            <h1>{page.h1}</h1>
            <span className="header-sub">پیگیری بدهی مشتریان و چک‌های سررسید</span>
          </div>

          <a href="#/dash" className="back-btn" aria-label="بازگشت به داشبورد" onClick={(e) => { e.preventDefault(); go('dash'); }}>
            <span className="material-symbols-outlined">arrow_forward</span>
          </a>
        </div>

        {/* بنر مجموع طلب بازار */}
        <div className="total-debt-banner">
          <div className="banner-info">
            <span className="banner-label">مجموع کل طلب شما از بازار:</span>
            <strong className="banner-amount">{fa(totalMarketDebt)} تومان</strong>
          </div>
          <div style={{ fontSize: '11.5px', background: 'rgba(255,255,255,0.22)', padding: '5px 10px', borderRadius: '8px', fontWeight: 700 }}>
            {toPersianNum(debtors.length)} فروشگاه بدهکار
          </div>
        </div>
      </header>

      {/* محتوای اصلی */}
      <main className="collections-content">
        {/* تب‌های سوییچ */}
        <div className="collections-tabs">
          <button type="button" className={`tab-btn ${tab === 'debtors' ? 'active' : ''}`} id="tabDebtorsBtn" onClick={() => setTab('debtors')}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>account_balance_wallet</span>
            <span>بدهی مشتریان ({toPersianNum(debtors.length)})</span>
          </button>
          <button type="button" className={`tab-btn ${tab === 'checks' ? 'active' : ''}`} id="tabChecksBtn" onClick={() => setTab('checks')}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>fact_check</span>
            <span>چک‌های دریافتی ({toPersianNum(checks.length)})</span>
          </button>
        </div>

        {/* ۱. لیست مشتریان بدهکار */}
        <section className="debtors-list" id="debtorsView" style={{ display: tab === 'debtors' ? '' : 'none' }}>
          {debtors.length > 0 ? (
            debtors.map((d) => (
              <article className="debtor-card" key={d.id}>
                <div className="debtor-card-top">
                  <div className="debtor-name-row">
                    <div className="debtor-avatar">
                      <span className="material-symbols-outlined">storefront</span>
                    </div>
                    <div className="debtor-details">
                      <h3 className="debtor-name">{d.name}</h3>
                      <span className="debtor-phone">{toPersianNum(d.phone || 'بدون شماره')}</span>
                    </div>
                  </div>
                  <div className="debtor-amount-box">
                    <span className="debtor-amount-label">مانده بدهی</span>
                    <strong className="debtor-amount">{fa(d.debt)} ت</strong>
                  </div>
                </div>

                <div className="debtor-actions-row">
                  <button type="button" className="settle-btn" onClick={() => openSettleModal(d)}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add_card</span>
                    <span>ثبت دریافت وجه</span>
                  </button>
                  {d.phone && (
                    <a href={`tel:${d.phone}`} className="call-btn" title="تماس تلفنی">
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>call</span>
                    </a>
                  )}
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state-card">
              <div className="empty-icon success">
                <span className="material-symbols-outlined">task_alt</span>
              </div>
              <strong>تمامی حساب‌های مشتریان تسویه است</strong>
              <span>هیچ مانده بدهی بازی در سیستم وجود ندارد.</span>
            </div>
          )}
        </section>

        {/* ۲. لیست چک‌های صیادی */}
        <section className="checks-list" id="checksView" style={{ display: tab === 'checks' ? '' : 'none' }}>
          {checks.length > 0 ? (
            checks.map((chk, i) => {
              let statusClass = 'pending';
              let statusTitle = 'در انتظار سررسید';
              if (chk.status === 'PASSED') {
                statusClass = 'passed';
                statusTitle = 'پاس شده';
              } else if (chk.status === 'BOUNCED') {
                statusClass = 'bounced';
                statusTitle = 'برگشت خورده';
              }
              return (
                <article className="check-card" key={chk.id || i}>
                  <div className="check-card-header">
                    <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>{chk.customerName || 'مشتری'}</strong>
                    <span className={`check-badge ${statusClass}`}>{statusTitle}</span>
                  </div>

                  <div className="check-meta-row">
                    <span>مبلغ چک:</span>
                    <strong style={{ fontSize: '13px', color: 'var(--primary)' }}>{fa(chk.amount)} تومان</strong>
                  </div>
                  <div className="check-meta-row">
                    <span>شناسه / شماره:</span>
                    <span>{toPersianNum(chk.checkNumber || '---')}</span>
                  </div>
                  <div className="check-meta-row">
                    <span>بانک و سررسید:</span>
                    <span>
                      {chk.bankName || 'بانک'} | {toPersianNum(chk.dueDate ? new Date(chk.dueDate).toLocaleDateString('fa-IR') : '---')}
                    </span>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="empty-state-card">
              <div className="empty-icon">
                <span className="material-symbols-outlined">fact_check</span>
              </div>
              <strong>هیچ چک دریافتی ثبت نشده است</strong>
              <span>در حال حاضر چک بازی در سیستم وجود ندارد.</span>
            </div>
          )}
        </section>
      </main>

      {/* نوار ناوبری پایینی */}
      <BottomNav items={page.nav.items} active={page.nav.active} onGo={go} />

      {/* مدال ثبت وصولی */}
      <div
        className="modal-overlay"
        id="settleModal"
        style={{ display: settle ? 'flex' : 'none' }}
        onClick={(e) => { if (e.target === e.currentTarget) setSettle(null); }}
      >
        <div className="settlement-modal-sheet">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--border)',
              paddingBottom: '10px'
            }}
          >
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 800, margin: 0 }}>ثبت دریافت وجه</h3>
              <span id="settleCustName" style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: 700 }}>
                {settle ? settle.name : ''}
              </span>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setSettle(null)}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* مبلغ دریافتی */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11.5px', fontWeight: 700 }} htmlFor="settleAmountInput">
              مبلغ دریافتی (تومان):
            </label>
            <input
              type="text"
              id="settleAmountInput"
              placeholder="مبلغ وصولی..."
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
              style={{
                height: '44px',
                borderRadius: '12px',
                border: '1.5px solid var(--border)',
                padding: '0 12px',
                fontFamily: 'inherit',
                fontSize: '14px',
                fontWeight: 800,
                textAlign: 'right',
                direction: 'ltr'
              }}
            />
          </div>

          {/* روش دریافت وجه */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '11.5px', fontWeight: 700 }}>روش پرداخت:</label>
            <div className="method-radio-group">
              {METHODS.map(([value, label, icon, id]) => (
                <button
                  key={value}
                  type="button"
                  className={`method-radio-btn ${method === value ? 'active' : ''}`}
                  id={id}
                  onClick={() => setMethod(value)}
                >
                  <span className="material-symbols-outlined">{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* توضیحات / شماره پیگیری */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700 }} htmlFor="settleNotesInput">
              شماره پیگیری یا توضیحات (اختیاری):
            </label>
            <input
              type="text"
              id="settleNotesInput"
              placeholder="مثلاً: شماره ارجاع دستگاه پوز"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                height: '40px',
                borderRadius: '10px',
                border: '1px solid var(--border)',
                padding: '0 10px',
                fontFamily: 'inherit',
                fontSize: '12px'
              }}
            />
          </div>

          <button
            type="button"
            className="settle-btn"
            id="settleSubmitBtn"
            style={{ height: '46px', fontSize: '13.5px', marginTop: '4px' }}
            disabled={busy}
            onClick={submitSettlement}
          >
            {busy ? (
              <span>در حال ثبت دریافت وجه...</span>
            ) : (
              <>
                <span className="material-symbols-outlined">check_circle</span>
                <span>ثبت در دفتر حساب و کاهش بدهی</span>
              </>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
