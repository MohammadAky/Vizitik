import { useEffect, useState } from 'react';
import { api, authStorage } from '../lib/api.js';
import { toPersianNum } from '../lib/format.js';
import { usePhpPage } from '../lib/usePhpPage.js';
import BottomNav from '../components/BottomNav.jsx';

const PREFS_KEY = 'vizitik_invoice_prefs';

/** کارت تنظیمات با هدر آیکون‌دار — همان settings-section-card در settings.php */
function Section({ icon, iconCls, title, sub, children }) {
  return (
    <section className="settings-section-card">
      <div className="section-card-header">
        <div className={`header-icon ${iconCls}`}>
          <span className="material-symbols-outlined">{icon}</span>
        </div>
        <div className="header-titles">
          <h2>{title}</h2>
          <span>{sub}</span>
        </div>
      </div>
      {children}
    </section>
  );
}

function PasswordField({ id, labelHtml, hint, placeholder, value, onChange, onInput, required, minLength, footer }) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="field-group">
      <label className="field-label" htmlFor={id}>
        <span>{labelHtml}</span>
        {hint && <span className="hint-opt">{hint}</span>}
      </label>
      <div className="password-input-wrap">
        <input
          type={reveal ? 'text' : 'password'}
          id={id}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          value={value}
            onChange={(e) => {
            onChange(e.target.value);
            if (onInput) onInput(e.target.value);
          }}
        />
        <button type="button" className="password-toggle-btn" aria-label="نمایش رمز" onClick={() => setReveal((v) => !v)}>
          <span className="material-symbols-outlined">{reveal ? 'visibility_off' : 'visibility'}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * تنظیمات و پروفایل — پورت ۱:۱ از frontend/settings.php
 * (توست اختصاصی settings-toast، کارت پروفایل، تغییر رمز، بخش بله، سه سوئیچ تنظیمات چاپ
 *  که در localStorage با کلید vizitik_invoice_prefs ذخیره می‌شوند، اطلاعات سامانه و دکمه خروج)
 */
export default function Settings({ go, logout }) {
  const page = usePhpPage('settings');
  const user = authStorage.user || {};
  const firstName = user.firstName || 'علی';
  const lastName = user.lastName || 'حسینی';
  const userPhone = user.phone || '09121234567';
  const userRole = user.role === 'ADMIN' ? 'مدیر ارشد سیستم' : 'مسئول توزیع و ویزیتور';

  const [toast, setToast] = useState({ show: false, type: 'success', text: 'عملیات با موفقیت انجام شد', icon: 'check_circle' });
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [matchHint, setMatchHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState({ discountBreakdown: true, prevDebt: true, vanStockAlert: true });

  // بازیابی تنظیمات هنگام لود صفحه (DOMContentLoaded در PHP)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PREFS_KEY);
      if (saved) setPrefs((p) => ({ ...p, ...JSON.parse(saved) }));
    } catch {
      /* همان try/catch فایل PHP */
    }
  }, []);

  function showToast(message, type = 'success') {
    setToast({
      show: true,
      type,
      icon: type === 'success' ? 'check_circle' : 'error',
      text: message
    });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 2500);
  }

  function saveInvoicePreferences(patch) {
    const merged = { ...prefs, ...patch };
    setPrefs(merged);
    localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
    showToast('تنظیمات چاپ و فاکتور با موفقیت ذخیره شد.', 'success');
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    if (next !== confirm) {
      showToast('رمز عبور جدید با تکرار آن یکسان نیست.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'PUT', body: { currentPassword: current, newPassword: next } });
      showToast('رمز عبور با موفقیت تغییر کرد.', 'success');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      showToast(err.message || 'خطا در تغییر رمز عبور.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* توست پیام‌های سیستم */}
      <div id="settingsToast" className={`settings-toast ${toast.type} ${toast.show ? 'show' : ''}`}>
        <span className="material-symbols-outlined" id="toastIcon">
          {toast.icon}
        </span>
        <span id="toastText">{toast.text}</span>
      </div>

      {/* هدر صفحه تنظیمات */}
      <header className="settings-header">
        <div className="header-top-row">
          <div className="header-title-box">
            <h1>{page.h1}</h1>
            <span className="header-sub">امنیت، اتصال بله و تنظیمات چاپ</span>
          </div>

          <a href="#/dash" className="back-btn" aria-label="بازگشت به داشبورد" onClick={(e) => { e.preventDefault(); go('dash'); }}>
            <span className="material-symbols-outlined">arrow_forward</span>
          </a>
        </div>
      </header>

      {/* ناحیه اسکرول محتوای تنظیمات */}
      <main className="settings-content">
        {/* کارت پروفایل کاربر */}
        <section className="profile-card">
          <div className="profile-avatar-wrap">
            <div className="profile-avatar">{firstName.slice(0, 1)}</div>
            <span className="online-dot" title="آنلاین"></span>
          </div>

          <div className="profile-meta">
            <h2 className="profile-name">
              {firstName} {lastName}
            </h2>
            <div className="profile-phone-row">
              <span className="material-symbols-outlined">smartphone</span>
              <span>{toPersianNum(userPhone)}</span>
            </div>
            <div className="profile-badge-row">
              <span className="profile-badge">{userRole}</span>
              <span className="profile-status-badge">فعال</span>
            </div>
          </div>
        </section>

        {/* بخش ۱: تغییر رمز عبور */}
        <Section icon="lock_reset" iconCls="security" title="امنیت و تغییر رمز عبور" sub="به‌روزرسانی رمز عبور جهت ورود با گذرواژه">
          <form className="settings-form" onSubmit={handleChangePassword}>
            <PasswordField
              id="currentPassword"
              labelHtml="رمز عبور فعلی"
              hint="(اختیاری)"
              placeholder="رمز عبور فعلی خود را وارد کنید"
              value={current}
              onChange={setCurrent}
            />
            <PasswordField
              id="newPassword"
              labelHtml={
                <>
                  رمز عبور جدید <span className="required-star">*</span>
                </>
              }
              hint="حداقل ۶ کاراکتر"
              placeholder="رمز عبور جدید"
              required
              minLength={6}
              value={next}
              onChange={setNext}
              onInput={(v) => setMatchHint(v.length > 0 && v !== confirm)}
            />
            <PasswordField
              id="confirmPassword"
              labelHtml={
                <>
                  تکرار رمز عبور جدید <span className="required-star">*</span>
                </>
              }
              placeholder="تکرار رمز عبور جدید"
              required
              minLength={6}
              value={confirm}
              onChange={setConfirm}
              onInput={(v) => setMatchHint(next.length > 0 && next !== v)}
              footer={
                <span className="password-match-hint" id="matchHint" style={{ opacity: matchHint ? 1 : 0 }}>
                  رمز عبور جدید با تکرار آن یکسان نیست
                </span>
              }
            />

            <button type="submit" className="save-password-btn" id="changePasswordBtn" disabled={busy}>
              <span className="material-symbols-outlined">check_circle</span>
              <span>{busy ? 'در حال تغییر رمز...' : 'ذخیره رمز عبور جدید'}</span>
            </button>
          </form>
        </Section>

        {/* بخش ۲: اتصال به ربات پیام‌رسان بله */}
        <Section icon="smart_toy" iconCls="bot" title="پیام‌رسان بله (ورود با کد OTP)" sub="کدهای تایید سریع ۲ مرحله‌ای">
          <div className="bale-info-box">
            <div className="bale-status-row">
              <span className="material-symbols-outlined">verified</span>
              <span>سامانه پیام‌رسان بله آماده ارسال کد تایید است</span>
            </div>
            <p className="bale-info-text">
              کدهای یکبار مصرف ورود، تاییدیه صدور فاکتور و هشدارهای سررسید چک‌های ویزیتوری به ربات بله ارسال می‌گردد.
            </p>
          </div>

          <a href="https://ble.ir/VizitikBot" target="_blank" rel="noreferrer" className="bale-action-btn">
            <span className="material-symbols-outlined">open_in_new</span>
            <span>ورود و استارت ربات بله (@VizitikBot)</span>
          </a>
        </Section>

        {/* بخش ۳: تنظیمات فاکتور و چاپ */}
        <Section icon="receipt_long" iconCls="print" title="تنظیمات فاکتور و چاپگر" sub="شخصی‌سازی خروجی فاکتور مشتریان">
          {[
            ['prefDiscountBreakdown', 'discountBreakdown', 'تفکیک تخفیف‌های پلکانی در چاپ', 'درصد و مبالغ تخفیف خرید در فاکتور درج گردد'],
            ['prefPrevDebt', 'prevDebt', 'نمایش مانده بدهی قبلی مشتری', 'مانده حساب باز و بدهی در پایین فاکتور چاپ شود'],
            ['prefVanStockAlert', 'vanStockAlert', 'هشدار کسری موجودی ون', 'هنگام صدور فاکتور بیش از موجودی بار اخطار دهد']
          ].map(([id, key, strong, span]) => (
            <div className="setting-toggle-row" key={id}>
              <div className="toggle-info">
                <strong>{strong}</strong>
                <span>{span}</span>
              </div>
              <label className="switch">
                <input type="checkbox" id={id} checked={!!prefs[key]} onChange={(e) => saveInvoicePreferences({ [key]: e.target.checked })} />
                <span className="slider"></span>
              </label>
            </div>
          ))}
        </Section>

        {/* بخش ۴: اطلاعات نرم‌افزار */}
        <Section icon="info" iconCls="info" title="اطلاعات سامانه" sub="نسخه و وضعیت اتصال">
          <div className="app-meta-row">
            <span>نسخه نرم‌افزار:</span>
            <span className="app-meta-val">۱.۲.۰ (ویژه ویزیتوری پخش گرم)</span>
          </div>
          <div className="app-meta-row">
            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>hourglass_empty</span>
            <span>اعتبار نشست:</span>
            <span className="app-meta-val">۳۰ دقیقه بی‌فعالیت</span>
          </div>
          <div className="app-meta-row">
            <span>وضعیت اتصال پایگاه داده:</span>
            <span className="app-meta-val" style={{ color: '#16a34a' }}>
              متصل و همگام
            </span>
          </div>
        </Section>

        {/* بخش ۵: خروج از حساب */}
        <div className="logout-btn-box">
          <a
            href="#/logout"
            className="logout-full-btn"
            onClick={(e) => {
              e.preventDefault();
              if (window.confirm('آیا برای خروج از حساب کاربری اطمینان دارید؟')) logout();
            }}
          >
            <span className="material-symbols-outlined">logout</span>
            <span>خروج از حساب کاربری</span>
          </a>
        </div>
      </main>

      {/* نوار ناوبری پایینی */}
      <BottomNav items={page.nav.items} active={page.nav.active} onGo={go} />
    </>
  );
}
