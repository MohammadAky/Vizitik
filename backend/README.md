# 🍦 پروژه حساب‌چین (HesabChin Backend API)
### سیستم جامع مدیریت سفارشات و حسابداری ویزیتورهای پخش بستنی

---

## 📋 نیازمندی‌ها (System Requirements)

- **Node.js**: نسخه 18 یا بالاتر (تست‌شده روی Node v20 و v24)
- **NPM**: نسخه 9 یا بالاتر
- **PostgreSQL**: دیتابیس ابری Supabase (کانفیگ‌شده)
- **TypeScript**: نسخه 5.7+

---

## 🚀 راهنمای سریع راه‌اندازی (Quick Start)

### ۱. نصب پکیج‌ها:
```bash
npm install
```

### ۲. تنظیم متغیرهای محیطی:
فایل `.env` را در ریشه پوشه `backend` بسازید:
```env
DATABASE_URL="postgresql://postgres.gfszeojgcarobrzpdmni:M%401383138300a@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require&connect_timeout=30"
DIRECT_URL="postgresql://postgres.gfszeojgcarobrzpdmni:M%401383138300a@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require&connect_timeout=30"
JWT_SECRET="HesabChin-SuperSecretKey-2026"
PORT=3000
```

### ۳. سینک دیتابیس و تولید پریسما:
```bash
npx prisma db push
npx prisma generate
```

### ۴. اجرای سرور در حالت توسعه (Live Reload):
```bash
npm run start:dev
```
سرور روی آدرس `http://localhost:3000` آماده به کار خواهد بود.

---

## 🗂️ ماژول‌ها و مسیرهای API (Endpoints)

### ۱. احراز هویت (`/api/auth`)
- `POST /api/auth/register` : ثبت‌نام ویزیتور جدید (نام، نام خانوادگی، موبایل، رمز عبور)
- `POST /api/auth/login` : ورود ویزیتور و دریافت توکن JWT (اعتبار ۳۰ روزه)

### ۲. محصولات (`/api/products`) `[نیاز به توکن Bearer]`
- `GET /api/products` : دریافت لیست تمام بستنی‌ها با قیمت‌های اختصاصی هر ویزیتور
- `POST /api/products` : ثبت بستنی جدید توسط خود ویزیتور
- `PUT /api/products/:id/custom-settings` : تنظیم قیمت کارتن و تعداد کارتن اختصاصی

### ۳. مشتریان و سوپرمارکت‌ها (`/api/customers`) `[نیاز به توکن Bearer]`
- `GET /api/customers` : لیست مشتریان با **محاسبه زنده مانده حساب بدهکاری/بستانکاری**
- `POST /api/customers` : ثبت مشتری/سوپرمارکت جدید
- `GET /api/customers/:id` : جزئیات مشتری به همراه ۱۰ سفارش اخیر و ۲۰ گردش دفتر حساب
- `PUT /api/customers/:id` : ویرایش اطلاعات مشتری

### ۴. بارگیری ماشین (`/api/van-inventory`) `[نیاز به توکن Bearer]`
- `GET /api/van-inventory` : مشاهده موجودی فعلی داخل وانت (کارتن + تکی)
- `PUT /api/van-inventory/bulk` : بارگیری کلی اول صبح
- `PUT /api/van-inventory/item` : ویرایش سریع موجودی یک قلم کالا

### ۵. ثبت سفارش و فاکتور (`/api/orders`) `[نیاز به توکن Bearer]`
- `POST /api/orders` : ثبت سفارش کامل:
  - با شناسه یکتا `localUuid` برای جلوگیری از ثبت تکراری آفلاین
  - محاسبه قیمت با اسنپ‌شات لحظه‌ای (Snapshot)
  - محاسبه تخفیف‌های پلکانی متوالی (مثلا ۵٪ بعد ۳٪ بعد ۱٪)
  - کسر خودکار از موجودی وانت (`van_inventory`)
  - ثبت بدهی در دفتر حساب مشتری (`customer_ledger`)
  - ثبت پرداخت‌های ترکیبی (نقد، پوز، چک، نسیه)
- `GET /api/orders` : لیست سفارش‌ها با امکان فیلتر تاریخ (`startDate`, `endDate`)
- `GET /api/orders/:id/invoice` : خروجی کامل فاکتور برای نمایش یا چاپ PDF

### ۶. گزارش‌ها و مدیریت چک/وصول (`/api/reports`) `[نیاز به توکن Bearer]`
- `GET /api/reports/dashboard` : آمار فروش امروز، ماه جاری، جمع مطالبات وصول‌نشده
- `GET /api/reports/checks` : لیست چک‌های دریافتی (در جریان، پاس‌شده، برگشتی)
- `PUT /api/reports/checks/:id/status` : تغییر وضعیت چک (با پاس شدن چک، حساب مشتری خودکار بستانکار می‌شود)
- `GET /api/reports/outstanding` : لیست مغازه‌های بدهکار برای پیگیری جمع‌آوری پول

---

## 🏗️ ساختار پروژه

```
backend/
├── prisma/
│   └── schema.prisma         # مدل‌های دیتابیس و ارتباطات
├── src/
│   ├── auth/                 # ماژول احراز هویت و توکن JWT
│   ├── products/             # ماژول بستنی‌ها و قیمت‌های اختصاصی
│   ├── customers/            # ماژول مغازه‌ها و مانده حساب
│   ├── van-inventory/        # ماژول بارگیری وانت
│   ├── orders/               # ماژول سفارش‌گیری و تخفیف پلکانی
│   ├── reports/              # ماژول وصول چک‌ها و داشبورد مالی
│   ├── prisma.service.ts     # سرویس مرکزی اتصال دیتابیس
│   ├── app.module.ts         # ماژول ریشه سرور
│   └── main.ts               # نقطه ورود سرور
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```
