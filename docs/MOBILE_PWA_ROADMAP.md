# نقشهٔ جامع: تبدیل فرانت به اپلیکیشن PWA آفلاین + استقرار بک‌اند روی سرور لینوکس

> نسخه: ۱۴۰۵/۰۶ — مبتنی بر تصمیمات مالک:
> - **نوع اپ:** PWA نصب‌شدنی از مرورگر (نه اپ نیتیو)
> - **آفلاین:** بحرانی — باید بدون اینترنت هم فاکتور زد
> - **دیتابیس:** منتقل به سرور لینوکسی خودش (دسترسی root دارد)
> - **دامنه:** فقط ویزیتور/راننده (مغازه‌ها از طریق ربات بله پیام می‌گیرند)

---

## ۰) خلاصهٔ وضعیت فعلی (بررسی‌شده از کد)

| بخش | واقعیت فعلی |
| :-- | :-- |
| بک‌اند | NestJS (TypeScript) روی پورت `3000`، احراز JWT، `enableCors()`، ربات بله داخل همان پروسه |
| دیتابیس | **MySQL/MariaDB** — اسکیما `hesabchin`، خروجی کامل در `documents/hesabchin.sql`، اسکیمای Prisma `provider = "mysql"` ✔ |
| `.env.example` و README | اشتباهاً Supabase/Postgres نوشته شده → **منسوخ و گمراه‌کننده** |
| فرانت | ~۱۵ صفحهٔ PHP **سمت‌سرور رندر**؛ داده با `apiCall()`/curl از بک‌اند گرفته و HTML روی سرور ساخته می‌شود |
| چرا آفلاین نمی‌شود | چون HTML هر بار توسط PHP ساخته می‌شود، چیزی برای کش/اجرای آفلاین در موبایل نیست |

> ⚠️ **نتیجهٔ کلیدی:** آفلاینِ بحرانی با PHP سمت‌سرور **غیرممکن** است. شرط لازم، انتقال «گرفتن داده و ساخت رابط» به **سمت کلاینت (SPA)** است که مستقیم با JWT به API وصل شود.

---

## ۱) معماری هدف

```
موبایل/مرورگر (PWA نصب‌شده)
 ─ Vite + React (فرانتِ استاتیک، فقط فایل‌های خشک) ─
    • Shell اپ: ناوبری بین صفحات (داشبورد، بار، ثبت سفارش، پرداخت، ...)
    • Token JWT ذخیره در IndexedDB (امن نسبت به localStorage در SW)
    • Service Worker: کش آفلاین (runtime + precache شِل)
    • IndexedDB: دیتابیس محلی (مشتریان، بار وانت، سفارشاتِ در انتظار)
    • Sync Queue: صف ارسال سفارشات آفلاین → سمت سرور پس از اتصال
        └─► HTTPS
سرور لینوکس (دسترسی root)
 ├── Nginx (ریورس‌پروکسی + TLS/Let's Encrypt برای دامنه)
 ├── Node (NestJS backend، بیلد dist/main.js) به‌عنوان سرویس systemd/PM2
 └── MariaDB/MySQL محلی (دیتابیس `hesabchin`، ایمپورت از documents/hesabchin.sql)
```

**قاعدهٔ طلایی طراحی:**
- سرور فقط **API خام** می‌دهد؛ هرگز HTML آماده نمی‌سازد (فعلاً PHP هست، بعداً حذف می‌شود).
- همهٔ وضعیت (سبد، بار، مشتری انتخاب‌شده) در **مرورگر** نگهداری می‌شود تا در قطع‌اینترنت هم کار کند.
- هر نوشتن (فاکتور، دریافت وجه) اول به صف محلی IndexedDB، بعد در صورت آنلاین بودن بلافاصله sync شود.

---

## ۲) استقرار بک‌اند روی سرور لینوکسی (قدم‌های اول — می‌توانی همین الان انجام دهی)

> فرض: سیستم عامل Debian/Ubuntu. اگر Rocky/CentOS بودی دستور `apt` را با `dnf` عوض کن.

### گام ۲.۱ — به‌روزرسانی و نصب پیش‌نیازها
```bash
# به‌عنوان root یا با sudo
apt update && apt upgrade -y
apt install -y curl git nginx ufw nodejs npm
node -v   # باید ≥ 18 باشد؛ اگر پایین‌تر بود:
# curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
```

### گام ۲.۲ — نصب MariaDB و ساخت دیتابیس
```bash
apt install -y mariadb-server
systemctl enable --now mariadb
mysql_secure_installation   # رمز root دیتابیس را بگذار

# ساختن کاربر اپ و دیتابیس
mysql -u root -p
CREATE DATABASE IF NOT EXISTS hesabchin CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'vizitik'@'localhost' IDENTIFIED BY 'YOUR_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON hesabchin.* TO 'vizitik'@'localhost';
FLUSH PRIVILEGES;
EXIT
```
ایمپورت دامپ موجود (ساختار + دادهٔ اولیه):
```bash
mysql -u vizitik -p hesabchin < documents/hesabchin.sql
```

> ✅ اگر دادهٔ واقعیِ پروداکشن هنوز روی Supabase/MySQL جای دیگر است، بعداً جداگانه dump و import می‌کنیم. (نقطهٔ تصمیم: قبل از کات‌اور confirm کن.)

### گام ۲.۳ — آپلود/کلون و بیلد بک‌اند
```bash
mkdir -p /opt/vizitik && cd /opt/vizitik
# یا کلون ریپو، یا فقط پوشهٔ backend را کپی کن
cd backend
npm install
npx prisma generate

# فایل .env — مقادیر درست (MySQL محلی، نه Supabase!)
cat > .env <<'EOF'
DATABASE_URL="mysql://vizitik:YOUR_STRONG_PASSWORD@localhost:3306/hesabchin"
JWT_SECRET="change-me-to-a-long-random-string"
JWT_EXPIRES_IN="30d"
PORT=3000
BALE_BOT_TOKEN="<توکنِ ربات خودت>"
BALE_ADMIN_CHAT_ID="<آی‌دیِ چت ادمین>"
EOF

# سینک اسکیما (ایمن: جداول را با داده موجود هماهنگ می‌کند)
npx prisma db push

# بیلد پروودکشن
npm run build    # خروجی: dist/main.js
```

### گام ۲.۴ — اجرای دائمی به‌عنوان سرویس systemd
```bash
cat > /etc/systemd/system/vizitik-backend.service <<'EOF'
[Unit]
Description=Vizitik NestJS Backend
After=network.target mariadb.service

[Service]
Type=simple
WorkingDirectory=/opt/vizitik/backend
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now vizitik-backend
systemctl status vizitik-backend      # چک کن running باشد
journalctl -u vizitik-backend -f      # لاگ‌ها
```

### گام ۲.۵ — Nginx به‌عنوان ریورس‌پروکسی + HTTPS
> برای PWA نصب‌شدنی، HTTPS و یک **دامنهٔ واقعی** ضروری است (مرورگرها نصبِ PWA بدون HTTPS معتبر و بدون آیکون/منیفست را رد می‌کنند).
```bash
apt install -y certbot python3-certbot-nginx

cat > /etc/nginx/sites-available/vizitik <<'EOF'
server {
    listen 80;
    server_name app.yourdomain.com;   # ← دامنه‌ات را بگذار

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
ln -s /etc/nginx/sites-available/vizitik /etc/nginx/sites-enabled/vizitik
nginx -t && systemctl reload nginx

# گواهی SSL رایگان
certbot --nginx -d app.yourdomain.com
```

### گام ۲.۶ — فایروال
```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

**نتیجه:** `https://app.yourdomain.com/api/...` باید جواب بدهد و ربات بله هم در همین سرویس فعال است.

> گزینهٔ جایگزین (اختیاری): **Docker Compose** برای backend + mariadb. اگر بخواهی هر دو سرویس را ایزوله و پرتابل کنی، یک `docker-compose.yml` آماده می‌کنم.

---

## ۳) تبدیل فرانت به PWA آفلاین (بازنویسی سمت‌کلاینت)

### گام ۳.۱ — انتخاب و اسکلت پشته
- **پیشنهاد:** پوشهٔ جدید `frontend-app/` با **Vite + React** (دقیقاً طبق نقشهٔ راهِ مستر‌داک)، RTL با وزیرمتن، آیکون Material.
- افزونهٔ **`vite-plugin-pwa`** (شامل workbox) برای تولید خودکار منیفست + Service Worker.
- **`idb` یا Dexie** برای IndexedDB محلی.
- ساختار:
```
frontend-app/
├── src/
│   ├── api/           # کلاینت API (JWT در IndexedDB، fetch با base=https://app.…/api)
│   ├── db/            # لایهٔ IndexedDB (tables: customers, vanInventory, products, pendingOrders, ledger)
│   ├── sync/          # Sync Queue + همگام‌سازی پس از اتصال
│   ├── screens/       # dashboard, van-loading, new-order, payment, orders, collections, products, settings, login
│   ├── components/
│   └── App.jsx        # ناوبری + محافظ احراز
├── index.html         # شامل <link manifest.webmanifest> و آیکون‌ها
└── vite.config.js     # plugin PWA (offline، precache shell)
```

### گام ۳.۲ — احراز هویت مستقیم با JWT
الان PHP از `index.php → fetch auth/login → set_session.php` می‌رود. در SPA:
- `POST /api/auth/login` با `{phone, password}` → توکن JWT را بگیر.
- توکن را در **IndexedDB** (نه localStorage که از SW هم قابل دسترس باشد) نگه دار.
- هر درخواست `Authorization: Bearer <token>`.
- آفلاین؟ اگر کاربر لاگین‌کرده بود و کش داشته باشد، وارد شل می‌شود (اعتبار لاگین تا ۳۰ روزه است).

### گام ۳.۳ — لایهٔ آفلاین (مهم‌ترین بخش)
معماری «آفلاین-اول» برای ویزیتور:
1. **ساعت‌های حضور اینترنت** (صبح در پایگاه/انبار که بارگیری می‌کند): داده‌ها را در IndexedDB بریز:
   - `vanInventory` (بار واقعی وانت) ← `GET /api/van-inventory`
   - `customers` (فهرست مغازه‌ها با بدهی) ← `GET /api/customers`
   - `products` (کاتالوگ) ← `GET /api/products`
2. **در محل کار، حتی آفلاین:** ثبت سفارش، اعمال تخفیف پلکانی و صدور فاکتور **همه در موبایل** انجام می‌شود (همان منطقی که الان توی `payment.js` است را در کلاینت بازپیاده‌سازی می‌کنیم تا ریاضیِ تخفیف/فاکتور آفلاین هم جواب بدهد).
3. فاکتورِ تکمیل‌شده با `localUuid` به جدول `pendingOrders` (IndexedDB) می‌رود.
4. **Sync Queue:** هنگام آنلاین‌شدن (رویداد `online`) هر سفارشِ در انتظار را `POST /api/orders` می‌کند. بک‌اند از قبل با `localUuid` جلوی ثبت تکراری را گرفته است (پشتیبانی آفلاین دارد).
5. Service Worker با استراتژی **stale-while-revalidate** برای کش؛ و **network-first** برای همگام‌سازی.

### گام ۳.۴ — معادل صفحه‌به‌صفحه (دامنه فقط ویزیتور)
| PHP فعلی | Screen هدف | آفلاین؟ |
| :-- | :-- | :-- |
| `index.php` / `register.php` | `login` / `register` (با شرط قوانین) | ساده |
| `dashboard.php` | `dashboard` | نمایش از کش |
| `van-loading.php` | `van-loading` (بارگیری صبح) | باید آنلاین در ابتدا |
| `new-order.php` + `payment.php` | `order` (سبد + تخفیف + تسویه) | ✔️ بحرانی |
| `orders.php` | `orders` (تاریخچه + ویرایش پرداخت) | ✔️ |
| `collections.php` | `collections` (وصول/چک) | ✔️ |
| `products.php` | `products` (کاتالوگ) | از کش |
| `settings.php` / `about.php` / `help.php` | `settings` و… | ساده |

### گام ۳.۵ — کارهایی که در همین محیطِ توسعه الان می‌توانم انجام دهم
(هر بار در یک فاز کوچک، تست‌شده و کامیت‌شده — نه یک‌باره):
- [ ] اسکلت `frontend-app` با Vite + React + RTL + وزیرمتن + منیفست و SW قابل نصب
- [ ] کلاینت API با JWT ذخیره در IndexedDB + صفحهٔ login/register
- [ ] شل اپ با ناوبری bottom-tab (همان مدل فعلی)
- [ ] لایهٔ IndexedDB و فاز «بارگیری صبحگاهی» (van-loading) — اولین نقطهٔ داده
- [ ] سپس فاز به‌فاز: dashboard ← new-order/payment (هستهٔ آفلاین) ← orders ← collections ← products/settings

> هر فاز با بک‌اندِ واقعی تست می‌شود. تا وقتی سرور بالا نیامده، از `http://localhost:3000` برای توسعه استفاده می‌کنیم.

---

## ۴) اولویت پیشنهادی اجرا

**مرحلهٔ A (الان، توسط خودت یا با راهنمایی من):** سرور را با گام‌های بخش ۲ بالا بیاور و API را از بیرون جواب بگیر → `https://app.…/api/reports/dashboard` با توکن جواب دهد.

**مرحلهٔ B (توسط من، این‌جا):** اسکلت PWA (گام ۳.۱) + login (گام ۳.۲). خروجی: یک اپ نصب‌شدنی که لاگین می‌کند و شل دارد.

**مرحلهٔ C:** لایهٔ آفلاین + فازهای دادگانی (۳.۳).

**مرحلهٔ D:** ساخت/تست/امضای build نهایی، انتشار روی سرور، هدایت دامنه، (اختیاری) قرار دادن در استور یا PWA فقط با دامنه.

---

## ۵) ریسک‌ها و نکات مهم
1. **بک‌اند `localUuid` و کسر موجودی تراکنشی دارد** — برای syncِ امن آفلاین حیاتی است؛ آن را حفظ کن، حذفش نکن.
2. **قوانین و مقررات ثبت‌نام** باید در نسخهٔ SPA هم بماند (الان در `frontend/terms-content.php` و `register.php`/`index.php` است).
3. **هشتگ ویزیتور در پیام بله** الان سمت بک‌اند جایگزین می‌شود (`{نام_ویزیتور}`) — وقتی فرانت به SPA رفت، این الگو نباید به کلاینتِ تازه برسد؛ از همان API منظم می‌آید.
4. **HTTPS + دامنهٔ واقعی برای نصب PWA الزامی است.**
5. ربات بله و پیام‌های فاکتور به مشتریان **مستقل از فرانت** است و با بالا آمدن بک‌اند روی سرور خودکار کار می‌کند.
