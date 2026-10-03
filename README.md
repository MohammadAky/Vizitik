# ویزیتیک (Vizitik)

سامانه توزیع مویرگی و پخش گرم بستنی/مواد غذایی برای ویزیتورهای موبایلی: بارگیری ون،
ثبت سفارش با تفکیک **کارتن و دانه**، تخفیف پلکانی، تسویه چندحالته (نقد، پوز، چک، نسیه)،
دفتر حساب مشتری، چاپ فاکتور ۸۰ میلی‌متری و اعلان‌های ربات بله.

**پشته فناوری:** NestJS + Prisma + MySQL/MariaDB · PWA با React + Vite (آفلاین‌محور) ·
پنل ادمین Node/Prisma · Nginx + systemd روی Ubuntu/Debian

> **فهرست محصولات از سمت ما نیست:** خودِ ویزیتورها محصولاتشان را تعریف، قیمت‌گذاری و می‌فروشند؛
> این لیست را خودشان به‌روز می‌کنند و از طرف توسعه‌دهنده/مالک پروژه تأمین نمی‌شود.

---

## قابلیت‌های کلیدی

| بخش | توضیح کوتاه |
|---|---|
| بارگیری ون | کاتالوگ محصولات، بارگیری کارتن/دانه، بدون ثبت رکورد صفر |
| فروش گرم | فقط کالاهای موجود در ون؛ دانه همیشه کمتر از ظرفیت کارتن |
| تخفیف پلکانی | چند تخفیف درصدی/نقدی متوالی، با نمایش تفکیک هر پله و امکان حذف |
| تسویه فاکتور | نقد، کارتخوان، چک صیادی (شناسه ۱۶ رقمی + تاریخ شمسی) و نسیه دفتری |
| دفتر حساب | مانده مشتری پس از هر تسویه/ویرایش فاکتور خودکار به‌روز می‌شود |
| فاکتور | تاریخچه، ویرایش روش‌های پرداخت در روزهای بعد، چاپ حرارتی ۸۰mm |
| وصول مطالبات | مجموع طلب بازار و دریافت وجه با کسر آنی از مانده |
| پنل ادمین | کاتالوگ، قیمت اختصاصی هر ویزیتور، سفارش‌ها، مشتریان، کوئری SQL و خروجی CSV/JSON |
| ربات بله | ارسال فاکتور، اعلان راه‌اندازی سرور و کد OTP ثبت‌نام/بازیابی رمز |

**قواعد محاسباتی:** قیمت کارتن = قیمت دانه × تعداد در کارتن · هر پله‌ی تخفیف از مانده‌ی
پس از پله‌ی قبل کسر می‌شود (درصدی یا مبلغ ثابت) · نسیه = `max(0, مبلغ نهایی − (نقد + پوز + چک))`

---

## راه‌اندازی سریع

**لوکال** (پیش‌نیاز: Node 22+، Python 3، MySQL/MariaDB روشن)

```bash
bash scripts/setup-local.sh --run   # بار اول .env و کلیدهای تصادفی را می‌سازد، سپس متوقف می‌شود
                                    # DATABASE_URL را در backend/.env تنظیم کنید و دوباره اجرا کنید
bash scripts/run-dev.sh             # بک‌اند :3000 · ادمین :3001 · PWA :5173 (با پراکسی /api)
                                    # و یک ویزیتور آمادهٔ ارایه می‌سازد: 09011818219 / 123456 (--no-demo = بدون آن)
```

**سرور Ubuntu/Debian** (checkout جدا از نصب، مثلاً `~/Vizitik` و `/opt/vizitik`)

```bash
bash scripts/setup-server.sh --check      # پیش‌نمایش، بدون تغییر
sudo bash scripts/setup-server.sh         # نصب تعاملی: MariaDB، Node، Nginx، systemd، HTTPS/UFW
```

**آپدیت سرور**

```bash
bash scripts/update.sh --check            # پیش‌نمایش آفلاین
sudo bash scripts/update.sh               # pull + فقط درخت‌های تغییر‌یافته
```

هر درخت تغییریافته در یک پوشه‌ی موقت روی همان فایل‌سیستم بیلد می‌شود و فقط بعد از بیلد
موفق جایگزین نسخه‌ی زنده می‌شود؛ شکست فعال‌سازی، نسخه‌ی قبلی را برمی‌گرداند. `prisma db push`
تنها وقتی `schema.prisma` عوض شده باشد و **هرگز** با `--accept-data-loss` اجرا می‌شود.

---

## تست‌ها

```bash
(cd backend && npm ci --include=dev && npx prisma generate && npm run build)
python3 scripts/tests/setup-safety.py
python3 scripts/tests/update-regression.py
python3 scripts/tests/update-rollback.py
python3 scripts/tests/backend-typecheck.py
node admin/tests/regression.cjs
```

تست واقعی MariaDB (ورود HTTP، JWT، دقت اعشار، escape متن فارسی) جدا و دستی است و فقط روی
دیتابیس دوریختنی `vizitik_test` اجرا می‌شود — راهنمای اجرا: [docs/DEPLOY-UBUNTU.md](docs/DEPLOY-UBUNTU.md).

---

## ساختار مخزن

```text
backend/       NestJS + Prisma (auth/JWT/OTP، سفارش، مشتری، ون، گزارش، ربات بله)
frontend-app/  PWA آفلاین‌محور (React + Vite، IndexedDB، sync)
frontend/      رابط وب قدیمی PHP — از خود checkout سرو می‌شود و در نصب سرور کپی نمی‌شود
admin/         پنل ادمین Node + Prisma (SQL، کاتالوگ، قیمت اختصاصی، سفارش، مشتری)
landing/       صفحه‌ی معرفی استاتیک
scripts/       setup-local · run-dev (لینک همهٔ پنل‌ها) · setup-server · update · create-visitor + تست‌ها
docs/          استقرار، SSL کلودفلر، نقشه‌ی راه
documents/     دامپ SQL اولیه (hesabchin.sql)
```

---

## نکات مهم

- `documents/hesabchin.sql` شامل `DROP TABLE` است؛ آن را روی دیتابیس موجود اجرا نکنید. نصب و
  آپدیت آن را ایمپورت نمی‌کنند و هیچ فایل `.env` موجودی بازنویسی نمی‌شود.
- **بکاپ/بازیابی خودکار جزو پروژه نیست.** پیش از تغییرات حساس خودتان با `mariadb-dump` بکاپ
  بگیرید و کپی رمزگذاری‌شده را بیرون از سرور نگه دارید.
- رابط وب قدیمی PHP در `frontend/` می‌ماند و مستقل از نصب اجرا می‌شود:
  `cd frontend && php -S localhost:8000` (برای اجرا به PHP 8+ با اکستنشن‌های `curl` و `json` نیاز دارد).
- فونت وزیرمتن و آیکون‌ها self-host هستند؛ هیچ درخواستی به CDN زده نمی‌شود.
- هیچ وابستگی نِیتیو وجود ندارد (هش رمز با `bcryptjs`)؛ فقط موتورهای Prisma دانلود می‌شوند.
  اگر `binaries.prisma.sh` در دسترس نبود: `PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma npx prisma generate`
- هیچ حساب پیش‌فرض یا ورود خودکاری وجود ندارد؛ اولین کاربر را از مسیر «ثبت‌نام» بسازید.
- کد OTP فقط به گفتگوی بلهِ همان شماره می‌رود: در برنامه «دریافت کد» را بزنید، در بله `/start`
  و سپس «📱 ارسال و تایید شماره موبایل» را لمس کنید. کدها ۲ دقیقه زنده‌اند.

---

## مستندات

| سند | موضوع |
|---|---|
| [docs/DEPLOY-UBUNTU.md](docs/DEPLOY-UBUNTU.md) | نصب، آپدیت، بکاپ و بازیابی امن، تست‌ها |
| [docs/CLOUDFLARE-SSL.md](docs/CLOUDFLARE-SSL.md) | گواهی SSL با DNS-01 کلودفلر |
| [admin/README.md](admin/README.md) | پنل ادمین: endpoint ها، امنیت، خروجی‌گیری |
| [docs/MOBILE_PWA_ROADMAP.md](docs/MOBILE_PWA_ROADMAP.md) | نقشه‌ی راه اپ موبایل |
| [backend/.env.example](backend/.env.example) | توضیح تک‌تک متغیرهای محیطی |

## مجوز

[MIT](LICENSE) © ۲۰۲۶ [MohammadAky](https://github.com/MohammadAky) — استفاده، تغییر و توزیع
آزاد است، فقط نام صاحب اثر و متن مجوز باید باقی بماند. نرم‌افزار «همان‌طور که هست» ارائه
می‌شود و هیچ ضمانتی ندارد.
