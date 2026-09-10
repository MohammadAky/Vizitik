import { useEffect, useMemo, useState } from 'react';
import { api, apiSilent, authStorage } from '../lib/api.js';
import { formatPrice, toPersianNum } from '../lib/format.js';
import { BALE_BOT_LINK, BALE_BOT_MENTION } from '../lib/brand.js';
import { usePhpPage } from '../lib/usePhpPage.js';
import { showToast } from '../components/AppToast.jsx';

// قالب‌های آماده پیام — عیناً از bale-bot.php (با همان جایگذاری‌ها)
const TEMPLATES = {
  debt: 'همکار گرامی؛ {نام_فروشگاه}\nبا سلام، مانده حساب جاری شما نزد {نام_ویزیتور} مبلغ {مبلغ_بدهی} می‌باشد. خواهشمند است نسبت به تسویه یا هماهنگی پرداخت اقدام فرمایید.\nبا تشکر از همکاری شما',
  stock: 'مشتری محترم؛ {نام_فروشگاه}\nبار جدید بستنی در خودرو بارگیری شد. جهت ثبت سفارش گرم و تحویل آنی تماس بگیرید.\nویزیتور شما: {نام_ویزیتور}',
  promo: 'فروشگاه محترم؛ {نام_فروشگاه}\nجشنواره تخفیفات ویژه نقدی بستنی آغاز شد! با تسویه نقدی فاکتور امروز از تخفیفات پلکانی ویژه بهره‌مند شوید.\n{نام_ویزیتور}',
  custom: 'همکار گرامی؛ {نام_فروشگاه}\n'
};

const TEMPLATE_BUTTONS = [
  ['debt', 'tplDebt', 'credit_card', 'یادآوری مانده بدهی'],
  ['stock', 'tplStock', 'inventory_2', 'بار جدید'],
  ['promo', 'tplPromo', 'local_offer', 'جشنواره تخفیف نقدی'],
  ['custom', 'tplCustom', 'edit_note', 'متن دلخواه']
];

/**
 * مدیریت ربات بله — پورت ۱:۱ از frontend/bale-bot.php
 * (هدر bale-header، کارت وضعیت با آمار سه‌گانه اتصال، باکس لینک اتصال با دکمه کپی،
 *  فرم اطلاع‌رسانی با انتخاب مخاطب + قالب‌های آماده + پیش‌نمایش جایگذاری‌شده،
 *  و تاریخچه اعلان‌های ارسالی) — همان کلاس‌ها و متن‌های bale-bot.css
 */
export default function BaleBot({ go }) {
  const page = usePhpPage('bale');
  const [customers, setCustomers] = useState([]);
  const [audience, setAudience] = useState('debtors');
  const [singleId, setSingleId] = useState('');
  const [currentTpl, setCurrentTpl] = useState('debt');
  const [message, setMessage] = useState(TEMPLATES.debt);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiSilent('/customers').then((cs) => {
      if (Array.isArray(cs)) {
        setCustomers(cs);
        if (cs[0]) setSingleId(cs[0].id);
      }
    });
  }, []);

  const debtors = useMemo(() => customers.filter((c) => Number(c.currentDebt) > 0), [customers]);
  const linked = useMemo(() => customers.filter((c) => c.baleChatId), [customers]);
  const unlinked = useMemo(() => customers.filter((c) => !c.baleChatId), [customers]);

  // نام ویزیتور با قالب هشتگ (مثل #فاطمه_اکبری) — همراستا با قالب فاکتور بله
  const user = authStorage.user || {};
  const visitorTag = useMemo(() => {
    const full = `${user.firstName || ''} ${user.lastName || ''}`.trim().replace(/\s+/g, '_');
    return `#${full || 'ویزیتور'}`;
  }, [user.firstName, user.lastName]);

  const singleCustomer = customers.find((c) => String(c.id) === String(singleId)) || null;

  // پیش‌نمایش پیام با جایگذاری اطلاعات نمونه — عین updatePreviewMessage در bale-bot.php
  const preview = useMemo(() => {
    let sampleName = '{نام_فروشگاه}';
    let sampleDebt = '{مبلغ_بدهی}';
    if (audience === 'single' && singleCustomer) {
      sampleName = singleCustomer.name || sampleName;
      const d = Number(singleCustomer.currentDebt) || 0;
      sampleDebt = d > 0 ? `${formatPrice(d)} تومان` : '۰ تومان (تسویه)';
    } else if (debtors.length > 0) {
      sampleName = debtors[0].name;
      sampleDebt = `${formatPrice(debtors[0].currentDebt)} تومان`;
    } else if (customers.length > 0) {
      sampleName = customers[0].name;
      sampleDebt = `${formatPrice(customers[0].currentDebt || 0)} تومان`;
    }
    return (message || '')
      .replace(/{نام_فروشگاه}/g, sampleName)
      .replace(/{نام_ویزیتور}/g, visitorTag)
      .replace(/{مبلغ_بدهی}/g, sampleDebt);
  }, [message, audience, singleCustomer, debtors, customers, visitorTag]);

  function selectTemplate(tplKey) {
    setCurrentTpl(tplKey);
    setMessage(TEMPLATES[tplKey] || '');
  }

  async function copyBotLink() {
    try {
      await navigator.clipboard.writeText(BALE_BOT_LINK);
      showToast('لینک ربات بله با موفقیت کپی شد.', 'success');
    } catch {
      window.prompt('لینک ربات بله را کپی کنید:', BALE_BOT_LINK);
    }
  }

  function audienceLabel() {
    if (audience === 'debtors') return 'مشتریان بدهکار';
    if (audience === 'all') return 'همه مشتریان';
    return (singleCustomer && singleCustomer.name) || 'مشتری';
  }

  async function executeBroadcast() {
    const msg = (message || '').trim();
    if (!msg) {
      showToast('لطفاً متن پیام را وارد کنید.', 'error');
      return;
    }
    let targets = [];
    if (audience === 'debtors') {
      targets = debtors;
      if (targets.length === 0) {
        showToast('هیچ مشتری بدهکاری یافت نشد.', 'error');
        return;
      }
    } else if (audience === 'all') {
      targets = customers;
      if (targets.length === 0) {
        showToast('هیچ مشتری ثبت‌شده‌ای یافت نشد.', 'error');
        return;
      }
    } else {
      if (!singleCustomer) {
        showToast('مشتری‌ای انتخاب نشده است.', 'error');
        return;
      }
      targets = [singleCustomer];
    }

    if (!window.confirm(`آیا از ارسال این پیام اطلاع‌رسانی به ${toPersianNum(targets.length)} مشتری اطمینان دارید؟`)) return;

    setBusy(true);
    try {
      const data = await api('/bale/broadcast', {
        method: 'POST',
        body: {
          templateText: msg,
          targetType: audience,
          singleCustomerId: audience === 'single' ? singleId : undefined
        }
      });
      const count = (data && data.sentCount) || targets.length;
      showToast(`پیام اطلاع‌رسانی با موفقیت به ${toPersianNum(count)} مشتری از طریق بله ارسال شد.`, 'success');
      setHistory((h) => [{ id: Date.now(), audience: audienceLabel(), count }, ...h]);
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
                <span className="material-symbols-outlined icon-fill" style={{ fontSize: '26px' }}>smart_toy</span>
              </div>
              <div className="bale-status-text">
                <strong>ارسال خودکار فاکتور در بله فعال است</strong>
                <div className="bale-status-sub">شناسه ربات: {BALE_BOT_MENTION}</div>
              </div>
            </div>
            <span className="bale-online-badge">
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>wifi</span>
              آنلاین
            </span>
          </div>

          {/* آمار سه‌گانه مشتریان */}
          <div className="bale-stats-grid">
            <div className="bale-stat-pill">
              <strong>{toPersianNum(customers.length)}</strong>
              <span>کل مشتریان</span>
            </div>
            <div className="bale-stat-pill success">
              <strong>{toPersianNum(linked.length)}</strong>
              <span>متصل به بله</span>
            </div>
            <div className="bale-stat-pill warning">
              <strong>{toPersianNum(unlinked.length)}</strong>
              <span>در انتظار اتصال</span>
            </div>
          </div>
        </section>

        {/* کارت اتصال و دعوت آسان فروشگاه‌ها */}
        <section className="settings-card">
          <div className="bale-onboarding-box">
            <div className="bale-onboarding-header">
              <span className="material-symbols-outlined">link</span>
              <span>لینک اتصال خودکار مشتریان به ربات</span>
            </div>
            <p className="bale-onboarding-text">
              هنگام ثبت هر فاکتور، نسخه کامل و رسمی فاکتور به صورت خودکار به بله فروشگاه و ویزیتور ارسال می‌شود. مشتریان با باز کردن ربات و لمس دکمه <strong>«ارسال شماره موبایل»</strong> متصل می‌شوند.
            </p>
            <div className="bale-bot-link-row">
              <span className="bale-bot-link-text">{BALE_BOT_LINK}</span>
              <button type="button" className="bale-copy-btn" onClick={copyBotLink}>
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>content_copy</span>
                <span>کپی لینک</span>
              </button>
            </div>
            <a href={BALE_BOT_LINK} target="_blank" rel="noreferrer" className="bale-action-btn">
              <span className="material-symbols-outlined">open_in_new</span>
              <span>استارت ربات بله ({BALE_BOT_MENTION})</span>
            </a>
          </div>
        </section>

        {/* فرم ارسال پیام همگانی / یادآوری به مشتریان */}
        <section className="settings-card">
          <h3 style={{ fontSize: '13.5px', fontWeight: 800, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>campaign</span>
            <span>ارسال پیام و اطلاع‌رسانی به مشتریان</span>
          </h3>

          {/* ۱. انتخاب گروه هدف مخاطبان */}
          <div className="input-group">
            <label>گیرندگان پیام:</label>
            <select id="broadcastAudience" className="bale-select-input" value={audience} onChange={(e) => setAudience(e.target.value)}>
              <option value="debtors">مشتریان دارای بدهی ({toPersianNum(debtors.length)} فروشگاه)</option>
              <option value="all">همه مشتریان تحت پوشش ({toPersianNum(customers.length)} فروشگاه)</option>
              <option value="single">انتخاب یک مشتری مشخص...</option>
            </select>
          </div>

          {/* دراپ‌داون انتخاب یک مشتری (در صورت انتخاب حالت تکی) */}
          <div className="input-group" id="singleCustomerWrap" style={{ display: audience === 'single' ? 'block' : 'none' }}>
            <label>انتخاب فروشگاه:</label>
            <select id="singleCustomerSelect" className="bale-select-input" value={singleId} onChange={(e) => setSingleId(e.target.value)}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {Number(c.currentDebt) > 0 ? ` (بدهی: ${formatPrice(c.currentDebt)} ت)` : ' (تسویه)'}
                </option>
              ))}
            </select>
          </div>

          {/* ۲. انتخاب قالب‌های پیام آماده */}
          <div className="input-group" style={{ marginTop: '6px' }}>
            <label>قالب پیام آماده:</label>
            <div className="bale-templates-row">
              {TEMPLATE_BUTTONS.map(([key, id, icon, label]) => (
                <button key={key} type="button" className={`bale-tpl-btn ${currentTpl === key ? 'active' : ''}`} id={id} onClick={() => selectTemplate(key)}>
                  <span className="material-symbols-outlined">{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ۳. متن پیام ارسالی */}
          <div className="input-group" style={{ marginTop: '6px' }}>
            <label htmlFor="broadcastMessage">متن پیام (با امکان جایگذاری خودکار اطلاعات):</label>
            <textarea id="broadcastMessage" className="bale-textarea" rows="4" value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>

          {/* پیش‌نمایش پیام */}
          <div className="bale-preview-card">
            <div className="bale-preview-label">پیش‌نمایش پیام ارسالی به بله مشتری:</div>
            <div id="previewBox" className="bale-preview-text">{preview}</div>
          </div>

          {/* دکمه ارسال */}
          <button type="button" className="login-btn" id="sendBroadcastBtn" style={{ marginTop: '10px', height: '44px', fontSize: '13.5px' }} disabled={busy} onClick={executeBroadcast}>
            {busy ? (
              <span>در حال ارسال پیام به مشتریان در بله...</span>
            ) : (
              <>
                <span className="material-symbols-outlined">send</span>
                <span id="sendBtnText">ارسال پیام به بله مشتریان</span>
              </>
            )}
          </button>
        </section>

        {/* تاریخچه اعلان‌های ارسالی اخیر */}
        <section className="settings-card">
          <h3 style={{ fontSize: '13.5px', fontWeight: 800, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>history</span>
            <span>اعلان‌های اخیر ارسال شده</span>
          </h3>

          <div id="broadcastHistoryList" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {history.length === 0 ? (
              <div className="bale-history-empty" id="emptyHistoryMsg">
                <span className="material-symbols-outlined">history_toggle_off</span>
                <span>هنوز اعلانی از این بخش ارسال نشده است.</span>
              </div>
            ) : (
              history.map((h) => (
                <div className="bale-history-item" key={h.id}>
                  <div className="bale-history-header">
                    <span>ارسال پیام به {h.audience}</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>هم‌اکنون</span>
                  </div>
                  <div className="bale-history-sub">ارسال موفق به {toPersianNum(h.count)} مخاطب بله.</div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </>
  );
}
