import { DRAWER_ITEMS } from '../lib/pages.js';

/**
 * منوی کشویی (Drawer) — کپی ساختاری بلوک aside در dashboard.php نسخهٔ PHP:
 * همان ۵ آیتم، همان آیکون‌ها، همان برچسب‌ها و فوتر «خروج از حساب کاربری».
 * باز/بسته شدن با کلاس show روی overlay و خودِ aside انجام می‌شود (css/style.css).
 * در نسخهٔ PHP این منو فقط در داشبورد وجود دارد.
 */
export default function SideMenu({ open, onOpen, onClose, onGo, onLogout, user }) {
  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'کاربر گرامی';
  return (
    <>
      <div className={`menu-overlay ${open ? 'show' : ''}`} onClick={onClose}></div>

      <aside className={`side-menu ${open ? 'show' : ''}`}>
        <div className="side-menu-header">
          <div className="avatar">
            <span className="material-symbols-outlined">person</span>
          </div>
          <div className="side-menu-user-details">
            <div className="side-menu-name">{fullName}</div>
            <div className="side-menu-role">مسئول توزیع و ویزیتور</div>
          </div>
          <button type="button" className="side-menu-close" onClick={onClose} aria-label="بستن منو">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <nav className="side-menu-list">
          {DRAWER_ITEMS.map((it) => (
            <a
              key={it.view}
              href={`#/${it.view}`}
              className="side-menu-item"
              onClick={(e) => {
                e.preventDefault();
                onGo(it.view);
              }}
            >
              <span className="material-symbols-outlined">{it.icon}</span>
              {it.label}
            </a>
          ))}
        </nav>

        <div className="side-menu-footer">
          <a href="#/logout" className="side-menu-logout" onClick={(e) => { e.preventDefault(); onLogout(); }}>
            <span className="material-symbols-outlined">logout</span>
            خروج از حساب کاربری
          </a>
        </div>
      </aside>
    </>
  );
}
