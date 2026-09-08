// همان‌طور که در auth_helper.php پیاده شده بود — نسخهٔ جاوااسکریپت
const PERSIAN = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const ENGLISH = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function toPersianNum(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[0-9]/g, (d) => PERSIAN[ENGLISH.indexOf(d)]);
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
