<?php
/**
 * ============================================================
 * حساب‌چین — تمپلیت پایه و استاندارد برای صفحات جدید (template.php)
 * ============================================================
 * این فایل به عنوان قالب مرجع برای توسعه صفحات جدید (مشتریان، فاکتور، چک‌ها و...) استفاده می‌شود.
 */
require_once 'auth_helper.php';
requireLogin();

// جلوگیری از کش شدن صفحه در مرورگر
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");

$pageTitle = "عنوان صفحه نمونه";
$subtitle = "توضیح کوتاه صفحه";
?>
<!DOCTYPE html>
<html dir="rtl" lang="fa">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>حسابچین — <?php echo htmlspecialchars($pageTitle); ?></title>

    <!-- فونت وزیرمتن و آیکون‌های گوگل -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />

    <!-- استایل پایه برنامه -->
    <link rel="stylesheet" href="./css/style.css">
</head>

<body>
    <div class="app" id="app">

        <!-- ۱. هدر استاندارد: دکمه اکشن در راست و دکمه بازگشت در چپ -->
        <header class="page-header">
            <div class="header-top-row">
                <!-- دکمه اکشن / منوی سمت راست -->
                <button type="button" class="header-action-btn" id="rightActionBtn" aria-label="منو">
                    <span class="material-symbols-outlined">menu</span>
                </button>

                <div class="header-title-box">
                    <h1><?php echo htmlspecialchars($pageTitle); ?></h1>
                    <span class="header-sub"><?php echo htmlspecialchars($subtitle); ?></span>
                </div>

                <!-- دکمه بازگشت به داشبورد (سمت چپ) -->
                <a href="dashboard.php" class="back-btn" aria-label="بازگشت">
                    <span class="material-symbols-outlined">arrow_back</span>
                </a>
            </div>

            <!-- نوار جستجو (در صورت نیاز) -->
            <div class="search-box">
                <span class="material-symbols-outlined search-icon">search</span>
                <input type="text" id="searchInput" placeholder="جستجو در این صفحه...">
            </div>
        </header>

        <!-- ۲. بدنه اصلی محتوا -->
        <main class="page-content" id="mainContent">
            
            <!-- نمونه کارت استاندارد -->
            <article class="standard-card">
                <div class="card-top-row">
                    <div class="card-icon-box">
                        <span class="material-symbols-outlined">description</span>
                    </div>
                    <div class="card-main-info">
                        <h2 class="card-title">عنوان آیتم نمونه</h2>
                        <span class="card-subtext">توضیحات و مشخصات تکمیلی آیتم</span>
                    </div>
                    <button type="button" class="card-edit-btn" title="ویرایش">
                        <span class="material-symbols-outlined">edit</span>
                    </button>
                </div>
            </article>

        </main>

        <!-- ۳. دکمه شناور افزودن (FAB) در گوشه پایین چپ -->
        <button type="button" class="fab-btn" id="fabAddBtn" title="افزودن">
            <span class="material-symbols-outlined">add</span>
        </button>

        <!-- ۴. مودال استاندارد پاپ‌آپ -->
        <div class="modal-overlay" id="pageModal" style="display: none;">
            <div class="modal-card">
                <div class="modal-header">
                    <h3 id="modalTitle">عنوان فرم مودال</h3>
                    <button type="button" class="modal-close" onclick="closeModal()">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <form class="modal-form" id="modalForm">
                    <div class="modal-input-group">
                        <label>عنوان فیلد ۱</label>
                        <input type="text" placeholder="مقدار را وارد کنید" required>
                    </div>

                    <div class="modal-input-row">
                        <div class="modal-input-group">
                            <label>فیلد ۲ (ردیف دو ستونه)</label>
                            <input type="text" required>
                        </div>
                        <div class="modal-input-group">
                            <label>فیلد ۳</label>
                            <input type="number" required>
                        </div>
                    </div>

                    <button type="submit" class="modal-submit-btn">ذخیره اطلاعات</button>
                </form>
            </div>
        </div>

    </div>

    <script>
        const API_TOKEN = '<?php echo getAccessToken(); ?>';

        function openModal() {
            const modal = document.getElementById('pageModal');
            if (modal) modal.style.display = 'flex';
        }

        function closeModal() {
            const modal = document.getElementById('pageModal');
            if (modal) modal.style.display = 'none';
        }
    </script>
</body>

</html>
