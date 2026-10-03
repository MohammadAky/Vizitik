#!/usr/bin/env bash
# ============================================================================
#  Vizitik - local development launcher
# ============================================================================
#  Starts the three dev processes in parallel:
#    backend      -> http://localhost:3000   (NestJS:  npm run start:dev)
#    admin panel  -> http://localhost:3001   (Node:    node server.js)
#    PWA (Vite)   -> http://localhost:5173   (frontend-app: npm run dev)
#    legacy PHP   -> http://localhost:8000   (frontend/: php -S, if php exists)
#
#  At the end it prints every panel URL, the admin token hint and the LAN address
#  (so the visitor app can be opened on a phone in the same network).
#
#  It also creates/refreshes a ready visitor account, so the app can be opened for a
#  demo without going through the Bale OTP step:
#      phone: 09011818219   password: 123456
#  change them with DEMO_PHONE / DEMO_PASSWORD, or skip it with --no-demo (DEMO_USER=0).
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

NO_DEMO=0
for arg in "$@"; do
  case "$arg" in
    --no-demo) NO_DEMO=1 ;;
    --help|-h) sed -n '2,20p' "$0" | sed 's/^# \?//'; exit 0 ;;
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
if command -v php >/dev/null 2>&1; then
  (cd frontend && exec php -S 0.0.0.0:"$PHP_PORT") & pids+=("$!")
  HAVE_PHP=1
fi

(cd backend && exec npm run start:dev) & pids+=("$!")
(cd admin && exec node server.js) & pids+=("$!")
(cd frontend-app && exec npm run dev -- --host 0.0.0.0) & pids+=("$!")

# آدرس شبکهٔ محلی، برای تست از موبایل (اپ ویزیتور روی گوشی)
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

# ---- کاربر آمادهٔ ارایه -------------------------------------------------------
# ورود با رمز هیچ‌وقت کد بله نمی‌خواهد؛ پس برای ارایه/دمو فقط یک کاربر لازم است.
# امنیت: این رمز پیش‌فرض فقط برای لوکال است، روی سرور واقعی از --no-demo استفاده کن.
DEMO_PHONE="${DEMO_PHONE:-09011818219}"
DEMO_PASSWORD="${DEMO_PASSWORD:-123456}"
DEMO_LINE=""
if [[ "${DEMO_USER:-1}" != "0" && "$NO_DEMO" != "1" ]]; then
  demo_out=""
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if demo_out="$(node scripts/create-visitor.mjs --phone "$DEMO_PHONE" --password "$DEMO_PASSWORD" 2>&1)"; then
      DEMO_LINE="  ورود آمادهٔ ارایه   : $DEMO_PHONE  /  رمز $DEMO_PASSWORD   (بدون کد بله)"
      break
    fi
    sleep 1
  done
  if [[ -z "$DEMO_LINE" ]]; then
    DEMO_LINE="  کاربر نمونه ساخته نشد — دستی: node scripts/create-visitor.mjs --phone $DEMO_PHONE --password $DEMO_PASSWORD"
    echo "$demo_out" | tail -3 >&2
  fi
fi

cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ویزیتیک بالا آمد — همهٔ آدرس‌ها
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  API (بک‌اند)        http://localhost:$PORT         (تست: /api/health)
  پنل ادمین (SQL)     http://localhost:$ADMIN_PORT
  اپ ویزیتور (PWA)    http://localhost:5173         (/api → :$PORT)
$( [ "$HAVE_PHP" = 1 ] && echo "  سایت قدیمی (PHP)    http://localhost:$PHP_PORT" || echo "  سایت قدیمی (PHP)    —            (php نصب نیست: sudo apt install php-cli)" )

  توکن پنل ادمین    : grep '^ADMIN_TOKEN' backend/.env
${DEMO_LINE:+$DEMO_LINE
}
$([ -n "$LAN_IP" ] && cat <<LAN

  از موبایل در همین شبکه (وای‌فای):
    اپ ویزیتور        http://$LAN_IP:5173
    پنل ادمین         http://$LAN_IP:$ADMIN_PORT
$( [ "$HAVE_PHP" = 1 ] && echo "    سایت قدیمی       http://$LAN_IP:$PHP_PORT" )
LAN
)
  توقف همه          : Ctrl+C
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
wait
