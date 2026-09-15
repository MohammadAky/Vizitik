/**
 * تنظیمات مرکزی اپلیکیشن (برند/هویت) — نام نرم‌افزار ثابت و هاردکد است.
 *
 * نام نرم‌افزار دیگر از .env خوانده نمی‌شود (متغیرهای APP_NAME_FA /
 * APP_NAME_EN حذف شده‌اند). اگر روزی نیاز به تغییر نام بود، همین ثابت‌ها و
 * معادل‌هایشان را در کل ریپو جست‌و‌جو و عوض کن:
 *   - PWA:    frontend-app/src/lib/brand.js و frontend-app/vite.config.js
 *   - API:    همین فایل
 *   - لینک‌ها و titleها: admin/، frontend/ (PHP)، landing/
 * (گشتن: grep -rn "ویزیتیک" و grep -rn "Vizitik")
 */

export const APP = {
  /** نام نمایشی فارسی نرم‌افزار (مثلاً در پیام‌های بله و رابط) */
  nameFa: 'ویزیتیک',
  /** نام انگلیسی نرم‌افزار */
  nameEn: 'Vizitik',
};

export const BOT = {
  /** نام‌کاربری ربات بله (بدون @) */
  username: process.env.BALE_BOT_USERNAME || 'Vizitik_bot',
  /** لینک ربات در بله */
  link: process.env.BALE_BOT_LINK || `https://ble.ir/${process.env.BALE_BOT_USERNAME || 'Vizitik_bot'}`,
};
