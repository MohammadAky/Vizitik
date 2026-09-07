<?php
require_once 'auth_helper.php';

// ۱. بررسی لاگین بودن کاربر
requireLogin();

// ۲. جلوگیری از کش
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");

// ۳. دریافت مشتریان دارای بدهی
$apiCustomers = apiCall('customers');
$customers = (!empty($apiCustomers) && is_array($apiCustomers)) ? $apiCustomers : [];

$debtors = [];
$totalMarketDebt = 0;

foreach ($customers as $c) {
    $debt = (float)($c['currentDebt'] ?? 0);
    if ($debt > 0) {
        $debtors[] = $c;
        $totalMarketDebt += $debt;
    }
}

// ۴. دریافت چک‌ها
$apiOrders = apiCall('orders');
$orders = (!empty($apiOrders) && is_array($apiOrders)) ? $apiOrders : [];

$checks = [];
foreach ($orders as $ord) {
    if (!empty($ord['payments'])) {
        foreach ($ord['payments'] as $p) {
            if (($p['method'] ?? '') === 'CHECK' && !empty($p['check'])) {
                $chk = $p['check'];
                $chk['customerName'] = $ord['customer']['name'] ?? 'مشتری';
                $chk['amount'] = $p['amount'] ?? 0;
                $checks[] = $chk;
            }
        }
    }
}

$apiToken = getAccessToken();
?>
<!DOCTYPE html>
<html dir="rtl" lang="fa">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>حسابچین — وصول مطالبات و مدیریت چک‌ها</title>

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">
    <link rel="stylesheet" href="./css/collections.css?v=<?php echo time(); ?>">
</head>

<body>
    <div class="app" id="app">

        <!-- هدر صفحه وصول مطالبات -->
        <header class="collections-header">
            <div class="header-top-row">
                <div class="header-title-box">
                    <h1>وصول مطالبات و دفتر حساب</h1>
                    <span class="header-sub">پیگیری بدهی مشتریان و چک‌های سررسید</span>
                </div>

                <a href="dashboard.php" class="back-btn" aria-label="بازگشت به داشبورد">
                    <span class="material-symbols-outlined">arrow_forward</span>
                </a>
            </div>

            <!-- بنر مجموع طلب بازار -->
            <div class="total-debt-banner">
                <div class="banner-info">
                    <span class="banner-label">مجموع کل طلب شما از بازار:</span>
                    <strong class="banner-amount"><?php echo toPersianNum(number_format($totalMarketDebt)); ?> تومان</strong>
                </div>
                <div style="font-size: 11.5px; background: rgba(255,255,255,0.22); padding: 5px 10px; border-radius: 8px; font-weight: 700;">
                    <?php echo toPersianNum(count($debtors)); ?> فروشگاه بدهکار
                </div>
            </div>
        </header>

        <!-- محتوای اصلی -->
        <main class="collections-content">

            <!-- تب‌های سوییچ -->
            <div class="collections-tabs">
                <button type="button" class="tab-btn active" id="tabDebtorsBtn" onclick="switchCollectionTab('debtors')">
                    <span class="material-symbols-outlined" style="font-size: 18px;">account_balance_wallet</span>
                    <span>بدهی مشتریان (<?php echo toPersianNum(count($debtors)); ?>)</span>
                </button>
                <button type="button" class="tab-btn" id="tabChecksBtn" onclick="switchCollectionTab('checks')">
                    <span class="material-symbols-outlined" style="font-size: 18px;">fact_check</span>
                    <span>چک‌های دریافتی (<?php echo toPersianNum(count($checks)); ?>)</span>
                </button>
            </div>

            <!-- ۱. لیست مشتریان بدهکار -->
            <section class="debtors-list" id="debtorsView">
                <?php if (!empty($debtors)): ?>
                    <?php foreach ($debtors as $d):
                        $debt = (float)$d['currentDebt'];
                    ?>
                        <article class="debtor-card">
                            <div class="debtor-card-top">
                                <div class="debtor-name-row">
                                    <div class="debtor-avatar">
                                        <span class="material-symbols-outlined">storefront</span>
                                    </div>
                                    <div class="debtor-details">
                                        <h3 class="debtor-name"><?php echo htmlspecialchars($d['name']); ?></h3>
                                        <span class="debtor-phone"><?php echo toPersianNum($d['phone'] ?? 'بدون شماره'); ?></span>
                                    </div>
                                </div>
                                <div class="debtor-amount-box">
                                    <span class="debtor-amount-label">مانده بدهی</span>
                                    <strong class="debtor-amount"><?php echo toPersianNum(number_format($debt)); ?> ت</strong>
                                </div>
                            </div>

                            <div class="debtor-actions-row">
                                <button type="button" class="settle-btn" onclick="openSettleModal('<?php echo $d['id']; ?>', '<?php echo htmlspecialchars(addslashes($d['name'])); ?>', <?php echo $debt; ?>)">
                                    <span class="material-symbols-outlined" style="font-size: 16px;">add_card</span>
                                    <span>ثبت دریافت وجه</span>
                                </button>
                                <?php if (!empty($d['phone'])): ?>
                                    <a href="tel:<?php echo $d['phone']; ?>" class="call-btn" title="تماس تلفنی">
                                        <span class="material-symbols-outlined" style="font-size: 18px;">call</span>
                                    </a>
                                <?php endif; ?>
                            </div>
                        </article>
                    <?php endforeach; ?>
                <?php else: ?>
                    <div style="text-align: center; padding: 30px 16px; color: var(--text-muted); font-size: 13px;">
                        🎉 تمامی حساب‌های مشتریان تسویه است و مانده بدهی بازی وجود ندارد.
                    </div>
                <?php endif; ?>
            </section>

            <!-- ۲. لیست چک‌های صیادی -->
            <section class="checks-list" id="checksView" style="display: none;">
                <?php if (!empty($checks)): ?>
                    <?php foreach ($checks as $chk):
                        $statusClass = 'pending';
                        $statusTitle = 'در انتظار سررسید';
                        if ($chk['status'] === 'PASSED') {
                            $statusClass = 'passed';
                            $statusTitle = 'پاس شده';
                        } elseif ($chk['status'] === 'BOUNCED') {
                            $statusClass = 'bounced';
                            $statusTitle = 'برگشت خورده';
                        }
                    ?>
                        <article class="check-card">
                            <div class="check-card-header">
                                <strong style="font-size: 13.5px; color: var(--text-primary);"><?php echo htmlspecialchars($chk['customerName'] ?? 'مشتری'); ?></strong>
                                <span class="check-badge <?php echo $statusClass; ?>"><?php echo $statusTitle; ?></span>
                            </div>

                            <div class="check-meta-row">
                                <span>مبلغ چک:</span>
                                <strong style="font-size: 13px; color: var(--primary);"><?php echo toPersianNum(number_format((float)($chk['amount'] ?? 0))); ?> تومان</strong>
                            </div>
                            <div class="check-meta-row">
                                <span>شناسه / شماره:</span>
                                <span><?php echo toPersianNum($chk['checkNumber'] ?? '---'); ?></span>
                            </div>
                            <div class="check-meta-row">
                                <span>بانک و سررسید:</span>
                                <span><?php echo htmlspecialchars($chk['bankName'] ?? 'بانک'); ?> | <?php echo toPersianNum($chk['dueDate'] ?? '---'); ?></span>
                            </div>
                        </article>
                    <?php endforeach; ?>
                <?php else: ?>
                    <div style="text-align: center; padding: 30px 16px; color: var(--text-muted); font-size: 13px;">
                        📄 هیچ چک دریافتی در سیستم ثبت نشده است.
                    </div>
                <?php endif; ?>
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
            <a href="customers.php" class="nav-item" title="پرونده مشتریان" aria-label="مشتریان">
                <span class="material-symbols-outlined">group</span>
                <span>مشتریان</span>
            </a>
            <a href="van-loading.php" class="nav-item">
                <span class="material-symbols-outlined">local_shipping</span>
                <span>بارگیری خودرو</span>
            </a>
            <a href="collections.php" class="nav-item active">
                <span class="material-symbols-outlined icon-fill">payments</span>
                <span>وصول مطالبات</span>
            </a>
        </nav>

        <!-- مدال اصلاح‌شده ثبت وصولی -->
        <div class="modal-overlay" id="settleModal" onclick="if(event.target === this) closeSettleModal()">
            <div class="settlement-modal-sheet">
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 10px;">
                    <div>
                        <h3 style="font-size: 15px; font-weight: 800; margin: 0;">ثبت دریافت وجه</h3>
                        <span id="settleCustName" style="font-size: 11px; color: var(--primary); font-weight: 700;"></span>
                    </div>
                    <button type="button" style="background:none; border:none; cursor:pointer; color:var(--text-muted);" onclick="closeSettleModal()">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>

                <!-- مبلغ دریافتی -->
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 11.5px; font-weight: 700;">مبلغ دریافتی (تومان):</label>
                    <input type="text" id="settleAmountInput" placeholder="مبلغ وصولی..." style="height: 44px; border-radius: 12px; border: 1.5px solid var(--border); padding: 0 12px; font-family: inherit; font-size: 14px; font-weight: 800; text-align: right; direction: ltr;">
                </div>

                <!-- روش دریافت وجه -->
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label style="font-size: 11.5px; font-weight: 700;">روش پرداخت:</label>
                    <div class="method-radio-group">
                        <button type="button" class="method-radio-btn active" id="mCashBtn" onclick="selectSettleMethod('CASH')">
                            <span class="material-symbols-outlined">payments</span>
                            <span>نقدی</span>
                        </button>
                        <button type="button" class="method-radio-btn" id="mPosBtn" onclick="selectSettleMethod('CARD')">
                            <span class="material-symbols-outlined">point_of_sale</span>
                            <span>کارتخوان / پوز</span>
                        </button>
                        <button type="button" class="method-radio-btn" id="mCheckBtn" onclick="selectSettleMethod('CHECK')">
                            <span class="material-symbols-outlined">fact_check</span>
                            <span>چک صیادی</span>
                        </button>
                    </div>
                </div>

                <!-- توضیحات / شماره پیگیری -->
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 11px; font-weight: 700;">شماره پیگیری یا توضیحات (اختیاری):</label>
                    <input type="text" id="settleNotesInput" placeholder="مثلاً: شماره ارجاع دستگاه پوز" style="height: 40px; border-radius: 10px; border: 1px solid var(--border); padding: 0 10px; font-family: inherit; font-size: 12px;">
                </div>

                <button type="button" class="settle-btn" id="settleSubmitBtn" style="height: 46px; font-size: 13.5px; margin-top: 4px;" onclick="submitSettlement()">
                    <span class="material-symbols-outlined">check_circle</span>
                    <span>ثبت در دفتر حساب و کاهش بدهی</span>
                </button>
            </div>
        </div>

    </div>

    <script>
        const API_TOKEN = '<?php echo $apiToken; ?>';

        function switchCollectionTab(tab) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            if (tab === 'debtors') {
                document.getElementById('tabDebtorsBtn').classList.add('active');
                document.getElementById('debtorsView').style.display = 'flex';
                document.getElementById('checksView').style.display = 'none';
            } else {
                document.getElementById('tabChecksBtn').classList.add('active');
                document.getElementById('debtorsView').style.display = 'none';
                document.getElementById('checksView').style.display = 'flex';
            }
        }

        let activeSettleCustId = null;
        let selectedSettleMethod = 'CASH';

        function selectSettleMethod(method) {
            selectedSettleMethod = method;
            document.querySelectorAll('.method-radio-btn').forEach(b => b.classList.remove('active'));
            if (method === 'CASH') document.getElementById('mCashBtn').classList.add('active');
            if (method === 'CARD') document.getElementById('mPosBtn').classList.add('active');
            if (method === 'CHECK') document.getElementById('mCheckBtn').classList.add('active');
        }

        function openSettleModal(id, name, debt) {
            activeSettleCustId = id;
            document.getElementById('settleCustName').textContent = `فروشگاه ${name} (کل بدهی: ${Number(debt).toLocaleString('en-US')} تومان)`;
            document.getElementById('settleAmountInput').value = Number(debt).toLocaleString('en-US');
            selectSettleMethod('CASH');
            document.getElementById('settleModal').style.display = 'flex';
        }

        function closeSettleModal() {
            document.getElementById('settleModal').style.display = 'none';
        }

        async function submitSettlement() {
            if (!activeSettleCustId) return;
            const rawAmount = (document.getElementById('settleAmountInput').value || '').replace(/[^0-9]/g, '');
            const amount = parseFloat(rawAmount) || 0;
            const notes = document.getElementById('settleNotesInput').value.trim();

            if (amount <= 0) {
                alert('لطفاً مبلغ دریافتی معتبر وارد نمایید.');
                return;
            }

            const btn = document.getElementById('settleSubmitBtn');
            btn.disabled = true;
            btn.innerHTML = 'در حال ثبت دریافت وجه...';

            try {
                const res = await fetch(`http://localhost:3000/api/customers/${activeSettleCustId}/settle`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${API_TOKEN}`
                    },
                    body: JSON.stringify({
                        amount,
                        method: selectedSettleMethod,
                        notes
                    })
                });

                const data = await res.json().catch(() => ({}));
                if (res.ok) {
                    alert('دریافت وجه با موفقیت ثبت شد و مانده بدهی مشتری کسر گردید.');
                    closeSettleModal();
                    window.location.reload();
                } else {
                    alert(data.message || 'خطا در ثبت وصولی.');
                    btn.disabled = false;
                    btn.innerHTML = '<span class="material-symbols-outlined">check_circle</span><span>ثبت در دفتر حساب و کاهش بدهی</span>';
                }
            } catch (err) {
                alert('خطا در ارتباط با سرور.');
                btn.disabled = false;
                btn.innerHTML = '<span class="material-symbols-outlined">check_circle</span><span>ثبت در دفتر حساب و کاهش بدهی</span>';
            }
        }
    </script>
</body>

</html>
