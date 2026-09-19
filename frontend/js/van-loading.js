// ============================================================
// ویزیتیک — اسکریپت بارگیری خودرو و قفل موجودی (van-loading.js)
// ============================================================

const STORAGE_KEY_CATALOGS = 'vizitik_downloaded_catalogs';

let selectedBrand = 'ALL';
let selectedCategory = 'ALL';
let searchQuery = '';
let showLoadedOnly = false;
let toastTimeout = null;

const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const noInventoryFound = document.getElementById('noInventoryFound');

function getDownloadedCatalogs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_CATALOGS);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

// ============================================================
// ۱. مدیریت تغییر تعداد (افزایش / کاهش / تایپ مستقیم)
// ============================================================

function changeQty(prodId, type, delta) {
    const inputId = `${type}_${prodId}`;
    const inputElem = document.getElementById(inputId);
    if (!inputElem) return;

    let currentVal = parseInt(inputElem.value) || 0;
    let newVal = Math.max(0, currentVal + delta);
    inputElem.value = newVal;

    updateCardState(prodId);
    updateGlobalSummary();
}

function handleQtyInput(prodId, type, rawVal) {
    const inputId = `${type}_${prodId}`;
    const inputElem = document.getElementById(inputId);
    if (!inputElem) return;

    let val = parseInt(rawVal);
    if (isNaN(val) || val < 0) {
        val = 0;
    }
    inputElem.value = val;

    updateCardState(prodId);
    updateGlobalSummary();
}

function updateCardState(prodId) {
    const card = document.querySelector(`.van-card[data-id="${prodId}"]`);
    if (!card) return;

    const cartonInput = document.getElementById(`carton_${prodId}`);
    const unitInput = document.getElementById(`unit_${prodId}`);
    const calcFooter = document.getElementById(`calcFooter_${prodId}`);

    const cartons = parseInt(cartonInput ? cartonInput.value : 0) || 0;
    const units = parseInt(unitInput ? unitInput.value : 0) || 0;
    const packSize = parseInt(card.dataset.pack) || 24;

    const totalSingle = (cartons * packSize) + units;
    // شکستن موجودی به کارتن بر اساس ظرفیت کارتن (مثل ۲ کارتن + ۵۵ دانه → ۴ کارتن + ۷ دانه)
    const normCartons = Math.floor(totalSingle / packSize);
    const normUnits = totalSingle % packSize;

    card.dataset.cartons = cartons;
    card.dataset.units = units;

    // هایلایت کارت در صورت داشتن موجودی
    if (cartons > 0 || units > 0) {
        card.classList.add('is-loaded');
    } else {
        card.classList.remove('is-loaded');
    }

    // به‌روزرسانی متن زیرنویس کارت (نمایش شکسته‌شده به کارتن)
    if (calcFooter) {
        let text = `<span>مجموع بارگیری این کالا: <strong class="total-units-text">${toPersianNumber(totalSingle)} عدد</strong></span>`;
        if (normUnits > 0) {
            text += `<small>(${toPersianNumber(normCartons)} کارتن + ${toPersianNumber(normUnits)} دانه)</small>`;
        } else if (normCartons > 0) {
            text += `<small>(${toPersianNumber(normCartons)} کارتن)</small>`;
        }
        calcFooter.innerHTML = text;
    }
}

// محاسبه زنده آمار کل بار در هدر و نوار چسبان پایینی
function updateGlobalSummary() {
    let totalCartons = 0;
    let totalUnits = 0;
    let totalValue = 0;

    const cards = document.querySelectorAll('.van-card');
    cards.forEach(card => {
        const cartons = parseInt(card.dataset.cartons) || 0;
        const units = parseInt(card.dataset.units) || 0;
        const packSize = parseInt(card.dataset.pack) || 24;
        const cartonPrice = parseFloat(card.dataset.cartonprice) || 0;
        const unitPrice = parseFloat(card.dataset.unitprice) || 0;

        // جمع‌بندی بر مبنای موجودی شکسته‌شده به کارتن (دانهٔ مازاد به کارتن تبدیل می‌شود)
        const totalSingle = (cartons * packSize) + units;
        const normCartons = Math.floor(totalSingle / packSize);
        const normUnits = totalSingle % packSize;

        totalCartons += normCartons;
        totalUnits += normUnits;
        totalValue += (normCartons * cartonPrice) + (normUnits * unitPrice);
    });

    const headerSub = document.getElementById('headerSubSummary');
    const stickyCartons = document.getElementById('stickyTotalCartons');
    const stickyUnits = document.getElementById('stickyTotalUnits');
    const stickyValue = document.getElementById('stickyTotalValue');

    if (headerSub) {
        headerSub.textContent = `${toPersianNumber(totalCartons)} کارتن و ${toPersianNumber(totalUnits)} دانه در ماشین`;
    }
    if (stickyCartons) {
        stickyCartons.textContent = toPersianNumber(totalCartons);
    }
    if (stickyUnits) {
        stickyUnits.textContent = toPersianNumber(totalUnits);
    }
    if (stickyValue) {
        stickyValue.textContent = `${toPersianNumber(totalValue.toLocaleString('fa-IR'))} تومان`;
    }
}

// ============================================================
// ۲. فیلترها و جستجو
// ============================================================

function filterInventory() {
    searchQuery = (searchInput ? searchInput.value : '').trim().toLowerCase();
    
    if (clearSearchBtn) {
        clearSearchBtn.style.display = searchQuery.length > 0 ? 'flex' : 'none';
    }

    applyAllFilters();
}

function clearSearch() {
    if (searchInput) {
        searchInput.value = '';
    }
    filterInventory();
}

function selectBrand(btn, brand) {
    selectedBrand = brand;
    showLoadedOnly = (brand === 'LOADED_ONLY');
    
    const chips = document.querySelectorAll('#brandChipsTrack .filter-chip');
    chips.forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const topFilterBtn = document.getElementById('toggleLoadedOnlyBtn');
    if (topFilterBtn) {
        topFilterBtn.classList.toggle('active', showLoadedOnly);
    }

    applyAllFilters();
}

function toggleLoadedOnlyFilter() {
    showLoadedOnly = !showLoadedOnly;
    const loadedChip = document.getElementById('loadedFilterChip');
    const topFilterBtn = document.getElementById('toggleLoadedOnlyBtn');

    if (showLoadedOnly) {
        selectedBrand = 'LOADED_ONLY';
        const chips = document.querySelectorAll('#brandChipsTrack .filter-chip');
        chips.forEach(c => c.classList.remove('active'));
        if (loadedChip) loadedChip.classList.add('active');
        if (topFilterBtn) topFilterBtn.classList.add('active');
    } else {
        selectedBrand = 'ALL';
        const allChip = document.querySelector('#brandChipsTrack .filter-chip[data-brand="ALL"]');
        if (allChip) selectBrand(allChip, 'ALL');
        if (topFilterBtn) topFilterBtn.classList.remove('active');
    }

    applyAllFilters();
}

function selectCategory(btn, category) {
    selectedCategory = category;

    const chips = document.querySelectorAll('#categoryChipsTrack .filter-chip');
    chips.forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');

    applyAllFilters();
}

function resetFilters() {
    selectedBrand = 'ALL';
    selectedCategory = 'ALL';
    showLoadedOnly = false;
    if (searchInput) searchInput.value = '';
    searchQuery = '';

    const brandChips = document.querySelectorAll('#brandChipsTrack .filter-chip');
    brandChips.forEach(c => c.dataset.brand === 'ALL' ? c.classList.add('active') : c.classList.remove('active'));

    const categoryChips = document.querySelectorAll('#categoryChipsTrack .filter-chip');
    categoryChips.forEach(c => c.dataset.category === 'ALL' ? c.classList.add('active') : c.classList.remove('active'));

    const topFilterBtn = document.getElementById('toggleLoadedOnlyBtn');
    if (topFilterBtn) topFilterBtn.classList.remove('active');

    if (clearSearchBtn) clearSearchBtn.style.display = 'none';

    applyAllFilters();
}

function applyAllFilters() {
    const downloadedCatalogs = getDownloadedCatalogs();
    const cards = document.querySelectorAll('.van-card');
    let visibleCount = 0;
    let totalEligibleCount = 0;

    cards.forEach(card => {
        const name = (card.dataset.name || '').toLowerCase();
        const brand = card.dataset.brand || '';
        const category = card.dataset.category || '';
        const isCustom = card.dataset.iscustom === 'true';
        const isGlobal = card.dataset.isglobal === 'true';
        const cartons = parseInt(card.dataset.cartons) || 0;
        const units = parseInt(card.dataset.units) || 0;
        const isLoaded = (cartons > 0 || units > 0);

        // قانون کاتالوگ‌های فعال:
        // ۱. کالای اختصاصی دست‌ساز کاربر همیشه فعال است.
        // ۲. هر کالایی که در ماشین بارگیری شده (موجودی دارد) همیشه نمایش داده می‌شود.
        // ۳. کالاهای کاتالوگ آماده شرکتی فقط و فقط اگر کاتالوگ آن برند توسط ویزیتور در صفحه کالاها دانلود شده باشد نمایش داده می‌شوند.
        const isCatalogActive = isCustom || isLoaded || (isGlobal && downloadedCatalogs.includes(brand));

        // شرط فیلتر برند یا فقط بارگیری‌شده‌ها
        let matchBrand = false;
        if (selectedBrand === 'ALL') {
            matchBrand = true;
        } else if (selectedBrand === 'MY_PRODUCTS') {
            matchBrand = isCustom;
        } else if (selectedBrand === 'LOADED_ONLY') {
            matchBrand = isLoaded;
        } else {
            matchBrand = (brand === selectedBrand);
        }

        const matchCategory = (selectedCategory === 'ALL' || category === selectedCategory);
        const matchSearch = (!searchQuery || 
            name.includes(searchQuery) || 
            brand.toLowerCase().includes(searchQuery) || 
            category.toLowerCase().includes(searchQuery));

        // کارت‌ها از سمت سرور پنهان رندر شده‌اند؛ فقط خود JS مجوز نمایش دارد
        // تا هیچ کالای global بدون کاتالوگ دریافت‌شده (بایپس) دیده نشود.
        if (isCatalogActive) totalEligibleCount++;
        if (isCatalogActive && matchBrand && matchCategory && matchSearch) {
            card.style.display = '';
            visibleCount++;
        } else {
            card.style.display = 'none';
        }
    });

    // اگر هیچ کالای واجد شرایطی نیست، راهنمای دریافت کاتالوگ را نشان بده
    const noEligible = document.getElementById('noEligibleProducts');
    if (noEligible) {
        noEligible.style.display = (totalEligibleCount === 0 && cards.length > 0) ? 'flex' : 'none';
    }

    if (noInventoryFound) {
        noInventoryFound.style.display = (visibleCount === 0 && cards.length > 0) ? 'flex' : 'none';
    }
}

// ============================================================
// ۳. ثبت و قفل موجودی ماشین (Save & Lock)
// ============================================================

async function saveAndLockInventory() {
    const lockBtn = document.getElementById('lockInventoryBtn');
    if (!lockBtn) return;

    const cards = document.querySelectorAll('.van-card');
    const items = [];
    cards.forEach(card => {
        const productId = card.dataset.id;
        const quantityCartons = parseInt(card.dataset.cartons) || 0;
        const quantityUnits = parseInt(card.dataset.units) || 0;

        items.push({
            productId,
            quantityCartons,
            quantityUnits
        });
    });

    const originalBtnHtml = lockBtn.innerHTML;
    lockBtn.disabled = true;
    lockBtn.innerHTML = `
        <span class="material-symbols-outlined spin-icon">sync</span>
        <span>در حال ثبت موجودی...</span>
    `;

    try {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (typeof API_TOKEN !== 'undefined' && API_TOKEN) {
            headers['Authorization'] = `Bearer ${API_TOKEN}`;
        }

        const res = await fetch('http://localhost:3000/api/van-inventory/bulk', {
            method: 'PUT',
            headers,
            body: JSON.stringify({ items })
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok) {
            showNotification('موجودی خودرو با موفقیت ثبت و در سیستم قفل شد.', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 800);
        } else {
            showNotification(data.message || 'خطا در ثبت بارگیری خودرو.', 'error');
            lockBtn.disabled = false;
            lockBtn.innerHTML = originalBtnHtml;
        }
    } catch (err) {
        showNotification('خطا در برقراری ارتباط با سرور.', 'error');
        lockBtn.disabled = false;
        lockBtn.innerHTML = originalBtnHtml;
    }
}

// ============================================================
// ۴. نوتیفیکیشن و ابزارها
// ============================================================

function showNotification(msg, type = 'info') {
    const appContainer = document.getElementById('app') || document.body;
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

    toast.className = `app-toast ${type}`;
    toast.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span>${msg}</span>`;
    
    void toast.offsetWidth;
    toast.classList.add('show');

    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 2800);
}

function toPersianNumber(n) {
    if (n === null || n === undefined) return '۰';
    const farsiDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return n.toString().replace(/\d/g, x => farsiDigits[x]);
}
const toPersianNum = toPersianNumber;

document.addEventListener('DOMContentLoaded', () => {
    updateGlobalSummary();
    applyAllFilters();
});
