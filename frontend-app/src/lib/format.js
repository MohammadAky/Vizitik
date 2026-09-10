// همان‌طور که در auth_helper.php پیاده شده بود — نسخهٔ جاوااسکریپت
const PERSIAN = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const ENGLISH = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
// ارقام عربی (کیبورد بعضی گوشی‌ها) — ٠١٢٣٤٥٦٧٨٩
const ARABIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function toPersianNum(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[0-9]/g, (d) => PERSIAN[ENGLISH.indexOf(d)]);
}

/**
 * تبدیل ارقام فارسی/عربی به انگلیسی.
 * علت: parseFloat/parseInt و input[type=number] ارقام فارسی را نمی‌فهمند؛
 * کاربر با کیبورد فارسی «۷۲۰۰۰۰» می‌زند و بدون این تبدیل، قیمت ۰ یا NaN ثبت می‌شد.
 */
export function faToEn(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[۰-۹]/g, (d) => ENGLISH[PERSIAN.indexOf(d)])
    .replace(/[٠-٩]/g, (d) => ENGLISH[ARABIC.indexOf(d)]);
}

/**
 * فقط ارقام انگلیسی (برای ورودی‌های مبلغ/تلفن/کد که عدد صحیح‌اند).
 * برخلاف ‎/[^0-9]/g‎ خالی، ارقام فارسی را اول به انگلیسی برمی‌گرداند تا پاک نشوند.
 */
export function onlyDigits(value) {
  return faToEn(value).replace(/[^0-9]/g, '');
}

/**
 * پارس امن اعداد پولی/مقادیری که کاربر تایپ می‌کند:
 * ارقام فارسی/عربی، جداکننده هزارگان (٬ , ،)، فاصله و پسوند «تومان» را تحمل می‌کند.
 * مثال‌ها: «۷۲۰٬۰۰۰» → 720000 ، «720,000 تومان» → 720000 ، «» → fallback
 */
export function parseFaNumber(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const cleaned = faToEn(value).replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '.' || cleaned === '-') return fallback;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

/** نسخه صحیح (int) همان پارس — برای تعداد، درصد و شمارنده‌ها */
export function parseFaInt(value, fallback = 0) {
  const n = parseFaNumber(value, NaN);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

// جداکنندهٔ هزارگان با ارقام فارسی (مثل ۱٬۲۵۰٬۰۰۰)
export function formatPrice(amount) {
  const n = Number(amount || 0);
  const parts = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return toPersianNum(parts);
}

// نمایش فشرده برای کارت‌های داشبورد (میلیون / هزار)
export function formatToman(amount) {
  const val = Number(amount || 0);
  if (val >= 1000000) {
    const inMillion = Math.round((val / 1000000) * 10) / 10;
    return { value: toPersianNum(inMillion), suffix: 'میلیون' };
  }
  if (val >= 1000) {
    const inThousand = Math.round(val / 1000);
    return { value: toPersianNum(inThousand), suffix: 'هزار' };
  }
  return { value: toPersianNum(val), suffix: 'تومان' };
}
