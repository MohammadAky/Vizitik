/**
 * نوار ناوبری پایینی — عین <nav class="app-nav"> همان صفحه در نسخهٔ PHP.
 * در PHP هر فایل، آیتم‌های nav خودش را hard-code کرده (و در مشتریان/بارگیری خودرو
 * کل بلوک کامنت شده)، بنابراین آیتم‌ها از PAGES همان صفحه خوانده می‌شود.
 * آیتم فعال همان‌جا کلاس active و آیکونش icon-fill می‌گیرد.
 */
export default function BottomNav({ items, active, onGo }) {
  if (!items) return null;
  return (
    <nav className="app-nav animate-item">
      {items.map((it) => {
        const isActive = active === it.view;
        return (
          <a
            key={it.view + it.label}
            href={`#/${it.view}`}
            className={`nav-item ${isActive ? 'active' : ''}`}
            title={it.title}
            aria-label={it.aria}
            onClick={(e) => {
              e.preventDefault();
              onGo(it.view);
            }}
          >
            <span className={`material-symbols-outlined ${isActive ? 'icon-fill' : ''}`.trim()}>
              {it.icon}
            </span>
            <span>{it.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
