#!/usr/bin/env bash
# ============================================================================
# Vizitik — keep-alive pinger for Render free web services
# ============================================================================
# Render spins DOWN a free web service after 15 minutes without inbound
# traffic (cold start ~1 min on the next request). This script pings the
# services every INTERVAL seconds (default 600 = 10 min, < the 15-min limit)
# so they never sleep. Run it on any machine that is always on — e.g. your
# VPS.
#
# Usage:
#   nohup bash scripts/keep-alive.sh > /var/log/vizitik-keep-alive.log 2>&1 &
#
# Or with systemd (recommended):
#   sudo cp scripts/keep-alive.service /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now keep-alive
#   (edit the ExecStart path in the unit to your repo location first)
#
# Or a single crontab line (no loop script needed at all):
#   */10 * * * * curl -s -m 90 -o /dev/null https://vizitik-app.onrender.com/api/health
#
# The URL list can be overridden as arguments:
#   bash scripts/keep-alive.sh https://my-domain.com/api/health https://my-domain.com/
#
# Notes:
#  - Ping /api/health (tiny JSON, no auth, no DB) — the first ping after a
#    sleep waits up to ~90s while Render spins the service back up.
#  - The side effect is welcome: the app querying the database every 10 min
#    also keeps a free Supabase project from pausing (7-day inactivity).
#  - The static landing page never sleeps; no need to ping it.
# ============================================================================
set -u

INTERVAL="${KEEP_ALIVE_INTERVAL:-600}"
URLS=("$@")
if [ ${#URLS[@]} -eq 0 ]; then
  URLS=(
    "https://vizitik-app.onrender.com/api/health"
    "https://vizitik-admin.onrender.com/"
  )
fi

echo "keep-alive started: ${#URLS[@]} URL(s) every ${INTERVAL}s (pid $$)"
echo "targets:"
for url in "${URLS[@]}"; do echo "  - ${url}"; done

while true; do
  for url in "${URLS[@]}"; do
    code="$(curl -s -m 90 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo 'ERR')"
    echo "$(date '+%Y-%m-%d %H:%M:%S')  ${code}  ${url}"
  done
  sleep "$INTERVAL"
done
