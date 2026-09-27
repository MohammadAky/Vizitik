#!/usr/bin/env bash
#
# Vizitik - update an existing install.
#
# Two server layouts are supported (both exist in the wild):
#
#   * separate : the git checkout ($SRC_DIR, default: the repo this script lives
#                in) is NOT the install dir. The deployable trees are re-synced
#                into $INSTALL_DIR (default: /opt/vizitik).
#   * in-place : $INSTALL_DIR itself is the git checkout (the classic layout).
#                The pull happens there and the trees are rebuilt from it.
#
# Safety rules:
#   * a changed tree is copied into a staging dir on the same filesystem, the
#     dependencies/artifacts are built THERE, and only after a successful build
#     is the live tree swapped in with an atomic rename;
#   * any failure before the swap leaves the running install untouched;
#   * a failure after the swap restores the previous trees and restarts the
#     services;
#   * the database is never reset - `prisma db push` runs only when
#     backend/prisma/schema.prisma actually changed and never with
#     --accept-data-loss/--force-reset;
#   * backend/.env (and every .env* sibling) is copied from the live install,
#     never from the checkout.
#
# Usage:
#   sudo bash scripts/update.sh                 # pull, then rebuild what changed
#   sudo bash scripts/update.sh --no-pull       # deploy the checkout as it is
#   bash scripts/update.sh --check              # offline preview, changes nothing
#   sudo bash scripts/update.sh --restart-only  # only restart the services
#
# Options:
#   --check, --dry-run   print what would be done; no fetch, no writes, no root
#   --no-pull            skip the git pull (deploys the working tree as it is)
#   -f, --force          rebuild every tree, ignore the recorded revision
#   -y, --yes            no confirmation prompt
#   --backend-only       update backend/ only
#   --frontend-only      update frontend-app/ only
#   --restart-only       restart the services without touching files
#   -h, --help           this text
#
# Environment overrides:
#   SRC_DIR       source checkout      (default: parent of scripts/)
#   INSTALL_DIR   live install dir     (default: /opt/vizitik)
#   BACKEND_PORT  API port             (default: PORT from backend/.env, else 3000)
#   ADMIN_PORT    admin panel port     (default: ADMIN_PORT from backend/.env, else 3001)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${SRC_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
INSTALL_DIR="${INSTALL_DIR:-/opt/vizitik}"
REVISION_FILE_NAME=".vizitik-revision"

CHECK=0; PULL=1; FORCE=0; YES=0; RESTART_ONLY=0
DO_BACKEND=1; DO_FRONTEND=1; PARTIAL=0

log()  { printf '\n\033[1;36m> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  OK  %s\033[0m\n' "$*"; }
info() { printf '\033[0;36m  ..  %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  WARN %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m  FAIL %s\033[0m\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

while (($#)); do
  case "$1" in
    --check|--dry-run) CHECK=1 ;;
    --no-pull)         PULL=0 ;;
    -f|--force)        FORCE=1 ;;
    -y|--yes)          YES=1 ;;
    --backend-only)    DO_FRONTEND=0; PARTIAL=1 ;;
    --frontend-only)   DO_BACKEND=0; PARTIAL=1 ;;
    --restart-only)    RESTART_ONLY=1; PULL=0; PARTIAL=1 ;;
    -h|--help)         sed -n '2,50p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)                 fail "unknown argument: $1 (try --help)" ;;
  esac
  shift
done

# ------------------------------------------------------------------
# 0) layout detection
# ------------------------------------------------------------------
# The live install of the classic layout IS the checkout: pull and build there.
if [[ -d "$INSTALL_DIR/.git" ]]; then
  LEGACY=1
  SRC_DIR="$INSTALL_DIR"
else
  LEGACY=0
fi
REVISION_FILE="$INSTALL_DIR/$REVISION_FILE_NAME"

if [[ ! -d "$SRC_DIR/.git" && "$CHECK" == 0 ]]; then
  fail "no git checkout at $SRC_DIR - clone the repo there, or set SRC_DIR/INSTALL_DIR (see --help)"
fi
[[ "$INSTALL_DIR" == /* && "$INSTALL_DIR" != / ]] || fail "unsafe INSTALL_DIR: $INSTALL_DIR"

# Every tree this project deploys. A tree is only touched when it exists in the
# checkout, so a stripped-down server keeps working.
TREES=(backend frontend-app admin landing scripts frontend)

read_setting() { # read_setting KEY -> the value from backend/.env (quotes stripped)
  local file="$INSTALL_DIR/backend/.env" line
  [[ -f "$file" ]] || return 0
  line="$(sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$file" | tail -n 1)"
  line="${line%%$'\r'}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

if [[ "$CHECK" == 0 ]]; then
  [[ "$(id -u)" == 0 ]] || fail "run as root: sudo bash scripts/update.sh"
  [[ -f "$INSTALL_DIR/backend/.env" ]] || fail "no installed backend/.env in $INSTALL_DIR - run setup-server.sh first"
  # One update/install at a time: two parallel runs would fight over the same trees.
  LOCK_FILE=""
  for candidate in /run/lock/vizitik-update.lock "$INSTALL_DIR/.update.lock"; do
    if : >"$candidate" 2>/dev/null; then LOCK_FILE="$candidate"; break; fi
  done
  if [[ -n "$LOCK_FILE" ]]; then
    exec 9>"$LOCK_FILE"
    flock -n 9 || fail "another update or install is already running (lock: $LOCK_FILE)"
  else
    warn 'could not create a lock file; continuing without the concurrency lock'
  fi
fi
BACKEND_PORT="${BACKEND_PORT:-$(read_setting PORT)}"; BACKEND_PORT="${BACKEND_PORT:-3000}"
ADMIN_PORT="${ADMIN_PORT:-$(read_setting ADMIN_PORT)}"; ADMIN_PORT="${ADMIN_PORT:-3001}"

if [[ "$LEGACY" == 1 ]]; then
  info 'layout: in-place (the install dir is the git checkout)'
else
  info 'layout: separate source checkout'
fi
info "source: $SRC_DIR"
info "install: $INSTALL_DIR"

# ------------------------------------------------------------------
# 1) pull the checkout
# ------------------------------------------------------------------
HEAD_REV=""
DEPLOYED_REV=""
if [[ -f "$REVISION_FILE" ]]; then DEPLOYED_REV="$(tr -d ' \n' < "$REVISION_FILE")"; fi
if [[ -d "$SRC_DIR/.git" ]]; then HEAD_REV="$(git -C "$SRC_DIR" rev-parse HEAD 2>/dev/null || true)"; fi

if [[ "$RESTART_ONLY" == 0 && "$PULL" == 1 && "$CHECK" == 0 ]]; then
  # Only edits to tracked files block the pull. Ignored or untracked leftovers
  # (caches, logs, .env files, an old .vizitik-revision) are normal on a server
  # and are left alone; if the pull would overwrite any of them, git itself
  # stops and the error below is shown.
  if [[ -n "$(git -C "$SRC_DIR" status --porcelain --untracked-files=no)" ]]; then
    fail "the checkout has local changes; commit or stash them, or run with --no-pull to deploy them as they are"
  fi
  log "pulling $SRC_DIR"
  git -C "$SRC_DIR" pull --ff-only \
    || fail "git pull failed (no upstream branch, or the server has its own commits); use --no-pull to deploy the working tree as it is"
  HEAD_REV="$(git -C "$SRC_DIR" rev-parse HEAD)"
fi
NEW_REV="$HEAD_REV"

# ------------------------------------------------------------------
# 2) classify what changed since the recorded deployment
# ------------------------------------------------------------------
# An install with no usable revision file, a missing core tree or --force is
# treated as 'everything changed' - never as 'nothing to do'.
FULL=0
if [[ "$FORCE" == 1 || -z "$DEPLOYED_REV" || -z "$HEAD_REV" ]]; then
  FULL=1
elif ! git -C "$SRC_DIR" cat-file -e "$DEPLOYED_REV^{commit}" 2>/dev/null; then
  info "the recorded revision $DEPLOYED_REV is not in this checkout; rebuilding every tree"
  FULL=1
else
  for core in backend frontend-app; do
    if [[ -d "$SRC_DIR/$core" && ! -d "$INSTALL_DIR/$core" ]]; then
      warn "the install is missing $core/; rebuilding every tree"
      FULL=1
      break
    fi
  done
fi

if [[ "$FULL" == 1 ]]; then
  files="$(printf '%s/\n' "${TREES[@]}")"
else
  # Tracked changes (pulled + uncommitted) and anything untracked but deployable.
  files="$(git -C "$SRC_DIR" diff --name-only "$DEPLOYED_REV"; git -C "$SRC_DIR" ls-files --others --exclude-standard)"
fi

CHANGED=""
add_changed() { case " $CHANGED " in *" $1 "*) ;; *) CHANGED="${CHANGED:+$CHANGED }$1" ;; esac; }
in_changed() { case " $CHANGED " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

if [[ "$RESTART_ONLY" == 1 ]]; then
  CHANGED="restart"
elif [[ "$FULL" == 1 ]]; then
  if [[ "$DO_BACKEND" == 1 && -d "$SRC_DIR/backend" ]]; then add_changed backend; add_changed schema; fi
  if [[ "$DO_FRONTEND" == 1 && -d "$SRC_DIR/frontend-app" ]]; then add_changed frontend; fi
  if [[ "$PARTIAL" == 0 ]]; then
    add_changed admin; add_changed landing; add_changed scripts
    if [[ -d "$SRC_DIR/frontend" ]]; then add_changed php; fi
  fi
else
  if [[ "$DO_BACKEND" == 1 ]] && grep -q '^backend/' <<< "$files"; then add_changed backend; fi
  if [[ "$DO_FRONTEND" == 1 ]] && grep -q '^frontend-app/' <<< "$files"; then add_changed frontend; fi
  if [[ "$PARTIAL" == 0 ]]; then
    if grep -q '^admin/' <<< "$files"; then add_changed admin; fi
    if grep -q '^landing/' <<< "$files"; then add_changed landing; fi
    if grep -q '^frontend/' <<< "$files"; then add_changed php; fi
    if grep -q '^scripts/' <<< "$files"; then add_changed scripts; fi
  fi
  if [[ "$DO_BACKEND" == 1 ]] && grep -q '^backend/prisma/schema\.prisma' <<< "$files"; then add_changed schema; fi
fi
echo "changed: ${CHANGED:-none}"

if [[ "$CHECK" == 1 ]]; then
  echo 'check mode: offline preview of this checkout; no pull, no copy, no build, no service or database change'
  if [[ -n "$DEPLOYED_REV" ]]; then
    info "deployed revision: $(printf '%s' "$DEPLOYED_REV" | cut -c1-7)"
  else
    info 'deployed revision: (none recorded - a real run rebuilds every tree)'
  fi
  if [[ -n "$HEAD_REV" ]]; then info "checkout revision: $(printf '%s' "$HEAD_REV" | cut -c1-7)"; fi
  if [[ -z "$CHANGED" ]]; then
    info 'nothing changed: the install is already at this revision'
    info "would verify http://127.0.0.1:$BACKEND_PORT/api/health"
  else
    for part in backend frontend admin landing scripts php; do
      in_changed "$part" || continue
      label="$part"
      if [[ "$part" == frontend ]]; then label=frontend-app; fi
      info "would stage, build and activate $label/"
    done
    if in_changed schema; then info 'would run prisma db push (schema changed, never with --accept-data-loss)'; fi
    if in_changed restart; then info 'would restart vizitik-backend (and vizitik-admin when installed)'; fi
  fi
  exit 0
fi

# ------------------------------------------------------------------
# 3) confirmation
# ------------------------------------------------------------------
if [[ "$YES" == 0 ]]; then
  read -r -p "Update $INSTALL_DIR (trees: $CHANGED)? [y/N] " answer || answer=n
  [[ "$answer" =~ ^[Yy]$ ]] || exit 1
fi

# ------------------------------------------------------------------
# 4) helpers
# ------------------------------------------------------------------
health() {
  have curl || return 0
  local i
  for i in {1..30}; do
    if curl --fail --silent --max-time 3 "http://127.0.0.1:$BACKEND_PORT/api/health" | grep -q '"db":"ok"'; then return 0; fi
    sleep 1
  done
  return 1
}
health_admin() {
  systemctl cat vizitik-admin.service >/dev/null 2>&1 || return 0
  have curl || return 0
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

# On a box with little RAM npm/vite get OOM-killed mid-build; 1 GB servers are
# the normal case for this project, so cap the node heap instead of dying.
memory_guard() {
  local avail heap
  avail="$(awk '/MemAvailable/{r=int($2/1024)} /SwapFree/{s=int($2/1024)} END{print r+s}' /proc/meminfo 2>/dev/null || true)"
  avail="${avail:-0}"
  info "memory available: ${avail} MB"
  if [[ "$avail" -lt 1200 ]]; then
    heap=$(( avail * 6 / 10 ))
    if (( heap < 384 )); then heap=384; fi
    export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=${heap}"
    warn "tight on memory: node heap capped at ${heap} MB"
  fi
}

# Staging needs its own copy of node_modules and dist. Warn early on a small
# disk; only refuse when there is not even room for the build.
require_space() {
  local free_mb
  free_mb="$(df -Pm "$INSTALL_DIR" 2>/dev/null | awk 'NR==2{print $4}' || true)"
  [[ -n "$free_mb" ]] || return 0
  info "free disk: ${free_mb} MB"
  if (( free_mb < 300 )); then
    fail "only ${free_mb} MB free on the filesystem of $INSTALL_DIR; free space before updating"
  elif (( free_mb < 1500 )); then
    warn "low disk space (${free_mb} MB): staging the update may fail"
  fi
}

deps_hash() { { cat "$1/package.json" "$1/package-lock.json" 2>/dev/null || true; } | sha256sum | cut -d' ' -f1; }

build_tree() {
  local tree="$1" stage="$STAGE/$1" marker hash
  case "$tree" in backend|frontend-app) ;; *) return 0 ;; esac
  hash="$(deps_hash "$stage")"
  [[ -n "$hash" ]] || hash=missing
  marker="$INSTALL_DIR/.deps-$tree.sha"
  # A stale node_modules (wiped on the VPS, or installed from an older
  # package.json) must be reinstalled even when no dependency file changed.
  if [[ ! -d "$stage/node_modules" || "$hash" != "$(cat "$marker" 2>/dev/null || true)" ]]; then
    info "$tree: installing dependencies (package.json/package-lock.json changed)"
    ( cd "$stage" && npm ci --include=dev --no-audit --no-fund --no-progress ) \
      || fail "$tree: npm ci failed (no network / bad lockfile?); nothing was deployed"
    printf '%s\n' "$hash" > "$marker"
  else
    info "$tree: dependencies unchanged"
  fi
  if [[ "$tree" == backend ]]; then
    ( cd "$stage" && npx prisma generate ) || fail "$tree: prisma generate failed; nothing was deployed"
  fi
  info "$tree: building"
  ( cd "$stage" && npm run build ) || fail "$tree: the build failed; the live install was NOT touched"
  if [[ "$tree" == backend && ! -f "$stage/dist/main.js" ]]; then fail 'the backend build produced no dist/main.js'; fi
  if [[ "$tree" == frontend-app && ! -d "$stage/dist" ]]; then fail 'the PWA build produced no dist/'; fi
  ok "$tree built"
}

if [[ "$CHANGED" == 'restart' ]]; then
  log 'restarting the services'
  restart_services
  health       || fail 'API/database health check failed'
  health_admin || fail 'admin service health check failed'
  ok 'services restarted'
  exit 0
fi

if [[ -z "$CHANGED" ]]; then
  log 'nothing to do'
  if [[ -n "$DEPLOYED_REV" ]]; then
    ok "the install is already at $(printf '%s' "$DEPLOYED_REV" | cut -c1-7); no file was changed"
  else
    warn 'no deployed revision is recorded; run with --force to rebuild every tree'
  fi
  if health; then
    ok "the API answers on port $BACKEND_PORT"
  else
    warn "the API did not answer on port $BACKEND_PORT - restart it: systemctl restart vizitik-backend"
    exit 1
  fi
  if [[ -n "$NEW_REV" && "$NEW_REV" != "$DEPLOYED_REV" ]]; then
    printf '%s\n' "$NEW_REV" > "$REVISION_FILE.new"; mv "$REVISION_FILE.new" "$REVISION_FILE"
  fi
  exit 0
fi

# ------------------------------------------------------------------
# 4) stage every changed tree
# ------------------------------------------------------------------
command -v tar >/dev/null || fail 'tar is required'
log "staging: $CHANGED"
require_space
mkdir -p "$INSTALL_DIR"
STAGE="$(mktemp -d "$INSTALL_DIR/.update.XXXXXXXX")"
activated=(); SUCCESS=0; SERVICES_STOPPED=0
cleanup() {
  local rc=$? i tree
  trap - EXIT INT TERM
  if [[ "$SUCCESS" == 0 && ${#activated[@]} -gt 0 ]]; then
    printf '\n\033[1;31mActivation failed: restoring previous application files (the database is NOT reset)\033[0m\n' >&2
    systemctl stop vizitik-backend 2>/dev/null || true
    systemctl stop vizitik-admin 2>/dev/null || true
    for ((i=${#activated[@]}-1; i>=0; i--)); do
      tree="${activated[i]}"
      rm -rf "${INSTALL_DIR:?}/$tree"
      [[ ! -d "$STAGE/previous/$tree" ]] || mv "$STAGE/previous/$tree" "$INSTALL_DIR/$tree"
    done
    if [[ -d "$INSTALL_DIR/admin" ]]; then
      mkdir -p "$INSTALL_DIR/backend/admin"
      cp "$INSTALL_DIR/admin/"*.js "$INSTALL_DIR/backend/admin/" 2>/dev/null || true
    fi
    restart_services 2>/dev/null || true
    printf 'Inspect: journalctl -u vizitik-backend -n 50\n' >&2
  elif [[ "$SUCCESS" == 0 && "$SERVICES_STOPPED" == 1 ]]; then
    restart_services 2>/dev/null || true
  fi
  rm -rf "$STAGE"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$STAGE/previous"
PART_TREES=()
for part in backend frontend admin landing scripts php; do
  in_changed "$part" || continue
  tree="$part"
  if [[ "$part" == frontend ]]; then tree=frontend-app; fi
  mkdir -p "$STAGE/$tree"
  # Sources only: dependencies, build artifacts, archives and every secret stay out.
  ( cd "$SRC_DIR/$tree" && tar -cf - --exclude=./node_modules --exclude=./dist --exclude='./.env*' --exclude='./*.tgz' . ) \
    | ( cd "$STAGE/$tree" && tar -xf - )
  # The live .env* files are this deployment's own secrets: copy them across.
  if [[ -d "$INSTALL_DIR/$tree" ]]; then
    while IFS= read -r -d '' config; do cp -p "$config" "$STAGE/$tree/"; done \
      < <(find "$INSTALL_DIR/$tree" -maxdepth 1 -name '.env*' -type f -print0)
  fi
  # Carry the existing dependencies over (same filesystem: seconds, not minutes).
  if [[ -d "$INSTALL_DIR/$tree/node_modules" ]]; then
    cp -a "$INSTALL_DIR/$tree/node_modules" "$STAGE/$tree/node_modules"
  fi
  PART_TREES+=("$tree")
done

memory_guard
if in_changed backend; then build_tree backend; fi
if in_changed frontend; then build_tree frontend-app; fi

if in_changed schema && [[ -d "$STAGE/backend" ]]; then
  info 'applying pending schema changes (prisma db push, no data-loss flags)'
  ( cd "$STAGE/backend" && env -u DATABASE_URL npx prisma db push --skip-generate ) \
    || fail 'prisma db push failed (is the database reachable?); no files were activated'
fi

# ------------------------------------------------------------------
# 5) activate atomically, then verify
# ------------------------------------------------------------------
log 'activating'
SERVICES_STOPPED=1
systemctl stop vizitik-backend
if systemctl cat vizitik-admin.service >/dev/null 2>&1; then systemctl stop vizitik-admin; fi
for tree in "${PART_TREES[@]}"; do
  [[ ! -d "$INSTALL_DIR/$tree" ]] || mv "$INSTALL_DIR/$tree" "$STAGE/previous/$tree"
  activated+=("$tree")
  mv "$STAGE/$tree" "$INSTALL_DIR/$tree"
done
# the admin panel runs from backend/admin/server.js (systemd WorkingDirectory)
if compgen -G "$INSTALL_DIR/admin/*.js" >/dev/null; then
  mkdir -p "$INSTALL_DIR/backend/admin"
  cp "$INSTALL_DIR/admin/"*.js "$INSTALL_DIR/backend/admin/"
fi
restart_services
health       || fail 'API/database health check failed after activation'
health_admin || fail 'admin service health check failed after activation'

# Partial updates never advance the recorded revision, so the next full run
# still sees whatever they left behind.
if [[ "$PARTIAL" == 0 && -n "$NEW_REV" ]]; then
  printf '%s\n' "$NEW_REV" > "$REVISION_FILE.new"
  mv "$REVISION_FILE.new" "$REVISION_FILE"
fi

SUCCESS=1
log 'done'
ok "deployed $(printf '%s' "$NEW_REV" | cut -c1-7) - trees: $CHANGED"
if systemctl is-active --quiet vizitik-backend; then ok 'vizitik-backend is active'; fi
if systemctl cat vizitik-admin.service >/dev/null 2>&1 && systemctl is-active --quiet vizitik-admin; then ok 'vizitik-admin is active'; fi
echo '  hard reload the app (Ctrl+Shift+R) so the new PWA bundle is picked up'
