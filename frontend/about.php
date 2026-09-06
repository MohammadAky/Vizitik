<?php
require_once 'auth_helper.php';
requireLogin();
?>
<!DOCTYPE html>
<html dir="rtl" lang="fa">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>حسابچین — درباره نرم‌افزار</title>

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">

    <style>
        .about-content {
            flex: 1;
            overflow-y: auto;
            padding: 20px 16px 85px 16px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
            text-align: center;
        }
        .about-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 18px;
            padding: 20px 16px;
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.03);
        }
        .feature-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            width: 100%;
            margin-top: 6px;
        }
        .feature-box {
            background: var(--app-background);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 10px 8px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            font-weight: 700;
            color: var(--text-primary);
        }
        .feature-box .material-symbols-outlined {
            color: var(--primary);
            font-size: 22px;
        }
    </style>
</head>

<body>
    <div class="app" id="app">

        <header class="header" style="background: #001d31; color: #ffffff; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding: 12px 16px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <h1 style="font-size: 16px; font-weight:800; margin:0; color:#ffffff;">درباره حساب‌چین</h1>
                <span style="font-size: 11px; color:rgba(255, 255, 255, 0.75);">سامانه جامع پخش گرم و ویزیتوری بستنی</span>
            </div>
            <a href="dashboard.php" class="back-btn" style="width:38px; height:38px; border-radius:12px; border:1px solid rgba(255, 255, 255, 0.2); background:rgba(255, 255, 255, 0.12); display:flex; align-items:center; justify-content:center; text-decoration:none; color:#ffffff;">
                <span class="material-symbols-outlined" style="transform: scaleX(-1);">arrow_forward</span>
            </a>
        </header>

        <main class="about-content">
            <div class="logo logo-lg" style="margin-top: 10px;">
                <span class="material-symbols-outlined">icecream</span>
            </div>
            <h2 style="font-size: 18px; font-weight: 900; margin: 0; color: var(--primary);">حساب‌چین (نسخه ۱.۲.۰)</h2>
            <p style="font-size: 12px; color: var(--text-secondary); line-height: 1.7; max-width: 320px;">
                سامانه هوشمند و یکپارچه ویژه رانندگان، ویزیتورها و شرکت‌های توزیع و پخش مویرگی بستنی و مواد غذایی سردخانه‌ای.
            </p>

            <div class="about-card">
                <strong style="font-size: 13px; color: var(--text-primary);">امکانات کلیدی سامانه:</strong>
                <div class="feature-grid">
                    <div class="feature-box">
                        <span class="material-symbols-outlined">local_shipping</span>
                        <span>مدیریت بارگیری ون</span>
                    </div>
                    <div class="feature-box">
                        <span class="material-symbols-outlined">percent</span>
                        <span>تخفیف درصدی و مبلغی</span>
                    </div>
                    <div class="feature-box">
                        <span class="material-symbols-outlined">smart_toy</span>
                        <span>اتصال به ربات بله</span>
                    </div>
                    <div class="feature-box">
                        <span class="material-symbols-outlined">print</span>
                        <span>چاپ فاکتور حرارتی</span>
                    </div>
                    <div class="feature-box">
                        <span class="material-symbols-outlined">fact_check</span>
                        <span>مدیریت چک‌های صیادی</span>
                    </div>
                    <div class="feature-box">
                        <span class="material-symbols-outlined">offline_bolt</span>
                        <span>قابلیت کاربری آفلاین</span>
                    </div>
                </div>
            </div>

            <div style="font-size: 11px; color: var(--text-muted); margin-top: auto;">
                طراحی و توسعه یافته با استانداردهای پخش مویرگی ایران © ۲۰۲۶
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
