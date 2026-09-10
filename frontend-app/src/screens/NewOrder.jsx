import { useEffect, useMemo, useState } from "react";
import { apiSilent } from "../lib/api.js";
import { useLocalData } from "../lib/data.js";
import { enqueue } from "../lib/sync.js";
import { computeOrderTotals, generateLocalUuid } from "../lib/pricing.js";
import { formatPrice, toPersianNum, onlyDigits, parseFaNumber } from "../lib/format.js";
import { usePhpPage } from "../lib/usePhpPage.js";
import { showToast } from "../components/AppToast.jsx";

const CUST_KEY = "vizitik_current_order";

/**
 * ثبت سفارش و صدور فاکتور — پورت ساختاری از frontend/new-order.php
 * (هدر تیره با header-van-btn، کارت انتخاب مشتری، لیست کالاهای بار با استپر،
 *  خلاصه محاسبات و شیت تأیید نهایی) — همان کلاس‌های new-order.css
 */
export default function NewOrder({ go }) {
  const page = usePhpPage("order");
  const { customers, inventory, online, reload } = useLocalData();
  const [custId, setCustId] = useState(() => sessionStorage.getItem(CUST_KEY) || "");
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("ALL");
  const [qty, setQty] = useState({});
  const [confirm, setConfirm] = useState(false);
  const [cash, setCash] = useState("");
  const [pos, setPos] = useState("");
  const [check, setCheck] = useState("");
  const [discounts, setDiscounts] = useState([]);
  const [newPct, setNewPct] = useState("");

  const bar = useMemo(
    () => inventory.filter((i) => (i.quantityCartons || 0) > 0 || (i.quantityUnits || 0) > 0),
    [inventory],
  );
  const cats = useMemo(() => Array.from(new Set(bar.map((b) => b.category || "سایر"))), [bar]);
  const cust = (customers || []).find((c) => c.id === custId) || null;

  useEffect(() => {
    if (custId) sessionStorage.setItem(CUST_KEY, custId);
    else sessionStorage.removeItem(CUST_KEY);
  }, [custId]);

  const lines = useMemo(
    () =>
      bar
        .filter((p) => {
          const q = (search || "").trim().toLowerCase();
          const okQ = !q || (p.productName || "").toLowerCase().includes(q);
          const okC = cat === "ALL" || (p.category || "سایر") === cat;
          return okQ && okC;
        })
        .map((p) => {
          const k = qty[p.productId] || { c: 0, u: 0 };
          return { ...p, cartonCount: k.c, unitCount: k.u };
        }),
    [bar, search, cat, qty],
  );

  const chosen = lines.filter((l) => l.cartonCount > 0 || l.unitCount > 0);
  const totals = computeOrderTotals(chosen, discounts);
  const cashNum = parseFaNumber(cash, 0) || 0;
  const posNum = parseFaNumber(pos, 0) || 0;
  const checkNum = parseFaNumber(check, 0) || 0;
  const paid = cashNum + posNum + checkNum;
  const credit = Math.max(0, totals.finalAmount - paid);

  function step(id, key, delta, max) {
    setQty((prev) => {
      const cur = { c: 0, u: 0, ...(prev[id] || {}) };
      const k = key === "cartonCount" ? "c" : "u";
      const val = Math.max(0, Math.min(max ?? Infinity, (cur[k] || 0) + delta));
      return { ...prev, [id]: { ...cur, [k]: val } };
    });
  }

  async function submit() {
    const payload = {
      customerId: custId,
      localUuid: generateLocalUuid(),
      items: chosen.map((l) => ({
        productId: l.productId,
        cartonCount: l.cartonCount,
        unitCount: l.unitCount,
      })),
      discountSteps: discounts.map((v) => ({ type: "percent", value: parseFaNumber(v, 0) })),
      payments: [
        ...(cashNum > 0 ? [{ method: "CASH", amount: cashNum }] : []),
        ...(posNum > 0 ? [{ method: "CARD", amount: posNum }] : []),
        ...(checkNum > 0 ?
          [
            {
              method: "CHECK",
              amount: checkNum,
              checkDetails: {
                checkNumber: "---",
                bankName: "بانک",
                dueDate: new Date().toISOString(),
              },
            },
          ]
        : []),
      ],
    };
    try {
      if (!navigator.onLine) throw new Error("offline");
      await (
        await import("../lib/api.js")
      ).api("/orders", { method: "POST", body: payload, timeout: 20000 });
      showToast("فاکتور صادر و بار خودرو به‌روزرسانی شد.", "success");
    } catch (e) {
      await enqueue("ORDER", payload);
      showToast("آفلاین — فاکتور در صف همگام‌سازی ثبت شد.", "warning");
    }
    setQty({});
    setCash("");
    setPos("");
    setCheck("");
    setDiscounts([]);
    setConfirm(false);
    await reload({ sync: true });
    go("orders");
  }

  return (
    <>
      <header className="order-header">
        <div className="header-top-row">
          <div className="header-right-group">
            <a
              href="#/van"
              className="header-van-btn"
              title="مشاهده و بارگیری کالاهای خودرو"
              aria-label="بارگیری خودرو"
              onClick={(e) => {
                e.preventDefault();
                go("van");
              }}>
              <span className="material-symbols-outlined">local_shipping</span>
            </a>
            <div className="header-title-box">
              <h1>{page.h1}</h1>
              <span className="header-sub">انتخاب از موجودی بار خودرو</span>
            </div>
          </div>

          <a
            href="#/dash"
            className="back-btn"
            aria-label="بازگشت به داشبورد"
            onClick={(e) => {
              e.preventDefault();
              go("dash");
            }}>
            <span className="material-symbols-outlined">arrow_forward</span>
          </a>
        </div>

        {/* کارت انتخاب مشتری */}
        <div className="customer-select-card" onClick={() => setPicker(true)}>
          <div className="customer-info-preview">
            <div className="cust-avatar-mini">
              <span className="material-symbols-outlined">storefront</span>
            </div>
            <div className="cust-details">
              <span className="cust-name">{cust ? cust.name : "انتخاب مشتری / فروشگاه"}</span>
              <span
                className={`cust-debt-badge ${cust && cust.currentDebt > 0 ? "debt" : ""}`.trim()}>
                {cust ?
                  `مانده: ${formatPrice(cust.currentDebt || 0)} ت`
                : "برای شروع، فروشگاه را انتخاب کنید"}
              </span>
            </div>
          </div>
          <div className="change-cust-text">
            <span>تغییر</span>
            <span className="material-symbols-outlined">expand_more</span>
          </div>
        </div>

        {/* جستجو و دسته‌ها */}
        <div className="search-filter-box">
          <div className="search-input-wrap">
            <span className="material-symbols-outlined">search</span>
            <input
              type="text"
              placeholder="جستجو در بار خودرو..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="category-pills-row">
            <button
              type="button"
              className={`cat-pill ${cat === "ALL" ? "active" : ""}`}
              onClick={() => setCat("ALL")}>
              همه
            </button>
            {cats.map((c) => (
              <button
                key={c}
                type="button"
                className={`cat-pill ${cat === c ? "active" : ""}`}
                onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="order-content">
        {bar.length === 0 ?
          <div className="empty-van-box">
            <span className="material-symbols-outlined">local_shipping</span>
            <h3>بار خودرو خالی است</h3>
            <p>ابتدا موجودی خودرو را در بخش بارگیری ثبت کنید تا امکان صدور فاکتور فراهم شود.</p>
            <button type="button" className="goto-loading-btn" onClick={() => go("van")}>
              {/* <span className="material-symbols-outlined">inventory_2</span> */}
              <span>رفتن به بارگیری خودرو</span>
            </button>
          </div>
        : <div className="order-product-list">
            {lines.map((p) => (
              <div className="product-order-card" key={p.productId}>
                <div className="prod-card-top">
                  <div className="prod-main-meta">
                    <div className="prod-title-line">
                      <span className="prod-title">{p.productName}</span>
                      <span className="prod-brand-tag">{p.brand || "متفرقه"}</span>
                    </div>
                    <div className="prod-prices-line">
                      کارتن: <strong>{formatPrice(p.cartonPrice)}</strong> · دانه:{" "}
                      <strong>{formatPrice(p.unitPrice)}</strong>
                    </div>
                  </div>
                  <div className="line-total-badge-row">
                    <span
                      className={`van-stock-badge ${p.cartonCount + p.unitCount > 0 ? "has-quantity" : ""}`}>
                      {p.cartonCount + p.unitCount > 0 ?
                        `${toPersianNum(p.cartonCount)} کارتن / ${toPersianNum(p.unitCount)} دانه`
                      : "بدون انتخاب"}
                    </span>
                  </div>
                </div>

                <div className="prod-steppers-container">
                  <div className="steppers-row">
                    <div className="stepper-item">
                      <div className="stepper-title">
                        <span>کارتن</span>
                        <span>{toPersianNum(p.quantityCartons || 0)} در بار</span>
                      </div>
                      <div className="stepper-control">
                        <button
                          type="button"
                          className="step-btn"
                          onClick={() => step(p.productId, "cartonCount", -1)}>
                          -
                        </button>
                        <input
                          className="step-input"
                          type="number"
                          min="0"
                          value={p.cartonCount}
                          readOnly
                        />
                        <button
                          type="button"
                          className="step-btn"
                          onClick={() =>
                            step(p.productId, "cartonCount", 1, p.quantityCartons || 0)
                          }>
                          +
                        </button>
                      </div>
                    </div>
                    <div className="stepper-item">
                      <div className="stepper-title">
                        <span>دانه</span>
                        <span>{toPersianNum(p.quantityUnits || 0)} در بار</span>
                      </div>
                      <div className="stepper-control">
                        <button
                          type="button"
                          className="step-btn"
                          onClick={() => step(p.productId, "unitCount", -1)}>
                          -
                        </button>
                        <input
                          className="step-input"
                          type="number"
                          min="0"
                          value={p.unitCount}
                          readOnly
                        />
                        <button
                          type="button"
                          className="step-btn"
                          onClick={() => step(p.productId, "unitCount", 1, p.quantityUnits || 0)}>
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        }

        {/* تخفیفات پلکانی */}
        {chosen.length > 0 && (
          <div className="order-calc-breakdown">
            <div className="calc-row-left">
              <span className="calc-label">جمع ناخالص:</span>
              <span className="calc-amount calc-subtotal">{formatPrice(totals.subtotal)} ت</span>
            </div>
            {totals.discountSteps.map((s, i) => (
              <div className="calc-row-right" key={i}>
                <span className="calc-label">
                  پله {toPersianNum(i + 1)} ({toPersianNum(s.value)}٪):
                </span>
                <span className="calc-amount">-{formatPrice(s.stepDiscount)} ت</span>
              </div>
            ))}
            <div className="calc-row-left">
              <span className="calc-label">مجموع تخفیف:</span>
              <span className="calc-amount">-{formatPrice(totals.totalDiscount)} ت</span>
            </div>
            <div className="calc-final-amount">
              <span className="calc-final-label">مبلغ نهایی فاکتور:</span>
              <strong>{formatPrice(totals.finalAmount)} تومان</strong>
            </div>
            <div className="confirm-actions-row">
              <input
                className="step-input"
                type="text"
                inputMode="numeric"
                placeholder="٪"
                value={newPct}
                onChange={(e) => setNewPct(onlyDigits(e.target.value))}
              />
              <button
                type="button"
                className="step-btn"
                onClick={() => {
                  const v = parseFaNumber(newPct, 0);
                  if (v && v >= 1 && v <= 100) {
                    setDiscounts([...discounts, v]);
                    setNewPct("");
                  } else {
                    showToast("درصد تخفیف معتبر نیست (بین ۱ تا ۱۰۰).", "error");
                  }
                }}>
                + پله تخفیف
              </button>
              {discounts.map((v, i) => (
                <span className="cat-pill active" key={`${v}_${i}`}>
                  پله {toPersianNum(i + 1)}: {toPersianNum(v)}٪
                </span>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* نوار پایینی chckout */}
      {chosen.length > 0 && (
        <div className="order-bottom-bar">
          <button
            type="button"
            className="checkout-cta-btn"
            onClick={() => setConfirm(true)}
            disabled={!cust}>
            <span className="material-symbols-outlined">receipt_long</span>
            <span>بررسی و ثبت نهایی فاکتور</span>
          </button>
        </div>
      )}

      {/* شیت انتخاب مشتری */}
      <div
        className="modal-overlay"
        style={{ display: picker ? "flex" : "none" }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setPicker(false);
        }}>
        <div className="customer-picker-sheet">
          <h3 style={{ fontSize: "14px", fontWeight: 800, marginBottom: "10px" }}>
            انتخاب فروشگاه
          </h3>
          <div className="picker-cust-list">
            {(customers || []).map((c) => (
              <div
                key={c.id}
                className="picker-cust-item"
                onClick={() => {
                  setCustId(c.id);
                  setPicker(false);
                }}>
                <div>
                  <div className="cust-name">{c.name}</div>
                  <span style={{ color: "var(--text-muted)" }}>{c.address || ""}</span>
                </div>
                <span className={`badge ${c.currentDebt > 0 ? "danger" : "success"}`}>
                  {formatPrice(c.currentDebt || 0)} ت
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* شیت تأیید نهایی */}
      <div
        className="modal-overlay"
        style={{ display: confirm ? "flex" : "none" }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setConfirm(false);
        }}>
        <div className="confirm-order-sheet">
          <h3 style={{ fontSize: "14px", fontWeight: 800, marginBottom: "10px" }}>
            تأیید و صدور فاکتور
          </h3>

          <div className="confirm-items-list">
            {chosen.map((l) => (
              <div className="confirm-item-row" key={l.productId}>
                <span>{l.productName}</span>
                <strong>
                  {formatPrice(l.cartonCount * l.cartonPrice + l.unitCount * l.unitPrice)}
                </strong>
              </div>
            ))}
          </div>

          <div className="confirm-actions-row">
            {[
              ["نقدی", cash, setCash],
              ["پوز", pos, setPos],
              ["چک", check, setCheck],
            ].map(([label, val, set]) => (
              <div className="confirm-item-row" key={label}>
                <span>{label} (تومان)</span>
                <input
                  className="step-input"
                  type="text"
                  inputMode="numeric"
                  value={val}
                  onChange={(e) => set(onlyDigits(e.target.value))}
                />
              </div>
            ))}
          </div>

          <div className="calc-row-left">
            <span>مانده نسیه (دفتر حساب):</span>
            <strong>{formatPrice(credit)} تومان</strong>
          </div>

          <button type="button" className="confirm-submit-btn" onClick={submit}>
            <span className="material-symbols-outlined">check_circle</span>
            <span>{navigator.onLine ? "ثبت فاکتور و کسر از بار" : "ثبت در صف آفلاین"}</span>
          </button>
          <button type="button" className="confirm-cancel-btn" onClick={() => setConfirm(false)}>
            انصراف
          </button>
        </div>
      </div>
    </>
  );
}
