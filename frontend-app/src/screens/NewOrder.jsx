import { useEffect, useMemo, useState } from "react";
import { useLocalData } from "../lib/data.js";
import { formatPrice, toPersianNum } from "../lib/format.js";
import { usePhpPage } from "../lib/usePhpPage.js";
import { showToast } from "../components/AppToast.jsx";

// انتخاب مشتری جدا از پیش‌نویس سفارش نگه داشته می‌شود تا روی vizitik_current_order نیفتد
// (این کلید مشترک است: صفحهٔ مشتریان مشتری انتخاب‌شده را همین‌جا می‌گذارد)
export const ORDER_CUSTOMER_KEY = "vizitik_order_customer";
const CUST_KEY = ORDER_CUSTOMER_KEY;
const DRAFT_KEY = "vizitik_current_order";

/**
 * ثبت سفارش و صدور فاکتور — پورت ساختاری از frontend/new-order.php + js/new-order.js
 * (هدر تیره با header-van-btn، کارت انتخاب مشتری، لیست کالاهای بار با استپر،
 *  نوار پایینی با جمع اقلام و دکمه ادامه به تسویه، شیت تأیید اقلام و تحویل
 *  پیش‌نویس به صفحه پرداخت از طریق sessionStorage) — همان کلاس‌های new-order.css
 * تخفیف و تسهیم پرداخت در این صفحه نیست — عین PHP در مرحله پرداخت اعمال می‌شود.
 */
export default function NewOrder({ go }) {
  const page = usePhpPage("order");
  const { customers, inventory } = useLocalData();
  const [custId, setCustId] = useState(() => sessionStorage.getItem(CUST_KEY) || "");
  const [picker, setPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("ALL");
  const [qty, setQty] = useState({});
  const [confirm, setConfirm] = useState(false);

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

  // لیست شیت انتخاب مشتری با جستجو (نام/تلفن/آدرس)
  const pickerCustomers = useMemo(() => {
    const q = (pickerSearch || "").trim().toLowerCase();
    return (customers || []).filter(
      (c) =>
        !q ||
        (c.name || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q) ||
        (c.address || "").toLowerCase().includes(q),
    );
  }, [customers, pickerSearch]);

  const chosen = lines.filter((l) => l.cartonCount > 0 || l.unitCount > 0);
  // new-order.js → recalculateOrder: جمع خط‌به‌خط اقلام انتخابی
  const subtotal = chosen.reduce(
    (s, l) => s + l.cartonCount * (l.cartonPrice || 0) + l.unitCount * (l.unitPrice || 0),
    0,
  );
  const totalCartons = chosen.reduce((s, l) => s + l.cartonCount, 0);
  const totalUnits = chosen.reduce((s, l) => s + l.unitCount, 0);

  // پورت ۱:۱ از new-order.js → updateCartonCount/updateUnitCount:
  //  - دانه نمی‌تواند به یک کارتن کامل برسد (حداکثر unitsPerCarton - 1)
  //  - مجموع انتخابی نمی‌تواند از موجودی کل خودرو (totalSingleUnits) بیشتر شود
  function step(p, key, delta) {
    const id = p.productId;
    const upc = p.unitsPerCarton || 1;
    const totalStock =
      p.totalSingleUnits ?? (p.quantityCartons || 0) * upc + (p.quantityUnits || 0);
    setQty((prev) => {
      const cur = { c: 0, u: 0, ...(prev[id] || {}) };
      let c = cur.c;
      let u = cur.u;
      if (key === "cartonCount") {
        c = Math.max(0, c + delta);
        if (totalStock > 0 && c * upc + u > totalStock) {
          c = Math.max(0, Math.floor((totalStock - u) / upc));
        }
      } else {
        u = Math.max(0, u + delta);
        if (upc > 1 && u >= upc) u = upc - 1;
        if (totalStock > 0 && c * upc + u > totalStock) {
          u = Math.max(0, totalStock - c * upc);
        }
      }
      return { ...prev, [id]: { ...cur, c, u } };
    });
  }

  // new-order.js → proceedToPayment: ذخیره پیش‌نویس و رفتن به صفحه پرداخت
  function proceedToPayment() {
    if (!custId || chosen.length === 0) {
      showToast("لطفاً مشتری و حداقل یک کالا را انتخاب نمایید.", "error");
      return;
    }
    const items = {};
    chosen.forEach((l) => {
      items[l.productId] = {
        productId: l.productId,
        name: l.productName,
        brand: l.brand || "متفرقه",
        cartonCount: l.cartonCount,
        unitCount: l.unitCount,
        cartonPrice: l.cartonPrice || 0,
        unitPrice: l.unitPrice || 0,
        lineTotal: l.cartonCount * (l.cartonPrice || 0) + l.unitCount * (l.unitPrice || 0),
        unitsPerCarton: l.unitsPerCarton || 24,
      };
    });
    const orderState = {
      customerId: custId,
      customerName: cust ? cust.name : "",
      customerDebt: cust ? Number(cust.currentDebt || 0) : 0,
      customerPhone: cust ? cust.phone || "" : "",
      items,
      subtotal,
      totalCartons,
      totalUnits,
    };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(orderState));
    setConfirm(false);
    go("payment");
  }

  const custDebt = cust ? Number(cust.currentDebt || 0) : 0;
  let ctaContent = null;
  if (!cust) {
    ctaContent = <span>لطفاً ابتدا مشتری را انتخاب کنید</span>;
  } else if (chosen.length === 0 || subtotal <= 0) {
    ctaContent = <span>حداقل یک محصول را انتخاب نمایید</span>;
  } else {
    let itemsSummary = "";
    if (totalCartons > 0 && totalUnits > 0) {
      itemsSummary = `${toPersianNum(totalCartons)} کارتن و ${toPersianNum(totalUnits)} دانه`;
    } else if (totalCartons > 0) {
      itemsSummary = `${toPersianNum(totalCartons)} کارتن`;
    } else {
      itemsSummary = `${toPersianNum(totalUnits)} دانه`;
    }
    ctaContent = (
      <>
        <span>ادامه به مرحله تسویه و پرداخت ({itemsSummary})</span>
        <span className="material-symbols-outlined" style={{ fontSize: "20px", transform: "scaleX(-1)" }}>
          arrow_forward
        </span>
      </>
    );
  }
  const ctaDisabled = !cust || chosen.length === 0 || subtotal <= 0;

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
        <div className="customer-select-card" onClick={() => { setPickerSearch(""); setPicker(true); }}>
          <div className="customer-info-preview">
            <div className="cust-avatar-mini">
              <span className="material-symbols-outlined">storefront</span>
            </div>
            <div className="cust-details">
              <span className="cust-name">{cust ? cust.name : "انتخاب مشتری / فروشگاه"}</span>
              <span
                className={`cust-debt-badge ${cust && custDebt === 0 ? "cleared" : ""}`.trim()}>
                {cust
                  ? custDebt > 0
                    ? `بدهی قبلی: ${formatPrice(custDebt)} تومان`
                    : "حساب تسویه (بدون بدهی)"
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
            <h3>هیچ کالایی در خودرو بارگیری نشده است</h3>
            <p>برای ثبت سفارش مشتری در پخش گرم، ابتدا اقلام موجود را در خودرو بارگیری نمایید.</p>
            <a className="goto-loading-btn" href="#/van" onClick={(e) => { e.preventDefault(); go("van"); }}>
              <span>ورود به بخش بارگیری خودرو</span>
            </a>
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
                          onClick={() => step(p, "cartonCount", -1)}>
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
                          onClick={() => step(p, "cartonCount", 1)}>
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
                          onClick={() => step(p, "unitCount", -1)}>
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
                          onClick={() => step(p, "unitCount", 1)}>
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
      </main>

      {/* نوار پایین صفحه — عین new-order.php */}
      {bar.length > 0 && (
        <footer className="order-bottom-bar">
          <div className="order-calc-breakdown">
            <div className="calc-row-left">
              <span className="calc-subtotal">جمع کل اقلام انتخابی:</span>
              <strong className="calc-final-amount" id="calcFinalVal">
                {formatPrice(subtotal)} تومان
              </strong>
            </div>
            <div className="calc-row-right">
              <span className="calc-final-label">تخفیف در مرحله پرداخت اعمال می‌شود</span>
            </div>
          </div>

          <button
            type="button"
            className="checkout-cta-btn"
            id="checkoutCtaBtn"
            disabled={ctaDisabled}
            onClick={() => setConfirm(true)}>
            {ctaContent}
          </button>
        </footer>
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
          {/* جستجوی مشتری — مثل فیلدر جستجوی new-order.php */}
          <input
            type="text"
            className="picker-search-input"
            placeholder="جستجوی نام یا تلفن مشتری..."
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
          />
          <div className="picker-cust-list">
            {pickerCustomers.length === 0 ? (
              <div style={{ textAlign: "center", padding: "12px 0", fontSize: "12px", color: "var(--text-muted)" }}>
                مشتری‌ای با این مشخصات یافت نشد.
              </div>
            ) : (
              pickerCustomers.map((c) => (
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
              ))
            )}
          </div>
        </div>
      </div>

      {/* مدال تایید اقلام سفارش قبل از رفتن به پرداخت — عین new-order.php */}
      <div
        className="modal-overlay"
        id="orderConfirmModal"
        style={{ display: confirm ? "flex" : "none" }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setConfirm(false);
        }}>
        <div className="confirm-order-sheet">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: "10px" }}>
            <div>
              <h3 style={{ fontSize: "15px", fontWeight: 800, margin: 0 }}>تایید اقلام سفارش</h3>
              <span id="confirmCustTitle" style={{ fontSize: "11px", color: "var(--primary)", fontWeight: 700 }}>
                {cust ? `فاکتور برای: ${cust.name}` : ""}
              </span>
            </div>
            <button type="button" style={{ background: "none", border: "none", cursor: "pointer" }} onClick={() => setConfirm(false)}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            اقلام انتخابی از بار خودرو:
          </div>

          <div className="confirm-items-list" id="confirmItemsList">
            {chosen.map((l) => (
              <div className="confirm-item-row" key={l.productId}>
                <span>
                  {l.productName} ({toPersianNum(l.cartonCount)} کارتن
                  {l.unitCount > 0 ? ` + ${toPersianNum(l.unitCount)} دانه` : ""})
                </span>
                <strong>
                  {formatPrice(l.cartonCount * (l.cartonPrice || 0) + l.unitCount * (l.unitPrice || 0))} ت
                </strong>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13.5px", fontWeight: 900, color: "var(--primary)", padding: "4px 0" }}>
            <span>جمع کل ناخالص:</span>
            <span id="confirmGrandSubtotal">{formatPrice(subtotal)} تومان</span>
          </div>

          <div className="confirm-actions-row">
            <button type="button" className="confirm-submit-btn" onClick={proceedToPayment}>
              <span className="material-symbols-outlined">check_circle</span>
              <span>تایید و ورود به صفحه تسویه و پرداخت</span>
            </button>
            <button type="button" className="confirm-cancel-btn" onClick={() => setConfirm(false)}>
              ویرایش مجدد سفارش
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
