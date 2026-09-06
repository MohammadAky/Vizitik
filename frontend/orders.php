<?php
require_once 'auth_helper.php';

// ۱. بررسی لاگین بودن کاربر
requireLogin();

// ۲. جلوگیری از کش
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");

$apiToken = getAccessToken();

// ۳. دریافت لیست فاکتورها از سرور
$apiOrders = apiCall('orders');
$orders = (!empty($apiOrders) && is_array($apiOrders)) ? $apiOrders : [];
?>
<!DOCTYPE html>
<html dir="rtl" lang="fa">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>حسابچین — تاریخچه و اصلاح فاکتورها</title>

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">
    <link rel="stylesheet" href="./css/orders.css?v=<?php echo time(); ?>">
    <link rel="stylesheet" href="./css/payment.css?v=<?php echo time(); ?>">
</head>

<body>
    <div class="app" id="app">

        <!-- هدر صفحه سفارشات -->
        <header class="orders-header">
            <div class="header-title-box">
                <h1>مدیریت و اصلاح فاکتورها</h1>
                <span class="header-sub">مشاهده، چاپ مجدد و تغییر روش تسویه</span>
            </div>

            <a href="dashboard.php" class="back-btn" aria-label="بازگشت به داشبورد">
                <span class="material-symbols-outlined">arrow_forward</span>
            </a>
        </header>

        <!-- محتوای اصلی صفحه سفارشات -->
        <main class="orders-content">

            <!-- جستجو -->
            <div class="orders-search-box">
                <div class="search-input-wrap">
                    <span class="material-symbols-outlined">search</span>
                    <input type="text" id="orderSearchInput" placeholder="جستجوی نام مشتری یا شماره فاکتور..." oninput="filterOrdersList()">
                </div>
            </div>

            <!-- لیست فاکتورها -->
            <section class="orders-list" id="ordersListContainer">
                <?php if (!empty($orders)): ?>
                    <?php foreach ($orders as $ord):
                        $ordId = $ord['id'];
                        $invNo = substr($ordId, 0, 8);
                        $custName = $ord['customer']['name'] ?? 'مشتری';
                        $subtotal = (float)($ord['subtotalAmount'] ?? 0);
                        $discount = (float)($ord['totalDiscountAmount'] ?? 0);
                        $finalAmount = (float)($ord['finalAmount'] ?? 0);
                        $orderDate = $ord['orderDate'] ?? '';

                        // تفکیک پرداخت‌ها
                        $payTags = [];
                        $paidSum = 0;
                        if (!empty($ord['payments'])) {
                            foreach ($ord['payments'] as $p) {
                                $amt = (float)($p['amount'] ?? 0);
                                $paidSum += $amt;
                                $m = $p['method'] ?? 'CASH';
                                if ($m === 'CASH') $payTags[] = '<span class="pay-tag cash">نقد: ' . toPersianNum(number_format($amt)) . ' ت</span>';
                                if ($m === 'CARD') $payTags[] = '<span class="pay-tag pos">پوز: ' . toPersianNum(number_format($amt)) . ' ت</span>';
                                if ($m === 'CHECK') $payTags[] = '<span class="pay-tag check">چک: ' . toPersianNum(number_format($amt)) . ' ت</span>';
                            }
                        }
                        $remainingCredit = max(0, $finalAmount - $paidSum);
                        if ($remainingCredit > 0) {
                            $payTags[] = '<span class="pay-tag credit">نسیه: ' . toPersianNum(number_format($remainingCredit)) . ' ت</span>';
                        }
                    ?>
                        <article class="order-card"
                                 id="orderCard_<?php echo $ordId; ?>"
                                 data-id="<?php echo $ordId; ?>"
                                 data-customer="<?php echo htmlspecialchars($custName); ?>"
                                 data-inv="<?php echo htmlspecialchars($invNo); ?>"
                                 data-final="<?php echo $finalAmount; ?>"
                                 data-subtotal="<?php echo $subtotal; ?>"
                                 data-discount="<?php echo $discount; ?>">

                            <div class="order-card-header">
                                <div class="order-cust-info">
                                    <div class="order-cust-avatar">
                                        <span class="material-symbols-outlined">storefront</span>
                                    </div>
                                    <div>
                                        <strong class="order-cust-name"><?php echo htmlspecialchars($custName); ?></strong>
                                        <div style="font-size: 10.5px; color: var(--text-muted);">
                                            <?php echo toPersianNum(date('Y/m/d H:i', strtotime($orderDate ?: 'now'))); ?>
                                        </div>
                                    </div>
                                </div>
                                <span class="order-invoice-num">#<?php echo toPersianNum($invNo); ?></span>
                            </div>

                            <div class="order-meta-grid">
                                <div class="order-meta-row">
                                    <span>جمع ناخالص:</span>
                                    <span><?php echo toPersianNum(number_format($subtotal)); ?> ت</span>
                                </div>
                                <?php if ($discount > 0): ?>
                                    <div class="order-meta-row" style="color: #ea580c;">
                                        <span>تخفیف:</span>
                                        <span>-<?php echo toPersianNum(number_format($discount)); ?> ت</span>
                                    </div>
                                <?php endif; ?>
                                <div class="order-meta-row highlight">
                                    <span>مبلغ نهایی فاکتور:</span>
                                    <strong><?php echo toPersianNum(number_format($finalAmount)); ?> تومان</strong>
                                </div>
                            </div>

                            <!-- وضعیت تسویه -->
                            <div class="order-payments-tags">
                                <?php echo implode('', $payTags); ?>
                            </div>

                            <!-- دکمه‌های اقدام -->
                            <div class="order-actions-row">
                                <button type="button" class="order-action-btn edit-pay" onclick="openEditPaymentsModal('<?php echo $ordId; ?>', '<?php echo htmlspecialchars(addslashes($custName)); ?>', <?php echo $finalAmount; ?>)">
                                    <span class="material-symbols-outlined" style="font-size: 16px;">edit_note</span>
                                    <span>اصلاح تسویه</span>
                                </button>
                                <button type="button" class="order-action-btn reprint" onclick="fetchAndPrintInvoice('<?php echo $ordId; ?>')">
                                    <span class="material-symbols-outlined" style="font-size: 16px;">print</span>
                                    <span>چاپ فاکتور</span>
                                </button>
                            </div>
                        </article>
                    <?php endforeach; ?>
                <?php else: ?>
                    <div style="text-align: center; padding: 40px 16px; color: var(--text-muted); font-size: 13px; background: var(--surface); border-radius: 18px; border: 1.5px dashed var(--border);">
                        <span class="material-symbols-outlined" style="font-size: 40px; color: var(--text-muted); margin-bottom: 6px;">receipt_long</span>
                        <div>هنوز هیچ فاکتوری صادر نشده است.</div>
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
            <a href="van-loading.php" class="nav-item">
                <span class="material-symbols-outlined">local_shipping</span>
                <span>بارگیری خودرو</span>
            </a>
            <a href="orders.php" class="nav-item active">
                <span class="material-symbols-outlined icon-fill">receipt_long</span>
                <span>سفارشات</span>
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

        <!-- مدال اصلاح و تغییر روش تسویه فاکتور -->
        <div class="modal-overlay" id="editPaymentsModal" onclick="if(event.target === this) closeEditPaymentsModal()">
            <div class="edit-pay-sheet">
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 10px;">
                    <div>
                        <h3 style="font-size: 15px; font-weight: 800; margin: 0;">اصلاح و تغییر روش تسویه فاکتور</h3>
                        <span id="editCustSubtitle" style="font-size: 11px; color: var(--primary); font-weight: 700;"></span>
                    </div>
                    <button type="button" style="background:none; border:none; cursor:pointer;" onclick="closeEditPaymentsModal()">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div style="background: var(--app-background); padding: 10px 12px; border-radius: 12px; display: flex; justify-content: space-between; font-size: 13px; font-weight: 800;">
                    <span>مبلغ نهایی فاکتور:</span>
                    <strong id="editFinalAmountDisplay" style="color: var(--primary);">۰ تومان</strong>
                </div>

                <!-- روش‌های پرداخت -->
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <!-- نقد -->
                    <div style="display: flex; flex-direction: column; gap: 3px;">
                        <label style="font-size: 11px; font-weight: 700; color: #16a34a;">پرداخت نقدی (تومان):</label>
                        <input type="text" id="editCashInput" class="pay-amount-input" oninput="onEditSplitChanged()">
                    </div>

                    <!-- پوز -->
                    <div style="display: flex; flex-direction: column; gap: 3px;">
                        <label style="font-size: 11px; font-weight: 700; color: #2563eb;">کارتخوان / پوز (تومان):</label>
                        <input type="text" id="editPosInput" class="pay-amount-input" oninput="onEditSplitChanged()">
                    </div>

                    <!-- چک -->
                    <div style="display: flex; flex-direction: column; gap: 3px;">
                        <label style="font-size: 11px; font-weight: 700; color: #d97706;">چک صیادی (تومان):</label>
                        <input type="text" id="editCheckInput" class="pay-amount-input" oninput="onEditSplitChanged()">
                    </div>

                    <!-- اطلاعات چک در صورت وارد کردن مبلغ -->
                    <div id="editCheckInfoBox" style="display: none; flex-direction: column; gap: 6px; background: #fffbeb; padding: 8px; border-radius: 8px; border: 1px solid #fef3c7;">
                        <input type="text" id="editCheckNumber" placeholder="شماره / شناسه چک صیادی..." style="height: 36px; border-radius: 6px; border: 1px solid var(--border); padding: 0 8px; font-family: inherit; font-size: 11.5px;">
                        <input type="text" id="editCheckBank" placeholder="نام بانک صادرکننده..." style="height: 36px; border-radius: 6px; border: 1px solid var(--border); padding: 0 8px; font-family: inherit; font-size: 11.5px;">
                    </div>

                    <!-- مانده نسیه دفتری -->
                    <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 800; padding: 6px 0; color: #ea580c;">
                        <span>مانده در دفتر حساب (نسیه):</span>
                        <strong id="editCreditRemaining">۰ تومان</strong>
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px;">
                    <button type="button" class="submit-order-btn" style="height: 44px; font-size: 13.5px;" onclick="saveEditedPayments()">
                        <span class="material-symbols-outlined">save</span>
                        <span>ثبت تغییرات تسویه و به‌روزرسانی دفتر حساب</span>
                    </button>
                    <button type="button" class="confirm-cancel-btn" style="height: 38px;" onclick="closeEditPaymentsModal()">
                        انصراف
                    </button>
                </div>
            </div>
        </div>

        <!-- مدال پرینت فاکتور حرارتی ۸۰ میلی‌متری -->
        <div class="invoice-modal-overlay" id="invoiceModal">
            <div class="thermal-invoice-container">
                <div class="thermal-invoice-header">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="material-symbols-outlined">receipt</span>
                        <h3 style="font-size: 15px; margin: 0;">فاکتور فروش (چاپ مجدد)</h3>
                    </div>
                    <button type="button" style="background:none; border:none; color:#fff; cursor:pointer;" onclick="closeThermalReceiptModal()">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div class="thermal-receipt-paper" id="thermalReceiptPaper"></div>

                <div class="thermal-modal-actions">
                    <button type="button" class="print-receipt-btn" onclick="window.print()">
                        <span class="material-symbols-outlined">print</span>
                        <span>چاپ فاکتور حرارتی (۸۰mm)</span>
                    </button>
                    <button type="button" class="close-receipt-btn" onclick="closeThermalReceiptModal()">
                        <span>بستن پنجره چاپ</span>
                    </button>
                </div>
            </div>
        </div>

    </div>

    <script>
        const API_TOKEN = '<?php echo $apiToken; ?>';
    </script>
    <script src="./js/orders.js?v=<?php echo time(); ?>"></script>
</body>

</html>
