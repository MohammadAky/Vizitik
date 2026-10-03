#!/usr/bin/env node
/**
 * create-visitor - create (or re-password) a visitor account without the Bale OTP step.
 *
 * Signing IN never asks for a code (the code is only for SIGNING UP), so an account
 * created here can be used immediately in the app.
 *
 * Run it from the project root (where backend/.env lives):
 *
 *   node scripts/create-visitor.mjs --phone 09011818219 --password 123456
 *   node scripts/create-visitor.mjs --phone 09121234567 --password s3cret --name "Ali" --last "Ahmadi"
 *   node scripts/create-visitor.mjs --list
 *
 * On the server:
 *   cd /opt/vizitik && node scripts/create-visitor.mjs --phone ... --password ...
 * (needs backend/node_modules; if missing: cd backend && npm ci --omit=dev)
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
  console.log('usage: node scripts/create-visitor.mjs --phone 09xxxxxxxxx --password <pass> [--name Ali] [--last Ahmadi]\n' +
              '       node scripts/create-visitor.mjs --list');
  process.exit(0);
}

if (!fs.existsSync(path.join(BACKEND, '.env'))) {
  console.error('backend/.env not found. Run bash scripts/setup-local.sh first.');
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
    if (!users.length) console.log('No users yet.');
    for (const u of users) {
      console.log(
        `  ${u.phone}  ${u.firstName} ${u.lastName}  [${u.role}]` +
          `${u.isActive ? '' : ' (inactive)'}${u.baleChatId ? `  bale: ${u.baleChatId}` : '  bale: not linked'}`,
      );
    }
    process.exit(0);
  }

  const phone = normalizePhone(arg('phone'));
  const password = arg('password');
  const firstName = arg('name', 'Visitor');
  const lastName = arg('last', 'Demo');

  if (!/^09\d{9}$/.test(phone)) {
    console.error(`Not a valid mobile number: "${arg('phone') ?? ''}" (example: 09011818219)`);
    process.exit(2);
  }
  if (!password || password.length < 6) {
    console.error('--password is required and must be at least 6 characters.');
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

  console.log(`${existing ? 'Updated' : 'Created'}: ${user.firstName} ${user.lastName} - ${user.phone} [${user.role}]`);
  console.log(`Sign in with ${user.phone} + that password (no Bale code needed).`);
  console.log('Bale is still not linked: tap "send and verify my mobile number" once in the bot to receive invoices.');
} catch (err) {
  console.error('error:', err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
