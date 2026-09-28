# معماری ویزیتیک

نقشه‌ی کوتاه سیستم برای کسی که می‌خواهد کد را بخواند یا تغییر بدهد. برای نصب و آپدیت،
[docs/DEPLOY-UBUNTU.md](DEPLOY-UBUNTU.md) را ببینید.

## اجزای سیستم

```text
                       ┌──────────────────────────── مرورگر ویزیتور (موبایل) ───────────────────────────┐
                       │  frontend-app/  PWA  (React + Vite، Service Worker، IndexedDB)                │
                       │  کار آفلاین در IndexedDB می‌ماند و از صف sync.js به API می‌رود                │
                       └───────────────────────────────┬────────────────────────────────────────────────┘
                                                       │  /api/*  (JWT)
                                                       ▼
   nginx  ──┬── DOMAIN        ──►  landing/                 (صفحه‌ی معرفی، استاتیک)
            ├── APP_DOMAIN    ──►  frontend-app/dist        (PWA ساخته‌شده)
            ├── ADMIN_DOMAIN  ──►  127.0.0.1:3001           (admin/ پنل ادمین، X-Admin-Token)
            └── /api          ──►  127.0.0.1:3000           (backend/ NestJS، JWT)
                                                       │
                                                       ▼
                                              MySQL / MariaDB (Prisma)
                                                       ▲
                                     ربات بله  ◄────── polling (getUpdates)
```

نکته‌ها:

- **رابط وب قدیمی PHP** (`frontend/`) جدا از نصب سرور است: از خود checkout سرو می‌شود، بیلد و
  کپی ندارد، و `scripts/update.sh` فقط تغییراتش را گزارش می‌کند.
- **پنل ادمین** فریم‌ورک ندارد (Node خالص + Prisma Client تولیدشده‌ی بک‌اند) و پیش‌فرض روی
  `127.0.0.1:3001` گوش می‌دهد؛ دسترسی از بیرون فقط از nginx.
- **ربات بله** با long-polling کار می‌کند، نه webhook (ثبت webhook باعث ۴۰۹ در poll می‌شود).

## بک‌اند (NestJS)

| ماژول | مسئولیت | مسیرهای اصلی |
|---|---|---|
| `auth` | ورود JWT، OTP ثبت‌نام/بازیابی، پروفایل | `POST /api/auth/login` · `POST /api/auth/send-register-otp` · `POST /api/auth/register-with-otp` · `PUT /api/auth/change-password` |
| `orders` | صدور، ویرایش و حذف فاکتور، ویرایش روش‌های پرداخت، فاکتور چاپی | `POST/GET /api/orders` · `PUT /api/orders/:id` · `PUT /api/orders/:id/payments` · `GET /api/orders/:id/invoice` |
| `customers` | مشتریان، تسویه و دفتر حساب | `GET/POST/PUT/DELETE /api/customers` · `POST /api/customers/:id/settle` |
| `products` | کاتالوگ، قیمت‌گذاری، قیمت اختصاصی هر ویزیتور | `GET /api/products` · `PUT /api/products/:id/custom-settings` |
| `van-inventory` | بارگیری ون و موجودی لحظه‌ای | `GET /api/van-inventory` · `PUT /api/van-inventory/bulk` · `PUT /api/van-inventory/item` |
| `reports` | داشبورد، چک‌ها، مطالبات | `GET /api/reports/dashboard` · `GET /api/reports/checks` · `GET /api/reports/outstanding` |
| `bale` | ارسال فاکتور، اعلان‌ها، وضعیت ربات، polling | `GET /api/bale/status` · `POST /api/bale/send-invoice/:orderId` · `POST /api/bale/webhook` |
| `health` | پروب سلامت | `GET /api/health` |

جریان احراز هویت: ورود روزمره با شماره/رمز و JWT · ثبت‌نام و بازیابی رمز با **OTP بله** که
فقط به گفتگوی همان شماره می‌رود (کد ۲ دقیقه زنده، در حافظه‌ی پروسه؛ با ری‌استارت سرویس باطل می‌شود).

## دیتابیس (`backend/prisma/schema.prisma`)

| جدول | نقش |
|---|---|
| `users` | ویزیتور/مدیر: نقش، وضعیت، `baleChatId` |
| `products` · `user_products` | کاتالوگ سراسری و قیمت/فعال‌بودن اختصاصی هر ویزیتور |
| `customers` · `customer_ledger` | مشتری و دفتر حساب (مانده پس از هر رویداد) |
| `orders` · `order_items` · `order_discount_steps` | فاکتور، اقلام (کارتن/دانه با قیمت snapshot) و پله‌های تخفیف |
| `payments` · `checks` | تسویه (نقد/پوز/چک/نسیه) و مشخصات چک صیادی |
| `van_inventory` | موجودی ون به تفکیک کاربر و محصول |
| `invoice_settings` · `invoice_counters` | تنظیمات چاپ/اعلان و شمارنده‌ی شماره‌ی فاکتور (سال شمسی) |

قواعد مالی در `orders.service.ts` و `customers.service.ts` اعمال می‌شوند؛ محاسبه‌ی سمت کلاینت
در `frontend-app/src/lib/pricing.js` آینه‌ی همان قواعد است و نباید از آن جدا شود:

```text
قیمت کارتن      = قیمت دانه × تعداد در کارتن
تخفیف پله‌ی i   = درصدی: A(i-1) × P/100   |   نقدی: min(A(i-1), F)
مبلغ پس از پله  = A(i) = A(i-1) − D(i)
نسیه            = max(0, مبلغ نهایی − (نقد + پوز + چک))
```

## PWA آفلاین‌محور (`frontend-app/`)

- `src/lib/db.js` — IndexedDB (`vizitik-pwa`) با انباره‌های `kv`, `customers`, `products`,
  `vanInventory`, `pendingOrders`, `ledger`: آینه‌ی محلی داده برای کار بدون اینترنت.
- `src/lib/sync.js` — صف `pendingOrders`؛ هر قلم `ORDER` به `POST /api/orders` و هر
  `VAN_BULK` به `PUT /api/van-inventory/bulk` فرستاده می‌شود و تا موفق‌شدن در صف می‌ماند.
- `src/lib/api.js` — لایه‌ی HTTP و نگه‌داری توکن؛ `src/screens/` صفحه‌ها؛ `src/lib/pricing.js`
  محاسبات؛ `src/styles/` استایل هر صفحه.
- فونت‌ها و آیکون‌ها self-host هستند و Service Worker باندل را کش می‌کند، پس بعد از دیپلوی
  یک بار `Ctrl+Shift+R` لازم است.

## پنل ادمین (`admin/`)

- `server.js` — HTTP سرور بدون فریم‌ورک؛ همه‌ی `/api/*` با هدر `X-Admin-Token` احراز می‌شوند
  (به‌جز `/api/health`) و کوئری‌ها از `guardSql` رد می‌شوند: فقط یک دستور، بدون کامنت،
  سقف ۵۰۰ ردیف برای SELECT در ویرایشگر و سقف `ADMIN_EXPORT_LIMIT` برای `/api/export`؛
  نوشتن (`INSERT/UPDATE/DELETE`) فقط با `allowWrite` و شرط `WHERE`.
- `index.html` + `js/admin.js` + `css/admin.css` — رابط فارسی بدون وابستگی؛ هر بخش به یک API
  واقعی وصل است (کاتالوگ، قیمت اختصاصی، سفارش‌ها، مشتریان، کوئری SQL، خروجی CSV/JSON).

## استقرار

```text
checkout (~/Vizitik)                 نصب (/opt/vizitik)
├── backend/        ──staging+build──►  backend/        systemd: vizitik-backend  (:3000)
├── frontend-app/   ──staging+build──►  frontend-app/   (nginx: frontend-app/dist)
├── admin/          ──copy──────────►   admin/ + backend/admin/  systemd: vizitik-admin (:3001)
├── landing/        ──copy──────────►   landing/        (nginx: /)
├── scripts/        ──copy──────────►   scripts/
└── frontend/       ──(سرو از همان checkout، بدون کپی)──►  سایت قدیمی PHP
```

`scripts/update.sh` هر درخت را در پوشه‌ی موقت روی همان فایل‌سیستم بیلد می‌کند و تنها در صورت
موفقیت جایگزین می‌کند؛ شکست فعال‌سازی یا تست سلامت، نسخه‌ی قبلی را برمی‌گرداند. اسکیما فقط با
`prisma db push` و بدون `--accept-data-loss` جلو می‌رود و نسخه‌ی مستقرشده پس از موفقیت کامل ثبت می‌شود.
