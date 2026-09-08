// موتور محاسبهٔ فاکتور — هم‌راستا با بک‌اند (orders.service.ts computeDiscounts)
// هر پله به تومانِ صحیح گرد می‌شود تا هیچ باقی‌ماندهٔ کسریِ «نسیهٔ ناخواسته» تولید نشود.

/**
 * اقلام: [{ cartonPrice, unitPrice, cartonCount, unitCount }]
 * تخفیف‌ها: [{ type: 'percent'|'fixed', value }] به‌صورت مرتب
 * خروجی: { subtotal, discountSteps:[...], totalDiscount, finalAmount }
 */
export function computeOrderTotals(items, steps = []) {
  const subtotal = Math.round(
    (items || []).reduce(
      (sum, it) => sum + (it.cartonCount || 0) * (it.cartonPrice || 0) + (it.unitCount || 0) * (it.unitPrice || 0),
      0
    )
  );

  const discountSteps = [];
  let current = subtotal;
  let totalDiscount = 0;
  let order = 1;

  for (const s of steps || []) {
    if (!s || Number(s.value) <= 0) continue;
    const value = Math.round(Number(s.value));
    let stepDiscount = 0;
    if (s.type === 'percent') {
      stepDiscount = Math.round((current * value) / 100);
    } else if (s.type === 'fixed') {
      stepDiscount = Math.min(current, value);
    }
    if (stepDiscount > 0) {
      const afterStep = current - stepDiscount;
      discountSteps.push({
        stepOrder: order,
        type: s.type,
        value,
        amountBeforeStep: current,
        stepDiscount,
        amountAfterStep: afterStep
      });
      totalDiscount += stepDiscount;
      current = afterStep;
      order += 1;
    }
  }

  return {
    subtotal,
    discountSteps,
    totalDiscount: Math.round(totalDiscount),
    finalAmount: Math.max(0, Math.round(current))
  };
}

export function generateLocalUuid() {
  return 'ord_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
}
