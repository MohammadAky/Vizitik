import { useEffect, useState } from 'react';
import { authStorage } from './lib/api.js';
import Login from './screens/Login.jsx';
import Register from './screens/Register.jsx';
import Dashboard from './screens/Dashboard.jsx';
import NewOrder from './screens/NewOrder.jsx';
import VanLoading from './screens/VanLoading.jsx';
import Orders from './screens/Orders.jsx';
import Collections from './screens/Collections.jsx';

function Settings({ onLogout }) {
  const user = authStorage.user || {};
  return (
    <>
      <header className="topbar"><h1>تنظیمات</h1></header>
      <div className="content">
        <div className="card">
          <div className="t">{user.firstName} {user.lastName}</div>
          <div className="d muted">شماره: {user.phone || '—'}</div>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            خروج از حساب و پاک کردن دادهٔ محلی گوشی
          </div>
          <button className="btn primary" onClick={onLogout} style={{ background: 'var(--bad)' }}>خروج از حساب</button>
        </div>
      </div>
    </>
  );
}

const NAV = [
  { id: 'dash', label: 'داشبورد', ic: '🏠' },
  { id: 'order', label: 'سفارش', ic: '🧾' },
  { id: 'van', label: 'بار/کالا', ic: '📦' },
  { id: 'collect', label: 'وصول', ic: '💰' },
  { id: 'settings', label: 'منو', ic: '⚙️' }
];

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [authScreen, setAuthScreen] = useState('login');
  const [view, setView] = useState('dash');

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

  const reloadHome = () => setView((v) => v);

  let screen;
  switch (view) {
    case 'dash':
      screen = <Dashboard goView={setView} />;
      break;
    case 'order':
      screen = <NewOrder reloadHome={reloadHome} />;
      break;
    case 'van':
      screen = <VanLoading reloadHome={reloadHome} />;
      break;
    case 'collect':
      screen = <Collections reloadHome={reloadHome} />;
      break;
    case 'orders':
      screen = <Orders goBack={() => setView('dash')} />;
      break;
    default:
      screen = (
        <Settings
          onLogout={() => {
            authStorage.clear();
            setAuthed(false);
            setAuthScreen('login');
          }}
        />
      );
  }

  return (
    <div className="app">
      {screen}
      <nav className="bottomnav">
        {NAV.map((t) => (
          <button key={t.id} className={`navtab ${view === t.id ? 'on' : ''}`} onClick={() => setView(t.id)}>
            <span className="ic">{t.ic}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
