#!/usr/bin/env node
/**
 * create-visitor — یک کاربر ویزیتور بساز (یا رمزش را عوض کن) بدون گذر از کد بله.
 *
 * برای تست: با شماره و رمزی که می‌دهی می‌توانی مستقیم در اپ وارد شوی
 * (ورود با رمز عبور هیچ‌وقت کد نمی‌خواهد؛ کد فقط برای «ثبت‌نام» است).
 *
 * اجرا از ریشهٔ پروژه (همان‌جا که backend/.env هست):
 *
 *   node scripts/create-visitor.mjs --phone 09011818219 --password 123456
 *   node scripts/create-visitor.mjs --phone 09121234567 --password s3cret --name "علی" --last "محمدی"
 *   node scripts/create-visitor.mjs --list                  # کاربرهای موجود
 *
 * روی سرور:
 *   cd /opt/vizitik && node scripts/create-visitor.mjs --phone ... --password ...
 * (نیاز به backend/node_modules دارد؛ اگر نبود: cd backend && npm ci --omit=dev)
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(ROOT, 'backend');
const require = createRequire(import.meta.url);

function loadFromBackend(name) {
  const candidates = [path.join(BACKEND, 'node_modules'), path.join(ROOT, 'node_modules')];
  return require(require.resolve(name, { paths: candidates }));
}

// same rules as the app: ۰۹۱۲… / +۹۸۹۱۲… / ۹۸۹۱۲… / ۹۱۲… -> 09xxxxxxxxx
function normalizePhone(value) {
  let digits = String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^0-9]/g, '');
  if (digits.startsWith('0098')) digits = digits.slice(4);
  else if (digits.startsWith('98') && digits.length === 12) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('9')) digits = '0' + digits;
  return digits;
}

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

if (hasFlag('help') || hasFlag('h')) {
  console.log('usage: node scripts/create-visitor.mjs --phone 09xxxxxxxxx --password <pass> [--name علی] [--last محمدی]\n' +
              '       node scripts/create-visitor.mjs --list');
  process.exit(0);
}

if (!fs.existsSync(path.join(BACKEND, '.env'))) {
  console.error('backend/.env پیدا نشد. اول: bash scripts/setup-local.sh');
  process.exit(1);
}
// DATABASE_URL از backend/.env خوانده می‌شود (همان فایلی که بک‌اند می‌خواند)
loadFromBackend('dotenv').config({ path: path.join(BACKEND, '.env') });

const { PrismaClient } = loadFromBackend('@prisma/client');
const bcrypt = loadFromBackend('bcryptjs');
const prisma = new PrismaClient();

try {
  if (hasFlag('list')) {
    const users = await prisma.user.findMany({
      select: { phone: true, firstName: true, lastName: true, role: true, isActive: true, baleChatId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!users.length) console.log('هنوز کاربری ثبت نشده است.');
    for (const u of users) {
      console.log(
        `  ${u.phone}  ${u.firstName} ${u.lastName}  [${u.role}]` +
          `${u.isActive ? '' : ' (غیرفعال)'}${u.baleChatId ? `  بله: ${u.baleChatId}` : '  بله: وصل نیست'}`,
      );
    }
    process.exit(0);
  }

  const phone = normalizePhone(arg('phone'));
  const password = arg('password');
  const firstName = arg('name', 'کاربر');
  const lastName = arg('last', 'تست');

  if (!/^09\d{9}$/.test(phone)) {
    console.error(`شمارهٔ موبایل درست نیست: «${arg('phone') ?? ''}» (مثال: 09011818219)`);
    process.exit(2);
  }
  if (!password || password.length < 6) {
    console.error('رمز عبور لازم است و باید حداقل ۶ کاراکتر باشد (--password).');
    process.exit(2);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await prisma.user.findUnique({ where: { phone } });

  const user = await prisma.user.upsert({
    where: { phone },
    update: { passwordHash, isActive: true, ...(arg('name') ? { firstName } : {}), ...(arg('last') ? { lastName } : {}) },
    create: { phone, firstName, lastName, passwordHash, role: 'VISITOR', isActive: true },
    select: { id: true, phone: true, firstName: true, lastName: true, role: true },
  });

  console.log(`${existing ? 'به‌روزرسانی شد' : 'ساخته شد'}: ${user.firstName} ${user.lastName} — ${user.phone} [${user.role}]`);
  console.log(`ورود: شماره ${user.phone} + همان رمزی که دادی (بدون کد بله).`);
  console.log('اگر در اپ وارد شدی و بله وصل نیست: در ربات بله یک‌بار دکمهٔ «ارسال و تایید شماره موبایل» را بزن تا فاکتورها هم بیاید.');
} catch (err) {
  console.error('خطا:', err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
