# مستندات جامع معماری، فنی و وضعیت پروژه حساب‌چین (HesabChin)
> **تاریخ نسخه:** ۱۴۰۵/۰۶/۰۸ (2026-08-31)  
> **موضوع:** راهنمای کامل معماری، مدل داده، بک‌اند، فرانت‌اند و وضعیت پروژه جهت انتقال به گفتگوی جدید

---

## ۱. معرفی و دامنه کاربرد پروژه (Overview & Scope)

پروژه **حساب‌چین** یک پلتفرم جامع پخش مویرگی (گرم و سرد) ویژه **شرکت‌ها و ویزیتورهای پخش بستنی و محصولات لبنی** است.  
ویزیتور با وانت یا نیسان یخچال‌دار در مسیرهای توزیع شهری تردد کرده، سفارشات سوپرمارکت‌ها را ثبت می‌کند، بار تحویل می‌دهد، مبالغ را به صورت ترکیبی (نقد، کارت، چک صیادی، نسیه) تسویه کرده و فاکتور چاپی یا دیجیتال صادر می‌نماید.

### مهم‌ترین چالش‌های این صنف که در سیستم حل شده‌اند:
1. **دوگانه بودن واحد شمارش:** بستنی‌ها هم به صورت **کارتن** و هم **عدد/تکی** تحویل و فاکتور می‌شوند.
2. **تخفیفات پلکانی متوالی (Compound Stepped Discounts):** تخفیفات معمولاً پشت‌سرهم (مانند ۵٪ نقدی، ۳٪ حجمی، ۱٪ وفاداری) از مانده هر مرحله کسر می‌شوند.
3. **پرداخت ترکیبی (Split Multi-Payment):** یک فاکتور می‌تواند هم‌زمان با بخشی نقد، بخشی پوز، یک فقره چک صیادی و مانده به صورت نسیه تسویه گردد.
4. **کارکرد بدون اینترنت (Offline-First):** ویزیتورها در نقاط کور و زیرزمین‌ها باید بتوانند فاکتور ثبت کرده و پس از اتصال به اینترنت همگام‌سازی نمایند.

---

## ۲. پشته فناوری (Technology Stack)

| بخش | تکنولوژی | توضیحات |
| :--- | :--- | :--- |
| **Backend Framework** | **NestJS (Node.js)** | ساختار ماژولار با TypeScript، استاندارد Enterprise، اعتبارسنجی DTO |
| **ORM & Database** | **Prisma ORM + PostgreSQL (Supabase)** | پایگاه داده رابطه‌ای امن با مهاجرت‌های خودکار |
| **Database Pooler** | **Supabase Transaction Pooler (AWS IPv4)** | ارتباط مطمئن از شبکه بدون اختلال در سرورهای IPv4 |
| **Mobile Frontend (UI)** | **HTML5 + Pure Semantic CSS (RTL)** | پالت رنگی Ice & Ocean، بهینه‌شده برای لمس در گوشی |
| **Mobile Production App** | **React Native + Expo + WatermelonDB/SQLite** | معماری کلاینت آفلاین با ذخیره‌سازی محلی |
| **Admin Panel** | **Refine.dev + React + Ant Design** | داشبورد تحت وب مدیریت برای مدیران پخش و حسابداری |

---

## ۳. معماری کلی و مدل داده (Data Model & Schema)

### مدل داده طراحی‌شده در Prisma (`prisma/schema.prisma`):

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// ۱. کاربران و ویزیتورها
enum UserRole {
  ADMIN
  VISITOR
  DRIVER
  ACCOUNTANT
}

model User {
  id           String      @id @default(uuid())
  firstName    String
  lastName     String
  phoneNumber  String      @unique
  passwordHash String
  role         UserRole    @default(VISITOR)
  isActive     Boolean     @default(true)
  vans         Van[]
  orders       Order[]
  payments     Payment[]
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
}

// ۲. مشتریان و سوپرمارکت‌ها
model Customer {
  id           String      @id @default(uuid())
  name         String      // نام مغازه / فروشگاه
  ownerName    String?     // نام صاحب مغازه
  phoneNumber  String      @unique
  address      String
  latitude     Float?
  longitude    Float?
  creditLimit  Decimal     @default(0) // سقف اعتبار نسیه
  currentDebt  Decimal     @default(0) // مانده بدهی فعلی
  orders       Order[]
  payments     Payment[]
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
}

// ۳. کاتالوگ بستنی‌ها و محصولات
model Product {
  id             String         @id @default(uuid())
  code           String         @unique // کد کالا
  name           String         // نام بستنی (مثال: مگنوم کلاسیک)
  category       String         // چوبی، قیفی، لیوانی، خانواده
  packSize       Int            @default(24) // تعداد در کارتن
  cartonPrice    Decimal        // قیمت هر کارتن (تومان)
  unitPrice      Decimal        // قیمت هر عدد تکی (تومان)
  stockUnit      Int            @default(0) // موجودی انبار مرکزی
  isActive       Boolean        @default(true)
  vanInventories VanInventory[]
  orderItems     OrderItem[]
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
}

// ۴. وانت و موجودی بار ماشین
model Van {
  id           String         @id @default(uuid())
  plateNumber  String         @unique
  driverName   String
  assignedToId String?
  assignedTo   User?          @relation(fields: [assignedToId], references: [id])
  inventories  VanInventory[]
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
}

model VanInventory {
  id          String   @id @default(uuid())
  vanId       String
  productId   String
  cartonQty   Int      @default(0) // تعداد کارتن بارگیری‌شده
  unitQty     Int      @default(0) // تعداد تکی بارگیری‌شده
  van         Van      @relation(fields: [vanId], references: [id])
  product     Product  @relation(fields: [productId], references: [id])
  updatedAt   DateTime @updatedAt

  @@unique([vanId, productId])
}

// ۵. سفارشات و اقلام فاکتور
enum OrderStatus {
  PENDING
  CONFIRMED
  DELIVERED
  CANCELLED
}

model Order {
  id             String       @id @default(uuid())
  orderNumber    Int          @default(autoincrement())
  customerId     String
  visitorId      String
  totalGross     Decimal      // جمع ناخالص بدون تخفیف
  totalDiscount  Decimal      @default(0) // مجموع تخفیفات پلکانی
  totalNet       Decimal      // مبلغ نهایی قابل پرداخت
  status         OrderStatus  @default(CONFIRMED)
  customer       Customer     @relation(fields: [customerId], references: [id])
  visitor        User         @relation(fields: [visitorId], references: [id])
  items          OrderItem[]
  payments       Payment[]
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
}

model OrderItem {
  id          String   @id @default(uuid())
  orderId     String
  productId   String
  cartonQty   Int      @default(0)
  unitQty     Int      @default(0)
  unitPrice   Decimal
  cartonPrice Decimal
  totalPrice  Decimal
  order       Order    @relation(fields: [orderId], references: [id])
  product     Product  @relation(fields: [productId], references: [id])
}

// ۶. تسویه و پرداخت چندحالته
enum PaymentMethod {
  CASH     // نقد
  CARD     // پوز بانکی
  CHECK    // چک صیادی
  CREDIT   // نسیه و دفتری
}

enum ChequeStatus {
  PENDING  // در جریان وصول
  PASSED   // پاس شده
  BOUNCED  // برگشتی
}

model Payment {
  id          String        @id @default(uuid())
  orderId     String?
  customerId  String
  visitorId   String
  amount      Decimal
  method      PaymentMethod
  order       Order?        @relation(fields: [orderId], references: [id])
  customer    Customer      @relation(fields: [customerId], references: [id])
  visitor     User          @relation(fields: [visitorId], references: [id])
  chequeInfo  ChequeInfo?
  createdAt   DateTime      @default(now())
}

model ChequeInfo {
  id            String       @id @default(uuid())
  paymentId     String       @unique
  sayadNumber   String       // کد ۱۶ رقمی صیادی
  bankName      String       // نام بانک
  dueDate       DateTime     // تاریخ سررسید
  status        ChequeStatus @default(PENDING)
  payment       Payment      @relation(fields: [paymentId], references: [id])
}
```

---

## ۴. ساختار پروژه و ماژول‌های پیاده‌سازی‌شده

### ۱) ساختار بک‌اند (`/home/user/backend/`)
```text
backend/
├── src/
│   ├── app.module.ts              # ماژول ریشه NestJS
│   ├── main.ts                    # نقطه ورود سرور با Swagger و CORS
│   ├── prisma/                    # ماژول اتصال Prisma به پایگاه داده
│   ├── auth/                      # ماژول احراز هویت، ثبت‌نام و توکن JWT
│   ├── products/                  # مدیریت کاتالوگ بستنی‌ها و موجودی
│   ├── customers/                 # مدیریت مشتریان، بدهی‌ها و پرونده
│   ├── van/                       # ثبت بارگیری صبحگاهی و کسر موجودی ماشین
│   ├── orders/                    # موتور صدور فاکتور و تخفیف پلکانی
│   ├── payments/                  # مدیریت پرداخت چندگانه، چک و وصولی
│   └── sync/                      # همگام‌سازی آفلاین/آنلاین داده‌ها
├── prisma/
│   └── schema.prisma              # فایل اصلی اسکیمای پایگاه داده
├── package.json
└── tsconfig.json
```
- **وضعیت بیلد بک‌اند:** بیلد با موفقیت کامل و بدون خطا کامپایل شد (`npx nest build`).
- **بسته فشرده کامل بک‌اند:** `HesabChin-Backend.zip` در ریشه قرار دارد.

---

### ۲) ساختار فرانت‌اند تمیز و تفکیک‌شده (`/home/user/frontend/`)
تمام استایل‌ها به صورت ۱۰۰٪ از فایل‌های HTML استخراج و درون یک فایل CSS ساختاریافته قرار گرفته‌اند:

```text
frontend/
├── style.css                      # استایل مشترک یکپارچه (Pure CSS, RTL, Theme Variables)
├── index.html                     # ۱. داشبورد اصلی و آمار توزیع
├── van.html                       # ۲. بارگیری صبحگاهی ماشین و ثبت موجودی
├── costumers.html                 # ۳. لیست مشتریان، تماس و وضعیت بدهی
├── chooseproductforcustumer.html  # ۴. انتخاب محصولات و تخفیف پلکانی متوالی
├── payment.html                   # ۵. تسویه چندحالته (نقد، پوز، چک، نسیه) و پیش‌فاکتور
└── checks.html                    # ۶. پیگیری چک‌های صیادی و وصول مطالبات
```
- **بسته فشرده کامل فرانت‌اند:** `HesabChin-Frontend.zip` در ریشه قرار دارد.

---

## ۵. منطق محاسبات تجاری کلیدی (Core Business Formulas)

### ۱) محاسبه تخفیف پلکانی متوالی (Compound Stepped Discount):
در این سیستم، تخفیفات به جای جمع جبری (مانند ۵+۳+۱ = ۹٪)، به صورت **مرحله‌ای از مانده** کسر می‌شوند:
$$\text{Gross} = \sum (\text{CartonQty} \times \text{CartonPrice}) + (\text{UnitQty} \times \text{UnitPrice})$$
$$\text{Step 1 (Cash 5\%)}: D_1 = \text{Gross} \times 0.05 \implies \text{Rem}_1 = \text{Gross} - D_1$$
$$\text{Step 2 (Volume 3\%)}: D_2 = \text{Rem}_1 \times 0.03 \implies \text{Rem}_2 = \text{Rem}_1 - D_2$$
$$\text{Step 3 (Loyalty 1\%)}: D_3 = \text{Rem}_2 \times 0.01 \implies \text{FinalNet} = \text{Rem}_2 - D_3$$
$$\text{Total Discount} = D_1 + D_2 + D_3$$

### ۲) کنترل بار وانت و تبدیل واحد:
$$\text{Total Units} = (\text{Cartons} \times \text{PackSize}) + \text{Units}$$
در هنگام صدور فاکتور، ابتدا از موجودی ماشین کسر شده و مانده در فاکتور نهایی و انبار ثبت می‌گردد.

---

## ۶. نقشه راه و اقدامات بعدی در چت جدید (Roadmap for Next Chat)

هنگام آغاز گفتگوی جدید، موارد زیر مستقیماً در اولویت پیاده‌سازی قرار دارند:

1. **پروژه React Native + Expo:**
   - تبدیل ۶ صفحه HTML/CSS فعلی به کامپوننت‌های نیتیو (`react-native` + `lucide-react-native`).
   - راه‌اندازی دیتابیس محلی **WatermelonDB** یا **Expo SQLite** برای ذخیره آفلاین مشتریان، بار وانت و فاکتورها.
   - پیاده‌سازی صف همگام‌سازی (Sync Queue) برای ارسال فاکتورهای ثبت‌شده در حالت آفلاین به سرور NestJS به محض اتصال به اینترنت.

2. **پنل مدیریت تحت وب (Refine.dev + Ant Design):**
   - ایجاد داشبورد ادمین شرکت پخش برای تعریف ویزیتورها، مسیرها، کاتالوگ بستنی‌ها، گزارشات سود/زیان و مدیریت وصول چک‌های صیادی.

3. **چاپ فاکتور و خروجی PDF:**
   - اتصال به چاپگرهای جیبی بلوتوثی ویزیتورها با پروتکل ESC/POS حرارتی (فیش‌پرینتر ۸۰ میلی‌متری).
   - تولید فایل PDF رسمی فاکتور جهت اشتراک‌گذاری در واتس‌اپ و ایتا.

---

## ۷. اطلاعات اتصال پایگاه داده (برای ارجاع در سرور جدید)

- **نوع دیتابیس:** PostgreSQL روی Supabase (Region: `eu-central-1`)
- **میزبان Pooler (پشتیبانی از IPv4):** `aws-0-eu-central-1.pooler.supabase.com:5432`
- **پورت دیتابیس:** `5432`
- **کاربر:** `postgres.gfszeojgcarobrzpdmni`
- **فرمت رشته اتصال در `.env`:**
```env
DATABASE_URL="postgresql://postgres.gfszeojgcarobrzpdmni:M%401383138300a@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.gfszeojgcarobrzpdmni:M%401383138300a@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
JWT_SECRET="HesabChinSuperSecretKey2026"
PORT=3000
```
