# راهنمای کامل استقرار روی سرور Ubuntu / Debian

> نسخه: ۱۴۰۵/۰۶ — برای کسی که **دسترسی root** روی سرور Ubuntu/Debian دارد.
> هدف: بالا آوردن بک‌اند (NestJS) + دیتابیس (MySQL/MariaDB محلی) + سرو کردنِ خودِ اپ PWA، همگی روی یک سرور، پشت یک دامنه با HTTPS.
>
> ⚠️ کار در برنچ `feat/pwa-visitor-app` است. فرانت PWA جدید در `frontend-app/` (Vite) و بک‌اند در `backend/` (NestJS) است.

---

## ۰) نقشهٔ کلی (یک سرور = سه نقش)

```
اینترنت ──► https://app.EXAMPLE.com
                 │  (Nginx روی سرور)
        ┌────────┴─────────┐
   location /  (استاتیک)   │  location /api  (ریورس‌پروکسی)
   → frontend-app/dist     │  → 127.0.0.1:3000  (NestJS)
   = خودِ اپ PWA           │      → MariaDB (localhost:3306)
                           │      → ربات بله (داخل همین پروسه)
```

چرا همه‌چیز هم‌ریشه است؟ چون اپ PWA با **مسیر نسبی** `/api/...` صحبت می‌کند، پس با یک دامنه همهٔ مشکلات CORS/هاست/کوکی از بین می‌رود.

---

## ۱) آماده‌سازی سیستم (root)

```bash
sudo -i
apt update && apt upgrade -y
apt install -y curl git nginx ufw nodejs npm mariadb-server certbot python3-certbot-nginx
```

**Node را بررسی کن (حداقل 18):**
```bash
node -v
```
اگر خیلی قدیمی/نیست:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v
```

**مشخص کن دامنه چیست** — این متغیر در تمام دستورهای بعد استفاده می‌شود:
```bash
DOMAIN=app.EXAMPLE.com     # ← فقط این را با دامنهٔ خودت عوض کن
```

**DNS:** مطمئن شو یک رکورد `A` برای `app.EXAMPLE.com` به IP سرور اشاره می‌کند.

---

## ۲) دیتابیس MySQL/MariaDB

```bash
systemctl enable --now mariadb
mysql_secure_installation     # رمز root دیتابیس بگذار؛ بقیه را بله/پیش‌فرض
```

رمز اپ را انتخاب و ذخیره کن (یک رمز قوی، بدون کاراکترهای خطرناک در رشتهٔ اتصال):
```bash
DBPASS='CHANGE_ME_STRONG_PASSWORD'
mysql -u root -p <<SQL
CREATE DATABASE IF NOT EXISTS hesabchin CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'vizitik'@'localhost' IDENTIFIED BY '${DBPASS}';
GRANT ALL PRIVILEGES ON hesabchin.* TO 'vizitik'@'localhost';
FLUSH PRIVILEGES;
SQL
```

**ایمپورت دامپ موجود** (ساختار + دادهٔ اولیه از ریپو):
```bash
mysql -u vizitik -p"${DBPASS}" hesabchin < documents/hesabchin.sql
```

تأیید:
```bash
mysql -u vizitik -p"${DBPASS}" hesabchin -e "SHOW TABLES;"
```

---

## ۳) کپی کد روی سرور و بیلد

```bash
mkdir -p /opt/vizitik && cd /opt/vizitik
# یا کلون، یا پوشه‌های backend و frontend-app را با scp/copy منتقل کن.
```

### ۳-الف) بک‌اند (NestJS)
```bash
cd /opt/vizitik/backend
npm install --omit=dev
npx prisma generate
cat > .env <<EOF
DATABASE_URL="mysql://vizitik:${DBPASS}@localhost:3306/hesabchin"
JWT_SECRET="$(openssl rand -hex 32)"
JWT_EXPIRES_IN="30d"
PORT=3000
BALE_BOT_TOKEN="2089208057:mqfJ2g1Vbxn-gdtP7e3Lm6T24ou6WK0CuFc"
BALE_ADMIN_CHAT_ID="542633638"
EOF
npx prisma db push     # سینک اسکیما با جداول موجود (ایمن)
npm run build          # خروجی: dist/main.js
```

### ۳-ب) فرانت PWA (Vite)
```bash
cd /opt/vizitik/frontend-app
npm install
npm run build          # خروجی: dist/ (شامل sw.js و manifest)
```

---

## ۴) سرویس دائمی بک‌اند (systemd)

```bash
cat > /etc/systemd/system/vizitik-backend.service <<'EOF'
[Unit]
Description=Vizitik NestJS Backend (API + Bale bot)
After=network.target mariadb.service

[Service]
Type=simple
WorkingDirectory=/opt/vizitik/backend
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now vizitik-backend
systemctl status vizitik-backend --no-pager
journalctl -u vizitik-backend -n 50 --no-pager     # دیدن لاگ
```

> نکتهٔ امنیتی: می‌توانی به‌جای `User=root` یک کاربر معمولی مثل `www-data` بسازی و مالکیت پوشه را بدهی. برای سادگی اول از root شروع می‌کنیم (این خودِ کلاینت از بیرون فقط از طریق Nginx دیده می‌شود).

تست محلی API:
```bash
curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"09121234567","password":"123456"}'
```
> باید یک `accessToken` برگرداند.

---

## ۵) Nginx (ریورس‌پروکسی + سرو استاتیک PWA)

```bash
cat > /etc/nginx/sites-available/vizitik <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name _;
    root /opt/vizitik/frontend-app/dist;
    index index.html;

    # PWA باید فایل index را برای هر مسیرِ داخلی برگرداند
    location / {
        try_files $uri $uri/ /index.html;
    }

    # مسیرهای Service Worker / منیفست نباید کشِ مرورگر بخورند
    location ~* (sw\.js|workbox-.*\.js|manifest\.webmanifest)$ {
        expires -1;
        add_header Cache-Control "no-cache";
        add_header Service-Worker-Allowed "/";
    }

    # فایل‌های بیلد (با هش) کش بلندمدت
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # ریورس‌پروکسی به بک‌اند NestJS
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
EOF

ln -s /etc/nginx/sites-available/vizitik /etc/nginx/sites-enabled/vizitik
rm -f /etc/nginx/sites-enabled/default        # حذف صفحهٔ پیش‌فرض
nginx -t && systemctl reload nginx
```

> اگر `server_name _;` را داری، بعد از گرفتن گواهی، certbot مقدار را با دامنه درست‌سازی می‌کند. دامنه را هم می‌توانی دستی بگذاری: `server_name ${DOMAIN};`

---

## ۶) HTTPS با Let's Encrypt (ضروری برای نصب PWA)

```bash
sed -i "s/server_name _;/server_name ${DOMAIN};/" /etc/nginx/sites-available/vizitik
nginx -t && systemctl reload nginx

certbot --nginx -d "${DOMAIN}" --redirect --agree-tos -m you@example.com -n
```

تأیید نهایی:
```bash
curl -sI https://${DOMAIN}/ | head -3
curl -s https://${DOMAIN}/api/  -o /dev/null -w "api http %{http_code}\n"
```

---

## ۷) فایروال UFW

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status verbose
```

---

## ۸) نصب PWA روی گوشی + تست آفلاین

1. در مرورگر گوشی به `https://app.EXAMPLE.com` برو.
2. در منوی مرورگر «افزودن به صفحهٔ اصلی / Install app» را بزن (برای کروم اندروید معمولاً از نوار آدرس).
3. اپ تمام‌صفحه باز می‌شود. با دادهٔ واقعیِ همگام‌شده، در حالت هواپیما هم فاکتور آفلاین قابل ثبت است (در فاز ۲ که هستهٔ آفلاین می‌رسد).

---

## ۹) بکاپ‌گیری منظم (مهم)

کرون‌جاب روزانه:
```bash
cat > /etc/cron.d/vizitik-backup <<'EOF'
SHELL=/bin/bash
# ساعت ۲ بامداد هر روز، دامپ دیتابیس
0 2 * * * root mysqldump -u vizitik -p'CHANGE_ME_STRONG_PASSWORD' hesabchin > /var/backups/hesabchin-$(date +\%F).sql && find /var/backups -name 'hesabchin-*.sql' -mtime +7 -delete
EOF
```
> این بکاپ را حتماً به جای امنِ بیرون از سرور (مثل S3/Google Drive) انتقال بده.

---

## ۱۰) عیب‌یابی سریع

| مشکل | راه‌حل |
| :-- | :-- |
| `curl /api/auth/login` روی سرور جواب می‌دهد ولی از بیرون نه | `ufw status` را چک کن؛ `Nginx Full` باز باشد |
| «Bad Gateway / 502» از Nginx | بک‌اند down است: `systemctl status vizitik-backend` و `journalctl` |
| گواهی می‌خواهد ولی DNS تنظیم نشده | رکورد A دامنه → IP سرور |
| اپ نصب نمی‌شود / دکمهٔ Install نیست | باید HTTPS معتبر + همین دامنه باشد + منیفست با آیکون ۱۹۲/۵۱۲ |
| بعد از آپدیت کد، SW قدیمی می‌ماند | `vite-plugin-pwa` با `registerType:'autoUpdate'` به‌روز می‌کند؛ یک بار ریفرش کافی است |
| CORS/توکن درخواست | همه از همان دامنه نسبی برو؛ اگر از IP جدا می‌زنی مسیر کامل بده |

---

## ۱۱) اگر هنوز دامنه نداری (تست سریع)

بدون دامنهٔ واقعی، مرورگر اجازهٔ «نصب» نمی‌دهد، ولی برای **توسعه/تست** کافی است:

- محلی: `npm run dev` در `frontend-app/` و `npm run start:dev` در `backend/`.
- روی سرور با IP: فقط API را (بخش‌های ۱ تا ۵ بدون certbot) بالا بیاور و در توسعه از `VITE_API_URL` روی `http://IP:3000/api` استفاده کن. برای «نصب» واقعی بعداً یک دامنه بگیر و certbot بزن (یا از Cloudflare Tunnel استفاده کن که حتی بدون باز کردن پورت، HTTPS معتبر می‌دهد).

---

## ۱۲) نقشهٔ ارتقاهای امنیتی (بعد از راه‌اندازی اول)

- [ ] اجرای بک‌اند با کاربر غیر root (`User=www-data`) + `chown`.
- [ ] تغییر `BALE_BOT_TOKEN` و `JWT_SECRET` به مقادیر اختصاصی و حذف نمونهٔ README.
- [ ] `fail2ban` برای SSH.
- [ ] کلید SSH به‌جای رمز (`PermitRootLogin prohibit-password`).
- [ ] بکاپ خودکار به مقصد خارج از سرور.
