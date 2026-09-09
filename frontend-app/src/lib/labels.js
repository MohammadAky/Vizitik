// برچسب‌های فارسی مشترک بین صفحات
const METHOD_FA = { CASH: 'نقدی', CARD: 'کارت / پوز', CHECK: 'چک صیادی', CREDIT: 'نسیه (دفتری)' };
const CHECK_FA = { PENDING: 'در جریان وصول', PASSED: 'پاس شده', BOUNCED: 'برگشتی' };
const CHECK_BADGE = { PENDING: 'warning', PASSED: 'success', BOUNCED: 'danger' };

export function methodFa(m) { return METHOD_FA[m] || m; }
export function checkStatusFa(s) { return CHECK_FA[s] || s; }
export function checkBadge(s) { return CHECK_BADGE[s] || 'muted'; }
