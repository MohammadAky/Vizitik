#!/usr/bin/env node
/**
 * env-sync - distribute the single root .env to the apps.
 *
 *   backend/.env       full copy       (NestJS API, Prisma CLI, admin panel)
 *   frontend-app/.env  only VITE_*     (what the PWA build may inline)
 *
 * The root .env is the single source of truth - never edit the generated
 * copies by hand. Run after every change:
 *
 *   node scripts/env-sync.mjs
 *
 * Without a root .env nothing is touched: an older install that only has
 * backend/.env keeps working. The script prints how to create the root file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, '.env');

if (!fs.existsSync(SOURCE)) {
  console.error(`no ${path.relative(ROOT, SOURCE)} - create it first:`);
  console.error('  cp .env.example .env    then fill in the values, then re-run this script');
  process.exit(1);
}

const lines = fs.readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n').split('\n');
const join = (arr) => (arr.length ? arr.join('\n') + '\n' : '');

// backend/.env - verbatim. Extra keys are simply ignored by the apps, so one
// full copy serves the API, the Prisma CLI and the admin panel at once.
fs.writeFileSync(path.join(ROOT, 'backend', '.env'), join(lines));

// frontend-app/.env - only VITE_* lines. Vite inlines exactly these into the
// build; the database password and the tokens never reach the bundle.
fs.writeFileSync(
  path.join(ROOT, 'frontend-app', '.env'),
  join(lines.filter((l) => /^VITE_/.test(l.trim())))
);

console.log('env files refreshed from .env:');
console.log('  backend/.env        full copy (API + Prisma + admin panel)');
console.log('  frontend-app/.env   VITE_* only (PWA build)');
