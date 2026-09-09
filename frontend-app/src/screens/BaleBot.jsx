import { useEffect, useState } from 'react';
import { api, apiSilent } from '../lib/api.js';
import { formatPrice, toPersianNum } from '../lib/format.js';
import { usePhpPage } from '../lib/usePhpPage.js';
import { showToast } from '../components/AppToast.jsx';

/**
 * مدیریت ربات بله — پورت ساختاری از frontend/bale-bot.php
 * (هدر bale-header، کارت وضعیت و آمار اتصال، لینک ربات با دکمه کپی،
 *  فرم اطلاع‌رسانی با پیش‌نمایش پیام و تاریخچه ارسال‌ها)
 */
export default function BaleBot({ go }) {
  const page = usePhpPage('bale');
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState(null);
  const [text, setText] = useState('');
  const [target, setTarget] = useState('ALL');
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [s, st] = await Promise.all([apiSilent('/bale/stats'), apiSilent('/bale/status')]);
    if (s) setStats(s);
    if (st) setStatus(st);
  }
  useEffect(() => { load(); }, []);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText('https://ble.ir/VizitikBot');
      showToast('لینک ربات کپی شد.', 'success');
    } catch {
      showToast('کپی در این مرورگر مجاز نیست.', 'error');
    }
  }

  async function send() {
    if (!text.trim()) { showToast('متن پیام خالی است.', 'error'); return; }
    setBusy(true);
    try {
      const res = await api('/bale/broadcast', { method: 'POST', body: { message: text.trim(), audience: target } });
      setHistory((h) => [{ id: Date.now(), text: text.trim(), sent: (res && res.sent) || 0 }, ...h]);
      setText('');
      showToast((res && res.message) || 'پیام از طریق ربات بله ارسال شد.', 'success');
    } catch (err) {
      showToast(err.message || 'خطا در ارسال پیام.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="bale-header">
        <div className="header-title-box">
          <h1>{page.h1}</h1>
          <span className="header-sub">ارسال خودکار فاکتور به مشتری و ویزیتور و اطلاع‌رسانی</span>
        </div>

        <a href="#/dash" className="back-btn" aria-label="بازگشت به داشبورد" onClick={(e) => { e.preventDefault(); go('dash'); }}>
          <span className="material-symbols-outlined">arrow_forward</span>
        </a>
      </header>

      <main className="settings-content">
        {/* کارت وضعیت سامانه و آمار تفکیکی اتصال */}
        <section className="settings-card bale-status-card">
          <div className="bale-status-row">
            <div className="bale-status-info">
              <div className="bale-avatar-icon">
                <span className="material-symbols-outlined icon-fill" style={{ fontSize: '26px' }}>wifi</span>
              </div>
              <div>
                <strong className="bale-status-text">ربات @VizitikBot</strong>
                <span className="bale-status-sub">{status && status.online ? 'سرور آنلاین است و پیام‌ها ارسال می‌شوند' : 'اتصال ربات برقرار نیست'}</span>
              </div>
            </div>
            <span className={`bale-online-badge ${status && status.online ? 'on' : 'off'}`}>
              {status && status.online ? 'برخط' : 'آفلاین'}
            </span>
          </div>

          <div className="bale-stats-grid">
            <div className="bale-stat-pill">
              <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>local_offer</span>
              <span>مشتریان متصل:</span>
              <strong>{toPersianNum((stats && stats.connectedCustomers) || 0)}</strong>
            </div>
            <div className="bale-stat-pill">
              <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>credit_card</span>
              <span>فاکتورهای ارسال‌شده:</span>
              <strong>{toPersianNum((stats && stats.invoicesSent) || 0)}</strong>
            </div>
          </div>

          <div className="bale-bot-link-row">
            <span className="bale-bot-link-text">https://ble.ir/VizitikBot</span>
            <button type="button" className="bale-copy-btn" onClick={copyLink} title="کپی لینک">
              <span className="material-symbols-outlined">content_copy</span>
            </button>
          </div>
        </section>

        {/* راهنمای اتصال */}
        <section className="settings-card">
          <div className="bale-onboarding-box">
            <div className="bale-onboarding-header">
              <span className="material-symbols-outlined">how_to_reg</span>
              <strong>چطور متصل شوم؟</strong>
            </div>
            <p className="bale-onboarding-text">
              در پیام‌رسان بله روی «استارت ربات» بزنید؛ پس از ارسال پیام /start، شماره موبایل شما شناسایی و فاکتورها به‌صورت خودکار ارسال می‌شوند.
            </p>
            <a href="https://ble.ir/VizitikBot" target="_blank" rel="noreferrer" className="bale-action-btn">
              <span className="material-symbols-outlined">open_in_new</span>
              <span>استارت ربات بله</span>
            </a>
          </div>
        </section>

        {/* اطلاع‌رسانی جمعی */}
        <section className="settings-card">
          <div className="section-card-header">
            <div className="header-icon bot">
              <span className="material-symbols-outlined">campaign</span>
            </div>
            <div className="header-titles">
              <h2>اطلاع‌رسانی به فروشگاه‌ها</h2>
              <span>پیام متنی برای مشتریان متصل</span>
            </div>
          </div>

          <div className="bale-templates-row">
            <select className="bale-select-input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="ALL">همه فروشگاه‌های متصل</option>
              <option value="DEBTORS">فقط بدهکاران</option>
              <option value="VISITOR">فقط ویزیتور</option>
            </select>
          </div>

          <textarea
            className="bale-textarea"
            rows="4"
            placeholder="متن پیام... مثلاً: تخفیف ویژه پنجشنبه، بار جدید رسید."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          <div className="bale-preview-card">
            <span className="bale-preview-label">پیش‌نمایش پیام در بله</span>
            <p className="bale-preview-text">{text || '…'}</p>
          </div>

          <button type="button" className="bale-action-btn" disabled={busy} onClick={send}>
            <span className="material-symbols-outlined">{busy ? 'sync' : 'send'}</span>
            <span>{busy ? 'در حال ارسال...' : 'ارسال پیام'}</span>
          </button>
        </section>

        {/* تاریخچه ارسال‌ها */}
        <section className="settings-card">
          <div className="bale-history-header">
            <span className="material-symbols-outlined">history_toggle_off</span>
            <strong>تاریخچه اطلاع‌رسانی</strong>
          </div>
          {history.length === 0 ? (
            <p className="bale-history-empty">هنوز پیامی از این دستگاه ارسال نشده است.</p>
          ) : (
            history.map((h) => (
              <div className="bale-history-item" key={h.id}>
                <div>
                  <strong>{h.text}</strong>
                  <div className="bale-history-sub">{toPersianNum(h.sent)} فروشگاه · {new Date(h.id).toLocaleString('fa-IR')}</div>
                </div>
                <span className="badge success">ارسال شد</span>
              </div>
            ))
          )}
        </section>
      </main>
    </>
  );
}
