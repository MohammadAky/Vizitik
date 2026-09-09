import { useEffect, useState } from 'react';

/**
 * توست سراسری — عین رفتار showToast() در js/van-loading.js نسخهٔ PHP:
 * المان داخل ظرف ‎.app ساخته می‌شود، کلاس app-toast + نوع (success/error/info/warning)،
 * آیکون پیش‌فرض info و برای موفقیت check_circle و برای خطا error، و بعد از ۲۸۰۰ms پنهان می‌شود.
 */
let listener = null;
const timers = new Map();

export function showToast(msg, type = 'success') {
  if (listener) listener({ msg, type, id: Date.now() + Math.random() });
}

export default function AppToast() {
  const [state, setState] = useState(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    listener = (next) => {
      setState(next);
      setShow(false);
      // معادل void toast.offsetWidth در PHP — یک رندر بین حذف و اضافهٔ کلاس show
      requestAnimationFrame(() => requestAnimationFrame(() => setShow(true)));
      const t = timers.get('toast');
      if (t) clearTimeout(t);
      timers.set(
        'toast',
        setTimeout(() => setShow(false), 2800)
      );
    };
    return () => {
      listener = null;
    };
  }, []);

  if (!state) return null;
  let icon = 'info';
  if (state.type === 'success') icon = 'check_circle';
  if (state.type === 'error') icon = 'error';

  return (
    <div className={`app-toast ${state.type} ${show ? 'show' : ''}`}>
      <span className="material-symbols-outlined">{icon}</span>
      <span>{state.msg}</span>
    </div>
  );
}
