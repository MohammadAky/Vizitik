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

// ۴. دریافت کاتالوگ محصولات جهت امکان افزودن کالای جدید هنگام ویرایش
$apiProducts = apiCall('products');
$productsCatalog = (!empty($apiProducts) && is_array($apiProducts)) ? $apiProducts : [];
?>
<!DOCTYPE html>
<html dir="rtl" lang="fa">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>ویزیتیک — مدیریت و ویرایش جامع فاکتورها</title>

    <link rel="stylesheet" href="./fonts/vazirmatn/vazirmatn.css">
    <link rel="stylesheet" href="./fonts/material-symbols/material-symbols.css" />
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
                <span class="header-sub">ویرایش تعداد کارتن/دانه، تخفیف، تسویه و چاپ</span>
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
                        $invNo = $ord['invoiceNumber'] ?? substr($ordId, 0, 8);
                        $invDigits = preg_replace('/\D/', '', (string)$invNo);
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
                        if (($ord['status'] ?? '') === 'CANCELLED') {
                            $payTags[] = '<span class="pay-tag cancelled">✕ ابطال شده</span>';
                        }
                    ?>
                        <article class="order-card"
                            id="orderCard_<?php echo $ordId; ?>"
                            data-id="<?php echo $ordId; ?>"
                            data-customer="<?php echo htmlspecialchars($custName); ?>"
                            data-inv="<?php echo htmlspecialchars($invNo); ?>"
                            data-inv-digits="<?php echo htmlspecialchars($invDigits); ?>"
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
                                <span class="order-invoice-num">#<span class="invoice-num"><?php echo toPersianNum($invNo); ?></span></span>
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
                                <button type="button" class="order-action-btn edit-full" onclick="openFullEditOrderModal('<?php echo $ordId; ?>')">
                                    <span class="material-symbols-outlined" style="font-size: 16px;">edit_note</span>
                                    <span>ویرایش</span>
                                </button>
                                <button type="button" class="order-action-btn reprint" onclick="fetchAndPrintInvoice('<?php echo $ordId; ?>')">
                                    <span class="material-symbols-outlined" style="font-size: 16px;">print</span>
                                    <span>چاپ</span>
                                </button>
                                <button type="button" class="order-action-btn send-bale" onclick="sendOrderToBale('<?php echo $ordId; ?>')">
                                    <span class="material-symbols-outlined" style="font-size: 16px;">smart_toy</span>
                                    <span>بله</span>
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

            <a href="customers.php" class="nav-item" title="پرونده مشتریان" aria-label="مشتریان">
                <span class="material-symbols-outlined">group</span>
                <span>مشتریان</span>
            </a>
            <a href="orders.php" class="nav-item active">
                <span class="material-symbols-outlined icon-fill">receipt_long</span>
                <span>سفارشات</span>
            </a>
            <a href="collections.php" class="nav-item">
                <span class="material-symbols-outlined">payments</span>
                <span>وصول مطالبات</span>
            </a>
        </nav>

        <!-- مدال جامع ویرایش فاکتور (تعداد کارتن، دانه، افزودن/حذف، تخفیفات، تسویه) -->
        <div class="modal-overlay" id="editFullOrderModal" onclick="if(event.target === this) closeFullEditOrderModal()">
            <div class="edit-order-sheet">
                <!-- هدر مدال -->
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 8px;">
                    <div>
                        <h3 style="font-size: 15px; font-weight: 800; margin: 0; color: var(--primary);">ویرایش و اصلاح فاکتور</h3>
                        <span id="editFullOrderSubtitle" style="font-size: 11px; color: var(--text-muted);"></span>
                    </div>
                    <button type="button" style="background:none; border:none; cursor:pointer;" onclick="closeFullEditOrderModal()">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>

                <!-- ۱. بخش ویرایش اقلام و تعداد کالاها -->
                <div class="edit-section-card">
                    <div class="edit-section-title">
                        <span>📦 اقلام سفارش (تعداد کارتن و دانه)</span>
                    </div>

                    <div id="editOrderItemsList" style="display: flex; flex-direction: column; gap: 8px;">
                        <!-- اقلام به صورت داینامیک رندر می‌شوند -->
                    </div>

                    <!-- افزودن کالای جدید به فاکتور -->
                    <div style="border-top: 1px dashed var(--border); padding-top: 8px; display: flex; flex-direction: column; gap: 6px;">
                        <span style="font-size: 11px; font-weight: 700; color: var(--text-secondary);">+ افزودن کالا به این فاکتور:</span>
                        <div style="display: flex; gap: 6px;">
                            <select id="editAddProductSelect" class="add-product-dropdown">
                                <option value="">انتخاب محصول از کاتالوگ...</option>
                                <?php foreach ($productsCatalog as $p): ?>
                                    <option value="<?php echo $p['id']; ?>"
                                        data-name="<?php echo htmlspecialchars($p['name']); ?>"
                                        data-brand="<?php echo htmlspecialchars($p['brand'] ?? 'میهن'); ?>"
                                        data-units="<?php echo $p['unitsPerCartonDefault'] ?? 1; ?>"
                                        data-unitprice="<?php echo $p['baseUnitPrice'] ?? 0; ?>"
                                        data-cartonprice="<?php echo ($p['baseUnitPrice'] ?? 0) * ($p['unitsPerCartonDefault'] ?? 1); ?>">
                                        <?php echo htmlspecialchars($p['name']); ?> (<?php echo htmlspecialchars($p['brand'] ?? 'میهن'); ?>)
                                    </option>
                                <?php endforeach; ?>
                            </select>
                            <button type="button" class="login-btn" style="width: auto; height: 38px; padding: 0 12px; font-size: 12px;" onclick="addSelectedProductToEditOrder()">
                                افزودن
                            </button>
                        </div>
                    </div>
                </div>

                <!-- ۲. بخش تخفیفات پلکانی فاکتور -->
                <div class="edit-section-card">
                    <div class="edit-section-title">
                        <span>🎁 تخفیفات پلکانی فاکتور</span>
                    </div>

                    <div id="editDiscountStepsContainer" style="display: flex; flex-wrap: wrap; gap: 6px;">
                        <!-- چیپ‌های تخفیف رندر می‌شوند -->
                    </div>

                    <div style="display: flex; gap: 6px; align-items: center; margin-top: 4px;">
                        <input type="number" id="editNewDiscountPercent" placeholder="درصد تخفیف جدید (مثلاً ۳)" min="1" max="100" style="flex: 1; height: 36px; border-radius: 8px; border: 1px solid var(--border); padding: 0 8px; font-family: inherit; font-size: 11.5px;">
                        <button type="button" class="login-btn" style="width: auto; height: 36px; padding: 0 12px; font-size: 11.5px; background: #ea580c;" onclick="addDiscountStepToEditOrder()">
                            + پله تخفیف
                        </button>
                    </div>
                </div>

                <!-- ۳. خلاصه مالی و تسویه فاکتور -->
                <div class="edit-section-card">
                    <div class="edit-section-title">
                        <span>💳 خلاصه مالی و تسهیم تسویه</span>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 4px; font-size: 12px; border-bottom: 1px dashed var(--border); padding-bottom: 6px;">
                        <div style="display: flex; justify-content: space-between;">
                            <span>جمع ناخالص:</span>
                            <strong id="editGrossSubtotalDisplay">۰ ت</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; color: #ea580c;">
                            <span>مجموع تخفیفات:</span>
                            <strong id="editTotalDiscountDisplay">-۰ ت</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 13.5px; font-weight: 900; color: var(--primary); padding-top: 2px;">
                            <span>مبلغ نهایی فاکتور:</span>
                            <strong id="editNetFinalDisplay">۰ ت</strong>
                        </div>
                    </div>

                    <!-- روش‌های پرداخت -->
                    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <label style="font-size: 10.5px; font-weight: 700; color: #16a34a;">پرداخت نقدی (تومان):</label>
                            <input type="text" id="editFullCashInput" class="pay-amount-input" oninput="onFullEditCalculations()">
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <label style="font-size: 10.5px; font-weight: 700; color: #2563eb;">کارتخوان / پوز (تومان):</label>
                            <input type="text" id="editFullPosInput" class="pay-amount-input" oninput="onFullEditCalculations()">
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <label style="font-size: 10.5px; font-weight: 700; color: #d97706;">چک صیادی (تومان):</label>
                            <input type="text" id="editFullCheckInput" class="pay-amount-input" oninput="onFullEditCalculations()">
                        </div>

                        <div id="editFullCheckDetailsBox" style="display: none; flex-direction: column; gap: 4px; background: #fffbeb; padding: 6px; border-radius: 8px; border: 1px solid #fef3c7;">
                            <input type="text" id="editFullCheckNumber" placeholder="شناسه صیادی ۱۶ رقمی..." style="height: 34px; border-radius: 6px; border: 1px solid var(--border); padding: 0 8px; font-family: inherit; font-size: 11px;">
                            <input type="text" id="editFullCheckBank" placeholder="نام بانک صادرکننده..." style="height: 34px; border-radius: 6px; border: 1px solid var(--border); padding: 0 8px; font-family: inherit; font-size: 11px;">
                        </div>

                        <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 800; color: #ea580c; background: #fff7ed; padding: 6px 8px; border-radius: 8px;">
                            <span>مانده در دفتر حساب (نسیه):</span>
                            <strong id="editFullCreditRemaining">۰ ت</strong>
                        </div>
                    </div>
                </div>

                <!-- دکمه‌های اقدام نهایی -->
                <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
                    <button type="button" class="submit-order-btn" style="height: 44px; font-size: 13.5px;" id="saveFullOrderBtn" onclick="saveFullEditedOrder()">
                        <span class="material-symbols-outlined">save</span>
                        <span>ذخیره تغییرات فاکتور و اعمال در انبار و حساب</span>
                    </button>
                    <button type="button" class="confirm-cancel-btn" style="height: 36px;" onclick="closeFullEditOrderModal()">
                        انصراف
                    </button>
                </div>

                <!-- ابطال کامل فاکتور — وقتی مشتری کلا منصرف شده (JS بر اساس وضعیت فاکتور نمایش می‌دهد) -->
                <div id="cancelOrderBtnWrap" style="display: none; margin-top: 10px;">
                    <button type="button" class="modal-delete-btn" onclick="cancelCurrentOrder()">
                        <span class="material-symbols-outlined" style="font-size: 16px;">delete_forever</span>
                        <span>ابطال فاکتور و بازگشت کالاها به خودرو</span>
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
        const PRODUCTS_CATALOG = <?php echo json_encode($productsCatalog); ?>;
    </script>
    <script src="./js/orders.js?v=<?php echo time(); ?>"></script>
</body>

</html>