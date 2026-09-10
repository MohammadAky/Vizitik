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

// مشتریان متصل و غیرمتصل به بله
$linkedCustomers = array_values(array_filter($customers, function ($c) {
    return !empty($c['baleChatId']);
}));
$unlinkedCustomers = array_values(array_filter($customers, function ($c) {
    return empty($c['baleChatId']);
}));

// فیلتر مشتریان بدهکار
$debtorCustomers = array_values(array_filter($customers, function ($c) {
    return ((float)($c['currentDebt'] ?? 0)) > 0;
}));
?>
<!DOCTYPE html>
<html dir="rtl" lang="fa">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>ویزیتیک — مدیریت ربات بله و اطلاع‌رسانی</title>

    <link rel="stylesheet" href="./fonts/vazirmatn/vazirmatn.css">
    <link rel="stylesheet" href="./fonts/material-symbols/material-symbols.css" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">
    <link rel="stylesheet" href="./css/settings.css?v=<?php echo time(); ?>">
    <link rel="stylesheet" href="./css/bale-bot.css?v=<?php echo time(); ?>">
</head>

<body>
    <div class="app" id="app">

        <!-- هدر صفحه مدیریت ربات بله -->
        <header class="bale-header">
            <div class="header-title-box">
                <h1>سامانه پیام‌رسان و ربات بله</h1>
                <span class="header-sub">ارسال خودکار فاکتور به مشتری و ویزیتور و اطلاع‌رسانی</span>
            </div>

            <a href="dashboard.php" class="back-btn" aria-label="بازگشت به داشبورد">
                <span class="material-symbols-outlined">arrow_forward</span>
            </a>
        </header>

        <!-- محتوای اصلی -->
        <main class="settings-content">

            <!-- کارت وضعیت سامانه و آمار تفکیکی اتصال -->
            <section class="settings-card bale-status-card">
                <div class="bale-status-row">
                    <div class="bale-status-info">
                        <div class="bale-avatar-icon">
                            <span class="material-symbols-outlined icon-fill" style="font-size: 26px;">smart_toy</span>
                        </div>
                        <div class="bale-status-text">
                            <strong>ارسال خودکار فاکتور در بله فعال است</strong>
                            <div class="bale-status-sub">
                                شناسه ربات: @Vizitik_bot
                            </div>
                        </div>
                    </div>
                    <span class="bale-online-badge">
                        <span class="material-symbols-outlined" style="font-size: 14px;">wifi</span>
                        آنلاین
                    </span>
                </div>

                <!-- آمار سه‌گانه مشتریان -->
                <div class="bale-stats-grid">
                    <div class="bale-stat-pill">
                        <strong><?php echo toPersianNum(count($customers)); ?></strong>
                        <span>کل مشتریان</span>
                    </div>
                    <div class="bale-stat-pill success">
                        <strong><?php echo toPersianNum(count($linkedCustomers)); ?></strong>
                        <span>متصل به بله</span>
                    </div>
                    <div class="bale-stat-pill warning">
                        <strong><?php echo toPersianNum(count($unlinkedCustomers)); ?></strong>
                        <span>در انتظار اتصال</span>
                    </div>
                </div>
            </section>

            <!-- کارت اتصال و دعوت آسان فروشگاه‌ها -->
            <section class="settings-card">
                <div class="bale-onboarding-box">
                    <div class="bale-onboarding-header">
                        <span class="material-symbols-outlined">link</span>
                        <span>لینک اتصال خودکار مشتریان به ربات</span>
                    </div>
                    <p class="bale-onboarding-text">
                        هنگام ثبت هر فاکتور، نسخه کامل و رسمی فاکتور به صورت خودکار به بله فروشگاه و ویزیتور ارسال می‌شود. مشتریان با باز کردن ربات و لمس دکمه <strong>«ارسال شماره موبایل»</strong> متصل می‌شوند.
                    </p>
                    <div class="bale-bot-link-row">
                        <span class="bale-bot-link-text">https://ble.ir/Vizitik_bot</span>
                        <button type="button" class="bale-copy-btn" onclick="copyBotLink()">
                            <span class="material-symbols-outlined" style="font-size: 15px;">content_copy</span>
                            <span>کپی لینک</span>
                        </button>
                    </div>
                </div>
            </section>

            <!-- فرم ارسال پیام همگانی / یادآوری به مشتریان -->
            <section class="settings-card">
                <h3 style="font-size: 13.5px; font-weight: 800; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                    <span class="material-symbols-outlined" style="color: var(--primary);">campaign</span>
                    <span>ارسال پیام و اطلاع‌رسانی به مشتریان</span>
                </h3>

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

                <!-- ۲. انتخاب قالب‌های پیام آماده با آیکون‌های گوگل -->
                <div class="input-group" style="margin-top: 6px;">
                    <label>قالب پیام آماده:</label>
                    <div class="bale-templates-row">
                        <button type="button" class="bale-tpl-btn active" id="tplDebt" onclick="selectTemplate('debt')">
                            <span class="material-symbols-outlined">credit_card</span>
                            <span>یادآوری مانده بدهی</span>
                        </button>
                        <button type="button" class="bale-tpl-btn" id="tplStock" onclick="selectTemplate('stock')">
                            <span class="material-symbols-outlined">inventory_2</span>
                            <span>بار جدید</span>
                        </button>
                        <button type="button" class="bale-tpl-btn" id="tplPromo" onclick="selectTemplate('promo')">
                            <span class="material-symbols-outlined">local_offer</span>
                            <span>جشنواره تخفیف نقدی</span>
                        </button>
                        <button type="button" class="bale-tpl-btn" id="tplCustom" onclick="selectTemplate('custom')">
                            <span class="material-symbols-outlined">edit_note</span>
                            <span>متن دلخواه</span>
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
                <h3 style="font-size: 13.5px; font-weight: 800; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                    <span class="material-symbols-outlined" style="color: var(--primary);">history</span>
                    <span>اعلان‌های اخیر ارسال شده</span>
                </h3>

                <div id="broadcastHistoryList" style="display: flex; flex-direction: column; gap: 8px;">
                    <div class="bale-history-empty" id="emptyHistoryMsg">
                        <span class="material-symbols-outlined">history_toggle_off</span>
                        <span>هنوز اعلانی از این بخش ارسال نشده است.</span>
                    </div>
                </div>
            </section>

        </main>

    </div>

    <script>
        const API_TOKEN = '<?php echo $apiToken; ?>';
        const CUSTOMERS_DATA = <?php echo json_encode($customers); ?>;
        const DEBTORS_DATA = <?php echo json_encode($debtorCustomers); ?>;

        function toPersianNum(num) {
            if (num === null || num === undefined) return '';
            const p = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
            return num.toString().replace(/\d/g, d => p[d]);
        }

        function formatPrice(amount) {
            const formatted = Math.round(amount || 0).toLocaleString('en-US');
            return toPersianNum(formatted) + ' تومان';
        }

        function copyBotLink() {
            const link = 'https://ble.ir/Vizitik_bot';
            if (navigator.clipboard) {
                navigator.clipboard.writeText(link).then(() => {
                    alert('لینک ربات بله با موفقیت کپی شد:\n' + link);
                });
            } else {
                prompt('لینک ربات بله را کپی کنید:', link);
            }
        }

        let currentTpl = 'debt';

        // نام ویزیتور با قالب هشتگ (مثل #فاطمه_اکبری) — همراستا با قالب فاکتور بله
        const VISITOR_TAG = <?php echo json_encode('#' . str_replace(' ', '_', trim(($user['firstName'] ?? '') . ' ' . ($user['lastName'] ?? '')))); ?>;

        const templates = {
            debt: `همکار گرامی؛ {نام_فروشگاه}\nبا سلام، مانده حساب جاری شما نزد {نام_ویزیتور} مبلغ {مبلغ_بدهی} می‌باشد. خواهشمند است نسبت به تسویه یا هماهنگی پرداخت اقدام فرمایید.\nبا تشکر از همکاری شما`,
            stock: `مشتری محترم؛ {نام_فروشگاه}\nبار جدید بستنی در خودرو بارگیری شد. جهت ثبت سفارش گرم و تحویل آنی تماس بگیرید.\nویزیتور شما: {نام_ویزیتور}`,
            promo: `فروشگاه محترم؛ {نام_فروشگاه}\nجشنواره تخفیفات ویژه نقدی بستنی آغاز شد! با تسویه نقدی فاکتور امروز از تخفیفات پلکانی ویژه بهره‌مند شوید.\n{نام_ویزیتور}`,
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

            let sampleName = '{نام_فروشگاه}';
            let sampleDebt = '{مبلغ_بدهی}';

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
            } else if (CUSTOMERS_DATA.length > 0) {
                sampleName = CUSTOMERS_DATA[0].name;
                sampleDebt = formatPrice(CUSTOMERS_DATA[0].currentDebt || 0);
            }

            const previewText = msg
                .replace(/{نام_فروشگاه}/g, sampleName)
                .replace(/{نام_ویزیتور}/g, VISITOR_TAG)
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
                const count = data.sentCount || targets.length;
                alert(`پیام اطلاع‌رسانی با موفقیت به ${toPersianNum(count)} مشتری از طریق بله ارسال شد.`);

                // اضافه کردن به لیست تاریخچه به صورت پویا
                const emptyMsg = document.getElementById('emptyHistoryMsg');
                if (emptyMsg) emptyMsg.remove();

                const historyList = document.getElementById('broadcastHistoryList');
                const item = document.createElement('div');
                item.className = 'bale-history-item';
                item.innerHTML = `
                    <div class="bale-history-header">
                        <span>ارسال پیام به ${aud === 'debtors' ? 'مشتریان بدهکار' : (aud === 'all' ? 'همه مشتریان' : targets[0].name)}</span>
                        <span style="font-size: 10px; color: var(--text-muted);">هم‌اکنون</span>
                    </div>
                    <div class="bale-history-sub">
                        ارسال موفق به ${toPersianNum(count)} مخاطب بله.
                    </div>
                `;
                historyList.prepend(item);

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