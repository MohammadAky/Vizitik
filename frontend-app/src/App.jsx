import { useEffect, useState } from 'react';
import { authStorage } from './lib/api.js';
import Login from './screens/Login.jsx';
import Register from './screens/Register.jsx';
import Dashboard from './screens/Dashboard.jsx';

// آیکون‌های سادهٔ متنی (در فازهای بعد با Material Symbols جایگزین می‌شوند)
function ComingSoon({ title }) {
  return (
    <>
      <header className="topbar">
        <h1>{title}</h1>
      </header>
      <div className="content">
        <div className="placeholder">
          این بخش ({title}) در فازهای بعدیِ پورت به همین معماری آفلاین پیاده می‌شود.
        </div>
      </div>
    </>
  );
}

function Settings({ onLogout }) {
  const user = authStorage.user || {};
  return (
    <>
      <header className="topbar">
        <h1>تنظیمات</h1>
      </header>
      <div className="content">
        <div className="card">
          <div className="t">{user.firstName} {user.lastName}</div>
          <div className="d muted">شماره: {user.phone || '—'}</div>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            خروج از حساب و پاک کردن دادهٔ محلی گوشی
          </div>
          <button className="btn primary" onClick={onLogout} style={{ background: 'var(--bad)' }}>
            خروج از حساب
          </button>
        </div>
      </div>
    </>
  );
}

const NAV = [
  { id: 'dash', label: 'داشبورد', ic: '🏠' },
  { id: 'order', label: 'ثبت سفارش', ic: '🧾' },
  { id: 'collect', label: 'وصول', ic: '💰' },
  { id: 'goods', label: 'کالا', ic: '📦' },
  { id: 'settings', label: 'منو', ic: '⚙️' }
];

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [authScreen, setAuthScreen] = useState('login'); // login | register
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

  let screen;
  switch (view) {
    case 'dash':
      screen = <Dashboard goView={setView} />;
      break;
    case 'order':
      screen = <ComingSoon title="ثبت سفارش و فاکتور" />;
      break;
    case 'collect':
      screen = <ComingSoon title="وصول و چک‌ها" />;
      break;
    case 'goods':
      screen = <ComingSoon title="کالاها و بار خودرو" />;
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
