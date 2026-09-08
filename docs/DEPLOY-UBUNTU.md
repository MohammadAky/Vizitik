# راهنمای کامل استقرار روی سرور Ubuntu / Debian

> نسخه: ۱۴۰۵/۰۶ — برای کسی که **دسترسی root** روی سرور Ubuntu/Debian دارد.
> هدف: بالا آوردن بک‌اند (NestJS) + دیتابیس (MySQL/MariaDB محلی) + سرو کردنِ خودِ اپ PWA، همگی روی یک سرور، پشت یک دامنه با HTTPS.
>
> ⚠️ کار در برنچ `feat/pwa-visitor-app` است. فرانت PWA جدید در `frontend-app/` (Vite) و بک‌اند در `backend/` (NestJS) است.

---

## ۰-الف) ⚡ سریع‌ترین راه: اجرای اسکریپت خودکار

یک اسکریپتِ کامل (`deploy/setup-server.sh`) نوشته‌ام که همین راهنما را **خودکار** اجرا می‌کند: نصب پیش‌نیازها، دیتابیس، بیلد بک‌اند + فرانت، سرویس systemd، Nginx، (اختیاری) HTTPS، فایروال و بکاپ.

```bash
# از داخل ریپو، با دسترسی root:
sudo DOMAIN=app.example.com DB_PASS='رمز_قوی' BALE_BOT_TOKEN='توکن_ربات' bash deploy/setup-server.sh
```

- مقادیر را می‌توانی یا همین‌طور به‌صورت متغیر بدهی، یا در بالای خودِ `setup-server.sh` عوض کنی (بلاک «متغیرهای پیکربندی»).
- بدون دامنه: `DOMAIN` را خالی بگذار (یا اصلاً ست نکن) تا از HTTPS رد شود (نصب PWA بعداً — بخش ۱۱).
- اسکریپت **ایدِمپوتنت** است؛ هر وقت خواستی کد/تنظیمات را به‌روز کنی، دوباره اجرایش کن.

> دستورهای گام‌به‌گامِ دستی زیر برای درک کامل و عیب‌یابی هم باقی می‌مانند.

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

> **نام دیتابیس و نام نرم‌افزار دلخواه است** — از `.env` خوانده می‌شود. هرجا خواستی، فقط متغیرها را عوض کن و بقیهٔ دستورها همراستا اجرا می‌شوند:
> - `DB_NAME` : نام دیتابیس (در این مثال `vizitik_db`)
> - `APP_NAME_FA` / `APP_NAME_EN` : نام نمایشی نرم‌افزار (در پیام‌های بله و رابط)
>
> برای تغییر نام، نیازی به دست‌کاری کد نیست.

---

## ۲) دیتابیس MySQL/MariaDB

```bash
systemctl enable --now mariadb
mysql_secure_installation     # رمز root دیتابیس بگذار؛ بقیه را بله/پیش‌فرض
```

رمز اپ و نام دیتابیس را انتخاب کن:
```bash
DB_NAME='vizitik_db'          # ← هر نامی می‌خواهی بگذار
DB_USER='vizitik'
DBPASS='CHANGE_ME_STRONG_PASSWORD'

mysql -u root -p <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DBPASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
```

**ایمپورت دامپ موجود** (ساختار + دادهٔ اولیه از ریپو):
> `documents/hesabchin.sql` دو خطِ ابتدایی `CREATE DATABASE ... hesabchin` و `USE hesabchin` دارد — چون دیتابیس را خودت با `DB_NAME` می‌سازی، این دو خط را حذف کن تا در دیتابیسِ انتخابی‌ات ایمپورت شود:
```bash
sed '/CREATE DATABASE/,/^USE `hesabchin`;/d' documents/hesabchin.sql > /tmp/hesabchin_schema.sql
mysql -u "${DB_USER}" -p"${DBPASS}" "${DB_NAME}" < /tmp/hesabchin_schema.sql
```

تأیید:
```bash
mysql -u "${DB_USER}" -p"${DBPASS}" "${DB_NAME}" -e "SHOW TABLES;"
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
DATABASE_URL="mysql://${DB_USER}:${DBPASS}@localhost:3306/${DB_NAME}"
JWT_SECRET="$(openssl rand -hex 32)"
JWT_EXPIRES_IN="30d"
PORT=3000
# نام نرم‌افزار — دلخواه؛ هر وقت خواستی عوض کن (در پیام‌های بله و خوش‌آمد اعمال می‌شود)
APP_NAME_FA="ویزیتیک"
APP_NAME_EN="Vizitik"
BALE_BOT_USERNAME="HesabchinBot"
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
3. اپ تمام‌صفحه باز می‌شود. با دادهٔ واقعیِ همگام‌شده، در حالت هواپیما هم فاکتور آفلاین قابل ثبت است (هستهٔ آفلاین در فاز ۲ پیاده شده).

> **نکتهٔ تست در مرورگر دسکتاپ:** در Chrome روی دسکتاپ هم می‌توانی نصب را شبیه‌سازی کنی — در DevTools تب *Application → Service Workers* چک کن که SW «activated» است و تب *Network* را روی «Offline» بگذار تا آفلاین را تست کنی.

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

## ۱۱) اگر دامنه نداری — چطور HTTPS معتبر و نصب PWA بگیری

> **خلاصه:** اپ روی `http://IP` برای توسعه کار می‌کند، ولی برای **نصب و آفلاینِ واقعی** به HTTPS معتبر نیاز است (سرویس‌ورکر بدون HTTPS — به‌جز localhost — رجیستر نمی‌شود). لازم نیست دامنه بخریم؛ دو راه رایگان داریم:

| گزینه | مناسب برای | زحمت |
| :-- | :-- | :-- |
| **DuckDNS** | تست واقعی با HTTPS روی سروری که IP دارد | کم — یک زیردامنه + DNS + certbot |
| **Cloudflare Tunnel** | بدون نیاز به IP ثابت/باز کردن پورت | متوسط |

---

### ۱۱-الف) راهِ پیشنهادی: DuckDNS + certbot (ساده و شفاف)

۱. به `https://www.duckdns.org` برو (با حساب گوگل/گیتهاب وارد شو)، یک زیردامنه بساز مثل `vizitik` و IP عمومی سرورت را ثبت کن → `vizitik.duckdns.org`.

۲. روی سرور، دامنه را بگذار و Nginx را با همان مقدار تنظیم کن:
```bash
DOMAIN=vizitik.duckdns.org
sed -i "s/server_name _;/server_name ${DOMAIN};/" /etc/nginx/sites-available/vizitik
nginx -t && systemctl reload nginx
```

۳. گواهی بگیر:
```bash
certbot --nginx -d "${DOMAIN}" --redirect --agree-tos -m you@example.com -n
```

۴. حالا `https://vizitik.duckdns.org` را در گوشی باز کن و «افزودن به صفحهٔ اصلی» را بزن. آفلاین و نصب کامل کار می‌کند.

> **نکته:** DuckDNS با IP متغیر (Dynamic IP) هم کار می‌کند؛ اگر سرورت IP ثابت ندارد، `duckdns` را به‌عنوان cron نصب کن که IP را هر ۵ دقیقه به‌روز کند:
> ```bash
> echo "*/5 * * * * root curl -k https://www.duckdns.org/update?domains=vizitik&token=YOUR_TOKEN&ip=" > /etc/cron.d/duckdns
> ```

---

### ۱۱-ب) راهِ جایگزین: Cloudflare Tunnel (حتی بدون باز کردن پورت)

اگر IP ثابت نداری یا نمی‌خواهی پورتی باز کنی، Cloudflare Tunnel به تو یک URL معتبر HTTPS می‌دهد:

```bash
apt install -y cloudflared
cloudflared tunnel login                 # یک‌بار با مرورگر تأیید کن
cloudflared tunnel create vizitik
# دامنهٔ رایگان (مثلاً با tld رایگان روی Cloudflare) را به tunnel متصل کن:
cloudflared tunnel route dns vizitik app.yourdomain
# اجرا:
cloudflared tunnel run vizitik
```

> با Tunnel، دیگر نیازی به تنظیم رکورد A یا باز کردن پورت ۸۰/۴۴۳ نیست؛ خود Cloudflare ترافیک را به سرورت (حتی پشت NAT) می‌رساند. بعداً فقط یک `config.yml` به Nginx/مستقیم به backend اضافه می‌کنیم.

---

### ۱۱-ج) فقط برای تستِ سریعِ API (بدون HTTPS)

- محلی: `npm run dev` در `frontend-app/` و `npm run start:dev` در `backend/`.
- روی سرور با IP: فقط بخش‌های ۱ تا ۵ (بدون certbot) را بالا بیاور و در توسعه، `VITE_API_URL` را روی `http://IP:3000/api` بگذار. نصب/آفلاینِ کامل بعداً با یکی از دو راه بالا ممکن می‌شود.


---

## ۱۲) نقشهٔ ارتقاهای امنیتی (بعد از راه‌اندازی اول)

- [ ] اجرای بک‌اند با کاربر غیر root (`User=www-data`) + `chown`.
- [ ] تغییر `BALE_BOT_TOKEN` و `JWT_SECRET` به مقادیر اختصاصی و حذف نمونهٔ README.
- [ ] `fail2ban` برای SSH.
- [ ] کلید SSH به‌جای رمز (`PermitRootLogin prohibit-password`).
- [ ] بکاپ خودکار به مقصد خارج از سرور.
