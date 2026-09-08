<?php
require_once 'auth_helper.php';

// ۱. بررسی لاگین بودن کاربر
requireLogin();

// ۲. جلوگیری از کش شدن صفحه
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");

// ۳. دریافت لیست محصولات کاربر از API بک‌اند
$apiProducts = apiCall('products');
$products = (!empty($apiProducts) && is_array($apiProducts)) ? $apiProducts : [];

// شمارش تعداد کالاهای اختصاصی خود کاربر
$myCustomCount = count(array_filter($products, function ($p) {
    return !empty($p['isCustomUserProduct']);
}));

// شمارش تعداد کالاهای هر برند کاتالوگ
$mihanCount = count(array_filter($products, function ($p) {
    return ($p['brand'] ?? '') === 'میهن';
}));
$pandaCount = count(array_filter($products, function ($p) {
    return ($p['brand'] ?? '') === 'پاندا';
}));

// استخراج لیست یکتای دسته‌بندی‌ها و برندها
$brands = array_values(array_unique(array_filter(array_column($products, 'brand'))));
$categories = array_values(array_unique(array_filter(array_column($products, 'category'))));

// دسته‌بندی‌های استاندارد ۶ گانه مخفف و تمیز
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
    <title>ویزیتیک — کاتالوگ و لیست کالاها</title>

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">
    <link rel="stylesheet" href="./css/products.css?v=<?php echo time(); ?>">
</head>

<body>
    <div class="app" id="app">

        <!-- Overlay و کشوی انتخاب و دانلود کاتالوگ‌های آماده -->
        <div class="menu-overlay" id="presetOverlay" onclick="closePresetDrawer()"></div>

        <aside class="preset-drawer" id="presetDrawer">
            <div class="preset-drawer-header">
                <div class="preset-drawer-title">
                    <span class="material-symbols-outlined">cloud_download</span>
                    <span>کاتالوگ‌های رسمی شرکت‌ها</span>
                </div>
                <button class="preset-drawer-close" onclick="closePresetDrawer()" aria-label="بستن">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>

            <p class="preset-drawer-desc">برای اضافه شدن کالاهای هر شرکت به لیست فروش خود، دکمه دریافت را بزنید:</p>

            <!-- یادآوری نقش و مسئولیت سامانه در بخش کاتالوگ -->
            <div class="catalog-role-notice">
                <div class="catalog-role-title">
                    <span class="material-symbols-outlined">info</span>
                    <strong>نقش این بخش چیست؟</strong>
                </div>
                <p>کاتالوگ‌های دریافت‌شده در اینجا فقط یک <strong>فهرست مرجع از کالاها و قیمت‌ها</strong> برای سرعت کار شما هستند و جایگزین سامانهٔ رسمی ثبت سفارشِ شرکت نمی‌شوند.</p>
                <p>ویزیتیک یک <strong>دستیار اطلاع‌رسانی به فروشگاه‌ها</strong> است: فاکتورِ صادرهٔ خودتان را از طریق ربات بله برای مشتری ارسال می‌کنید و مبلغ، نحوهٔ تسویه و ماندهٔ حساب را اعلام می‌کنید.</p>
                <p class="catalog-role-foot">ثبت فاکتور رسمی و <strong>عواقب قانونی و مالی آن بر عهدهٔ خودِ ویزیتور</strong> است؛ برای اسناد رسمی و مراجع قانونی، فاکتور باید همچنان در سامانهٔ مورد استفادهٔ شرکت شما ثبت شود.</p>
            </div>

            <div class="preset-list" id="presetCatalogList">
                <!-- ۱. برند میهن -->
                <div class="preset-card" id="presetCardMihan">
                    <div class="preset-card-top">
                        <div class="preset-brand-badge mihan">میهن</div>
                        <div class="preset-brand-meta">
                            <strong>کاتالوگ رسمی بستنی میهن</strong>
                            <span>شامل کترینگ، میرکس، فروتاره و...</span>
                        </div>
                    </div>
                    <div class="preset-card-actions">
                        <button type="button" class="preset-action-btn download-btn" id="mihanDownloadBtn" onclick="toggleBrandCatalog('میهن')">
                            <span class="material-symbols-outlined">cloud_download</span>
                            <span class="btn-text">دریافت کاتالوگ میهن (<?php echo toPersianNum($mihanCount); ?> قلم)</span>
                        </button>
                    </div>
                    <button type="button" class="preset-reset-prices-btn" id="mihanResetPricesBtn" onclick="resetBrandPrices('میهن')" style="display: none;">
                        <span class="material-symbols-outlined">restart_alt</span>
                        <span>بازنشانی قیمت‌های میهن به پیش‌فرض کارخانه</span>
                    </button>
                </div>

                <!-- ۲. برند پاندا -->
                <div class="preset-card" id="presetCardPanda">
                    <div class="preset-card-top">
                        <div class="preset-brand-badge panda">پاندا</div>
                        <div class="preset-brand-meta">
                            <strong>کاتالوگ بستنی پاندا</strong>
                            <span>محصولات کترینگ ۴ کیلویی</span>
                        </div>
                    </div>
                    <div class="preset-card-actions">
                        <button type="button" class="preset-action-btn download-btn" id="pandaDownloadBtn" onclick="toggleBrandCatalog('پاندا')">
                            <span class="material-symbols-outlined">cloud_download</span>
                            <span class="btn-text">دریافت کاتالوگ پاندا (<?php echo toPersianNum($pandaCount); ?> قلم)</span>
                        </button>
                    </div>
                    <button type="button" class="preset-reset-prices-btn" id="pandaResetPricesBtn" onclick="resetBrandPrices('پاندا')" style="display: none;">
                        <span class="material-symbols-outlined">restart_alt</span>
                        <span>بازنشانی قیمت‌های پاندا به پیش‌فرض کارخانه</span>
                    </button>
                </div>

                <!-- ۳. سایر برندها -->
                <div class="preset-card disabled-card" onclick="showPresetComingSoon('دومینو')">
                    <div class="preset-card-top">
                        <div class="preset-brand-badge domino">دومینو</div>
                        <div class="preset-brand-meta">
                            <strong>کاتالوگ رسمی دومینو</strong>
                            <span class="coming-soon-tag">به‌زودی در آپدیت بعدی</span>
                        </div>
                    </div>
                </div>

                <div class="preset-card disabled-card" onclick="showPresetComingSoon('کاله')">
                    <div class="preset-card-top">
                        <div class="preset-brand-badge kalleh">کاله</div>
                        <div class="preset-brand-meta">
                            <strong>کاتالوگ رسمی بستنی کاله</strong>
                            <span class="coming-soon-tag">به‌زودی در آپدیت بعدی</span>
                        </div>
                    </div>
                </div>

                <div class="preset-card disabled-card" onclick="showPresetComingSoon('حاج حسن')">
                    <div class="preset-card-top">
                        <div class="preset-brand-badge hajhasan">حاج حسن</div>
                        <div class="preset-brand-meta">
                            <strong>بستنی سنتی حاج حسن</strong>
                            <span class="coming-soon-tag">به‌زودی در آپدیت بعدی</span>
                        </div>
                    </div>
                </div>

                <div class="preset-card disabled-card" onclick="showPresetComingSoon('پاک')">
                    <div class="preset-card-top">
                        <div class="preset-brand-badge paak">پاک</div>
                        <div class="preset-brand-meta">
                            <strong>کاتالوگ رسمی بستنی پاک</strong>
                            <span class="coming-soon-tag">به‌زودی در آپدیت بعدی</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- دکمه حذف تمام کاتالوگ‌های دانلود شده از کش -->
            <div class="preset-drawer-footer">
                <button type="button" class="preset-clear-all-btn" onclick="clearAllDownloadedCatalogs()">
                    <span class="material-symbols-outlined">delete_sweep</span>
                    <span>حذف تمام کاتالوگ‌های دریافتی از لیست من</span>
                </button>
            </div>
        </aside>

        <!-- هدر صفحه -->
        <header class="products-header">
            <div class="header-top-row">
                <button class="preset-toggle-btn" id="presetToggleBtn" onclick="openPresetDrawer()" title="مشاهده کاتالوگ شرکت‌ها">
                    <span class="material-symbols-outlined">menu</span>
                </button>

                <div class="header-title-box">
                    <h1>لیست کالاها و کاتالوگ</h1>
                    <span class="header-sub" id="headerProductCount">۰ محصول فعال</span>
                </div>

                <a href="dashboard.php" class="back-btn" aria-label="بازگشت به داشبورد">
                    <span class="material-symbols-outlined">arrow_forward</span>
                </a>
            </div>

            <!-- نوار جستجوی سریع -->
            <div class="search-box">
                <span class="material-symbols-outlined search-icon">search</span>
                <input type="text" id="searchInput" placeholder="جستجوی نام بستنی، برند یا دسته..." oninput="filterProducts()">
                <button id="clearSearchBtn" class="clear-search-btn" onclick="clearSearch()" style="display: none;">
                    <span class="material-symbols-outlined">cancel</span>
                </button>
            </div>

            <!-- ردیف ۱ فیلترها: فیلتر برندها و کالاهای اختصاصی من -->
            <div class="chips-scroll-container">
                <span class="chips-label">برند:</span>
                <div class="chips-track" id="brandChipsTrack">
                    <button class="filter-chip active" data-brand="ALL" onclick="selectBrand(this, 'ALL')">همه کالاها</button>
                    
                    <button class="filter-chip my-products-chip" data-brand="MY_PRODUCTS" onclick="selectBrand(this, 'MY_PRODUCTS')">
                        <span class="material-symbols-outlined chip-icon">stars</span>
                        <span>کالاهای من (<?php echo toPersianNum($myCustomCount); ?>)</span>
                    </button>

                    <button class="filter-chip brand-chip-mihan" data-brand="میهن" onclick="selectBrand(this, 'میهن')" style="display: none;">
                        میهن
                    </button>

                    <button class="filter-chip brand-chip-panda" data-brand="پاندا" onclick="selectBrand(this, 'پاندا')" style="display: none;">
                        پاندا
                    </button>

                    <?php foreach ($brands as $b): ?>
                        <?php if ($b !== 'میهن' && $b !== 'پاندا'): ?>
                            <button class="filter-chip" data-brand="<?php echo htmlspecialchars($b); ?>" onclick="selectBrand(this, '<?php echo htmlspecialchars($b); ?>')">
                                <?php echo htmlspecialchars($b); ?>
                            </button>
                        <?php endif; ?>
                    <?php endforeach; ?>
                </div>
            </div>

            <!-- ردیف ۲ فیلترها: دسته‌بندی‌های استاندارد ۶ گانه -->
            <div class="chips-scroll-container">
                <span class="chips-label">دسته:</span>
                <div class="chips-track" id="categoryChipsTrack">
                    <button class="filter-chip active" data-category="ALL" onclick="selectCategory(this, 'ALL')">همه دسته‌ها</button>
                    <?php foreach ($defaultCategories as $c): ?>
                        <button class="filter-chip" data-category="<?php echo htmlspecialchars($c); ?>" onclick="selectCategory(this, '<?php echo htmlspecialchars($c); ?>')">
                            <?php echo htmlspecialchars($c); ?>
                        </button>
                    <?php endforeach; ?>
                </div>
            </div>
        </header>

        <!-- لیست کالاها -->
        <main class="products-content" id="productsList">
            <!-- ۱. استیت زمانی که کاتالوگی دانلود نشده -->
            <div class="empty-catalog-state" id="emptyCatalogState" style="display: none;">
                <div class="empty-icon-box">
                    <span class="material-symbols-outlined">cloud_download</span>
                </div>
                <h3>کاتالوگی دریافت نکرده‌اید</h3>
                <p>برای شروع می‌توانید کاتالوگ شرکت‌ها (میهن، پاندا و...) را با یک کلیک دریافت کنید یا با دکمه (+) کالای اختصاصی جدید بسازید.</p>
                <button type="button" class="empty-action-btn" onclick="openPresetDrawer()">
                    <span class="material-symbols-outlined">cloud_download</span>
                    <span>دریافت کاتالوگ آماده شرکت‌ها</span>
                </button>
            </div>

            <!-- ۲. کارت‌های محصولات دیتابیس -->
            <?php if (!empty($products)): ?>
                <?php foreach ($products as $i => $item): ?>
                    <?php
                        $itemId = $item['id'] ?? ('p' . $i);
                        $itemName = $item['name'] ?? '';
                        $brandName = $item['brand'] ?? 'متفرقه';
                        $categoryName = $item['category'] ?? 'سایر';
                        $packSize = (int)($item['unitsPerCarton'] ?? 24);
                        $cartonPrice = (float)($item['cartonPrice'] ?? 0);
                        $unitPrice = (float)($item['baseUnitPrice'] ?? 0);
                        $imageUrl = $item['imageUrl'] ?? null;
                        $isGlobal = !empty($item['isGlobal']);
                        $isCustom = !empty($item['isCustomUserProduct']);
                        $hasCustomPrice = !empty($item['hasCustomPrice']);
                    ?>
                    <article class="product-item-card" 
                             data-id="<?php echo htmlspecialchars($itemId); ?>"
                             data-name="<?php echo htmlspecialchars($itemName); ?>"
                             data-brand="<?php echo htmlspecialchars($brandName); ?>"
                             data-category="<?php echo htmlspecialchars($categoryName); ?>"
                             data-pack="<?php echo htmlspecialchars($packSize); ?>"
                             data-cartonprice="<?php echo htmlspecialchars($cartonPrice); ?>"
                             data-unitprice="<?php echo htmlspecialchars($unitPrice); ?>"
                             data-isglobal="<?php echo $isGlobal ? 'true' : 'false'; ?>"
                             data-iscustom="<?php echo $isCustom ? 'true' : 'false'; ?>"
                             data-hascustomprice="<?php echo $hasCustomPrice ? 'true' : 'false'; ?>"
                             style="display: none;">
                        
                        <div class="product-item-top">
                            <div class="product-icon-wrap <?php echo $isCustom ? 'custom-wrap' : ''; ?>">
                                <?php if (!empty($imageUrl)): ?>
                                    <img src="<?php echo htmlspecialchars($imageUrl); ?>" alt="<?php echo htmlspecialchars($itemName); ?>" class="product-card-img">
                                <?php else: ?>
                                    <span class="material-symbols-outlined"><?php echo $isCustom ? 'star' : 'icecream'; ?></span>
                                <?php endif; ?>
                            </div>

                            <div class="product-main-details">
                                <h2 class="product-item-title"><?php echo htmlspecialchars($itemName); ?></h2>
                                <div class="product-badges-row">
                                    <?php if ($isCustom): ?>
                                        <span class="badge-custom">⭐ کالای من</span>
                                    <?php endif; ?>
                                    <span class="badge-brand <?php echo getBrandClass($brandName); ?>">
                                        <?php echo htmlspecialchars($brandName); ?>
                                    </span>
                                    <span class="badge-category">
                                        <?php echo htmlspecialchars($categoryName); ?>
                                    </span>
                                    <span class="badge-pack">
                                        <?php echo toPersianNum($packSize); ?> عددی
                                    </span>
                                </div>
                            </div>

                            <button type="button" class="product-edit-btn" onclick="openEditProductModal(this)" title="ویرایش کالا">
                                <span class="material-symbols-outlined">edit</span>
                            </button>
                        </div>

                        <div class="product-price-row">
                            <div class="price-block">
                                <span class="price-label">قیمت هر کارتن:</span>
                                <span class="price-val"><?php echo toPersianNum(number_format($cartonPrice)); ?> <small>تومان</small></span>
                            </div>
                            <div class="price-divider"></div>
                            <div class="price-block">
                                <span class="price-label">قیمت تکی/دانه:</span>
                                <span class="price-val unit"><?php echo toPersianNum(number_format($unitPrice)); ?> <small>تومان</small></span>
                            </div>
                        </div>
                    </article>
                <?php endforeach; ?>
            <?php endif; ?>

            <!-- استیت عدم یافت کالا -->
            <div id="noProductsFound" class="empty-products-box" style="display: none;">
                <span class="material-symbols-outlined">search_off</span>
                <p>هیچ کالایی با این مشخصات یافت نشد</p>
                <button onclick="resetFilters()" class="reset-filter-btn">نمایش همه کالاها</button>
            </div>
        </main>

        <!-- دکمه شناور افزودن کالای جدید -->
        <button class="fab-add-product" onclick="openAddProductModal()" title="افزودن کالای جدید">
            <span class="material-symbols-outlined">add</span>
        </button>

        <!-- مودال ثبت و ویرایش کالا -->
        <div class="modal-overlay" id="productModal" style="display: none;">
            <div class="modal-card">
                <div class="modal-header">
                    <h3 id="modalTitle">تعریف محصول بستنی جدید</h3>
                    <button class="modal-close" onclick="closeProductModal()">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <form class="modal-form" id="productForm" onsubmit="handleSaveProduct(event)">
                    <input type="hidden" id="prodId" value="">
                    <input type="hidden" id="prodIsCustom" value="true">

                    <div class="modal-input-group">
                        <label>نام بستنی <span class="req">*</span></label>
                        <input type="text" id="prodName" placeholder="مثال: مگنوم فندقی دست‌ساز" required>
                    </div>

                    <div class="modal-input-row">
                        <div class="modal-input-group">
                            <label>برند / شرکت</label>
                            <input type="text" id="prodBrand" placeholder="مثال: کارگاه من">
                        </div>
                        <div class="modal-input-group">
                            <label>دسته‌بندی</label>
                            <select id="prodCategory" class="modal-select">
                                <option value="چوبی">چوبی</option>
                                <option value="قیفی">قیفی</option>
                                <option value="لیوانی">لیوانی</option>
                                <option value="یخی">یخی</option>
                                <option value="کترینگ و خانواده">کترینگ و خانواده</option>
                                <option value="سنتی و حصیری">سنتی و حصیری</option>
                                <option value="سایر">سایر</option>
                            </select>
                        </div>
                    </div>

                    <div class="modal-input-row">
                        <div class="modal-input-group">
                            <label>تعداد در کارتن <span class="req">*</span></label>
                            <input type="number" id="prodPackSize" value="24" min="1" required>
                        </div>
                        <div class="modal-input-group">
                            <label>قیمت کارتن (تومان) <span class="req">*</span></label>
                            <input type="number" id="prodCartonPrice" placeholder="مثال: 720000" min="0" required>
                        </div>
                    </div>

                    <div class="modal-unit-calc" id="modalUnitCalc">
                        قیمت محاسبه‌شده هر عدد: <strong id="calcUnitPrice">۰ تومان</strong>
                    </div>

                    <button type="submit" class="modal-submit-btn" id="modalSubmitBtn">ثبت کالا</button>

                    <button type="button" class="modal-reset-btn" id="modalResetBtn" onclick="handleResetCurrentProductPrice()" style="display: none;">
                        <span class="material-symbols-outlined">restart_alt</span>
                        <span>بازنشانی به قیمت پایه کارخانه</span>
                    </button>

                    <button type="button" class="modal-delete-btn" id="modalDeleteBtn" onclick="handleDeleteCurrentProduct()" style="display: none;">
                        <span class="material-symbols-outlined">delete</span>
                        <span>حذف این محصول از لیست من</span>
                    </button>
                </form>
            </div>
        </div>

    </div>

    <script>
        const API_TOKEN = '<?php echo getAccessToken(); ?>';
        window.BRAND_COUNTS = {
            'میهن': <?php echo (int)$mihanCount; ?>,
            'پاندا': <?php echo (int)$pandaCount; ?>
        };
    </script>
    <script src="./js/products.js?v=<?php echo time(); ?>"></script>
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
