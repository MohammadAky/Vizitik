<?php
require_once 'auth_helper.php';

// ۱. بررسی لاگین بودن کاربر
requireLogin();

// ۲. جلوگیری از کش شدن صفحه
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");

// ۳. دریافت موجودی و محاسبات آماده از API بک‌اند
$apiData = apiCall('van-inventory');

$summary = $apiData['summary'] ?? [
    'totalCartons' => 0,
    'totalLooseUnits' => 0,
    'totalSingleUnits' => 0,
    'totalInventoryValue' => 0,
];

$inventory = $apiData['items'] ?? (is_array($apiData) ? $apiData : []);

// استخراج لیست یکتای برندها و دسته‌بندی‌ها
$brands = array_values(array_unique(array_filter(array_column($inventory, 'brand'))));
$categories = array_values(array_unique(array_filter(array_column($inventory, 'category'))));

$defaultCategories = ['چوبی', 'قیفی', 'لیوانی', 'یخی', 'کترینگ و خانواده', 'سنتی و حصیری'];
if (empty($categories)) {
    $categories = $defaultCategories;
}
?>
<!DOCTYPE html>
<html dir="rtl" lang="fa">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>حسابچین — بارگیری و تحویل بار خودرو</title>

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">
    <link rel="stylesheet" href="./css/van-loading.css?v=<?php echo time(); ?>">
</head>

<body>
    <div class="app" id="app">

        <!-- هدر صفحه بارگیری خودرو -->
        <header class="van-header">
            <div class="header-top-row">
                <div class="header-title-box">
                    <h1>بارگیری و موجودی خودرو</h1>
                    <span class="header-sub" id="headerSubSummary">
                        <?php echo toPersianNum($summary['totalCartons']); ?> کارتن و <?php echo toPersianNum($summary['totalLooseUnits']); ?> دانه در ماشین
                    </span>
                </div>

                <div style="display: flex; align-items: center; gap: 8px;">
                    <!-- دکمه فیلتر سریع: فقط اقلام دارای موجودی -->
                    <button type="button" class="header-filter-btn" id="toggleLoadedOnlyBtn" onclick="toggleLoadedOnlyFilter()" title="نمایش فقط اقلام بارگیری‌شده">
                        <span class="material-symbols-outlined">inventory</span>
                    </button>

                    <a href="dashboard.php" class="back-btn" aria-label="بازگشت به داشبورد">
                        <span class="material-symbols-outlined">arrow_forward</span>
                    </a>
                </div>
            </div>

            <!-- نوار جستجوی سریع -->
            <div class="search-box">
                <span class="material-symbols-outlined search-icon">search</span>
                <input type="text" id="searchInput" placeholder="جستجوی نام بستنی، برند یا دسته..." oninput="filterInventory()">
                <button id="clearSearchBtn" class="clear-search-btn" onclick="clearSearch()" style="display: none;">
                    <span class="material-symbols-outlined">cancel</span>
                </button>
            </div>

            <!-- ردیف ۱ فیلترها: برندها و کالاهای من -->
            <div class="chips-scroll-container">
                <span class="chips-label">برند:</span>
                <div class="chips-track" id="brandChipsTrack">
                    <button class="filter-chip active" data-brand="ALL" onclick="selectBrand(this, 'ALL')">همه کالاها</button>
                    
                    <button class="filter-chip my-products-chip" data-brand="MY_PRODUCTS" onclick="selectBrand(this, 'MY_PRODUCTS')">
                        <span class="material-symbols-outlined chip-icon">stars</span>
                        <span>کالاهای من</span>
                    </button>

                    <!-- چیپ نمایش فقط بارگیری‌شده‌ها -->
                    <button class="filter-chip loaded-filter-chip" id="loadedFilterChip" data-brand="LOADED_ONLY" onclick="selectBrand(this, 'LOADED_ONLY')">
                        <span class="material-symbols-outlined chip-icon">check_box</span>
                        <span>فقط بارگیری‌شده‌ها</span>
                    </button>

                    <?php foreach ($brands as $b): ?>
                        <button class="filter-chip" data-brand="<?php echo htmlspecialchars($b); ?>" onclick="selectBrand(this, '<?php echo htmlspecialchars($b); ?>')">
                            <?php echo htmlspecialchars($b); ?>
                        </button>
                    <?php endforeach; ?>
                </div>
            </div>

            <!-- ردیف ۲ فیلترها: دسته‌بندی‌ها -->
            <div class="chips-scroll-container">
                <span class="chips-label">دسته:</span>
                <div class="chips-track" id="categoryChipsTrack">
                    <button class="filter-chip active" data-category="ALL" onclick="selectCategory(this, 'ALL')">همه دسته‌ها</button>
                    <?php foreach ($categories as $c): ?>
                        <button class="filter-chip" data-category="<?php echo htmlspecialchars($c); ?>" onclick="selectCategory(this, '<?php echo htmlspecialchars($c); ?>')">
                            <?php echo htmlspecialchars($c); ?>
                        </button>
                    <?php endforeach; ?>
                </div>
            </div>
        </header>

        <!-- محتوای لیست کالاها و استپرهای بارگیری -->
        <main class="van-content" id="inventoryList">
            <?php if (empty($inventory)): ?>
                <div class="empty-inventory-state">
                    <div class="empty-icon-box">
                        <span class="material-symbols-outlined">local_shipping</span>
                    </div>
                    <h3>کالایی در سیستم یافت نشد</h3>
                    <p>ابتدا از بخش کاتالوگ کالاها، محصولات را به لیست خود اضافه کنید.</p>
                    <a href="products.php" class="empty-action-btn">
                        <span class="material-symbols-outlined">inventory_2</span>
                        <span>رفتن به کاتالوگ کالاها</span>
                    </a>
                </div>
            <?php else: ?>
                <?php foreach ($inventory as $i => $item): ?>
                    <?php
                        $prodId = $item['productId'] ?? ('p' . $i);
                        $prodName = $item['productName'] ?? '';
                        $brand = $item['brand'] ?? 'متفرقه';
                        $category = $item['category'] ?? 'سایر';
                        $packSize = (int)($item['unitsPerCarton'] ?? 24);
                        $cartonPrice = (float)($item['cartonPrice'] ?? 0);
                        $unitPrice = (float)($item['unitPrice'] ?? 0);
                        $cartons = (int)($item['quantityCartons'] ?? 0);
                        $units = (int)($item['quantityUnits'] ?? 0);
                        $totalSingleUnits = (int)($item['totalSingleUnits'] ?? (($cartons * $packSize) + $units));
                        $isCustom = !empty($item['isCustomUserProduct']);
                        $isGlobal = !empty($item['isGlobal']);
                        $isLoaded = ($cartons > 0 || $units > 0);
                    ?>
                    <article class="van-card <?php echo $isLoaded ? 'is-loaded' : ''; ?>"
                             data-id="<?php echo htmlspecialchars($prodId); ?>"
                             data-name="<?php echo htmlspecialchars($prodName); ?>"
                             data-brand="<?php echo htmlspecialchars($brand); ?>"
                             data-category="<?php echo htmlspecialchars($category); ?>"
                             data-pack="<?php echo $packSize; ?>"
                             data-cartonprice="<?php echo $cartonPrice; ?>"
                             data-unitprice="<?php echo $unitPrice; ?>"
                             data-iscustom="<?php echo $isCustom ? 'true' : 'false'; ?>"
                             data-isglobal="<?php echo $isGlobal ? 'true' : 'false'; ?>"
                             data-cartons="<?php echo $cartons; ?>"
                             data-units="<?php echo $units; ?>"
                             style="animation-delay: <?php echo min($i * 0.02, 0.4); ?>s">

                        <!-- ردیف بالای کارت: مشخصات و قیمت -->
                        <div class="van-card-top">
                            <div class="product-icon-wrap <?php echo $isCustom ? 'custom-wrap' : ''; ?>">
                                <span class="material-symbols-outlined"><?php echo $isCustom ? 'star' : 'icecream'; ?></span>
                            </div>

                            <div class="product-main-details">
                                <h2 class="product-item-title"><?php echo htmlspecialchars($prodName); ?></h2>
                                <div class="product-badges-row">
                                    <?php if ($isCustom): ?>
                                        <span class="badge-custom">⭐ کالای من</span>
                                    <?php endif; ?>
                                    <span class="badge-brand <?php echo getBrandClass($brand); ?>">
                                        <?php echo htmlspecialchars($brand); ?>
                                    </span>
                                    <span class="badge-pack">
                                        <?php echo toPersianNum($packSize); ?> عددی
                                    </span>
                                </div>
                            </div>

                            <div class="product-price-badge">
                                <span class="price-val"><?php echo toPersianNum(number_format($cartonPrice)); ?> <small>تومان</small></span>
                                <span class="price-unit-sub">دانه: <?php echo toPersianNum(number_format($unitPrice)); ?> ت</span>
                            </div>
                        </div>

                        <!-- ردیف استپرها (انتخابگرهای ۲ گانه کارتن و دانه) -->
                        <div class="steppers-grid">
                            <!-- ۱. استپر کارتن (📦 کارتن) -->
                            <div class="stepper-box carton-stepper">
                                <div class="stepper-label">
                                    <span class="material-symbols-outlined">inventory_2</span>
                                    <span>کارتن</span>
                                </div>
                                <div class="stepper-controls">
                                    <button type="button" class="step-btn step-down" onclick="changeQty('<?php echo $prodId; ?>', 'carton', -1)" aria-label="کاهش کارتن">
                                        <span class="material-symbols-outlined">remove</span>
                                    </button>
                                    <input type="number" 
                                           class="step-input carton-input" 
                                           id="carton_<?php echo $prodId; ?>" 
                                           value="<?php echo $cartons; ?>" 
                                           min="0" 
                                           oninput="handleQtyInput('<?php echo $prodId; ?>', 'carton', this.value)">
                                    <button type="button" class="step-btn step-up" onclick="changeQty('<?php echo $prodId; ?>', 'carton', 1)" aria-label="افزایش کارتن">
                                        <span class="material-symbols-outlined">add</span>
                                    </button>
                                </div>
                            </div>

                            <!-- ۲. استپر دانه / تکی (🍦 دانه) -->
                            <div class="stepper-box unit-stepper">
                                <div class="stepper-label">
                                    <span class="material-symbols-outlined">icecream</span>
                                    <span>دانه / تکی</span>
                                </div>
                                <div class="stepper-controls">
                                    <button type="button" class="step-btn step-down" onclick="changeQty('<?php echo $prodId; ?>', 'unit', -1)" aria-label="کاهش دانه">
                                        <span class="material-symbols-outlined">remove</span>
                                    </button>
                                    <input type="number" 
                                           class="step-input unit-input" 
                                           id="unit_<?php echo $prodId; ?>" 
                                           value="<?php echo $units; ?>" 
                                           min="0" 
                                           oninput="handleQtyInput('<?php echo $prodId; ?>', 'unit', this.value)">
                                    <button type="button" class="step-btn step-up" onclick="changeQty('<?php echo $prodId; ?>', 'unit', 1)" aria-label="افزایش دانه">
                                        <span class="material-symbols-outlined">add</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- زیرنویس محاسبه مجموع موجودی این کالا -->
                        <div class="card-calc-footer" id="calcFooter_<?php echo $prodId; ?>">
                            <span>مجموع بارگیری این کالا: <strong class="total-units-text"><?php echo toPersianNum($totalSingleUnits); ?> عدد</strong></span>
                            <?php if ($cartons > 0 && $units > 0): ?>
                                <small>(<?php echo toPersianNum($cartons); ?> کارتن + <?php echo toPersianNum($units); ?> دانه)</small>
                            <?php endif; ?>
                        </div>

                    </article>
                <?php endforeach; ?>
            <?php endif; ?>

            <!-- استیت عدم یافت کالا -->
            <div id="noInventoryFound" class="empty-products-box" style="display: none;">
                <span class="material-symbols-outlined">search_off</span>
                <p>هیچ کالایی با این فیلتر یا جستجو یافت نشد</p>
                <button onclick="resetFilters()" class="reset-filter-btn">نمایش همه کالاها</button>
            </div>
        </main>

        <!-- کانتینر چسبان پایینی (Sticky Summary & Lock Inventory Bar) -->
        <footer class="van-sticky-bar" id="vanStickyBar">
            <div class="sticky-summary-box">
                <div class="summary-counts-row">
                    <div class="count-badge cartons-badge">
                        <span class="material-symbols-outlined">inventory_2</span>
                        <strong id="stickyTotalCartons"><?php echo toPersianNum($summary['totalCartons']); ?></strong>
                        <small>کارتن</small>
                    </div>

                    <div class="count-badge units-badge">
                        <span class="material-symbols-outlined">icecream</span>
                        <strong id="stickyTotalUnits"><?php echo toPersianNum($summary['totalLooseUnits']); ?></strong>
                        <small>دانه</small>
                    </div>
                </div>

                <div class="summary-value-row">
                    <span class="value-label">ارزش کل بار:</span>
                    <strong class="value-amount" id="stickyTotalValue"><?php echo toPersianNum(number_format($summary['totalInventoryValue'])); ?> تومان</strong>
                </div>
            </div>

            <!-- دکمه قفل و ثبت نهایی موجودی ماشین -->
            <button type="button" class="van-lock-btn" id="lockInventoryBtn" onclick="saveAndLockInventory()">
                <span class="material-symbols-outlined">lock_clock</span>
                <span>ثبت و قفل موجودی خودرو</span>
            </button>
        </footer>

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
            <a href="van-loading.php" class="nav-item active">
                <span class="material-symbols-outlined icon-fill">local_shipping</span>
                <span>بارگیری خودرو</span>
            </a>
            <a href="collections.php" class="nav-item">
                <span class="material-symbols-outlined">payments</span>
                <span>وصول مطالبات</span>
            </a>
        </nav>

    </div>

    <script>
        const API_TOKEN = '<?php echo getAccessToken(); ?>';
    </script>
    <script src="./js/van-loading.js?v=<?php echo time(); ?>"></script>
</body>

</html>
<?php
function getBrandClass($brand) {
    switch ($brand) {
        case 'میهن': return 'brand-mihan';
        case 'پاندا': return 'brand-panda';
        case 'دومینو': return 'brand-domino';
        case 'کاله': return 'brand-kalleh';
        case 'حاج حسن': return 'brand-hajhasan';
        case 'پاک': return 'brand-paak';
        default: return 'brand-default';
    }
}
?>
