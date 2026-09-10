import { useEffect, useMemo, useState } from 'react';
import { api, apiSilent } from '../lib/api.js';
import { useLocalData } from '../lib/data.js';
import { toPersianNum, parseFaNumber, parseFaInt, onlyDigits } from '../lib/format.js';
import { usePhpPage } from '../lib/usePhpPage.js';
import { DEFAULT_CATEGORIES, CATEGORY_OPTIONS, PRESET_BRANDS } from '../lib/catalog.js';
import { showToast } from '../components/AppToast.jsx';

const fa = (n) => toPersianNum(Number(n || 0).toLocaleString('en-US'));
// products.js: unitPrice = packSize > 0 ? Math.round(cartonPrice / packSize) : 0
// با پارس فارسی‌فهم تا «۷۲۰٬۰۰۰» هم درست محاسبه شود، نه صفر.
const unitPriceOf = (m) => {
  const pack = parseFaInt(m.unitsPerCarton, 0);
  const carton = parseFaNumber(m.cartonPrice, 0);
  return pack > 0 ? Math.round(carton / pack) : 0;
};
const CATALOGS_KEY = 'vizitik_downloaded_catalogs';

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

/** کاتالوگ‌های آماده — همان ۶ کارتِ preset-list در products.php */
const PRESETS = [
  { brand: 'میهن', cls: 'mihan', id: 'presetCardMihan', title: 'کاتالوگ رسمی بستنی میهن', sub: 'شامل کترینگ، میرکس، فروتاره و...', downloadable: true, btnId: 'mihanDownloadBtn', resetId: 'mihanResetPricesBtn' },
  { brand: 'پاندا', cls: 'panda', id: 'presetCardPanda', title: 'کاتالوگ بستنی پاندا', sub: 'محصولات کترینگ ۴ کیلویی', downloadable: true, btnId: 'pandaDownloadBtn', resetId: 'pandaResetPricesBtn' },
  { brand: 'دومینو', cls: 'domino', title: 'کاتالوگ رسمی دومینو' },
  { brand: 'کاله', cls: 'kalleh', title: 'کاتالوگ رسمی بستنی کاله' },
  { brand: 'حاج حسن', cls: 'hajhasan', title: 'بستنی سنتی حاج حسن' },
  { brand: 'پاک', cls: 'paak', title: 'کاتالوگ رسمی بستنی پاک' }
];

/**
 * لیست کالاها و کاتالوگ — پورت ۱:۱ از frontend/products.php
 * (کشوی کاتالوگ‌های رسمی با یادآوری نقش سامانه، هدر با چیپ‌های برند/دسته،
 *  کارت‌های کالا با بج‌ها، استیت خالی، FAB افزودن کالا و مودال ثبت/ویرایش)
 */
export default function Products({ go }) {
  const page = usePhpPage('products');
  const { online, reload } = useLocalData();
  const [products, setProducts] = useState([]);
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState('ALL');
  const [category, setCategory] = useState('ALL');
  const [modal, setModal] = useState({ open: false, mode: 'add', data: {} });
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CATALOGS_KEY);
      setDownloaded(raw ? JSON.parse(raw) : []);
    } catch {
      setDownloaded([]);
    }
  }, []);

  async function refresh() {
    const list = await apiSilent('/products');
    if (Array.isArray(list)) setProducts(list);
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const items = useMemo(
    () =>
      (products || []).map((p, i) => {
        // بک‌اند قیمتِ موثر (custom یا پایه) را در unitsPerCarton/cartonPrice/baseUnitPrice می‌دهد؛
        // اگر فیلدی جا افتاد، از ترکیب همان مقادیر موثر بازسازی می‌شود — نه از پیش‌فرض کارخانه.
        const packSize = Number(p.unitsPerCarton ?? p.unitsPerCartonDefault ?? 24) || 24;
        const unitPrice = Number(p.baseUnitPrice ?? p.unitPrice ?? 0) || 0;
        const cartonPrice = Number(p.cartonPrice ?? unitPrice * packSize ?? 0) || 0;
        return {
          id: p.id || `p${i}`,
          name: p.name || '',
          brand: p.brand || 'متفرقه',
          category: p.category || 'سایر',
          packSize,
          cartonPrice,
          unitPrice,
          imageUrl: p.imageUrl || null,
          isGlobal: !!p.isGlobal,
          isCustom: !!p.isCustomUserProduct,
          hasCustomPrice: !!p.hasCustomPrice
        };
      }),
    [products]
  );

  const brands = useMemo(() => Array.from(new Set(items.map((i) => i.brand))).filter((b) => b !== 'میهن' && b !== 'پاندا'), [items]);
  // products.php: the chip row is the fixed $defaultCategories list, never a derived one
  const categories = DEFAULT_CATEGORIES;
  // products.php: $myCustomCount فقط کالاهای اختصاصی خود کاربر است
  const myCount = items.filter((i) => i.isCustom).length;

  // products.js → applyAllFilters: کالای اختصاصی همیشه فعال است؛
  // کالای کاتالوگ شرکتی فقط وقتی دیده می‌شود که کاتالوگ برندش دانلود شده باشد.
  const eligible = useMemo(
    () => items.filter((p) => p.isCustom || downloaded.includes(p.brand)),
    [items, downloaded]
  );

  const visible = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    return eligible.filter((p) => {
      const matchSearch = !q || p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
      let matchBrand = true;
      // products.js: در حالت MY_PRODUCTS فقط isCustom قبول است
      if (brand === 'MY_PRODUCTS') matchBrand = p.isCustom;
      else if (brand !== 'ALL') matchBrand = p.brand === brand;
      const matchCat = category === 'ALL' || p.category === category;
      return matchSearch && matchBrand && matchCat;
    });
  }, [eligible, search, brand, category]);

  async function toggleBrandCatalog(brandName) {
    // products.js → toggleBrandCatalog
    const count = items.filter((i) => i.brand === brandName).length;
    if (downloaded.includes(brandName)) {
      const next = downloaded.filter((b) => b !== brandName);
      setDownloaded(next);
      localStorage.setItem(CATALOGS_KEY, JSON.stringify(next));
      if (brand === brandName) setBrand('ALL');
      showToast(`کاتالوگ «${brandName}» از لیست کالاهای شما حذف شد.`, 'info');
    } else {
      const next = [...downloaded, brandName];
      setDownloaded(next);
      localStorage.setItem(CATALOGS_KEY, JSON.stringify(next));
      setDrawer(false);
      const countStr = count > 0 ? ` (${toPersianNum(count)} قلم)` : '';
      showToast(`کاتالوگ «${brandName}»${countStr} دریافت و در لیست شما فعال شد!`, 'success');
    }
    await reload({ sync: true });
  }

  // products.js → resetBrandPrices: بازنشانی واقعی قیمت‌های یک برند در سرور
  async function resetBrandPrices(brandName) {
    if (!window.confirm(`آیا مطمئن هستید می‌خواهید تمام قیمت‌های دستکاری‌شده کاتالوگ «${brandName}» به قیمت رسمی کارخانه (سرور) بازنشانی شوند؟`)) return;
    try {
      const data = await api('/products/reset-brand-prices', { method: 'POST', body: { brand: brandName } });
      setDrawer(false);
      showToast((data && data.message) || `قیمت‌های «${brandName}» به حالت اولیه سرور بازگشت.`, 'success');
      await refresh();
      await reload({ sync: true });
    } catch (err) {
      showToast(err.message || 'خطا در بازنشانی قیمت‌ها.', 'error');
    }
  }

  async function clearAllDownloadedCatalogs() {
    // products.js → clearAllDownloadedCatalogs
    if (!window.confirm('آیا از حذف تمام کاتالوگ‌های آماده از لیست خود مطمئن هستید؟ (محصولات دست‌ساز شما باقی می‌مانند)')) return;
    setDownloaded([]);
    localStorage.setItem(CATALOGS_KEY, '[]');
    setBrand('ALL');
    setDrawer(false);
    showToast('تمام کاتالوگ‌های آماده از لیست شما حذف شدند.', 'success');
    await reload({ sync: true });
  }

  function openAddProductModal() {
    // products.js → openAddProductModal: برند پیش‌فرض «شخصی»، دسته «چوبی»، تعداد ۲۴
    setModal({ open: true, mode: 'add', data: { name: '', brand: 'شخصی', category: 'چوبی', unitsPerCarton: 24, cartonPrice: '' } });
  }

  function openEditProductModal(p) {
    setModal({
      open: true,
      mode: 'edit',
      data: { id: p.id, name: p.name, brand: p.brand || '', category: p.category, unitsPerCarton: p.packSize, cartonPrice: p.cartonPrice, isCustom: p.isCustom, hasCustomPrice: p.hasCustomPrice }
    });
  }

  const m = modal.data;
  const setM = (patch) => setModal((s) => ({ ...s, data: { ...s.data, ...patch } }));

  async function handleSaveProduct(e) {
    e.preventDefault();
    setBusy(true);
    // names must match CreateProductDto: the quantity is unitsPerCartonDefault,
    // sending "unitsPerCarton" makes the api answer "تعداد در کارتن الزامی است"
    // پارس فارسی‌فهم: «۷۲۰٬۰۰۰» و «720,000» هر دو درست خوانده می‌شوند.
    const packSize = Math.max(1, parseFaInt(m.unitsPerCarton, 24));
    const cartonPrice = Math.max(0, parseFaNumber(m.cartonPrice, 0));
    const unitPrice = packSize > 0 ? Math.round(cartonPrice / packSize) : 0;
    const payload = {
      name: (m.name || '').trim(),
      brand: (m.brand || '').trim() || 'شخصی',
      category: (m.category || '').trim() || 'متفرقه',
      unitsPerCartonDefault: packSize,
      cartonPrice,
      baseUnitPrice: unitPrice
    };
    try {
      if (modal.mode === 'edit' && m.id) {
        if (m.isCustom) await api(`/products/${m.id}`, { method: 'PUT', body: payload });
        else {
          // a global product: only the visitor's own price may change (PUT /custom-settings)
          await api(`/products/${m.id}/custom-settings`, {
            method: 'PUT',
            body: {
              customCartonPrice: cartonPrice,
              customUnitPrice: unitPrice,
              customUnitsPerCarton: packSize
            }
          });
        }
      } else await api('/products', { method: 'POST', body: payload });
      setModal({ open: false, mode: 'add', data: {} });
      showToast('اطلاعات کالا با موفقیت ذخیره شد.', 'success');
      await refresh();
      await reload({ sync: true });
    } catch (err) {
      showToast(err.message || 'خطا در ذخیره کالا.', 'error');
    } finally {
      setBusy(false);
    }
  }

  // handleResetCurrentProductPrice in products.js: drops this visitor's custom price
  async function handleResetCurrentProductPrice() {
    if (!m.id) return;
    if (!window.confirm(`آیا می‌خواهید قیمت «${m.name}» به قیمت پایه رسمی کارخانه بازنشانی شود؟`)) return;
    try {
      await api(`/products/${m.id}/custom-settings`, { method: 'DELETE' });
      setModal({ open: false, mode: 'add', data: {} });
      showToast('قیمت به پایه کارخانه بازنشانی شد.', 'success');
      await refresh();
      await reload({ sync: true });
    } catch (err) {
      showToast(err.message || 'خطا در بازنشانی قیمت.', 'error');
    }
  }

  async function handleDeleteProduct() {
    if (!m.id) return;
    if (!window.confirm(`آیا از حذف محصول اختصاصی «${m.name}» اطمینان دارید؟`)) return;
    try {
      await api(`/products/${m.id}`, { method: 'DELETE' });
      setModal({ open: false, mode: 'add', data: {} });
      showToast('کالا حذف شد.', 'success');
      await refresh();
      await reload({ sync: true });
    } catch (err) {
      showToast(err.message || 'خطا در حذف کالا.', 'error');
    }
  }

  return (
    <>
      {/* Overlay و کشوی انتخاب و دانلود کاتالوگ‌های آماده */}
      <div className={`menu-overlay ${drawer ? 'show' : ''}`} id="presetOverlay" onClick={() => setDrawer(false)}></div>

      <aside className={`preset-drawer ${drawer ? 'show' : ''}`} id="presetDrawer">
        <div className="preset-drawer-header">
          <div className="preset-drawer-title">
            <span className="material-symbols-outlined">cloud_download</span>
            <span>کاتالوگ‌های رسمی شرکت‌ها</span>
          </div>
          <button className="preset-drawer-close" type="button" onClick={() => setDrawer(false)} aria-label="بستن">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <p className="preset-drawer-desc">برای اضافه شدن کالاهای هر شرکت به لیست فروش خود، دکمه دریافت را بزنید:</p>

        {/* یادآوری نقش و مسئولیت سامانه در بخش کاتالوگ */}
        <div className="catalog-role-notice">
          <div className="catalog-role-title">
            <span className="material-symbols-outlined">info</span>
            <strong>نقش این بخش چیست؟</strong>
          </div>
          <p>
            کاتالوگ‌های دریافت‌شده در اینجا فقط یک <strong>فهرست مرجع از کالاها و قیمت‌ها</strong> برای سرعت کار شما هستند و جایگزین
            سامانهٔ رسمی ثبت سفارشِ شرکت نمی‌شوند.
          </p>
          <p>
            ویزیتیک یک <strong>دستیار اطلاع‌رسانی به فروشگاه‌ها</strong> است: فاکتورِ صادرهٔ خودتان را از طریق ربات بله برای مشتری ارسال
            می‌کنید و مبلغ، نحوهٔ تسویه و ماندهٔ حساب را اعلام می‌کنید.
          </p>
          <p className="catalog-role-foot">
            ثبت فاکتور رسمی و <strong>عواقب قانونی و مالی آن بر عهدهٔ خودِ ویزیتور</strong> است؛ برای اسناد رسمی و مراجع قانونی، فاکتور
            باید همچنان در سامانهٔ مورد استفادهٔ شرکت شما ثبت شود.
          </p>
        </div>

        <div className="preset-list" id="presetCatalogList">
          {PRESETS.map((p) =>
            p.downloadable ? (
              <div className={`preset-card ${p.cls} ${downloaded.includes(p.brand) ? 'active-catalog' : ''}`} id={p.id} key={p.brand}>
                <div className="preset-card-top">
                  <div className={`preset-brand-badge ${p.cls}`}>{p.brand}</div>
                  <div className="preset-brand-meta">
                    <strong>{p.title}</strong>
                    <span>{p.sub}</span>
                  </div>
                </div>
                <div className="preset-card-actions">
                  <button type="button" className="preset-action-btn download-btn" id={p.btnId} onClick={() => toggleBrandCatalog(p.brand)}>
                    <span className="material-symbols-outlined">{downloaded.includes(p.brand) ? 'cloud_off' : 'cloud_download'}</span>
                    <span className="btn-text">
                      {downloaded.includes(p.brand)
                        ? `حذف کاتالوگ ${p.brand}`
                        : `دریافت کاتالوگ ${p.brand} (${toPersianNum(items.filter((i) => i.brand === p.brand).length)} قلم)`}
                    </span>
                  </button>
                </div>
                {downloaded.includes(p.brand) && (
                  <button type="button" className="preset-reset-prices-btn" id={p.resetId} onClick={() => resetBrandPrices(p.brand)}>
                    <span className="material-symbols-outlined">restart_alt</span>
                    <span>بازنشانی قیمت‌های {p.brand} به پیش‌فرض کارخانه</span>
                  </button>
                )}
              </div>
            ) : (
              <div className={`preset-card ${p.cls} disabled-card`} key={p.brand} onClick={() => showToast(`کاتالوگ ${p.brand} به‌زودی در آپدیت بعدی اضافه می‌شود.`, 'info')}>
                <div className="preset-card-top">
                  <div className={`preset-brand-badge ${p.cls}`}>{p.brand}</div>
                  <div className="preset-brand-meta">
                    <strong>{p.title}</strong>
                    <span className="coming-soon-tag">به‌زودی در آپدیت بعدی</span>
                  </div>
                </div>
              </div>
            )
          )}
        </div>

        {/* دکمه حذف تمام کاتالوگ‌های دانلود شده از کش */}
        <div className="preset-drawer-footer">
          <button type="button" className="preset-clear-all-btn" onClick={clearAllDownloadedCatalogs}>
            <span className="material-symbols-outlined">delete_sweep</span>
            <span>حذف تمام کاتالوگ‌های دریافتی از لیست من</span>
          </button>
        </div>
      </aside>

      {/* هدر صفحه */}
      <header className="products-header">
        <div className="header-top-row">
          <button className="preset-toggle-btn" id="presetToggleBtn" type="button" title="مشاهده کاتالوگ شرکت‌ها" onClick={() => setDrawer(true)}>
            <span className="material-symbols-outlined">menu</span>
          </button>

          <div className="header-title-box">
            <h1>{page.h1}</h1>
            <span className="header-sub" id="headerProductCount">
              {toPersianNum(visible.length)} محصول فعال
            </span>
          </div>

          <a href="#/dash" className="back-btn" aria-label="بازگشت به داشبورد" onClick={(e) => { e.preventDefault(); go('dash'); }}>
            <span className="material-symbols-outlined">arrow_forward</span>
          </a>
        </div>

        {/* نوار جستجوی سریع */}
        <div className="search-box">
          <span className="material-symbols-outlined search-icon">search</span>
          <input type="text" id="searchInput" placeholder="جستجوی نام بستنی، برند یا دسته..." value={search} onChange={(e) => setSearch(e.target.value)} />
          {search.length > 0 && (
            <button id="clearSearchBtn" className="clear-search-btn" type="button" onClick={() => setSearch('')}>
              <span className="material-symbols-outlined">cancel</span>
            </button>
          )}
        </div>

        {/* ردیف ۱ فیلترها: فیلتر برندها و کالاهای اختصاصی من */}
        <div className="chips-scroll-container">
          <span className="chips-label">برند:</span>
          <div className="chips-track" id="brandChipsTrack">
            <button className={`filter-chip ${brand === 'ALL' ? 'active' : ''}`} data-brand="ALL" type="button" onClick={() => setBrand('ALL')}>
              همه کالاها
            </button>

            <button className={`filter-chip my-products-chip ${brand === 'MY_PRODUCTS' ? 'active' : ''}`} data-brand="MY_PRODUCTS" type="button" onClick={() => setBrand('MY_PRODUCTS')}>
              <span className="material-symbols-outlined chip-icon">stars</span>
              <span>کالاهای من ({toPersianNum(myCount)})</span>
            </button>

            <button className={`filter-chip brand-chip-mihan ${brand === 'میهن' ? 'active' : ''}`} data-brand="میهن" type="button" style={{ display: downloaded.includes('میهن') ? '' : 'none' }} onClick={() => setBrand('میهن')}>
              میهن
            </button>

            <button className={`filter-chip brand-chip-panda ${brand === 'پاندا' ? 'active' : ''}`} data-brand="پاندا" type="button" style={{ display: downloaded.includes('پاندا') ? '' : 'none' }} onClick={() => setBrand('پاندا')}>
              پاندا
            </button>

            {brands.map((b) => (
              <button key={b} className={`filter-chip ${brand === b ? 'active' : ''}`} data-brand={b} type="button" onClick={() => setBrand(b)}>
                {b}
              </button>
            ))}
          </div>
        </div>

        {/* ردیف ۲ فیلترها: دسته‌بندی‌ها */}
        <div className="chips-scroll-container">
          <span className="chips-label">دسته:</span>
          <div className="chips-track" id="categoryChipsTrack">
            <button className={`filter-chip ${category === 'ALL' ? 'active' : ''}`} data-category="ALL" type="button" onClick={() => setCategory('ALL')}>
              همه دسته‌ها
            </button>
            {categories.map((c) => (
              <button key={c} className={`filter-chip ${category === c ? 'active' : ''}`} data-category={c} type="button" onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* لیست کالاها */}
      <main className="products-content" id="productsList">
        {eligible.length === 0 && (
          <div className="empty-catalog-state" id="emptyCatalogState" style={{ display: 'flex' }}>
            <div className="empty-icon-box">
              <span className="material-symbols-outlined">cloud_download</span>
            </div>
            <h3>کاتالوگی دریافت نکرده‌اید</h3>
            <p>
              برای شروع می‌توانید کاتالوگ شرکت‌ها (میهن، پاندا و...) را با یک کلیک دریافت کنید یا با دکمه (+) کالای اختصاصی جدید بسازید.
            </p>
            <button type="button" className="empty-action-btn" onClick={() => setDrawer(true)}>
              <span className="material-symbols-outlined">cloud_download</span>
              <span>دریافت کاتالوگ آماده شرکت‌ها</span>
            </button>
          </div>
        )}

        {visible.map((item) => (
          <article
            key={item.id}
            className="product-item-card"
            style={{ display: '' }}
            data-id={item.id}
            data-name={item.name}
            data-brand={item.brand}
            data-category={item.category}
            data-pack={item.packSize}
            data-cartonprice={item.cartonPrice}
            data-unitprice={item.unitPrice}
            data-isglobal={item.isGlobal ? 'true' : 'false'}
            data-iscustom={item.isCustom ? 'true' : 'false'}
            data-hascustomprice={item.hasCustomPrice ? 'true' : 'false'}
          >
            <div className="product-item-top">
              <div className={`product-icon-wrap ${item.isCustom ? 'custom-wrap' : ''}`.trim()}>
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} className="product-card-img" />
                ) : (
                  <span className="material-symbols-outlined">{item.isCustom ? 'star' : 'icecream'}</span>
                )}
              </div>

              <div className="product-main-details">
                <h2 className="product-item-title">{item.name}</h2>
                <div className="product-badges-row">
                  {item.isCustom && <span className="badge-custom">⭐ کالای من</span>}
                  <span className={`badge-brand ${getBrandClass(item.brand)}`}>{item.brand}</span>
                  <span className="badge-category">{item.category}</span>
                  <span className="badge-pack">{toPersianNum(item.packSize)} عددی</span>
                </div>
              </div>

              <button type="button" className="product-edit-btn" title="ویرایش کالا" onClick={() => openEditProductModal(item)}>
                <span className="material-symbols-outlined">edit</span>
              </button>
            </div>

            <div className="product-price-row">
              <div className="price-block">
                <span className="price-label">قیمت هر کارتن:</span>
                <span className="price-val">
                  {fa(item.cartonPrice)} <small>تومان</small>
                </span>
              </div>
              <div className="price-divider"></div>
              <div className="price-block">
                <span className="price-label">قیمت تکی/دانه:</span>
                <span className="price-val unit">
                  {fa(item.unitPrice)} <small>تومان</small>
                </span>
              </div>
            </div>
          </article>
        ))}

        {/* استیت عدم یافت کالا */}
        <div id="noProductsFound" className="empty-products-box" style={{ display: eligible.length > 0 && visible.length === 0 ? 'flex' : 'none' }}>
          <span className="material-symbols-outlined">search_off</span>
          <p>هیچ کالایی با این مشخصات یافت نشد</p>
          <button type="button" onClick={() => { setBrand('ALL'); setCategory('ALL'); setSearch(''); }} className="reset-filter-btn">
            نمایش همه کالاها
          </button>
        </div>
      </main>

      {/* دکمه شناور افزودن کالای جدید */}
      <button className="fab-add-product" type="button" title="افزودن کالای جدید" onClick={openAddProductModal}>
        <span className="material-symbols-outlined">add</span>
      </button>

      {/* مودال ثبت و ویرایش کالا */}
      <div
        className="modal-overlay"
        id="productModal"
        style={{ display: modal.open ? 'flex' : 'none' }}
        onClick={(e) => { if (e.target === e.currentTarget) setModal({ open: false, mode: 'add', data: {} }); }}
      >
        <div className="modal-card">
          <div className="modal-header">
            {/* products.js: عنوان و دکمه ثبت بسته به حالت (افزودن/ویرایش اختصاصی/تغییر قیمت شرکتی) */}
            <h3 id="productModalTitle">
              {modal.mode !== 'edit'
                ? 'تعریف کالای اختصاصی جدید'
                : m.isCustom
                  ? 'ویرایش کالای اختصاصی من'
                  : `تغییر قیمت فروش (${m.name || ''})`}
            </h3>
            <button type="button" className="modal-close" onClick={() => setModal({ open: false, mode: 'add', data: {} })}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <form className="modal-form" id="productForm" onSubmit={handleSaveProduct}>
            <div className="modal-input-group">
              <label>نام بستنی <span className="req">*</span></label>
              <input type="text" id="prodName" placeholder="مثال: مگنوم فندقی دست‌ساز" required disabled={modal.mode === 'edit' && !m.isCustom} value={m.name || ''} onChange={(e) => setM({ name: e.target.value })} />
            </div>

            <div className="modal-input-row">
              <div className="modal-input-group">
                <label>برند / شرکت</label>
                <input type="text" id="prodBrand" placeholder="مثال: کارگاه من" disabled={modal.mode === 'edit' && !m.isCustom} value={m.brand ?? ''} onChange={(e) => setM({ brand: e.target.value })} />
              </div>
              <div className="modal-input-group">
                <label>دسته‌بندی</label>
                <select id="prodCategory" className="modal-select" disabled={modal.mode === 'edit' && !m.isCustom} value={m.category || 'چوبی'} onChange={(e) => setM({ category: e.target.value })}>
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="modal-input-row">
              <div className="modal-input-group">
                <label>تعداد در کارتن <span className="req">*</span></label>
                {/* text + inputMode تا کیبورد فارسی موبایل هم کار کند؛ ارقام فارسی نرمال می‌شوند */}
                <input type="text" inputMode="numeric" id="prodPackSize" required value={m.unitsPerCarton ?? 24} onChange={(e) => setM({ unitsPerCarton: onlyDigits(e.target.value) })} />
              </div>
              <div className="modal-input-group">
                <label>قیمت کارتن (تومان) <span className="req">*</span></label>
                <input type="text" inputMode="numeric" id="prodCartonPrice" placeholder="مثال: 720000" required value={m.cartonPrice ?? ''} onChange={(e) => setM({ cartonPrice: e.target.value })} />
              </div>
            </div>

            <div className="modal-unit-calc" id="modalUnitCalc">
              قیمت محاسبه‌شده هر عدد: <strong id="calcUnitPrice">{fa(unitPriceOf(m))} تومان</strong>
            </div>

            <button type="submit" className="modal-submit-btn" id="modalSubmitBtn" disabled={busy}>
              {busy
                ? 'در حال ذخیره...'
                : modal.mode !== 'edit'
                  ? 'ثبت و افزودن کالا'
                  : m.isCustom
                    ? 'ذخیره تغییرات'
                    : 'ذخیره قیمت جدید'}
            </button>

            {/* products.js: دکمه بازنشانی فقط برای کالای شرکتیِ دارای قیمت سفارشی */}
            {modal.mode === 'edit' && !m.isCustom && m.hasCustomPrice && (
              <button type="button" className="modal-reset-btn" id="modalResetBtn" onClick={handleResetCurrentProductPrice}>
                <span className="material-symbols-outlined">restart_alt</span>
                <span>بازنشانی به قیمت پایه کارخانه</span>
              </button>
            )}

            {/* products.js: دکمه حذف فقط برای کالای اختصاصی خود کاربر */}
            {modal.mode === 'edit' && m.isCustom && (
              <button type="button" className="modal-delete-btn" id="modalDeleteBtn" onClick={handleDeleteProduct}>
                <span className="material-symbols-outlined">delete</span>
                <span>حذف این محصول از لیست من</span>
              </button>
            )}
          </form>
        </div>
      </div>
    </>
  );
}
