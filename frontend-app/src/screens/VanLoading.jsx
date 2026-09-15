import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useLocalData } from '../lib/data.js';
import { enqueue } from '../lib/sync.js';
import { toPersianNum, onlyDigits, parseFaInt } from '../lib/format.js';
import { usePhpPage } from '../lib/usePhpPage.js';
import { DEFAULT_CATEGORIES } from '../lib/catalog.js';
import { showToast } from '../components/AppToast.jsx';

const faMoney = (n) => toPersianNum(Number(n || 0).toLocaleString('en-US'));
const CATALOGS_KEY = 'vizitik_downloaded_catalogs';

/** عین getBrandClass() در van-loading.php */
function getBrandClass(brand) {
  switch (brand) {
    case 'میهن': return 'brand-mihan';
    case 'پاندا': return 'brand-panda';
    case 'دومینو': return 'brand-domino';
    case 'کاله': return 'brand-kalleh';
    case 'حاج حسن': return 'brand-hajhasan';
    case 'پاک': return 'brand-paak';
    default: return 'brand-default';
  }
}

function downloadedBrands() {
  try {
    const raw = localStorage.getItem(CATALOGS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * بارگیری و موجودی خودرو — پورت ۱:۱ از frontend/van-loading.php + js/van-loading.js
 * (هدر van-header با دکمه فیلتر، جستجو، دو ردیف چیپ برند/دسته، کارت‌ها با data-*،
 *  استپرهای کارتن/دانه، زیرنویس مجموع، نوار چسبان پایینی و دکمه قفل)
 * در فایل PHP، nav پایین کامنت شده → این صفحه نوار پایینی ندارد.
 */
export default function VanLoading({ go }) {
  const page = usePhpPage('van');
  const { inventory, online, reload } = useLocalData();
  const [rows, setRows] = useState({}); // productId -> {cartons, units}
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState('ALL');
  const [category, setCategory] = useState('ALL');
  const [saving, setSaving] = useState(false);

  // مقدار اولیه از موجودی سرور/کش محلی (مثل $inventory در PHP)
  useEffect(() => {
    if (!inventory || !inventory.length) return;
    setRows((prev) => {
      if (Object.keys(prev).length) return prev;
      const next = {};
      inventory.forEach((it) => {
        next[it.productId] = {
          cartons: Number(it.quantityCartons || 0),
          units: Number(it.quantityUnits || 0)
        };
      });
      return next;
    });
  }, [inventory]);

  const items = useMemo(
    () =>
      (inventory || []).map((it, i) => {
        const r = rows[it.productId] || { cartons: 0, units: 0 };
        const packSize = Number(it.unitsPerCarton || 24);
        const brandName = it.brand || 'متفرقه';
        return {
          key: it.productId || `p${i}`,
          id: it.productId || `p${i}`,
          name: it.productName || '',
          brand: brandName,
          category: it.category || 'سایر',
          packSize,
          cartonPrice: Number(it.cartonPrice || 0),
          unitPrice: Number(it.unitPrice || 0),
          cartons: Number(r.cartons || 0),
          units: Number(r.units || 0),
          isCustom: !!it.isCustomUserProduct,
          isGlobal: !!it.isGlobal
        };
      }),
    [inventory, rows]
  );

  const brands = useMemo(() => Array.from(new Set(items.map((i) => i.brand))).sort(), [items]);
  // van-loading.php: the chip list is the product data, and falls back to
  // $defaultCategories when nothing is loaded yet - otherwise the chips vanish
  const categories = useMemo(() => {
    const fromData = Array.from(new Set(items.map((i) => i.category))).sort();
    return fromData.length ? fromData : DEFAULT_CATEGORIES;
  }, [items]);

  const downloaded = useMemo(() => downloadedBrands(), []);

  // فیلتر اولیه: فقط کالاهایی که کاربر اضافه کرده (سفارشی) یا از کاتالوگ دانلود کرده
  const eligible = useMemo(
    () => items.filter((p) => p.isCustom || downloaded.includes(p.brand)),
    [items, downloaded]
  );

  const visible = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    const showLoadedOnly = brand === 'LOADED_ONLY';
    return eligible.filter((c) => {
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.brand.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q);
      let matchBrand = true;
      if (brand === 'MY_PRODUCTS') matchBrand = c.isCustom;
      else if (brand === 'ALL' || brand === 'LOADED_ONLY') matchBrand = true;
      else matchBrand = c.brand === brand;
      const matchCat = category === 'ALL' || c.category === category;
      const matchLoaded = !showLoadedOnly || c.cartons > 0 || c.units > 0;
      return matchSearch && matchBrand && matchCat && matchLoaded;
    });
  }, [eligible, search, brand, category]);

  // updateGlobalSummary() در js/van-loading.js — روی کالاهای واجد شرایط
  const summary = useMemo(() => {
    let totalCartons = 0;
    let totalUnits = 0;
    let totalValue = 0;
    eligible.forEach((c) => {
      totalCartons += c.cartons;
      totalUnits += c.units;
      totalValue += c.cartons * c.cartonPrice + c.units * c.unitPrice;
    });
    return { totalCartons, totalUnits, totalValue };
  }, [eligible]);

  const noFound = visible.length === 0 && eligible.length > 0;

  function setQty(id, type, val) {
    setRows((prev) => {
      const cur = { cartons: 0, units: 0, ...(prev[id] || {}) };
      const n = Math.max(0, parseFaInt(val, 0));
      return { ...prev, [id]: { ...cur, [type]: n } };
    });
  }

  function changeQty(id, type, delta) {
    setRows((prev) => {
      const cur = { cartons: 0, units: 0, ...(prev[id] || {}) };
      return { ...prev, [id]: { ...cur, [type]: Math.max(0, (cur[type] || 0) + delta) } };
    });
  }

  function selectBrandChip(value) {
    setBrand((cur) => (cur === value ? 'ALL' : value));
  }

  async function saveAndLockInventory() {
    if (saving) return;
    setSaving(true);
    const payload = {
      items: eligible.map((c) => ({
        productId: c.id,
        quantityCartons: c.cartons,
        quantityUnits: c.units
      }))
    };
    try {
      if (!navigator.onLine) throw new Error('offline');
      await api('/van-inventory/bulk', { method: 'PUT', body: payload, timeout: 20000 });
      showToast('موجودی خودرو با موفقیت ثبت و در سیستم قفل شد.', 'success');
      setTimeout(() => reload(), 800); // window.location.reload() در PHP
    } catch (err) {
      if (String(err.message).includes('offline')) {
        await enqueue('VAN_BULK', payload);
        showToast('آفلاین — بارگیری در صف همگام‌سازی ثبت شد.', 'warning');
      } else {
        showToast(err.message || 'خطا در برقراری ارتباط با سرور.', 'error');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* هدر صفحه بارگیری خودرو */}
      <header className="van-header">
        <div className="header-top-row">
          <button
            type="button"
            className={`header-filter-btn ${brand === 'LOADED_ONLY' ? 'active' : ''}`.trim()}
            id="toggleLoadedOnlyBtn"
            title="نمایش فقط اقلام بارگیری‌شده"
            onClick={() => selectBrandChip('LOADED_ONLY')}
          >
            <span className="material-symbols-outlined">inventory_2</span>
          </button>
          <div className="header-title-box">
            <h1>{page.h1}</h1>
            <span className="header-sub" id="headerSubSummary">
              {toPersianNum(summary.totalCartons)} کارتن و {toPersianNum(summary.totalUnits)} دانه در ماشین
            </span>
          </div>

          <a href="#/dash" className="back-btn" aria-label="بازگشت به داشبورد" onClick={(e) => { e.preventDefault(); go('dash'); }}>
            <span className="material-symbols-outlined">arrow_forward</span>
          </a>
        </div>

        {/* نوار جستجوی سریع */}
        <div className="search-box">
          <span className="material-symbols-outlined search-icon">search</span>
          <input
            type="text"
            id="searchInput"
            placeholder="جستجوی نام بستنی، برند یا دسته..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search.length > 0 && (
            <button id="clearSearchBtn" className="clear-search-btn" type="button" onClick={() => setSearch('')}>
              <span className="material-symbols-outlined">cancel</span>
            </button>
          )}
        </div>

        {/* ردیف ۱ فیلترها: برندها و کالاهای من */}
        <div className="chips-scroll-container">
          <span className="chips-label">برند:</span>
          <div className="chips-track" id="brandChipsTrack">
            <button type="button" className={`filter-chip ${brand === 'ALL' ? 'active' : ''}`} data-brand="ALL" onClick={() => setBrand('ALL')}>
              همه کالاها
            </button>

            <button
              type="button"
              className={`filter-chip my-products-chip ${brand === 'MY_PRODUCTS' ? 'active' : ''}`}
              data-brand="MY_PRODUCTS"
              onClick={() => selectBrandChip('MY_PRODUCTS')}
            >
              <span className="material-symbols-outlined chip-icon">stars</span>
              <span>کالاهای من</span>
            </button>

            {/* چیپ نمایش فقط بارگیری‌شده‌ها */}
            <button
              type="button"
              className={`filter-chip loaded-filter-chip ${brand === 'LOADED_ONLY' ? 'active' : ''}`}
              id="loadedFilterChip"
              data-brand="LOADED_ONLY"
              onClick={() => selectBrandChip('LOADED_ONLY')}
            >
              <span className="material-symbols-outlined chip-icon">check_box</span>
              <span>فقط بارگیری‌شده‌ها</span>
            </button>

            {brands.map((b) => (
              <button
                key={b}
                type="button"
                className={`filter-chip ${brand === b ? 'active' : ''}`}
                data-brand={b}
                onClick={() => selectBrandChip(b)}
              >
                {b}
              </button>
            ))}
          </div>
        </div>

        {/* ردیف ۲ فیلترها: دسته‌بندی‌ها */}
        <div className="chips-scroll-container">
          <span className="chips-label">دسته:</span>
          <div className="chips-track" id="categoryChipsTrack">
            <button type="button" className={`filter-chip ${category === 'ALL' ? 'active' : ''}`} data-category="ALL" onClick={() => setCategory('ALL')}>
              همه دسته‌ها
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`filter-chip ${category === c ? 'active' : ''}`}
                data-category={c}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* محتوای لیست کالاها و استپرهای بارگیری */}
      <main className="van-content" id="inventoryList">
        {items.length === 0 ? (
          <div className="empty-inventory-state">
            <div className="empty-icon-box">
              <span className="material-symbols-outlined">local_shipping</span>
            </div>
            <h3>کالایی در سیستم یافت نشد</h3>
            <p>ابتدا از بخش کاتالوگ کالاها، محصولات را به لیست خود اضافه کنید.</p>
            <a href="#/products" className="empty-action-btn" onClick={(e) => { e.preventDefault(); go('products'); }}>
              <span className="material-symbols-outlined">inventory_2</span>
              <span>رفتن به کاتالوگ کالاها</span>
            </a>
          </div>
        ) : (
          visible.map((item, i) => {
            const totalSingle = item.cartons * item.packSize + item.units;
            const isLoaded = item.cartons > 0 || item.units > 0;
            return (
              <article
                key={item.key}
                className={`van-card ${isLoaded ? 'is-loaded' : ''}`.trim()}
                data-id={item.id}
                data-name={item.name}
                data-brand={item.brand}
                data-category={item.category}
                data-pack={item.packSize}
                data-cartonprice={item.cartonPrice}
                data-unitprice={item.unitPrice}
                data-iscustom={item.isCustom ? 'true' : 'false'}
                data-isglobal={item.isGlobal ? 'true' : 'false'}
                data-cartons={item.cartons}
                data-units={item.units}
                style={{ animationDelay: `${Math.min(i * 0.02, 0.4)}s` }}
              >
                {/* ردیف بالای کارت: مشخصات و قیمت */}
                <div className="van-card-top">
                  <div className={`product-icon-wrap ${item.isCustom ? 'custom-wrap' : ''}`.trim()}>
                    <span className="material-symbols-outlined">{item.isCustom ? 'star' : 'icecream'}</span>
                  </div>

                  <div className="product-main-details">
                    <h2 className="product-item-title">{item.name}</h2>
                    <div className="product-badges-row">
                      {item.isCustom && <span className="badge-custom">⭐ کالای من</span>}
                      <span className={`badge-brand ${getBrandClass(item.brand)}`}>{item.brand}</span>
                      <span className="badge-pack">{toPersianNum(item.packSize)} عددی</span>
                    </div>
                  </div>

                  <div className="product-price-badge">
                    <span className="price-val">
                      {faMoney(item.cartonPrice)} <small>تومان</small>
                    </span>
                    <span className="price-unit-sub">دانه: {faMoney(item.unitPrice)} ت</span>
                  </div>
                </div>

                {/* ردیف استپرها (انتخابگرهای ۲ گانه کارتن و دانه) */}
                <div className="steppers-grid">
                  <div className="stepper-box carton-stepper">
                    <div className="stepper-label">
                      <span className="material-symbols-outlined">inventory_2</span>
                      <span>کارتن</span>
                    </div>
                    <div className="stepper-controls">
                      <button type="button" className="step-btn step-down" aria-label="کاهش کارتن" onClick={() => changeQty(item.id, 'cartons', -1)}>
                        <span className="material-symbols-outlined">remove</span>
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="step-input carton-input"
                        id={`carton_${item.id}`}
                        value={item.cartons}
                        onChange={(e) => setQty(item.id, 'cartons', onlyDigits(e.target.value))}
                      />
                      <button type="button" className="step-btn step-up" aria-label="افزایش کارتن" onClick={() => changeQty(item.id, 'cartons', 1)}>
                        <span className="material-symbols-outlined">add</span>
                      </button>
                    </div>
                  </div>

                  <div className="stepper-box unit-stepper">
                    <div className="stepper-label">
                      <span className="material-symbols-outlined">icecream</span>
                      <span>دانه / تکی</span>
                    </div>
                    <div className="stepper-controls">
                      <button type="button" className="step-btn step-down" aria-label="کاهش دانه" onClick={() => changeQty(item.id, 'units', -1)}>
                        <span className="material-symbols-outlined">remove</span>
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="step-input unit-input"
                        id={`unit_${item.id}`}
                        value={item.units}
                        onChange={(e) => setQty(item.id, 'units', onlyDigits(e.target.value))}
                      />
                      <button type="button" className="step-btn step-up" aria-label="افزایش دانه" onClick={() => changeQty(item.id, 'units', 1)}>
                        <span className="material-symbols-outlined">add</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* زیرنویس محاسبه مجموع موجودی این کالا */}
                <div className="card-calc-footer" id={`calcFooter_${item.id}`}>
                  <span>
                    مجموع بارگیری این کالا:{' '}
                    <strong className="total-units-text">{toPersianNum(totalSingle)} عدد</strong>
                  </span>
                  {item.cartons > 0 && item.units > 0 && (
                    <small>
                      ({toPersianNum(item.cartons)} کارتن + {toPersianNum(item.units)} دانه)
                    </small>
                  )}
                </div>
              </article>
            );
          })
        )}

        {/* استیت عدم یافت کالا */}
        <div id="noInventoryFound" className="empty-products-box" style={{ display: noFound ? 'flex' : 'none' }}>
          <span className="material-symbols-outlined">search_off</span>
          <p>هیچ کالایی با این فیلتر یا جستجو یافت نشد</p>
          <button type="button" onClick={() => { setBrand('ALL'); setCategory('ALL'); setSearch(''); }} className="reset-filter-btn">
            نمایش همه کالاها
          </button>
        </div>
      </main>

      {/* کانتینر چسبان پایینی (Sticky Summary & Lock Inventory Bar) */}
      <footer className="van-sticky-bar" id="vanStickyBar">
        <div className="sticky-summary-box">
          <div className="summary-counts-row">
            <div className="count-badge cartons-badge">
              <span className="material-symbols-outlined">inventory_2</span>
              <strong id="stickyTotalCartons">{toPersianNum(summary.totalCartons)}</strong>
              <small>کارتن</small>
            </div>

            <div className="count-badge units-badge">
              <span className="material-symbols-outlined">icecream</span>
              <strong id="stickyTotalUnits">{toPersianNum(summary.totalUnits)}</strong>
              <small>دانه</small>
            </div>
          </div>

          <div className="summary-value-row">
            <span className="value-label">ارزش کل بار:</span>
            <strong className="value-amount" id="stickyTotalValue">
              {faMoney(summary.totalValue)} تومان
            </strong>
          </div>
        </div>

        {/* دکمه قفل و ثبت نهایی موجودی ماشین */}
        <button type="button" className="van-lock-btn" id="lockInventoryBtn" disabled={saving} onClick={saveAndLockInventory}>
          <span className={`material-symbols-outlined ${saving ? 'spin-icon' : ''}`.trim()}>{saving ? 'sync' : 'lock_clock'}</span>
          <span>{saving ? 'در حال ثبت موجودی...' : 'ثبت و قفل موجودی خودرو'}</span>
        </button>
      </footer>
    </>
  );
}
