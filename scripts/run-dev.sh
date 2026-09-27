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
#  Stop everything with Ctrl+C.
# ============================================================================
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pids=()
cleanup() {
  echo
  echo "stopping dev servers..."
  for pid in "${pids[@]:-}"; do
    if [ -n "${pid:-}" ]; then kill "$pid" 2>/dev/null || true; fi
  done
}
trap cleanup EXIT INT TERM

(cd backend && npm run start:dev) & pids+=("$!")
(cd admin && node server.js) & pids+=("$!")
(cd frontend-app && npm run dev) & pids+=("$!")

echo "backend      : http://localhost:3000"
echo "admin panel  : http://localhost:3001"
echo "PWA (vite)   : http://localhost:5173"
echo "Ctrl+C stops all three."
wait
