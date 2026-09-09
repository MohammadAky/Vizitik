import AppHeader from '../components/AppHeader.jsx';
import { authStorage } from '../lib/api.js';
import { APP_NAME_FA } from '../lib/brand.js';

export default function Settings({ go }) {
  const user = authStorage.user || {};
  return (
    <>
      <AppHeader title="تنظیمات" sub={APP_NAME_FA} onMenu={go.onMenu} online />
      <div className="content">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="avatar" style={{ background: 'var(--primary-light)', color: 'var(--ice-blue)', border: 'none' }}>
              <span className="material-symbols-outlined">person</span>
            </div>
            <div>
              <div className="t">{user.firstName} {user.lastName}</div>
              <div className="d">شماره: {user.phone || '—'} · نقش: ویزیتور</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="t">نسخهٔ نرم‌افزار</div>
          <div className="d" style={{ marginTop: 6 }}>{APP_NAME_FA} — نسخهٔ PWA (آفلاین‌محور)</div>
        </div>
        <div className="card">
          <div className="t">راهنما</div>
          <div className="d" style={{ marginTop: 6, lineHeight: 1.9 }}>
            • فاکتورها ابتدا در گوشی ثبت و در صورت آفلاین بودن در صف همگام‌سازی می‌مانند.
            <br />• برای خروج از حساب از منوی ☰ گوشهٔ بالا استفاده کنید.
          </div>
        </div>
      </div>
    </>
  );
}
