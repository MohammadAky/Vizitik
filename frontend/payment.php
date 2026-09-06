<?php
require_once 'auth_helper.php';

// ۱. بررسی لاگین بودن کاربر
requireLogin();

// ۲. جلوگیری از کش
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");

$apiToken = getAccessToken();
?>
<!DOCTYPE html>
<html dir="rtl" lang="fa">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>حسابچین — تسویه و پرداخت فاکتور</title>

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />
    <link rel="stylesheet" href="./css/style.css?v=<?php echo time(); ?>">
    <link rel="stylesheet" href="./css/payment.css?v=<?php echo time(); ?>">
</head>

<body>
    <div class="app" id="app">

        <!-- هدر صفحه پرداخت -->
        <header class="payment-header">
            <div class="header-title-box">
                <h1>تسویه و تسهیم پرداخت</h1>
                <span class="header-sub">روش‌های پرداخت و ثبت نهایی</span>
            </div>

            <a href="new-order.php" class="back-btn" onclick="return handleSafeBackFromPayment(event)" aria-label="بازگشت به سفارش">
                <span class="material-symbols-outlined">arrow_forward</span>
            </a>
        </header>

        <!-- محتوای اصلی صفحه پرداخت -->
        <main class="payment-content">

            <!-- ۱. کارت اطلاعات مشتری و جمع سفارش ناخالص -->
            <section class="customer-summary-card">
                <div class="cust-summary-header">
                    <div class="cust-summary-name">
                        <span class="material-symbols-outlined" style="color: var(--primary);">storefront</span>
                        <strong id="sumCustName">نام مشتری</strong>
                    </div>
                    <span style="font-size: 11px; color: var(--text-muted);">فاکتور فروش گرم</span>
                </div>

                <div class="cust-summary-rows">
                    <div class="cust-summary-row">
                        <span>جمع کل ناخالص اقلام:</span>
                        <strong id="sumSubtotalVal">۰ تومان</strong>
                    </div>
                    <div class="cust-summary-row" id="sumPrevDebtRow" style="display: none; color: #dc2626;">
                        <span>مانده بدهی قبلی مشتری:</span>
                        <strong id="sumPrevDebtVal" style="color: #dc2626;">۰ تومان</strong>
                    </div>
                </div>
            </section>

            <!-- ۲. بخش تخفیفات پلکانی (بالای گزینه‌های پرداخت جهت محاسبه قیمت خالص قبل از انتخاب روش تسویه) -->
            <section class="discounts-container-card">
                <div class="discounts-inputs-row">
                    <!-- سمت راست: تخفیف درصدی -->
                    <div class="discount-field percent-field">
                        <label for="discountPercentInput">تخفیف درصدی (%)</label>
                        <div class="discount-input-box">
                            <input type="number" id="discountPercentInput" placeholder="۰" min="0" max="100" step="0.5" onkeydown="if(event.key==='Enter') applyDiscountFromInputs()">
                            <span class="discount-unit-tag">٪</span>
                        </div>
                    </div>

                    <!-- سمت چپ: تخفیف مبلغی -->
                    <div class="discount-field fixed-field">
                        <label for="discountFixedInput">تخفیف مبلغی (تومان)</label>
                        <div class="discount-input-box">
                            <input type="text" id="discountFixedInput" placeholder="۰" oninput="formatFixedDiscountInput(this)" onkeydown="if(event.key==='Enter') applyDiscountFromInputs()">
                            <span class="discount-unit-tag">ت</span>
                        </div>
                    </div>

                    <!-- جلوی بخش تخفیف مبلغی: دکمه و علامت اعمال تخفیف -->
                    <div class="discount-action-wrap">
                        <button type="button" class="apply-discount-btn" id="applyDiscountBtn" onclick="applyDiscountFromInputs()" title="ثبت تخفیف">
                            <span class="material-symbols-outlined">add</span>
                            <span>ثبت</span>
                        </button>
                    </div>
                </div>

                <!-- لیست تخفیفات ثبت‌شده زیر هم با امکان حذف هر کدام -->
                <div class="applied-discounts-wrapper" id="appliedDiscountsWrapper" style="display: none;">
                    <div class="applied-discounts-list" id="appliedDiscountsList"></div>
                    <div class="applied-discounts-total" id="appliedDiscountsTotal"></div>
                </div>
            </section>

            <!-- ۳. وضعیت تسویه و مبلغ نهایی فاکتور پس از تخفیف -->
            <section class="final-balance-card" id="finalBalanceCard">
                <div class="final-balance-row">
                    <span>مبلغ نهایی قابل پرداخت:</span>
                    <strong class="amount" id="finalPayableAmount">۰ تومان</strong>
                </div>
                <div id="paymentStatusText" style="font-size: 11.5px; font-weight: 700; margin-top: 2px;"></div>
            </section>

            <!-- ۴. بخش ۴ روش پرداخت (نقدی، پوز، چک، نسیه) بر اساس مبلغ نهایی خالص -->
            <section class="payment-methods-grid">

                <!-- ۱. پرداخت نقدی -->
                <div class="pay-card">
                    <div class="pay-card-header">
                        <div class="pay-card-title cash">
                            <span class="material-symbols-outlined">payments</span>
                            <span>پرداخت نقدی</span>
                        </div>
                        <button type="button" class="quick-btn" onclick="quickFillMethod('cash')">تمام مبلغ نقد</button>
                    </div>
                    <div class="pay-input-wrap">
                        <input type="text" class="pay-amount-input" id="cashInput" oninput="onPaymentInputChanged('cash')">
                        <span class="input-unit">تومان</span>
                    </div>
                </div>

                <!-- ۲. کارتخوان / پوز -->
                <div class="pay-card">
                    <div class="pay-card-header">
                        <div class="pay-card-title pos">
                            <span class="material-symbols-outlined">point_of_sale</span>
                            <span>کارتخوان / پوز</span>
                        </div>
                        <button type="button" class="quick-btn" onclick="quickFillMethod('pos')">تمام مبلغ پوز</button>
                    </div>
                    <div class="pay-input-wrap">
                        <input type="text" class="pay-amount-input" id="posInput" oninput="onPaymentInputChanged('pos')">
                        <span class="input-unit">تومان</span>
                    </div>
                </div>

                <!-- ۳. چک صیادی -->
                <div class="pay-card">
                    <div class="pay-card-header">
                        <div class="pay-card-title check">
                            <span class="material-symbols-outlined">fact_check</span>
                            <span>چک صیادی</span>
                        </div>
                        <button type="button" class="quick-btn" onclick="quickFillMethod('check')">تمام مبلغ چک</button>
                    </div>
                    <div class="pay-input-wrap">
                        <input type="text" class="pay-amount-input" id="checkInput" oninput="onPaymentInputChanged('check')">
                        <span class="input-unit">تومان</span>
                    </div>

                    <!-- فیلدهای تکمیلی چک صیادی -->
                    <div class="check-fields-box" id="checkFieldsBox" style="display: none;">
                        <div style="display: flex; flex-direction: column; gap: 3px;">
                            <label style="font-size: 11px; font-weight: 700;">شماره چک / شناسه صیادی (۱۶ رقمی):</label>
                            <input type="text" id="checkNumberInput" placeholder="۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶" style="height: 38px; border-radius: 8px; border: 1px solid var(--border); padding: 0 10px; font-family: inherit; font-size: 12px;">
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 3px;">
                            <label style="font-size: 11px; font-weight: 700;">نام بانک صادرکننده:</label>
                            <input type="text" id="checkBankInput" placeholder="مثلاً: بانک ملی شعبه مرکزی" style="height: 38px; border-radius: 8px; border: 1px solid var(--border); padding: 0 10px; font-family: inherit; font-size: 12px;">
                        </div>

                        <!-- انتخاب‌گر تاریخ شمسی به ترتیب روز، ماه، سال -->
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <label style="font-size: 11px; font-weight: 700;">تاریخ سررسید چک (روز / ماه / سال):</label>
                            <div class="persian-date-group">
                                <select class="p-date-select day" id="persianDaySelect"></select>
                                <select class="p-date-select month" id="persianMonthSelect"></select>
                                <select class="p-date-select year" id="persianYearSelect"></select>
                            </div>
                            <div class="due-pills-row">
                                <button type="button" class="due-pill" onclick="setCheckDueDaysPersian(15)">+۱۵ روزه</button>
                                <button type="button" class="due-pill" onclick="setCheckDueDaysPersian(30)">+۳۰ روزه (۱ ماه)</button>
                                <button type="button" class="due-pill" onclick="setCheckDueDaysPersian(45)">+۴۵ روزه</button>
                                <button type="button" class="due-pill" onclick="setCheckDueDaysPersian(60)">+۶۰ روزه (۲ ماه)</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ۴. نسیه (مانده در دفتر حساب) -->
                <div class="pay-card">
                    <div class="pay-card-header">
                        <div class="pay-card-title credit">
                            <span class="material-symbols-outlined">pending_actions</span>
                            <span>نسیه (مانده در دفتر حساب)</span>
                        </div>
                        <button type="button" class="quick-btn" onclick="quickFillMethod('credit')">تمام مبلغ نسیه</button>
                    </div>
                    <div style="font-size: 12px; color: var(--text-secondary); display: flex; justify-content: space-between; align-items: center; padding: 4px 0;">
                        <span>مانده تسویه‌نشده خودکار در بدهی مشتری ثبت می‌شود:</span>
                        <strong id="creditAutoAmount" style="color: #ea580c; font-size: 13px;">۰ تومان</strong>
                    </div>
                </div>

            </section>

            <!-- ۵. دکمه ثبت نهایی زیر تمام بخش‌ها -->
            <div class="submit-order-box">
                <button type="button" class="submit-order-btn" id="submitOrderBtn" onclick="openFinalConfirmModal()">
                    <span class="material-symbols-outlined">check_circle</span>
                    <span>ثبت نهایی سفارش و صدور فاکتور</span>
                </button>
            </div>

        </main>

        <!-- مدال تایید نهایی قبل از صدور فاکتور -->
        <div class="modal-overlay" id="finalConfirmModal">
            <div class="confirm-pay-sheet">
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 10px;">
                    <h3 style="font-size: 15px; font-weight: 800; margin: 0;">تایید نهایی صدور فاکتور</h3>
                    <button type="button" style="background:none; border:none; cursor:pointer;" onclick="closeFinalConfirmModal()">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div class="confirm-recap-box">
                    <div class="confirm-recap-row">
                        <span>مشتری:</span>
                        <strong id="recapCustName"></strong>
                    </div>
                    <div class="confirm-recap-row">
                        <span>جمع ناخالص:</span>
                        <strong id="recapSubtotal"></strong>
                    </div>
                    <div class="confirm-recap-row">
                        <span>مجموع تخفیف:</span>
                        <strong id="recapDiscount" style="color: #ea580c;"></strong>
                    </div>
                    <div class="confirm-recap-row highlight">
                        <span>مبلغ نهایی فاکتور:</span>
                        <strong id="recapFinal"></strong>
                    </div>
                    <div class="confirm-recap-row" style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                        <span>نحوه تسویه:</span>
                        <span id="recapPayments"></span>
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
                    <button type="button" class="submit-order-btn" style="height: 44px; font-size: 13.5px;" onclick="executeOrderSubmission()">
                        <span class="material-symbols-outlined">verified</span>
                        <span>بله، ثبت فاکتور و صدور پرینت</span>
                    </button>
                    <button type="button" class="confirm-cancel-btn" style="height: 38px;" onclick="closeFinalConfirmModal()">
                        انصراف و ویرایش
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
                        <h3 style="font-size: 15px; margin: 0;">فاکتور فروش صادر شد</h3>
                    </div>
                    <button type="button" style="background:none; border:none; color:#fff; cursor:pointer;" onclick="finishAndGoToDashboard()">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div class="thermal-receipt-paper" id="thermalReceiptPaper"></div>

                <div class="thermal-modal-actions">
                    <button type="button" class="print-receipt-btn" onclick="printThermalReceipt()">
                        <span class="material-symbols-outlined">print</span>
                        <span>چاپ فاکتور حرارتی (۸۰mm)</span>
                    </button>
                    <button type="button" class="close-receipt-btn" onclick="finishAndGoToDashboard()">
                        <span>بازگشت به داشبورد ویزیتور</span>
                    </button>
                </div>
            </div>
        </div>

    </div>

    <script>
        const API_TOKEN = '<?php echo $apiToken; ?>';
    </script>
    <script src="./js/payment.js?v=<?php echo time(); ?>"></script>
</body>

</html>
