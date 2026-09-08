<?php
require_once 'auth_helper.php';

// ۱. بررسی لاگین بودن کاربر
requireLogin();

// ۲. جلوگیری از کش شدن صفحه
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");

// ۳. اطلاعات کاربر از سشن
$user = getUserData();
$firstName = htmlspecialchars($user["firstName"] ?? "علی");
$lastName = htmlspecialchars($user["lastName"] ?? "حسینی");
$userPhone = htmlspecialchars($user["phone"] ?? "09121234567");
$userRole = ($user["role"] ?? 'VISITOR') === 'ADMIN' ? 'مدیر ارشد سیستم' : 'مسئول توزیع و ویزیتور';
$initials = mb_substr($firstName, 0, 1, 'UTF-8');
?>
<!DOCTYPE html>
<html dir="rtl" lang="fa">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>ویزیتیک — تنظیمات و پروفایل</title>

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">
    <link rel="stylesheet" href="./css/settings.css?v=<?php echo time(); ?>">
</head>

<body>
    <div class="app" id="app">

        <!-- توست پیام‌های سیستم -->
        <div id="settingsToast" class="settings-toast">
            <span class="material-symbols-outlined" id="toastIcon">check_circle</span>
            <span id="toastText">عملیات با موفقیت انجام شد</span>
        </div>

        <!-- هدر صفحه تنظیمات -->
        <header class="settings-header">
            <div class="header-top-row">
                <div class="header-title-box">
                    <h1>تنظیمات و پروفایل</h1>
                    <span class="header-sub">امنیت، اتصال بله و تنظیمات چاپ</span>
                </div>

                <a href="dashboard.php" class="back-btn" aria-label="بازگشت به داشبورد">
                    <span class="material-symbols-outlined">arrow_forward</span>
                </a>
            </div>
        </header>

        <!-- ناحیه اسکرول محتوای تنظیمات -->
        <main class="settings-content">

            <!-- کارت پروفایل کاربر -->
            <section class="profile-card">
                <div class="profile-avatar-wrap">
                    <div class="profile-avatar">
                        <?php echo $initials; ?>
                    </div>
                    <span class="online-dot" title="آنلاین"></span>
                </div>

                <div class="profile-meta">
                    <h2 class="profile-name"><?php echo $firstName . ' ' . $lastName; ?></h2>
                    <div class="profile-phone-row">
                        <span class="material-symbols-outlined">smartphone</span>
                        <span><?php echo toPersianNum($userPhone); ?></span>
                    </div>
                    <div class="profile-badge-row">
                        <span class="profile-badge"><?php echo $userRole; ?></span>
                        <span class="profile-status-badge">فعال</span>
                    </div>
                </div>
            </section>

            <!-- بخش ۱: تغییر رمز عبور -->
            <section class="settings-section-card">
                <div class="section-card-header">
                    <div class="header-icon security">
                        <span class="material-symbols-outlined">lock_reset</span>
                    </div>
                    <div class="header-titles">
                        <h2>امنیت و تغییر رمز عبور</h2>
                        <span>به‌روزرسانی رمز عبور جهت ورود با گذرواژه</span>
                    </div>
                </div>

                <form class="settings-form" onsubmit="handleChangePassword(event)">
                    <div class="field-group">
                        <label class="field-label" for="currentPassword">
                            <span>رمز عبور فعلی</span>
                            <span class="hint-opt">(اختیاری)</span>
                        </label>
                        <div class="password-input-wrap">
                            <input type="password" id="currentPassword" placeholder="رمز عبور فعلی خود را وارد کنید">
                            <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('currentPassword', this)" aria-label="نمایش رمز">
                                <span class="material-symbols-outlined">visibility</span>
                            </button>
                        </div>
                    </div>

                    <div class="field-group">
                        <label class="field-label" for="newPassword">
                            <span>رمز عبور جدید <span class="required-star">*</span></span>
                            <span class="hint-opt">حداقل ۶ کاراکتر</span>
                        </label>
                        <div class="password-input-wrap">
                            <input type="password" id="newPassword" placeholder="رمز عبور جدید" required minlength="6" oninput="checkPasswordMatch()">
                            <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('newPassword', this)" aria-label="نمایش رمز">
                                <span class="material-symbols-outlined">visibility</span>
                            </button>
                        </div>
                    </div>

                    <div class="field-group">
                        <label class="field-label" for="confirmPassword">
                            <span>تکرار رمز عبور جدید <span class="required-star">*</span></span>
                        </label>
                        <div class="password-input-wrap">
                            <input type="password" id="confirmPassword" placeholder="تکرار رمز عبور جدید" required minlength="6" oninput="checkPasswordMatch()">
                            <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('confirmPassword', this)" aria-label="نمایش رمز">
                                <span class="material-symbols-outlined">visibility</span>
                            </button>
                        </div>
                        <span class="password-match-hint" id="matchHint">رمز عبور جدید با تکرار آن یکسان نیست</span>
                    </div>

                    <button type="submit" class="save-password-btn" id="changePasswordBtn">
                        <span class="material-symbols-outlined">check_circle</span>
                        <span>ذخیره رمز عبور جدید</span>
                    </button>
                </form>
            </section>

            <!-- بخش ۲: اتصال به ربات پیام‌رسان بله -->
            <section class="settings-section-card">
                <div class="section-card-header">
                    <div class="header-icon bot">
                        <span class="material-symbols-outlined">smart_toy</span>
                    </div>
                    <div class="header-titles">
                        <h2>پیام‌رسان بله (ورود با کد OTP)</h2>
                        <span>کدهای تایید سریع ۲ مرحله‌ای</span>
                    </div>
                </div>

                <div class="bale-info-box">
                    <div class="bale-status-row">
                        <span class="material-symbols-outlined">verified</span>
                        <span>سامانه پیام‌رسان بله آماده ارسال کد تایید است</span>
                    </div>
                    <p class="bale-info-text">
                        کدهای یکبار مصرف ورود، تاییدیه صدور فاکتور و هشدارهای سررسید چک‌های ویزیتوری به ربات بله ارسال می‌گردد.
                    </p>
                </div>

                <a href="https://ble.ir/HesabchinBot" target="_blank" class="bale-action-btn">
                    <span class="material-symbols-outlined">open_in_new</span>
                    <span>ورود و استارت ربات بله (@HesabchinBot)</span>
                </a>
            </section>

            <!-- بخش ۳: تنظیمات فاکتور و چاپ -->
            <section class="settings-section-card">
                <div class="section-card-header">
                    <div class="header-icon print">
                        <span class="material-symbols-outlined">receipt_long</span>
                    </div>
                    <div class="header-titles">
                        <h2>تنظیمات فاکتور و چاپگر</h2>
                        <span>شخصی‌سازی خروجی فاکتور مشتریان</span>
                    </div>
                </div>

                <div class="setting-toggle-row">
                    <div class="toggle-info">
                        <strong>تفکیک تخفیف‌های پلکانی در چاپ</strong>
                        <span>درصد و مبالغ تخفیف خرید در فاکتور درج گردد</span>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="prefDiscountBreakdown" checked onchange="saveInvoicePreferences()">
                        <span class="slider"></span>
                    </label>
                </div>

                <div class="setting-toggle-row">
                    <div class="toggle-info">
                        <strong>نمایش مانده بدهی قبلی مشتری</strong>
                        <span>مانده حساب باز و بدهی در پایین فاکتور چاپ شود</span>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="prefPrevDebt" checked onchange="saveInvoicePreferences()">
                        <span class="slider"></span>
                    </label>
                </div>

                <div class="setting-toggle-row">
                    <div class="toggle-info">
                        <strong>هشدار کسری موجودی ون</strong>
                        <span>هنگام صدور فاکتور بیش از موجودی بار اخطار دهد</span>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="prefVanStockAlert" checked onchange="saveInvoicePreferences()">
                        <span class="slider"></span>
                    </label>
                </div>
            </section>

            <!-- بخش ۴: اطلاعات نرم‌افزار -->
            <section class="settings-section-card">
                <div class="section-card-header">
                    <div class="header-icon info">
                        <span class="material-symbols-outlined">info</span>
                    </div>
                    <div class="header-titles">
                        <h2>اطلاعات سامانه</h2>
                        <span>نسخه و وضعیت اتصال</span>
                    </div>
                </div>

                <div class="app-meta-row">
                    <span>نسخه نرم‌افزار:</span>
                    <span class="app-meta-val">۱.۲.۰ (ویژه ویزیتوری پخش گرم)</span>
                </div>
                <div class="app-meta-row">
                    <span>وضعیت اتصال پایگاه داده:</span>
                    <span class="app-meta-val" style="color: #16a34a;">متصل و همگام</span>
                </div>
            </section>

            <!-- بخش ۵: خروج از حساب -->
            <div class="logout-btn-box">
                <a href="logout.php" class="logout-full-btn" onclick="return confirm('آیا برای خروج از حساب کاربری اطمینان دارید؟')">
                    <span class="material-symbols-outlined">logout</span>
                    <span>خروج از حساب کاربری</span>
                </a>
            </div>

        </main>

        <!-- نوار ناوبری پایینی -->
        <nav class="app-nav">
            <a href="dashboard.php" class="nav-item">
                <span class="material-symbols-outlined">dashboard</span>
                <span>داشبورد</span>
            </a>
            <a href="van-loading.php" class="nav-item">
                <span class="material-symbols-outlined">local_shipping</span>
                <span>بارگیری ون</span>
            </a>
            <a href="customers.php" class="nav-item">
                <span class="material-symbols-outlined">group</span>
                <span>مشتریان</span>
            </a>
            <a href="collections.php" class="nav-item">
                <span class="material-symbols-outlined">payments</span>
                <span>مطالبات</span>
            </a>
        </nav>

    </div>

    <script>
        const API_TOKEN = '<?php echo getAccessToken(); ?>';

        // نمایش توست شناور
        function showToast(message, type = 'success') {
            const toast = document.getElementById('settingsToast');
            const icon = document.getElementById('toastIcon');
            const text = document.getElementById('toastText');

            toast.className = `settings-toast ${type} show`;
            icon.textContent = type === 'success' ? 'check_circle' : 'error';
            text.textContent = message;

            setTimeout(() => {
                toast.classList.remove('show');
            }, 3500);
        }

        // سوئیچ نمایش/مخفی‌سازی کلمه عبور
        function togglePasswordVisibility(inputId, btn) {
            const input = document.getElementById(inputId);
            const icon = btn.querySelector('.material-symbols-outlined');

            if (input.type === 'password') {
                input.type = 'text';
                icon.textContent = 'visibility_off';
            } else {
                input.type = 'password';
                icon.textContent = 'visibility';
            }
        }

        // بررسی برابری رمز عبور جدید و تکرار آن
        function checkPasswordMatch() {
            const newPass = document.getElementById('newPassword').value;
            const confirmPass = document.getElementById('confirmPassword').value;
            const hint = document.getElementById('matchHint');

            if (confirmPass.length > 0 && newPass !== confirmPass) {
                hint.style.display = 'block';
            } else {
                hint.style.display = 'none';
            }
        }

        // ذخیره تغییر رمز عبور
        async function handleChangePassword(e) {
            e.preventDefault();

            const currentPassword = document.getElementById('currentPassword').value;
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const btn = document.getElementById('changePasswordBtn');

            if (newPassword.length < 6) {
                showToast('رمز عبور باید حداقل ۶ کاراکتر باشد.', 'error');
                return;
            }

            if (newPassword !== confirmPassword) {
                showToast('رمز عبور جدید با تکرار آن مطابقت ندارد.', 'error');
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span><span>در حال ذخیره...</span>';

            try {
                const res = await fetch('http://localhost:3000/api/auth/change-password', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${API_TOKEN}`
                    },
                    body: JSON.stringify({
                        currentPassword: currentPassword || undefined,
                        newPassword
                    })
                });

                const data = await res.json().catch(() => ({}));

                if (res.ok) {
                    showToast(data.message || 'رمز عبور با موفقیت به‌روزرسانی شد.', 'success');
                    document.getElementById('currentPassword').value = '';
                    document.getElementById('newPassword').value = '';
                    document.getElementById('confirmPassword').value = '';
                    document.getElementById('matchHint').style.display = 'none';
                } else {
                    showToast(data.message || 'خطا در به‌روزرسانی رمز عبور.', 'error');
                }
            } catch (err) {
                showToast('خطا در ارتباط با سرور. لطفاً از روشن بودن بک‌اند اطمینان حاصل کنید.', 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span class="material-symbols-outlined">check_circle</span><span>ذخیره رمز عبور جدید</span>';
            }
        }

        // ذخیره تنظیمات چاپ در localStorage
        function saveInvoicePreferences() {
            const prefs = {
                discountBreakdown: document.getElementById('prefDiscountBreakdown').checked,
                prevDebt: document.getElementById('prefPrevDebt').checked,
                vanStockAlert: document.getElementById('prefVanStockAlert').checked,
            };
            localStorage.setItem('hesabchin_invoice_prefs', JSON.stringify(prefs));
            showToast('تنظیمات چاپ و فاکتور با موفقیت ذخیره شد.', 'success');
        }

        // بازیابی تنظیمات هنگام لود صفحه
        document.addEventListener('DOMContentLoaded', () => {
            const saved = localStorage.getItem('hesabchin_invoice_prefs');
            if (saved) {
                try {
                    const prefs = JSON.parse(saved);
                    if (typeof prefs.discountBreakdown === 'boolean') {
                        document.getElementById('prefDiscountBreakdown').checked = prefs.discountBreakdown;
                    }
                    if (typeof prefs.prevDebt === 'boolean') {
                        document.getElementById('prefPrevDebt').checked = prefs.prevDebt;
                    }
                    if (typeof prefs.vanStockAlert === 'boolean') {
                        document.getElementById('prefVanStockAlert').checked = prefs.vanStockAlert;
                    }
                } catch (e) {}
            }
        });
    </script>
</body>

</html>
