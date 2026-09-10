<?php
require_once 'auth_helper.php';
requireLogin();
?>
<!DOCTYPE html>
<html dir="rtl" lang="fa">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>ویزیتیک — راهنما و پشتیبانی</title>

    <link rel="stylesheet" href="./fonts/vazirmatn/vazirmatn.css">
    <link rel="stylesheet" href="./fonts/material-symbols/material-symbols.css" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">

    <style>
        .help-content {
            flex: 1;
            overflow-y: auto;
            padding: 16px 16px 85px 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .faq-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 14px;
            padding: 14px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .faq-title {
            font-size: 13px;
            font-weight: 800;
            color: var(--primary);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .faq-desc {
            font-size: 11.5px;
            color: var(--text-secondary);
            line-height: 1.6;
        }
        .support-cta-box {
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
            border-radius: 16px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            text-align: center;
            margin-top: 6px;
        }
    </style>
</head>

<body>
    <div class="app" id="app">

        <header class="header" style="background: #001d31; color: #ffffff; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding: 12px 16px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <h1 style="font-size: 16px; font-weight:800; margin:0; color:#ffffff;">راهنما و پشتیبانی</h1>
                <span style="font-size: 11px; color:rgba(255, 255, 255, 0.75);">پاسخ به سوالات متداول ویزیتورها</span>
            </div>
            <a href="dashboard.php" class="back-btn" style="width:38px; height:38px; border-radius:12px; border:1px solid rgba(255, 255, 255, 0.2); background:rgba(255, 255, 255, 0.12); display:flex; align-items:center; justify-content:center; text-decoration:none; color:#ffffff;">
                <span class="material-symbols-outlined" style="transform: scaleX(-1);">arrow_forward</span>
            </a>
        </header>

        <main class="help-content">
            <div class="faq-card">
                <div class="faq-title">
                    <span class="material-symbols-outlined">help</span>
                    <span>چگونه ربات پیام‌رسان بله را متصل کنم؟</span>
                </div>
                <p class="faq-desc">
                    به بخش تنظیمات بروید و روی دکمه «استارت ربات بله» کلیک کنید. با ارسال دستور /start در ربات <a href="https://ble.ir/Vizitik_bot" target="_blank">@Vizitik_bot</a>، شناسه شما ثبت شده و کدهای ورود و پیام‌های سرور برای شما ارسال می‌گردد.
                </p>
            </div>

            <div class="faq-card">
                <div class="faq-title">
                    <span class="material-symbols-outlined">percent</span>
                    <span>چگونه تخفیف درصدی و مبلغی را همزمان اعمال کنم؟</span>
                </div>
                <p class="faq-desc">
                    در صفحه ثبت سفارش (new-order.php)، می‌توانید تگ‌های تخفیف درصدی (مثلاً ۵٪) را انتخاب کرده و در کادر پایین آن مبلغ تخفیف مستقیم (مثلاً ۵۰۰,۰۰۰ تومان) را وارد نمایید. سیستم هر دو را کسر کرده و مبلغ خالص را محاسبه می‌کند.
                </p>
            </div>

            <div class="faq-card">
                <div class="faq-title">
                    <span class="material-symbols-outlined">print</span>
                    <span>نحوه اتصال به فیش‌پرینتر حرارتی بلوتوثی چگونه است؟</span>
                </div>
                <p class="faq-desc">
                    پس از ثبت سفارش، صفحه فاکتور حرارتی ۸۰ میلی‌متری باز می‌شود. با زدن دکمه «چاپ فاکتور حرارتی» می‌توانید مستقیم از طریق مرورگر یا چاپگر بلوتوثی پرینت بگیرید.
                </p>
            </div>

            <div class="support-cta-box">
                <strong style="font-size: 13px; color: #166534;">نیاز به پشتیبانی تلفنی دارید؟</strong>
                <span style="font-size: 11.5px; color: #15803d;">تیم پشتیبانی فنی ویزیتیک پاسخگوی سوالات شماست.</span>
                <a href="tel:09120000000" style="background:#16a34a; color:#fff; text-decoration:none; padding:8px 18px; border-radius:10px; font-size:12px; font-weight:800;">
                    تماس با پشتیبانی فنی
                </a>
                <a href="https://ble.ir/Vizitik_bot" target="_blank" style="display:inline-flex; align-items:center; gap:6px; background:var(--primary); color:#fff; text-decoration:none; padding:8px 18px; border-radius:10px; font-size:12px; font-weight:800;">
                    <span class="material-symbols-outlined" style="font-size:18px;">smart_toy</span>
                    <span>استارت ربات بله (@Vizitik_bot)</span>
                </a>
            </div>
        </main>

        <nav class="app-nav">
            <a href="dashboard.php" class="nav-item">
                <span class="material-symbols-outlined">dashboard</span>
                <span>داشبورد</span>
            </a>
            <a href="van-loading.php" class="nav-item">
                <span class="material-symbols-outlined">local_shipping</span>
                <span>بارگیری خودرو</span>
            </a>
            <a href="customers.php" class="nav-item">
                <span class="material-symbols-outlined">group</span>
                <span>مشتریان</span>
            </a>
            <a href="collections.php" class="nav-item">
                <span class="material-symbols-outlined">payments</span>
                <span>وصول مطالبات</span>
            </a>
        </nav>

    </div>
</body>

</html>
