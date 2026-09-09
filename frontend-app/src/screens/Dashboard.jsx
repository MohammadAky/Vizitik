import { useEffect, useState } from 'react';
import { apiSilent, authStorage } from '../lib/api.js';
import { kv } from '../lib/db.js';
import { flushPendingQueue, getPending, subscribeSync } from '../lib/sync.js';
import { formatToman, toPersianNum } from '../lib/format.js';
import { usePhpPage } from '../lib/usePhpPage.js';
import { Skel, useSkeleton } from '../components/Skeleton.jsx';
import { showToast } from '../components/AppToast.jsx';
import BottomNav from '../components/BottomNav.jsx';

const faNum = (n) => toPersianNum(Number(n || 0).toLocaleString('en-US'));

/** دقیقاً محاسبهٔ بلاک foreach در dashboard.php نسخهٔ PHP */
function mapOrder(ord) {
  const storeName = (ord && ord.customer && ord.customer.name) || 'مشتری ناشناس';
  const orderDate = (ord && ord.orderDate) || '';
  let timeStr = 'امروز';
  if (orderDate) {
    const d = new Date(orderDate);
    if (!Number.isNaN(d.getTime())) {
      timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }
  const finalAmount = Number((ord && ord.finalAmount) || 0);
  let paidSum = 0;
  if (ord && Array.isArray(ord.payments)) {
    for (const p of ord.payments) paidSum += Number((p && p.amount) || 0);
  }
  const remainingCredit = Math.max(0, finalAmount - paidSum);

  let status = 'danger';
  let statusText = 'نسیه کامل';
  if (remainingCredit <= 0) {
    status = 'success';
    statusText = 'تسویه شد';
  } else if (paidSum > 0) {
    status = 'warning';
    statusText = `مانده نسیه: ${faNum(remainingCredit)} ت`;
  }

  return {
    id: ord && ord.id ? ord.id : Math.random().toString(36).slice(2),
    title: storeName,
    time: toPersianNum(timeStr),
    amount: faNum(finalAmount),
    status,
    statusText
  };
}

/**
 * داشبورد ویزیتور — پورت ۱:۱ از frontend/dashboard.php
 * (ساختار DOM، کلاس‌ها، آیکون‌ها، متن‌ها و ترتیب بلوک‌ها عین فایل PHP است)
 */
export default function Dashboard({ go, openMenu, logout }) {
  const page = usePhpPage('dash');
  const user = authStorage.user || {};
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [stats, setStats] = useState(null);
  const [orders, setOrders] = useState(null);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const filled = useSkeleton([]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    getPending().then((l) => setPending(l.length)).catch(() => {});
    const un = subscribeSync((s) => {
      if (s.type === 'queue') setPending(s.count);
      if (s.type === 'syncing') setSyncing(s.syncing);
    });
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      un();
    };
  }, []);

  // آمار زنده + سفارشات اخیر، با آینهٔ محلی برای حالت آفلاین
  useEffect(() => {
    let alive = true;
    async function load() {
      if (navigator.onLine) {
        const [s, o] = await Promise.all([apiSilent('/reports/dashboard'), apiSilent('/orders')]);
        if (!alive) return;
        if (s) {
          setStats(s);
          kv.set('dashboard_stats_cache', s).catch(() => {});
        } else {
          kv.get('dashboard_stats_cache').then((v) => alive && v && setStats(v));
        }
        if (Array.isArray(o)) {
          const top = o.slice(0, 5); // array_slice($apiOrders, 0, 5) در PHP
          setOrders(top.map(mapOrder));
          kv.set('orders_cache', o).catch(() => {});
        } else {
          kv.get('orders_cache').then((v) => {
            if (alive && Array.isArray(v)) setOrders(v.slice(0, 5).map(mapOrder));
          });
        }
        return;
      }
      const [s, o] = await Promise.all([kv.get('dashboard_stats_cache'), kv.get('orders_cache')]);
      if (!alive) return;
      if (s) setStats(s);
      if (Array.isArray(o)) setOrders(o.slice(0, 5).map(mapOrder));
    }
    load();
    return () => {
      alive = false;
    };
  }, [online]);

  async function doSync() {
    if (syncing) return;
    setSyncing(true);
    const res = await flushPendingQueue();
    setSyncing(false);
    if (res.sent) {
      showToast(`${toPersianNum(res.sent)} مورد از صف آفلاین با سرور همگام شد`, 'success');
    } else {
      showToast(res.failed ? 'همگام‌سازی برای برخی موارد ناموفق بود' : 'صف همگام‌سازی خالی است', 'info');
    }
    getPending().then((l) => setPending(l.length));
  }

  const sales = formatToman((stats && stats.todaySales) || 0);
  const cash = formatToman((stats && stats.todayCollectedCash) || 0);
  const list = orders || [];

  return (
    <>
      {/* هدر بالای صفحه */}
      <header className="app-header animate-item">
        <div className="user-profile">
          <div className="avatar">
            <span className="material-symbols-outlined">person</span>
          </div>
          <div className="user-info">
            <span className="user-name">سلام، {user.firstName || 'کاربر گرامی'}</span>
            <span className="user-status">
              <span className={`dot ${online ? '' : 'off'}`.trim()}></span> {online ? 'برخط (Sync آنلاین)' : 'آفلاین (دادهٔ محلی)'}
            </span>
          </div>
        </div>

        <button className="menu-toggle-btn" onClick={openMenu} aria-label="باز کردن منو" aria-expanded="false" aria-controls="sideMenu">
          <span className="material-symbols-outlined">menu</span>
        </button>
      </header>

      {/* محتوای اصلی داشبورد */}
      <main className="dashboard-content">
        {pending > 0 && (
          <div className="sync-queue-banner">
            <span>
              <span className="material-symbols-outlined">cloud_off</span>
              {toPersianNum(pending)} مورد در صف همگام‌سازی آفلاین
            </span>
            <button type="button" onClick={doSync} disabled={!online || syncing}>
              <span className="material-symbols-outlined">sync</span>
              {syncing ? 'در حال همگام‌سازی…' : 'همگام‌سازی'}
            </button>
          </div>
        )}

        {/* کارت‌های آمار فروش و نقدینگی */}
        <section className="stat-grid">
          <div className="stat-card animate-item">
            <span className="label">فروش امروز</span>
            <span className="value">
              <Skel done={filled} size="lg" value={sales.value} suffix={sales.suffix} />
            </span>
          </div>
          <div className="stat-card cash animate-item">
            <span className="label">وصولی نقد و پوز</span>
            <span className="value">
              <Skel done={filled} size="lg" value={cash.value} suffix={cash.suffix} />
            </span>
          </div>
        </section>

        {/* دکمه‌های دسترسی سریع */}
        <section className="quick-actions">
          <a href="#/products" className="action-btn animate-item" onClick={(e) => { e.preventDefault(); go('products'); }}>
            <div className="action-icon danger">
              <span className="material-symbols-outlined icon-fill">inventory_2</span>
            </div>
            <span>لیست کالاها</span>
          </a>
          <a href="#/bale" className="action-btn animate-item" onClick={(e) => { e.preventDefault(); go('bale'); }}>
            <div className="action-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>
              <span className="material-symbols-outlined icon-fill">smart_toy</span>
            </div>
            <span>مدیریت ربات بله</span>
          </a>
        </section>

        {/* لیست سفارشات اخیر */}
        <section>
          <div className="section-header animate-item">
            <h2>سفارشات اخیر امروز</h2>
            <a href="#/orders" onClick={(e) => { e.preventDefault(); go('orders'); }}>مشاهده همه</a>
          </div>

          <div className="order-list" id="orderList">
            {list.length > 0 ? (
              list.map((order, i) => (
                <article className="order-item" key={order.id} style={{ animationDelay: `${i * 0.08}s` }}>
                  <div className="order-info">
                    <div className="store-icon">
                      <span className="material-symbols-outlined">storefront</span>
                    </div>
                    <div>
                      <Skel tag="div" done={filled} size="md" className="order-title" value={order.title} />
                      <Skel tag="div" done={filled} size="sm" className="order-date" value={order.time} />
                    </div>
                  </div>
                  <Skel kind="badge" done={filled} className={`badge ${order.status}`} value={order.statusText} />
                </article>
              ))
            ) : (
              <div className="empty-orders-box animate-item">
                <span className="material-symbols-outlined">receipt_long</span>
                <p>هنوز سفارشی برای امروز ثبت نشده است</p>
                <a href="#/order" className="empty-action-link" onClick={(e) => { e.preventDefault(); go('order'); }}>
                  ثبت اولین سفارش
                </a>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* دکمه شناور ثبت فاکتور جدید */}
      <a href="#/order" className="new-invoice-btn" id="newInvoiceBtn" onClick={(e) => { e.preventDefault(); go('order'); }}>
        <span className="material-symbols-outlined">add_circle</span>
        ثبت فاکتور جدید
      </a>

      {/* نوار ناوبری پایینی */}
      <BottomNav items={page.nav.items} active={page.nav.active} onGo={go} />
    </>
  );
}
