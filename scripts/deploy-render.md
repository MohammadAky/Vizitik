# استقرار ویزیتیک روی Render + اتصال دامنهٔ شخصی

این راهنما مسیر کامل را می‌پوشاند: از اولین دیپلوی تا وصل شدن
`app.دامنه‌ی‌شما` / `admin.دامنه‌ی‌شما` / دامنهٔ ریشه با SSL.

---

## ۰) معماری — چه چیزی روی Render بالا می‌آید

```
https://app.دامنه‌ی‌شما           https://admin.دامنه‌ی‌شما     https://دامنه‌ی‌شما
        │                                  │                        │
        ▼                                  ▼                        ▼
┌─────────────────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  vizitik-app (Web Service)  │   │ vizitik-admin    │   │ vizitik-landing  │
│  ┌───────────────────────┐  │   │ (Web Service)    │   │ (Static Site)    │
│  │ NestJS API  →  /api/* │  │   │ پنل SQL / کاتالوگ│   │ صفحهٔ معرفی     │
│  │ PWA (بیلد Vite) → /   │  │   │                  │   │                  │
│  └───────────────────────┘  │   └────────┬─────────┘   └──────────────────┘
└──────────────┬──────────────┘            │
               ▼                           ▼
        MySQL (خارجی روی VPS یا خود Render)
```

نکته‌های مهم:

- **PWA و API هم‌ریشه‌اند.** بک‌اند وقتی بیلد PWA (`frontend-app/dist`)
  را ببیند، خودش آن را سرو می‌کند — دقیقاً همان کاری که Nginx روی سرور
  VPS انجام می‌دهد (`docs/DEPLOY-UBUNTU.md`، بخش ۵). بنابراین PWA با مسیر
  نسبی `/api/...` صحبت می‌کند، کش آفلاینِ workbox درست کار می‌کند و
  دامنهٔ شخصی‌ات فقط **یک** سرویس می‌خواهد.
- **پنل ادمین** سرویس جدا است (روی سرور VPS همان‌طور پشت Nginx است، اینجا
  خود Render پروکسی می‌کند).
- **لندینگ** Static Site است (رایگان).
- **فرانتِ PHP (`frontend/`) روی Render نمی‌آید.** Render ران‌تایم PHP
  ندارد و PWA (frontend-app) پورت کاملِ سمتِ کلاینت همان صفحات PHP است —
  نسخهٔ PHP را روی سرور VPS خودت نگه دار؛ برای کار روزمره نیازی به آن نیست.

---

## ۱) پیش‌نیازها

| مورد | توضیح |
|---|---|
| حساب Render | [render.com](https://render.com) — برای پلن‌های پولی کارت اعتباری لازم است |
| ریپوی GitHub | کد با آخرین تغییرات push شده باشد |
| یک MySQL | یا روی VPS خودت (مربوط به ۴-۱) یا روی خود Render (مربوط به ۴-۲) |
| یک دامنه | هر TLD (`.ir` / `.com` / ...) — فقط باید DNS آن را کنترل کنی |

> Render **دیتابیس MySQL مدیریت‌شده ندارد** (پستگرس و Mongo دارد).
> بک‌اند ویزیتیک روی MySQL/ماریا‌دی‌بی است، پس دیتابیس باید یا روی VPS
> خودت باشد یا به‌صورت Docker روی Render (بخش ۴). اسکیما را **دست نزن**.

---

## ۲) دیپلوی با Blueprint (توصیه‌شده)

فایل `render.yaml` در ریشهٔ ریپو سه سرویس را تعریف می‌کند:

| سرویس | نوع | پلن پیش‌فرض |
|---|---|---|
| `vizitik-app` | Web Service (Node) — API + PWA | `starter` (برای تست: `free`) |
| `vizitik-admin` | Web Service (Node) — پنل ادمین | `starter` (برای تست: `free`) |
| `vizitik-landing` | Static Site | `free` (همیشه رایگان) |

مراحل:

1. تغییرات را push کن:
   ```bash
   git add -A && git commit -m "render deploy" && git push
   ```
2. در [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
3. ریپوی GitHub خودت را وصل کن و **Create Blueprint** بزن.
   سه سرویس ساخته می‌شود؛ `DATABASE_URL` هنوز خالی است (عمداً در فایل نیست).
4. روی هر دو سرویسِ `vizitik-app` و `vizitik-admin` برو:
   **Environment** تب → `DATABASE_URL` را با مقدار بخش ۴ وارد کن.
   (سایر متغیرها — `JWT_SECRET`، `ADMIN_TOKEN` — خودکار ساخته می‌شوند.)
5. بگذار build تمام شود و صفحه را باز کن:
   ```bash
   curl -I https://vizitik-app.onrender.com/            # باید 200 و html بدهد
   curl https://vizitik-app.onrender.com/api/bale/status  # باید JSON بدهد
   ```
6. **سینک جداول** (یک‌بار، بعد از اولین دیپلوی موفق) — روی سرویس
   `vizitik-app` تب **Shell** را باز کن:
   ```bash
   cd backend
   npx prisma db push
   ```
   اگر MySQL خالی است، جداول ساخته می‌شوند. اگر دیتای قبلی (دُمپ
   `documents/hesabchin.sql`) را هم می‌خواهی، بعد از `db push` آن را وارد کن
   (بخش ۴-۱).
7. وارد پنل ادمین شو (`https://vizitik-admin.onrender.com`) با
   `ADMIN_TOKEN` (از تب Environment همان سرویس) و یک حساب تست بساز
   (مثل بخش ۱۰ راهنمای VPS یا با یک کوئری INSERT ساده).

---

## ۳) تنظیم دستی (اگر Blueprint نمی‌خواهی)

اگر ترجیح می‌دهی سرویس‌ها را دستی بسازی، این مقادیر **دقیقاً** همان چیزی
اند که `render.yaml` می‌گذارد:

### ۳-۱ سرویس اصلی — `vizitik-app`
- **Runtime:** Node · **Region:** هرکدام (نزدیک‌ترین به کاربران)
- **Build Command:**
  ```bash
  cd frontend-app && npm install --no-audit --no-fund && npm run build &&
  cd ../backend && npm install --no-audit --no-fund && npx prisma generate && npm run build
  ```
- **Start Command:**
  ```bash
  cd backend && node dist/main.js
  ```
- **Health Check Path:** `/`
- **Environment:** `NODE_ENV=production`، `JWT_EXPIRES_IN=30d`،
  `JWT_SECRET` (تصادفی ۴۸ کاراکتر)، `DATABASE_URL` (مربوط به ۴)، و در
  صورت نیاز `BALE_BOT_USERNAME` / `BALE_BOT_TOKEN` / `BALE_ADMIN_CHAT_ID`.

### ۳-۲ سرویس پنل ادمین — `vizitik-admin`
- **Runtime:** Node · **Root Directory:** `admin`
- **Build Command** (کلاینت Prisma را از همان اسکیمای بک‌اند می‌سازد):
  ```bash
  cd .. &&
  (cd backend && npm install --no-audit --no-fund && npx prisma generate) &&
  cd admin && npm install --no-audit --no-fund &&
  rm -rf node_modules/@prisma/client node_modules/.prisma &&
  cp -r ../backend/node_modules/@prisma/client node_modules/@prisma/client &&
  cp -r ../backend/node_modules/.prisma node_modules/.prisma
  ```
- **Start Command:** `node server.js`
- **Health Check Path:** `/api/health`
- **Environment:** `HOST=0.0.0.0`، `ADMIN_TOKEN` (تصادفی بلند)، `DATABASE_URL`.

> ⚠️ کپیِ `node_modules/.prisma` را جا ننداز — بدون آن پنل با خطای
> `@prisma/client did not initialize yet` بالا نمی‌آید.

### ۳-۳ لندینگ — `vizitik-landing`
- **Static Site** (در بلوپرینت: `type: web` + `runtime: static`)
- **`staticPublishPath`:** `landing` (مسیر ریشهٔ فایل‌های استاتیک، نسبت به ریشهٔ ریپو)
- بدون Build Command (فایل‌ها همان‌جا سرو می‌شوند):
  ```yaml
  - type: web
    name: vizitik-landing
    runtime: static
    rootDir: landing
    buildCommand: true
    staticPublishPath: landing
  ```
- قبل از دیپلوی، `appUrl` در `landing/js/config.js` را روی دامنهٔ اپ
  خودت (`https://app.دامنه‌ی‌شما`) بگذار تا دکمه‌ها درست لینک بزنند.

---

## ۴) دیتابیس MySQL

### ۴-۱ MySQL روی VPS خودت (توصیه‌شده اگر قبلاً داری)

بک‌اند از Render باید بتواند به MySQL وصل شود، یعنی:

1. کاربر/دیتابیس مجزا بساز:
   ```sql
   CREATE DATABASE vizitik_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'vizitik'@'%' IDENTIFIED BY 'یک_رمز_بلند_تصادفی';
   GRANT ALL PRIVILEGES ON vizitik_db.* TO 'vizitik'@'%';
   ```
2. `my.cnf` → `bind-address = 0.0.0.0` (یا `*`) و ری‌استارت ماریا/مای‌اس‌کیو‌اِل.
3. فایروال: پورت ۳۳۶ فقط برای Render باز باشد. Render لیست IP ثابت
   ندارد، پس عملاً باید ۳۳۰۶ به همه باز باشد — **رمز را قوی بگیر** و ترجیحاً
   روی سرور خودت UFW را طوری تنظیم کن که ۳۳۰۶ فقط از IPهای موردنظر بیاید
   (اگر Render در شبکهٔ خصوصی‌ات نبود، گزینهٔ ۴-۲ تمیزتر است).
4. `DATABASE_URL` (در هر دو سرویس):
   ```
   mysql://vizitik:رمز@آی‌پی_یا_دامنه_VPS:3306/vizitik_db
   ```
   (کاراکترهای خاص رمز — `@ : / # %` — را URL-encode کن.)

**دیتای قبلی:** اول `npx prisma db push` (ساخت جداول) و بعد دُمپ را
وارد کن: `mysql -h ... vizitik_db < documents/hesabchin.sql`.
اگر دیتابیس جدید و خالی است فقط `db push` کافی است.

### ۴-۲ MySQL روی خود Render (اگر MySQL نداری)

ساده‌ترین حالت: از [تمپلیت رسمی MySQL](https://render.com/templates/mysql)
یک سرویس بساز (یک‌کلیک؛ دیسک دائمی و شبکهٔ خصوصی را خودکار می‌گذارد).
دستی هم می‌شود:

1. **New → Web Service → Existing Image** → `mysql:8.0`
2. **Environment:**
   ```
   MYSQL_ROOT_PASSWORD=...   MYSQL_DATABASE=vizitik_db
   MYSQL_USER=vizitik        MYSQL_PASSWORD=...
   ```
3. **Attach Disk:** حداقل ۱ گیگ، مسیر mount = `/var/lib/mysql`
   (بدون دیسک، دیتا با هر دیپلوی پاک می‌شود!)
4. **Networking:** Public Port را **خاموش** کن و Private Networking را روشن.
5. حالا در همان سرویس، **Internal URL/Hostname** را کپی کن و بساز:
   ```
   mysql://vizitik:رمز@<hostname_درونی>:3306/vizitik_db
   ```
   این آدرس فقط از سرویس‌های هم‌حساب Render قابل دسترسی است — امن‌تر از ۴-۱.
6. `prisma db push` را از Shellِ `vizitik-app` بزن (مربوط به ۲-۶).

> هر دو سرویسِ app و admin باید به همان `DATABASE_URL` بچسبند.

---

## ۵) ربات بله (اختیاری)

در Environment سرویس `vizitik-app` این سه تا را بگذار (خالی = ربات خاموش):

| متغیر | مقدار |
|---|---|
| `BALE_BOT_USERNAME` | نام‌کاربری ربات بدون `@` (مثلاً `Vizitik_bot`) |
| `BALE_BOT_TOKEN` | توکن از BotFather بله |
| `BALE_ADMIN_CHAT_ID` | آی‌دی چت ادمین برای هشدارها |

⚠️ در پلن **free** سرویس بعد از ۱۵ دقیقه بی‌ترافیک خواب می‌رود؛ در خواب،
پیام‌های بله ارسال نمی‌شوند. اگر ربات برایت جدی است، سرویس app را روی
`starter` بگذار (بخش ۸).

---

## ۶) اتصال دامنهٔ شخصی (بخش اصلی)

### ۶-۱ تقسیم دامنه‌ها

| دامنه | سرویس Render | چه چیزی سرو می‌کند |
|---|---|---|
| `app.دامنه‌ی‌شما` | `vizitik-app` | PWA + API (نصب روی گوشی از همین‌جا) |
| `admin.دامنه‌ی‌شما` | `vizitik-admin` | پنل ادمین |
| `دامنه‌ی‌شما` (ریشه) | `vizitik-landing` | لندینگ |

اگر لندینگ نمی‌خواهی، می‌توانی ریشه را مستقیم به `vizitik-app` بچسبانی
(در آن صورت PWA روی ریشه بالا می‌آید).

### ۶-۲ مراحل (برای هر دامنه، سه قدم)

1. **افزودن در Render:** سرویس را انتخاب کن → **Settings** →
   **Custom Domains** → `+ Add Custom Domain` → دامنه را بنویس → Save.
   (پلن رایگان/Hobby دو دامنه شامل می‌شود؛ اضافه به ازای هردام ۰/۲۵ دلار.)
2. **DNS:** در پنل دامنهٔ خودت رکوردهای بخش ۶-۳ را بزن.
3. **Verify:** برگرد به Render → دکمهٔ **Verify** کنار دامنه. بعد از موفق
   شدن، Render خودکار گواهی TLS می‌سازد و HTTP را به HTTPS می‌اندازد.

### ۶-۳ رکوردهای DNS

**ساب‌دامنه‌ها** (`app.` / `admin.`) — همیشه CNAME:

| Type | Name | Value |
|---|---|---|
| `CNAME` | `app` | `vizitik-app.onrender.com` |
| `CNAME` | `admin` | `vizitik-admin.onrender.com` |
| `CNAME` | `www` (اختیاری) | `vizitik-landing.onrender.com` |

> مقدار CNAME دقیقاً همان آدرسِ `*.onrender.com` آن سرویس است (از صفحهٔ
> سرویس کپی کن).

**دامنهٔ ریشه** (`دامنه‌ی‌شما`) — CNAME در ریشه وجود ندارد؛ یکی از این دو:

- اگر DNS-providerت **ALIAS/ANAME** را می‌شناسد (Cloudflare، DNSimple،
  Name.com و...): یک رکورد `ALIAS` با همان مقدار `vizitik-landing.onrender.com`.
- وگرنه **رکورد A** با آدرس لودبالنسر Render:
  `216.24.57.1` (ریشه → `vizitik-landing.onrender.com`).

نکات:

- **Cloudflare:** حتماً از CNAME استفاده کن (نه A) و پراکسی (Orange Cloud)
  را هم می‌توانی روشن بگذاری.
- اگر رکورد **AAAA** (IPv6) برای همان زیردامنه داری، **حذفش کن** — Render
  IPv4 است.
- **دامنه‌های `.ir`:** از پنل IRNIC یا همان DNS-hosting که دامنه را با آن
  می‌زنی، رکوردهای A و CNAME را می‌زنی (فرمت بالا همان است). اگر DNS را
  جایی مثل اربان‌دی‌ان‌اس می‌زنی، مسیر DNS همین‌جا است.
- انتشار DNS معمولاً چند دقیقه تا حداکثر ۲۴ ساعت طول می‌کشد؛ با
  `dig app.دامنه‌ی‌شما` یا [dnschecker.org](https://dnschecker.org) چک کن.
  اگر چند مقدار مختلف دیدی، فورواردینگ/پارکینگ پیش‌فرض provider را خاموش کن.

### ۶-۴ بعد از Verify

- `https://app.دامنه‌ی‌شما/` باید PWA را نشان دهد؛ در گوشی، «Add to Home
  Screen» بزن — نصب PWA فقط با HTTPS معتبر می‌شود (Render خودکار دارد).
- `https://app.دامنه‌ی‌شما/api/bale/status` باید JSON بدهد (API هم‌ریشه است).
- **لندینگ:** قبل از دیپلویِ landing، `appUrl` در `landing/js/config.js`
  را روی `https://app.دامنه‌ی‌شما` بگذار (و `termsUrl`/`supportUrl` در صورت
  نیاز) تا دکمه‌های «شروع کار» درست لینک بزنند.
- (اختیاری) زیردامنه‌های `onrender.com` را خاموش کن تا دامنه فقط از
  دامنهٔ تو در دسترس باشد: Settings → Custom Domains → **Render Subdomain
  → Disabled** (در render.yaml: `renderSubdomainPolicy: disabled`).

---

## ۷) آپدیت بعد از تغییرات

روی Render خودکار است: هر `git push` به `main` یک build و deploy تازه
می‌سازد. اگر اسکیما (Prisma) را هم عوض کرده باشی، بعد از دیپلوی دوباره
`npx prisma db push` را از Shell بزن.

---

## ۸) پلن free یا starter؟

| | free | starter (۷ دلار/ماه) |
|---|---|---|
| خواب بعد از ۱۵ دقیقه بی‌ترافیک | ✅ (اولین درخواست ۳۰-۶۰ ثانیه) | ❌ همیشه روشن |
| RAM / CPU | 512MB / 0.1 | 512MB / 0.5 |
| ساعات ماهانه | ۷۵ ساعت مشترک بین همهٔ سرویس‌های free | نامحدود |
| دامنهٔ شخصی + SSL | ✅ | ✅ |

**توصیه:** برای تست با free شروع کن؛ برای استفادهٔ واقعی — به‌ویژه با
ربات بله — سرویس `vizitik-app` (و بهتر است admin هم) را `starter` بگذار.
Static Site (لندینگ) در هر دو حالت رایگان است.

### ۸-۱ نگه‌داشتن سرویس free بیدار (بدون پلن پولی)

اگر free نگه داشتی، اسکریپت `scripts/keep-alive.sh` هر ۱۰ دقیقه (کمتر از
حد ۱۵ دقیقه‌ای Render) به `/api/health` سرویس پینگ می‌زند تا خواب نرود.
روی هر ماشینی که همیشه روشن است اجرا کن — مثلاً VPS خودت:

```bash
# روش ۱ — ساده (nohup)
nohup bash scripts/keep-alive.sh > /var/log/vizitik-keep-alive.log 2>&1 &

# روش ۲ — systemd (توصیه‌شده؛ با ریستارت سرور هم زنده می‌ماند)
sudo cp scripts/keep-alive.service /etc/systemd/system/
# مسیر keep-alive.sh داخل فایل service را با مسیر واقعی‌ات تنظیم کن
sudo systemctl daemon-reload && sudo systemctl enable --now keep-alive
journalctl -u keep-alive -f   # دیدن پینگ‌ها

# روش ۳ — فقط یک خط crontab (بدون اسکریپت)
*/10 * * * * curl -s -m 90 -o /dev/null https://vizitik-app.onrender.com/api/health
```

نکات:
- اولین پینگ بعد از خواب ~۱ دقیقه طول می‌کشد (Render سرویس را بیدار می‌کند)؛ اسکریپت تا ۹۰ ثانیه صبر می‌کند و این طبیعی است.
- پینگ هر ۱۰ دقیقه به‌عنوان عادت، دیتابیس رایگان Supabase را هم از pause (۷ روز بی‌کارایی) در امان نگه می‌دارد.
- لندینگ (Static Site) روی CDN است و اصلاً نمی‌خوابد — نیازی به پینگ ندارد.

---

## ۹) عیب‌یابی

| نشانه | علت / راه‌حل |
|---|---|
| build روی Render شکست با خطای حافظه | پلن free فقط 512MB دارد؛ اگر build سنگین شد، `starter` بگیر یا build را به دو سرویس جدا بسپار |
| `P1001: Can't reach database server` | `DATABASE_URL` اشتباه/نارسیه، پورت ۳۳۶ بسته، یا `bind-address` MySQL روی `127.0.0.1` مانده |
| `prisma db push` در Shell خطا می‌دهد | اول `npx prisma generate` و بعد `npx prisma db push --skip-generate` |
| پنل ادمین: `@prisma/client did not initialize yet` | build command پنل ناقص است — بخش ۳-۲ (کپی `node_modules/.prisma` جا نیفتد) |
| صفحه می‌آید ولی `/api` خطای CORS/404 | مطمئن شو PWA از همان سرویسِ API لود شده (هم‌ریشه)؛ اگر PWA را Static Site جدا کردی، `VITE_API_URL` را هنگام build روی آدرس مطلق API بگذار و دوباره build کن |
| 502 بعد از Verify دامنه | چند دقیقه صبر کن (روترینگ Render هنوز به‌روز می‌شود) |
| دامنه Verify نمی‌شود | DNS هنوز منتشر نشده / AAAA مانده / FWD پیش‌فرض provider فعال است / مقدار CNAME دقیقاً `*.onrender.com` نباشد |
| PWA آپدیت نمی‌شود | کش مرورگر: devtools → Application → Service Workers → Unregister، یا کش را پاک کن (سرور `sw.js` را no-cache می‌فرستد؛ مشکل معمولاً سمت مرورگر است) |
| ربات بله پیام نمی‌فرستد | سرویس در پلن free خواب است (بخش ۸) یا متغیرهای BALE_* خالی‌اند |
| `JWT_SECRET is not set` | در Environment سرویس، `JWT_SECRET` با مقدار بلند تصادفی بگذار |

---

## ۱۰) خلاصهٔ متغیرهای محیطی

| متغیر | کجا | لازم؟ | توضیح |
|---|---|---|---|
| `DATABASE_URL` | app و admin | ✅ | `mysql://user:pass@host:3306/db` |
| `JWT_SECRET` | app | ✅ | Render خودکار می‌سازد (`generateValue`) |
| `JWT_EXPIRES_IN` | app | نه | پیش‌فرض `30d` |
| `NODE_ENV` | app و admin | نه | `production` |
| `HOST` | admin | نه | روی Render `0.0.0.0` (در blueprint هست) |
| `ADMIN_TOKEN` | admin | ✅ | Render خودکار می‌سازد |
| `BALE_BOT_USERNAME` / `BALE_BOT_TOKEN` / `BALE_ADMIN_CHAT_ID` | app | اختیاری | ربات بله |
| `PORT` / `BIND_HOST` | — | — | خود Render `PORT` را می‌گذارد؛ بک‌اند خودش `0.0.0.0` گوش می‌دهد |

> نام نرم‌افزار (ویزیتیک / Vizitik) **هاردکد** است و متغیر محیطی ندارد —
> `backend/src/app.config.ts` و `frontend-app/src/lib/brand.js`.

---

## ۱۱) هزینه

| قلم | هزینه |
|---|---|
| `vizitik-app` starter | ۷ دلار/ماه (free: ۰ — با خواب ۱۵ دقیقه‌ای) |
| `vizitik-admin` starter | ۷ دلار/ماه (free: ۰) |
| `vizitik-landing` static | ۰ |
| MySQL روی Render + دیسک ۱۰GB | حدود ۷-۲۰ دلار/ماه (اگر MySQL روی VPS داری: ۰) |
| دامنه‌های شخصی | ۲ تایشما رایگان، بعدی‌ها ۰/۲۵ دلار/هردام |

**حداقل عملی:** app(starter) + MySQL(روی VPS) ≈ ۷ دلار/ماه
**حداقل رایگان:** همه روی free (فقط برای تست؛ ربات بله در خواب قطع می‌شود)
