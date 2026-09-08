// ============================================================
// ویزیتیک — اسکریپت مدیریت و ویرایش جامع فاکتورها (orders.js)
// ============================================================

let currentEditOrderId = null;
let editOrderState = {
    orderId: null,
    customerName: '',
    items: [],
    discountPercentages: [],
    fixedDiscountAmount: 0,
    grossSubtotal: 0,
    totalDiscount: 0,
    finalAmount: 0,
};

function toPersianNum(num) {
    if (num === null || num === undefined) return '';
    const p = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return num.toString().replace(/\d/g, d => p[d]);
}

function formatPrice(amount) {
    const formatted = Math.round(amount || 0).toLocaleString('en-US');
    return toPersianNum(formatted) + ' تومان';
}

// تبدیل ارقام فارسی/انگلیسی به رقمِ خالص انگلیسی (برای جستجوی بی‌دردسر شماره فاکتور)
function digitsToLatin(str) {
    const fa = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
    return String(str || '').split('').map(ch => {
        const i = fa.indexOf(ch);
        return i !== -1 ? String(i) : ch;
    }).join('');
}

function filterOrdersList() {
    const raw = (document.getElementById('orderSearchInput').value || '').trim();
    const query = raw.toLowerCase();
    const cards = document.querySelectorAll('.order-card');

    // ارقامِ خواسته‌شده را نرمال می‌کنیم تا «۱۴۰۵»، «1405»، «000012» یا «1405-000012» همگی کار کنند
    const queryDigits = digitsToLatin(raw).replace(/[^0-9]/g, '');

    cards.forEach(card => {
        const cust = (card.dataset.customer || '').toLowerCase();
        const inv = (card.dataset.inv || '').toLowerCase();
        const invDigits = card.dataset.invDigits || digitsToLatin(inv).replace(/[^0-9]/g, '');

        if (!query) {
            card.style.display = 'flex';
            return;
        }

        const nameHit = cust.includes(query);
        const invRawHit = inv.includes(query);
        const digitsHit = queryDigits.length > 0 && invDigits.includes(queryDigits);

        card.style.display = (nameHit || invRawHit || digitsHit) ? 'flex' : 'none';
    });
}

// ============================================================
// باز کردن مدال جامع ویرایش فاکتور
// ============================================================
async function openFullEditOrderModal(orderId) {
    try {
        const res = await fetch(`http://localhost:3000/api/orders/${orderId}/invoice`, {
            headers: { 'Authorization': `Bearer ${API_TOKEN}` }
        });

        if (!res.ok) {
            alert('دریافت جزئیات فاکتور با خطا مواجه شد.');
            return;
        }

        const invoice = await res.json();
        currentEditOrderId = orderId;

        editOrderState.orderId = orderId;
        editOrderState.customerName = invoice.customer?.name || 'مشتری';
        editOrderState.items = (invoice.items || []).map(i => ({
            productId: i.productId,
            productName: i.productName,
            brand: i.brand || 'میهن',
            unitsPerCarton: i.unitsPerCarton || 1,
            cartonCount: i.cartonCount || 0,
            unitCount: i.unitCount || 0,
            cartonPrice: i.cartonPrice || 0,
            unitPrice: i.unitPrice || 0,
            lineTotal: i.lineTotal || 0
        }));

        editOrderState.discountPercentages = (invoice.pricing?.discountSteps || []).map(s => Number(s.percent)).filter(p => p > 0);
        editOrderState.fixedDiscountAmount = 0;

        document.getElementById('editFullOrderSubtitle').innerHTML = `فروشگاه ${editOrderState.customerName} (فاکتور #<span class="invoice-num">${toPersianNum(invoice.invoiceNumber)}</span>)`;

        // پر کردن فیلدهای پرداخت قبلی
        let prevCash = 0, prevPos = 0, prevCheck = 0;
        let prevCheckNum = '', prevCheckBank = '';

        (invoice.payments || []).forEach(p => {
            if (p.method === 'CASH') prevCash += p.amount;
            if (p.method === 'CARD') prevPos += p.amount;
            if (p.method === 'CHECK') {
                prevCheck += p.amount;
                if (p.check) {
                    prevCheckNum = p.check.checkNumber || '';
                    prevCheckBank = p.check.bankName || '';
                }
            }
        });

        document.getElementById('editFullCashInput').value = prevCash > 0 ? prevCash.toLocaleString('en-US') : '';
        document.getElementById('editFullPosInput').value = prevPos > 0 ? prevPos.toLocaleString('en-US') : '';
        document.getElementById('editFullCheckInput').value = prevCheck > 0 ? prevCheck.toLocaleString('en-US') : '';
        document.getElementById('editFullCheckNumber').value = prevCheckNum;
        document.getElementById('editFullCheckBank').value = prevCheckBank;

        renderEditItemsList();
        renderEditDiscountChips();
        onFullEditCalculations();

        document.getElementById('editFullOrderModal').style.display = 'flex';
    } catch (e) {
        console.error(e);
        alert('خطا در ارتباط با سرور.');
    }
}

function closeFullEditOrderModal() {
    document.getElementById('editFullOrderModal').style.display = 'none';
}

// ============================================================
// رندر اقلام در حال ویرایش
// ============================================================
function renderEditItemsList() {
    const container = document.getElementById('editOrderItemsList');
    if (!editOrderState.items || editOrderState.items.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:12px; font-size:11.5px; color:var(--text-muted);">هیچ کالایی در سفارش وجود ندارد.</div>`;
        return;
    }

    let html = '';
    editOrderState.items.forEach((item, idx) => {
        const itemLineTotal = (item.cartonCount * item.cartonPrice) + (item.unitCount * item.unitPrice);
        item.lineTotal = itemLineTotal;

        html += `
            <div class="edit-item-row" id="editItemRow_${idx}">
                <div class="edit-item-header">
                    <div class="edit-item-name">${item.productName} (${item.brand})</div>
                    <button type="button" class="edit-item-delete-btn" onclick="removeEditItem(${idx})" title="حذف کالا">
                        <span class="material-symbols-outlined" style="font-size: 18px;">delete</span>
                    </button>
                </div>

                <div class="edit-steppers-grid">
                    <!-- کارتن -->
                    <div class="stepper-box">
                        <div class="stepper-label">
                            <span>کارتن:</span>
                            <span>${toPersianNum(item.unitsPerCarton)} عددی</span>
                        </div>
                        <div class="stepper-controls">
                            <button type="button" class="stepper-btn" onclick="changeEditItemCarton(${idx}, -1)">-</button>
                            <input type="number" class="stepper-input" value="${item.cartonCount}" min="0" onchange="setEditItemCarton(${idx}, this.value)">
                            <button type="button" class="stepper-btn" onclick="changeEditItemCarton(${idx}, 1)">+</button>
                        </div>
                    </div>

                    <!-- دانه -->
                    <div class="stepper-box">
                        <div class="stepper-label">
                            <span>دانه (خرده):</span>
                            <span>سقف ${toPersianNum(item.unitsPerCarton - 1)}</span>
                        </div>
                        <div class="stepper-controls">
                            <button type="button" class="stepper-btn" onclick="changeEditItemUnit(${idx}, -1)">-</button>
                            <input type="number" class="stepper-input" value="${item.unitCount}" min="0" max="${item.unitsPerCarton - 1}" onchange="setEditItemUnit(${idx}, this.value)">
                            <button type="button" class="stepper-btn" onclick="changeEditItemUnit(${idx}, 1)">+</button>
                        </div>
                    </div>
                </div>

                <div class="edit-item-footer">
                    <span>فی کارتن: ${formatPrice(item.cartonPrice)}</span>
                    <strong>جمع: ${formatPrice(itemLineTotal)}</strong>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function changeEditItemCarton(idx, delta) {
    if (!editOrderState.items[idx]) return;
    editOrderState.items[idx].cartonCount = Math.max(0, editOrderState.items[idx].cartonCount + delta);
    renderEditItemsList();
    onFullEditCalculations();
}

function setEditItemCarton(idx, val) {
    if (!editOrderState.items[idx]) return;
    const num = Math.max(0, parseInt(val) || 0);
    editOrderState.items[idx].cartonCount = num;
    renderEditItemsList();
    onFullEditCalculations();
}

function changeEditItemUnit(idx, delta) {
    if (!editOrderState.items[idx]) return;
    const maxUnits = Math.max(0, editOrderState.items[idx].unitsPerCarton - 1);
    let newUnit = editOrderState.items[idx].unitCount + delta;
    if (newUnit < 0) newUnit = 0;
    if (newUnit > maxUnits) {
        alert(`تعداد دانه نمی‌تواند مساوی یا بیشتر از ظرفیت کارتن (${toPersianNum(editOrderState.items[idx].unitsPerCarton)}) باشد.`);
        newUnit = maxUnits;
    }
    editOrderState.items[idx].unitCount = newUnit;
    renderEditItemsList();
    onFullEditCalculations();
}

function setEditItemUnit(idx, val) {
    if (!editOrderState.items[idx]) return;
    const maxUnits = Math.max(0, editOrderState.items[idx].unitsPerCarton - 1);
    let num = parseInt(val) || 0;
    if (num < 0) num = 0;
    if (num > maxUnits) {
        alert(`تعداد دانه نمی‌تواند مساوی یا بیشتر از ظرفیت کارتن (${toPersianNum(editOrderState.items[idx].unitsPerCarton)}) باشد.`);
        num = maxUnits;
    }
    editOrderState.items[idx].unitCount = num;
    renderEditItemsList();
    onFullEditCalculations();
}

function removeEditItem(idx) {
    if (confirm('آیا از حذف این کالا از فاکتور اطمینان دارید؟')) {
        editOrderState.items.splice(idx, 1);
        renderEditItemsList();
        onFullEditCalculations();
    }
}

// افزودن محصول جدید از کاتالوگ
function addSelectedProductToEditOrder() {
    const select = document.getElementById('editAddProductSelect');
    const prodId = select.value;
    if (!prodId) {
        alert('لطفاً ابتدا یک محصول را انتخاب کنید.');
        return;
    }

    const opt = select.selectedOptions[0];
    const name = opt.dataset.name;
    const brand = opt.dataset.brand;
    const unitsPerCarton = parseInt(opt.dataset.units) || 1;
    const unitPrice = parseFloat(opt.dataset.unitprice) || 0;
    const cartonPrice = parseFloat(opt.dataset.cartonprice) || (unitPrice * unitsPerCarton);

    // بررسی آیا محصول از قبل وجود دارد
    const existing = editOrderState.items.find(i => i.productId === prodId);
    if (existing) {
        existing.cartonCount += 1;
    } else {
        editOrderState.items.push({
            productId: prodId,
            productName: name,
            brand: brand,
            unitsPerCarton: unitsPerCarton,
            cartonCount: 1,
            unitCount: 0,
            cartonPrice: cartonPrice,
            unitPrice: unitPrice,
            lineTotal: cartonPrice
        });
    }

    select.value = '';
    renderEditItemsList();
    onFullEditCalculations();
}

// ============================================================
// مدیریت تخفیف‌های پلکانی
// ============================================================
function renderEditDiscountChips() {
    const container = document.getElementById('editDiscountStepsContainer');
    if (!editOrderState.discountPercentages || editOrderState.discountPercentages.length === 0) {
        container.innerHTML = `<span style="font-size:11px; color:var(--text-muted);">هیچ تخفیف پلکانی ثبت نشده است.</span>`;
        return;
    }

    let html = '';
    editOrderState.discountPercentages.forEach((pct, idx) => {
        html += `
            <div class="discount-chip">
                <span>پله ${toPersianNum(idx + 1)}: ${toPersianNum(pct)}٪</span>
                <button type="button" class="discount-chip-remove" onclick="removeEditDiscountStep(${idx})" title="حذف پله">×</button>
            </div>
        `;
    });
    container.innerHTML = html;
}

function addDiscountStepToEditOrder() {
    const input = document.getElementById('editNewDiscountPercent');
    const val = parseFloat(input.value) || 0;
    if (val <= 0 || val > 100) {
        alert('لطفاً درصد تخفیف معتبر بین ۱ تا ۱۰۰ وارد کنید.');
        return;
    }

    editOrderState.discountPercentages.push(val);
    input.value = '';
    renderEditDiscountChips();
    onFullEditCalculations();
}

function removeEditDiscountStep(idx) {
    editOrderState.discountPercentages.splice(idx, 1);
    renderEditDiscountChips();
    onFullEditCalculations();
}

// ============================================================
// محاسبات لحظه‌ای و تسویه مالی
// ============================================================
function onFullEditCalculations() {
    // ۱. محاسبه جمع ناخالص
    let gross = 0;
    (editOrderState.items || []).forEach(item => {
        gross += (item.cartonCount * item.cartonPrice) + (item.unitCount * item.unitPrice);
    });
    editOrderState.grossSubtotal = gross;

    // ۲. محاسبه تخفیفات پلکانی (گردِ هر پله به تومان صحیح — هماهنگ با موتور بک‌اند)
    let currentAmount = gross;
    let totalDiscount = 0;

    (editOrderState.discountPercentages || []).forEach(pct => {
        if (pct > 0) {
            const stepDiscount = Math.round((currentAmount * pct) / 100);
            totalDiscount += stepDiscount;
            currentAmount -= stepDiscount;
        }
    });

    editOrderState.totalDiscount = Math.round(totalDiscount);
    const finalAmount = Math.max(0, Math.round(currentAmount));
    editOrderState.finalAmount = finalAmount;

    // به‌روزرسانی نمایشگرها
    document.getElementById('editGrossSubtotalDisplay').textContent = formatPrice(gross);

    // نمایش مبلغ تخفیف با منفی سمت چپِ عدد (مقاوم نسبت به بازترتیب RTL)
    const discountEl = document.getElementById('editTotalDiscountDisplay');
    if (totalDiscount > 0) {
        const digits = toPersianNum(Math.round(totalDiscount).toLocaleString('en-US'));
        discountEl.innerHTML = `<span class="neg-amount">\u2212${digits}</span> تومان`;
    } else {
        discountEl.textContent = '۰ تومان';
    }

    document.getElementById('editNetFinalDisplay').textContent = formatPrice(finalAmount);

    // ۳. خواندن ورودی‌های پرداخت
    const cashVal = parseFloat((document.getElementById('editFullCashInput').value || '').replace(/[^0-9]/g, '')) || 0;
    const posVal = parseFloat((document.getElementById('editFullPosInput').value || '').replace(/[^0-9]/g, '')) || 0;
    const checkVal = parseFloat((document.getElementById('editFullCheckInput').value || '').replace(/[^0-9]/g, '')) || 0;

    if (cashVal > 0) document.getElementById('editFullCashInput').value = cashVal.toLocaleString('en-US');
    if (posVal > 0) document.getElementById('editFullPosInput').value = posVal.toLocaleString('en-US');
    if (checkVal > 0) document.getElementById('editFullCheckInput').value = checkVal.toLocaleString('en-US');

    document.getElementById('editFullCheckDetailsBox').style.display = checkVal > 0 ? 'flex' : 'none';

    const paidSum = cashVal + posVal + checkVal;
    const remainingCredit = Math.max(0, finalAmount - paidSum);

    document.getElementById('editFullCreditRemaining').textContent = remainingCredit > 0 ? formatPrice(remainingCredit) : '۰ تومان (تسویه کامل)';
}

// ============================================================
// ذخیره نهایی ویرایش فاکتور
// ============================================================
async function saveFullEditedOrder() {
    if (!currentEditOrderId) return;

    // اعتبارسنجی اقلام
    const validItems = editOrderState.items.filter(i => i.cartonCount > 0 || i.unitCount > 0);
    if (validItems.length === 0) {
        alert('فاکتور باید حداقل دارای یک قلم کالا با تعداد مثبت باشد.');
        return;
    }

    const cashVal = parseFloat((document.getElementById('editFullCashInput').value || '').replace(/[^0-9]/g, '')) || 0;
    const posVal = parseFloat((document.getElementById('editFullPosInput').value || '').replace(/[^0-9]/g, '')) || 0;
    const checkVal = parseFloat((document.getElementById('editFullCheckInput').value || '').replace(/[^0-9]/g, '')) || 0;

    const paymentsPayload = [];
    if (cashVal > 0) paymentsPayload.push({ method: 'CASH', amount: cashVal });
    if (posVal > 0) paymentsPayload.push({ method: 'CARD', amount: posVal });
    if (checkVal > 0) {
        paymentsPayload.push({
            method: 'CHECK',
            amount: checkVal,
            checkDetails: {
                checkNumber: document.getElementById('editFullCheckNumber').value || '---',
                bankName: document.getElementById('editFullCheckBank').value || 'بانک',
                dueDate: new Date().toISOString()
            }
        });
    }

    const payload = {
        items: validItems.map(i => ({
            productId: i.productId,
            cartonCount: i.cartonCount,
            unitCount: i.unitCount
        })),
        discountSteps: (editOrderState.discountPercentages || []).map(pct => ({
            type: 'percent',
            value: Number(pct)
        })),
        payments: paymentsPayload
    };

    const saveBtn = document.getElementById('saveFullOrderBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span>در حال ثبت تغییرات فاکتور و همگام‌سازی انبار...</span>';

    try {
        const res = await fetch(`http://localhost:3000/api/orders/${currentEditOrderId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_TOKEN}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            alert('فاکتور با موفقیت ویرایش شد و تغییرات موجودی خودرو و دفتر حساب مشتری اعمال گردید.');
            closeFullEditOrderModal();
            window.location.reload();
        } else {
            alert(data.message || 'خطا در ویرایش فاکتور.');
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<span class="material-symbols-outlined">save</span><span>ذخیره تغییرات فاکتور و اعمال در انبار و حساب</span>';
        }
    } catch (e) {
        console.error(e);
        alert('خطا در برقراری ارتباط با سرور.');
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span class="material-symbols-outlined">save</span><span>ذخیره تغییرات فاکتور و اعمال در انبار و حساب</span>';
    }
}

// ============================================================
// چاپ فاکتور حرارتی ۸۰ میلی‌متری
// ============================================================
async function fetchAndPrintInvoice(orderId) {
    try {
        const res = await fetch(`http://localhost:3000/api/orders/${orderId}/invoice`, {
            headers: { 'Authorization': `Bearer ${API_TOKEN}` }
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
            <div class="receipt-title">🍦 فاکتور فروش ویزیتیک</div>
            <div class="receipt-sub">سامانه پخش مویرگی و ویزیتوری</div>
        </div>
        <div class="receipt-divider"></div>
        <div class="receipt-row">
            <span>شماره فاکتور:</span>
            <strong><span class="invoice-num">${toPersianNum(inv.invoiceNumber)}</span></strong>
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
            نرم‌افزار توزیع و حسابداری ویزیتیک
        </div>
    `;
}

function closeThermalReceiptModal() {
    document.getElementById('invoiceModal').style.display = 'none';
}

async function sendOrderToBale(orderId) {
    if (!confirm('آیا مایلید این فاکتور به پیام‌رسان بله فروشگاه و ویزیتور ارسال شود؟')) return;
    try {
        const res = await fetch(`http://localhost:3000/api/bale/send-invoice/${orderId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_TOKEN}`
            }
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
            let msg = 'فاکتور با موفقیت به بله ارسال شد.';
            if (data.customerSent && data.visitorSent) {
                msg = 'فاکتور با موفقیت برای فروشگاه و ویزیتور در بله ارسال شد.';
            } else if (data.visitorSent && !data.customerLinked) {
                msg = 'فاکتور برای ویزیتور ارسال شد. (فروشگاه هنوز در ربات بله عضو نشده است)';
            }
            alert(msg);
        } else {
            alert(data.message || 'فاکتور به بله ارسال شد.');
        }
    } catch (err) {
        alert('خطا در ارسال فاکتور به بله.');
    }
}
