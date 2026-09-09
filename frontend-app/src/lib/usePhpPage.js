import { useEffect } from 'react';
import { PAGES } from './pages.js';

/**
 * هر صفحهٔ PWA دقیقاً همان کاری را می‌کند که فایل PHP مرجع در <head> خودش انجام می‌دهد:
 *  ۱) css/style.css همیشه بار است (در main.jsx ایمپورت شده) + استایل(های) اختصاصی همان صفحه
 *  ۲) عنوان سند: <title>ویزیتیک — {عنوان صفحه}</title>
 *
 * استایل اختصاصی با ?url به‌صورت asset درمی‌آید و مثل مرورگر به‌شکل <link> تزریق/حذف می‌شود،
 * تا استایل دو صفحهٔ PHP هرگز روی نیفتد (دقیقاً مثل جابه‌جایی بین فایل‌های PHP).
 */

import baleBotCss from '../styles/bale-bot.css?url';
import collectionsCss from '../styles/collections.css?url';
import customersCss from '../styles/customers.css?url';
import newOrderCss from '../styles/new-order.css?url';
import ordersCss from '../styles/orders.css?url';
import paymentCss from '../styles/payment.css?url';
import productsCss from '../styles/products.css?url';
import settingsCss from '../styles/settings.css?url';
import vanLoadingCss from '../styles/van-loading.css?url';
import loginCss from '../styles/inline-login.css?url';
import helpCss from '../styles/inline-help.css?url';
import aboutCss from '../styles/inline-about.css?url';

const CSS_ASSETS = {
  'inline-login': loginCss,
  'inline-help': helpCss,
  'inline-about': aboutCss,
  'van-loading': vanLoadingCss,
  customers: customersCss,
  orders: ordersCss,
  collections: collectionsCss,
  'new-order': newOrderCss,
  products: productsCss,
  payment: paymentCss,
  settings: settingsCss,
  'bale-bot': baleBotCss
};

/** صفحه‌های احراز هویت در PAGES نیستند (در PHP فایل جدا و بدون nav/دراور دارند) */
const AUTH_PAGES = {
  login: { title: 'ورود به حساب کاربری', css: ['inline-login'] },
  register: { title: 'ثبت‌نام ویزیتور', css: [] }
};

export function usePhpPage(view) {
  const page = PAGES[view] || AUTH_PAGES[view] || {};
  const urls = (page.css || []).map((name) => CSS_ASSETS[name]).filter(Boolean);
  const key = urls.join(',');
  const title = page.doc; // <title>ویزیتیک — …</title> دقیقاً مثل فایل PHP

  useEffect(() => {
    const links = key
      ? key.split(',').map((href) => {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = href;
          link.setAttribute('data-page-css', '1');
          document.head.appendChild(link);
          return link;
        })
      : [];
    return () => links.forEach((l) => l.remove());
  }, [key]);

  useEffect(() => {
    document.title = title ? `ویزیتیک — ${title}` : 'ویزیتیک';
  }, [title]);

  return page;
}
