import { useState } from 'react';
import { api, authStorage } from '../lib/api.js';

const TERMS = `۱. سامانهٔ ویزیتیک ابزاری برای ثبت سفارش، صدور فاکتور و مدیریت بارِ ویزیتورهای پخش است.
۲. کاربر موظف است اطلاعات واردشده (مشتریان، بار، مبالغ) را صحیح و دقیق ثبت کند.
۳. حفظ امنیت حساب (رمز عبور و گوشی) بر عهدهٔ کاربر است.
۴. مسئولیت قانونی و مالی فاکتور صادرشده و تطبیق آن با سامانهٔ داخلی شرکت بر عهدهٔ ویزیتور است.
۵. اطلاعات مشتریان محرمانه است و نباید در اختیار افراد غیرمجاز قرار گیرد.
۶. اتصال به پیام‌رسان بله برای ارسال اطلاع‌رسانی و نسخهٔ فاکتور به مشتری انجام می‌شود.
۷. در صورت ارائهٔ اطلاعات ناصحیح، شرکت حق محدودسازی دسترسی را دارد.
۸. این قوانین ممکن است به‌روزرسانی شوند و ادامهٔ استفاده به معنای پذیرش نسخهٔ جدید است.`;

export default function Register({ onAuthed, goLogin }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!agree) {
      setError('برای ثبت‌نام باید «قوانین و مقررات» را پذیرفته باشید.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const data = await api('/auth/register', {
        method: 'POST',
        body: { firstName, lastName, phone: phone.trim(), password }
      });
      if (data && data.accessToken) authStorage.setToken(data.accessToken);
      if (data && data.user) authStorage.setUser(data.user);
      onAuthed();
    } catch (err) {
      setError(err.message || 'ثبت‌نام ناموفق بود.');
    } finally {
      setBusy(false);
    }
  }

  function acceptTerms() {
    setAgree(true);
    setShowTerms(false);
  }

  return (
    <>
      <form className="auth" onSubmit={submit} style={{ justifyContent: 'flex-start', paddingTop: 40 }}>
        <h1 style={{ marginBottom: 20 }}>ثبت‌نام ویزیتور</h1>

        {error && <div className="err">{error}</div>}

        <div className="field">
          <label>نام</label>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="field">
          <label>نام خانوادگی</label>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <div className="field">
          <label>شماره موبایل</label>
          <input inputMode="tel" dir="ltr" placeholder="0912…" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label>رمز عبور</label>
          <input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, margin: '4px 0 14px', color: '#cfe2ef' }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>قوانین و مقررات را می‌پذیرم — </span>
          <button type="button" onClick={() => setShowTerms(true)} style={{ background: 'none', color: '#ff8a3d', fontWeight: 700, padding: 0 }}>
            مشاهدهٔ قوانین
          </button>
        </label>

        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'در حال ثبت‌نام…' : 'ثبت‌نام'}
        </button>

        <div className="auth-foot">
          قبلاً ثبت‌نام کرده‌اید؟{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); goLogin(); }}>وارد شوید</a>
        </div>
      </form>

      {showTerms && (
        <div className="terms-overlay" onClick={() => setShowTerms(false)}>
          <div className="terms-sheet" onClick={(e) => e.stopPropagation()}>
            <h3>قوانین و مقررات</h3>
            <div className="terms-scroll">
              {TERMS.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            <button className="btn primary" onClick={acceptTerms}>مطالعه کردم و موافقم</button>
          </div>
        </div>
      )}
    </>
  );
}
