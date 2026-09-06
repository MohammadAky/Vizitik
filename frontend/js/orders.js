// ============================================================
// حساب‌چین — اسکریپت مدیریت و اصلاح فاکتورها (orders.js)
// ============================================================

let currentEditOrderId = null;
let currentEditFinalAmount = 0;

function toPersianNum(num) {
    if (num === null || num === undefined) return '';
    const p = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return num.toString().replace(/\d/g, d => p[d]);
}

function formatPrice(amount) {
    const formatted = Math.round(amount || 0).toLocaleString('en-US');
    return toPersianNum(formatted) + ' تومان';
}

function filterOrdersList() {
    const query = (document.getElementById('orderSearchInput').value || '').trim().toLowerCase();
    const cards = document.querySelectorAll('.order-card');

    cards.forEach(card => {
        const cust = (card.dataset.customer || '').toLowerCase();
        const inv = (card.dataset.inv || '').toLowerCase();

        if (!query || cust.includes(query) || inv.includes(query)) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });
}

function openEditPaymentsModal(orderId, custName, finalAmount) {
    currentEditOrderId = orderId;
    currentEditFinalAmount = finalAmount;

    document.getElementById('editCustSubtitle').textContent = `مشتری: ${custName}`;
    document.getElementById('editFinalAmountDisplay').textContent = formatPrice(finalAmount);

    document.getElementById('editCashInput').value = '';
    document.getElementById('editPosInput').value = '';
    document.getElementById('editCheckInput').value = '';
    document.getElementById('editCheckInfoBox').style.display = 'none';

    onEditSplitChanged();
    document.getElementById('editPaymentsModal').style.display = 'flex';
}

function closeEditPaymentsModal() {
    document.getElementById('editPaymentsModal').style.display = 'none';
}

function onEditSplitChanged() {
    const cashVal = parseFloat((document.getElementById('editCashInput').value || '').replace(/[^0-9]/g, '')) || 0;
    const posVal = parseFloat((document.getElementById('editPosInput').value || '').replace(/[^0-9]/g, '')) || 0;
    const checkVal = parseFloat((document.getElementById('editCheckInput').value || '').replace(/[^0-9]/g, '')) || 0;

    if (cashVal > 0) document.getElementById('editCashInput').value = cashVal.toLocaleString('en-US');
    if (posVal > 0) document.getElementById('editPosInput').value = posVal.toLocaleString('en-US');
    if (checkVal > 0) document.getElementById('editCheckInput').value = checkVal.toLocaleString('en-US');

    document.getElementById('editCheckInfoBox').style.display = checkVal > 0 ? 'flex' : 'none';

    const paidSum = cashVal + posVal + checkVal;
    const remainingCredit = Math.max(0, currentEditFinalAmount - paidSum);

    document.getElementById('editCreditRemaining').textContent = remainingCredit > 0 ? formatPrice(remainingCredit) : '۰ تومان (تسویه کامل)';
}

async function saveEditedPayments() {
    if (!currentEditOrderId) return;

    const cashVal = parseFloat((document.getElementById('editCashInput').value || '').replace(/[^0-9]/g, '')) || 0;
    const posVal = parseFloat((document.getElementById('editPosInput').value || '').replace(/[^0-9]/g, '')) || 0;
    const checkVal = parseFloat((document.getElementById('editCheckInput').value || '').replace(/[^0-9]/g, '')) || 0;

    const paymentsPayload = [];
    if (cashVal > 0) paymentsPayload.push({ method: 'CASH', amount: cashVal });
    if (posVal > 0) paymentsPayload.push({ method: 'CARD', amount: posVal });
    if (checkVal > 0) {
        paymentsPayload.push({
            method: 'CHECK',
            amount: checkVal,
            checkDetails: {
                checkNumber: document.getElementById('editCheckNumber').value || '---',
                bankName: document.getElementById('editCheckBank').value || 'بانک',
                dueDate: new Date().toISOString()
            }
        });
    }

    try {
        const res = await fetch(`http://localhost:3000/api/orders/${currentEditOrderId}/payments`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_TOKEN}`
            },
            body: JSON.stringify({ payments: paymentsPayload })
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            alert('روش‌های تسویه فاکتور با موفقیت اصلاح و در دفتر حساب مشتری به‌روزرسانی شد.');
            closeEditPaymentsModal();
            window.location.reload();
        } else {
            alert(data.message || 'خطا در ویرایش تسویه فاکتور.');
        }
    } catch (e) {
        alert('خطا در برقراری ارتباط با سرور.');
    }
}

async function fetchAndPrintInvoice(orderId) {
    try {
        const res = await fetch(`http://localhost:3000/api/orders/${orderId}/invoice`, {
            headers: {
                'Authorization': `Bearer ${API_TOKEN}`
            }
        });

        if (!res.ok) {
            alert('دریافت اطلاعات فاکتور با خطا مواجه شد.');
            return;
        }

        const inv = await res.json();
        renderThermalPaper(inv);
        document.getElementById('invoiceModal').style.display = 'flex';
    } catch (e) {
        alert('خطا در ارتباط با سرور.');
    }
}

function renderThermalPaper(inv) {
    const paper = document.getElementById('thermalReceiptPaper');
    const orderDate = new Date(inv.orderDate || Date.now());
    const dateStr = orderDate.toLocaleDateString('fa-IR');
    const timeStr = orderDate.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

    let itemsHtml = '';
    (inv.items || []).forEach(item => {
        let qtyText = '';
        if (item.cartonCount > 0 && item.unitCount > 0) {
            qtyText = `${toPersianNum(item.cartonCount)}ک + ${toPersianNum(item.unitCount)}د`;
        } else if (item.cartonCount > 0) {
            qtyText = `${toPersianNum(item.cartonCount)}کارتن`;
        } else {
            qtyText = `${toPersianNum(item.unitCount)}دانه`;
        }

        itemsHtml += `
            <div class="receipt-row">
                <span>${item.productName} (${qtyText})</span>
                <strong>${formatPrice(item.lineTotal)}</strong>
            </div>
        `;
    });

    let discountsHtml = '';
    if (inv.pricing && inv.pricing.totalDiscount > 0) {
        if (inv.pricing.discountSteps && inv.pricing.discountSteps.length > 0) {
            inv.pricing.discountSteps.forEach((step, idx) => {
                const diff = (step.before - step.after);
                discountsHtml += `
                    <div class="receipt-row" style="color:#c2410c; font-size:10.5px;">
                        <span>تخفیف پله ${toPersianNum(idx+1)} (${toPersianNum(step.percent)}٪):</span>
                        <span>-${formatPrice(diff)}</span>
                    </div>
                `;
            });
        }
        discountsHtml += `
            <div class="receipt-row" style="font-weight: bold; margin-top:2px;">
                <span>مجموع تخفیف‌ها:</span>
                <span>-${formatPrice(inv.pricing.totalDiscount)}</span>
            </div>
        `;
    }

    let paymentsHtml = '';
    let totalPaid = 0;
    (inv.payments || []).forEach(p => {
        totalPaid += p.amount;
        const methodTitle = p.method === 'CASH' ? 'نقدی' : p.method === 'CARD' ? 'کارتخوان / پوز' : 'چک صیادی';
        paymentsHtml += `
            <div class="receipt-row">
                <span>${methodTitle}:</span>
                <strong>${formatPrice(p.amount)}</strong>
            </div>
        `;
    });

    const finalAmount = inv.pricing ? inv.pricing.finalAmount : 0;
    const remainingCredit = Math.max(0, finalAmount - totalPaid);
    if (remainingCredit > 0) {
        paymentsHtml += `
            <div class="receipt-row" style="font-weight:900; color:#ea580c;">
                <span>مانده در دفتر حساب (نسیه):</span>
                <strong>${formatPrice(remainingCredit)}</strong>
            </div>
        `;
    }

    paper.innerHTML = `
        <div class="receipt-center">
            <div class="receipt-title">🍦 فاکتور فروش حساب‌چین</div>
            <div class="receipt-sub">سامانه پخش مویرگی و ویزیتوری</div>
        </div>
        <div class="receipt-divider"></div>
        <div class="receipt-row">
            <span>شماره فاکتور:</span>
            <strong>${toPersianNum(inv.invoiceNumber)}</strong>
        </div>
        <div class="receipt-row">
            <span>مشتری:</span>
            <strong>${inv.customer?.name || 'مشتری'}</strong>
        </div>
        <div class="receipt-row">
            <span>ویزیتور:</span>
            <span>${inv.visitor?.name || 'ویزیتور'}</span>
        </div>
        <div class="receipt-row">
            <span>تاریخ و ساعت:</span>
            <span>${toPersianNum(dateStr)} - ${toPersianNum(timeStr)}</span>
        </div>
        <div class="receipt-divider"></div>
        <div style="font-weight: bold; margin-bottom: 4px;">اقلام تحویل داده شده:</div>
        ${itemsHtml}
        <div class="receipt-divider"></div>
        <div class="receipt-row">
            <span>جمع ناخالص:</span>
            <span>${formatPrice(inv.pricing?.subtotal || 0)}</span>
        </div>
        ${discountsHtml}
        <div class="receipt-row" style="font-size: 13.5px; font-weight: 900; margin-top: 4px;">
            <span>مبلغ نهایی فاکتور:</span>
            <span>${formatPrice(finalAmount)}</span>
        </div>
        <div class="receipt-divider"></div>
        <div style="font-weight: bold; margin-bottom: 4px;">نحوه تسویه:</div>
        ${paymentsHtml}
        <div class="receipt-divider"></div>
        <div class="receipt-center" style="font-size: 10px; margin-top: 6px;">
            از خرید شما سپاسگزاریم<br>
            نرم‌افزار توزیع و حسابداری حساب‌چین
        </div>
    `;
}

function closeThermalReceiptModal() {
    document.getElementById('invoiceModal').style.display = 'none';
}
