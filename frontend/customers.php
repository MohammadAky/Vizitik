<?php
require_once 'auth_helper.php';

// ۱. بررسی لاگین بودن کاربر
requireLogin();

// ۲. جلوگیری از کش شدن صفحه در مرورگر
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");

// ۳. دریافت لیست مشتریان ویزیتور از API بک‌اند
$apiCustomers = apiCall('customers');
$customers = (!empty($apiCustomers) && is_array($apiCustomers)) ? $apiCustomers : [];

// محاسبه مجموع کل مطالبات بازار
$totalMarketDebt = 0;
foreach ($customers as $c) {
    $debt = (float)($c['currentDebt'] ?? 0);
    if ($debt > 0) {
        $totalMarketDebt += $debt;
    }
}
?>
<!DOCTYPE html>
<html dir="rtl" lang="fa">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>ویزیتیک — مشتریان و فروشگاه‌ها</title>

    <link rel="stylesheet" href="./fonts/vazirmatn/vazirmatn.css">
    <link rel="stylesheet" href="./fonts/material-symbols/material-symbols.css" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">
    <link rel="stylesheet" href="./css/customers.css?v=<?php echo time(); ?>">
</head>

<body>
    <div class="app" id="app">

        <!-- هدر صفحه مشتریان -->
        <header class="customers-header">
            <div class="header-top-row">
                <div class="header-title-box">
                    <h1>لیست مشتریان و فروشگاه‌ها</h1>
                    <span class="header-sub" id="totalCustomersCount"><?php echo toPersianNum(count($customers)); ?> فروشگاه فعال</span>
                </div>

                <div class="header-left-tools">
                    <!-- نشانگر طلب کل بازار -->
                    <div class="header-stat-badge">
                        <span class="material-symbols-outlined">payments</span>
                        <span id="totalDebtAmount"><?php echo toPersianNum(number_format($totalMarketDebt)); ?> تومان مانده بازار</span>
                    </div>

                    <a href="dashboard.php" class="back-btn" aria-label="بازگشت به داشبورد">
                        <span class="material-symbols-outlined">arrow_forward</span>
                    </a>
                </div>
            </div>

            <!-- نوار جستجوی سریع هوشمند -->
            <div class="search-box">
                <span class="material-symbols-outlined search-icon">search</span>
                <input type="text" id="customerSearchInput" placeholder="جستجوی نام فروشگاه، آدرس، تلفن، یادداشت..." oninput="filterCustomers()">
                <button id="clearSearchBtn" class="clear-search-btn" onclick="clearSearch()" style="display: none;">
                    <span class="material-symbols-outlined">cancel</span>
                </button>
            </div>

            <!-- ردیف چیپ‌های فیلتر سریع وضعیت -->
            <div class="chips-scroll-container">
                <span class="chips-label">فیلتر:</span>
                <div class="chips-track" id="filterChipsTrack">
                    <button type="button" class="filter-chip active" data-filter="ALL" onclick="selectFilter(this, 'ALL')">همه</button>
                    <button type="button" class="filter-chip debtor-chip" data-filter="DEBTORS" onclick="selectFilter(this, 'DEBTORS')">
                        <span class="material-symbols-outlined" style="font-size:15px;">priority_high</span>
                        <span>فقط بدهکاران</span>
                    </button>
                    <button type="button" class="filter-chip settled-chip" data-filter="SETTLED" onclick="selectFilter(this, 'SETTLED')">
                        <span class="material-symbols-outlined" style="font-size:15px;">check_circle</span>
                        <span>تسویه‌شده‌ها</span>
                    </button>
                </div>
            </div>
        </header>

        <!-- محتوای اصلی و کارت‌های مشتریان -->
        <main class="customers-content" id="customersList">
            <?php if (empty($customers)): ?>
                <div class="empty-box" id="emptyCustomerBox">
                    <span class="material-symbols-outlined">person_add</span>
                    <h3>هنوز مشتری‌ای ثبت نشده است</h3>
                    <p>برای شروع ثبت فاکتور، با دکمه زیر اولین مشتری خود را اضافه کنید.</p>
                    <button type="button" class="submit-btn" style="padding: 0 20px;" onclick="openAddCustomerModal()">
                        افزودن اولین مشتری
                    </button>
                </div>
            <?php else: ?>
                <?php foreach ($customers as $c): ?>
                    <?php
                    $cId = $c['id'];
                    $cName = $c['name'] ?? 'مشتری بدون نام';
                    $cAddress = $c['address'] ?? 'آدرس ثبت نشده';
                    $cPhone = $c['phone'] ?? '';
                    $cNotes = $c['notes'] ?? '';
                    $debt = (float)($c['currentDebt'] ?? 0);
                    $hasDebt = $debt > 0;
                    $isSettled = $debt == 0;
                    $lastOrderDate = !empty($c['lastOrderDate']) ? date('Y/m/d', strtotime($c['lastOrderDate'])) : 'بدون سفارش';
                    ?>
                    <article class="customer-card"
                        data-id="<?php echo htmlspecialchars($cId); ?>"
                        data-name="<?php echo htmlspecialchars($cName); ?>"
                        data-address="<?php echo htmlspecialchars($cAddress); ?>"
                        data-phone="<?php echo htmlspecialchars($cPhone); ?>"
                        data-notes="<?php echo htmlspecialchars($cNotes); ?>"
                        data-debt="<?php echo $debt; ?>"
                        onclick="openCustomerSheet('<?php echo htmlspecialchars($cId); ?>')">

                        <div class="customer-card-header">
                            <div class="customer-main-info">
                                <div class="customer-avatar <?php echo $hasDebt ? 'has-debt' : ($isSettled ? 'is-settled' : ''); ?>">
                                    <span class="material-symbols-outlined">storefront</span>
                                </div>
                                <div class="customer-titles">
                                    <h2 class="customer-shop-name"><?php echo htmlspecialchars($cName); ?></h2>
                                    <span class="customer-owner-name"><?php echo !empty($cNotes) ? htmlspecialchars($cNotes) : (!empty($cPhone) ? htmlspecialchars($cPhone) : 'مشتری تحت پوشش'); ?></span>
                                </div>
                            </div>

                            <div class="balance-badge <?php echo $hasDebt ? 'debtor' : 'settled'; ?>">
                                <span class="balance-title"><?php echo $hasDebt ? 'بدهکار' : 'تسویه شده'; ?></span>
                                <strong class="balance-amount">
                                    <?php echo $hasDebt ? toPersianNum(number_format($debt)) . ' ت' : '۰ تومان'; ?>
                                </strong>
                            </div>
                        </div>

                        <div class="customer-card-bottom">
                            <div class="customer-address-sub">
                                <span class="material-symbols-outlined">location_on</span>
                                <span><?php echo htmlspecialchars($cAddress); ?></span>
                            </div>

                            <div class="quick-tools-row" onclick="event.stopPropagation()">
                                <?php if (!empty($cPhone)): ?>
                                    <a href="tel:<?php echo htmlspecialchars($cPhone); ?>" class="mini-icon-btn call-btn" title="تماس سریع">
                                        <span class="material-symbols-outlined" style="font-size:16px;">call</span>
                                    </a>
                                <?php endif; ?>
                                <?php if (!empty($cAddress) && $cAddress !== 'آدرس ثبت نشده'): ?>
                                    <a href="https://maps.google.com/?q=<?php echo urlencode($cAddress); ?>" target="_blank" class="mini-icon-btn map-btn" title="مسیریابی">
                                        <span class="material-symbols-outlined" style="font-size:16px;">near_me</span>
                                    </a>
                                <?php endif; ?>
                            </div>
                        </div>
                    </article>
                <?php endforeach; ?>
            <?php endif; ?>

            <!-- باکس در صورت عدم یافتن در جستجو -->
            <div id="noCustomerFound" class="empty-box" style="display: none;">
                <span class="material-symbols-outlined">search_off</span>
                <h3>مشتری‌ای با این مشخصات یافت نشد</h3>
                <p>عبارت جستجو یا فیلتر را تغییر دهید.</p>
                <button type="button" class="submit-btn" style="padding:0 18px; font-size:12px;" onclick="resetFilters()">
                    نمایش همه مشتریان
                </button>
            </div>
        </main>

        <!-- دکمه شناور ثبت مشتری جدید (FAB) -->
        <button type="button" class="fab-add-customer" onclick="openAddCustomerModal()">
            <span class="material-symbols-outlined">person_add</span>
            <span>مشتری جدید</span>
        </button>

        <!-- ============================================================
             مودال پرونده سریع مشتری (با لمس هر کارت باز می‌شود)
        ============================================================ -->
        <div class="modal-overlay" id="customerSheetModal" style="display: none;">
            <div class="modal-card">
                <div class="modal-header">
                    <div class="modal-shop-heading">
                        <h3 id="sheetShopName">نام سوپرمارکت</h3>
                        <span id="sheetOwnerMeta">تلفن و یادداشت</span>
                    </div>
                    <button class="modal-close" onclick="closeCustomerSheet()">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>

                <!-- بنر وضعیت مانده بدهی مشتری -->
                <div class="modal-balance-banner" id="sheetBalanceBanner">
                    <div class="banner-right">
                        <span class="material-symbols-outlined">account_balance_wallet</span>
                        <span id="sheetBalanceStatusLabel">مانده بدهی قبلی فروشگاه:</span>
                    </div>
                    <div class="banner-left">
                        <strong class="banner-amount" id="sheetBalanceAmount">۰ تومان</strong>
                    </div>
                </div>

                <!-- دکمه اصلی و بزرگ: صدور فاکتور جدید برای این مشتری -->
                <button type="button" class="primary-invoice-cta" id="sheetInvoiceBtn" onclick="triggerInvoiceForCurrentCustomer()">
                    <span class="material-symbols-outlined">shopping_cart_checkout</span>
                    <span>صدور فاکتور جدید برای این مشتری</span>
                </button>

                <!-- بخش ۵ خرید و فاکتور اخیر مشتری -->
                <div class="recent-purchases-section">
                    <div class="recent-purchases-header">
                        <strong>
                            <span class="material-symbols-outlined" style="font-size:16px;">history</span>
                            <span>سوابق و ۵ خرید اخیر:</span>
                        </strong>
                        <button type="button" class="view-all-ledger-link" onclick="showFullLedger()">
                            مشاهده کل کاردکس
                        </button>
                    </div>

                    <div class="recent-orders-list" id="sheetRecentOrdersList">
                        <p style="text-align:center; color:var(--text-muted); font-size:11px; padding:10px 0;">در حال دریافت سوابق...</p>
                    </div>
                </div>

                <!-- ردیف دکمه‌های کمکی: ویرایش مشخصات -->
                <div class="modal-secondary-actions">
                    <button type="button" class="sec-btn edit-btn" onclick="openEditCustomerModal()">
                        <span class="material-symbols-outlined" style="font-size:16px;">edit</span>
                        <span>ویرایش مشخصات و آدرس</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- ============================================================
             مودال فرم ثبت / ویرایش مشتری
        ============================================================ -->
        <div class="modal-overlay" id="customerFormModal" style="display: none;">
            <div class="modal-card">
                <div class="modal-header">
                    <h3 id="formModalTitle">ثبت مشتری و فروشگاه جدید</h3>
                    <button class="modal-close" onclick="closeCustomerFormModal()">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <form class="modal-form" id="customerForm" onsubmit="handleSaveCustomerForm(event)">
                    <input type="hidden" id="editCustId" value="">

                    <div class="input-group">
                        <label>نام فروشگاه / سوپرمارکت <span class="req">*</span></label>
                        <input type="text" id="custNameInput" placeholder="مثال: هایپرمارکت ستاره" required>
                    </div>

                    <div class="input-row">
                        <div class="input-group">
                            <label>شماره تماس / موبایل <span class="req">*</span></label>
                            <input type="tel" id="custPhoneInput" placeholder="مثال: 09121234567" required>
                        </div>
                        <div class="input-group" id="custDebtGroup">
                            <label>مانده بدهی اول‌دوره (تومان)</label>
                            <input type="number" id="custDebtInput" placeholder="0" min="0">
                        </div>
                    </div>

                    <div class="input-group">
                        <label>یادداشت / نام صاحب مغازه</label>
                        <input type="text" id="custNotesInput" placeholder="مثال: حاج رضا - تحویل بار قبل ظهر">
                    </div>

                    <div class="input-group">
                        <label>آدرس دقیق فروشگاه</label>
                        <textarea id="custAddressInput" placeholder="خیابان، کوچه، پلاک..."></textarea>
                    </div>

                    <button type="submit" class="submit-btn" id="formSubmitBtn">ثبت و ذخیره مشتری</button>

                    <button type="button" class="modal-delete-btn" id="formDeleteBtn" onclick="handleDeleteCustomer()" style="display: none;">
                        <span class="material-symbols-outlined">delete</span>
                        <span>حذف این مشتری از سیستم</span>
                    </button>
                </form>
            </div>
        </div>

        <!-- نوار ناوبری پایینی
        <nav class="app-nav">
            <a href="dashboard.php" class="nav-item">
                <span class="material-symbols-outlined">dashboard</span>
                <span>داشبورد</span>
            </a>
            <a href="orders.php" class="nav-item">
                <span class="material-symbols-outlined">receipt_long</span>
                <span>سفارشات</span>
            </a>
            <a href="customers.php" class="nav-item active" title="پرونده مشتریان" aria-label="مشتریان">
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
        </nav> -->

    </div>

    <script>
        const API_TOKEN = '<?php echo getAccessToken(); ?>';
    </script>
    <script src="./js/customers.js?v=<?php echo time(); ?>"></script>
</body>

</html>