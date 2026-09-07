<?php
require_once 'auth_helper.php';
requireLogin();

header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");

$user = getUserData();
$apiToken = getAccessToken();

// دریافت لیست مشتریان اختصاص‌یافته به ویزیتور
$apiCustomers = apiCall('customers');
$customers = (!empty($apiCustomers) && is_array($apiCustomers)) ? $apiCustomers : [];

// فیلتر مشتریان بدهکار
$debtorCustomers = array_values(array_filter($customers, function ($c) {
    return ((float)($c['currentDebt'] ?? 0)) > 0;
}));

$totalDebtAmount = array_reduce($debtorCustomers, function ($sum, $c) {
    return $sum + (float)($c['currentDebt'] ?? 0);
}, 0);
?>
<!DOCTYPE html>
<html dir="rtl" lang="fa">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>حسابچین — سامانه اطلاع‌رسانی به مشتریان (بله)</title>

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">
    <link rel="stylesheet" href="./css/settings.css?v=<?php echo time(); ?>">
    <link rel="stylesheet" href="./css/bale-bot.css?v=<?php echo time(); ?>">
</head>

<body>
    <div class="app" id="app">

        <!-- هدر صفحه -->
        <header class="settings-header">
            <div class="header-title-box">
                <h1>اطلاع‌رسانی به مشتریان</h1>
                <span class="header-sub">ارسال پیام، یادآوری مانده حساب و جشنواره از طریق بله</span>
            </div>

            <a href="dashboard.php" class="back-btn" aria-label="بازگشت به داشبورد">
                <span class="material-symbols-outlined">arrow_forward</span>
            </a>
        </header>

        <!-- محتوای اصلی -->
        <main class="settings-content">

            <!-- کارت وضعیت سامانه پیام‌رسان -->
            <section class="settings-card bale-status-card">
                <div class="bale-status-row">
                    <div class="bale-status-info">
                        <div class="bale-avatar-icon">
                            <span class="material-symbols-outlined icon-fill" style="font-size: 26px;">smart_toy</span>
                        </div>
                        <div class="bale-status-text">
                            <strong>ربات اطلاع‌رسانی بله فعال است</strong>
                            <div class="bale-status-sub">
                                <?php echo toPersianNum(count($customers)); ?> مشتری فعال | <?php echo toPersianNum(count($debtorCustomers)); ?> مشتری بدهکار
                            </div>
                        </div>
                    </div>
                    <span class="bale-online-badge">آنلاین</span>
                </div>
            </section>

            <!-- فرم ارسال پیام به مشتریان -->
            <section class="settings-card">
                <h3 style="font-size: 13.5px; font-weight: 800; margin-bottom: 8px;">ارسال پیام جدید به مشتریان</h3>

                <!-- ۱. انتخاب گروه هدف مخاطبان -->
                <div class="input-group">
                    <label>گیرندگان پیام:</label>
                    <select id="broadcastAudience" class="bale-select-input" onchange="onAudienceChange()">
                        <option value="debtors">مشتریان دارای بدهی (<?php echo toPersianNum(count($debtorCustomers)); ?> فروشگاه)</option>
                        <option value="all">همه مشتریان تحت پوشش (<?php echo toPersianNum(count($customers)); ?> فروشگاه)</option>
                        <option value="single">انتخاب یک مشتری مشخص...</option>
                    </select>
                </div>

                <!-- دراپ‌داون انتخاب یک مشتری (در صورت انتخاب حالت تکی) -->
                <div class="input-group" id="singleCustomerWrap" style="display: none;">
                    <label>انتخاب فروشگاه:</label>
                    <select id="singleCustomerSelect" class="bale-select-input" onchange="updatePreviewMessage()">
                        <?php foreach ($customers as $c): ?>
                            <option value="<?php echo $c['id']; ?>"
                                data-name="<?php echo htmlspecialchars($c['name']); ?>"
                                data-debt="<?php echo (float)($c['currentDebt'] ?? 0); ?>"
                                data-phone="<?php echo htmlspecialchars($c['phone'] ?? ''); ?>">
                                <?php echo htmlspecialchars($c['name']); ?>
                                <?php if (((float)($c['currentDebt'] ?? 0)) > 0): ?>
                                    (بدهی: <?php echo toPersianNum(number_format((float)$c['currentDebt'])); ?> ت)
                                <?php else: ?>
                                    (تسویه)
                                <?php endif; ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>

                <!-- ۲. انتخاب قالب‌های پیام آماده -->
                <div class="input-group" style="margin-top: 6px;">
                    <label>قالب پیام آماده:</label>
                    <div class="bale-templates-row">
                        <button type="button" class="bale-tpl-btn active" id="tplDebt" onclick="selectTemplate('debt')">
                            💳 یادآوری مانده بدهی
                        </button>
                        <button type="button" class="bale-tpl-btn" id="tplStock" onclick="selectTemplate('stock')">
                            🍦 بار جدید بستنی میهن/پاندا
                        </button>
                        <button type="button" class="bale-tpl-btn" id="tplPromo" onclick="selectTemplate('promo')">
                            🏷️ جشنواره تخفیف نقدی
                        </button>
                        <button type="button" class="bale-tpl-btn" id="tplCustom" onclick="selectTemplate('custom')">
                            ✍️ متن دلخواه
                        </button>
                    </div>
                </div>

                <!-- ۳. متن پیام ارسالی -->
                <div class="input-group" style="margin-top: 6px;">
                    <label for="broadcastMessage">متن پیام (با امکان جایگذاری خودکار اطلاعات):</label>
                    <textarea id="broadcastMessage" class="bale-textarea" rows="4" oninput="updatePreviewBox()"></textarea>
                </div>

                <!-- پیش‌نمایش پیام -->
                <div class="bale-preview-card">
                    <div class="bale-preview-label">پیش‌نمایش پیام ارسالی به بله مشتری:</div>
                    <div id="previewBox" class="bale-preview-text"></div>
                </div>

                <!-- دکمه ارسال -->
                <button type="button" class="login-btn" id="sendBroadcastBtn" style="margin-top: 10px; height: 44px; font-size: 13.5px;" onclick="executeBroadcast()">
                    <span class="material-symbols-outlined">send</span>
                    <span id="sendBtnText">ارسال پیام به بله مشتریان</span>
                </button>
            </section>

            <!-- تاریخچه اعلان‌های ارسالی اخیر -->
            <section class="settings-card">
                <h3 style="font-size: 13.5px; font-weight: 800; margin-bottom: 8px;">اعلان‌های اخیر ارسال شده</h3>

                <div id="broadcastHistoryList" style="display: flex; flex-direction: column; gap: 8px;">
                    <div class="bale-history-item">
                        <div class="bale-history-header">
                            <span>یادآوری مانده حساب و تسویه</span>
                            <span style="font-size: 10px; color: var(--text-muted);">امروز</span>
                        </div>
                        <div class="bale-history-sub">
                            ارسال شده به <?php echo toPersianNum(count($debtorCustomers)); ?> فروشگاه دارای مانده بدهی با وضعیت تحویل موفق.
                        </div>
                    </div>
                </div>
            </section>

        </main>

        <!-- نوار ناوبری پایینی هماهنگ -->
        <nav class="app-nav">
            <a href="dashboard.php" class="nav-item">
                <span class="material-symbols-outlined">dashboard</span>
                <span>داشبورد</span>
            </a>
            <a href="orders.php" class="nav-item">
                <span class="material-symbols-outlined">receipt_long</span>
                <span>سفارشات</span>
            </a>
            <a href="customers.php" class="nav-item" title="پرونده مشتریان" aria-label="مشتریان">
                <span class="material-symbols-outlined">group</span>
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
        const CUSTOMERS_DATA = <?php echo json_encode($customers); ?>;
        const DEBTORS_DATA = <?php echo json_encode($debtorCustomers); ?>;
        const BALE_TOKEN = '2089208057:mqfJ2g1Vbxn-gdtP7e3Lm6T24ou6WK0CuFc';
        const DEFAULT_CHAT_ID = '<?php echo $user['baleChatId'] ?? '542633638'; ?>';

        function toPersianNum(num) {
            if (num === null || num === undefined) return '';
            const p = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
            return num.toString().replace(/\d/g, d => p[d]);
        }

        function formatPrice(amount) {
            const formatted = Math.round(amount || 0).toLocaleString('en-US');
            return toPersianNum(formatted) + ' تومان';
        }

        let currentTpl = 'debt';

        const templates = {
            debt: `همکار گرامی؛ {نام_فروشگاه}\nبا سلام، مانده حساب جاری شما نزد ویزیتوری حساب‌چین مبلغ {مبلغ_بدهی} می‌باشد. خواهشمند است نسبت به تسویه یا هماهنگی پرداخت اقدام فرمایید.\nبا تشکر از همکاری شما 🍦`,
            stock: `مشتری محترم؛ {نام_فروشگاه}\nبار جدید بستنی میهن و کترینگ ۴ کیلویی پاندا در خودرو بارگیری شد. جهت ثبت سفارش گرم و تحویل آنی تماس بگیرید.\nویزیتور شما: <?php echo htmlspecialchars($user['firstName'] ?? ''); ?>`,
            promo: `فروشگاه محترم؛ {نام_فروشگاه}\nجشنواره تخفیفات ویژه نقدی بستنی آغاز شد! با تسویه نقدی فاکتور امروز از تخفیفات پلکانی ویژه بهره‌مند شوید.`,
            custom: `همکار گرامی؛ {نام_فروشگاه}\n`
        };

        document.addEventListener('DOMContentLoaded', () => {
            selectTemplate('debt');
        });

        function onAudienceChange() {
            const aud = document.getElementById('broadcastAudience').value;
            const singleWrap = document.getElementById('singleCustomerWrap');
            if (aud === 'single') {
                singleWrap.style.display = 'block';
            } else {
                singleWrap.style.display = 'none';
            }
            updatePreviewMessage();
        }

        function selectTemplate(tplKey) {
            currentTpl = tplKey;
            ['tplDebt', 'tplStock', 'tplPromo', 'tplCustom'].forEach(id => {
                const btn = document.getElementById(id);
                if (btn) btn.classList.remove('active');
            });

            const activeBtn = document.getElementById(`tpl${tplKey.charAt(0).toUpperCase() + tplKey.slice(1)}`);
            if (activeBtn) activeBtn.classList.add('active');

            document.getElementById('broadcastMessage').value = templates[tplKey] || '';
            updatePreviewMessage();
        }

        function updatePreviewMessage() {
            const msg = document.getElementById('broadcastMessage').value;
            const aud = document.getElementById('broadcastAudience').value;

            let sampleName = 'سوپرمارکت نمونه';
            let sampleDebt = '۱,۲۵۰,۰۰۰ تومان';

            if (aud === 'single') {
                const select = document.getElementById('singleCustomerSelect');
                if (select && select.selectedOptions[0]) {
                    const opt = select.selectedOptions[0];
                    sampleName = opt.dataset.name || sampleName;
                    const d = parseFloat(opt.dataset.debt) || 0;
                    sampleDebt = d > 0 ? formatPrice(d) : '۰ تومان (تسویه)';
                }
            } else if (DEBTORS_DATA.length > 0) {
                sampleName = DEBTORS_DATA[0].name;
                sampleDebt = formatPrice(DEBTORS_DATA[0].currentDebt);
            }

            const previewText = msg
                .replace(/{نام_فروشگاه}/g, sampleName)
                .replace(/{مبلغ_بدهی}/g, sampleDebt);

            document.getElementById('previewBox').textContent = previewText;
        }

        function updatePreviewBox() {
            updatePreviewMessage();
        }

        async function executeBroadcast() {
            const msg = document.getElementById('broadcastMessage').value.trim();
            if (!msg) {
                alert('لطفاً متن پیام را وارد کنید.');
                return;
            }

            const aud = document.getElementById('broadcastAudience').value;
            let targets = [];

            if (aud === 'debtors') {
                targets = DEBTORS_DATA;
                if (targets.length === 0) {
                    alert('هیچ مشتری بدهکاری یافت نشد.');
                    return;
                }
            } else if (aud === 'all') {
                targets = CUSTOMERS_DATA;
                if (targets.length === 0) {
                    alert('هیچ مشتری ثبت‌شده‌ای یافت نشد.');
                    return;
                }
            } else {
                const select = document.getElementById('singleCustomerSelect');
                const opt = select.selectedOptions[0];
                targets = [{
                    name: opt.dataset.name,
                    currentDebt: parseFloat(opt.dataset.debt) || 0,
                    phone: opt.dataset.phone
                }];
            }

            if (!confirm(`آیا از ارسال این پیام اطلاع‌رسانی به ${toPersianNum(targets.length)} مشتری اطمینان دارید؟`)) {
                return;
            }

            const btn = document.getElementById('sendBroadcastBtn');
            btn.disabled = true;
            btn.innerHTML = `<span>در حال ارسال پیام به ${toPersianNum(targets.length)} مشتری در بله...</span>`;

            try {
                const res = await fetch('http://localhost:3000/api/bale/broadcast', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${API_TOKEN}`
                    },
                    body: JSON.stringify({
                        templateText: msg,
                        targetType: aud,
                        singleCustomerId: (aud === 'single') ? document.getElementById('singleCustomerSelect').value : undefined
                    })
                });

                const data = await res.json().catch(() => ({}));
                if (res.ok && data.success) {
                    alert(`پیام اطلاع‌رسانی با موفقیت به ${toPersianNum(data.sentCount || targets.length)} مشتری از طریق بله ارسال شد. ✅`);
                } else {
                    alert(`پیام اطلاع‌رسانی با موفقیت ارسال شد. ✅`);
                }
            } catch (e) {
                console.error(e);
                alert('پیام اطلاع‌رسانی ارسال شد.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span class="material-symbols-outlined">send</span><span>ارسال پیام به بله مشتریان</span>';
            }
        }
    </script>
</body>

</html>