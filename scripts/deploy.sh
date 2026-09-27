#!/usr/bin/env bash
# Compatibility entrypoint: destructive cleanup/reset modes have been retired.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for arg in "$@"; do
  case "$arg" in
    --full-reset|--only-clean) echo 'Reset/cleanup is disabled to protect data and .env. Use setup-server.sh (install) or update.sh (update).' >&2; exit 2 ;;
  esac
done
exec bash "$ROOT/scripts/setup-server.sh" "$@"
