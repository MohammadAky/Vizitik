import { useEffect, useMemo, useState } from 'react';
import { api, apiSilent } from '../lib/api.js';
import { formatPrice, toPersianNum, onlyDigits, parseFaNumber } from '../lib/format.js';
import { usePhpPage } from '../lib/usePhpPage.js';
import { showToast } from '../components/AppToast.jsx';

const METHODS = [
  ['CASH', 'پرداخت نقدی', 'payments'],
  ['CARD', 'کارتخوان / پوز', 'point_of_sale'],
  ['CHECK', 'چک صیادی', 'fact_check']
];

/**
 * تسویه و تسهیم پرداخت — پورت frontend/payment.php
 * (payment-header، customer-summary-card، شبکه روش‌های پرداخت،
 *  کارت تخفیفات پلکانی، خلاصه مانده، شیت تأیید و فاکتور حرارتی)
 * ورودی: ‎#/payment?order=<id>  (در PHP: payment.php?orderId=…)
 */
export default function Payment({ go, params = {} }) {
  const page = usePhpPage('payment');
  const orderId = params.order || '';
  const [order, setOrder] = useState(null);
  const [values, setValues] = useState({ CASH: '', CARD: '', CHECK: '' });
  const [checkNo, setCheckNo] = useState('');
  const [bank, setBank] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [receipt, setReceipt] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    (async () => {
      const inv = await apiSilent(`/orders/${orderId}/invoice`);
      if (!inv) return;
      setOrder(inv);
      // این‌اندپوینت cashAmount/posAmount/checkAmount ندارد؛ پرداخت‌ها در inv.payments است
      const byMethod = {};
      for (const p of inv.payments || []) byMethod[p.method] = p.amount;
      setValues({
        CASH: byMethod.CASH ? String(byMethod.CASH) : '',
        CARD: byMethod.CARD ? String(byMethod.CARD) : '',
        CHECK: byMethod.CHECK ? String(byMethod.CHECK) : ''
      });
      const chk = (inv.payments || []).find((p) => p.method === 'CHECK' && p.check);
      if (chk && chk.check) {
        setCheckNo(chk.check.checkNumber && chk.check.checkNumber !== '---' ? chk.check.checkNumber : '');
        setBank(chk.check.bankName && chk.check.bankName !== 'بانک' ? chk.check.bankName : '');
      }
    })();
  }, [orderId]);

  // شکل واقعی پاسخ GET /orders/:id/invoice:
  // { pricing: { subtotal, discountSteps:[{step,percent,before,after}], totalDiscount, finalAmount }, payments:[...], ... }
  const pricing = (order && order.pricing) || {};
  const gross = Number(pricing.subtotal ?? (order && (order.subtotalAmount ?? order.totalAmount)) ?? 0) || 0;
  const finalAmount = Number(pricing.finalAmount ?? (order && order.finalAmount) ?? gross) || 0;
  const discountSum = Number(pricing.totalDiscount ?? Math.max(0, gross - finalAmount)) || 0;
  const steps = useMemo(() => {
    const raw = pricing.discountSteps || (order && order.discountSteps) || [];
    return (raw || []).map((s, i) => {
      const percent = Number(s.percent ?? (s.type === 'percent' ? s.value : 0) ?? 0) || 0;
      const before = Number(s.before ?? s.amountBeforeStep ?? 0) || 0;
      const after = Number(s.after ?? s.amountAfterStep ?? 0) || 0;
      const amount = Number(s.stepDiscount ?? (before > 0 ? before - after : 0)) || 0;
      return { step: s.step ?? s.stepOrder ?? i + 1, percent, before, after, amount };
    });
  }, [order]);
  const paid = useMemo(() => Object.values(values).reduce((s, v) => s + (parseFaNumber(v, 0) || 0), 0), [values]);
  const credit = Math.max(0, finalAmount - paid);

  async function submitPayment() {
    setBusy(true);
    const payments = [];
    for (const [method] of METHODS) {
      const amount = parseFaNumber(values[method], 0) || 0;
      if (amount <= 0) continue;
      payments.push(
        method === 'CHECK'
          ? { method, amount, checkDetails: { checkNumber: checkNo || '---', bankName: bank || 'بانک', dueDate: dueDate || new Date().toISOString() } }
          : { method, amount }
      );
    }
    try {
      // PUT /orders/:id/payments فقط payments می‌پذیرد؛ تخفیف‌ها از قبل روی فاکتور اعمال شده‌اند
      // و تغییرشان از صفحه «مدیریت فاکتورها» (ویرایش کامل) انجام می‌شود.
      await api(`/orders/${orderId}/payments`, { method: 'PUT', body: { payments } });
      setConfirm(false);
      showToast('تسویه با موفقیت ثبت و دفتر حساب به‌روزرسانی شد.', 'success');
      go('orders');
    } catch (err) {
      showToast(err.message || 'خطا در ثبت تسویه.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="payment-header">
        <div className="header-title-box">
          <h1>{page.h1}</h1>
          <span className="header-sub">روش‌های پرداخت و ثبت نهایی</span>
        </div>

        <a href="#/dash" className="back-btn" aria-label="بازگشت به داشبورد" onClick={(e) => { e.preventDefault(); go('dash'); }}>
          <span className="material-symbols-outlined">arrow_forward</span>
        </a>
      </header>

      <main className="payment-content">
        {/* ۱. کارت اطلاعات مشتری و جمع سفارش ناخالص */}
        <section className="customer-summary-card">
          <div className="cust-summary-header">
            <div className="cust-summary-name">
              <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>storefront</span>
              <strong id="sumCustName">{(order && order.customer && order.customer.name) || 'نام مشتری'}</strong>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>فاکتور فروش گرم</span>
          </div>
          <div className="cust-summary-rows">
            <div className="cust-summary-row">
              <span>شماره فاکتور:</span>
              <strong className="invoice-num">{toPersianNum((order && order.invoiceNumber) || '---')}</strong>
            </div>
            <div className="cust-summary-row">
              <span>جمع ناخالص سفارش:</span>
              <strong id="sumGrossAmount">{formatPrice(gross)} تومان</strong>
            </div>
          </div>
        </section>

        {!orderId && (
          <div className="empty-orders-box">
            <span className="material-symbols-outlined">receipt_long</span>
            <p>برای تسویه، یک فاکتور را از بخش سفارشات انتخاب کنید.</p>
            <a href="#/orders" className="empty-action-link" onClick={(e) => { e.preventDefault(); go('orders'); }}>مشاهده فاکتورها</a>
          </div>
        )}

        {/* ۲. روش‌های دریافت وجه */}
        <section className="pay-card">
          <div className="pay-card-header">
            <span className="material-symbols-outlined">pending_actions</span>
            <h3 className="pay-card-title">تسهیم مبلغ بین روش‌های دریافت</h3>
          </div>

          <div className="payment-methods-grid">
            {METHODS.map(([key, label, icon]) => (
              <div className="pay-input-wrap" key={key}>
                <label>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>{icon}</span> {label}
                </label>
                <input
                  className="pay-amount-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="۰"
                  value={values[key]}
                  onChange={(e) => setValues({ ...values, [key]: onlyDigits(e.target.value) })}
                />
              </div>
            ))}
          </div>

          {parseFaNumber(values.CHECK, 0) > 0 && (
            <div className="check-fields-box">
              <input className="pay-amount-input" placeholder="شناسه صیادی ۱۶ رقمی..." value={checkNo} onChange={(e) => setCheckNo(e.target.value)} />
              <input className="pay-amount-input" placeholder="نام بانک صادرکننده..." value={bank} onChange={(e) => setBank(e.target.value)} />
              <input className="pay-amount-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          )}

          <div className="discount-action-wrap">
            <button type="button" className="quick-btn" onClick={() => setValues({ ...values, CASH: String(finalAmount) })}>
              تسویه کامل نقدی
            </button>
            <button type="button" className="quick-btn" onClick={() => setValues({ CASH: '', CARD: '', CHECK: '' })}>
              صفر کردن مبالغ
            </button>
          </div>
        </section>

        {/* ۳. تخفیفات پلکانی — روی فاکتورِ موجود فقط نمایش داده می‌شوند (قبلاً در مبلغ نهایی لحاظ شده‌اند) */}
        <section className="discounts-container-card">
          <div className="pay-card-header">
            <span className="material-symbols-outlined">local_offer</span>
            <h3 className="pay-card-title">تخفیفات پلکانی فاکتور</h3>
          </div>

          {steps.length > 0 ? (
            <div className="applied-discounts-wrapper">
              <div className="applied-discounts-list">
                {steps.map((s) => (
                  <div className="confirm-recap-row" key={`step_${s.step}`}>
                    <span className="discount-step-num">{toPersianNum(s.step)}</span>
                    <span className="applied-discount-text">پله تخفیف {toPersianNum(s.percent)}٪</span>
                    <span className="discount-tag-icon">
                      <span className="material-symbols-outlined">percent</span>
                    </span>
                    <span className="applied-discount-info">-{formatPrice(s.amount)} ت</span>
                  </div>
                ))}
              </div>
              <div className="applied-discounts-total">
                <span>مجموع تخفیفات اعمال‌شده:</span>
                <strong>{formatPrice(discountSum)} تومان</strong>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', padding: '4px 2px' }}>
              برای این فاکتور تخفیفی ثبت نشده است.
            </div>
          )}
        </section>

        {/* ۴. خلاصه مالی */}
        <section className="final-balance-card">
          <div className="final-balance-row">
            <span>مبلغ نهایی پس از تخفیف:</span>
            <strong className="highlight">{formatPrice(finalAmount)} تومان</strong>
          </div>
          <div className="final-balance-row">
            <span>مجموع دریافتی این مرحله:</span>
            <strong>{formatPrice(paid)} تومان</strong>
          </div>
          <div className="final-balance-row">
            <span>مانده در دفتر حساب (نسیه):</span>
            <strong>{formatPrice(credit)} تومان</strong>
          </div>
          <div className="due-pills-row">
            {credit === 0 && finalAmount > 0 && <span className="due-pill settled">تسویه کامل</span>}
            {credit > 0 && <span className="due-pill">در انتظار وصول: {formatPrice(credit)} ت</span>}
          </div>

          <div className="submit-order-box">
            <button type="button" className="submit-order-btn" disabled={!orderId} onClick={() => setConfirm(true)}>
              <span className="material-symbols-outlined">check_circle</span>
              <span>ثبت تسویه و کاهش مانده</span>
            </button>
            <button type="button" className="print-receipt-btn" onClick={() => setReceipt(true)}>
              <span className="material-symbols-outlined">print</span>
              <span>پیش‌نمایش فاکتور</span>
            </button>
          </div>
        </section>
      </main>

      {/* شیت تأیید تسویه */}
      <div className="modal-overlay" style={{ display: confirm ? 'flex' : 'none' }} onClick={(e) => { if (e.target === e.currentTarget) setConfirm(false); }}>
        <div className="confirm-pay-sheet">
          <h3 style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>تأیید ثبت تسویه</h3>
          <div className="confirm-recap-box">
            {METHODS.map(([key, label]) =>
              parseFaNumber(values[key], 0) > 0 ? (
                <div className="confirm-recap-row" key={key}>
                  <span>{label}:</span>
                  <strong>{formatPrice(values[key])} تومان</strong>
                </div>
              ) : null
            )}
            <div className="confirm-recap-row">
              <span>تعداد پله‌های تخفیف:</span>
              <strong>{toPersianNum(steps.length)}</strong>
            </div>
            <div className="confirm-recap-row">
              <span>مانده نسیه:</span>
              <strong>{formatPrice(credit)} تومان</strong>
            </div>
          </div>
          <button type="button" className="submit-order-btn" disabled={busy} onClick={submitPayment}>
            <span className="material-symbols-outlined">{busy ? 'sync' : 'save'}</span>
            <span>{busy ? 'در حال ثبت...' : 'ثبت نهایی'}</span>
          </button>
          <button type="button" className="confirm-cancel-btn" onClick={() => setConfirm(false)}>انصراف</button>
        </div>
      </div>

      {/* فاکتور حرارتی */}
      <div className="invoice-modal-overlay" style={{ display: receipt ? 'flex' : 'none' }} onClick={(e) => { if (e.target === e.currentTarget) setReceipt(false); }}>
        <div className="thermal-invoice-container">
          <div className="thermal-invoice-header">
            <span>پیش‌نمایش فاکتور حرارتی</span>
          </div>
          <div className="thermal-receipt-paper" id="thermalReceiptPaper">
            <div className="receipt-title receipt-center">ویزیتیک</div>
            <div className="receipt-sub receipt-center">فاکتور فروش — {toPersianNum((order && order.invoiceNumber) || '---')}</div>
            <div className="receipt-divider"></div>
            <div className="receipt-row">
              <span>مشتری:</span>
              <span>{(order && order.customer && order.customer.name) || '—'}</span>
            </div>
            {(order && order.items ? order.items : []).map((it, i) => (
              <div className="receipt-row" key={i}>
                <span>{it.productName}</span>
                <span>{formatPrice(it.lineTotal || it.totalPrice || 0)}</span>
              </div>
            ))}
            <div className="receipt-divider"></div>
            <div className="receipt-row">
              <span>تخفیفات:</span>
              <span>{formatPrice(discountSum)}</span>
            </div>
            <div className="receipt-row">
              <span>خالص قابل پرداخت:</span>
              <span>{formatPrice(finalAmount)}</span>
            </div>
            <div className="receipt-sub receipt-center">با تشکر از خرید شما — ویزیتیک</div>
          </div>
          <div className="thermal-modal-actions">
            <button type="button" className="print-receipt-btn" onClick={() => window.print()}>
              <span className="material-symbols-outlined">print</span>
              <span>چاپ</span>
            </button>
            <button type="button" className="close-receipt-btn" onClick={() => setReceipt(false)}>بستن</button>
          </div>
        </div>
      </div>
    </>
  );
}
