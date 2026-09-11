# پنل ادمین ویزیتیک

پنل مدیریت روی `admin.vizitik.ir` — دو بخش:
1. **کوئری SQL** (فقط‌خواندنی) برای دیدن داده‌های دیتابیس
2. **محصولات** — افزودن/ویرایش/حذف محصولات سراسری کاتالوگ که همه‌ی ویزیتورها می‌بینند

## ساختار
- `server.js` — سرویس Node کوچک (بدون وابستگی جدید؛ از Prisma Client بک‌اند استفاده می‌کند) با این endpoint ها:
  - `GET /api/tables` — فهرست جدول‌ها با تعداد ردیف
  - `POST /api/query` — اجرای کوئری (فقط SELECT، حداکثر ۵۰۰ ردیف، LIMIT خودکار اعمال می‌شود)
  - `GET /api/products` — لیست محصولات سراسری با تعداد استفاده (فاکتور و قیمت‌های اختصاصی)
  - `POST /api/products` — افزودن محصول سراسری (اگر فقط قیمت کارتن داده شود، قیمت واحد خودکار محاسبه می‌شود)
  - `PUT /api/products/:id` — ویرایش
  - `DELETE /api/products/:id` — حذف (اگر محصول در فاکتوری استفاده شده باشد با ۴۰۹ رد می‌شود تا تاریخچه‌ی سفارش‌ها سالم بماند)
  - `GET /api/health` — بدون توکن، برای probe
- `index.html`, `css/admin.css`, `js/admin.js` — رابط فارسی RTL با فونت Vazirmatn (از فونت‌های لندینگ سرو می‌شود)

## امنیت
- کل `/api/*` با هدر `X-Admin-Token` و مقدار `ADMIN_TOKEN` (در `backend/.env`) احراز می‌شود.
- تب SQL فقط SELECT مجاز است؛ INSERT/UPDATE/DELETE/DROP/… و چند-دستوری و `INTO OUTFILE` رد می‌شوند.
- نوشتن فقط از طریق endpoint های ساختاریافته‌ی محصول انجام می‌شود — نه SQL خام.
- حذف محصولِ فاکتورخورده مسدود است (۴۰۹) چون `OrderItem → Product` با Restrict به هم می‌خورد.
- LIMIT اجباری (۵۰۰)؛ هر LIMIT بزرگ‌تر خودکار به ۵۰۰ کاهش می‌یابد.
- در nginx روی دامنه ادمین هدرهای `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy` ست می‌شود.
- سرویس فقط روی `127.0.0.1:ADMIN_PORT` گوش می‌دهد؛ دسترسی از بیرون فقط از طریق nginx ممکن است.

## استقرار
`scripts/setup-server.sh` این پنل را کامل نصب می‌کند (ساب‌دامنه `ADMIN_DOMAIN`، پیش‌فرض `admin.$DOMAIN`، سرویس `vizitik-admin` روی پورت ۳۰۰۱، server block nginx و گواهی HTTPS). آپدیت‌های بعدی را `scripts/update.sh` (بخش `admin/` در diff) خودش جابه‌جا و سرویس را ری‌استارت می‌کند.

برای تغییر توکن روی سرور: `ADMIN_TOKEN=... ` را در `backend/.env` ویرایش و `systemctl restart vizitik-admin` را اجرا کنید.
