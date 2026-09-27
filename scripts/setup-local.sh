#!/usr/bin/env bash
# Local setup, repeatable without resetting data. Add --run to launch everything.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN=0
for arg in "$@"; do
  case "$arg" in
    --run) RUN=1 ;;
    --help|-h) echo 'Usage: bash scripts/setup-local.sh [--run]'; echo 'Requires Node 22+, Python 3 and a running MySQL/MariaDB. Existing .env is never overwritten.'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done
cd "$ROOT"
for tool in node npm python3; do command -v "$tool" >/dev/null || { echo "Install $tool first" >&2; exit 1; }; done
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node 22+ required"); process.exit(1); }'
if [[ ! -f backend/.env ]]; then
  (umask 077; cp backend/.env.example backend/.env)
  python3 - <<'PY'
from pathlib import Path
import secrets
p = Path('backend/.env')
s = p.read_text().replace('NODE_ENV=production', 'NODE_ENV=development').replace('BIND_HOST="127.0.0.1"', 'BIND_HOST="0.0.0.0"')
s = s.replace('PASTE_A_LONG_RANDOM_SECRET', secrets.token_hex(32)).replace('ADMIN_TOKEN=""', f'ADMIN_TOKEN="{secrets.token_hex(32)}"')
p.write_text(s)
PY
  echo 'Created backend/.env with random login/admin secrets. Set DATABASE_URL to an existing local database, then rerun this command.'
  exit 1
fi
# Validate before installing or changing anything. Never silently use example credentials.
python3 - <<'PY'
import sys
from pathlib import Path
from urllib.parse import urlsplit

values = {}
for line in Path('backend/.env').read_text().splitlines():
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    values[key.strip()] = value.strip().strip('"').strip("'")

url = urlsplit(values.get('DATABASE_URL', ''))
if url.scheme != 'mysql' or not url.hostname or not url.username or not url.path.strip('/'):
    sys.exit('DATABASE_URL must be a full mysql:// URL in backend/.env')
for key in ('DATABASE_URL', 'JWT_SECRET', 'ADMIN_TOKEN'):
    value = values.get(key, '')
    if not value or 'CHANGE_ME' in value or 'PASTE_A_' in value:
        sys.exit(f'Configure {key} in backend/.env first')
PY
for pkg in backend frontend-app; do
  (cd "$pkg"; npm ci --include=dev --no-audit --no-fund)
done
(cd backend; npx prisma generate; npm run build)
(cd backend; env -u DATABASE_URL npx prisma db push --skip-generate)
echo 'Setup complete. Start with: bash scripts/run-dev.sh (or setup-local.sh --run)'
if [[ "$RUN" == 1 ]]; then exec bash scripts/run-dev.sh; fi
