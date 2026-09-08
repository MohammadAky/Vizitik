<?php
require_once 'auth_helper.php';

// اگر کاربر قبلاً لاگین کرده، به داشبورد هدایت شود
if (isLoggedIn()) {
    header("Location: dashboard.php");
    exit();
}

header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>حسابچین — ورود به حساب کاربری</title>

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">

    <style>
        .auth-view {
            display: none;
            flex-direction: column;
            gap: 14px;
            animation: fadeIn 0.25s ease;
        }
        .auth-view.active {
            display: flex;
        }
        .password-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }
        .password-wrap input {
            width: 100%;
            padding-left: 42px; /* فضای دکمه چشم در چپ */
        }
        .eye-toggle-btn {
            position: absolute;
            left: 10px;
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 4px;
        }
        .eye-toggle-btn .material-symbols-outlined {
            font-size: 20px;
        }
        .auth-links-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 11.5px;
            margin-top: 2px;
        }
        .auth-links-row a, .auth-links-row button {
            color: var(--primary);
            font-weight: 700;
            text-decoration: none;
            background: none;
            border: none;
            cursor: pointer;
            font-family: inherit;
            padding: 0;
        }
        .switch-auth-box {
            text-align: center;
            font-size: 11.5px;
            color: var(--text-muted);
            margin-top: 10px;
            border-top: 1px solid var(--surface-variant);
            padding-top: 12px;
        }
        .switch-auth-box a {
            color: var(--primary);
            font-weight: 800;
            text-decoration: none;
        }
        .bale-banner {
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
            border-radius: 12px;
            padding: 8px 12px;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 11px;
            color: #166534;
        }
        .bale-banner a {
            color: #15803d;
            font-weight: 800;
            text-decoration: underline;
        }
        .otp-inputs {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            direction: ltr;
            margin: 6px 0;
        }
        .otp-box {
            width: 52px;
            height: 52px;
            border-radius: 12px;
            border: 2px solid var(--border);
            background: var(--surface);
            text-align: center;
            font-size: 22px;
            font-weight: 800;
            color: var(--primary);
            outline: none;
        }
        .otp-box:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(0, 97, 148, 0.15);
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>

<body>
    <div class="app" id="app">

        <!-- اسپلش اولیه کوتاه -->
        <section class="intro" id="intro">
            <div class="logo logo-lg">
                <span class="material-symbols-outlined">icecream</span>
            </div>
            <h1>حسابچین</h1>
            <p>سامانه جامع ویزیتوری و پخش گرم</p>
        </section>

        <!-- بخش ورود و احراز هویت -->
        <section class="login-page" id="loginPage">
            <div class="login-container">

                <div class="login-header">
                    <div class="logo logo-md">
                        <span class="material-symbols-outlined">icecream</span>
                    </div>
                    <h2 id="viewTitle">ورود به حساب کاربری</h2>
                    <p id="viewSubtitle">شماره موبایل و رمز عبور خود را وارد کنید</p>
                </div>

                <!-- پیام خطا -->
                <div id="authErrorMsg" class="popup error-message" style="display: none; position: relative; margin-bottom: 12px; width: 100%; box-sizing: border-box;"></div>

                <!-- ۱. فرم ورود مستقیم (بدون OTP) -->
                <form class="auth-view active" id="viewLogin" onsubmit="handleDirectLogin(event)">
                    <div class="input-group">
                        <label for="loginPhone">شماره موبایل ویزیتور</label>
                        <input type="tel" id="loginPhone" placeholder="09121234567" maxlength="11" value="09121234567" required autocomplete="tel">
                    </div>

                    <div class="input-group">
                        <label for="loginPassword">رمز عبور</label>
                        <div class="password-wrap">
                            <input type="password" id="loginPassword" placeholder="رمز عبور" required autocomplete="current-password">
                            <button type="button" class="eye-toggle-btn" onclick="togglePassword('loginPassword', this)">
                                <span class="material-symbols-outlined">visibility</span>
                            </button>
                        </div>
                    </div>

                    <div class="auth-links-row">
                        <button type="button" onclick="switchView('forgotPhone')">فراموشی رمز عبور؟</button>
                    </div>

                    <button type="submit" class="login-btn" id="loginBtn">
                        <span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">login</span>
                        <span>ورود به حساب</span>
                    </button>

                    <div class="switch-auth-box">
                        حساب کاربری ندارید؟ <a href="#" onclick="switchView('registerForm'); return false;">ثبت‌نام ویزیتور جدید</a>
                    </div>
                </form>

                <!-- ۲. فرم ثبت‌نام کاربر جدید (مرحله ۱: دریافت اطلاعات) -->
                <form class="auth-view" id="viewRegisterForm" onsubmit="handleSendRegisterOtp(event)">
                    <div class="input-row" style="display: flex; gap: 8px;">
                        <div class="input-group" style="flex: 1;">
                            <label for="regFirstName">نام</label>
                            <input type="text" id="regFirstName" placeholder="مثلاً: علی" required>
                        </div>
                        <div class="input-group" style="flex: 1;">
                            <label for="regLastName">نام خانوادگی</label>
                            <input type="text" id="regLastName" placeholder="مثلاً: حسینی" required>
                        </div>
                    </div>

                    <div class="input-group">
                        <label for="regPhone">شماره موبایل</label>
                        <input type="tel" id="regPhone" placeholder="09xxxxxxxxx" maxlength="11" required>
                    </div>

                    <div class="input-group">
                        <label for="regPassword">رمز عبور دلخواه (حداقل ۶ کاراکتر)</label>
                        <div class="password-wrap">
                            <input type="password" id="regPassword" placeholder="حداقل ۶ کاراکتر" minlength="6" required>
                            <button type="button" class="eye-toggle-btn" onclick="togglePassword('regPassword', this)">
                                <span class="material-symbols-outlined">visibility</span>
                            </button>
                        </div>
                    </div>

                    <button type="submit" class="login-btn" id="sendRegOtpBtn">
                        <span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">send</span>
                        <span>ارسال کد تایید به بله</span>
                    </button>

                    <div class="bale-banner">
                        <span class="material-symbols-outlined" style="font-size: 18px;">smart_toy</span>
                        <span>کد به ربات بله ارسال می‌شود: <a href="https://ble.ir/HesabchinBot" target="_blank">استارت ربات</a></span>
                    </div>

                    <div class="switch-auth-box">
                        قبلاً ثبت‌نام کرده‌اید؟ <a href="#" onclick="switchView('login'); return false;">ورود به حساب</a>
                    </div>
                </form>

                <!-- ۲.۱. فرم ثبت‌نام کاربر جدید (مرحله ۲: تایید کد ۵ رقمی) -->
                <form class="auth-view" id="viewRegisterOtp" autocomplete="off" onsubmit="handleCompleteRegistration(event)">
                    <label style="font-size: 11.5px; font-weight: 700;">کد ۵ رقمی ارسال شده به پیام‌رسان بله:</label>
                    <div class="otp-inputs">
                        <input type="text" class="otp-box reg-otp" maxlength="1" inputmode="numeric" autocomplete="one-time-code" required>
                        <input type="text" class="otp-box reg-otp" maxlength="1" inputmode="numeric" autocomplete="one-time-code" required>
                        <input type="text" class="otp-box reg-otp" maxlength="1" inputmode="numeric" autocomplete="one-time-code" required>
                        <input type="text" class="otp-box reg-otp" maxlength="1" inputmode="numeric" autocomplete="one-time-code" required>
                        <input type="text" class="otp-box reg-otp" maxlength="1" inputmode="numeric" autocomplete="one-time-code" required>
                    </div>

                    <button type="submit" class="login-btn" id="verifyRegBtn">
                        <span>تکمیل ثبت‌نام و ورود</span>
                    </button>

                    <div class="switch-auth-box">
                        <a href="#" onclick="switchView('registerForm'); return false;">ویرایش مشخصات یا شماره</a>
                    </div>
                </form>

                <!-- ۳. فراموشی رمز عبور (مرحله ۱: دریافت شماره) -->
                <form class="auth-view" id="viewForgotPhone" autocomplete="off" onsubmit="handleSendForgotOtp(event)">
                    <div class="input-group">
                        <label for="forgotPhone">شماره موبایل ثبت‌شده در سیستم</label>
                        <input type="tel" id="forgotPhone" placeholder="09xxxxxxxxx" maxlength="11" autocomplete="tel" required>
                    </div>

                    <button type="submit" class="login-btn" id="sendForgotOtpBtn">
                        <span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">send</span>
                        <span>ارسال کد بازیابی به بله</span>
                    </button>

                    <div class="switch-auth-box">
                        رمز را به یاد آوردید؟ <a href="#" onclick="switchView('login'); return false;">ورود به حساب</a>
                    </div>
                </form>

                <!-- ۳.۱. فراموشی رمز عبور (مرحله ۲: تایید کد و تعیین رمز جدید) -->
                <form class="auth-view" id="viewForgotOtp" autocomplete="off" onsubmit="handleResetPassword(event)">
                    <label style="font-size: 11.5px; font-weight: 700;">کد ۵ رقمی ارسال شده به بله:</label>
                    <div class="otp-inputs">
                        <input type="text" class="otp-box reset-otp" maxlength="1" inputmode="numeric" autocomplete="one-time-code" required>
                        <input type="text" class="otp-box reset-otp" maxlength="1" inputmode="numeric" autocomplete="one-time-code" required>
                        <input type="text" class="otp-box reset-otp" maxlength="1" inputmode="numeric" autocomplete="one-time-code" required>
                        <input type="text" class="otp-box reset-otp" maxlength="1" inputmode="numeric" autocomplete="one-time-code" required>
                        <input type="text" class="otp-box reset-otp" maxlength="1" inputmode="numeric" autocomplete="one-time-code" required>
                    </div>

                    <div class="input-group">
                        <label for="newResetPassword">رمز عبور جدید</label>
                        <div class="password-wrap">
                            <input type="password" id="newResetPassword" placeholder="حداقل ۶ کاراکتر" minlength="6" autocomplete="new-password" required>
                            <button type="button" class="eye-toggle-btn" onclick="togglePassword('newResetPassword', this)">
                                <span class="material-symbols-outlined">visibility</span>
                            </button>
                        </div>
                    </div>

                    <button type="submit" class="login-btn" id="resetPassBtn">
                        <span>ذخیره رمز جدید و ورود</span>
                    </button>

                    <div class="switch-auth-box">
                        <a href="#" onclick="switchView('login'); return false;">انصراف و بازگشت</a>
                    </div>
                </form>

            </div>
        </section>

        <!-- انیمیشن ترنزیشن ورود -->
        <div class="page-curtain" id="pageCurtain">
            <div class="curtain-content">
                <div class="logo logo-lg">
                    <span class="material-symbols-outlined">icecream</span>
                </div>
                <h1>حسابچین</h1>
                <p>در حال ورود به داشبورد ویزیتور...</p>
            </div>
        </div>
    </div>

    <script>
        // ترنزیشن اسپلش
        setTimeout(() => {
            const intro = document.getElementById("intro");
            const loginPage = document.getElementById("loginPage");
            if (intro) intro.classList.add("hide");
            if (loginPage) loginPage.classList.add("show");
        }, 1200);

        // مدیریت تغییر فرم‌ها
        function switchView(viewName) {
            document.querySelectorAll('.auth-view').forEach(v => v.classList.remove('active'));
            const errorMsg = document.getElementById('authErrorMsg');
            errorMsg.style.display = 'none';

            const title = document.getElementById('viewTitle');
            const sub = document.getElementById('viewSubtitle');

            if (viewName === 'login') {
                document.getElementById('viewLogin').classList.add('active');
                title.textContent = 'ورود به حساب کاربری';
                sub.textContent = 'شماره موبایل و رمز عبور خود را وارد کنید';
            } else if (viewName === 'registerForm') {
                document.getElementById('viewRegisterForm').classList.add('active');
                title.textContent = 'ثبت‌نام ویزیتور جدید';
                sub.textContent = 'مشخصات خود را جهت ایجاد حساب کاربری وارد نمایید';
            } else if (viewName === 'registerOtp') {
                document.getElementById('viewRegisterOtp').classList.add('active');
                document.querySelectorAll('.reg-otp').forEach(i => i.value = '');
                title.textContent = 'تایید شماره در بله';
                sub.textContent = 'کد تایید ۵ رقمی ارسال شده به پیام‌رسان بله را وارد کنید';
            } else if (viewName === 'forgotPhone') {
                document.getElementById('viewForgotPhone').classList.add('active');
                title.textContent = 'فراموشی رمز عبور';
                sub.textContent = 'شماره موبایل ثبت‌شده را وارد کنید تا کد بازیابی ارسال شود';
            } else if (viewName === 'forgotOtp') {
                document.getElementById('viewForgotOtp').classList.add('active');
                document.querySelectorAll('.reset-otp').forEach(i => i.value = '');
                const newPassInput = document.getElementById('newResetPassword');
                if (newPassInput) newPassInput.value = '';
                title.textContent = 'تنظیم رمز عبور جدید';
                sub.textContent = 'کد ارسال شده به بله و رمز عبور جدید خود را وارد کنید';
            }
        }

        // سوئیچ نمایش رمز عبور
        function togglePassword(inputId, btn) {
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

        // مدیریت اینپوت‌های ۵ رقمی و پشتیبانی از Paste
        function setupOtpAutoAdvance(selector) {
            const inputs = document.querySelectorAll(selector);
            inputs.forEach((input, index) => {
                input.addEventListener('input', (e) => {
                    if (e.target.value.length === 1 && index < inputs.length - 1) {
                        inputs[index + 1].focus();
                    }
                });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Backspace' && !e.target.value && index > 0) {
                        inputs[index - 1].focus();
                    }
                });
                input.addEventListener('focus', () => {
                    input.select();
                });
                input.addEventListener('paste', (e) => {
                    e.preventDefault();
                    const pasteData = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
                    if (pasteData) {
                        inputs.forEach((inp, i) => {
                            inp.value = pasteData[i] || '';
                        });
                        const nextIndex = Math.min(pasteData.length, inputs.length - 1);
                        inputs[nextIndex].focus();
                    }
                });
            });
        }
        setupOtpAutoAdvance('.reg-otp');
        setupOtpAutoAdvance('.reset-otp');

        function showError(msg) {
            const errorMsg = document.getElementById('authErrorMsg');
            errorMsg.textContent = msg;
            errorMsg.style.display = 'block';
        }

        async function proceedSuccessfulLogin(accessToken, user) {
            await fetch('set_session.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessToken, user })
            });

            const app = document.getElementById("app");
            const curtain = document.getElementById("pageCurtain");
            if (app) app.classList.add("leaving");
            if (curtain) curtain.classList.add("show");

            setTimeout(() => {
                window.location.replace("dashboard.php");
            }, 1000);
        }

        // ۱. ورود عادی با شماره و پسورد
        async function handleDirectLogin(e) {
            e.preventDefault();
            const phone = document.getElementById('loginPhone').value.trim();
            const password = document.getElementById('loginPassword').value;
            const btn = document.getElementById('loginBtn');

            btn.disabled = true;
            btn.innerHTML = 'در حال بررسی...';
            document.getElementById('authErrorMsg').style.display = 'none';

            try {
                const res = await fetch('http://localhost:3000/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone, password })
                });

                const data = await res.json().catch(() => ({}));

                if (res.ok && data.accessToken) {
                    await proceedSuccessfulLogin(data.accessToken, data.user);
                } else {
                    showError(data.message || 'شماره تلفن یا رمز عبور اشتباه است.');
                    btn.disabled = false;
                    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">login</span><span>ورود به حساب</span>';
                }
            } catch (err) {
                showError('ارتباط با سرور برقرار نشد. لطفاً از روشن بودن بک‌اند اطمینان حاصل کنید.');
                btn.disabled = false;
                btn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">login</span><span>ورود به حساب</span>';
            }
        }

        // ۲. ارسال OTP برای ثبت‌نام
        let regData = {};
        async function handleSendRegisterOtp(e) {
            e.preventDefault();
            regData.firstName = document.getElementById('regFirstName').value.trim();
            regData.lastName = document.getElementById('regLastName').value.trim();
            regData.phone = document.getElementById('regPhone').value.trim();
            regData.password = document.getElementById('regPassword').value;

            const btn = document.getElementById('sendRegOtpBtn');
            btn.disabled = true;
            btn.innerHTML = 'در حال ارسال کد به بله...';
            document.getElementById('authErrorMsg').style.display = 'none';

            try {
                const res = await fetch('http://localhost:3000/api/auth/send-register-otp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: regData.phone })
                });

                const data = await res.json().catch(() => ({}));

                if (res.ok) {
                    switchView('registerOtp');
                    document.querySelector('.reg-otp').focus();
                } else {
                    showError(data.message || 'خطا در ارسال کد ثبت‌نام.');
                }
            } catch (err) {
                showError('ارتباط با سرور برقرار نشد.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">send</span><span>ارسال کد تایید به بله</span>';
            }
        }

        // ۲.۱. تکمیل ثبت‌نام با OTP
        async function handleCompleteRegistration(e) {
            e.preventDefault();
            let code = '';
            document.querySelectorAll('.reg-otp').forEach(i => code += i.value);

            if (code.length < 5) {
                showError('لطفاً کد ۵ رقمی را کامل وارد کنید.');
                return;
            }

            const btn = document.getElementById('verifyRegBtn');
            btn.disabled = true;
            btn.innerHTML = 'در حال تکمیل ثبت‌نام...';
            document.getElementById('authErrorMsg').style.display = 'none';

            try {
                const res = await fetch('http://localhost:3000/api/auth/register-with-otp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        firstName: regData.firstName,
                        lastName: regData.lastName,
                        phone: regData.phone,
                        password: regData.password,
                        code
                    })
                });

                const data = await res.json().catch(() => ({}));

                if (res.ok && data.accessToken) {
                    await proceedSuccessfulLogin(data.accessToken, data.user);
                } else {
                    showError(data.message || 'کد وارد شده نادرست یا منقضی است.');
                    btn.disabled = false;
                    btn.innerHTML = '<span>تکمیل ثبت‌نام و ورود</span>';
                }
            } catch (err) {
                showError('خطا در ارتباط با سرور.');
                btn.disabled = false;
                btn.innerHTML = '<span>تکمیل ثبت‌نام و ورود</span>';
            }
        }

        // ۳. ارسال OTP برای فراموشی رمز
        let resetPhone = '';
        async function handleSendForgotOtp(e) {
            e.preventDefault();
            resetPhone = document.getElementById('forgotPhone').value.trim();
            const btn = document.getElementById('sendForgotOtpBtn');

            btn.disabled = true;
            btn.innerHTML = 'در حال ارسال کد به بله...';
            document.getElementById('authErrorMsg').style.display = 'none';

            try {
                const res = await fetch('http://localhost:3000/api/auth/send-reset-otp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: resetPhone })
                });

                const data = await res.json().catch(() => ({}));

                if (res.ok) {
                    switchView('forgotOtp');
                    document.querySelector('.reset-otp').focus();
                } else {
                    showError(data.message || 'کاربری با این شماره یافت نشد.');
                }
            } catch (err) {
                showError('ارتباط با سرور برقرار نشد.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">send</span><span>ارسال کد بازیابی به بله</span>';
            }
        }

        // ۳.۱. ثبت رمز جدید با OTP
        async function handleResetPassword(e) {
            e.preventDefault();
            let code = '';
            document.querySelectorAll('.reset-otp').forEach(i => code += i.value);
            const newPassword = document.getElementById('newResetPassword').value;

            if (code.length < 5) {
                showError('لطفاً کد ۵ رقمی را کامل وارد کنید.');
                return;
            }

            const btn = document.getElementById('resetPassBtn');
            btn.disabled = true;
            btn.innerHTML = 'در حال به‌روزرسانی رمز...';
            document.getElementById('authErrorMsg').style.display = 'none';

            try {
                const res = await fetch('http://localhost:3000/api/auth/reset-password-with-otp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phone: resetPhone,
                        code,
                        newPassword
                    })
                });

                const data = await res.json().catch(() => ({}));

                if (res.ok) {
                    alert('رمز عبور شما با موفقیت تغییر کرد. اکنون با رمز جدید وارد شوید.');
                    switchView('login');
                    document.getElementById('loginPhone').value = resetPhone;
                    document.getElementById('loginPassword').value = '';
                } else {
                    showError(data.message || 'کد تایید نادرست یا منقضی است.');
                }
            } catch (err) {
                showError('خطا در ارتباط با سرور.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>ذخیره رمز جدید و ورود</span>';
            }
        }
    </script>
</body>

</html>
