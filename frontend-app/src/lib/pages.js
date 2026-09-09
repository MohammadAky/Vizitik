/**
 * تعریف هر صفحه — عیناً مطابق فایل PHP مربوطه.
 *  php:      نام فایل مرجع در frontend/
 *  title:   متن <h1> همان صفحه (برای کامپوننت‌های هدر)
 *  doc:     متن داخل <title> همان فایل PHP (عنوان سند)
 *  h1:      همان title؛ نگه داشته تا جای دیگری لازم شد خوانده شود
 *  css:     استایل(های) اختصاصی که آن صفحه بارگذاری می‌کند (style.css همیشه هست)
 *  nav:      ردیف نوار ناوبری پایینِ **همان صفحه** (در PHP هر صفحه nav خودش را hard-code
 *            کرده؛ مشتریان و بارگیری خودرو nav ندارند چون در فایل PHPشان کامنت شده است)
 *  drawer:   منوی کشویی (فقط داشبورد در نسخهٔ PHP دارد)
 *  fab:      دکمهٔ شناور «ثبت فاکتور جدید» (فقط داشبورد)
 */

// آیتم‌های پایه — همان ۵ آیتم داشبورد، با همان آیکون/برچسب/عنوان
export const DASH_NAV = [
  { view: 'dash', label: 'داشبورد', icon: 'dashboard' },
  { view: 'van', label: 'بارگیری خودرو', icon: 'local_shipping' },
  { view: 'customers', label: 'مشتریان', icon: 'group', title: 'پرونده مشتریان', aria: 'مشتریان' },
  { view: 'orders', label: 'سفارشات', icon: 'receipt_long' },
  { view: 'collect', label: 'وصول مطالبات', icon: 'payments' }
];

// نسخهٔ ۴ آیتمی صفحات تنظیمات/راهنما/درباره (بدون سفارشات، با برچسب‌های خودشان)
export const SHORT_NAV = [
  { view: 'dash', label: 'داشبورد', icon: 'dashboard' },
  { view: 'van', label: 'بارگیری خودرو', icon: 'local_shipping' },
  { view: 'customers', label: 'مشتریان', icon: 'group' },
  { view: 'collect', label: 'وصول مطالبات', icon: 'payments' }
];

export const PAGES = {
  dash: {
    php: 'dashboard.php',
    title: 'داشبورد ویزیتور', doc: 'داشبورد ویزیتور',
    css: [],
    nav: { items: DASH_NAV, active: 'dash' },
    drawer: true,
    fab: true
  },
  van: { php: 'van-loading.php', title: 'بارگیری خودرو', doc: 'بارگیری و تحویل بار خودرو', h1: 'بارگیری و موجودی خودرو', css: ['van-loading'], nav: null },
  customers: { php: 'customers.php', title: 'مشتریان', doc: 'مشتریان و فروشگاه‌ها', h1: 'لیست مشتریان و فروشگاه‌ها', css: ['customers'], nav: null },
  orders: {
    php: 'orders.php',
    title: 'مدیریت و اصلاح فاکتورها', doc: 'مدیریت و ویرایش جامع فاکتورها', h1: 'مدیریت و اصلاح فاکتورها',
    css: ['orders', 'payment'],
    nav: { items: DASH_NAV, active: 'orders' }
  },
  collect: {
    php: 'collections.php',
    title: 'وصول مطالبات', doc: 'وصول مطالبات و مدیریت چک‌ها', h1: 'وصول مطالبات و دفتر حساب',
    css: ['collections'],
    nav: { items: DASH_NAV, active: 'collect' }
  },
  order: { php: 'new-order.php', title: 'ثبت فاکتور جدید', doc: 'ثبت سفارش از موجودی خودرو', h1: 'ثبت سفارش و صدور فاکتور', css: ['new-order'], nav: null },
  products: { php: 'products.php', title: 'لیست کالاها', doc: 'کاتالوگ و لیست کالاها', h1: 'لیست کالاها و کاتالوگ', css: ['products'], nav: null },
  payment: { php: 'payment.php', title: 'تسویه حساب', doc: 'تسویه و پرداخت فاکتور', h1: 'تسویه و تسهیم پرداخت', css: ['payment'], nav: null },
  settings: {
    php: 'settings.php',
    title: 'تنظیمات', doc: 'تنظیمات و پروفایل', h1: 'تنظیمات و پروفایل',
    css: ['settings'],
    nav: {
      items: [
        { view: 'dash', label: 'داشبورد', icon: 'dashboard' },
        { view: 'van', label: 'بارگیری ون', icon: 'local_shipping' },
        { view: 'customers', label: 'مشتریان', icon: 'group' },
        { view: 'collect', label: 'مطالبات', icon: 'payments' }
      ],
      active: null
    }
  },
  bale: { php: 'bale-bot.php', title: 'مدیریت ربات بله', doc: 'مدیریت ربات بله و اطلاع‌رسانی', h1: 'سامانه پیام‌رسان و ربات بله', css: ['settings', 'bale-bot'], nav: null },
  help: { php: 'help.php', title: 'راهنما و پشتیبانی', doc: 'راهنما و پشتیبانی', h1: 'راهنما و پشتیبانی', css: ['inline-help'], nav: { items: SHORT_NAV, active: null } },
  about: { php: 'about.php', title: 'درباره ویزیتیک', doc: 'درباره نرم‌افزار', h1: 'درباره ویزیتیک', css: ['inline-about'], nav: { items: SHORT_NAV, active: null } }
};

/** آیتم‌های منوی کشویی — دقیقاً ۵ مورد side-menu-list در dashboard.php */
export const DRAWER_ITEMS = [
  { view: 'orders', icon: 'receipt_long', label: 'مدیریت و اصلاح فاکتورها' },
  { view: 'bale', icon: 'smart_toy', label: 'مدیریت ربات بله' },
  { view: 'settings', icon: 'settings', label: 'تنظیمات' },
  { view: 'help', icon: 'help', label: 'راهنما و پشتیبانی' },
  { view: 'about', icon: 'info', label: 'درباره ویزیتیک' }
];
