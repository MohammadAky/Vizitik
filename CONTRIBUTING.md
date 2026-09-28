# راهنمای مشارکت در ویزیتیک

خوش آمدید و ممنون که وقت می‌گذارید. این سند کوتاه است چون قواعد پروژه هم کوتاه و روشن‌اند.

## پیش از شروع

- پیش‌نیازها: **Node 22+**، **Python 3** و **MySQL/MariaDB** (فایل `.nvmrc` نسخه‌ی Node را پین کرده است).
- راه‌اندازی لوکال: [`scripts/setup-local.sh`](scripts/setup-local.sh) و بعد [`scripts/run-dev.sh`](scripts/run-dev.sh)
  (بک‌اند `:3000`، پنل ادمین `:3001`، PWA `:5173`).
- هیچ‌وقت لوکال را به دیتابیس production وصل نکنید و هیچ فایل `.env` را کامیت نکنید.

## گزارش باگ و پیشنهاد

از قالب‌های آماده‌ی [Issues](../../issues/new/choose) استفاده کنید. در گزارش باگ این‌ها را بنویسید:

1. چه کاری کردید (دستورها یا مسیر کلیک‌ها)
2. چه انتظاری داشتید و چه اتفاقی افتاد (متن کامل خطا)
3. محیط: نسخه‌ی Node، سیستم‌عامل، و اینکه لوکال بود یا سرور

> ⚠️ هیچ‌وقت محتوای `backend/.env`، `ADMIN_TOKEN`، `JWT_SECRET`، `BALE_BOT_TOKEN` یا داده‌ی
> مشتریان/فاکتورهای واقعی را در Issue نگذارید. برای مسائل امنیتی به [SECURITY.md](SECURITY.md) نگاه کنید.

## شاخه و کامیت

- شاخه‌ها را کوتاه و موضوعی نگه دارید: `fix/update-php-tree`، `feat/admin-export`.
- پیام کامیت‌ها به سبک [Conventional Commits](https://www.conventionalcommits.org/) و انگلیسی:
  `fix(scripts): ...`، `feat(admin): ...`، `docs(readme): ...`.
- در متن کامیت **چرا** را توضیح دهید، نه فقط چه چیزی؛ اگر رفتار قبلی باگ بوده، باگ را توصیف کنید.
- یک کامیت = یک تغییر منطقی. کامیت‌های ناخواسته یا فایل‌های موقت را قبل از push پاک کنید.
- پوشه‌های `node_modules`، `dist`، `*.log` و `.env` نباید کامیت شوند (`.gitignore` پوشش داده است).

## قبل از Pull Request

```bash
(cd backend && npm ci --include=dev && npx prisma generate && npm run build)
python3 scripts/tests/setup-safety.py
python3 scripts/tests/update-regression.py
python3 scripts/tests/update-rollback.py
python3 scripts/tests/backend-typecheck.py
node admin/tests/regression.cjs
```

- اگر تغییری به SQL، اسکیما یا اسکریپت‌های استقرار زده‌اید، در توضیح PR بنویسید چه چیزی روی
  دیتابیس/سرور اجرا می‌شود.
- تغییر در `scripts/update.sh` باید تست‌های `update-*` را سبز نگه دارد؛ این اسکریپت روی سرور
  زنده اجرا می‌شود و رفتارش بخشی از قرارداد پروژه است:
  - هر درخت در پوشه‌ی موقت بیلد می‌شود و فقط بعد از بیلد موفق جایگزین می‌شود؛
  - `prisma db push` فقط وقتی `schema.prisma` عوض شده باشد و **هرگز** با `--accept-data-loss`؛
  - سایت قدیمی PHP در `frontend/` از خود checkout سرو می‌شود و در نصب سرور کپی نمی‌شود.

## قواعد کد

- زبان مستندات و متن‌های رابط کاربری: **فارسی**؛ شناسه‌ها، کامیت‌ها و نام شاخه‌ها: **انگلیسی**.
- بک‌اند: NestJS با ماژول‌های جدا (`auth`، `orders`، `customers`، `products`، `reports`، `van-inventory`).
  منطق مالی و محاسبه‌ی مانده در سرویس‌ها بماند، نه در کنترلرها.
- PWA: محاسبات قیمت/تخفیف در [`frontend-app/src/lib/pricing.js`](frontend-app/src/lib/pricing.js)
  و هم‌راستا با سرویس بک‌اند باشد؛ کار آفلاین از صف `sync.js` رد می‌شود.
- پنل ادمین بدون فریم‌ورک و بدون وابستگی جدید نوشته شده است؛ از افزودن کتابخانه‌ی CDN بپرهیزید
  (اینترنت ایران و سرورهای محل استقرار باید بدون CDN کار کنند).
- فونت/آیکون‌ها self-host هستند؛ به `cdn.jsdelivr.net` یا `fonts.googleapis.com` وابستگی نسازید.
- ایمنی SQL در پنل ادمین جدی است: مسیرهای جدید هم باید از `guardSql` رد شوند و خواندن/نوشتن تفکیک بماند.

## مجوز

با ارسال مشارکت، موافقت می‌کنید کارتان تحت مجوز [MIT](LICENSE) پروژه منتشر شود.
