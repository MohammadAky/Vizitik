#!/usr/bin/env bash
# One launcher; a child failure or Ctrl+C shuts down ALL process groups.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ -f backend/.env && -d backend/node_modules && -d frontend-app/node_modules ]] || {
  echo 'Run bash scripts/setup-local.sh first' >&2; exit 1;
}
exec python3 scripts/dev-supervisor.py
