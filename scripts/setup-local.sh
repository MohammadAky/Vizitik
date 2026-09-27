#!/usr/bin/env bash
# ============================================================================
#  Vizitik - one-time local development setup
# ============================================================================
#  1) backend/.env from backend/.env.example (an existing .env is never touched)
#  2) npm install for backend, admin and frontend-app
#  3) prisma generate + prisma db push (creates/updates the MySQL schema)
#
#  Requirements: Node 18+, npm, a running MySQL/MariaDB, and backend/.env
#  tuned to it (DATABASE_URL, JWT_SECRET, ADMIN_TOKEN).
#  Start everything afterwards with:  bash scripts/run-dev.sh
# ============================================================================
set -eu
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 1. environment file - create it once, never overwrite it
if [ -f backend/.env ]; then
  echo "backend/.env already exists - left untouched."
else
  cp backend/.env.example backend/.env
  echo "backend/.env created - set DATABASE_URL, JWT_SECRET and ADMIN_TOKEN in it."
fi

# 2. dependencies (package-lock.json is tracked, so installs are reproducible)
for pkg in backend admin frontend-app; do
  if [ -d "$pkg" ]; then
    echo "installing $pkg dependencies..."
    (cd "$pkg" && npm install --no-audit --no-fund)
  fi
done

# 3. Prisma client + schema
echo "generating the Prisma client and pushing the schema..."
(cd backend && npx prisma generate && npx prisma db push)

echo
echo "local setup completed."
echo "next:  bash scripts/run-dev.sh      (backend :3000, admin :3001, PWA :5173)"
