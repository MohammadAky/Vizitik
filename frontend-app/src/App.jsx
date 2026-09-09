import { useCallback, useEffect, useState } from 'react';
import { authStorage } from './lib/api.js';
import { clearAllLocalData } from './lib/db.js';
import { PAGES } from './lib/pages.js';
import AppToast from './components/AppToast.jsx';
import SideMenu from './components/SideMenu.jsx';
import Auth from './screens/Auth.jsx';
import Dashboard from './screens/Dashboard.jsx';
import NewOrder from './screens/NewOrder.jsx';
import VanLoading from './screens/VanLoading.jsx';
import Customers from './screens/Customers.jsx';
import Orders from './screens/Orders.jsx';
import Collections from './screens/Collections.jsx';
import Products from './screens/Products.jsx';
import Payment from './screens/Payment.jsx';
import BaleBot from './screens/BaleBot.jsx';
import Info from './screens/Info.jsx';
import Settings from './screens/Settings.jsx';

const VIEWS = Object.keys(PAGES);

function hashParts() {
  const [path, qs] = (window.location.hash || '').replace(/^#\/?/, '').split('?');
  return { view: VIEWS.includes(path) ? path : 'dash', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

function viewFromHash() {
  return hashParts().view;
}

/**
 * پوستهٔ برنامه. برخلاف نسخهٔ قبلی، هیچ نوار ناوبری یا منوی سراسری ندارد:
 * در PHP هر فایل خودش تعیین می‌کند چه هدری، چه نوار پایینی و چه دراور داشته باشد
 * (دراور + دکمهٔ شناور فقط در داشبورد است؛ مشتریان و بارگیری خودرو nav پایین ندارند).
 * به همین دلیل فرزندانِ مستقیم ‎.app باید همان هدر/محتوا/nav باشند تا فلکس‌باکس
 * و موقعیت absolute دقیقاً مثل نسخهٔ PHP کار کند.
 */
export default function App() {
  const [authed, setAuthed] = useState(false);
  const [view, setView] = useState(viewFromHash);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (authStorage.token) setAuthed(true);
  }, []);

  useEffect(() => {
    const onHash = () => {
      setView(viewFromHash());
      setMenuOpen(false);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((next) => {
    setMenuOpen(false);
    if (!VIEWS.includes(next)) return;
    if (window.location.hash !== `#/${next}`) window.location.hash = `#/${next}`;
    setView(next);
  }, []);

  async function logout() {
    await clearAllLocalData().catch(() => {});
    authStorage.clear();
    setAuthed(false);
    go('dash');
  }

  if (!authed) return <Auth onAuthed={() => setAuthed(true)} />;

  const ctx = { go, openMenu: () => setMenuOpen(true), logout, params: hashParts().params };

  const screens = {
    dash: <Dashboard key="dash" {...ctx} />,
    van: <VanLoading key="van" {...ctx} />,
    customers: <Customers key="customers" {...ctx} />,
    orders: <Orders key="orders" {...ctx} />,
    collect: <Collections key="collect" {...ctx} />,
    order: <NewOrder key="order" {...ctx} />,
    products: <Products key="products" {...ctx} />,
    payment: <Payment key="payment" {...ctx} />,
    settings: <Settings key="settings" {...ctx} />,
    bale: <BaleBot key="bale" {...ctx} />,
    help: <Info key="help" kind="help" {...ctx} />,
    about: <Info key="about" kind="about" {...ctx} />
  };

  return (
    <div className="app" id="app">
      {/* منوی کشویی — فقط در داشبورد، مطابق dashboard.php */}
      {view === 'dash' && (
        <SideMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onGo={go}
          onLogout={logout}
          user={authStorage.user}
        />
      )}
      {screens[view] || screens.dash}
      <AppToast />
    </div>
  );
}
