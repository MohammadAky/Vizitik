// ============================================================
// حساب‌چین — لاجیک صفحه پرداخت، تسویه، تخفیفات پلکانی و تایید نهایی (payment.js)
// ============================================================

let currentOrder = null;
let activePaymentMode = 'cash'; // 'cash' | 'pos' | 'check' | 'credit' | 'custom'

let paymentState = {
    cash: 0,
    pos: 0,
    check: 0,
    checkNumber: '',
    bankName: '',
    persianDueDate: '',
    credit: 0,
    discounts: [] // آرایه‌ای از تخفیف‌های پلکانی: { id, type: 'percent'|'fixed', value, calculatedAmount, stepOrder }
};

// تبدیل ارقام به فارسی
function toPersianNum(num) {
    if (num === null || num === undefined) return '';
    const p = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return num.toString().replace(/\d/g, d => p[d]);
}

function formatPrice(amount) {
    const formatted = Math.round(amount || 0).toLocaleString('en-US');
    return toPersianNum(formatted) + ' تومان';
}

// مقداردهی اولیه در لود صفحه
document.addEventListener('DOMContentLoaded', () => {
    const raw = sessionStorage.getItem('hesabchin_current_order');
    if (!raw) {
        window.location.href = 'new-order.php';
        return;
    }

    try {
        currentOrder = JSON.parse(raw);
    } catch (e) {
        window.location.href = 'new-order.php';
        return;
    }

    initPersianDatePicker();
    renderOrderSummary();
    quickFillMethod('cash');
});

// مقداردهی تاریخ شمسی (روز / ماه / سال)
function initPersianDatePicker() {
    const daySelect = document.getElementById('persianDaySelect');
    const monthSelect = document.getElementById('persianMonthSelect');
    const yearSelect = document.getElementById('persianYearSelect');

    if (!daySelect || !monthSelect || !yearSelect) return;

    daySelect.innerHTML = '';
    for (let i = 1; i <= 31; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = toPersianNum(i);
        daySelect.appendChild(opt);
    }

    const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
    monthSelect.innerHTML = '';
    months.forEach((m, idx) => {
        const opt = document.createElement('option');
        opt.value = idx + 1;
        opt.textContent = m;
        monthSelect.appendChild(opt);
    });

    yearSelect.innerHTML = '';
    for (let y = 1405; y <= 1407; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = toPersianNum(y);
        yearSelect.appendChild(opt);
    }

    // پیش‌فرض: امروز
    daySelect.value = 16;
    monthSelect.value = 6;
    yearSelect.value = 1405;
}

function setCheckDueDaysPersian(days) {
    let d = parseInt(document.getElementById('persianDaySelect').value) || 16;
    let m = parseInt(document.getElementById('persianMonthSelect').value) || 6;
    let y = parseInt(document.getElementById('persianYearSelect').value) || 1405;

    d += days;
    while (d > 30) {
        d -= 30;
        m++;
        if (m > 12) {
            m = 1;
            y++;
        }
    }

    document.getElementById('persianDaySelect').value = d;
    document.getElementById('persianMonthSelect').value = m;
    document.getElementById('persianYearSelect').value = y;
}

// رندر خلاصه سفارش
function renderOrderSummary() {
    document.getElementById('sumCustName').textContent = currentOrder.customerName || 'مشتری';
    document.getElementById('sumSubtotalVal').textContent = formatPrice(currentOrder.subtotal);

    const prevDebt = currentOrder.customerDebt || 0;
    const debtRow = document.getElementById('sumPrevDebtRow');
    if (prevDebt > 0) {
        debtRow.style.display = 'flex';
        document.getElementById('sumPrevDebtVal').textContent = formatPrice(prevDebt);
    } else {
        debtRow.style.display = 'none';
    }

    recalcAllCalculations();
}

// فرمت‌بندی ۳ رقم ۳ رقم مبلغ تخفیف هنگام تایپ
function formatFixedDiscountInput(input) {
    let raw = (input.value || '').replace(/[^0-9]/g, '');
    if (!raw) {
        input.value = '';
        return;
    }
    const num = parseInt(raw, 10);
    input.value = num.toLocaleString('en-US');
}

let toastTimeout = null;
function showNotification(msg, type = 'info') {
    const appContainer = document.getElementById('app') || document.querySelector('.app') || document.body;
    let toast = document.getElementById('appToast');
    
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'appToast';
        appContainer.appendChild(toast);
    } else if (toast.parentElement !== appContainer) {
        appContainer.appendChild(toast);
    }

    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }

    let icon = 'info';
    if (type === 'success') icon = 'check_circle';
    if (type === 'error') icon = 'error';
    if (type === 'warning') icon = 'warning';

    toast.className = `app-toast ${type}`;
    toast.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span>${msg}</span>`;
    
    void toast.offsetWidth;
    toast.classList.add('show');

    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3200);
}

// ثبت و اعمال تخفیف از فیلدها و اضافه شدن به لیست زیر هم
function applyDiscountFromInputs() {
    const percentInput = document.getElementById('discountPercentInput');
    const fixedInput = document.getElementById('discountFixedInput');

    const percentVal = parseFloat(percentInput ? percentInput.value : 0) || 0;
    const rawFixed = (fixedInput ? fixedInput.value : '').replace(/[^0-9]/g, '');
    const fixedVal = parseFloat(rawFixed) || 0;

    if (percentVal <= 0 && fixedVal <= 0) {
        showNotification('لطفاً درصد تخفیف یا مبلغ تخفیف را وارد نمایید.', 'warning');
        return;
    }

    if (percentVal > 100) {
        showNotification('درصد تخفیف نمی‌تواند بیشتر از ۱۰۰٪ باشد.', 'error');
        return;
    }

    const subtotal = currentOrder.subtotal || 0;
    if (fixedVal > subtotal) {
        showNotification('مبلغ تخفیف نمی‌تواند بیشتر از مبلغ کل سفارش باشد.', 'error');
        return;
    }

    // اضافه کردن هر تخفیف واردشده به آرایه تخفیف‌های زیر هم
    if (percentVal > 0) {
        paymentState.discounts.push({
            id: 'disc_' + Date.now() + '_p_' + Math.floor(Math.random() * 1000),
            type: 'percent',
            value: percentVal
        });
    }

    if (fixedVal > 0) {
        paymentState.discounts.push({
            id: 'disc_' + Date.now() + '_f_' + Math.floor(Math.random() * 1000),
            type: 'fixed',
            value: fixedVal
        });
    }

    // پاک کردن فیلدهای ورودی
    if (percentInput) percentInput.value = '';
    if (fixedInput) fixedInput.value = '';

    // محاسبه مجدد آنی و به‌روزرسانی ردیف‌ها و مبالغ پرداختی
    recalcAllCalculations();
}

// حذف پله تخفیف خاص از لیست زیر هم
function removeDiscountStep(index) {
    if (index >= 0 && index < paymentState.discounts.length) {
        paymentState.discounts.splice(index, 1);
        recalcAllCalculations();
    }
}

// محاسبه مجدد تخفیف‌های پلکانی، مبلغ نهایی، و همگام‌سازی آنی ورودی‌های تسویه
function recalcAllCalculations() {
    const subtotal = currentOrder.subtotal || 0;
    let currentAmount = subtotal;
    let totalDiscount = 0;

    // محاسبه پلکانی هر یک از تخفیفات
    paymentState.discounts.forEach((disc, idx) => {
        let stepDiscount = 0;
        if (disc.type === 'percent') {
            stepDiscount = Math.round((currentAmount * disc.value) / 100);
        } else if (disc.type === 'fixed') {
            stepDiscount = Math.min(currentAmount, disc.value);
        }
        disc.stepOrder = idx + 1;
        disc.amountBefore = currentAmount;
        disc.calculatedAmount = stepDiscount;
        currentAmount -= stepDiscount;
        disc.amountAfter = currentAmount;
        totalDiscount += stepDiscount;
    });

    const finalAmount = Math.max(0, Math.round(currentAmount));
    currentOrder.finalAmount = finalAmount;
    currentOrder.totalDiscount = totalDiscount;

    // رندر بصری لیست تخفیفات زیر هم همراه با دکمه حذف برای هر ردیف
    const wrapper = document.getElementById('appliedDiscountsWrapper');
    const list = document.getElementById('appliedDiscountsList');
    const totalElem = document.getElementById('appliedDiscountsTotal');

    if (paymentState.discounts.length > 0) {
        if (wrapper) wrapper.style.display = 'flex';
        if (list) {
            list.innerHTML = '';
            paymentState.discounts.forEach((disc, idx) => {
                const row = document.createElement('div');
                row.className = 'applied-discount-line';

                let stepTitle = `پله ${toPersianNum(idx + 1)}`;
                let descText = '';
                if (disc.type === 'percent') {
                    descText = `تخفیف درصدی: ${toPersianNum(disc.value)}٪ (-${formatPrice(disc.calculatedAmount)})`;
                } else {
                    descText = `تخفیف نقدی: ${toPersianNum(disc.value.toLocaleString('en-US'))} تومان (-${formatPrice(disc.calculatedAmount)})`;
                }

                row.innerHTML = `
                    <div class="applied-discount-info">
                        <span class="discount-step-num">${stepTitle}</span>
                        <span class="material-symbols-outlined discount-tag-icon">sell</span>
                        <span class="applied-discount-text">${descText}</span>
                    </div>
                    <button type="button" class="remove-discount-btn" onclick="removeDiscountStep(${idx})" title="حذف این پله تخفیف">
                        <span class="material-symbols-outlined">delete</span>
                        <span>حذف</span>
                    </button>
                `;
                list.appendChild(row);
            });
        }

        if (totalElem) {
            totalElem.innerHTML = `
                <span>مجموع کل تخفیفات اعمال‌شده (${toPersianNum(paymentState.discounts.length)} پله):</span>
                <strong style="color: #ea580c; font-size: 13px;">-${formatPrice(totalDiscount)}</strong>
            `;
        }
    } else {
        if (wrapper) wrapper.style.display = 'none';
        if (list) list.innerHTML = '';
    }

    // به‌روزرسانی نمایشگر مبلغ نهایی فاکتور
    const finalElem = document.getElementById('finalPayableAmount');
    if (finalElem) finalElem.textContent = formatPrice(finalAmount);

    // همگام‌سازی آنی ورودی روش پرداخت فعال با مبلغ نهایی جدید
    syncActivePaymentInputsWithNewFinal(finalAmount);
}

// همگام‌سازی آنی مقدار ورودی‌های پرداخت متناسب با مبلغ خالص جدید فاکتور
function syncActivePaymentInputsWithNewFinal(finalAmount) {
    const cashInput = document.getElementById('cashInput');
    const posInput = document.getElementById('posInput');
    const checkInput = document.getElementById('checkInput');

    if (activePaymentMode === 'cash') {
        paymentState.cash = finalAmount;
        paymentState.pos = 0;
        paymentState.check = 0;
        paymentState.credit = 0;
        if (cashInput) cashInput.value = finalAmount > 0 ? finalAmount.toLocaleString('en-US') : '';
        if (posInput) posInput.value = '';
        if (checkInput) checkInput.value = '';
    } else if (activePaymentMode === 'pos') {
        paymentState.pos = finalAmount;
        paymentState.cash = 0;
        paymentState.check = 0;
        paymentState.credit = 0;
        if (posInput) posInput.value = finalAmount > 0 ? finalAmount.toLocaleString('en-US') : '';
        if (cashInput) cashInput.value = '';
        if (checkInput) checkInput.value = '';
    } else if (activePaymentMode === 'check') {
        paymentState.check = finalAmount;
        paymentState.cash = 0;
        paymentState.pos = 0;
        paymentState.credit = 0;
        if (checkInput) checkInput.value = finalAmount > 0 ? finalAmount.toLocaleString('en-US') : '';
        if (cashInput) cashInput.value = '';
        if (posInput) posInput.value = '';
    } else if (activePaymentMode === 'credit') {
        paymentState.cash = 0;
        paymentState.pos = 0;
        paymentState.check = 0;
        paymentState.credit = finalAmount;
        if (cashInput) cashInput.value = '';
        if (posInput) posInput.value = '';
        if (checkInput) checkInput.value = '';
    } else {
        // حالت چندحالته دستی: اگر مجموع پرداختی‌ها از مبلغ نهایی بیشتر شده بود، تراز شود
        const totalPaid = paymentState.cash + paymentState.pos + paymentState.check;
        if (totalPaid > finalAmount) {
            // کسر اضافه از پرداخت نقدی یا پوز
            if (paymentState.cash >= (totalPaid - finalAmount)) {
                paymentState.cash -= (totalPaid - finalAmount);
                if (cashInput) cashInput.value = paymentState.cash > 0 ? paymentState.cash.toLocaleString('en-US') : '';
            } else {
                paymentState.cash = 0;
                if (cashInput) cashInput.value = '';
                paymentState.pos = Math.min(paymentState.pos, finalAmount);
                if (posInput) posInput.value = paymentState.pos > 0 ? paymentState.pos.toLocaleString('en-US') : '';
            }
        }
    }

    recalcPaymentSplit();
}

// پر کردن سریع مبالغ با انتخاب یک دکمه
function quickFillMethod(method) {
    activePaymentMode = method;
    const finalAmount = currentOrder ? (currentOrder.finalAmount || 0) : 0;

    paymentState.cash = 0;
    paymentState.pos = 0;
    paymentState.check = 0;
    paymentState.credit = 0;

    const cashInput = document.getElementById('cashInput');
    const posInput = document.getElementById('posInput');
    const checkInput = document.getElementById('checkInput');
    const checkFields = document.getElementById('checkFieldsBox');

    if (cashInput) cashInput.value = '';
    if (posInput) posInput.value = '';
    if (checkInput) checkInput.value = '';
    if (checkFields) checkFields.style.display = 'none';

    if (method === 'cash') {
        paymentState.cash = finalAmount;
        if (cashInput) cashInput.value = finalAmount > 0 ? finalAmount.toLocaleString('en-US') : '';
    } else if (method === 'pos') {
        paymentState.pos = finalAmount;
        if (posInput) posInput.value = finalAmount > 0 ? finalAmount.toLocaleString('en-US') : '';
    } else if (method === 'check') {
        paymentState.check = finalAmount;
        if (checkInput) checkInput.value = finalAmount > 0 ? finalAmount.toLocaleString('en-US') : '';
        if (checkFields) checkFields.style.display = 'flex';
    } else if (method === 'credit') {
        paymentState.credit = finalAmount;
    }

    recalcPaymentSplit();
}

// واکنش به تغییر دستی مبالغ پرداخت در فیلدها
function onPaymentInputChanged(method) {
    activePaymentMode = 'custom';

    const cashInput = document.getElementById('cashInput');
    const posInput = document.getElementById('posInput');
    const checkInput = document.getElementById('checkInput');

    paymentState.cash = parseFloat((cashInput.value || '').replace(/[^0-9]/g, '')) || 0;
    paymentState.pos = parseFloat((posInput.value || '').replace(/[^0-9]/g, '')) || 0;
    paymentState.check = parseFloat((checkInput.value || '').replace(/[^0-9]/g, '')) || 0;

    if (method === 'cash' && paymentState.cash > 0) cashInput.value = paymentState.cash.toLocaleString('en-US');
    if (method === 'pos' && paymentState.pos > 0) posInput.value = paymentState.pos.toLocaleString('en-US');
    if (method === 'check' && paymentState.check > 0) checkInput.value = paymentState.check.toLocaleString('en-US');

    const checkFields = document.getElementById('checkFieldsBox');
    if (paymentState.check > 0) {
        if (checkFields) checkFields.style.display = 'flex';
    } else {
        if (checkFields) checkFields.style.display = 'none';
    }

    recalcPaymentSplit();
}

// محاسبه تقسیم مبالغ و مانده نسیه
function recalcPaymentSplit() {
    const finalAmount = currentOrder ? (currentOrder.finalAmount || 0) : 0;
    const paidSum = paymentState.cash + paymentState.pos + paymentState.check;
    const remaining = Math.max(0, finalAmount - paidSum);
    paymentState.credit = remaining;

    const balanceCard = document.getElementById('finalBalanceCard');
    const balanceStatus = document.getElementById('paymentStatusText');
    const creditPill = document.getElementById('creditAutoAmount');

    if (creditPill) creditPill.textContent = remaining > 0 ? formatPrice(remaining) : '۰ تومان (تسویه کامل)';

    if (remaining === 0) {
        if (balanceCard) balanceCard.className = 'final-balance-card settled';
        if (balanceStatus) balanceStatus.innerHTML = '<span style="color:#15803d;">تسویه کامل نقدی و بانکی</span>';
    } else {
        if (balanceCard) balanceCard.className = 'final-balance-card';
        if (balanceStatus) balanceStatus.innerHTML = `<span style="color:#ea580c;">مانده در دفتر حساب (نسیه): ${formatPrice(remaining)}</span>`;
    }
}

// باز کردن مدال تایید قبل از ثبت
function openFinalConfirmModal() {
    document.getElementById('recapCustName').textContent = currentOrder.customerName || 'مشتری';
    document.getElementById('recapSubtotal').textContent = formatPrice(currentOrder.subtotal);
    
    let discountModalText = '۰ تومان';
    if (currentOrder.totalDiscount > 0) {
        discountModalText = `-${formatPrice(currentOrder.totalDiscount)} (${toPersianNum(paymentState.discounts.length)} پله)`;
    }
    document.getElementById('recapDiscount').textContent = discountModalText;
    document.getElementById('recapFinal').textContent = formatPrice(currentOrder.finalAmount);

    let paySplitText = [];
    if (paymentState.cash > 0) paySplitText.push(`نقد: ${formatPrice(paymentState.cash)}`);
    if (paymentState.pos > 0) paySplitText.push(`پوز: ${formatPrice(paymentState.pos)}`);
    if (paymentState.check > 0) paySplitText.push(`چک: ${formatPrice(paymentState.check)}`);
    if (paymentState.credit > 0) paySplitText.push(`نسیه: ${formatPrice(paymentState.credit)}`);

    document.getElementById('recapPayments').textContent = paySplitText.join(' | ') || 'نسیه';

    document.getElementById('finalConfirmModal').style.display = 'flex';
}

function closeFinalConfirmModal() {
    document.getElementById('finalConfirmModal').style.display = 'none';
}

// ثبت نهایی سفارش در سرور و پرینت فاکتور حرارتی
async function executeOrderSubmission() {
    closeFinalConfirmModal();

    const btn = document.getElementById('submitOrderBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span><span>در حال ثبت نهایی فاکتور...</span>';

    const localUuid = 'ord_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    const itemsPayload = Object.values(currentOrder.items || {}).map(item => ({
        productId: item.productId || 'p-1',
        cartonCount: item.cartonCount || 0,
        unitCount: item.unitCount || 0
    }));

    const d = document.getElementById('persianDaySelect').value;
    const m = document.getElementById('persianMonthSelect').value;
    const y = document.getElementById('persianYearSelect').value;
    const persianDueDateStr = `${y}/${m}/${d}`;

    const paymentsPayload = [];
    if (paymentState.cash > 0) paymentsPayload.push({ method: 'CASH', amount: paymentState.cash });
    if (paymentState.pos > 0) paymentsPayload.push({ method: 'CARD', amount: paymentState.pos });
    if (paymentState.check > 0) {
        paymentsPayload.push({
            method: 'CHECK',
            amount: paymentState.check,
            checkDetails: {
                checkNumber: document.getElementById('checkNumberInput').value || '۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶',
                bankName: document.getElementById('checkBankInput').value || 'بانک ملی',
                dueDate: new Date().toISOString()
            }
        });
    }

    const discountPercentages = paymentState.discounts
        .filter(d => d.type === 'percent')
        .map(d => d.value);

    const fixedDiscountAmount = paymentState.discounts
        .filter(d => d.type === 'fixed')
        .reduce((sum, d) => sum + d.value, 0);

    const payload = {
        localUuid,
        customerId: currentOrder.customerId || 'sample-id',
        items: itemsPayload,
        discountPercentages,
        fixedDiscountAmount,
        payments: paymentsPayload
    };

    try {
        await fetch('http://localhost:3000/api/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${API_TOKEN}`
            },
            body: JSON.stringify(payload)
        }).catch(() => {});
    } catch (e) {}

    sessionStorage.removeItem('hesabchin_current_order');
    renderThermalReceipt(payload, localUuid, persianDueDateStr);
    document.getElementById('invoiceModal').style.display = 'flex';
}

// ساخت برگه فاکتور حرارتی ۸۰ میلی‌متری
function renderThermalReceipt(orderData, invoiceNum, persianDueDateStr) {
    const paper = document.getElementById('thermalReceiptPaper');
    const now = new Date();
    const dateStr = now.toLocaleDateString('fa-IR');
    const timeStr = now.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

    let itemsHtml = '';
    const items = Object.values(currentOrder.items || {});
    items.forEach((item, idx) => {
        let qtyText = '';
        if (item.cartonCount > 0 && item.unitCount > 0) {
            qtyText = `${toPersianNum(item.cartonCount)} کارتن + ${toPersianNum(item.unitCount)} دانه`;
        } else if (item.cartonCount > 0) {
            qtyText = `${toPersianNum(item.cartonCount)} کارتن`;
        } else {
            qtyText = `${toPersianNum(item.unitCount)} دانه`;
        }

        itemsHtml += `
            <div style="padding: 4px 0; border-bottom: 1px dotted #cbd5e1;">
                <div style="font-weight: 800; display:flex; justify-content:space-between;">
                    <span>${toPersianNum(idx + 1)}. ${item.name}</span>
                    <strong>${formatPrice(item.lineTotal || 0)}</strong>
                </div>
                <div style="font-size: 10px; color: #475569; display:flex; justify-content:space-between; margin-top: 2px;">
                    <span>تعداد: ${qtyText}</span>
                    <span>فی دانه: ${toPersianNum(Math.round(item.unitPrice || 0).toLocaleString('en-US'))} ت</span>
                </div>
            </div>
        `;
    });

    let discountsHtml = '';
    if (paymentState.discounts && paymentState.discounts.length > 0) {
        paymentState.discounts.forEach((d, idx) => {
            const stepLabel = d.type === 'percent' ? `تخفیف پله ${toPersianNum(idx + 1)} (${toPersianNum(d.value)}٪):` : `تخفیف نقدی پله ${toPersianNum(idx + 1)}:`;
            discountsHtml += `
                <div class="receipt-row" style="color: #c2410c; margin: 1px 0;">
                    <span>${stepLabel}</span>
                    <span>-${formatPrice(d.calculatedAmount)}</span>
                </div>
            `;
        });
        discountsHtml += `
            <div class="receipt-row" style="font-weight: 800; border-top: 1px dotted #cbd5e1; padding-top: 2px;">
                <span>مجموع تخفیف‌ها:</span>
                <span>-${formatPrice(currentOrder.totalDiscount)}</span>
            </div>
        `;
    }

    let paymentsHtml = '';
    if (paymentState.cash > 0) paymentsHtml += `<div class="receipt-row"><span>نقدی:</span><strong>${formatPrice(paymentState.cash)}</strong></div>`;
    if (paymentState.pos > 0) paymentsHtml += `<div class="receipt-row"><span>کارتخوان / پوز:</span><strong>${formatPrice(paymentState.pos)}</strong></div>`;
    if (paymentState.check > 0) {
        const chkNum = document.getElementById('checkNumberInput') ? document.getElementById('checkNumberInput').value || '---' : '---';
        const chkBank = document.getElementById('checkBankInput') ? document.getElementById('checkBankInput').value || 'بانک' : 'بانک';
        paymentsHtml += `
            <div class="receipt-row">
                <span>چک صیادی (${toPersianNum(chkBank)} - سررسید ${toPersianNum(persianDueDateStr)}):</span>
                <strong>${formatPrice(paymentState.check)}</strong>
            </div>
            <div class="receipt-row" style="font-size: 10px; color: #475569;">
                <span>شناسه صیادی:</span>
                <span>${toPersianNum(chkNum)}</span>
            </div>
        `;
    }
    if (paymentState.credit > 0) paymentsHtml += `<div class="receipt-row" style="font-weight:900; color:#ea580c;"><span>مانده در دفتر حساب (نسیه):</span><strong>${formatPrice(paymentState.credit)}</strong></div>`;

    paper.innerHTML = `
        <div class="receipt-center">
            <div class="receipt-title">🍦 فاکتور رسمی فروش — حساب‌چین</div>
            <div class="receipt-sub">سامانه توزیع گرم بستنی میهن و پاندا</div>
        </div>
        <div class="receipt-divider"></div>
        <div class="receipt-row">
            <span>شماره فاکتور:</span>
            <strong>#${toPersianNum(invoiceNum.substring(0, 10).toUpperCase())}</strong>
        </div>
        <div class="receipt-row">
            <span>مشتری / فروشگاه:</span>
            <strong>${currentOrder.customerName || 'مشتری'}</strong>
        </div>
        <div class="receipt-row">
            <span>تاریخ و زمان صدور:</span>
            <span>${toPersianNum(dateStr)} - ساعت ${toPersianNum(timeStr)}</span>
        </div>
        <div class="receipt-divider"></div>
        <div style="font-weight: 800; margin-bottom: 4px; font-size: 11px;">اقلام تحویل داده شده:</div>
        ${itemsHtml}
        <div class="receipt-divider"></div>
        <div class="receipt-row">
            <span>جمع کل ناخالص:</span>
            <span>${formatPrice(currentOrder.subtotal)}</span>
        </div>
        ${discountsHtml}
        <div class="receipt-row" style="font-size: 13.5px; font-weight: 900; margin-top: 4px; color: var(--primary);">
            <span>مبلغ نهایی فاکتور:</span>
            <span>${formatPrice(currentOrder.finalAmount)}</span>
        </div>
        <div class="receipt-divider"></div>
        <div style="font-weight: 800; margin-bottom: 4px; font-size: 11px;">نحوه تسویه و پرداخت:</div>
        ${paymentsHtml}
        <div class="receipt-divider"></div>
        <div class="receipt-center" style="font-size: 10px; margin-top: 6px; line-height: 1.5;">
            با سپاس از خرید و همکاری شما<br>
            نرم‌افزار توزیع و حسابداری حساب‌چین
        </div>
    `;
}

function printThermalReceipt() {
    window.print();
}

function finishAndGoToDashboard() {
    window.location.href = 'dashboard.php';
}

function handleSafeBackFromPayment(e) {
    if (!confirm('آیا از بازگشت به صفحه انتخاب اقلام اطمینان دارید؟')) {
        e.preventDefault();
        return false;
    }
    return true;
}
