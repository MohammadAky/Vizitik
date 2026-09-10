import { useEffect, useRef, useState } from 'react';
import { api, authStorage } from '../lib/api.js';
import { TERMS } from '../lib/terms.js';

/**
 * ورود / ثبت‌نام / بازیابی رمز — پورت ۱:۱ از frontend/index.php
 * (اسپلش intro، پنج auth-view داخل login-container، پردهٔ ورود page-curtain،
 *  مودال قوانین، خودکار رفتن روی کادرهای OTP و Paste کد — همان کلاس‌ها و متن‌ها)
 */

const VIEWS = {
  login: { title: 'ورود به حساب کاربری', sub: 'شماره موبایل و رمز عبور خود را وارد کنید' },
  registerForm: {
    title: 'ثبت‌نام ویزیتور جدید',
    sub: 'مشخصات خود را جهت ایجاد حساب کاربری وارد نمایید'
  },
  registerOtp: {
    title: 'تایید شماره در بله',
    sub: 'کد تایید ۵ رقمی ارسال شده به پیام‌رسان بله را وارد کنید'
  },
  forgotPhone: {
    title: 'فراموشی رمز عبور',
    sub: 'شماره موبایل ثبت‌شده را وارد کنید تا کد بازیابی ارسال شود'
  },
  forgotOtp: {
    title: 'تنظیم رمز عبور جدید',
    sub: 'کد ارسال شده به بله و رمز عبور جدید خود را وارد کنید'
  }
};

/** پنج کادر OTP با رفتار یکسان نسخهٔ PHP: advance، backspace، select و paste */
function OtpBoxes({ kind, value, onChange }) {
  const refs = useRef([]);

  function setAt(i, ch) {
    const next = value.slice();
    next[i] = ch;
    onChange(next);
    if (ch && i < 4) refs.current[i + 1]?.focus();
  }

  function onPaste(e, i) {
    e.preventDefault();
    e.stopPropagation();
    const digits = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '').slice(0, 5);
    if (!digits) return;
    const next = ['', '', '', '', ''];
    const start = Math.min(i, 4);
    digits.split('').forEach((ch, k) => {
      if (start + k < 5) next[start + k] = ch;
    });
    onChange(next);
    const focusIdx = Math.min(start + Math.min(digits.length, 5 - start), 4);
    refs.current[focusIdx]?.focus();
    refs.current[focusIdx]?.select();
  }

  return (
    <div className="otp-inputs">
      {[0, 1, 2, 3, 4].map((i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          type="text"
          className={`otp-box ${kind}-otp`}
          maxLength="1"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={value[i] || ''}
          onChange={(e) => setAt(i, e.target.value.replace(/[^0-9]/g, '').slice(-1))}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !value[i] && i > 0) refs.current[i - 1]?.focus();
          }}
          onFocus={(e) => e.target.select()}
          onPaste={(e) => onPaste(e, i)}
        />
      ))}
    </div>
  );
}

function EyeInput({ id, label, type = 'password', value, onChange, ...rest }) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <div className="password-wrap">
        <input
          id={id}
          type={reveal ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
        <button type="button" className="eye-toggle-btn" onClick={() => setReveal((v) => !v)}>
          <span className="material-symbols-outlined">{reveal ? 'visibility_off' : 'visibility'}</span>
        </button>
      </div>
    </div>
  );
}

export default function Auth({ onAuthed }) {
  const [view, setView] = useState('login');
  const [intro, setIntro] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [curtain, setCurtain] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [termsOpen, setTermsOpen] = useState(false);

  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [reg, setReg] = useState({ firstName: '', lastName: '', phone: '', password: '', terms: false });
  const [regOtp, setRegOtp] = useState(['', '', '', '', '']);
  const [forgotPhone, setForgotPhone] = useState('');
  const [resetOtp, setResetOtp] = useState(['', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const regData = useRef({});
  const resetPhoneRef = useRef('');

  // همان ترنزیشن اسپلش: بعد از ۱۲۰۰ms intro مخفی و login-page نمایان می‌شود
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 1200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    document.title = 'ویزیتیک — ورود به حساب کاربری';
  }, []);

  function switchView(next) {
    setView(next);
    setError('');
    if (next === 'registerOtp') setRegOtp(['', '', '', '', '']);
    if (next === 'forgotOtp') {
      setResetOtp(['', '', '', '', '']);
      setNewPassword('');
    }
  }

  const [otpNote, setOtpNote] = useState('');

  // the api tells us whether the code went to a Bale chat or is still waiting
  function rememberOtpDelivery(data) {
    if (data && data.delivery && data.delivery !== 'bale') setOtpNote(data.message || '');
    else setOtpNote('');
  }

  function showError(msg) {
    setError(msg);
  }

  async function proceedSuccessfulLogin(data) {
    if (data && data.accessToken) authStorage.setToken(data.accessToken);
    if (data && data.user) authStorage.setUser(data.user);
    setLeaving(true); // .app.leaving
    setCurtain(true); // .page-curtain.show
    setTimeout(() => onAuthed(), 1000); // window.location.replace("dashboard.php") در PHP
  }

  async function handleDirectLogin(e) {
    e.preventDefault();
    setBusy('login');
    setError('');
    try {
      const data = await api('/auth/login', { method: 'POST', body: { phone: loginPhone.trim(), password: loginPassword } });
      if (data && data.accessToken) {
        await proceedSuccessfulLogin(data);
        return;
      }
      showError('شماره تلفن یا رمز عبور اشتباه است.');
    } catch (err) {
      showError(err.message || 'ارتباط با سرور برقرار نشد. لطفاً از روشن بودن بک‌اند اطمینان حاصل کنید.');
    } finally {
      setBusy('');
    }
  }

  async function handleSendRegisterOtp(e) {
    e.preventDefault();
    if (!reg.terms) {
      showError('برای ادامه باید قوانین و مقررات را بپذیرید.');
      return;
    }
    setBusy('sendRegOtp');
    setError('');
    regData.current = { firstName: reg.firstName.trim(), lastName: reg.lastName.trim(), phone: reg.phone.trim(), password: reg.password };
    try {
      const data = await api('/auth/send-register-otp', { method: 'POST', body: { phone: regData.current.phone } });
      rememberOtpDelivery(data);
      switchView('registerOtp');
    } catch (err) {
      showError(err.message || 'خطا در ارسال کد ثبت‌نام.');
    } finally {
      setBusy('');
    }
  }

  async function handleCompleteRegistration(e) {
    e.preventDefault();
    const code = regOtp.join('');
    if (code.length < 5) {
      showError('لطفاً کد ۵ رقمی را کامل وارد کنید.');
      return;
    }
    setBusy('verifyReg');
    setError('');
    try {
      const data = await api('/auth/register-with-otp', { method: 'POST', body: { ...regData.current, code } });
      if (data && data.accessToken) {
        await proceedSuccessfulLogin(data);
        return;
      }
      showError('کد وارد شده نادرست یا منقضی است.');
    } catch (err) {
      showError(err.message || 'کد وارد شده نادرست یا منقضی است.');
    } finally {
      setBusy('');
    }
  }

  async function handleSendForgotOtp(e) {
    e.preventDefault();
    setBusy('sendForgotOtp');
    setError('');
    resetPhoneRef.current = forgotPhone.trim();
    try {
      const data = await api('/auth/send-reset-otp', { method: 'POST', body: { phone: resetPhoneRef.current } });
      rememberOtpDelivery(data);
      switchView('forgotOtp');
    } catch (err) {
      showError(err.message || 'کاربری با این شماره یافت نشد.');
    } finally {
      setBusy('');
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    const code = resetOtp.join('');
    if (code.length < 5) {
      showError('لطفاً کد ۵ رقمی را کامل وارد کنید.');
      return;
    }
    setBusy('resetPass');
    setError('');
    try {
      await api('/auth/reset-password-with-otp', {
        method: 'POST',
        body: { phone: resetPhoneRef.current, code, newPassword }
      });
      // نسخهٔ PHP با alert اطلاع می‌دهد؛ همان رفتار
      window.alert('رمز عبور شما با موفقیت تغییر کرد. اکنون با رمز جدید وارد شوید.');
      switchView('login');
      setLoginPhone(resetPhoneRef.current);
      setLoginPassword('');
    } catch (err) {
      showError(err.message || 'کد تایید نادرست یا منقضی است.');
    } finally {
      setBusy('');
    }
  }

  const meta = VIEWS[view];

  return (
    <>
      <div className={`app ${leaving ? 'leaving' : ''}`.trim()} id="app">
        {/* اسپلش اولیه کوتاه */}
        <section className={`intro ${intro ? '' : 'hide'}`.trim()} id="intro">
          <div className="logo logo-lg">
            <span className="material-symbols-outlined">icecream</span>
          </div>
          <h1>ویزیتیک</h1>
          <p>سامانه جامع ویزیتوری و پخش گرم</p>
        </section>

        {/* بخش ورود و احراز هویت */}
        <section className={`login-page ${intro ? '' : 'show'}`.trim()} id="loginPage">
          <div className="login-container">
            <div className="login-header">
              <div className="logo logo-md">
                <span className="material-symbols-outlined">icecream</span>
              </div>
              <h2 id="viewTitle">{meta.title}</h2>
              <p id="viewSubtitle">{meta.sub}</p>
            </div>

            {/* پیام خطا */}
            <div
              id="authErrorMsg"
              className="popup error-message"
              style={{
                display: error ? 'flex' : 'none',
                position: 'relative',
                marginBottom: '12px',
                width: '100%',
                boxSizing: 'border-box',
                flexShrink: 0
              }}
            >
              {error}
            </div>

            {/* ۱. فرم ورود مستقیم (بدون OTP) */}
            <form className={`auth-view ${view === 'login' ? 'active' : ''}`.trim()} id="viewLogin" onSubmit={handleDirectLogin}>
              <div className="input-group">
                <label htmlFor="loginPhone">شماره موبایل ویزیتور</label>
                <input
                  type="tel"
                  id="loginPhone"
                  placeholder="مثال: 09121234567"
                  maxLength="11"
                  value={loginPhone}
                  onChange={(e) => setLoginPhone(e.target.value)}
                  required
                  autoComplete="tel"
                />
              </div>

              <EyeInput
                id="loginPassword"
                label="رمز عبور"
                placeholder="رمز عبور"
                autoComplete="current-password"
                value={loginPassword}
                onChange={setLoginPassword}
                required
              />

              <div className="auth-links-row">
                <button type="button" onClick={() => switchView('forgotPhone')}>
                  فراموشی رمز عبور؟
                </button>
              </div>

              <button type="submit" className="login-btn" id="loginBtn" disabled={busy === 'login'}>
                {busy === 'login' ? (
                  <span>در حال بررسی...</span>
                ) : (
                  <>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', verticalAlign: 'middle' }}>
                      login
                    </span>
                    <span>ورود به حساب</span>
                  </>
                )}
              </button>

              <div className="switch-auth-box">
                حساب کاربری ندارید؟ <a href="#register" onClick={(e) => { e.preventDefault(); switchView('registerForm'); }}>ثبت‌نام ویزیتور جدید</a>
              </div>
            </form>

            {/* ۲. فرم ثبت‌نام کاربر جدید (مرحله ۱: دریافت اطلاعات) */}
            <form
              className={`auth-view ${view === 'registerForm' ? 'active' : ''}`.trim()}
              id="viewRegisterForm"
              onSubmit={handleSendRegisterOtp}
            >
              <div style={{ display: 'flex', gap: '8px' }}>
                <div className="input-group" style={{ flex: 1 }}>
                  <label htmlFor="regFirstName">نام</label>
                  <input
                    type="text"
                    id="regFirstName"
                    placeholder="مثلاً: علی"
                    required
                    value={reg.firstName}
                    onChange={(e) => setReg({ ...reg, firstName: e.target.value })}
                  />
                </div>
                <div className="input-group" style={{ flex: 1 }}>
                  <label htmlFor="regLastName">نام خانوادگی</label>
                  <input
                    type="text"
                    id="regLastName"
                    placeholder="مثلاً: حسینی"
                    required
                    value={reg.lastName}
                    onChange={(e) => setReg({ ...reg, lastName: e.target.value })}
                  />
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="regPhone">شماره موبایل</label>
                <input
                  type="tel"
                  id="regPhone"
                  placeholder="09xxxxxxxxx"
                  maxLength="11"
                  required
                  value={reg.phone}
                  onChange={(e) => setReg({ ...reg, phone: e.target.value })}
                />
              </div>

              <EyeInput
                id="regPassword"
                label="رمز عبور دلخواه (حداقل ۶ کاراکتر)"
                placeholder="حداقل ۶ کاراکتر"
                minLength="6"
                value={reg.password}
                onChange={(v) => setReg({ ...reg, password: v })}
                required
              />

              {/* موافقت با قوانین و مقررات */}
              <div className="terms-consent">
                <input
                  type="checkbox"
                  id="regTermsCheck"
                  required
                  checked={reg.terms}
                  onChange={(e) => setReg({ ...reg, terms: e.target.checked })}
                />
                <label className="terms-consent-text" htmlFor="regTermsCheck">
                  <span>
                    قوانین و مقررات و شرایط استفاده از سامانه <strong>ویزیتیک</strong> را می‌پذیرم و موافقم.
                  </span>
                  <small>
                    <button type="button" className="terms-link-btn" onClick={() => setTermsOpen(true)}>
                      مشاهده قوانین و مقررات
                    </button>
                  </small>
                </label>
              </div>

              <button type="submit" className="login-btn" id="sendRegOtpBtn" disabled={busy === 'sendRegOtp'}>
                {busy === 'sendRegOtp' ? (
                  <span>در حال ارسال کد به بله...</span>
                ) : (
                  <>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', verticalAlign: 'middle' }}>
                      send
                    </span>
                    <span>ارسال کد تایید به بله</span>
                  </>
                )}
              </button>

              <div className="bale-banner">
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                  smart_toy
                </span>
                <span>
                  کد به ربات بله ارسال می‌شود:{' '}
                  <a href="https://ble.ir/VizitikBot" target="_blank" rel="noreferrer">
                    استارت ربات
                  </a>
                </span>
              </div>

              <div className="switch-auth-box">
                قبلاً ثبت‌نام کرده‌اید؟{' '}
                <a href="#login" onClick={(e) => { e.preventDefault(); switchView('login'); }}>
                  ورود به حساب
                </a>
              </div>
            </form>

            {/* ۲.۱. ثبت‌نام (مرحله ۲: تایید کد ۵ رقمی) */}
            <form
              className={`auth-view ${view === 'registerOtp' ? 'active' : ''}`.trim()}
              id="viewRegisterOtp"
              autoComplete="off"
              onSubmit={handleCompleteRegistration}
            >
              <label style={{ fontSize: '11.5px', fontWeight: 700 }}>کد ۵ رقمی ارسال شده به پیام‌رسان بله:</label>
              <OtpBoxes kind="reg" value={regOtp} onChange={setRegOtp} />

              {otpNote ? (
                <div className="bale-banner">
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>notifications_active</span>
                  <span>{otpNote}</span>
                </div>
              ) : null}

              <button type="submit" className="login-btn" id="verifyRegBtn" disabled={busy === 'verifyReg'}>
                <span>{busy === 'verifyReg' ? 'در حال تکمیل ثبت‌نام...' : 'تکمیل ثبت‌نام و ورود'}</span>
              </button>

              <div className="switch-auth-box">
                <a href="#register" onClick={(e) => { e.preventDefault(); switchView('registerForm'); }}>
                  ویرایش مشخصات یا شماره
                </a>
              </div>
            </form>

            {/* ۳. فراموشی رمز عبور (مرحله ۱: دریافت شماره) */}
            <form
              className={`auth-view ${view === 'forgotPhone' ? 'active' : ''}`.trim()}
              id="viewForgotPhone"
              autoComplete="off"
              onSubmit={handleSendForgotOtp}
            >
              <div className="input-group">
                <label htmlFor="forgotPhone">شماره موبایل ثبت‌شده در سیستم</label>
                <input
                  type="tel"
                  id="forgotPhone"
                  placeholder="09xxxxxxxxx"
                  maxLength="11"
                  autoComplete="tel"
                  required
                  value={forgotPhone}
                  onChange={(e) => setForgotPhone(e.target.value)}
                />
              </div>

              <button type="submit" className="login-btn" id="sendForgotOtpBtn" disabled={busy === 'sendForgotOtp'}>
                {busy === 'sendForgotOtp' ? (
                  <span>در حال ارسال کد به بله...</span>
                ) : (
                  <>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', verticalAlign: 'middle' }}>
                      send
                    </span>
                    <span>ارسال کد بازیابی به بله</span>
                  </>
                )}
              </button>

              <div className="switch-auth-box">
                رمز را به یاد آوردید؟{' '}
                <a href="#login" onClick={(e) => { e.preventDefault(); switchView('login'); }}>
                  ورود به حساب
                </a>
              </div>
            </form>

            {/* ۳.۱. فراموشی رمز (مرحله ۲: تایید کد و رمز جدید) */}
            <form
              className={`auth-view ${view === 'forgotOtp' ? 'active' : ''}`.trim()}
              id="viewForgotOtp"
              autoComplete="off"
              onSubmit={handleResetPassword}
            >
              <label style={{ fontSize: '11.5px', fontWeight: 700 }}>کد ۵ رقمی ارسال شده به بله:</label>
              <OtpBoxes kind="reset" value={resetOtp} onChange={setResetOtp} />

              {otpNote ? (
                <div className="bale-banner">
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>notifications_active</span>
                  <span>{otpNote}</span>
                </div>
              ) : null}

              <EyeInput
                id="newResetPassword"
                label="رمز عبور جدید"
                placeholder="حداقل ۶ کاراکتر"
                minLength="6"
                autoComplete="new-password"
                value={newPassword}
                onChange={setNewPassword}
                required
              />

              <button type="submit" className="login-btn" id="resetPassBtn" disabled={busy === 'resetPass'}>
                <span>{busy === 'resetPass' ? 'در حال به‌روزرسانی رمز...' : 'ذخیره رمز جدید و ورود'}</span>
              </button>

              <div className="switch-auth-box">
                <a href="#login" onClick={(e) => { e.preventDefault(); switchView('login'); }}>
                  انصراف و بازگشت
                </a>
              </div>
            </form>
          </div>
        </section>

        {/* انیمیشن ترنزیشن ورود */}
        <div className={`page-curtain ${curtain ? 'show' : ''}`.trim()} id="pageCurtain">
          <div className="curtain-content">
            <div className="logo logo-lg">
              <span className="material-symbols-outlined">icecream</span>
            </div>
            <h1>ویزیتیک</h1>
            <p>در حال ورود به داشبورد ویزیتور...</p>
          </div>
        </div>
      </div>

      {/* مودال قوانین و مقررات */}
      <div
        className={`terms-modal-overlay ${termsOpen ? 'show' : ''}`.trim()}
        id="termsModal"
        onClick={(e) => {
          if (e.target === e.currentTarget) setTermsOpen(false);
        }}
      >
        <div className="terms-sheet">
          <div className="terms-head">
            <div className="terms-head-title">
              <span className="material-symbols-outlined">description</span>
              <span>قوانین و مقررات ویزیتیک</span>
            </div>
            <button type="button" className="terms-close" onClick={() => setTermsOpen(false)} aria-label="بستن">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <div className="terms-scroll">
            {TERMS.map((t) => (
              <div key={t.title}>
                <h4>{t.title}</h4>
                <p dangerouslySetInnerHTML={{ __html: t.html }} />
              </div>
            ))}
          </div>
          <div className="terms-actions">
            <button
              type="button"
              className="terms-accept-btn"
              onClick={() => {
                setReg((r) => ({ ...r, terms: true }));
                setTermsOpen(false);
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                check_circle
              </span>
              <span>مطالعه کردم و موافقم</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
