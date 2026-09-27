#!/usr/bin/env bash
# ============================================================================
#  Vizitik - local development launcher
# ============================================================================
#  Starts the three dev processes in parallel:
#    backend      -> http://localhost:3000   (NestJS:  npm run start:dev)
#    admin panel  -> http://localhost:3001   (Node:    node server.js)
#    PWA (Vite)   -> http://localhost:5173   (frontend-app: npm run dev)
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

(cd backend && exec npm run start:dev) & pids+=("$!")
(cd admin && exec node server.js) & pids+=("$!")
(cd frontend-app && exec npm run dev -- --host 0.0.0.0) & pids+=("$!")

echo "backend      : http://localhost:$PORT"
echo "admin panel  : http://localhost:$ADMIN_PORT"
echo "PWA (vite)   : http://localhost:5173  (/api proxied to $PORT)"
echo 'Ctrl+C stops all three.'
wait
