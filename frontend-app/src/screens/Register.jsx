import { useState } from 'react';
import { api, authStorage } from '../lib/api.js';
import { APP_NAME_FA } from '../lib/brand.js';

const TERMS = `۱. سامانهٔ ${APP_NAME_FA} ابزاری برای ثبت سفارش، صدور فاکتور و مدیریت بارِ ویزیتورهای پخش است.
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
    if (!agree) { setError('برای ثبت‌نام باید «قوانین و مقررات» را پذیرفته باشید.'); return; }
    setError('');
    setBusy(true);
    try {
      const data = await api('/auth/register', { method: 'POST', body: { firstName, lastName, phone: phone.trim(), password } });
      if (data && data.accessToken) authStorage.setToken(data.accessToken);
      if (data && data.user) authStorage.setUser(data.user);
      onAuthed();
    } catch (err) { setError(err.message || 'ثبت‌نام ناموفق بود.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-wrap">
      <form className="auth" onSubmit={submit} style={{ padding: '30px 0' }}>
        <h1 style={{ marginBottom: 18 }}>ثبت‌نام ویزیتور</h1>
        {error && <div className="auth-error">{error}</div>}

        <div className="field"><label>نام</label><input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
        <div className="field"><label>نام خانوادگی</label><input value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
        <div className="field"><label>شماره موبایل</label><input inputMode="tel" dir="ltr" placeholder="0912…" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="field"><label>رمز عبور</label><input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} /></div>

        <label className="terms-check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            قوانین و مقررات را می‌پذیرم —{' '}
            <button type="button" className="terms-link" onClick={() => setShowTerms(true)}>مشاهدهٔ قوانین</button>
          </span>
        </label>

        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'در حال ثبت‌نام…' : 'ثبت‌نام'}</button>
        <div className="auth-foot">قبلاً ثبت‌نام کرده‌اید؟ <a href="#" onClick={(e) => { e.preventDefault(); goLogin(); }}>وارد شوید</a></div>
      </form>

      {showTerms && (
        <div className="modal-overlay modal-center" onClick={() => setShowTerms(false)}>
          <div className="modal-sheet" style={{ borderRadius: 22 }} onClick={(e) => e.stopPropagation()}>
            <h3>قوانین و مقررات</h3>
            <div style={{ maxHeight: '52vh', overflowY: 'auto', fontSize: 13, lineHeight: 2 }}>
              {TERMS.split('\n').map((line, i) => <p key={i}>{line}</p>)}
            </div>
            <button className="btn" onClick={() => { setAgree(true); setShowTerms(false); }}>مطالعه کردم و موافقم</button>
          </div>
        </div>
      )}
    </div>
  );
}
