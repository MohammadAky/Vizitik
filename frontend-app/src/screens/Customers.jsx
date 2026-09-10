import { useMemo, useRef, useState } from 'react';
import { api, apiSilent } from '../lib/api.js';
import { kv } from '../lib/db.js';
import { useLocalData } from '../lib/data.js';
import { toPersianNum, onlyDigits, parseFaNumber } from '../lib/format.js';
import { usePhpPage } from '../lib/usePhpPage.js';
import { showToast } from '../components/AppToast.jsx';

const faMoney = (n) => toPersianNum(Number(n || 0).toLocaleString('en-US'));

const EMPTY = { id: '', name: '', phone: '', notes: '', address: '', debt: '', initialDebt: '' };

/**
 * لیست مشتریان — پورت ۱:۱ از frontend/customers.php + js/customers.js
 * (هدر با header-stat-badge طلب کل بازار، جستجو، سه چیپ فیلتر، کارت‌ها با data-*،
 *  FAB «مشتری جدید»، مودال پرونده سریع با ۵ خرید اخیر و مودال فرم ثبت/ویرایش)
 * توجه: در فایل PHP، بلوک app-nav کامنت شده است → این صفحه نوار پایینی ندارد.
 */
export default function Customers({ go }) {
  const page = usePhpPage('customers');
  const { customers, online, reload } = useLocalData();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [sheet, setSheet] = useState(null); // {customer, recentOrders, loading}
  const [form, setForm] = useState({ open: false, mode: 'add', data: EMPTY, saving: false });
  const searchRef = useRef(null);

  const cards = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    return (customers || []).map((c) => {
      const debt = Number(c.currentDebt || 0);
      return {
        id: c.id,
        name: c.name || 'مشتری بدون نام',
        address: c.address || 'آدرس ثبت نشده',
        phone: c.phone || '',
        notes: c.notes || '',
        debt,
        hasDebt: debt > 0,
        isSettled: debt === 0
      };
    });
  }, [customers]);

  const visible = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    return cards.filter((c) => {
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.notes.toLowerCase().includes(q);
      let matchChip = true;
      if (filter === 'DEBTORS') matchChip = c.debt > 0;
      else if (filter === 'SETTLED') matchChip = c.debt === 0;
      return matchSearch && matchChip;
    });
  }, [cards, search, filter]);

  const visibleDebt = visible.reduce((s, c) => (c.debt > 0 ? s + c.debt : s), 0);
  const noFound = visible.length === 0 && cards.length > 0;

  async function openCustomerSheet(c) {
    setSheet({ customer: c, recentOrders: null, loading: true });
    if (navigator.onLine) {
      const data = await apiSilent(`/customers/${c.id}`);
      const orders = (data && data.orders) || [];
      kv.set(`cust_orders_${c.id}`, orders).catch(() => {});
      setSheet({ customer: c, recentOrders: orders, loading: false });
    } else {
      const cached = await kv.get(`cust_orders_${c.id}`).catch(() => null);
      setSheet({ customer: c, recentOrders: Array.isArray(cached) ? cached : [], loading: false });
    }
  }

  function triggerInvoiceForCurrentCustomer() {
    if (!sheet) return;
    const name = sheet.customer.name;
    closeSheet();
    showToast(`هدایت به صدور فاکتور برای «${name}»...`, 'success');
    setTimeout(() => go('order'), 400);
  }

  function closeSheet() {
    setSheet(null);
  }

  function openAddCustomerModal() {
    setForm({ open: true, mode: 'add', data: EMPTY, saving: false });
  }

  function openEditCustomerModal() {
    if (!sheet) return;
    const c = sheet.customer;
    setForm({
      open: true,
      mode: 'edit',
      data: { id: c.id, name: c.name, phone: c.phone, notes: c.notes, address: c.address === 'آدرس ثبت نشده' ? '' : c.address, debt: c.debt, initialDebt: '' },
      saving: false
    });
  }

  async function handleDeleteCustomer() {
    if (form.mode !== 'edit' || !form.data.id) return;
    if (!window.confirm('حذف این مشتری؟ این عمل قابل بازگشت نیست.')) return;
    try {
      await api(`/customers/${form.data.id}`, { method: 'DELETE' });
      showToast('مشتری حذف شد.', 'success');
      setForm({ open: false, mode: 'add', data: EMPTY, saving: false });
      setSheet(null);
      await reload();
    } catch (err) {
      showToast(err.message || 'خطا در حذف مشتری.', 'error');
    }
  }

  async function handleSaveCustomerForm(e) {
    e.preventDefault();
    const d = form.data;
    setForm((f) => ({ ...f, saving: true }));
    const payload = {
      name: (d.name || '').trim(),
      phone: onlyDigits(d.phone || '').trim(),
      notes: (d.notes || '').trim(),
      address: (d.address || '').trim() || null,
      ...(form.mode === 'edit' ? {} : { initialDebt: parseFaNumber(d.initialDebt, 0) || 0 })
    };
    try {
      if (form.mode === 'edit' && d.id) await api(`/customers/${d.id}`, { method: 'PUT', body: payload });
      else await api('/customers', { method: 'POST', body: payload });
      setForm({ open: false, mode: 'add', data: EMPTY, saving: false });
      showToast(
        form.mode === 'edit'
          ? `مشخصات «${payload.name}» با موفقیت ویرایش شد.`
          : `مشتری «${payload.name}» با موفقیت ثبت شد.`,
        'success'
      );
      setTimeout(() => reload(), 700);
    } catch (err) {
      showToast(err.message || 'خطا در ذخیره اطلاعات مشتری.', 'error');
      setForm((f) => ({ ...f, saving: false }));
    }
  }

  const d = form.data;
  const setD = (patch) => setForm((f) => ({ ...f, data: { ...f.data, ...patch } }));
  const sheetCust = sheet && sheet.customer;

  return (
    <>
      {/* هدر صفحه مشتریان */}
      <header className="customers-header">
        <div className="header-top-row">
          <div className="header-title-box">
            <h1>{page.h1}</h1>
            <span className="header-sub" id="totalCustomersCount">
              {toPersianNum(visible.length)} فروشگاه
            </span>
          </div>

          <div className="header-left-tools">
            {/* نشانگر طلب کل بازار */}
            <div className="header-stat-badge">
              <span className="material-symbols-outlined">payments</span>
              <span id="totalDebtAmount">{faMoney(visibleDebt)} مانده بازار</span>
            </div>

            <a href="#/dash" className="back-btn" aria-label="بازگشت به داشبورد" onClick={(e) => { e.preventDefault(); go('dash'); }}>
              <span className="material-symbols-outlined">arrow_forward</span>
            </a>
          </div>
        </div>

        {/* نوار جستجوی سریع هوشمند */}
        <div className="search-box">
          <span className="material-symbols-outlined search-icon">search</span>
          <input
            ref={searchRef}
            type="text"
            id="customerSearchInput"
            placeholder="جستجوی نام فروشگاه، آدرس، تلفن، یادداشت..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search.length > 0 && (
            <button id="clearSearchBtn" className="clear-search-btn" type="button" onClick={() => setSearch('')}>
              <span className="material-symbols-outlined">cancel</span>
            </button>
          )}
        </div>

        {/* ردیف چیپ‌های فیلتر سریع وضعیت */}
        <div className="chips-scroll-container">
          <span className="chips-label">فیلتر:</span>
          <div className="chips-track" id="filterChipsTrack">
            <button type="button" className={`filter-chip ${filter === 'ALL' ? 'active' : ''}`} data-filter="ALL" onClick={() => setFilter('ALL')}>
              همه
            </button>
            <button type="button" className={`filter-chip debtor-chip ${filter === 'DEBTORS' ? 'active' : ''}`} data-filter="DEBTORS" onClick={() => setFilter('DEBTORS')}>
              <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>priority_high</span>
              <span>فقط بدهکاران</span>
            </button>
            <button type="button" className={`filter-chip settled-chip ${filter === 'SETTLED' ? 'active' : ''}`} data-filter="SETTLED" onClick={() => setFilter('SETTLED')}>
              <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>check_circle</span>
              <span>تسویه‌شده‌ها</span>
            </button>
          </div>
        </div>
      </header>

      {/* محتوای اصلی و کارت‌های مشتریان */}
      <main className="customers-content" id="customersList">
        {cards.length === 0 ? (
          <div className="empty-box" id="emptyCustomerBox">
            <span className="material-symbols-outlined">person_add</span>
            <h3>هنوز مشتری‌ای ثبت نشده است</h3>
            <p>برای شروع ثبت فاکتور، با دکمه زیر اولین مشتری خود را اضافه کنید.</p>
            <button type="button" className="submit-btn" style={{ padding: '0 20px' }} onClick={openAddCustomerModal}>
              افزودن اولین مشتری
            </button>
          </div>
        ) : (
          visible.map((c) => (
            <article
              key={c.id}
              className="customer-card"
              data-id={c.id}
              data-name={c.name}
              data-address={c.address}
              data-phone={c.phone}
              data-notes={c.notes}
              data-debt={c.debt}
              onClick={() => openCustomerSheet(c)}
            >
              <div className="customer-card-header">
                <div className="customer-main-info">
                  <div className={`customer-avatar ${c.hasDebt ? 'has-debt' : c.isSettled ? 'is-settled' : ''}`.trim()}>
                    <span className="material-symbols-outlined">storefront</span>
                  </div>
                  <div className="customer-titles">
                    <h2 className="customer-shop-name">{c.name}</h2>
                    <span className="customer-owner-name">{c.notes || (c.phone ? c.phone : 'مشتری تحت پوشش')}</span>
                  </div>
                </div>

                <div className={`balance-badge ${c.hasDebt ? 'debtor' : 'settled'}`}>
                  <span className="balance-title">{c.hasDebt ? 'بدهکار' : 'تسویه شده'}</span>
                  <strong className="balance-amount">{c.hasDebt ? `${faMoney(c.debt)} ت` : '۰ تومان'}</strong>
                </div>
              </div>

              <div className="customer-card-bottom">
                <div className="customer-address-sub">
                  <span className="material-symbols-outlined">location_on</span>
                  <span>{c.address}</span>
                </div>

                <div className="quick-tools-row" onClick={(e) => e.stopPropagation()}>
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="mini-icon-btn call-btn" title="تماس سریع">
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>call</span>
                    </a>
                  )}
                  {c.address && c.address !== 'آدرس ثبت نشده' && (
                    <a
                      href={`https://maps.google.com/?q=${encodeURIComponent(c.address)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mini-icon-btn map-btn"
                      title="مسیریابی"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>near_me</span>
                    </a>
                  )}
                </div>
              </div>
            </article>
          ))
        )}

        {/* باکس در صورت عدم یافتن در جستجو */}
        <div id="noCustomerFound" className="empty-box" style={{ display: noFound ? 'flex' : 'none' }}>
          <span className="material-symbols-outlined">search_off</span>
          <h3>مشتری‌ای با این مشخصات یافت نشد</h3>
          <p>عبارت جستجو یا فیلتر را تغییر دهید.</p>
          <button type="button" className="submit-btn" style={{ padding: '0 18px', fontSize: '12px' }} onClick={() => { setFilter('ALL'); setSearch(''); }}>
            نمایش همه مشتریان
          </button>
        </div>
      </main>

      {/* دکمه شناور ثبت مشتری جدید (FAB) */}
      <button type="button" className="fab-add-customer" onClick={openAddCustomerModal}>
        <span className="material-symbols-outlined">person_add</span>
        <span>مشتری جدید</span>
      </button>

      {/* مودال پرونده سریع مشتری */}
      <div className="modal-overlay" id="customerSheetModal" style={{ display: sheet ? 'flex' : 'none' }}>
        <div className="modal-card">
          <div className="modal-header">
            <div className="modal-shop-heading">
              <h3 id="sheetShopName">{sheetCust ? sheetCust.name : 'نام سوپرمارکت'}</h3>
              <span id="sheetOwnerMeta">
                {sheetCust ? `${sheetCust.phone ? 'تلفن: ' + sheetCust.phone : ''} ${sheetCust.notes ? '• ' + sheetCust.notes : ''}` : 'تلفن و یادداشت'}
              </span>
            </div>
            <button className="modal-close" type="button" onClick={closeSheet}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* بنر وضعیت مانده بدهی مشتری */}
          <div className={`modal-balance-banner ${sheetCust && sheetCust.debt > 0 ? '' : 'settled'}`.trim()} id="sheetBalanceBanner">
            <div className="banner-right">
              <span className="material-symbols-outlined">account_balance_wallet</span>
              <span id="sheetBalanceStatusLabel">
                {sheetCust && sheetCust.debt > 0 ? 'مانده بدهی قبلی فروشگاه:' : 'وضعیت حساب:'}
              </span>
            </div>
            <div className="banner-left">
              <strong className="banner-amount" id="sheetBalanceAmount">
                {sheetCust && sheetCust.debt > 0 ? `${faMoney(sheetCust.debt)} تومان` : 'کاملاً تسویه شده (۰ تومان)'}
              </strong>
            </div>
          </div>

          {/* دکمه اصلی و بزرگ: صدور فاکتور جدید برای این مشتری */}
          <button type="button" className="primary-invoice-cta" id="sheetInvoiceBtn" onClick={triggerInvoiceForCurrentCustomer}>
            <span className="material-symbols-outlined">shopping_cart_checkout</span>
            <span>صدور فاکتور جدید برای این مشتری</span>
          </button>

          {/* بخش ۵ خرید و فاکتور اخیر مشتری */}
          <div className="recent-purchases-section">
            <div className="recent-purchases-header">
              <strong>
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>history</span>
                <span>سوابق و ۵ خرید اخیر:</span>
              </strong>
              <button type="button" className="view-all-ledger-link" onClick={() => { closeSheet(); go('collect'); }}>
                مشاهده کل کاردکس
              </button>
            </div>

            <div className="recent-orders-list" id="sheetRecentOrdersList">
              {!sheet || sheet.loading ? (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', padding: '12px 0' }}>
                  در حال دریافت سوابق...
                </p>
              ) : (sheet.recentOrders || []).length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', padding: '12px 0' }}>
                  تاکنون سفارشی برای این مشتری ثبت نشده است.
                </p>
              ) : (
                (sheet.recentOrders || []).slice(0, 5).map((ord, index) => {
                  const dateStr = ord.orderDate ? new Date(ord.orderDate).toLocaleDateString('fa-IR') : 'امروز';
                  const isSettled = ord.status === 'DELIVERED' || ord.status === 'CONFIRMED';
                  const amount = ord.finalAmount ? Number(ord.finalAmount) : 0;
                  const summary = ord.summary || 'اقلام بستنی';
                  return (
                    <div className="recent-order-item" key={ord.id || index}>
                      <div className="recent-order-right">
                        <span className="recent-order-no">
                          {ord.invoiceNumber ? (
                            <>
                              فاکتور شماره <span className="invoice-num">{toPersianNum(ord.invoiceNumber)}</span>
                            </>
                          ) : (
                            `فاکتور شماره ${toPersianNum(index + 1)}`
                          )}{' '}
                          <small style={{ color: 'var(--text-muted)' }}>({toPersianNum(dateStr)})</small>
                        </span>
                        <span className="recent-order-summary">{summary}</span>
                      </div>
                      <div className="recent-order-left">
                        <span className="recent-order-amount">{faMoney(amount)} ت</span>
                        <span className={`recent-order-status ${isSettled ? 'settled' : 'credit'}`}>
                          {isSettled ? 'تسویه شد' : 'نسیه (اعتباری)'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ردیف دکمه‌های کمکی: ویرایش مشخصات */}
          <div className="modal-secondary-actions">
            <button type="button" className="sec-btn edit-btn" onClick={openEditCustomerModal}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
              <span>ویرایش مشخصات و آدرس</span>
            </button>
          </div>
        </div>
      </div>

      {/* مودال فرم ثبت / ویرایش مشتری */}
      <div className="modal-overlay" id="customerFormModal" style={{ display: form.open ? 'flex' : 'none' }}>
        <div className="modal-card">
          <div className="modal-header">
            <h3 id="formModalTitle">{form.mode === 'edit' ? 'ویرایش مشخصات مشتری' : 'ثبت مشتری و فروشگاه جدید'}</h3>
            <button className="modal-close" type="button" onClick={() => setForm({ open: false, mode: 'add', data: EMPTY, saving: false })}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <form className="modal-form" id="customerForm" onSubmit={handleSaveCustomerForm}>
            <input type="hidden" id="editCustId" value={d.id} readOnly />

            <div className="input-group">
              <label>
                نام فروشگاه / سوپرمارکت <span className="req">*</span>
              </label>
              <input type="text" id="custNameInput" placeholder="مثال: هایپرمارکت ستاره" required value={d.name} onChange={(e) => setD({ name: e.target.value })} />
            </div>

            <div className="input-row">
              <div className="input-group">
                <label>
                  شماره تماس / موبایل <span className="req">*</span>
                </label>
                <input type="tel" id="custPhoneInput" placeholder="مثال: 09121234567" required value={d.phone} onChange={(e) => setD({ phone: onlyDigits(e.target.value) })} />
              </div>
              {form.mode !== 'edit' && (
                <div className="input-group" id="custDebtGroup">
                  <label>مانده بدهی اول‌دوره (تومان)</label>
                  <input type="text" inputMode="numeric" id="custDebtInput" placeholder="0" value={d.initialDebt} onChange={(e) => setD({ initialDebt: e.target.value })} />
                </div>
              )}
            </div>

            <div className="input-group">
              <label>یادداشت / نام صاحب مغازه</label>
              <input type="text" id="custNotesInput" placeholder="مثال: حاج رضا - تحویل بار قبل ظهر" value={d.notes} onChange={(e) => setD({ notes: e.target.value })} />
            </div>

            <div className="input-group">
              <label>آدرس دقیق فروشگاه</label>
              <textarea id="custAddressInput" placeholder="خیابان، کوچه، پلاک..." value={d.address} onChange={(e) => setD({ address: e.target.value })}></textarea>
            </div>

            <button type="submit" className="submit-btn" id="formSubmitBtn" disabled={form.saving}>
              {form.saving ? 'در حال ذخیره...' : form.mode === 'edit' ? 'ذخیره تغییرات' : 'ثبت و ذخیره مشتری'}
            </button>

            {form.mode === 'edit' && (
              <button type="button" className="modal-delete-btn" id="formDeleteBtn" onClick={handleDeleteCustomer}>
                <span className="material-symbols-outlined">delete</span>
                <span>حذف این مشتری از سیستم</span>
              </button>
            )}
          </form>
        </div>
      </div>
    </>
  );
}
