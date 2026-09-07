document.addEventListener("DOMContentLoaded", function () {
  /* ============================
       SIDE MENU (Hamburger Drawer)
    ============================ */
  const menuToggleBtn = document.getElementById("menuToggleBtn");
  const sideMenu = document.getElementById("sideMenu");
  const menuOverlay = document.getElementById("menuOverlay");
  const sideMenuClose = document.getElementById("sideMenuClose");

  const openMenu = () => {
    sideMenu.classList.add("show");
    menuOverlay.classList.add("show");
    menuToggleBtn.setAttribute("aria-expanded", "true");
  };

  const closeMenu = () => {
    sideMenu.classList.remove("show");
    menuOverlay.classList.remove("show");
    menuToggleBtn.setAttribute("aria-expanded", "false");
  };

  menuToggleBtn.addEventListener("click", openMenu);
  menuOverlay.addEventListener("click", closeMenu);
  sideMenuClose.addEventListener("click", closeMenu);

  /* ============================
       SKELETON -> REAL DATA
    ============================ */
  const fillSkeletons = () => {
    document.querySelectorAll("[data-value]").forEach((el) => {
      const value = el.dataset.value;
      const suffix = el.dataset.suffix;

      el.innerHTML = suffix ? `${value} <small>${suffix}</small>` : value;

      el.classList.remove(
        "skeleton-text",
        "skeleton-badge",
        "skeleton-sm",
        "skeleton-md",
        "skeleton-lg",
      );
      el.classList.add("skeleton-done");
    });
  };

  setTimeout(fillSkeletons, 700);

  /* ============================
       NEW INVOICE BUTTON
    ============================ */
  const newInvoiceBtn = document.getElementById("newInvoiceBtn");
  if (newInvoiceBtn) {
    newInvoiceBtn.addEventListener("click", () => {
      window.location.href = "new-order.php";
    });
  }
});
