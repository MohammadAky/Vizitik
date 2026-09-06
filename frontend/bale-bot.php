<?php
require_once 'auth_helper.php';
requireLogin();

header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");

$user = getUserData();
$apiToken = getAccessToken();

$defaultChatId = $user['baleChatId'] ?? '542633638';
$botUsername = 'HesabchinBot';
?>
<!DOCTYPE html>
<html dir="rtl" lang="fa">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>حسابچین — مدیریت ربات بله</title>

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">
    <link rel="stylesheet" href="./css/settings.css?v=<?php echo time(); ?>">
</head>

<body>
    <div class="app" id="app">

        <!-- هدر صفحه -->
        <header class="settings-header">
            <div class="header-title-box">
                <h1>مدیریت ربات بله</h1>
                <span class="header-sub">تنظیمات اعلان‌ها و شناسه پیام‌رسان بله</span>
            </div>

            <a href="dashboard.php" class="back-btn" aria-label="بازگشت به داشبورد">
                <span class="material-symbols-outlined">arrow_forward</span>
            </a>
        </header>

        <!-- محتوای اصلی -->
        <main class="settings-content">

            <!-- کارت وضعیت اتصال به بله -->
            <section class="settings-card" style="border-right: 4px solid #16a34a;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 44px; height: 44px; border-radius: 12px; background: #dcfce7; color: #15803d; display: flex; align-items: center; justify-content: center;">
                        <span class="material-symbols-outlined icon-fill" style="font-size: 26px;">smart_toy</span>
                    </div>
                    <div>
                        <strong style="font-size: 14px; color: var(--text-primary);">ربات پیام‌رسان بله فعال است</strong>
                        <div style="font-size: 11px; color: #16a34a; font-weight: 700;">وضعیت: متصل به سرور بله (آنلاین)</div>
                    </div>
                </div>

                <div style="background: var(--app-background); padding: 10px; border-radius: 10px; font-size: 11.5px; color: var(--text-secondary); line-height: 1.6; margin-top: 8px;">
                    از طریق ربات بله، تمامی فاکتورهای صادره، کدهای اعتبارسنجی ورود و گزارش‌های وصولی به صورت لحظه‌ای به حساب شما ارسال می‌گردد.
                </div>

                <a href="https://ble.ir/HesabchinBot" target="_blank" class="login-btn" style="height: 40px; font-size: 12.5px; background: #16a34a; text-decoration: none; margin-top: 6px;">
                    <span class="material-symbols-outlined">open_in_new</span>
                    <span>ورود و استارت ربات در بله (@HesabchinBot)</span>
                </a>
            </section>

            <!-- فرم تنظیم شناسه چت و تست ارسال پیام -->
            <section class="settings-card">
                <h3 style="font-size: 13.5px; font-weight: 800; margin-bottom: 8px;">تنظیم شناسه کاربری بله (Chat ID)</h3>

                <div class="input-group">
                    <label for="baleChatIdInput">شناسه چت بله ویزیتور (Chat ID):</label>
                    <input type="text" id="baleChatIdInput" value="<?php echo htmlspecialchars($defaultChatId); ?>" placeholder="مثلاً: 542633638">
                    <span style="font-size: 10.5px; color: var(--text-muted); display: block; margin-top: 4px;">
                        برای دریافت شناسه خود، وارد ربات @HesabchinBot شوید و دستور /start یا /id را ارسال کنید.
                    </span>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">
                    <button type="button" class="login-btn" id="sendTestMsgBtn" onclick="sendTestBaleNotification()">
                        <span class="material-symbols-outlined">send</span>
                        <span>ارسال پیام تستی به بله</span>
                    </button>
                    <button type="button" class="login-btn" style="background: var(--surface-variant); color: var(--text-primary); border: 1px solid var(--border);" onclick="saveChatId()">
                        <span class="material-symbols-outlined">save</span>
                        <span>ذخیره شناسه در حساب</span>
                    </button>
                </div>
            </section>

            <!-- قابلیت‌های خودکار ربات -->
            <section class="settings-card">
                <h3 style="font-size: 13.5px; font-weight: 800; margin-bottom: 8px;">اعلان‌های خودکار فعال:</h3>

                <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11.5px;">
                    <div style="display: flex; align-items: center; gap: 8px; color: var(--text-primary);">
                        <span class="material-symbols-outlined" style="color: #16a34a; font-size: 18px;">check_circle</span>
                        <span>ارسال آنی خلاصه فاکتورهای فروش و مبالغ تسویه</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; color: var(--text-primary);">
                        <span class="material-symbols-outlined" style="color: #16a34a; font-size: 18px;">check_circle</span>
                        <span>ارسال کد تایید ثبت‌نام و بازیابی رمز عبور (OTP)</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; color: var(--text-primary);">
                        <span class="material-symbols-outlined" style="color: #16a34a; font-size: 18px;">check_circle</span>
                        <span>گزارشات روزانه فروش و تراز مالی خودرو</span>
                    </div>
                </div>
            </section>

        </main>

        <!-- نوار ناوبری پایینی -->
        <nav class="app-nav">
            <a href="dashboard.php" class="nav-item">
                <span class="material-symbols-outlined">dashboard</span>
                <span>داشبورد</span>
            </a>
            <a href="orders.php" class="nav-item">
                <span class="material-symbols-outlined">receipt_long</span>
                <span>سفارشات</span>
            </a>
            <a href="customers.php" class="nav-item nav-item-center" title="پرونده مشتریان و ثبت سفارش" aria-label="مشتریان">
                <span class="material-symbols-outlined icon-fill">group</span>
                <span>مشتریان</span>
            </a>
            <a href="van-loading.php" class="nav-item">
                <span class="material-symbols-outlined">local_shipping</span>
                <span>بارگیری خودرو</span>
            </a>
            <a href="collections.php" class="nav-item">
                <span class="material-symbols-outlined">payments</span>
                <span>وصول مطالبات</span>
            </a>
        </nav>

    </div>

    <script>
        const API_TOKEN = '<?php echo $apiToken; ?>';

        async function sendTestBaleNotification() {
            const chatId = document.getElementById('baleChatIdInput').value.trim();
            if (!chatId) {
                alert('لطفاً شناسه چت بله را وارد کنید.');
                return;
            }

            const btn = document.getElementById('sendTestMsgBtn');
            btn.disabled = true;
            btn.innerHTML = 'در حال ارسال پیام...';

            try {
                const token = '2089208057:mqfJ2g1Vbxn-gdtP7e3Lm6T24ou6WK0CuFc';
                const message = `🔔 *پیام آزمایشی از حساب‌چین*\n\nارتباط سامانه توزیع مویرگی با ربات بله با موفقیت برقرار است.\nزمان: ${new Date().toLocaleTimeString('fa-IR')}`;

                const res = await fetch(`https://tapi.bale.ai/bot${token}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: message,
                        parse_mode: 'Markdown'
                    })
                });

                const data = await res.json().catch(() => ({}));
                if (res.ok && data.ok) {
                    alert('پیام آزمایشی با موفقیت به بله شما ارسال شد! ✅');
                } else {
                    alert('ارسال ناموفق بود. لطفاً ابتدا در ربات @HesabchinBot دکمه Start را بزنید.');
                }
            } catch (e) {
                alert('خطا در ارسال پیام به بله.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span class="material-symbols-outlined">send</span><span>ارسال پیام تستی به بله</span>';
            }
        }

        async function saveChatId() {
            const chatId = document.getElementById('baleChatIdInput').value.trim();
            if (!chatId) {
                alert('لطفاً شناسه چت بله را وارد نمایید.');
                return;
            }

            try {
                const res = await fetch('http://localhost:3000/api/auth/profile', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${API_TOKEN}`
                    },
                    body: JSON.stringify({ baleChatId: chatId })
                });

                const data = await res.json().catch(() => ({}));
                if (res.ok) {
                    alert('شناسه بله با موفقیت در پایگاه‌داده ذخیره شد و تمامی اعلان‌ها به این حساب ارسال خواهند شد. ✅');
                } else {
                    alert(data.message || 'خطا در ذخیره شناسه در سرور.');
                }
            } catch (e) {
                alert('خطا در برقراری ارتباط با سرور.');
            }
        }
    </script>
</body>

</html>
