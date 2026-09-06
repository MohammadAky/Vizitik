// ============================================================
// حساب‌چین — لاجیک ثبت سفارش، تفکیک دقیق کارتن/دانه و محاسبات (new-order.js)
// ============================================================

let orderState = {
    customerId: null,
    customerName: '',
    customerDebt: 0,
    customerPhone: '',
    items: {}, // productId -> { productId, name, brand, cartonCount, unitCount, cartonPrice, unitPrice, lineTotal, unitsPerCarton }
    subtotal: 0,
    totalCartons: 0,
    totalUnits: 0,
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

// انتخاب مشتری
function selectCustomer(id, name, phone, debt) {
    orderState.customerId = id;
    orderState.customerName = name;
    orderState.customerPhone = phone;
    orderState.customerDebt = parseFloat(debt) || 0;

    const nameElem = document.getElementById('selectedCustName');
    if (nameElem) nameElem.textContent = name;

    const debtBadge = document.getElementById('selectedCustDebt');
    if (debtBadge) {
        if (orderState.customerDebt > 0) {
            debtBadge.className = 'cust-debt-badge';
            debtBadge.textContent = 'بدهی قبلی: ' + formatPrice(orderState.customerDebt);
        } else {
            debtBadge.className = 'cust-debt-badge cleared';
            debtBadge.textContent = 'حساب تسویه (بدون بدهی)';
        }
    }

    closeCustomerPicker();
    recalculateOrder();
}

function openCustomerPicker() {
    const modal = document.getElementById('customerPickerModal');
    if (modal) modal.style.display = 'flex';
}

function closeCustomerPicker() {
    const modal = document.getElementById('customerPickerModal');
    if (modal) modal.style.display = 'none';
}

function filterCustomerList(query) {
    const term = query.trim().toLowerCase();
    const items = document.querySelectorAll('.picker-cust-item');
    items.forEach(item => {
        const name = (item.dataset.name || '').toLowerCase();
        const phone = (item.dataset.phone || '').toLowerCase();
        if (name.includes(term) || phone.includes(term)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
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

// تغییر تعداد کارتن
function updateCartonCount(productId, delta) {
    const card = document.getElementById(`prodCard_${productId}`);
    const cartonInput = document.getElementById(`cartonInput_${productId}`);
    const unitInput = document.getElementById(`unitInput_${productId}`);
    if (!card || !cartonInput) return;

    const unitsPerCarton = parseInt(card.dataset.unitsPerCarton) || 1;
    const totalStockUnits = parseInt(card.dataset.totalStockUnits) || 0;
    const currentUnits = parseInt(unitInput ? unitInput.value : 0) || 0;

    let currentCartons = parseInt(cartonInput.value) || 0;
    let newCartons = Math.max(0, currentCartons + delta);

    // بررسی موجودی کل ماشین
    const requestedTotalUnits = (newCartons * unitsPerCarton) + currentUnits;
    if (requestedTotalUnits > totalStockUnits && totalStockUnits > 0) {
        const maxCartonsPossible = Math.floor((totalStockUnits - currentUnits) / unitsPerCarton);
        newCartons = Math.max(0, maxCartonsPossible);
        showNotification(`موجودی کل این کالا در خودرو ${toPersianNum(totalStockUnits)} عدد است و امکان انتخاب کارتن بیشتر وجود ندارد.`, 'warning');
    }

    cartonInput.value = newCartons;
    onQuantityChanged(productId);
}

// تغییر تعداد دانه (با رعایت محدودیت دانه در کارتن و موجودی کل ماشین)
function updateUnitCount(productId, delta) {
    const card = document.getElementById(`prodCard_${productId}`);
    const unitInput = document.getElementById(`unitInput_${productId}`);
    const cartonInput = document.getElementById(`cartonInput_${productId}`);
    if (!card || !unitInput) return;

    const unitsPerCarton = parseInt(card.dataset.unitsPerCarton) || 1;
    const totalStockUnits = parseInt(card.dataset.totalStockUnits) || 0;
    const currentCartons = parseInt(cartonInput ? cartonInput.value : 0) || 0;

    let currentUnits = parseInt(unitInput.value) || 0;
    let newUnits = Math.max(0, currentUnits + delta);

    // ۱. قانون محدودیت دانه در کارتن (حداکثر unitsPerCarton - 1 دانه)
    if (unitsPerCarton > 1 && newUnits >= unitsPerCarton) {
        newUnits = unitsPerCarton - 1;
        showNotification(`تعداد دانه نمی‌تواند مساوی یا بیشتر از یک کارتن (${toPersianNum(unitsPerCarton)} دانه) باشد. برای تعداد بالاتر، لطفاً تعداد کارتن را افزایش دهید.`, 'warning');
    }

    // ۲. بررسی سقف کل موجودی خودرو
    const requestedTotalUnits = (currentCartons * unitsPerCarton) + newUnits;
    if (requestedTotalUnits > totalStockUnits && totalStockUnits > 0) {
        const maxAvailableUnits = Math.max(0, totalStockUnits - (currentCartons * unitsPerCarton));
        newUnits = Math.min(newUnits, maxAvailableUnits);
        showNotification(`موجودی کل باقی‌مانده این کالا در خودرو ${toPersianNum(totalStockUnits)} عدد است.`, 'warning');
    }

    unitInput.value = newUnits;
    onQuantityChanged(productId);
}

// واکنش به تغییر تعداد کارتن یا دانه
function onQuantityChanged(productId) {
    const card = document.getElementById(`prodCard_${productId}`);
    if (!card) return;

    const cartonInput = document.getElementById(`cartonInput_${productId}`);
    const unitInput = document.getElementById(`unitInput_${productId}`);

    const unitsPerCarton = parseInt(card.dataset.unitsPerCarton) || 1;
    const totalStockUnits = parseInt(card.dataset.totalStockUnits) || 0;
    const cartonPrice = parseFloat(card.dataset.cartonPrice) || 0;
    const unitPrice = parseFloat(card.dataset.unitPrice) || 0;

    let cartonCount = parseInt(cartonInput ? cartonInput.value : 0) || 0;
    let unitCount = parseInt(unitInput ? unitInput.value : 0) || 0;

    if (cartonCount < 0) cartonCount = 0;
    if (unitCount < 0) unitCount = 0;

    // اعمال محدودیت دانه در کارتن
    if (unitsPerCarton > 1 && unitCount >= unitsPerCarton) {
        unitCount = unitsPerCarton - 1;
        if (unitInput) unitInput.value = unitCount;
    }

    // اعمال سقف موجودی کل بارگیری شده در ماشین
    const requestedTotalUnits = (cartonCount * unitsPerCarton) + unitCount;
    if (requestedTotalUnits > totalStockUnits && totalStockUnits > 0) {
        const maxCartons = Math.floor(totalStockUnits / unitsPerCarton);
        if (cartonCount > maxCartons) {
            cartonCount = maxCartons;
            if (cartonInput) cartonInput.value = cartonCount;
        }
        const remainingStock = Math.max(0, totalStockUnits - (cartonCount * unitsPerCarton));
        unitCount = Math.min(unitCount, remainingStock);
        if (unitInput) unitInput.value = unitCount;
    }

    // محاسبه دقیق جمع ردیف: (کارتن × قیمت کارتن) + (دانه × قیمت دانه)
    const lineTotal = (cartonCount * cartonPrice) + (unitCount * unitPrice);

    const lineBadge = document.getElementById(`lineTotalBadge_${productId}`);
    const lineAmount = document.getElementById(`lineTotalAmount_${productId}`);
    const lineDesc = document.getElementById(`lineTotalDesc_${productId}`);

    if (cartonCount > 0 || unitCount > 0) {
        card.classList.add('has-quantity');
        if (lineBadge) lineBadge.classList.add('show');

        let descText = '';
        if (cartonCount > 0 && unitCount > 0) {
            descText = `جمع: ${toPersianNum(cartonCount)} کارتن و ${toPersianNum(unitCount)} دانه`;
        } else if (cartonCount > 0) {
            descText = `جمع: ${toPersianNum(cartonCount)} کارتن`;
        } else {
            descText = `جمع: ${toPersianNum(unitCount)} دانه`;
        }

        if (lineDesc) lineDesc.textContent = descText;
        if (lineAmount) lineAmount.textContent = formatPrice(lineTotal);

        orderState.items[productId] = {
            productId,
            name: card.dataset.name || '',
            brand: card.dataset.brand || '',
            cartonCount,
            unitCount,
            cartonPrice,
            unitPrice,
            unitsPerCarton,
            lineTotal
        };
    } else {
        card.classList.remove('has-quantity');
        if (lineBadge) lineBadge.classList.remove('show');
        delete orderState.items[productId];
    }

    recalculateOrder();
}

// محاسبه جمع کل سفارش و فعال‌سازی دکمه ادامه به تسویه
function recalculateOrder() {
    let subtotal = 0;
    let totalCartons = 0;
    let totalUnits = 0;

    Object.values(orderState.items).forEach(item => {
        subtotal += item.lineTotal;
        totalCartons += item.cartonCount;
        totalUnits += item.unitCount;
    });

    orderState.subtotal = subtotal;
    orderState.totalCartons = totalCartons;
    orderState.totalUnits = totalUnits;

    // به‌روزرسانی مبالغ نوار پایین صفحه با بررسی ایمن وجود المان‌ها
    const calcFinalElem = document.getElementById('calcFinalVal');
    if (calcFinalElem) {
        calcFinalElem.textContent = formatPrice(subtotal);
    }

    const calcSubtotalElem = document.getElementById('calcSubtotalVal');
    if (calcSubtotalElem) {
        calcSubtotalElem.textContent = formatPrice(subtotal);
    }

    const checkoutBtn = document.getElementById('checkoutCtaBtn');
    const itemsCount = Object.keys(orderState.items).length;

    if (checkoutBtn) {
        if (orderState.customerId && itemsCount > 0 && subtotal > 0) {
            checkoutBtn.disabled = false;

            let itemsSummary = '';
            if (totalCartons > 0 && totalUnits > 0) {
                itemsSummary = `${toPersianNum(totalCartons)} کارتن و ${toPersianNum(totalUnits)} دانه`;
            } else if (totalCartons > 0) {
                itemsSummary = `${toPersianNum(totalCartons)} کارتن`;
            } else {
                itemsSummary = `${toPersianNum(totalUnits)} دانه`;
            }

            checkoutBtn.innerHTML = `<span>ادامه به مرحله تسویه و پرداخت (${itemsSummary})</span><span class="material-symbols-outlined" style="font-size: 20px; transform: scaleX(-1);">arrow_forward</span>`;
        } else {
            checkoutBtn.disabled = true;
            if (!orderState.customerId) {
                checkoutBtn.innerHTML = '<span>لطفاً ابتدا مشتری را انتخاب کنید</span>';
            } else {
                checkoutBtn.innerHTML = '<span>حداقل یک محصول را انتخاب نمایید</span>';
            }
        }
    }
}

// جستجو و فیلتر
function filterProducts() {
    const searchInput = document.getElementById('orderSearchInput');
    const query = searchInput ? (searchInput.value || '').trim().toLowerCase() : '';
    const activeCat = document.querySelector('.cat-pill.active')?.dataset.cat || 'all';

    const cards = document.querySelectorAll('.product-order-card');
    cards.forEach(card => {
        const name = (card.dataset.name || '').toLowerCase();
        const brand = (card.dataset.brand || '').toLowerCase();
        const category = card.dataset.category || '';

        const matchQuery = !query || name.includes(query) || brand.includes(query);
        const matchCat = activeCat === 'all' || category === activeCat;

        if (matchQuery && matchCat) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });
}

function selectCategory(elem, category) {
    document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
    elem.classList.add('active');
    filterProducts();
}

// هدایت به صفحه پرداخت
function proceedToPayment() {
    if (!orderState.customerId || Object.keys(orderState.items).length === 0) {
        showNotification('لطفاً مشتری و حداقل یک کالا را انتخاب نمایید.', 'error');
        return;
    }

    sessionStorage.setItem('hesabchin_current_order', JSON.stringify(orderState));
    window.location.href = `payment.php?customerId=${encodeURIComponent(orderState.customerId)}`;
}
