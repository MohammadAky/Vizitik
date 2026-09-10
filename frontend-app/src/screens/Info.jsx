import { usePhpPage } from '../lib/usePhpPage.js';
import { BALE_BOT_LINK, BALE_BOT_MENTION } from '../lib/brand.js';
import BottomNav from '../components/BottomNav.jsx';

/**
 * راهنما و درباره — پورت ۱:۱ از frontend/help.php و frontend/about.php
 * (هر دو صفحه استاتیک‌اند و استایل سراسری style.css را بار می‌کنند)
 */
const FAQ = [
  {
    icon: 'help',
    q: 'چگونه ربات پیام‌رسان بله را متصل کنم؟',
    a: `به بخش تنظیمات بروید و روی دکمه «استارت ربات بله» کلیک کنید. با ارسال دستور /start در ربات ${BALE_BOT_MENTION}، شناسه شما ثبت شده و کدهای ورود و پیام‌های سرور برای شما ارسال می‌گردد.`
  },
  {
    icon: 'percent',
    q: 'چگونه تخفیف درصدی و مبلغی را همزمان اعمال کنم؟',
    a: 'در صفحه ثبت سفارش (new-order.php)، می‌توانید تگ‌های تخفیف درصدی (مثلاً ۵٪) را انتخاب کرده و در کادر پایین آن مبلغ تخفیف مستقیم (مثلاً ۵۰۰,۰۰۰ تومان) را وارد نمایید. سیستم هر دو را کسر کرده و مبلغ خالص را محاسبه می‌کند.'
  },
  {
    icon: 'print',
    q: 'نحوه اتصال به فیش‌پرینتر حرارتی بلوتوثی چگونه است؟',
    a: 'پس از ثبت سفارش، صفحه فاکتور حرارتی ۸۰ میلی‌متری باز می‌شود. با زدن دکمه «چاپ فاکتور حرارتی» می‌توانید مستقیم از طریق مرورگر یا چاپگر بلوتوثی پرینت بگیرید.'
  }
];

const FEATURES = [
  ['local_shipping', 'مدیریت بارگیری ون'],
  ['percent', 'تخفیف درصدی و مبلغی'],
  ['smart_toy', 'اتصال به ربات بله'],
  ['print', 'چاپ فاکتور حرارتی'],
  ['fact_check', 'مدیریت چک‌های صیادی'],
  ['offline_bolt', 'قابلیت کاربری آفلاین']
];

export default function Info({ kind, go }) {
  const page = usePhpPage(kind);
  const isHelp = kind === 'help';
  return (
    <>
      <header
        className="header"
        style={{
          background: '#001d31',
          color: '#ffffff',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <div>
          <h1 style={{ fontSize: '16px', fontWeight: 800, margin: 0, color: '#ffffff' }}>
            {isHelp ? 'راهنما و پشتیبانی' : 'درباره ویزیتیک'}
          </h1>
          <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.75)' }}>
            {isHelp ? 'پاسخ به سوالات متداول ویزیتورها' : 'سامانه جامع پخش گرم و ویزیتوری بستنی'}
          </span>
        </div>
        <a
          href="#/dash"
          className="back-btn"
          onClick={(e) => { e.preventDefault(); go('dash'); }}
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            background: 'rgba(255, 255, 255, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textDecoration: 'none',
            color: '#ffffff'
          }}
        >
          <span className="material-symbols-outlined" style={{ transform: 'scaleX(-1)' }}>
            arrow_forward
          </span>
        </a>
      </header>

      {isHelp ? (
        <main className="help-content">
          {FAQ.map((f) => (
            <div className="faq-card" key={f.q}>
              <div className="faq-title">
                <span className="material-symbols-outlined">{f.icon}</span>
                <span>{f.q}</span>
              </div>
              <p className="faq-desc">{f.a}</p>
            </div>
          ))}

          <div className="support-cta-box">
            <strong style={{ fontSize: '13px', color: '#166534' }}>نیاز به پشتیبانی تلفنی دارید؟</strong>
            <span style={{ fontSize: '11.5px', color: '#15803d' }}>تیم پشتیبانی فنی ویزیتیک پاسخگوی سوالات شماست.</span>
            <a
              href="tel:09120000000"
              style={{
                background: '#16a34a',
                color: '#fff',
                textDecoration: 'none',
                padding: '8px 18px',
                borderRadius: '10px',
                fontSize: '12px',
                fontWeight: 800
              }}
            >
              تماس با پشتیبانی فنی
            </a>
            <a
              href={BALE_BOT_LINK}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--primary)',
                color: '#fff',
                textDecoration: 'none',
                padding: '8px 18px',
                borderRadius: '10px',
                fontSize: '12px',
                fontWeight: 800
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>smart_toy</span>
              <span>استارت ربات بله ({BALE_BOT_MENTION})</span>
            </a>
          </div>
        </main>
      ) : (
        <main className="about-content">
          <div className="logo logo-lg" style={{ marginTop: '10px' }}>
            <span className="material-symbols-outlined">icecream</span>
          </div>
          <h2 style={{ fontSize: '18px', fontWeight: 900, margin: 0, color: 'var(--primary)' }}>
            ویزیتیک (نسخه ۱.۲.۰)
          </h2>
          <p
            style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              lineHeight: 1.7,
              maxWidth: '320px'
            }}
          >
            سامانه هوشمند و یکپارچه ویژه رانندگان، ویزیتورها و شرکت‌های توزیع و پخش مویرگی بستنی و مواد
            غذایی سردخانه‌ای.
          </p>

          <div className="about-card">
            <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>امکانات کلیدی سامانه:</strong>
            <div className="feature-grid">
              {FEATURES.map(([icon, label]) => (
                <div className="feature-box" key={label}>
                  <span className="material-symbols-outlined">{icon}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 'auto' }}>
            طراحی و توسعه یافته با استانداردهای پخش مویرگی ایران © ۲۰۲۶
          </div>
        </main>
      )}

      <BottomNav items={page.nav.items} active={page.nav.active} onGo={go} />
    </>
  );
}
