/* ویزیتیک — اسکریپت صفحه معرفی (بدون وابستگی) */
(function () {
  'use strict';

  var config = window.VIZITIK_CONFIG || {};

  /* --- لینک‌های قابل پیکربندی؛ لینکِ بدون مقصد حذف می‌شود --- */
  function bindLink(selector, url) {
    if (!url) {
      document.querySelectorAll(selector).forEach(function (el) {
        el.remove();
      });
      return;
    }
    document.querySelectorAll(selector).forEach(function (el) {
      el.setAttribute('href', url);
      if (/^https?:/i.test(url)) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  bindLink('[data-app-link]', config.appUrl);
  bindLink('[data-support-link]', config.supportUrl);
  bindLink('[data-terms-link]', config.termsUrl);

  /* --- منوی موبایل --- */
  var toggle = document.getElementById('menu-toggle');
  var nav = document.getElementById('main-nav');

  function setMenu(open) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'بستن فهرست' : 'باز کردن فهرست');
    toggle.classList.toggle('open', open);
    nav.classList.toggle('open', open);
  }

  toggle.addEventListener('click', function () {
    setMenu(toggle.getAttribute('aria-expanded') !== 'true');
  });

  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) setMenu(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      toggle.focus();
    }
  });

  document.addEventListener('click', function (e) {
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    if (!e.target.closest('.site-header')) setMenu(false);
  });

  /* --- بستن منو با تغییر اندازه (دسکتاپ) --- */
  var mq = window.matchMedia('(min-width: 861px)');
  mq.addEventListener('change', function (e) {
    if (e.matches) setMenu(false);
  });
})();
