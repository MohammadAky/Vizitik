/**
 * شکستن/نرمال‌سازی موجودی خودرو بر اساس ظرفیت کارتن.
 *
 * قاعدهٔ ذخیره‌سازی (اینورینت کل سیستم):
 *   موجودی هر کالا همیشه «شکسته‌شده» نگه داشته می‌شود یعنی
 *   0 <= quantityUnits < unitsPerCarton
 *   و مجموع دانهٔ واقعی = cartons * unitsPerCarton + units
 *
 * تمام محاسبات (کسر فروش، بازگردانی ابطال، بارگیری) اول به «مجموع دانه»
 * تبدیل و سپس دوباره با همین ابزار شکسته می‌شود تا حالتی مثل
 * «۰ کارتن + ۲۴ دانه از کارتن ۲۴تایی» که ذخیره/نمایش/کسر را خراب می‌کرد
 * دیگر رخ ندهد.
 */

/** تبدیل کارتن+دانه به مجموع دانه (ظرفیت کارتن همیشه حداقل ۱) */
export function toTotalSingleUnits(
  cartons: number,
  units: number,
  unitsPerCarton: number,
): number {
  const upc = Math.max(1, Math.floor(Number(unitsPerCarton)) || 1);
  const c = Math.max(0, Math.floor(Number(cartons) || 0));
  const u = Math.max(0, Math.floor(Number(units) || 0));
  return c * upc + u;
}

/** شکستن مجموع دانه به کارتنِ کامل + دانهٔ باقی‌مانده */
export function splitByCarton(
  totalSingleUnits: number,
  unitsPerCarton: number,
): { cartons: number; units: number; upc: number } {
  const upc = Math.max(1, Math.floor(Number(unitsPerCarton)) || 1);
  const total = Math.max(0, Math.floor(Number(totalSingleUnits) || 0));
  return {
    cartons: Math.floor(total / upc),
    units: total % upc,
    upc,
  };
}

/** موجودی خام (احتمالاً شکسته‌نشده) را به فرم استاندارد شکسته برمی‌گرداند */
export function normalizeStock(
  cartons: number,
  units: number,
  unitsPerCarton: number,
): { cartons: number; units: number; totalSingleUnits: number } {
  const totalSingleUnits = toTotalSingleUnits(cartons, units, unitsPerCarton);
  const split = splitByCarton(totalSingleUnits, unitsPerCarton);
  return { cartons: split.cartons, units: split.units, totalSingleUnits };
}
