<?php
require_once 'auth_helper.php';

// ۱. بررسی لاگین بودن کاربر
requireLogin();

// ۲. جلوگیری از کش
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");

// ۳. دریافت لیست مشتریان
$apiCustomers = apiCall('customers');
$customers = (!empty($apiCustomers) && is_array($apiCustomers)) ? $apiCustomers : [];

// ۴. دریافت بار موجود در خودرو (Van Inventory)
// در پخش گرم، صرفاً کالاهایی که در خودرو بارگیری شده‌اند قابل مشاهده و فروش هستند (بدون بای‌پس)
$apiInventory = apiCall('van-inventory');
$allInventoryItems = $apiInventory['items'] ?? (is_array($apiInventory) ? $apiInventory : []);

// فیلتر سخت‌گیرانه: فقط اقلامی که موجودی کارتن یا دانه آن‌ها در ون بیشتر از صفر است
$loadedProducts = array_values(array_filter($allInventoryItems, function ($item) {
    return (($item['quantityCartons'] ?? 0) > 0 || ($item['quantityUnits'] ?? 0) > 0);
}));

// ۵. مشتری پیش‌فرض
$targetCustomerId = $_GET['customerId'] ?? '';
$selectedCustomer = null;
if (!empty($targetCustomerId)) {
    foreach ($customers as $c) {
        if ($c['id'] === $targetCustomerId) {
            $selectedCustomer = $c;
            break;
        }
    }
}
if (!$selectedCustomer && !empty($customers)) {
    $selectedCustomer = $customers[0];
}

// استخراج دسته‌بندی‌های کالاهای موجود در ماشین
$categories = array_values(array_unique(array_filter(array_column($loadedProducts, 'category'))));
?>
<!DOCTYPE html>
<html dir="rtl" lang="fa">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>ویزیتیک — ثبت سفارش از موجودی خودرو</title>

    <link rel="stylesheet" href="./fonts/vazirmatn/vazirmatn.css">
    <link rel="stylesheet" href="./fonts/material-symbols/material-symbols.css" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">
    <link rel="stylesheet" href="./css/new-order.css?v=<?php echo time(); ?>">
</head>

<body>
    <div class="app" id="app">

        <!-- هدر تیره صفحه ثبت سفارش -->
        <header class="order-header">
            <div class="header-top-row">
                <div class="header-right-group">
                    <a href="van-loading.php" class="header-van-btn" title="مشاهده و بارگیری کالاهای خودرو" aria-label="بارگیری خودرو">
                        <span class="material-symbols-outlined">local_shipping</span>
                    </a>
                    <div class="header-title-box">
                        <h1>ثبت سفارش و صدور فاکتور</h1>
                        <span class="header-sub">انتخاب از موجودی بار خودرو</span>
                    </div>
                </div>

                <a href="dashboard.php" class="back-btn" onclick="return handleSafeBack(event)" aria-label="بازگشت به داشبورد">
                    <span class="material-symbols-outlined">arrow_forward</span>
                </a>
            </div>

            <!-- کارت انتخاب مشتری -->
            <div class="customer-select-card" onclick="openCustomerPicker()">
                <div class="customer-info-preview">
                    <div class="cust-avatar-mini">
                        <span class="material-symbols-outlined">storefront</span>
                    </div>
                    <div class="cust-details">
                        <span class="cust-name" id="selectedCustName">
                            <?php echo htmlspecialchars($selectedCustomer['name'] ?? 'انتخاب مشتری...'); ?>
                        </span>
                        <span class="cust-debt-badge <?php echo (($selectedCustomer['currentDebt'] ?? 0) <= 0) ? 'cleared' : ''; ?>" id="selectedCustDebt">
                            <?php
                            $debt = (float)($selectedCustomer['currentDebt'] ?? 0);
                            if ($debt > 0) {
                                echo 'بدهی قبلی: ' . toPersianNum(number_format($debt)) . ' تومان';
                            } else {
                                echo 'حساب تسویه (بدون بدهی)';
                            }
                            ?>
                        </span>
                    </div>
                </div>

                <div class="change-cust-text">
                    <span>تغییر مشتری</span>
                    <span class="material-symbols-outlined" style="font-size: 16px;">expand_more</span>
                </div>
            </div>
        </header>

        <!-- ناحیه اصلی اسکرول سفارش -->
        <main class="order-content">

            <?php if (empty($loadedProducts)): ?>
                <!-- حالت خالی بودن بار خودرو (بدون هیچ بای‌پسی) -->
                <div class="empty-van-box">
                    <!-- <span class="material-symbols-outlined">inventory_2</span> -->
                    <h3>هیچ کالایی در خودرو بارگیری نشده است</h3>
                    <p>برای ثبت سفارش مشتری در پخش گرم، ابتدا اقلام موجود را در خودرو بارگیری نمایید.</p>
                    <a href="van-loading.php" class="goto-loading-btn">

                        <span>ورود به بخش بارگیری خودرو</span>
                    </a>
                </div>
            <?php else: ?>

                <!-- جستجو و فیلتر دسته‌بندی‌ها -->
                <section class="search-filter-box">
                    <div class="search-input-wrap">
                        <span class="material-symbols-outlined">search</span>
                        <input type="text" id="orderSearchInput" placeholder="جستجوی نام، طعم یا برند بستنی..." oninput="filterProducts()">
                    </div>

                    <?php if (count($categories) > 1): ?>
                        <div class="category-pills-row">
                            <button type="button" class="cat-pill active" data-cat="all" onclick="selectCategory(this, 'all')">همه محصولات</button>
                            <?php foreach ($categories as $cat): ?>
                                <button type="button" class="cat-pill" data-cat="<?php echo htmlspecialchars($cat); ?>" onclick="selectCategory(this, '<?php echo htmlspecialchars($cat); ?>')">
                                    <?php echo htmlspecialchars($cat); ?>
                                </button>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>
                </section>

                <!-- لیست محصولات موجود در خودرو -->
                <section class="order-product-list" id="orderProductList">
                    <?php foreach ($loadedProducts as $p):
                        $pId = $p['productId'] ?? $p['id'];
                        $name = $p['productName'] ?? $p['name'];
                        $brand = $p['brand'] ?? 'میهن';
                        $category = $p['category'] ?? 'چوبی';

                        $unitsPerCarton = (int)($p['unitsPerCarton'] ?? $p['unitsPerCartonDefault'] ?? 1);
                        if ($unitsPerCarton <= 0) $unitsPerCarton = 1;

                        $unitPrice = (float)($p['unitPrice'] ?? $p['baseUnitPrice'] ?? 0);
                        $cartonPrice = (float)($p['cartonPrice'] ?? ($unitPrice * $unitsPerCarton));

                        $stockCartons = (int)($p['quantityCartons'] ?? 0);
                        $stockUnits = (int)($p['quantityUnits'] ?? 0);
                        $totalStockUnits = ($stockCartons * $unitsPerCarton) + $stockUnits;
                        $maxCartons = floor($totalStockUnits / $unitsPerCarton);
                        $maxUnitsLimit = ($unitsPerCarton > 1) ? ($unitsPerCarton - 1) : 1;
                        $imageUrl = $p['imageUrl'] ?? null;
                        $isCustom = !empty($p['isCustomUserProduct']);
                    ?>
                        <article class="product-order-card"
                            id="prodCard_<?php echo $pId; ?>"
                            data-id="<?php echo $pId; ?>"
                            data-name="<?php echo htmlspecialchars($name); ?>"
                            data-brand="<?php echo htmlspecialchars($brand); ?>"
                            data-category="<?php echo htmlspecialchars($category); ?>"
                            data-units-per-carton="<?php echo $unitsPerCarton; ?>"
                            data-unit-price="<?php echo $unitPrice; ?>"
                            data-carton-price="<?php echo $cartonPrice; ?>"
                            data-stock-cartons="<?php echo $stockCartons; ?>"
                            data-stock-units="<?php echo $stockUnits; ?>"
                            data-total-stock-units="<?php echo $totalStockUnits; ?>">

                            <div class="prod-card-top">
                                <!-- جای عکس محصول — فعلاً آیکون بستنی (تا عکسی در دیتابیس نباشد) -->
                                <div class="prod-icon-wrap">
                                    <?php if (!empty($imageUrl)): ?>
                                        <img src="<?php echo htmlspecialchars($imageUrl); ?>" alt="<?php echo htmlspecialchars($name); ?>">
                                    <?php else: ?>
                                        <span class="material-symbols-outlined"><?php echo $isCustom ? 'star' : 'icecream'; ?></span>
                                    <?php endif; ?>
                                </div>
                                <div class="prod-main-meta">
                                    <div class="prod-title-line">
                                        <h3 class="prod-title"><?php echo htmlspecialchars($name); ?></h3>
                                        <span class="prod-brand-tag <?php echo ($brand === 'پاندا') ? 'panda' : ''; ?>"><?php echo htmlspecialchars($brand); ?></span>
                                    </div>
                                    <div class="prod-prices-line">
                                        <span>کارتن (<?php echo toPersianNum($unitsPerCarton); ?> تایی): <strong><?php echo toPersianNum(number_format($cartonPrice)); ?></strong> ت</span> |
                                        <span>فی دانه: <strong><?php echo toPersianNum(number_format($unitPrice)); ?></strong> ت</span>
                                    </div>
                                </div>

                                <span class="van-stock-badge in-stock">
                                    <?php if ($stockUnits > 0): ?>
                                        موجودی ون: <?php echo toPersianNum($stockCartons); ?> کارتن و <?php echo toPersianNum($stockUnits); ?> دانه (مجموع <?php echo toPersianNum($totalStockUnits); ?> عدد)
                                    <?php else: ?>
                                        موجودی ون: <?php echo toPersianNum($stockCartons); ?> کارتن (مجموع <?php echo toPersianNum($totalStockUnits); ?> عدد)
                                    <?php endif; ?>
                                </span>
                            </div>

                            <!-- استپرهای کارتن و دانه — عین صفحه بارگیری (گرید ۲ ستونه با آیکون remove/add) -->
                            <div class="prod-steppers-container">
                                <div class="steppers-grid">
                                    <!-- ۱. استپر کارتن -->
                                    <div class="stepper-box carton-stepper">
                                        <div class="stepper-label">
                                            <span class="material-symbols-outlined">inventory_2</span>
                                            <span>کارتن (<?php echo toPersianNum($unitsPerCarton); ?> تایی)</span>
                                        </div>
                                        <div class="stepper-controls">
                                            <button type="button" class="step-btn step-down" onclick="updateCartonCount('<?php echo $pId; ?>', -1)" aria-label="کاهش کارتن">
                                                <span class="material-symbols-outlined">remove</span>
                                            </button>
                                            <input type="number" class="step-input carton-input" id="cartonInput_<?php echo $pId; ?>" value="0" min="0" max="<?php echo $maxCartons; ?>" onchange="onQuantityChanged('<?php echo $pId; ?>')" oninput="onQuantityChanged('<?php echo $pId; ?>')">
                                            <button type="button" class="step-btn step-up" onclick="updateCartonCount('<?php echo $pId; ?>', 1)" aria-label="افزایش کارتن">
                                                <span class="material-symbols-outlined">add</span>
                                            </button>
                                        </div>
                                    </div>

                                    <!-- ۲. استپر دانه (با محدودیت حداکثر دانه در کارتن) -->
                                    <div class="stepper-box unit-stepper">
                                        <div class="stepper-label">
                                            <span class="material-symbols-outlined">icecream</span>
                                            <span>دانه / تکی</span>
                                        </div>
                                        <div class="stepper-controls">
                                            <button type="button" class="step-btn step-down" onclick="updateUnitCount('<?php echo $pId; ?>', -1)" aria-label="کاهش دانه">
                                                <span class="material-symbols-outlined">remove</span>
                                            </button>
                                            <input type="number" class="step-input unit-input" id="unitInput_<?php echo $pId; ?>" value="0" min="0" max="<?php echo $maxUnitsLimit; ?>" onchange="onQuantityChanged('<?php echo $pId; ?>')" oninput="onQuantityChanged('<?php echo $pId; ?>')">
                                            <button type="button" class="step-btn step-up" onclick="updateUnitCount('<?php echo $pId; ?>', 1)" aria-label="افزایش دانه">
                                                <span class="material-symbols-outlined">add</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <!-- نوار اختصاصی جمع ردیف در انتهای کارت -->
                                <div class="line-total-badge-row" id="lineTotalBadge_<?php echo $pId; ?>">
                                    <span class="calc-label" id="lineTotalDesc_<?php echo $pId; ?>"></span>
                                    <strong class="calc-amount" id="lineTotalAmount_<?php echo $pId; ?>"></strong>
                                </div>
                            </div>
                        </article>
                    <?php endforeach; ?>
                </section>
            <?php endif; ?>

        </main>

        <?php if (!empty($loadedProducts)): ?>
            <!-- نوار پایین صفحه -->
            <footer class="order-bottom-bar">
                <div class="order-calc-breakdown">
                    <div class="calc-row-left">
                        <span class="calc-subtotal">جمع کل اقلام انتخابی:</span>
                        <strong class="calc-final-amount" id="calcFinalVal">۰ تومان</strong>
                    </div>
                    <div class="calc-row-right">
                        <span class="calc-final-label">تخفیف در مرحله پرداخت اعمال می‌شود</span>
                    </div>
                </div>

                <button type="button" class="checkout-cta-btn" id="checkoutCtaBtn" onclick="openOrderConfirmModal()" disabled>
                    <span>حداقل یک محصول را انتخاب نمایید</span>
                </button>
            </footer>
        <?php endif; ?>

        <!-- مدال تایید اقلام سفارش قبل از رفتن به پرداخت -->
        <div class="modal-overlay" id="orderConfirmModal">
            <div class="confirm-order-sheet">
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 10px;">
                    <div>
                        <h3 style="font-size: 15px; font-weight: 800; margin: 0;">تایید اقلام سفارش</h3>
                        <span id="confirmCustTitle" style="font-size: 11px; color: var(--primary); font-weight: 700;"></span>
                    </div>
                    <button type="button" style="background:none; border:none; cursor:pointer;" onclick="closeOrderConfirmModal()">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div style="font-size: 12px; color: var(--text-secondary);">
                    اقلام انتخابی از بار خودرو:
                </div>

                <div class="confirm-items-list" id="confirmItemsList"></div>

                <div style="display: flex; justify-content: space-between; font-size: 13.5px; font-weight: 900; color: var(--primary); padding: 4px 0;">
                    <span>جمع کل ناخالص:</span>
                    <span id="confirmGrandSubtotal">۰ تومان</span>
                </div>

                <div class="confirm-actions-row">
                    <button type="button" class="confirm-submit-btn" onclick="proceedToPayment()">
                        <span class="material-symbols-outlined">check_circle</span>
                        <span>تایید و ورود به صفحه تسویه و پرداخت</span>
                    </button>
                    <button type="button" class="confirm-cancel-btn" onclick="closeOrderConfirmModal()">
                        ویرایش مجدد سفارش
                    </button>
                </div>
            </div>
        </div>

        <!-- مدال انتخاب مشتری -->
        <div class="modal-overlay" id="customerPickerModal" onclick="if(event.target === this) closeCustomerPicker()">
            <div class="customer-picker-sheet">
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 10px;">
                    <h3 style="font-size: 15px; font-weight: 800; margin: 0;">انتخاب مشتری / فروشگاه</h3>
                    <button type="button" style="background:none; border:none; cursor:pointer;" onclick="closeCustomerPicker()">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div class="search-input-wrap">
                    <span class="material-symbols-outlined">search</span>
                    <input type="text" placeholder="جستجوی نام یا تلفن مشتری..." oninput="filterCustomerList(this.value)">
                </div>

                <div class="picker-cust-list">
                    <?php foreach ($customers as $c):
                        $cId = $c['id'];
                        $cName = $c['name'];
                        $cPhone = $c['phone'] ?? '';
                        $cDebt = (float)($c['currentDebt'] ?? 0);
                    ?>
                        <div class="picker-cust-item"
                            data-id="<?php echo $cId; ?>"
                            data-name="<?php echo htmlspecialchars($cName); ?>"
                            data-phone="<?php echo htmlspecialchars($cPhone); ?>"
                            data-debt="<?php echo $cDebt; ?>"
                            onclick="selectCustomer('<?php echo $cId; ?>', '<?php echo htmlspecialchars(addslashes($cName)); ?>', '<?php echo htmlspecialchars(addslashes($cPhone)); ?>', <?php echo $cDebt; ?>)">
                            <div>
                                <strong style="font-size: 13.5px; color: var(--text-primary);"><?php echo htmlspecialchars($cName); ?></strong>
                                <div style="font-size: 11px; color: var(--text-muted);"><?php echo toPersianNum($cPhone); ?></div>
                            </div>
                            <span style="font-size: 11px; font-weight: 700; color: <?php echo ($cDebt > 0) ? '#dc2626' : '#16a34a'; ?>;">
                                <?php echo ($cDebt > 0) ? 'بدهی: ' . toPersianNum(number_format($cDebt)) . ' ت' : 'تسویه'; ?>
                            </span>
                        </div>
                    <?php endforeach; ?>
                </div>
            </div>
        </div>

    </div>

    <script src="./js/new-order.js?v=<?php echo time(); ?>"></script>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            <?php if ($selectedCustomer): ?>
                selectCustomer(
                    '<?php echo $selectedCustomer['id']; ?>',
                    '<?php echo htmlspecialchars(addslashes($selectedCustomer['name'])); ?>',
                    '<?php echo htmlspecialchars(addslashes($selectedCustomer['phone'] ?? '')); ?>',
                    <?php echo (float)($selectedCustomer['currentDebt'] ?? 0); ?>
                );
            <?php endif; ?>
        });

        function handleSafeBack(e) {
            const hasItems = Object.keys(orderState.items || {}).length > 0;
            if (hasItems) {
                if (!confirm('آیا از خروج از ثبت سفارش اطمینان دارید؟ اقلام انتخاب‌شده ذخیره نخواهند شد.')) {
                    e.preventDefault();
                    return false;
                }
            }
            return true;
        }

        function openOrderConfirmModal() {
            if (!orderState.customerId || Object.keys(orderState.items).length === 0) return;

            document.getElementById('confirmCustTitle').textContent = `مشتری: ${orderState.customerName}`;
            const list = document.getElementById('confirmItemsList');
            list.innerHTML = '';

            Object.values(orderState.items).forEach(item => {
                const row = document.createElement('div');
                row.className = 'confirm-item-row';

                let qtyStr = '';
                if (item.cartonCount > 0 && item.unitCount > 0) {
                    qtyStr = `${toPersianNum(item.cartonCount)} کارتن + ${toPersianNum(item.unitCount)} دانه`;
                } else if (item.cartonCount > 0) {
                    qtyStr = `${toPersianNum(item.cartonCount)} کارتن`;
                } else {
                    qtyStr = `${toPersianNum(item.unitCount)} دانه`;
                }

                row.innerHTML = `
                    <span>${item.name} (${qtyStr})</span>
                    <strong>${formatPrice(item.lineTotal)}</strong>
                `;
                list.appendChild(row);
            });

            document.getElementById('confirmGrandSubtotal').textContent = formatPrice(orderState.subtotal);
            document.getElementById('orderConfirmModal').style.display = 'flex';
        }

        function closeOrderConfirmModal() {
            document.getElementById('orderConfirmModal').style.display = 'none';
        }
    </script>
</body>

</html>