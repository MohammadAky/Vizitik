#!/usr/bin/env bash
# Local setup, repeatable without resetting data. Add --run to launch everything.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN=0
for arg in "$@"; do
  case "$arg" in
    --run) RUN=1 ;;
    --help|-h) echo 'Usage: bash scripts/setup-local.sh [--run]'; echo 'Requires Node 22+ and a running MySQL/MariaDB. Existing .env is never overwritten.'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done
cd "$ROOT"
for tool in node npm; do command -v "$tool" >/dev/null || { echo "Install $tool first" >&2; exit 1; }; done
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node 22+ required"); process.exit(1); }'
if [[ ! -f backend/.env ]]; then
  (umask 077; cp backend/.env.example backend/.env)
  node -e '
const fs = require("fs");
const crypto = require("crypto");
const hex = (n) => crypto.randomBytes(n).toString("hex");
let s = fs.readFileSync("backend/.env", "utf8");
s = s.replace("NODE_ENV=production", "NODE_ENV=development")
     .replace("BIND_HOST=\"127.0.0.1\"", "BIND_HOST=\"0.0.0.0\"")
     .replace("PASTE_A_LONG_RANDOM_SECRET", hex(32))
     .replace("ADMIN_TOKEN=\"\"", "ADMIN_TOKEN=\"" + hex(32) + "\"");
fs.writeFileSync("backend/.env", s);
'
  echo 'Created backend/.env with random login/admin secrets. Set DATABASE_URL to an existing local database, then rerun this command.'
  exit 1
fi
# Validate before installing or changing anything. Never silently use example credentials.
node -e '
const fs = require("fs");
const values = {};
for (const raw of fs.readFileSync("backend/.env", "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  let value = line.slice(i + 1).trim();
  const q = value.charAt(0);
  if ((q === "\"" || q === "\x27") && value.charAt(value.length - 1) === q) value = value.slice(1, -1);
  values[line.slice(0, i).trim()] = value;
}
const fail = (msg) => { console.error(msg); process.exit(1); };
let url;
try { url = new URL(values.DATABASE_URL || ""); } catch (e) { fail("DATABASE_URL must be a full mysql:// URL in backend/.env"); }
if (url.protocol !== "mysql:" || !url.hostname || !url.username || !url.pathname.replace(/^\//, "")) {
  fail("DATABASE_URL must be a full mysql:// URL in backend/.env");
}
for (const key of ["DATABASE_URL", "JWT_SECRET", "ADMIN_TOKEN"]) {
  const value = values[key] || "";
  if (!value || value.includes("CHANGE_ME") || value.includes("PASTE_A_")) fail("Configure " + key + " in backend/.env first");
}
'
for pkg in backend frontend-app; do
  (cd "$pkg"; npm ci --include=dev --no-audit --no-fund)
done
(cd backend; npx prisma generate; npm run build)
(cd backend; env -u DATABASE_URL npx prisma db push --skip-generate)
echo 'Setup complete. Start with: bash scripts/run-dev.sh (or setup-local.sh --run)'
if [[ "$RUN" == 1 ]]; then exec bash scripts/run-dev.sh; fi
