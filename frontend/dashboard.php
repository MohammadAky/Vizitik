<?php
require_once 'auth_helper.php';

// ۱. بررسی احراز هویت و لاگین بودن کاربر
requireLogin();

// ۲. دریافت اطلاعات کاربر لاگین‌شده از سشن
$user = getUserData();
$userfName = htmlspecialchars($user["firstName"] ?? "کاربر گرامی");
$userlName = htmlspecialchars($user["lastName"] ?? "");

// ۳. جلوگیری از کش شدن صفحه در مرورگر
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");

// ۴. فراخوانی آمار زنده داشبورد از API بک‌اند
$apiStats = apiCall('reports/dashboard');

$salesToday = $apiStats['todaySales'] ?? 0;
$cashCollect = $apiStats['todayCollectedCash'] ?? 0;

$stats = [
    'sales_today'  => formatToman($salesToday),
    'cash_collect' => formatToman($cashCollect),
];

// ۵. فراخوانی سفارشات اخیر از API بک‌اند
$apiOrders = apiCall('orders');
$orders = [];

if (is_array($apiOrders) && !empty($apiOrders)) {
    // نمایش تا ۵ سفارش آخر
    $recentItems = array_slice($apiOrders, 0, 5);
    foreach ($recentItems as $ord) {
        $storeName = $ord['customer']['name'] ?? 'مشتری ناشناس';

        $orderDate = $ord['orderDate'] ?? '';
        $timeStr = !empty($orderDate) ? date('H:i', strtotime($orderDate)) : 'امروز';
        $timePersian = toPersianNum($timeStr);

        $finalAmount = (float)($ord['finalAmount'] ?? 0);
        $paidSum = 0;
        if (!empty($ord['payments']) && is_array($ord['payments'])) {
            foreach ($ord['payments'] as $p) {
                $paidSum += (float)($p['amount'] ?? 0);
            }
        }
        $remainingCredit = max(0, $finalAmount - $paidSum);

        if ($remainingCredit <= 0) {
            $status = 'success';
            $statusText = 'تسویه شد';
        } elseif ($paidSum > 0) {
            $status = 'warning';
            $statusText = 'مانده نسیه: ' . toPersianNum(number_format($remainingCredit)) . ' ت';
        } else {
            $status = 'danger';
            $statusText = 'نسیه کامل';
        }

        $orders[] = [
            'id'         => $ord['id'] ?? '',
            'title'      => $storeName,
            'time'       => $timePersian,
            'amount'     => toPersianNum(number_format($finalAmount)),
            'status'     => $status,
            'statusText' => $statusText,
        ];
    }
}
?>
<!DOCTYPE html>
<html dir="rtl" lang="fa">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>ویزیتیک — داشبورد ویزیتور</title>

    <link rel="stylesheet" href="./fonts/vazirmatn/vazirmatn.css">
    <link rel="stylesheet" href="./fonts/material-symbols/material-symbols.css" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">
</head>

<body>
    <div class="app" id="app">

        <!-- منوی کشویی جانبی (Side Menu Drawer) -->
        <div class="menu-overlay" id="menuOverlay"></div>

        <aside class="side-menu" id="sideMenu">
            <div class="side-menu-header">
                <div class="avatar">
                    <span class="material-symbols-outlined">person</span>
                </div>
                <div class="side-menu-user-details">
                    <div class="side-menu-name"><?php echo $userfName . ' ' . $userlName; ?></div>
                    <div class="side-menu-role">مسئول توزیع و ویزیتور</div>
                </div>
                <button class="side-menu-close" id="sideMenuClose" aria-label="بستن منو">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>

            <nav class="side-menu-list">
                <a href="orders.php" class="side-menu-item">
                    <span class="material-symbols-outlined">receipt_long</span>
                    مدیریت و اصلاح فاکتورها
                </a>
                <a href="bale-bot.php" class="side-menu-item">
                    <span class="material-symbols-outlined">smart_toy</span>
                    مدیریت ربات بله
                </a>
                <a href="settings.php" class="side-menu-item">
                    <span class="material-symbols-outlined">settings</span>
                    تنظیمات
                </a>
                <a href="help.php" class="side-menu-item">
                    <span class="material-symbols-outlined">help</span>
                    راهنما و پشتیبانی
                </a>
                <a href="about.php" class="side-menu-item">
                    <span class="material-symbols-outlined">info</span>
                    درباره ویزیتیک
                </a>
            </nav>

            <div class="side-menu-footer">
                <a href="logout.php" class="side-menu-logout">
                    <span class="material-symbols-outlined">logout</span>
                    خروج از حساب کاربری
                </a>
            </div>
        </aside>

        <!-- هدر بالای صفحه -->
        <header class="app-header animate-item">
            <div class="user-profile">
                <div class="avatar">
                    <span class="material-symbols-outlined">person</span>
                </div>
                <div class="user-info">
                    <span class="user-name">سلام، <?php echo $userfName; ?></span>
                    <span class="user-status"><span class="dot"></span> برخط (Sync آنلاین)</span>
                </div>
            </div>

            <button class="menu-toggle-btn" id="menuToggleBtn" aria-label="باز کردن منو"
                aria-expanded="false" aria-controls="sideMenu">
                <span class="material-symbols-outlined">menu</span>
            </button>
        </header>

        <!-- محتوای اصلی داشبورد -->
        <main class="dashboard-content">

            <!-- کارت‌های آمار فروش و نقدینگی -->
            <section class="stat-grid">
                <div class="stat-card animate-item">
                    <span class="label">فروش امروز</span>
                    <span class="value skeleton-text skeleton-lg"
                        data-value="<?php echo htmlspecialchars($stats['sales_today']['value']); ?>"
                        data-suffix="<?php echo htmlspecialchars($stats['sales_today']['suffix']); ?>"></span>
                </div>
                <div class="stat-card cash animate-item">
                    <span class="label">وصولی نقد و پوز</span>
                    <span class="value skeleton-text skeleton-lg"
                        data-value="<?php echo htmlspecialchars($stats['cash_collect']['value']); ?>"
                        data-suffix="<?php echo htmlspecialchars($stats['cash_collect']['suffix']); ?>"></span>
                </div>
            </section>

            <!-- دکمه‌های دسترسی سریع (بدون گزینه‌های تکراری و به همراه مدیریت ربات بله کنار کالا) -->
            <section class="quick-actions">
                <a href="products.php" class="action-btn animate-item">
                    <div class="action-icon danger">
                        <span class="material-symbols-outlined icon-fill">inventory_2</span>
                    </div>
                    <span>لیست کالاها</span>
                </a>
                <a href="bale-bot.php" class="action-btn animate-item">
                    <div class="action-icon" style="background: #f0fdf4; color: #16a34a;">
                        <span class="material-symbols-outlined icon-fill">smart_toy</span>
                    </div>
                    <span>مدیریت ربات بله</span>
                </a>

            </section>

            <!-- لیست سفارشات اخیر -->
            <section>
                <div class="section-header animate-item">
                    <h2>سفارشات اخیر امروز</h2>
                    <a href="orders.php">مشاهده همه</a>
                </div>

                <div class="order-list" id="orderList">
                    <?php if (!empty($orders)): ?>
                        <?php foreach ($orders as $i => $order): ?>
                            <article class="order-item" style="animation-delay: <?php echo $i * 0.08; ?>s">
                                <div class="order-info">
                                    <div class="store-icon">
                                        <span class="material-symbols-outlined">storefront</span>
                                    </div>
                                    <div>
                                        <div class="order-title skeleton-text skeleton-md"
                                            data-value="<?php echo htmlspecialchars($order['title']); ?>"></div>
                                        <div class="order-date skeleton-text skeleton-sm"
                                            data-value="<?php echo htmlspecialchars($order['time']); ?>"></div>
                                    </div>
                                </div>
                                <span class="badge <?php echo $order['status']; ?> skeleton-badge"
                                    data-value="<?php echo htmlspecialchars($order['statusText']); ?>"></span>
                            </article>
                        <?php endforeach; ?>
                    <?php else: ?>
                        <div class="empty-orders-box animate-item">
                            <span class="material-symbols-outlined">receipt_long</span>
                            <p>هنوز سفارشی برای امروز ثبت نشده است</p>
                            <a href="new-order.php" class="empty-action-link">ثبت اولین سفارش</a>
                        </div>
                    <?php endif; ?>
                </div>
            </section>

        </main>

        <!-- دکمه شناور ثبت فاکتور جدید -->
        <a href="new-order.php" class="new-invoice-btn" id="newInvoiceBtn">
            <span class="material-symbols-outlined">add_circle</span>
            ثبت فاکتور جدید
        </a>

        <!-- نوار ناوبری پایینی -->
        <nav class="app-nav animate-item">
            <a href="dashboard.php" class="nav-item active">
                <span class="material-symbols-outlined icon-fill">dashboard</span>
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
            <a href="orders.php" class="nav-item">
                <span class="material-symbols-outlined">receipt_long</span>
                <span>سفارشات</span>
            </a>
            <a href="collections.php" class="nav-item">
                <span class="material-symbols-outlined">payments</span>
                <span>وصول مطالبات</span>
            </a>
        </nav>
    </div>

    <script src="./js/dashboard.js"></script>
</body>

</html>