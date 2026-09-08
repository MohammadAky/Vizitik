import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { APP_NAME_FA } from './lib/brand.js';
import './styles/app.css';

// تنظیم عنوان و توضیح صفحه از نامِ پیکربندی‌شده در .env
document.title = APP_NAME_FA;
const metaDesc = document.querySelector('meta[name="description"]');
if (metaDesc) metaDesc.setAttribute('content', `${APP_NAME_FA} — اپلیکیشن ثبت سفارش و فاکتور ویزیتور (آفلاین‌محور)`);

createRoot(document.getElementById('root')).render(<App />);
