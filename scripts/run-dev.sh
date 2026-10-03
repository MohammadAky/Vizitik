#!/usr/bin/env bash
# ============================================================================
#  Vizitik - local development launcher
# ============================================================================
#  Starts every dev process in parallel:
#    backend      -> http://localhost:3000   (NestJS:  npm run start:dev)
#    admin panel  -> http://localhost:3001   (Node:    node server.js)
#    PWA (Vite)   -> http://localhost:5173   (frontend-app: npm run dev)
#    legacy PHP   -> http://localhost:8000   (frontend/: php -S, if php exists)
#
#  When all of them answer, it prints the URL block last - the backend runs with
#  --preserveWatchOutput, so a rebuild never wipes the screen and the block stays
#  where you can read it.
#
#  Options:
#    --no-php     do not start the legacy PHP site, even if php is installed
#    --help
#
#  One-time setup first:  bash scripts/setup-local.sh
#  Stop everything with Ctrl+C (a failure in any child stops all of them).
# ============================================================================
set -uo pipefail
set -m  # each background job gets its own process group, so it can be killed as a tree
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ -f backend/.env && -d backend/node_modules && -d frontend-app/node_modules ]] || {
  echo 'Run bash scripts/setup-local.sh first' >&2; exit 1;
}

NO_PHP=0
for arg in "$@"; do
  case "$arg" in
    --no-php) NO_PHP=1 ;;
    --help|-h) sed -n '2,19p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

read_setting() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" backend/.env | tail -n 1 | tr -d '"'\'' ' ; }
PORT="$(read_setting PORT)"; PORT="${PORT:-3000}"
ADMIN_PORT="$(read_setting ADMIN_PORT)"; ADMIN_PORT="${ADMIN_PORT:-3001}"

export NODE_ENV=development
export HOST=0.0.0.0 BIND_HOST=0.0.0.0
# Vite proxies /api to the backend so the PWA talks to a same-origin API in dev.
export DEV_API_TARGET="http://127.0.0.1:$PORT"

pids=()
cleanup() {
  echo
  echo 'stopping dev servers...'
  for pid in "${pids[@]:-}"; do
    [[ -n "${pid:-}" ]] || continue
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

# legacy PHP site (frontend/): optional, only when php is on PATH
PHP_PORT="$(read_setting PHP_PORT)"; PHP_PORT="${PHP_PORT:-8000}"
HAVE_PHP=0
if [[ "$NO_PHP" != "1" ]] && command -v php >/dev/null 2>&1; then
  (cd frontend && exec php -S 0.0.0.0:"$PHP_PORT") & pids+=("$!")
  HAVE_PHP=1
fi

# tsc watch clears the whole terminal on every rebuild; --preserveWatchOutput prints
# the new output below the old one instead, so nothing on screen is wiped. Detected
# rather than assumed, because an older @nestjs/cli has no such flag.
if (cd backend && npx --no-install nest start --help 2>/dev/null | grep -q -- '--preserveWatchOutput'); then
  (cd backend && exec npm run start:dev -- --preserveWatchOutput) & pids+=("$!")
else
  (cd backend && exec npm run start:dev) & pids+=("$!")
fi
(cd admin && exec node server.js) & pids+=("$!")
(cd frontend-app && exec npm run dev -- --host 0.0.0.0) & pids+=("$!")

# آدرس شبکهٔ محلی، برای تست از موبایل (اپ ویزیتور روی گوشی)
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

# Wait until every service answers (or give up quietly), so the block below is the
# last thing printed - the services keep logging underneath it, never over it.
wait_for() { # url, seconds
  command -v curl >/dev/null 2>&1 || { sleep 6; return 0; }
  for _ in $(seq 1 "$2"); do
    curl -sf -m 1 -o /dev/null "$1" && return 0
    curl -s -m 1 -o /dev/null "$1" && return 0   # any answer, even 404, means it is up
    sleep 1
  done
  return 0
}
wait_for "http://127.0.0.1:$PORT/api/health" 45
wait_for "http://127.0.0.1:$ADMIN_PORT/" 30
wait_for "http://127.0.0.1:5173/" 30
[[ "$HAVE_PHP" == 1 ]] && wait_for "http://127.0.0.1:$PHP_PORT/" 15

# LAN address, for opening the app on a phone in the same network.
# Linux: hostname -I · Windows (Git Bash): ask PowerShell · otherwise: a hint.
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -z "$LAN_IP" ]] && command -v powershell.exe >/dev/null 2>&1; then
  LAN_IP="$(powershell.exe -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress" 2>/dev/null | tr -d '\r' | tr -d ' ')"
fi

PHP_LINE="  Legacy site (PHP)   -                  (php not on PATH: sudo apt install php-cli)"
[[ "$HAVE_PHP" == 1 ]] && PHP_LINE="  Legacy site (PHP)   http://localhost:$PHP_PORT"

if [[ -n "$LAN_IP" ]]; then
  PHONE_BLOCK="
  From a phone on the same Wi-Fi:
    Visitor app       http://$LAN_IP:5173
    Admin panel       http://$LAN_IP:$ADMIN_PORT"
  [[ "$HAVE_PHP" == 1 ]] && PHONE_BLOCK="$PHONE_BLOCK
    Legacy site       http://$LAN_IP:$PHP_PORT"
else
  PHONE_BLOCK="
  Phone access: find this machine's IPv4 address (ipconfig) and open http://<that-ip>:5173"
fi

cat <<EOF

======================================================================
  Vizitik is up
======================================================================
  API (backend)       http://localhost:$PORT             (check: /api/health)
  Admin panel (SQL)   http://localhost:$ADMIN_PORT
  Visitor app (PWA)   http://localhost:5173             (/api -> :$PORT)
$PHP_LINE

  Admin token         : grep '^ADMIN_TOKEN' backend/.env
  Visitor account     : node scripts/create-visitor.mjs --phone 09... --password ...
$PHONE_BLOCK
  Stop everything     : Ctrl+C
======================================================================
EOF
wait
