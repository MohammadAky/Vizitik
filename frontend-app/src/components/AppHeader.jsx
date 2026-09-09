import { authStorage } from '../lib/api.js';

// هدر هماهنگ با نسخهٔ اصلی (main):
// در داشبورد پروفایل + «سلام، نام» + وضعیت برخط؛ در بقیهٔ صفحات عنوان صفحه.
// دکمهٔ همبرگری (چپ) منوی کشویی را باز می‌کند.
export default function AppHeader({ title, sub, onMenu, online = true }) {
  const user = authStorage.user || {};
  const isDashboard = !title;
  return (
    <header className="app-header">
      {isDashboard ? (
        <div className="user-profile">
          <div className="avatar">
            <span className="material-symbols-outlined">person</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="user-name">سلام، {user.firstName || 'ویزیتور'}</div>
            <div className="user-status">
              <span className={`dot ${online ? '' : 'off'}`}></span>
              <span>{online ? 'برخط (Sync آنلاین)' : 'آفلاین — از دادهٔ محلی'}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="head-title">
          <h1>{title}</h1>
          {sub && <div className="head-sub">{sub}</div>}
        </div>
      )}
      <button className="icon-btn" onClick={onMenu} aria-label="منو">
        <span className="material-symbols-outlined">menu</span>
      </button>
    </header>
  );
}
