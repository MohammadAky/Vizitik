/**
 * تنظیمات مرکزی اپلیکیشن (برند/هویت) — خوانده‌شده از .env با پیش‌فرضِ فعلی.
 *
 * اگر بعداً خواستی نام نرم‌افزار را عوض کنی، فقط همین مقادیر را در .env تغییر بده:
 *   APP_NAME_FA="نام جدید فارسی"
 *   APP_NAME_EN="NewName"
 *   BALE_BOT_USERNAME="نام‌کاربری ربات بله"
 */

export const APP = {
  /** نام نمایشی فارسی نرم‌افزار (مثلاً در پیام‌های بله و رابط) */
  nameFa: process.env.APP_NAME_FA || 'ویزیتیک',
  /** نام انگلیسی نرم‌افزار */
  nameEn: process.env.APP_NAME_EN || 'Vizitik',
};

export const BOT = {
  /** نام‌کاربری ربات بله (بدون @) */
  username: process.env.BALE_BOT_USERNAME || 'VizitikBot',
  /** لینک ربات در بله */
  link: process.env.BALE_BOT_LINK || `https://ble.ir/${process.env.BALE_BOT_USERNAME || 'VizitikBot'}`,
};
