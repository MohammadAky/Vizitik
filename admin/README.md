# پنل ادمین ویزیتیک

پنل ساده و **فقط‌خواندنی** برای دیدن داده‌های دیتابیس روی `admin.vizitik.ir`.

## ساختار
- `server.js` — سرویس Node کوچک (بدون وابستگی جدید؛ از Prisma Client بک‌اند استفاده می‌کند) که هم رابط کاربری را سرو می‌کند و هم دو endpoint دارد:
  - `GET /api/tables` — فهرست جدول‌ها با تعداد ردیف
  - `POST /api/query` — اجرای کوئری (فقط SELECT، حداکثر ۵۰۰ ردیف، LIMIT خودکار اعمال می‌شود)
  - `GET /api/health` — بدون توکن، برای probe
- `index.html`, `css/admin.css`, `js/admin.js` — رابط فارسی RTL با فونت Vazirmatn (از فونت‌های لندینگ سرو می‌شود)

## امنیت
- کل `/api/*` با هدر `X-Admin-Token` و مقدار `ADMIN_TOKEN` (در `backend/.env`) احراز می‌شود.
- فقط SELECT مجاز است؛ INSERT/UPDATE/DELETE/DROP/… و چند-دستوری و `INTO OUTFILE` رد می‌شوند.
- LIMIT اجباری (۵۰۰)؛ هر LIMIT بزرگ‌تر خودکار به ۵۰۰ کاهش می‌یابد.
- در nginx روی دامنه ادمین هدرهای `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy` ست می‌شود.
- سرویس فقط روی `127.0.0.1:ADMIN_PORT` گوش می‌دهد؛ دسترسی از بیرون فقط از طریق nginx ممکن است.

## استقرار
`scripts/setup-server.sh` این پنل را کامل نصب می‌کند (ساب‌دامنه `ADMIN_DOMAIN`، پیش‌فرض `admin.$DOMAIN`، سرویس `vizitik-admin` روی پورت ۳۰۰۱، server block nginx و گواهی HTTPS). آپدیت‌های بعدی را `scripts/update.sh` (بخش `admin/` در diff) خودش جابه‌جا و سرویس را ری‌استارت می‌کند.

برای تغییر توکن روی سرور: `ADMIN_TOKEN=... ` را در `backend/.env` ویرایش و `systemctl restart vizitik-admin` را اجرا کنید.
