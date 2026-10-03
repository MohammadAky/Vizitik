/**
 * شمارهٔ موبایل، یک‌جا و درست.
 *
 * چرا این فایل وجود دارد: شماره‌ای که کاربر تایپ می‌کند و شماره‌ای که بله برای ربات
 * می‌فرستد یکی نیستند و شکل‌های زیادی دارند -
 *
 *   ۰۹۰۱۱۸۱۸۲۱۹   (کیبورد فارسی: ارقام فارسی‌اند و نه ASCII)
 *   +98 901 181 8219 · 0098-901-181-8219 · 989011818219 · 9011818219
 *
 * اگر هر بخش کد شکلِ خودش را «نرمال» کند، کد ورود به آدرسِ اشتباه می‌رود: چت بله با
 * یک شکل ذخیره می‌شود و برنامه با شکل دیگری می‌پرسد و نتیجه «کد ارسال نشد» است.
 * پس همه‌جا از همین دو تابع استفاده می‌شود.
 */

const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC = '٠١٢٣٤٥٦٧٨٩';

/** ارقام فارسی/عربی را به ارقام لاتین برمی‌گرداند (بقیهٔ متن دست‌نخورده می‌ماند). */
export function faDigits(value: unknown): string {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC.indexOf(d)));
}

/**
 * همهٔ شکل‌های یک شمارهٔ ایرانی را به `09xxxxxxxxx` تبدیل می‌کند.
 * برای شماره‌های ناشناخته (غیرایرانی) فقط ارقام باقی می‌مانند تا چیزی خراب نشود.
 */
export function normalizePhone(value: unknown): string {
  let digits = faDigits(value).replace(/[^0-9]/g, '');
  if (digits.startsWith('0098')) digits = digits.slice(4);
  else if (digits.startsWith('98') && digits.length === 12) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('9')) digits = '0' + digits;
  return digits;
}

/** آیا این متن، فقط یک شمارهٔ موبایل ایرانی است؟ (برای پیامی که کاربر به‌جای دکمه تایپ می‌کند) */
export function looksLikeMobile(value: unknown): boolean {
  const text = faDigits(value).replace(/\/start\b/gi, '');
  // فقط ارقام/جداکننده‌ها/پیش‌شماره بین‌المللی مجاز است، نه جمله
  if (!/^[\s0-9+()\-–—.]+$/.test(text)) return false;
  const digits = text.replace(/[^0-9]/g, '');
  return /^(?:0098|98|0)?9\d{9}$/.test(digits);
}
