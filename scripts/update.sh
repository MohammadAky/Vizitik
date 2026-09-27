#!/usr/bin/env bash
# Safe in-place update: stage/build first, back up DB+env, apply only non-lossy
# Prisma changes, activate, health-check, then record revision. Never reset DB.
set -euo pipefail
ORIGINAL_ARGS=("$@")
SELF_HASH="$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${SRC_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
INSTALL_DIR="${INSTALL_DIR:-/opt/vizitik}"
CHECK=0; PULL=1; FORCE=0; RESTART=0; YES=0
BACKEND=1; FRONTEND=1; PARTIAL=0
fail() { echo "ERROR: $*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --check|--dry-run) CHECK=1 ;;
    --no-pull) PULL=0 ;;
    --force|-f) FORCE=1 ;;
    --yes|-y) YES=1 ;;
    --backend-only) FRONTEND=0; PARTIAL=1 ;;
    --frontend-only) BACKEND=0; PARTIAL=1 ;;
    --restart-only) RESTART=1; PULL=0 ;;
    --help|-h)
      echo 'Usage: sudo bash scripts/update.sh [--check] [--no-pull] [--force] [--yes] [--backend-only|--frontend-only|--restart-only]'
      echo 'INSTALL_DIR=/opt/vizitik SRC_DIR=checkout BACKUP_DIR=/var/backups/vizitik'
      echo '--check is offline/read-only. Partial updates do not advance the global revision.'
      exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
  shift
done
[[ -d "$SRC_DIR/.git" ]] || fail "source is not a git checkout"
[[ "$INSTALL_DIR" == /* && "$INSTALL_DIR" != / ]] || fail "unsafe INSTALL_DIR"
if [[ "$CHECK" == 0 ]]; then
  [[ $(id -u) == 0 ]] || fail 'run with sudo'
  [[ -f "$INSTALL_DIR/backend/.env" ]] || fail 'no installed backend/.env; use setup-server.sh first'
  [[ ! -d "$INSTALL_DIR/.git" ]] || fail 'legacy checkout-in-place detected: preserve .env and migrate to a separate INSTALL_DIR first'
  exec 9>/run/lock/vizitik-deploy.lock
  flock -n 9 || fail 'another install/update is running'
  if [[ "$YES" == 0 ]]; then
    read -r -p "Update $INSTALL_DIR (DB backup required)? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || exit 1
  fi
  if [[ "$PULL" == 1 ]]; then
    [[ -z "$(git -C "$SRC_DIR" status --porcelain)" ]] || fail 'source has local changes; use --no-pull to deploy them explicitly'
    git -C "$SRC_DIR" pull --ff-only
    if [[ "$(sha256sum "$SCRIPT_DIR/update.sh" | cut -d' ' -f1)" != "$SELF_HASH" ]]; then
      flock -u 9
      exec 9>&-
      exec bash "$SCRIPT_DIR/update.sh" "${ORIGINAL_ARGS[@]}" --no-pull --yes
    fi
  fi
fi
NEW_REV="$(git -C "$SRC_DIR" rev-parse HEAD)"
DEPLOYED_REV="$(cat "$INSTALL_DIR/.vizitik-revision" 2>/dev/null || true)"
if [[ "$FORCE" == 1 || -z "$DEPLOYED_REV" ]] || ! git -C "$SRC_DIR" cat-file -e "$DEPLOYED_REV^{commit}" 2>/dev/null; then
  files=$'backend/\nfrontend-app/\nadmin/\nlanding/\nscripts/'
else
  # Include uncommitted tracked changes and untracked files when --no-pull.
  files="$(git -C "$SRC_DIR" diff --name-only "$DEPLOYED_REV"; git -C "$SRC_DIR" ls-files --others --exclude-standard)"
fi
parts=(); trees=()
if [[ "$BACKEND" == 1 ]] && grep -q '^backend/' <<< "$files"; then parts+=(backend); trees+=(backend); fi
if [[ "$FRONTEND" == 1 ]] && grep -q '^frontend-app/' <<< "$files"; then parts+=(frontend); trees+=(frontend-app); fi
if [[ "$PARTIAL" == 0 ]]; then
  for tree in admin landing scripts; do
    if grep -q "^$tree/" <<< "$files"; then parts+=("$tree"); trees+=("$tree"); fi
  done
fi
CHANGED="${parts[*]}"
echo "changed: ${CHANGED:-none}"
if [[ "$CHECK" == 1 ]]; then
  echo 'check mode: offline preview of the current checkout; no fetch, copy, database or service changes'
  [[ "$RESTART" == 0 ]] || echo 'would restart services and require /api/health HTTP 200'
  for tree in "${trees[@]}"; do
    echo "would stage $tree"
    [[ "$tree" != backend && "$tree" != frontend-app ]] || echo "would npm ci --include=dev and build $tree in staging"
  done
  [[ -n "$CHANGED" ]] && echo 'would back up DB + .env before activation; abort on any backup/schema/build/health error'
  [[ -n "$CHANGED" || "$RESTART" == 1 ]] || echo 'nothing changed'
  exit 0
fi
# Read only non-secret deployment values. Never source/eval a dotenv file.
read_setting() {
  python3 - "$SCRIPT_DIR" "$INSTALL_DIR/backend/.env" "$1" <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
from importlib.machinery import SourceFileLoader
module = SourceFileLoader('backup', sys.argv[1] + '/database-backup.py').load_module()
print(module.read_env(sys.argv[2]).get(sys.argv[3], ''))
PY
}
BACKEND_PORT="${BACKEND_PORT:-$(read_setting PORT)}"; BACKEND_PORT="${BACKEND_PORT:-3000}"
ADMIN_PORT="${ADMIN_PORT:-$(read_setting ADMIN_PORT)}"; ADMIN_PORT="${ADMIN_PORT:-3001}"
BACKUP_DIR="${BACKUP_DIR:-$(read_setting BACKUP_DIR)}"; BACKUP_DIR="${BACKUP_DIR:-/var/backups/vizitik}"
health() {
  local i
  for i in {1..30}; do
    if curl --fail --silent --max-time 3 "http://127.0.0.1:$BACKEND_PORT/api/health" | grep -q '"db":"ok"'; then return 0; fi
    sleep 1
  done
  return 1
}
health_admin() {
  systemctl cat vizitik-admin.service >/dev/null 2>&1 || return 0
  local i
  for i in {1..15}; do
    if curl --fail --silent --max-time 3 "http://127.0.0.1:$ADMIN_PORT/api/health" | grep -q '"ok":true'; then return 0; fi
    sleep 1
  done
  return 1
}
restart_services() {
  systemctl restart vizitik-backend
  if systemctl cat vizitik-admin.service >/dev/null 2>&1; then systemctl restart vizitik-admin; fi
}
if [[ "$RESTART" == 1 ]]; then restart_services; health || fail 'API/database health check failed'; health_admin || fail 'admin health check failed'; exit 0; fi
[[ -n "$CHANGED" ]] || { echo 'nothing changed'; health || fail 'API/database is unhealthy'; exit 0; }
command -v rsync >/dev/null || fail 'install rsync first'
# Keep staging on the same filesystem so renames are atomic per tree.
STAGE="$(mktemp -d "$INSTALL_DIR/.update.XXXXXXXX")"
activated=(); SUCCESS=0; SERVICES_STOPPED=0; NGINX_CHANGED=0; CRON_CHANGED=0
cleanup() {
  local rc=$? tree
  trap - EXIT INT TERM
  if [[ "$SUCCESS" == 0 && "$CRON_CHANGED" == 1 ]]; then
    cp -p "$STAGE/cron.previous" /etc/cron.d/vizitik-backup
    if [[ -f "$STAGE/backup-wrapper.previous" ]]; then
      cp -p "$STAGE/backup-wrapper.previous" /usr/local/sbin/vizitik-backup
    else
      rm -f /usr/local/sbin/vizitik-backup
    fi
  fi
  if [[ "$SUCCESS" == 0 && "$NGINX_CHANGED" == 1 ]]; then
    cp -p "$STAGE/nginx.previous" /etc/nginx/sites-available/vizitik
    nginx -t && systemctl reload nginx || true
  fi
  if [[ "$SUCCESS" == 0 && ${#activated[@]} -gt 0 ]]; then
    echo 'Activation failed: restoring previous application files (database is NOT reset)' >&2
    systemctl stop vizitik-backend vizitik-admin 2>/dev/null || true
    for ((i=${#activated[@]}-1; i>=0; i--)); do
      tree="${activated[i]}"
      rm -rf "${INSTALL_DIR:?}/$tree"
      [[ ! -d "$STAGE/previous/$tree" ]] || mv "$STAGE/previous/$tree" "$INSTALL_DIR/$tree"
    done
    if [[ -d "$INSTALL_DIR/admin" ]]; then
      mkdir -p "$INSTALL_DIR/backend/admin"
      cp "$INSTALL_DIR/admin/"*.js "$INSTALL_DIR/backend/admin/" || true
    fi
    restart_services || true
    echo "Inspect logs and the pre-update backup in $BACKUP_DIR. Schema changes are not automatically reversed." >&2
  fi
  if [[ "$SUCCESS" == 0 && "$SERVICES_STOPPED" == 1 && ${#activated[@]} == 0 ]]; then restart_services || true; fi
  rm -rf "$STAGE"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$STAGE/previous"
for tree in "${trees[@]}"; do
  mkdir "$STAGE/$tree"
  rsync -a --exclude=node_modules --exclude=dist --exclude='.env' --exclude='.env.*' --exclude='*.tgz' "$SRC_DIR/$tree/" "$STAGE/$tree/"
  # Preserve all deployment-specific dotenv variants; never copy checkout secrets.
  if [[ -d "$INSTALL_DIR/$tree" ]]; then
    while IFS= read -r -d '' config; do cp -p "$config" "$STAGE/$tree/"; done < <(find "$INSTALL_DIR/$tree" -maxdepth 1 -name '.env*' -type f -print0)
  fi
  if [[ "$tree" == backend || "$tree" == frontend-app ]]; then
    (cd "$STAGE/$tree"; npm ci --include=dev --no-audit --no-fund
      if [[ "$tree" == backend ]]; then npx prisma generate; fi
      npm run build)
  fi
done
python3 "$SCRIPT_DIR/database-backup.py" --env "$INSTALL_DIR/backend/.env" --output "$BACKUP_DIR" --reason pre-update
if [[ -d "$STAGE/backend" ]]; then
  # No --accept-data-loss / --force-reset, and any error aborts the update.
  (cd "$STAGE/backend"; env -u DATABASE_URL npx prisma db push --skip-generate)
fi
# Stop writers only for the short activation window. Backups use consistent snapshots.
SERVICES_STOPPED=1
systemctl stop vizitik-backend
if systemctl cat vizitik-admin.service >/dev/null 2>&1; then systemctl stop vizitik-admin; fi
for tree in "${trees[@]}"; do
  [[ ! -d "$INSTALL_DIR/$tree" ]] || mv "$INSTALL_DIR/$tree" "$STAGE/previous/$tree"
  activated+=("$tree")
  mv "$STAGE/$tree" "$INSTALL_DIR/$tree"
done
if [[ -d "$INSTALL_DIR/admin" ]]; then
  mkdir -p "$INSTALL_DIR/backend/admin"
  cp "$INSTALL_DIR/admin/"*.js "$INSTALL_DIR/backend/admin/"
fi
restart_services
health || fail 'API/database health check failed after activation'
health_admin || fail 'admin service health check failed'
# Upgrade legacy backup cron and the upload limit without rewriting TLS config.
if [[ "$PARTIAL" == 0 && -f /etc/nginx/sites-available/vizitik ]] && systemctl cat vizitik-admin.service >/dev/null 2>&1; then
  cp -p /etc/nginx/sites-available/vizitik "$STAGE/nginx.previous"
  NGINX_CHANGED=1
  python3 "$SCRIPT_DIR/configure-backup-proxy.py" /etc/nginx/sites-available/vizitik "$ADMIN_PORT"
  nginx -t
  systemctl reload nginx
fi
if [[ "$PARTIAL" == 0 && -f /etc/cron.d/vizitik-backup ]]; then
  cp -p /etc/cron.d/vizitik-backup "$STAGE/cron.previous"
  [[ ! -f /usr/local/sbin/vizitik-backup ]] || cp -p /usr/local/sbin/vizitik-backup "$STAGE/backup-wrapper.previous"
  CRON_CHANGED=1
  bash "$SCRIPT_DIR/install-backup-cron.sh" "$INSTALL_DIR" "$BACKUP_DIR"
fi
# Only record clean, full deployments; otherwise a later update must reconsider files.
if [[ "$PARTIAL" == 0 && -z "$(git -C "$SRC_DIR" status --porcelain)" ]]; then
  printf '%s\n' "$NEW_REV" > "$INSTALL_DIR/.vizitik-revision.new"
  mv "$INSTALL_DIR/.vizitik-revision.new" "$INSTALL_DIR/.vizitik-revision"
fi
SUCCESS=1
echo 'Update successful; database health verified. Pre-update backup retained.'
