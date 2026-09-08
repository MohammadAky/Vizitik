<?php
require_once 'auth_helper.php';

// اگر کاربر لاگین است، نیازی به ثبت نام ندارد
if (isLoggedIn()) {
    header("Location: dashboard.php");
    exit();
}

$messageHtml = "";

if ($_SERVER["REQUEST_METHOD"] === "POST") {
    $firstName = trim($_POST["fname"] ?? "");
    $lastName = trim($_POST["lname"] ?? "");
    $phone = trim($_POST["phone"] ?? "");
    $baleChatId = trim($_POST["bale_chat_id"] ?? "");
    $userPassword = $_POST["password"] ?? "";
    $confirmPassword = $_POST["confirm_password"] ?? "";

    // اعتبارسنجی
    if (empty($firstName) || empty($lastName) || empty($phone) || empty($userPassword) || empty($confirmPassword)) {
        $messageHtml = '<div class="popup error-message">لطفاً تمام فیلدهای الزامی را پر کنید.</div>';
    } elseif ($userPassword !== $confirmPassword) {
        $messageHtml = '<div class="popup error-message">رمز عبور و تکرار آن یکسان نیست.</div>';
    } elseif (strlen($userPassword) < 6) {
        $messageHtml = '<div class="popup error-message">رمز عبور باید حداقل ۶ کاراکتر باشد.</div>';
    } elseif (!preg_match('/^09[0-9]{9}$/', $phone)) {
        $messageHtml = '<div class="popup error-message">شماره موبایل معتبر نیست.</div>';
    } else {
        $data = [
            "firstName"  => $firstName,
            "lastName"   => $lastName,
            "phone"      => $phone,
            "password"   => $userPassword,
            "baleChatId" => !empty($baleChatId) ? $baleChatId : null
        ];

        $ch = curl_init("http://localhost:3000/api/auth/register");
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($response === false) {
            $messageHtml = '<div class="popup error-message">ارتباط با سرور برقرار نشد.</div>';
        } else {
            $result = json_decode($response, true);

            if ($httpCode === 201 || $httpCode === 200) {
                $accessToken = $result["accessToken"] ?? "";
                $user = $result["user"] ?? [];

                if (!empty($accessToken)) {
                    session_regenerate_id(true);
                    $_SESSION["accessToken"] = $accessToken;
                    $_SESSION["user"] = $user;

                    // ریدارکت مستقیم به داشبورد
                    header("Location: dashboard.php");
                    exit();
                } else {
                    $messageHtml = '<div class="popup error-message">ثبت‌نام انجام شد اما توکن ورود دریافت نشد.</div>';
                }
            } else {
                $msg = $result["message"] ?? "خطایی در ثبت‌نام رخ داد.";
                if (is_array($msg)) $msg = implode("<br>", $msg);
                $messageHtml = '<div class="popup error-message">' . htmlspecialchars($msg) . '</div>';
            }
        }
    }
}
?>

<!DOCTYPE html>
<html lang="fa" dir="rtl">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>ثبت‌نام ویزیتور | ویزیتیک</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">
</head>

<body>
    <div class="app register-app">

        <section class="register-page">
            <div class="register-container">
                <div class="register-header">
                    <h2>ساخت حساب کاربری ویزیتور</h2>
                    <p>اطلاعات کاربری و شناسه بله خود را وارد نمایید</p>
                </div>

                <?= $messageHtml ?>

                <form class="register-form" id="registerForm" method="POST">

                    <!-- نام و نام خانوادگی -->
                    <div class="name-row" style="display: flex; gap: 8px;">
                        <div class="input-group" style="flex: 1;">
                            <label>نام</label>
                            <input type="text" name="fname" placeholder="مثلاً: علی" autocomplete="given-name" required>
                        </div>
                        <div class="input-group" style="flex: 1;">
                            <label>نام خانوادگی</label>
                            <input type="text" name="lname" placeholder="مثلاً: حسینی" autocomplete="family-name" required>
                        </div>
                    </div>

                    <!-- شماره موبایل -->
                    <div class="input-group">
                        <label>شماره موبایل ویزیتور</label>
                        <input type="tel" name="phone" placeholder="09xxxxxxxxx" maxlength="11" autocomplete="tel" required>
                    </div>

                    <!-- رمز عبور جدید -->
                    <div class="input-group">
                        <label>رمز عبور (حداقل ۶ کاراکتر)</label>
                        <input type="password" name="password" placeholder="حداقل ۶ کاراکتر" autocomplete="new-password" minlength="6" required>
                    </div>

                    <!-- تکرار رمز عبور -->
                    <div class="input-group">
                        <label>تکرار رمز عبور</label>
                        <input type="password" name="confirm_password" placeholder="تکرار رمز عبور" autocomplete="new-password" minlength="6" required>
                    </div>

                    <!-- موافقت با قوانین و مقررات -->
                    <div class="terms-consent">
                        <input type="checkbox" id="regTermsCheck" name="accept_terms" value="1" required>
                        <label class="terms-consent-text" for="regTermsCheck">
                            <span>قوانین و مقررات و شرایط استفاده از سامانه <strong>ویزیتیک</strong> را می‌پذیرم و موافقم.</span>
                            <small>
                                <button type="button" class="terms-link-btn" onclick="openTermsModal()">مشاهده قوانین و مقررات</button>
                            </small>
                        </label>
                    </div>

                    <button type="submit" class="login-btn" style="margin-top: 6px;">
                        <span class="material-symbols-outlined">how_to_reg</span>
                        <span>تکمیل ثبت‌نام و ورود به حساب</span>
                    </button>
                </form>

                <div class="switch-auth-box">
                    <span>قبلاً ثبت‌نام کرده‌اید؟</span>
                    <a href="index.php">ورود به حساب</a>
                </div>
            </div>
        </section>
    </div>

    <!-- مودال قوانین و مقررات -->
    <div class="terms-modal-overlay" id="termsModal" onclick="if(event.target === this) closeTermsModal()">
        <div class="terms-sheet">
            <div class="terms-head">
                <div class="terms-head-title">
                    <span class="material-symbols-outlined">description</span>
                    <span>قوانین و مقررات ویزیتیک</span>
                </div>
                <button type="button" class="terms-close" onclick="closeTermsModal()" aria-label="بستن">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div class="terms-scroll">
                <?php include 'terms-content.php'; ?>
            </div>
            <div class="terms-actions">
                <button type="button" class="terms-accept-btn" onclick="acceptAndCloseTerms()">
                    <span class="material-symbols-outlined" style="font-size: 18px;">check_circle</span>
                    <span>مطالعه کردم و موافقم</span>
                </button>
            </div>
        </div>
    </div>

    <script>
        function openTermsModal() {
            document.getElementById('termsModal').classList.add('show');
        }
        function closeTermsModal() {
            document.getElementById('termsModal').classList.remove('show');
        }
        // دکمه «موافقم» هم مودال را می‌بندد و هم چک‌باکس را فعال می‌کند
        function acceptAndCloseTerms() {
            const chk = document.getElementById('regTermsCheck');
            if (chk) chk.checked = true;
            closeTermsModal();
        }
    </script>
</body>

</html>
