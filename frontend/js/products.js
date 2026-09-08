// ============================================================
// ویزیتیک — مدیریت کاتالوگ‌ها، کش کلاینت (LocalStorage) و محصولات
// ============================================================

// کلید ذخیره‌سازی کاتالوگ‌های دانلود شده در کش
const STORAGE_KEY_CATALOGS = 'hesabchin_downloaded_catalogs';

// وضعیت فیلترها
let selectedBrand = 'ALL';
let selectedCategory = 'ALL';
let searchQuery = '';
let toastTimeout = null;

// عناصر DOM
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const productCards = document.querySelectorAll('.product-item-card');
const noProductsFound = document.getElementById('noProductsFound');
const emptyCatalogState = document.getElementById('emptyCatalogState');
const headerProductCount = document.getElementById('headerProductCount');

// عناصر محاسبه زنده قیمت در مودال
const prodPackSizeInput = document.getElementById('prodPackSize');
const prodCartonPriceInput = document.getElementById('prodCartonPrice');
const calcUnitPriceElem = document.getElementById('calcUnitPrice');

if (prodPackSizeInput && prodCartonPriceInput) {
    prodPackSizeInput.addEventListener('input', updateCalcPrice);
    prodCartonPriceInput.addEventListener('input', updateCalcPrice);
}

function updateCalcPrice() {
    const pack = parseInt(prodPackSizeInput.value) || 1;
    const carton = parseFloat(prodCartonPriceInput.value) || 0;
    const unit = pack > 0 ? Math.round(carton / pack) : 0;
    if (calcUnitPriceElem) {
        calcUnitPriceElem.textContent = `${toPersianNumber(unit.toLocaleString('fa-IR'))} تومان`;
    }
}

// ============================================================
// ۱. توابع کار با کش کاتالوگ‌های دریافت شده (Offline-First / Cache)
// ============================================================

function getDownloadedCatalogs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_CATALOGS);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function saveDownloadedCatalogs(catalogs) {
    localStorage.setItem(STORAGE_KEY_CATALOGS, JSON.stringify(catalogs));
}

function isCatalogDownloaded(brandName) {
    const list = getDownloadedCatalogs();
    return list.includes(brandName);
}

// تبدیل اعداد انگلیسی به فارسی
function toPersianNumber(n) {
    if (n === null || n === undefined) return '۰';
    const farsiDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return n.toString().replace(/\d/g, x => farsiDigits[x]);
}
const toPersianNum = toPersianNumber;

// دریافت تعداد اقلام یک برند به صورت داینامیک از سرور / دیتابیس
function getBrandItemCount(brandName) {
    if (window.BRAND_COUNTS && window.BRAND_COUNTS[brandName] !== undefined) {
        return window.BRAND_COUNTS[brandName];
    }
    const cards = document.querySelectorAll(`.product-item-card[data-brand="${brandName}"]`);
    return cards.length;
}

// به‌روزرسانی ظاهر دکمه‌های کشوی کاتالوگ و چیپ‌های برند در هدر
function updatePresetDrawerUI() {
    // ۱. بررسی برند میهن
    const isMihanActive = isCatalogDownloaded('میهن');
    const mihanBtn = document.getElementById('mihanDownloadBtn');
    const mihanCard = document.getElementById('presetCardMihan');
    const mihanChip = document.querySelector('.brand-chip-mihan');
    const mihanResetPricesBtn = document.getElementById('mihanResetPricesBtn');
    const mihanCount = getBrandItemCount('میهن');

    if (mihanBtn && mihanCard) {
        if (isMihanActive) {
            mihanCard.classList.add('active-catalog');
            mihanBtn.className = 'preset-action-btn active-btn';
            mihanBtn.innerHTML = `
                <span class="material-symbols-outlined">check_circle</span>
                <span class="btn-text">فعال در لیست من (حذف کاتالوگ)</span>
            `;
            if (mihanResetPricesBtn) mihanResetPricesBtn.style.display = 'flex';
        } else {
            mihanCard.classList.remove('active-catalog');
            mihanBtn.className = 'preset-action-btn download-btn';
            mihanBtn.innerHTML = `
                <span class="material-symbols-outlined">cloud_download</span>
                <span class="btn-text">دریافت کاتالوگ میهن (${toPersianNumber(mihanCount)} قلم)</span>
            `;
            if (mihanResetPricesBtn) mihanResetPricesBtn.style.display = 'none';
        }
    }

    if (mihanChip) {
        mihanChip.style.display = isMihanActive ? 'inline-flex' : 'none';
    }

    // ۲. بررسی برند پاندا
    const isPandaActive = isCatalogDownloaded('پاندا');
    const pandaBtn = document.getElementById('pandaDownloadBtn');
    const pandaCard = document.getElementById('presetCardPanda');
    const pandaChip = document.querySelector('.brand-chip-panda');
    const pandaResetPricesBtn = document.getElementById('pandaResetPricesBtn');
    const pandaCount = getBrandItemCount('پاندا');

    if (pandaBtn && pandaCard) {
        if (isPandaActive) {
            pandaCard.classList.add('active-catalog');
            pandaBtn.className = 'preset-action-btn active-btn';
            pandaBtn.innerHTML = `
                <span class="material-symbols-outlined">check_circle</span>
                <span class="btn-text">فعال در لیست من (حذف کاتالوگ)</span>
            `;
            if (pandaResetPricesBtn) pandaResetPricesBtn.style.display = 'flex';
        } else {
            pandaCard.classList.remove('active-catalog');
            pandaBtn.className = 'preset-action-btn download-btn';
            pandaBtn.innerHTML = `
                <span class="material-symbols-outlined">cloud_download</span>
                <span class="btn-text">دریافت کاتالوگ پاندا (${toPersianNumber(pandaCount)} قلم)</span>
            `;
            if (pandaResetPricesBtn) pandaResetPricesBtn.style.display = 'none';
        }
    }

    if (pandaChip) {
        pandaChip.style.display = isPandaActive ? 'inline-flex' : 'none';
    }
}

// دریافت یا حذف کاتالوگ برند توسط کاربر
function toggleBrandCatalog(brandName) {
    let catalogs = getDownloadedCatalogs();
    const count = getBrandItemCount(brandName);

    if (catalogs.includes(brandName)) {
        // حذف از کش
        catalogs = catalogs.filter(b => b !== brandName);
        saveDownloadedCatalogs(catalogs);
        
        if (selectedBrand === brandName) {
            selectedBrand = 'ALL';
            const allChip = document.querySelector('#brandChipsTrack .filter-chip[data-brand="ALL"]');
            if (allChip) selectBrand(allChip, 'ALL');
        }

        updatePresetDrawerUI();
        applyAllFilters();
        showNotification(`کاتالوگ «${brandName}» از لیست کالاهای شما حذف شد.`, 'info');
    } else {
        // دانلود و ذخیره در کش
        catalogs.push(brandName);
        saveDownloadedCatalogs(catalogs);

        updatePresetDrawerUI();
        applyAllFilters();
        closePresetDrawer();
        const countStr = count > 0 ? ` (${toPersianNumber(count)} قلم)` : '';
        showNotification(`کاتالوگ «${brandName}»${countStr} دریافت و در لیست شما فعال شد!`, 'success');
    }
}

// بازنشانی گروهی تمام قیمت‌های سفارشی یک برند به قیمت پایه سرور
async function resetBrandPrices(brandName) {
    if (!confirm(`آیا مطمئن هستید می‌خواهید تمام قیمت‌های دستکاری‌شده کاتالوگ «${brandName}» به قیمت رسمی کارخانه (سرور) بازنشانی شوند؟`)) {
        return;
    }

    try {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (typeof API_TOKEN !== 'undefined' && API_TOKEN) {
            headers['Authorization'] = `Bearer ${API_TOKEN}`;
        }

        const res = await fetch('http://localhost:3000/api/products/reset-brand-prices', {
            method: 'POST',
            headers,
            body: JSON.stringify({ brand: brandName })
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok) {
            closePresetDrawer();
            showNotification(data.message || `قیمت‌های «${brandName}» به حالت اولیه سرور بازگشت.`, 'success');
            setTimeout(() => window.location.reload(), 700);
        } else {
            showNotification(data.message || 'خطا در بازنشانی قیمت‌ها.', 'error');
        }
    } catch (err) {
        showNotification('خطا در ارتباط با سرور.', 'error');
    }
}

// حذف تمام کاتالوگ‌های دریافتی از کش
function clearAllDownloadedCatalogs() {
    if (!confirm('آیا از حذف تمام کاتالوگ‌های آماده از لیست خود مطمئن هستید؟ (محصولات دست‌ساز شما باقی می‌مانند)')) {
        return;
    }

    saveDownloadedCatalogs([]);
    selectedBrand = 'ALL';
    
    const allChip = document.querySelector('#brandChipsTrack .filter-chip[data-brand="ALL"]');
    if (allChip) selectBrand(allChip, 'ALL');

    updatePresetDrawerUI();
    applyAllFilters();
    closePresetDrawer();
    showNotification('تمام کاتالوگ‌های آماده از لیست شما حذف شدند.', 'success');
}

// ============================================================
// ۲. فیلترها و نمایش کارت‌ها
// ============================================================

function filterProducts() {
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
    filterProducts();
}

function selectBrand(btn, brand) {
    selectedBrand = brand;
    
    const chips = document.querySelectorAll('#brandChipsTrack .filter-chip');
    chips.forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');

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
    if (searchInput) searchInput.value = '';
    searchQuery = '';

    const brandChips = document.querySelectorAll('#brandChipsTrack .filter-chip');
    brandChips.forEach(c => c.dataset.brand === 'ALL' ? c.classList.add('active') : c.classList.remove('active'));

    const categoryChips = document.querySelectorAll('#categoryChipsTrack .filter-chip');
    categoryChips.forEach(c => c.dataset.category === 'ALL' ? c.classList.add('active') : c.classList.remove('active'));

    if (clearSearchBtn) clearSearchBtn.style.display = 'none';

    applyAllFilters();
}

// اعمال فیلترها با لحاظ کردن کاتالوگ‌های دانلود شده
function applyAllFilters() {
    const downloadedCatalogs = getDownloadedCatalogs();
    const cards = document.querySelectorAll('.product-item-card');
    let visibleCount = 0;
    let totalEligibleProducts = 0;

    cards.forEach(card => {
        const name = (card.dataset.name || '').toLowerCase();
        const brand = card.dataset.brand || '';
        const category = card.dataset.category || '';
        const isCustom = card.dataset.iscustom === 'true';
        const isGlobal = card.dataset.isglobal === 'true';

        // قانون:
        // ۱. کالای اختصاصی کاربر (isCustom) همیشه فعال است.
        // ۲. کالای کاتالوگ شرکتی (isGlobal) فقط اگر برند آن در کش دانلود شده باشد فعال است.
        const isCatalogActive = isCustom || (isGlobal && downloadedCatalogs.includes(brand));

        if (!isCatalogActive) {
            card.style.display = 'none';
            return;
        }

        totalEligibleProducts++;

        // فیلتر برند / کالاهای من
        let matchBrand = false;
        if (selectedBrand === 'ALL') {
            matchBrand = true;
        } else if (selectedBrand === 'MY_PRODUCTS') {
            matchBrand = isCustom;
        } else {
            matchBrand = (brand === selectedBrand);
        }

        // فیلتر دسته
        const matchCategory = (selectedCategory === 'ALL' || category === selectedCategory);

        // فیلتر جستجو
        const matchSearch = (!searchQuery || 
            name.includes(searchQuery) || 
            brand.toLowerCase().includes(searchQuery) || 
            category.toLowerCase().includes(searchQuery));

        if (matchBrand && matchCategory && matchSearch) {
            card.style.display = '';
            visibleCount++;
        } else {
            card.style.display = 'none';
        }
    });

    // مدیریت استیت خالی
    if (emptyCatalogState) {
        emptyCatalogState.style.display = (totalEligibleProducts === 0) ? 'flex' : 'none';
    }

    if (noProductsFound) {
        noProductsFound.style.display = (totalEligibleProducts > 0 && visibleCount === 0) ? 'flex' : 'none';
    }

    if (headerProductCount) {
        headerProductCount.textContent = `${toPersianNumber(visibleCount)} محصول فعال`;
    }
}

// ============================================================
// ۳. کشوی کاتالوگ‌ها
// ============================================================

function openPresetDrawer() {
    const drawer = document.getElementById('presetDrawer');
    const overlay = document.getElementById('presetOverlay');
    if (drawer && overlay) {
        drawer.classList.add('show');
        overlay.classList.add('show');
    }
}

function closePresetDrawer() {
    const drawer = document.getElementById('presetDrawer');
    const overlay = document.getElementById('presetOverlay');
    if (drawer && overlay) {
        drawer.classList.remove('show');
        overlay.classList.remove('show');
    }
}

function showPresetComingSoon(brandName) {
    showNotification(`کاتالوگ رسمی «${brandName}» به زودی اضافه خواهد شد.`, 'info');
}

// ============================================================
// ۴. مودال ایجاد و ویرایش کالا
// ============================================================

function openAddProductModal() {
    document.getElementById('modalTitle').textContent = 'تعریف کالای اختصاصی جدید';
    document.getElementById('modalSubmitBtn').textContent = 'ثبت و افزودن کالا';
    document.getElementById('prodId').value = '';
    document.getElementById('prodIsCustom').value = 'true';
    
    const prodName = document.getElementById('prodName');
    const prodBrand = document.getElementById('prodBrand');
    const prodCategory = document.getElementById('prodCategory');
    const prodPackSize = document.getElementById('prodPackSize');
    const prodCartonPrice = document.getElementById('prodCartonPrice');

    prodName.value = '';
    prodName.disabled = false;
    prodBrand.value = 'شخصی';
    prodBrand.disabled = false;
    prodCategory.value = 'چوبی';
    prodCategory.disabled = false;
    prodPackSize.value = '24';
    prodCartonPrice.value = '';

    updateCalcPrice();

    const deleteBtn = document.getElementById('modalDeleteBtn');
    if (deleteBtn) deleteBtn.style.display = 'none';

    const resetBtn = document.getElementById('modalResetBtn');
    if (resetBtn) resetBtn.style.display = 'none';

    document.getElementById('productModal').style.display = 'flex';
}

function openEditProductModal(button) {
    const card = button.closest('.product-item-card');
    if (!card) return;

    const id = card.dataset.id;
    const name = card.dataset.name;
    const brand = card.dataset.brand;
    const category = card.dataset.category;
    const pack = card.dataset.pack;
    const cartonPrice = card.dataset.cartonprice;
    const isCustom = card.dataset.iscustom === 'true';
    const hasCustomPrice = card.dataset.hascustomprice === 'true';

    const prodName = document.getElementById('prodName');
    const prodBrand = document.getElementById('prodBrand');
    const prodCategory = document.getElementById('prodCategory');
    const prodPackSize = document.getElementById('prodPackSize');
    const prodCartonPrice = document.getElementById('prodCartonPrice');
    const deleteBtn = document.getElementById('modalDeleteBtn');
    const resetBtn = document.getElementById('modalResetBtn');

    document.getElementById('prodId').value = id;
    document.getElementById('prodIsCustom').value = isCustom ? 'true' : 'false';
    prodName.value = name;
    prodBrand.value = brand;
    prodCategory.value = category;
    prodPackSize.value = pack;
    prodCartonPrice.value = cartonPrice;

    if (isCustom) {
        document.getElementById('modalTitle').textContent = 'ویرایش کالای اختصاصی من';
        document.getElementById('modalSubmitBtn').textContent = 'ذخیره تغییرات';
        prodName.disabled = false;
        prodBrand.disabled = false;
        prodCategory.disabled = false;
        if (deleteBtn) deleteBtn.style.display = 'flex';
        if (resetBtn) resetBtn.style.display = 'none';
    } else {
        document.getElementById('modalTitle').textContent = `تغییر قیمت فروش (${name})`;
        document.getElementById('modalSubmitBtn').textContent = 'ذخیره قیمت جدید';
        prodName.disabled = true;
        prodBrand.disabled = true;
        prodCategory.disabled = true;
        if (deleteBtn) deleteBtn.style.display = 'none';
        if (resetBtn) resetBtn.style.display = hasCustomPrice ? 'flex' : 'none';
    }

    updateCalcPrice();
    document.getElementById('productModal').style.display = 'flex';
}

function closeProductModal() {
    document.getElementById('productModal').style.display = 'none';
}

// ذخیره کالا در سرور
async function handleSaveProduct(e) {
    e.preventDefault();

    const id = document.getElementById('prodId').value;
    const isCustom = document.getElementById('prodIsCustom').value === 'true';
    const name = document.getElementById('prodName').value.trim();
    const brand = document.getElementById('prodBrand').value.trim() || 'شخصی';
    const category = document.getElementById('prodCategory').value.trim() || 'متفرقه';
    const packSize = parseInt(document.getElementById('prodPackSize').value) || 24;
    const cartonPrice = parseFloat(document.getElementById('prodCartonPrice').value) || 0;
    const unitPrice = packSize > 0 ? Math.round(cartonPrice / packSize) : 0;

    let url = 'http://localhost:3000/api/products';
    let method = 'POST';
    let payload = {};

    if (!id) {
        method = 'POST';
        payload = {
            name,
            brand,
            category,
            unitsPerCartonDefault: packSize,
            cartonPrice,
            baseUnitPrice: unitPrice
        };
    } else if (isCustom) {
        url = `http://localhost:3000/api/products/${id}`;
        method = 'PUT';
        payload = {
            name,
            brand,
            category,
            unitsPerCartonDefault: packSize,
            cartonPrice,
            baseUnitPrice: unitPrice
        };
    } else {
        url = `http://localhost:3000/api/products/${id}/custom-settings`;
        method = 'PUT';
        payload = {
            customCartonPrice: cartonPrice,
            customUnitPrice: unitPrice,
            customUnitsPerCarton: packSize
        };
    }

    try {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (typeof API_TOKEN !== 'undefined' && API_TOKEN) {
            headers['Authorization'] = `Bearer ${API_TOKEN}`;
        }

        const res = await fetch(url, {
            method,
            headers,
            body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok) {
            closeProductModal();
            showNotification(id ? 'تغییرات با موفقیت ذخیره شد.' : 'کالای جدید به لیست اضافه شد.', 'success');
            setTimeout(() => window.location.reload(), 700);
        } else {
            showNotification(data.message || 'خطا در ذخیره اطلاعات.', 'error');
        }
    } catch (err) {
        showNotification('خطا در ارتباط با سرور بک‌اند.', 'error');
    }
}

// بازنشانی قیمت تک‌محصول به قیمت پایه کارخانه
async function handleResetCurrentProductPrice() {
    const id = document.getElementById('prodId').value;
    const name = document.getElementById('prodName').value;

    if (!id) return;

    if (!confirm(`آیا می‌خواهید قیمت «${name}» به قیمت پایه رسمی کارخانه بازنشانی شود؟`)) {
        return;
    }

    try {
        const headers = { 'Accept': 'application/json' };
        if (typeof API_TOKEN !== 'undefined' && API_TOKEN) {
            headers['Authorization'] = `Bearer ${API_TOKEN}`;
        }

        const res = await fetch(`http://localhost:3000/api/products/${id}/custom-settings`, {
            method: 'DELETE',
            headers
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok) {
            closeProductModal();
            showNotification(data.message || 'قیمت به حالت اولیه کارخانه برگشت.', 'success');
            setTimeout(() => window.location.reload(), 700);
        } else {
            showNotification(data.message || 'خطا در بازنشانی قیمت.', 'error');
        }
    } catch (err) {
        showNotification('خطا در ارتباط با سرور.', 'error');
    }
}

// حذف محصول اختصاصی
async function handleDeleteCurrentProduct() {
    const id = document.getElementById('prodId').value;
    const name = document.getElementById('prodName').value;

    if (!id) return;

    if (!confirm(`آیا از حذف محصول اختصاصی «${name}» اطمینان دارید؟`)) {
        return;
    }

    try {
        const headers = { 'Accept': 'application/json' };
        if (typeof API_TOKEN !== 'undefined' && API_TOKEN) {
            headers['Authorization'] = `Bearer ${API_TOKEN}`;
        }

        const res = await fetch(`http://localhost:3000/api/products/${id}`, {
            method: 'DELETE',
            headers
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok) {
            closeProductModal();
            showNotification(`محصول «${name}» با موفقیت حذف شد.`, 'success');
            setTimeout(() => window.location.reload(), 700);
        } else {
            showNotification(data.message || 'خطا در حذف محصول.', 'error');
        }
    } catch (err) {
        showNotification('خطا در ارتباط با سرور.', 'error');
    }
}

// ============================================================
// ۵. نوتیفیکیشن
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
    if (n === null || n === undefined) return '';
    const farsiDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return n.toString().replace(/\d/g, x => farsiDigits[x]);
}

// ============================================================
// ۶. راه‌اندازی اولیه صفحه (Initialization)
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    updatePresetDrawerUI();
    applyAllFilters();
});
