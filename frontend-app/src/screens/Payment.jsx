import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useLocalData } from '../lib/data.js';
import { enqueue } from '../lib/sync.js';
import { generateLocalUuid } from '../lib/pricing.js';
import { formatPrice, toPersianNum, onlyDigits, parseFaNumber } from '../lib/format.js';
import { usePhpPage } from '../lib/usePhpPage.js';
import { showToast } from '../components/AppToast.jsx';

// در payment.js مرجع، formatPrice پسوند «تومان» را هم دارد
const fp = (n) => `${formatPrice(n)} تومان`;
// کلید پیش‌نویس سفارش — همان vizitik_current_order در new-order.js
const DRAFT_KEY = 'vizitik_current_order';

const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

/** امروز شمسی برای پیش‌فرض سررسید چک (در مرجع هاردکد ۱۶/۶/۱۴۰۵ بود) */
function jalaliToday() {
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(new Date());
    const get = (t) => Number((parts.find((p) => p.type === t) || {}).value || 0);
    const y = get('year');
    const m = get('month');
    const d = get('day');
    if (y > 1300 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y, m, d };
  } catch {
    /* ignore */
  }
  return { y: 1405, m: 6, d: 16 };
}

/** فرمت ۳ رقم ۳ رقم هنگام تایپ — عین formatFixedDiscountInput با پشتیبانی ارقام فارسی */
function formatThousands(raw) {
  const d = onlyDigits(raw);
  if (!d) return '';
  return Number(d).toLocaleString('en-US');
}

/**
 * محاسبه پلکانی تخفیف‌ها — عین recalcAllCalculations در payment.js:
 * هر پله درصدی روی مانده گرد می‌شود و پله مبلغی سقفش مانده است.
 */
function calcDiscounts(subtotal, list) {
  let current = subtotal || 0;
  let totalDiscount = 0;
  const steps = (list || []).map((disc, idx) => {
    let stepDiscount = 0;
    if (disc.type === 'percent') stepDiscount = Math.round((current * disc.value) / 100);
    else if (disc.type === 'fixed') stepDiscount = Math.min(current, disc.value);
    const amountBefore = current;
    current -= stepDiscount;
    totalDiscount += stepDiscount;
    return { ...disc, stepOrder: idx + 1, amountBefore, calculatedAmount: stepDiscount, amountAfter: current };
  });
  return { steps, totalDiscount, finalAmount: Math.max(0, Math.round(current)) };
}

const fmtAmount = (n) => (n > 0 ? n.toLocaleString('en-US') : '');

/**
 * تسویه و تسهیم پرداخت — پورت ۱:۱ از frontend/payment.php + js/payment.js
 * (خلاصه مشتری، تخفیفات پلکانی درصدی/مبلغی، مبلغ نهایی، ۴ روش پرداخت با پرکردن سریع،
 *  چک صیادی با انتخاب‌گر تاریخ شمسی، مدال تأیید نهایی و فاکتور حرارتی ۸۰ میلی‌متری)
 */
export default function Payment({ go }) {
  const page = usePhpPage('payment');
  const { reload } = useLocalData();
  const [draft, setDraft] = useState(null);
  const [discounts, setDiscounts] = useState([]);
  const [pct, setPct] = useState('');
  const [fixed, setFixed] = useState('');
  const [mode, setMode] = useState('cash'); // activePaymentMode در payment.js
  const [cash, setCash] = useState('');
  const [pos, setPos] = useState('');
  const [check, setCheck] = useState('');
  const [checkNo, setCheckNo] = useState('');
  const [bank, setBank] = useState('');
  const today = useRef(jalaliToday()).current;
  const [due, setDue] = useState({ d: today.d, m: today.m, y: today.y });
  const [years, setYears] = useState(() => Array.from(new Set([1405, 1406, 1407, today.y])).sort((a, b) => a - b));
  const [confirm, setConfirm] = useState(false);
  const [receipt, setReceipt] = useState(null); // { num, dueStr }
  const [submitting, setSubmitting] = useState(false);
  const inited = useRef(false);

  // payment.js → DOMContentLoaded: خواندن پیش‌نویس وگرنه بازگشت به ثبت سفارش
  useEffect(() => {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) {
      go('order');
      return;
    }
    try {
      setDraft(JSON.parse(raw));
    } catch {
      go('order');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtotal = Number((draft && draft.subtotal) || 0);
  const calc = useMemo(() => calcDiscounts(subtotal, discounts), [subtotal, discounts]);
  const finalAmount = calc.finalAmount;
  const totalDiscount = calc.totalDiscount;

  const cashNum = parseFaNumber(cash, 0) || 0;
  const posNum = parseFaNumber(pos, 0) || 0;
  const checkNum = parseFaNumber(check, 0) || 0;
  const paidSum = cashNum + posNum + checkNum;
  const credit = Math.max(0, finalAmount - paidSum);

  // payment.js → quickFillMethod('cash') در لود صفحه
  useEffect(() => {
    if (!draft || inited.current) return;
    inited.current = true;
    setMode('cash');
    setCash(fmtAmount(subtotal));
    setPos('');
    setCheck('');
  }, [draft, subtotal]);

  /** payment.js → syncActivePaymentInputsWithNewFinal */
  function syncAmounts(nextMode, final, cur) {
    const f = fmtAmount(final);
    if (nextMode === 'cash') {
      setCash(f);
      setPos('');
      setCheck('');
    } else if (nextMode === 'pos') {
      setCash('');
      setPos(f);
      setCheck('');
    } else if (nextMode === 'check') {
      setCash('');
      setPos('');
      setCheck(f);
    } else if (nextMode === 'credit') {
      setCash('');
      setPos('');
      setCheck('');
    } else {
      // حالت چندحالته دستی: اگر مجموع از مبلغ نهایی بیشتر شد، تراز شود
      let { cash: c, pos: p } = cur;
      const total = c + p + cur.check;
      if (total > final) {
        const over = total - final;
        if (c >= over) c -= over;
        else {
          c = 0;
          p = Math.min(p, final);
        }
      }
      setCash(fmtAmount(c));
      setPos(fmtAmount(p));
      setCheck(fmtAmount(cur.check));
    }
  }

  /** payment.js → quickFillMethod */
  function quickFillMethod(method) {
    setMode(method);
    syncAmounts(method, finalAmount, { cash: 0, pos: 0, check: 0 });
  }

  /** payment.js → onPaymentInputChanged */
  function onPaymentInputChanged(method, raw) {
    setMode('custom');
    const formatted = formatThousands(raw);
    if (method === 'cash') setCash(formatted);
    else if (method === 'pos') setPos(formatted);
    else if (method === 'check') setCheck(formatted);
  }

  /** payment.js → applyDiscountFromInputs */
  function applyDiscountFromInputs() {
    const percentVal = parseFaNumber(pct, 0) || 0;
    const fixedVal = parseFaNumber(fixed, 0) || 0;

    if (percentVal <= 0 && fixedVal <= 0) {
      showToast('لطفاً درصد تخفیف یا مبلغ تخفیف را وارد نمایید.', 'warning');
      return;
    }
    if (percentVal > 100) {
      showToast('درصد تخفیف نمی‌تواند بیشتر از ۱۰۰٪ باشد.', 'error');
      return;
    }
    if (fixedVal > subtotal) {
      showToast('مبلغ تخفیف نمی‌تواند بیشتر از مبلغ کل سفارش باشد.', 'error');
      return;
    }

    const next = discounts.slice();
    if (percentVal > 0) {
      next.push({ id: `disc_${Date.now()}_p_${Math.floor(Math.random() * 1000)}`, type: 'percent', value: percentVal });
    }
    if (fixedVal > 0) {
      next.push({ id: `disc_${Date.now()}_f_${Math.floor(Math.random() * 1000)}`, type: 'fixed', value: fixedVal });
    }
    setDiscounts(next);
    setPct('');
    setFixed('');
    syncAmounts(mode, calcDiscounts(subtotal, next).finalAmount, { cash: cashNum, pos: posNum, check: checkNum });
  }

  /** payment.js → removeDiscountStep */
  function removeDiscountStep(index) {
    const next = discounts.filter((_, i) => i !== index);
    setDiscounts(next);
    syncAmounts(mode, calcDiscounts(subtotal, next).finalAmount, { cash: cashNum, pos: posNum, check: checkNum });
  }

  /** payment.js → setCheckDueDaysPersian */
  function setCheckDueDaysPersian(days) {
    let d = Number(due.d) || today.d;
    let m = Number(due.m) || today.m;
    let y = Number(due.y) || today.y;
    d += days;
    while (d > 30) {
      d -= 30;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    setDue({ d, m, y });
    setYears((ys) => (ys.includes(y) ? ys : [...ys, y].sort((a, b) => a - b)));
  }

  /** payment.js → openFinalConfirmModal */
  function openFinalConfirmModal() {
    setConfirm(true);
  }

  /** payment.js → executeOrderSubmission */
  async function executeOrderSubmission() {
    if (!draft) return;
    setConfirm(false);
    setSubmitting(true);

    const localUuid = generateLocalUuid();
    const itemsPayload = Object.values(draft.items || {}).map((item) => ({
      productId: item.productId || 'p-1',
      cartonCount: item.cartonCount || 0,
      unitCount: item.unitCount || 0
    }));
    const persianDueDateStr = `${due.y}/${due.m}/${due.d}`;

    const paymentsPayload = [];
    if (cashNum > 0) paymentsPayload.push({ method: 'CASH', amount: cashNum });
    if (posNum > 0) paymentsPayload.push({ method: 'CARD', amount: posNum });
    if (checkNum > 0) {
      paymentsPayload.push({
        method: 'CHECK',
        amount: checkNum,
        checkDetails: {
          checkNumber: onlyDigits(checkNo) || '1234567890123456',
          bankName: (bank || '').trim() || 'بانک ملی',
          dueDate: new Date().toISOString()
        }
      });
    }

    const discountSteps = discounts.map((d) => ({
      type: d.type === 'fixed' ? 'fixed' : 'percent',
      value: Number(d.value) || 0
    }));

    const payload = {
      localUuid,
      customerId: draft.customerId || 'sample-id',
      items: itemsPayload,
      discountSteps,
      payments: paymentsPayload
    };

    let realInvoiceNumber = null;
    try {
      if (!navigator.onLine) throw new Error('offline');
      const data = await api('/orders', { method: 'POST', body: payload, timeout: 20000 });
      if (data && (data.invoiceNumber || (data.order && data.order.invoiceNumber))) {
        realInvoiceNumber = data.invoiceNumber || data.order.invoiceNumber;
      }
      showToast('فاکتور صادر و بار خودرو به‌روزرسانی شد.', 'success');
    } catch (err) {
      if (!navigator.onLine || String((err && err.message) || '').includes('offline')) {
        await enqueue('ORDER', payload);
        showToast('آفلاین — فاکتور در صف همگام‌سازی ثبت شد.', 'warning');
      } else {
        showToast((err && err.message) || 'خطا در ثبت نهایی فاکتور.', 'error');
        setSubmitting(false);
        return;
      }
    }

    const fallbackNumber = localUuid.length > 8 ? localUuid.substring(0, 8).toUpperCase() : localUuid;
    sessionStorage.removeItem(DRAFT_KEY);
    reload({ sync: true }).catch(() => {});
    setReceipt({ num: realInvoiceNumber || fallbackNumber, dueStr: persianDueDateStr });
    setSubmitting(false);
  }

  /** payment.js → handleSafeBackFromPayment */
  function handleSafeBack(e) {
    e.preventDefault();
    if (!window.confirm('آیا از بازگشت به صفحه انتخاب اقلام اطمینان دارید؟')) return;
    go('order');
  }

  if (!draft) return null;

  const draftItems = Object.values(draft.items || {});
  const prevDebt = Number(draft.customerDebt || 0);

  let discountModalText = '۰ تومان';
  if (totalDiscount > 0) {
    discountModalText = `-${fp(totalDiscount)} (${toPersianNum(discounts.length)} پله)`;
  }
  const paySplitText = [];
  if (cashNum > 0) paySplitText.push(`نقد: ${fp(cashNum)}`);
  if (posNum > 0) paySplitText.push(`پوز: ${fp(posNum)}`);
  if (checkNum > 0) paySplitText.push(`چک: ${fp(checkNum)}`);
  if (credit > 0) paySplitText.push(`نسیه: ${fp(credit)}`);

  return (
    <>
      {/* هدر صفحه پرداخت */}
      <header className="payment-header">
        <div className="header-title-box">
          <h1>{page.h1}</h1>
          <span className="header-sub">روش‌های پرداخت و ثبت نهایی</span>
        </div>

        <a href="#/order" className="back-btn" onClick={handleSafeBack} aria-label="بازگشت به سفارش">
          <span className="material-symbols-outlined">arrow_forward</span>
        </a>
      </header>

      {/* محتوای اصلی صفحه پرداخت */}
      <main className="payment-content">
        {/* ۱. کارت اطلاعات مشتری و جمع سفارش ناخالص */}
        <section className="customer-summary-card">
          <div className="cust-summary-header">
            <div className="cust-summary-name">
              <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>storefront</span>
              <strong id="sumCustName">{draft.customerName || 'مشتری'}</strong>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>فاکتور فروش گرم</span>
          </div>

          <div className="cust-summary-rows">
            <div className="cust-summary-row">
              <span>جمع کل ناخالص اقلام:</span>
              <strong id="sumSubtotalVal">{fp(subtotal)}</strong>
            </div>
            <div className="cust-summary-row" id="sumPrevDebtRow" style={{ display: prevDebt > 0 ? 'flex' : 'none', color: '#dc2626' }}>
              <span>مانده بدهی قبلی مشتری:</span>
              <strong id="sumPrevDebtVal" style={{ color: '#dc2626' }}>{fp(prevDebt)}</strong>
            </div>
          </div>
        </section>

        {/* ۲. بخش تخفیفات پلکانی (بالای گزینه‌های پرداخت جهت محاسبه قیمت خالص قبل از انتخاب روش تسویه) */}
        <section className="discounts-container-card">
          <div className="discounts-inputs-row">
            {/* سمت راست: تخفیف درصدی */}
            <div className="discount-field percent-field">
              <label htmlFor="discountPercentInput">تخفیف درصدی (%)</label>
              <div className="discount-input-box">
                <input
                  type="text"
                  inputMode="decimal"
                  id="discountPercentInput"
                  placeholder="۰"
                  value={pct}
                  onChange={(e) => setPct(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyDiscountFromInputs(); }}
                />
                <span className="discount-unit-tag">٪</span>
              </div>
            </div>

            {/* سمت چپ: تخفیف مبلغی */}
            <div className="discount-field fixed-field">
              <label htmlFor="discountFixedInput">تخفیف مبلغی (تومان)</label>
              <div className="discount-input-box">
                <input
                  type="text"
                  inputMode="numeric"
                  id="discountFixedInput"
                  placeholder="۰"
                  value={fixed}
                  onChange={(e) => setFixed(formatThousands(e.target.value))}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyDiscountFromInputs(); }}
                />
                <span className="discount-unit-tag">ت</span>
              </div>
            </div>

            {/* جلوی بخش تخفیف مبلغی: دکمه و علامت اعمال تخفیف */}
            <div className="discount-action-wrap">
              <button type="button" className="apply-discount-btn" id="applyDiscountBtn" onClick={applyDiscountFromInputs} title="ثبت تخفیف">
                <span className="material-symbols-outlined">add</span>
                <span>ثبت</span>
              </button>
            </div>
          </div>

          {/* لیست تخفیفات ثبت‌شده زیر هم با امکان حذف هر کدام */}
          <div className="applied-discounts-wrapper" id="appliedDiscountsWrapper" style={{ display: discounts.length > 0 ? 'flex' : 'none' }}>
            <div className="applied-discounts-list" id="appliedDiscountsList">
              {calc.steps.map((disc, idx) => (
                <div className="applied-discount-line" key={disc.id}>
                  <div className="applied-discount-info">
                    <span className="discount-step-num">پله {toPersianNum(idx + 1)}</span>
                    <span className="material-symbols-outlined discount-tag-icon">sell</span>
                    <span className="applied-discount-text">
                      {disc.type === 'percent'
                        ? `تخفیف درصدی: ${toPersianNum(disc.value)}٪ (-${fp(disc.calculatedAmount)})`
                        : `تخفیف نقدی: ${toPersianNum(Number(disc.value).toLocaleString('en-US'))} تومان (-${fp(disc.calculatedAmount)})`}
                    </span>
                  </div>
                  <button type="button" className="remove-discount-btn" onClick={() => removeDiscountStep(idx)} title="حذف این پله تخفیف">
                    <span className="material-symbols-outlined">delete</span>
                    <span>حذف</span>
                  </button>
                </div>
              ))}
            </div>
            <div className="applied-discounts-total" id="appliedDiscountsTotal">
              <span>مجموع کل تخفیفات اعمال‌شده ({toPersianNum(discounts.length)} پله):</span>
              <strong style={{ color: '#ea580c', fontSize: '13px' }}>-{fp(totalDiscount)}</strong>
            </div>
          </div>
        </section>

        {/* ۳. وضعیت تسویه و مبلغ نهایی فاکتور پس از تخفیف */}
        <section className={`final-balance-card ${credit === 0 ? 'settled' : ''}`.trim()} id="finalBalanceCard">
          <div className="final-balance-row">
            <span>مبلغ نهایی قابل پرداخت:</span>
            <strong className="amount" id="finalPayableAmount">{fp(finalAmount)}</strong>
          </div>
          <div id="paymentStatusText" style={{ fontSize: '11.5px', fontWeight: 700, marginTop: '2px' }}>
            {credit === 0 ? (
              <span style={{ color: '#15803d' }}>تسویه کامل نقدی و بانکی</span>
            ) : (
              <span style={{ color: '#ea580c' }}>مانده در دفتر حساب (نسیه): {fp(credit)}</span>
            )}
          </div>
        </section>

        {/* ۴. بخش ۴ روش پرداخت (نقدی، پوز، چک، نسیه) بر اساس مبلغ نهایی خالص */}
        <section className="payment-methods-grid">
          {/* ۱. پرداخت نقدی */}
          <div className="pay-card">
            <div className="pay-card-header">
              <div className="pay-card-title cash">
                <span className="material-symbols-outlined">payments</span>
                <span>پرداخت نقدی</span>
              </div>
              <button type="button" className="quick-btn" onClick={() => quickFillMethod('cash')}>تمام مبلغ نقد</button>
            </div>
            <div className="pay-input-wrap">
              <input type="text" inputMode="numeric" className="pay-amount-input" id="cashInput" value={cash} onChange={(e) => onPaymentInputChanged('cash', e.target.value)} />
              <span className="input-unit">تومان</span>
            </div>
          </div>

          {/* ۲. کارتخوان / پوز */}
          <div className="pay-card">
            <div className="pay-card-header">
              <div className="pay-card-title pos">
                <span className="material-symbols-outlined">point_of_sale</span>
                <span>کارتخوان / پوز</span>
              </div>
              <button type="button" className="quick-btn" onClick={() => quickFillMethod('pos')}>تمام مبلغ پوز</button>
            </div>
            <div className="pay-input-wrap">
              <input type="text" inputMode="numeric" className="pay-amount-input" id="posInput" value={pos} onChange={(e) => onPaymentInputChanged('pos', e.target.value)} />
              <span className="input-unit">تومان</span>
            </div>
          </div>

          {/* ۳. چک صیادی */}
          <div className="pay-card">
            <div className="pay-card-header">
              <div className="pay-card-title check">
                <span className="material-symbols-outlined">fact_check</span>
                <span>چک صیادی</span>
              </div>
              <button type="button" className="quick-btn" onClick={() => quickFillMethod('check')}>تمام مبلغ چک</button>
            </div>
            <div className="pay-input-wrap">
              <input type="text" inputMode="numeric" className="pay-amount-input" id="checkInput" value={check} onChange={(e) => onPaymentInputChanged('check', e.target.value)} />
              <span className="input-unit">تومان</span>
            </div>

            {/* فیلدهای تکمیلی چک صیادی */}
            <div className="check-fields-box" id="checkFieldsBox" style={{ display: checkNum > 0 ? 'flex' : 'none' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700 }}>شماره چک / شناسه صیادی (۱۶ رقمی):</label>
                <input
                  type="text"
                  inputMode="numeric"
                  id="checkNumberInput"
                  placeholder="۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶"
                  value={checkNo}
                  onChange={(e) => setCheckNo(e.target.value)}
                  style={{ height: '38px', borderRadius: '8px', border: '1px solid var(--border)', padding: '0 10px', fontFamily: 'inherit', fontSize: '12px' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700 }}>نام بانک صادرکننده:</label>
                <input
                  type="text"
                  id="checkBankInput"
                  placeholder="مثلاً: بانک ملی شعبه مرکزی"
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                  style={{ height: '38px', borderRadius: '8px', border: '1px solid var(--border)', padding: '0 10px', fontFamily: 'inherit', fontSize: '12px' }}
                />
              </div>

              {/* انتخاب‌گر تاریخ شمسی به ترتیب روز، ماه، سال */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700 }}>تاریخ سررسید چک (روز / ماه / سال):</label>
                <div className="persian-date-group">
                  <select className="p-date-select day" id="persianDaySelect" value={due.d} onChange={(e) => setDue({ ...due, d: Number(e.target.value) })}>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>{toPersianNum(d)}</option>
                    ))}
                  </select>
                  <select className="p-date-select month" id="persianMonthSelect" value={due.m} onChange={(e) => setDue({ ...due, m: Number(e.target.value) })}>
                    {JALALI_MONTHS.map((m, idx) => (
                      <option key={m} value={idx + 1}>{m}</option>
                    ))}
                  </select>
                  <select className="p-date-select year" id="persianYearSelect" value={due.y} onChange={(e) => setDue({ ...due, y: Number(e.target.value) })}>
                    {years.map((y) => (
                      <option key={y} value={y}>{toPersianNum(y)}</option>
                    ))}
                  </select>
                </div>
                <div className="due-pills-row">
                  <button type="button" className="due-pill" onClick={() => setCheckDueDaysPersian(15)}>+۱۵ روزه</button>
                  <button type="button" className="due-pill" onClick={() => setCheckDueDaysPersian(30)}>+۳۰ روزه (۱ ماه)</button>
                  <button type="button" className="due-pill" onClick={() => setCheckDueDaysPersian(45)}>+۴۵ روزه</button>
                  <button type="button" className="due-pill" onClick={() => setCheckDueDaysPersian(60)}>+۶۰ روزه (۲ ماه)</button>
                </div>
              </div>
            </div>
          </div>

          {/* ۴. نسیه (مانده در دفتر حساب) */}
          <div className="pay-card">
            <div className="pay-card-header">
              <div className="pay-card-title credit">
                <span className="material-symbols-outlined">pending_actions</span>
                <span>نسیه (مانده در دفتر حساب)</span>
              </div>
              <button type="button" className="quick-btn" onClick={() => quickFillMethod('credit')}>تمام مبلغ نسیه</button>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
              <span>مانده تسویه‌نشده خودکار در بدهی مشتری ثبت می‌شود:</span>
              <strong id="creditAutoAmount" style={{ color: '#ea580c', fontSize: '13px' }}>
                {credit > 0 ? fp(credit) : '۰ تومان (تسویه کامل)'}
              </strong>
            </div>
          </div>
        </section>

        {/* ۵. دکمه ثبت نهایی زیر تمام بخش‌ها */}
        <div className="submit-order-box">
          <button type="button" className="submit-order-btn" id="submitOrderBtn" disabled={submitting} onClick={openFinalConfirmModal}>
            {submitting ? (
              <>
                <span className="material-symbols-outlined">hourglass_empty</span>
                <span>در حال ثبت نهایی فاکتور...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined">check_circle</span>
                <span>ثبت نهایی سفارش و صدور فاکتور</span>
              </>
            )}
          </button>
        </div>
      </main>

      {/* مدال تایید نهایی قبل از صدور فاکتور */}
      <div className="modal-overlay" id="finalConfirmModal" style={{ display: confirm ? 'flex' : 'none' }} onClick={(e) => { if (e.target === e.currentTarget) setConfirm(false); }}>
        <div className="confirm-pay-sheet">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 800, margin: 0 }}>تایید نهایی صدور فاکتور</h3>
            <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setConfirm(false)}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className="confirm-recap-box">
            <div className="confirm-recap-row">
              <span>مشتری:</span>
              <strong id="recapCustName">{draft.customerName || 'مشتری'}</strong>
            </div>
            <div className="confirm-recap-row">
              <span>جمع ناخالص:</span>
              <strong id="recapSubtotal">{fp(subtotal)}</strong>
            </div>
            <div className="confirm-recap-row">
              <span>مجموع تخفیف:</span>
              <strong id="recapDiscount" style={{ color: '#ea580c' }}>{discountModalText}</strong>
            </div>
            <div className="confirm-recap-row highlight">
              <span>مبلغ نهایی فاکتور:</span>
              <strong id="recapFinal">{fp(finalAmount)}</strong>
            </div>
            <div className="confirm-recap-row" style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>نحوه تسویه:</span>
              <span id="recapPayments">{paySplitText.join(' | ') || 'نسیه'}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
            <button type="button" className="submit-order-btn" style={{ height: '44px', fontSize: '13.5px' }} disabled={submitting} onClick={executeOrderSubmission}>
              <span className="material-symbols-outlined">verified</span>
              <span>بله، ثبت فاکتور و صدور پرینت</span>
            </button>
            <button type="button" className="confirm-cancel-btn" style={{ height: '38px' }} onClick={() => setConfirm(false)}>
              انصراف و ویرایش
            </button>
          </div>
        </div>
      </div>

      {/* مدال پرینت فاکتور حرارتی ۸۰ میلی‌متری */}
      <div className="invoice-modal-overlay" id="invoiceModal" style={{ display: receipt ? 'flex' : 'none' }}>
        <div className="thermal-invoice-container">
          <div className="thermal-invoice-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-symbols-outlined">receipt</span>
              <h3 style={{ fontSize: '15px', margin: 0 }}>فاکتور فروش صادر شد</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }} onClick={() => go('dash')}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className="thermal-receipt-paper" id="thermalReceiptPaper">
            {receipt && (
              <ThermalReceipt draft={draft} items={draftItems} discounts={calc.steps} totalDiscount={totalDiscount} subtotal={subtotal} finalAmount={finalAmount} cash={cashNum} pos={posNum} check={checkNum} credit={credit} checkNo={checkNo} bank={bank} invoiceNum={receipt.num} dueStr={receipt.dueStr} />
            )}
          </div>

          <div className="thermal-modal-actions">
            <button type="button" className="print-receipt-btn" onClick={() => window.print()}>
              <span className="material-symbols-outlined">print</span>
              <span>چاپ فاکتور حرارتی (۸۰mm)</span>
            </button>
            <button type="button" className="close-receipt-btn" onClick={() => go('dash')}>
              <span>بازگشت به داشبورد ویزیتور</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** برگه فاکتور حرارتی — عین renderThermalReceipt در payment.js */
function ThermalReceipt({ draft, items, discounts, totalDiscount, subtotal, finalAmount, cash, pos, check, credit, checkNo, bank, invoiceNum, dueStr }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('fa-IR');
  const timeStr = now.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      <div className="receipt-center">
        <div className="receipt-title">🍦 فاکتور رسمی فروش — ویزیتیک</div>
        <div className="receipt-sub">سامانه توزیع گرم بستنی میهن و پاندا</div>
      </div>
      <div className="receipt-divider"></div>
      <div className="receipt-row">
        <span>شماره فاکتور:</span>
        <strong>
          #<span className="invoice-num">{toPersianNum(invoiceNum)}</span>
        </strong>
      </div>
      <div className="receipt-row">
        <span>مشتری / فروشگاه:</span>
        <strong>{draft.customerName || 'مشتری'}</strong>
      </div>
      <div className="receipt-row">
        <span>تاریخ و زمان صدور:</span>
        <span>{toPersianNum(dateStr)} - ساعت {toPersianNum(timeStr)}</span>
      </div>
      <div className="receipt-divider"></div>
      <div style={{ fontWeight: 800, marginBottom: '4px', fontSize: '11px' }}>اقلام تحویل داده شده:</div>
      {items.map((item, idx) => {
        let qtyText = '';
        if (item.cartonCount > 0 && item.unitCount > 0) {
          qtyText = `${toPersianNum(item.cartonCount)} کارتن + ${toPersianNum(item.unitCount)} دانه`;
        } else if (item.cartonCount > 0) {
          qtyText = `${toPersianNum(item.cartonCount)} کارتن`;
        } else {
          qtyText = `${toPersianNum(item.unitCount)} دانه`;
        }
        return (
          <div key={item.productId || idx} style={{ padding: '4px 0', borderBottom: '1px dotted #cbd5e1' }}>
            <div style={{ fontWeight: 800, display: 'flex', justifyContent: 'space-between' }}>
              <span>{toPersianNum(idx + 1)}. {item.name}</span>
              <strong>{fp(item.lineTotal || 0)}</strong>
            </div>
            <div style={{ fontSize: '10px', color: '#475569', display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
              <span>تعداد: {qtyText}</span>
              <span>فی دانه: {toPersianNum(Math.round(item.unitPrice || 0).toLocaleString('en-US'))} ت</span>
            </div>
          </div>
        );
      })}
      <div className="receipt-divider"></div>
      <div className="receipt-row">
        <span>جمع کل ناخالص:</span>
        <span>{fp(subtotal)}</span>
      </div>
      {discounts.length > 0 && (
        <>
          {discounts.map((d, idx) => (
            <div className="receipt-row" style={{ color: '#c2410c', margin: '1px 0' }} key={d.id || idx}>
              <span>{d.type === 'percent' ? `تخفیف پله ${toPersianNum(idx + 1)} (${toPersianNum(d.value)}٪):` : `تخفیف نقدی پله ${toPersianNum(idx + 1)}:`}</span>
              <span>-{fp(d.calculatedAmount)}</span>
            </div>
          ))}
          <div className="receipt-row" style={{ fontWeight: 800, borderTop: '1px dotted #cbd5e1', paddingTop: '2px' }}>
            <span>مجموع تخفیف‌ها:</span>
            <span>-{fp(totalDiscount)}</span>
          </div>
        </>
      )}
      <div className="receipt-row" style={{ fontSize: '13.5px', fontWeight: 900, marginTop: '4px', color: 'var(--primary)' }}>
        <span>مبلغ نهایی فاکتور:</span>
        <span>{fp(finalAmount)}</span>
      </div>
      <div className="receipt-divider"></div>
      <div style={{ fontWeight: 800, marginBottom: '4px', fontSize: '11px' }}>نحوه تسویه و پرداخت:</div>
      {cash > 0 && (
        <div className="receipt-row">
          <span>نقدی:</span>
          <strong>{fp(cash)}</strong>
        </div>
      )}
      {pos > 0 && (
        <div className="receipt-row">
          <span>کارتخوان / پوز:</span>
          <strong>{fp(pos)}</strong>
        </div>
      )}
      {check > 0 && (
        <>
          <div className="receipt-row">
            <span>چک صیادی ({toPersianNum(bank || 'بانک')} - سررسید {toPersianNum(dueStr)}):</span>
            <strong>{fp(check)}</strong>
          </div>
          <div className="receipt-row" style={{ fontSize: '10px', color: '#475569' }}>
            <span>شناسه صیادی:</span>
            <span>{toPersianNum(checkNo || '---')}</span>
          </div>
        </>
      )}
      {credit > 0 && (
        <div className="receipt-row" style={{ fontWeight: 900, color: '#ea580c' }}>
          <span>مانده در دفتر حساب (نسیه):</span>
          <strong>{fp(credit)}</strong>
        </div>
      )}
      <div className="receipt-divider"></div>
      <div className="receipt-center" style={{ fontSize: '10px', marginTop: '6px', lineHeight: 1.5 }}>
        با سپاس از خرید و همکاری شما<br />
        نرم‌افزار توزیع و حسابداری ویزیتیک
      </div>
    </>
  );
}
