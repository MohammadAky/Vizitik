import { useEffect, useState } from 'react';
import { authStorage } from './lib/api.js';
import { clearAllLocalData } from './lib/db.js';
import Login from './screens/Login.jsx';
import Register from './screens/Register.jsx';
import Dashboard from './screens/Dashboard.jsx';
import NewOrder from './screens/NewOrder.jsx';
import VanLoading from './screens/VanLoading.jsx';
import Customers from './screens/Customers.jsx';
import Orders from './screens/Orders.jsx';
import Collections from './screens/Collections.jsx';
import Settings from './screens/Settings.jsx';

// ناوبری پایین — دقیقاً مثل نسخهٔ اصلی (main)
const NAV = [
  { id: 'dash', label: 'داشبورد', icon: 'dashboard', match: ['dash'] },
  { id: 'van', label: 'بارگیری خودرو', icon: 'local_shipping', match: ['van'] },
  { id: 'customers', label: 'مشتریان', icon: 'group', match: ['customers'] },
  { id: 'orders', label: 'سفارشات', icon: 'receipt_long', match: ['orders'] },
  { id: 'collect', label: 'وصول مطالبات', icon: 'payments', match: ['collect'] }
];

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [authScreen, setAuthScreen] = useState('login');
  const [view, setView] = useState('dash');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (authStorage.token) setAuthed(true);
  }, []);

  if (!authed) {
    return authScreen === 'login' ? (
      <Login onAuthed={() => setAuthed(true)} goRegister={() => setAuthScreen('register')} />
    ) : (
      <Register onAuthed={() => setAuthed(true)} goLogin={() => setAuthScreen('login')} />
    );
  }

  const nav = (v) => { setView(v); setMenuOpen(false); };
  const go = { onMenu: () => setMenuOpen(true), nav };

  let screen;
  switch (view) {
    case 'dash': screen = <Dashboard go={go} />; break;
    case 'van': screen = <VanLoading go={go} />; break;
    case 'order': screen = <NewOrder go={go} />; break;
    case 'customers': screen = <Customers go={go} />; break;
    case 'orders': screen = <Orders go={go} />; break;
    case 'collect': screen = <Collections go={go} />; break;
    default: screen = <Settings go={go} />; break; // settings
  }

  const user = authStorage.user || {};
  const activeTab = NAV.find((t) => t.match.includes(view));

  return (
    <div className="app">
      <div className={`menu-overlay ${menuOpen ? 'show' : ''}`} onClick={() => setMenuOpen(false)} />
      <aside className={`side-menu ${menuOpen ? 'show' : ''}`}>
        <div className="side-menu-header">
          <div className="avatar"><span className="material-symbols-outlined">person</span></div>
          <div className="side-menu-user-details">
            <span className="side-menu-name">{user.firstName} {user.lastName}</span>
            <span className="side-menu-role">مسئول توزیع و ویزیتور</span>
          </div>
          <button className="icon-btn side-menu-close" onClick={() => setMenuOpen(false)} aria-label="بستن">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <nav className="side-menu-list">
          <button className="side-menu-item" onClick={() => nav('order')}>
            <span className="material-symbols-outlined">add_shopping_cart</span>
            <span>ثبت فاکتور جدید</span>
          </button>
          <div className="divider" />
          {NAV.map((t) => (
            <button key={t.id} className={`side-menu-item ${view === t.id ? 'active' : ''}`} onClick={() => nav(t.id)}>
              <span className="material-symbols-outlined">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
          <button className="side-menu-item" onClick={() => nav('settings')}>
            <span className="material-symbols-outlined">settings</span>
            <span>تنظیمات</span>
          </button>
        </nav>
        <div className="side-menu-foot">
          <button
            className="side-menu-logout"
            onClick={async () => {
              await clearAllLocalData().catch(() => {});
              authStorage.clear();
              setAuthed(false);
              setAuthScreen('login');
            }}
          >
            <span className="material-symbols-outlined">logout</span>
            <span>خروج از حساب</span>
          </button>
        </div>
      </aside>

      {screen}

      <nav className="app-nav">
        {NAV.map((t) => (
          <button key={t.id} className={`nav-item ${activeTab && activeTab.id === t.id ? 'active' : ''}`} onClick={() => nav(t.id)}>
            <span className="material-symbols-outlined">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
