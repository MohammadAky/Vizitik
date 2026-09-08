// ============================================================
// ویزیتیک — اسکریپت مدیریت مشتریان و پرونده ویزیت (customers.js)
// ============================================================

let activeFilter = "ALL";
let searchQuery = "";
let selectedCustomerId = null;
let toastTimeout = null;

const searchInput = document.getElementById("customerSearchInput");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const noCustomerFound = document.getElementById("noCustomerFound");

// ============================================================
// ۱. فیلترها و جستجوی زنده
// ============================================================

function filterCustomers() {
  searchQuery = (searchInput ? searchInput.value : "").trim().toLowerCase();
  if (clearSearchBtn) {
    clearSearchBtn.style.display = searchQuery.length > 0 ? "flex" : "none";
  }
  applyAllFilters();
}

function clearSearch() {
  if (searchInput) searchInput.value = "";
  filterCustomers();
}

function selectFilter(btn, filterKey) {
  activeFilter = filterKey;
  const chips = document.querySelectorAll("#filterChipsTrack .filter-chip");
  chips.forEach((c) => c.classList.remove("active"));
  if (btn) btn.classList.add("active");
  applyAllFilters();
}

function resetFilters() {
  activeFilter = "ALL";
  searchQuery = "";
  if (searchInput) searchInput.value = "";
  if (clearSearchBtn) clearSearchBtn.style.display = "none";

  const chips = document.querySelectorAll("#filterChipsTrack .filter-chip");
  chips.forEach((c) =>
    c.dataset.filter === "ALL" ? c.classList.add("active") : c.classList.remove("active"),
  );

  applyAllFilters();
}

function applyAllFilters() {
  const cards = document.querySelectorAll(".customer-card");
  let visibleCount = 0;
  let visibleDebt = 0;

  cards.forEach((card) => {
    const name = (card.dataset.name || "").toLowerCase();
    const address = (card.dataset.address || "").toLowerCase();
    const phone = (card.dataset.phone || "").toLowerCase();
    const notes = (card.dataset.notes || "").toLowerCase();
    const debt = parseFloat(card.dataset.debt) || 0;

    // فیلتر جستجو
    const matchSearch =
      !searchQuery ||
      name.includes(searchQuery) ||
      address.includes(searchQuery) ||
      phone.includes(searchQuery) ||
      notes.includes(searchQuery);

    // فیلتر چیپ
    let matchChip = false;
    if (activeFilter === "ALL") {
      matchChip = true;
    } else if (activeFilter === "DEBTORS") {
      matchChip = debt > 0;
    } else if (activeFilter === "SETTLED") {
      matchChip = debt === 0;
    }

    if (matchSearch && matchChip) {
      card.style.display = "";
      visibleCount++;
      if (debt > 0) visibleDebt += debt;
    } else {
      card.style.display = "none";
    }
  });

  if (noCustomerFound) {
    noCustomerFound.style.display = visibleCount === 0 && cards.length > 0 ? "flex" : "none";
  }

  const totalCustomersCountElem = document.getElementById("totalCustomersCount");
  const totalDebtAmountElem = document.getElementById("totalDebtAmount");

  if (totalCustomersCountElem) {
    totalCustomersCountElem.textContent = `${toPersianNum(visibleCount)} فروشگاه`;
  }
  if (totalDebtAmountElem) {
    totalDebtAmountElem.textContent = `${toPersianNum(visibleDebt.toLocaleString("fa-IR"))}  مانده بازار`;
  }
}

// ============================================================
// ۲. پرونده سریع مشتری (Customer Sheet & 5 Recent Orders)
// ============================================================

async function openCustomerSheet(customerId) {
  selectedCustomerId = customerId;
  const card = document.querySelector(`.customer-card[data-id="${customerId}"]`);
  if (!card) return;

  const name = card.dataset.name || "مشتری";
  const address = card.dataset.address || "";
  const phone = card.dataset.phone || "";
  const notes = card.dataset.notes || "";
  const debt = parseFloat(card.dataset.debt) || 0;

  // ۱. نمایش فوری اطلاعات پایه از کارت (بدون معطلی)
  document.getElementById("sheetShopName").textContent = name;
  document.getElementById("sheetOwnerMeta").textContent =
    `${phone ? "تلفن: " + phone : ""} ${notes ? "• " + notes : ""}`;

  const balanceBanner = document.getElementById("sheetBalanceBanner");
  const balanceAmountElem = document.getElementById("sheetBalanceAmount");
  const balanceStatusLabel = document.getElementById("sheetBalanceStatusLabel");

  if (debt > 0) {
    balanceBanner.className = "modal-balance-banner";
    balanceStatusLabel.textContent = "مانده بدهی قبلی فروشگاه:";
    balanceAmountElem.textContent = `${toPersianNum(debt.toLocaleString("fa-IR"))} تومان`;
  } else {
    balanceBanner.className = "modal-balance-banner settled";
    balanceStatusLabel.textContent = "وضعیت حساب:";
    balanceAmountElem.textContent = "کاملاً تسویه شده (۰ تومان)";
  }

  const ordersListElem = document.getElementById("sheetRecentOrdersList");
  ordersListElem.innerHTML =
    '<p style="text-align:center; color:var(--text-muted); font-size:11px; padding:12px 0;">در حال دریافت سوابق از سرور...</p>';

  document.getElementById("customerSheetModal").style.display = "flex";

  // ۲. واکشی زنده ۵ سفارش اخیر از API سرور
  try {
    const headers = { Accept: "application/json" };
    if (typeof API_TOKEN !== "undefined" && API_TOKEN) {
      headers["Authorization"] = `Bearer ${API_TOKEN}`;
    }

    const res = await fetch(`http://localhost:3000/api/customers/${customerId}`, { headers });
    if (res.ok) {
      const data = await res.json();
      renderRecentOrders(data.orders || []);
    } else {
      ordersListElem.innerHTML =
        '<p style="text-align:center; color:var(--text-muted); font-size:11px; padding:12px 0;">سفارشی برای این مشتری ثبت نشده است.</p>';
    }
  } catch (err) {
    ordersListElem.innerHTML =
      '<p style="text-align:center; color:var(--text-muted); font-size:11px; padding:12px 0;">سفارشی یافت نشد.</p>';
  }
}

function renderRecentOrders(orders) {
  const ordersListElem = document.getElementById("sheetRecentOrdersList");
  ordersListElem.innerHTML = "";

  if (!orders || orders.length === 0) {
    ordersListElem.innerHTML =
      '<p style="text-align:center; color:var(--text-muted); font-size:11px; padding:12px 0;">تاکنون سفارشی برای این مشتری ثبت نشده است.</p>';
    return;
  }

  orders.slice(0, 5).forEach((ord, index) => {
    const dateStr = ord.orderDate ? new Date(ord.orderDate).toLocaleDateString("fa-IR") : "امروز";
    const isSettled = ord.status === "DELIVERED" || ord.status === "CONFIRMED";
    const amount = ord.finalAmount ? Number(ord.finalAmount) : 0;
    const summary = ord.summary || "اقلام بستنی";

    const row = document.createElement("div");
    row.className = "recent-order-item";

    // شمارهٔ رسمی فاکتور (مثل ۱۴۰۵-۰۰۰۰۱۲)؛ در غیر این صورت به‌عنوان جایگزین، شمارهٔ ردیف نمایش داده می‌شود
    const invLabel = ord.invoiceNumber
        ? `فاکتور شماره <span class="invoice-num">${toPersianNum(ord.invoiceNumber)}</span>`
        : `فاکتور شماره ${toPersianNum(index + 1)}`;

    row.innerHTML = `
            <div class="recent-order-right">
                <span class="recent-order-no">${invLabel} <small style="color:var(--text-muted);">(${toPersianNum(dateStr)})</small></span>
                <span class="recent-order-summary">${summary}</span>
            </div>
            <div class="recent-order-left">
                <span class="recent-order-amount">${toPersianNum(amount.toLocaleString("fa-IR"))} ت</span>
                <span class="recent-order-status ${isSettled ? "settled" : "credit"}">
                    ${isSettled ? "تسویه شد" : "نسیه (اعتباری)"}
                </span>
            </div>
        `;
    ordersListElem.appendChild(row);
  });
}

function closeCustomerSheet() {
  document.getElementById("customerSheetModal").style.display = "none";
}

function triggerInvoiceForCurrentCustomer() {
  if (!selectedCustomerId) return;
  const card = document.querySelector(`.customer-card[data-id="${selectedCustomerId}"]`);
  const name = card ? card.dataset.name : "";
  closeCustomerSheet();
  showNotification(`هدایت به صدور فاکتور برای «${name}»...`, "success");
  setTimeout(() => {
    window.location.href = `new-order.php?customerId=${encodeURIComponent(selectedCustomerId)}`;
  }, 400);
}

function showFullLedger() {
  if (!selectedCustomerId) return;
  closeCustomerSheet();
  window.location.href = `collections.php?customerId=${encodeURIComponent(selectedCustomerId)}`;
}

// ============================================================
// ۳. ثبت و ویرایش مشخصات مشتری
// ============================================================

function openAddCustomerModal() {
  document.getElementById("formModalTitle").textContent = "ثبت مشتری و فروشگاه جدید";
  document.getElementById("formSubmitBtn").textContent = "ثبت و ذخیره مشتری";
  document.getElementById("editCustId").value = "";

  document.getElementById("custNameInput").value = "";
  document.getElementById("custPhoneInput").value = "";
  document.getElementById("custNotesInput").value = "";
  document.getElementById("custAddressInput").value = "";
  document.getElementById("custDebtInput").value = "";
  document.getElementById("custDebtGroup").style.display = "flex";

  const deleteBtn = document.getElementById("formDeleteBtn");
  if (deleteBtn) deleteBtn.style.display = "none";

  document.getElementById("customerFormModal").style.display = "flex";
}

function openEditCustomerModal() {
  const card = document.querySelector(`.customer-card[data-id="${selectedCustomerId}"]`);
  if (!card) return;

  closeCustomerSheet();

  const name = card.dataset.name || "";
  const phone = card.dataset.phone || "";
  const notes = card.dataset.notes || "";
  const address = card.dataset.address || "";

  document.getElementById("formModalTitle").textContent = `ویرایش مشتری: ${name}`;
  document.getElementById("formSubmitBtn").textContent = "ذخیره تغییرات";
  document.getElementById("editCustId").value = selectedCustomerId;

  document.getElementById("custNameInput").value = name;
  document.getElementById("custPhoneInput").value = phone;
  document.getElementById("custNotesInput").value = notes;
  document.getElementById("custAddressInput").value = address === "آدرس ثبت نشده" ? "" : address;
  document.getElementById("custDebtGroup").style.display = "none";

  const deleteBtn = document.getElementById("formDeleteBtn");
  if (deleteBtn) deleteBtn.style.display = "flex";

  document.getElementById("customerFormModal").style.display = "flex";
}

function closeCustomerFormModal() {
  document.getElementById("customerFormModal").style.display = "none";
}

async function handleDeleteCustomer() {
  const id = document.getElementById("editCustId").value;
  const card = document.querySelector(`.customer-card[data-id="${id}"]`);
  const name = card ? card.dataset.name : "این مشتری";

  if (!id) return;

  if (!confirm(`آیا از حذف مشتری «${name}» اطمینان کامل دارید؟`)) {
    return;
  }

  try {
    const headers = { Accept: "application/json" };
    if (typeof API_TOKEN !== "undefined" && API_TOKEN) {
      headers["Authorization"] = `Bearer ${API_TOKEN}`;
    }

    const res = await fetch(`http://localhost:3000/api/customers/${id}`, {
      method: "DELETE",
      headers,
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      closeCustomerFormModal();
      showNotification(`مشتری «${name}» با موفقیت حذف شد.`, "success");
      setTimeout(() => window.location.reload(), 700);
    } else {
      showNotification(data.message || "خطا در حذف مشتری (دارای فاکتور یا گردش حساب).", "error");
    }
  } catch (err) {
    showNotification("خطا در ارتباط با سرور بک‌اند.", "error");
  }
}

async function handleSaveCustomerForm(e) {
  e.preventDefault();

  const id = document.getElementById("editCustId").value;
  const name = document.getElementById("custNameInput").value.trim();
  const phone = document.getElementById("custPhoneInput").value.trim();
  const notes = document.getElementById("custNotesInput").value.trim();
  const address = document.getElementById("custAddressInput").value.trim();
  const initialDebt = parseFloat(document.getElementById("custDebtInput").value) || 0;

  const submitBtn = document.getElementById("formSubmitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "در حال ذخیره...";

  const url =
    id ? `http://localhost:3000/api/customers/${id}` : "http://localhost:3000/api/customers";

  const method = id ? "PUT" : "POST";
  const payload = {
    name,
    phone,
    notes,
    address: address || null,
    ...(id ? {} : { initialDebt }),
  };

  try {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (typeof API_TOKEN !== "undefined" && API_TOKEN) {
      headers["Authorization"] = `Bearer ${API_TOKEN}`;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      closeCustomerFormModal();
      showNotification(
        id ? `مشخصات «${name}» با موفقیت ویرایش شد.` : `مشتری «${name}» با موفقیت ثبت شد.`,
        "success",
      );
      setTimeout(() => window.location.reload(), 700);
    } else {
      showNotification(data.message || "خطا در ذخیره اطلاعات مشتری.", "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "تلاش مجدد";
    }
  } catch (err) {
    showNotification("خطا در ارتباط با سرور بک‌اند.", "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "تلاش مجدد";
  }
}

// ============================================================
// ۴. نوتیفیکیشن و ابزارها
// ============================================================

function showNotification(msg, type = "info") {
  const appContainer = document.getElementById("app") || document.body;
  let toast = document.getElementById("appToast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "appToast";
    appContainer.appendChild(toast);
  } else if (toast.parentElement !== appContainer) {
    appContainer.appendChild(toast);
  }

  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }

  let icon = "info";
  if (type === "success") icon = "check_circle";
  if (type === "error") icon = "error";

  toast.className = `app-toast ${type}`;
  toast.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span>${msg}</span>`;

  void toast.offsetWidth;
  toast.classList.add("show");

  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

function toPersianNumber(n) {
  if (n === null || n === undefined) return "۰";
  const farsiDigits = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
  return n.toString().replace(/\d/g, (x) => farsiDigits[x]);
}
const toPersianNum = toPersianNumber;

document.addEventListener("DOMContentLoaded", () => {
  applyAllFilters();
});
