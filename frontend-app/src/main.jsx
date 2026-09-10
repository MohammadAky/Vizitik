import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { APP_NAME_FA } from './lib/brand.js';

// همان css/style.css که تمام صفحات PHP (از جمله template.php مرجع) بارگذاری می‌کنند — بایت‌به‌بایت کپی شده.
import './styles/style.css';
// فقط لایهٔ اتصال SPA (بدون هیچ قانون ظاهری جدید)
import './styles/pwa.css';
// استایل‌های صفحه احراز هویت
import './styles/inline-login.css';

// نسخهٔ PHP در هر صفحه title را «ویزیتیک — …» می‌گذارد؛ پیش‌فرضِ شِل همان نام برنامه است.
if (!document.title) document.title = APP_NAME_FA;
const metaDesc = document.querySelector('meta[name="description"]');
if (metaDesc)
  metaDesc.setAttribute('content', `${APP_NAME_FA} — اپلیکیشن ثبت سفارش و فاکتور ویزیتور (آفلاین‌محور)`);

createRoot(document.getElementById('root')).render(<App />);
