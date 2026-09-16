#!/usr/bin/env bash
#
# Update existing deployment
#
# Pulls the newest commits and rebuilds only what changed.
#
# Usage:
#   sudo bash scripts/update.sh
#
# Options:
#   --check           Show what would be done, change nothing
#   --backend-only    Only rebuild backend
#   --frontend-only   Only rebuild frontend
#   --restart-only    Restart services without rebuilding
#   --force           Rebuild everything regardless of changes
#   -y, --yes         Skip confirmations
#
set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/vizitik}"
BACKEND_PORT="${BACKEND_PORT:-3000}"
SETUP_SVC="vizitik-backend"
ADMIN_SVC="vizitik-admin"

log()  { echo -e "\n\033[1;36m> $*\033[0m"; }
ok()   { echo -e "\033[1;32m  OK  $*\033[0m"; }
info() { echo -e "\033[0;36m  ..  $*\033[0m"; }
warn() { echo -e "\033[1;33m  WARN $*\033[0m"; }
err()  { echo -e "\033[1;31m  FAIL $*\033[0m" >&2; }
skip() { echo -e "  --  $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

CHECK=0; YES=0; DO_BACKEND=1; DO_FRONTEND=1; DO_PULL=1; RESTART_ONLY=0; FORCE=0
REVISION_FILE="$INSTALL_DIR/.vizitik-revision"
DEPLOYED_REV="$(cat "$REVISION_FILE" 2>/dev/null | tr -d ' \n' || true)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check|--dry-run) CHECK=1 ;;
    --backend-only)    DO_FRONTEND=0 ;;
    --frontend-only)   DO_BACKEND=0 ;;
    --restart-only)    RESTART_ONLY=1; DO_PULL=0; DO_BACKEND=0; DO_FRONTEND=0 ;;
    -f|--force)        FORCE=1 ;;
    --no-pull)         DO_PULL=0 ;;
    -y|--yes)          YES=1 ;;
    -h|--help)
      cat <<TXT
usage: sudo bash scripts/update.sh [options]

  --check           print what would be done, change nothing
  --backend-only    skip the PWA build
  --frontend-only   skip the backend build
  --restart-only    restart services without rebuilding
  -f, --force       rebuild both sides from HEAD
  --no-pull         use the checkout as it is
  -y, --yes         no confirmations
TXT
      exit 0 ;;
    *) err "unknown argument: $1"; exit 2 ;;
  esac
  shift
done

run() {
  local label="$1"; shift
  [[ "$CHECK" == "1" ]] && { echo "      would run: $*"; return 0; }
  "$@"
}

ask() {
  [[ "$YES" == "1" || "$CHECK" == "1" ]] || ! [[ -t 0 ]] && return 0
  local ans=""
  read -r -p "  $1 [${2:-y}/n]: " ans || ans=""
  [[ "${ans:-${2:-y}}" =~ ^[Yy] ]]
}

# ------------------------------------------------------------------
# 1) Git checkout
# ------------------------------------------------------------------
update_checkout() {
  [[ -d "$INSTALL_DIR/.git" ]] || { skip "not a git checkout"; return 0; }
  [[ "$DO_PULL" == "0" ]] && { skip "pull skipped"; return 0; }

  local branch
  branch="$(git -C "$INSTALL_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  [[ -z "$branch" || "$branch" == "HEAD" ]] && { skip "detached HEAD"; return 0; }

  info "branch: $branch"
  if git -C "$INSTALL_DIR" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    run "pull" git -C "$INSTALL_DIR" pull --ff-only || {
      warn "pull failed; building current checkout"
      DO_PULL=0
    }
  else
    run "pull" git -C "$INSTALL_DIR" pull --ff-only origin "$branch" || {
      warn "pull failed; building current checkout"
      DO_PULL=0
    }
  fi
}

# ------------------------------------------------------------------
# 2) Classify changes
# ------------------------------------------------------------------
classify_changes() {
  CHANGED=""
  if [[ "$FORCE" == "1" ]]; then
    CHANGED="backend frontend deps schema"
    info "--force: rebuilding all"
    return 0
  fi
  if [[ -z "$DEPLOYED_REV" ]]; then
    CHANGED="backend frontend"
    warn "no deployed revision found; rebuilding all"
    return 0
  fi
  if [[ "$DEPLOYED_REV" == "$(git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null)" ]]; then
    CHANGED="none"
    info "already at latest"
    return 0
  fi

  local files
  files="$(git -C "$INSTALL_DIR" diff --name-only "$DEPLOYED_REV..HEAD" 2>/dev/null)"
  [[ -z "$files" ]] && { CHANGED="backend frontend"; return 0; }

  local parts=()
  echo "$files" | grep -q '^backend/' && parts+=("backend")
  echo "$files" | grep -q '^frontend-app/' && parts+=("frontend")
  echo "$files" | grep -Eq 'package-lock.json|package.json' && parts+=("deps")
  echo "$files" | grep -q 'prisma/schema.prisma' && parts+=("schema")
  [[ ${#parts[@]} -eq 0 ]] && parts=("none")
  CHANGED="${parts[*]}"
  info "changed: $CHANGED"

  if [[ "$CHANGED" != *backend* && "$CHANGED" != *schema* && "$CHANGED" != *deps* ]]; then
    [[ "$DO_BACKEND" == "1" ]] && skip "no backend changes"
    DO_BACKEND=0
  fi
  if [[ "$CHANGED" != *frontend* && "$CHANGED" != *deps* ]]; then
    [[ "$DO_FRONTEND" == "1" ]] && skip "no frontend changes"
    DO_FRONTEND=0
  fi
}

# ------------------------------------------------------------------
# 3) Memory guard
# ------------------------------------------------------------------
memory_guard() {
  local avail
  avail="$(awk '/MemAvailable/{r=int($2/1024)} /SwapFree/{s=int($2/1024)} END{print r+s}' /proc/meminfo 2>/dev/null)"
  avail="${avail:-0}"
  info "memory available: ${avail} MB"
  if [[ "$avail" -lt 1200 ]]; then
    local heap=$(( avail * 6 / 10 ))
    (( heap < 384 )) && heap=384
    export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=${heap}"
    warn "tight on memory: heap capped at ${heap} MB"
  fi
}

# ------------------------------------------------------------------
# 4) Builds
# ------------------------------------------------------------------
needs_deps() { [[ " $CHANGED " == *" deps "* ]]; }

npm_install_in() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  if needs_deps || [[ ! -d "$dir/node_modules" ]]; then
    run "npm" bash -c "cd '$dir' && npm ci --no-audit --no-fund --no-progress --loglevel=error 2>/dev/null || npm install --no-audit --no-fund --no-progress --loglevel=error"
  else
    skip "dependencies unchanged"
  fi
}

update_backend() {
  [[ "$DO_BACKEND" == "1" ]] || return 0
  log "backend"
  local be="$INSTALL_DIR/backend"
  npm_install_in "$be" || exit 1

  if [[ " $CHANGED " == *" schema "* ]] || [[ ! -d "$be/node_modules/.prisma" ]]; then
    run "prisma generate" bash -c "cd '$be' && npx prisma generate"
  fi
  if [[ " $CHANGED " == *" schema "* ]]; then
    run "prisma db push" bash -c "cd '$be' && npx prisma db push --skip-generate"
  fi

  if ! run "build" bash -c "cd '$be' && npm run build"; then
    err "backend build failed"
    exit 1
  fi
  ok "backend built"
}

update_frontend() {
  [[ "$DO_FRONTEND" == "1" ]] || return 0
  log "PWA frontend"
  local fe="$INSTALL_DIR/frontend-app"
  local tmp="$INSTALL_DIR/.frontend-app.new"
  run "clean" rm -rf "$tmp"
  run "copy" bash -c "mkdir -p '$tmp' && tar -C '$fe' --exclude=./node_modules --exclude=./dist -cf - . | tar -C '$tmp' -xf -"
  npm_install_in "$tmp" || exit 1

  if ! run "vite build" bash -c "cd '$tmp' && npm run build"; then
    err "PWA build failed"
    run "clean" rm -rf "$tmp"
    exit 1
  fi

  local prev="$INSTALL_DIR/frontend-app/dist.prev"
  mv "$fe/dist" "$prev" 2>/dev/null || true
  mv "$tmp/dist" "$fe/dist" || { mv "$prev" "$fe/dist" 2>/dev/null || true; err "PWA swap failed"; exit 1; }
  rm -rf "$tmp" "$prev"
  ok "PWA rebuilt"
}

# ------------------------------------------------------------------
# 5) Service restart
# ------------------------------------------------------------------
restart_service() {
  [[ "$RESTART_ONLY" == "1" || "$DO_BACKEND" == "1" ]] || return 0
  log "restarting services"

  if have systemctl; then
    # Stop any stray processes on the port
    local pids
    pids="$(ss -ltnp 2>/dev/null | awk -v port=":$BACKEND_PORT" '$4 ~ port"$" {print}' | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u)"
    local main
    main="$(systemctl show -p MainPID "$SETUP_SVC" 2>/dev/null | cut -d= -f2)"
    local strays=""
    for p in $pids; do
      [[ "$p" == "$main" ]] || strays+="$p "
    done
    if [[ -n "${strays// /}" ]]; then
      info "stopping stray processes"
      kill $strays 2>/dev/null || true
      sleep 1
    fi

    run "restart" systemctl restart "$SETUP_SVC"
    sleep 2
    if systemctl is-active --quiet "$SETUP_SVC"; then
      ok "$SETUP_SVC is active"
    else
      err "$SETUP_SVC failed to start"
      journalctl -u "$SETUP_SVC" -n 20 --no-pager 2>/dev/null | sed 's/^/        /'
      exit 1
    fi

    if systemctl is-active --quiet "$ADMIN_SVC" 2>/dev/null; then
      run "restart admin" systemctl restart "$ADMIN_SVC"
      ok "$ADMIN_SVC restarted"
    fi
  else
    warn "no systemctl; restart the service manually"
  fi
}

# ------------------------------------------------------------------
# 6) Verification
# ------------------------------------------------------------------
verify() {
  [[ "$CHECK" == "1" ]] && return 0
  log "verification"

  if have curl; then
    local code
    code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://127.0.0.1:${BACKEND_PORT}/" 2>/dev/null)"
    if [[ "$code" =~ ^[0-9]{3}$ && "$code" != "000" ]]; then
      ok "API responds on port $BACKEND_PORT (http $code)"
    else
      warn "API did not respond on port $BACKEND_PORT"
    fi
  fi

  if [[ "$RESTART_ONLY" == "0" ]] && have git; then
    git -C "$INSTALL_DIR" rev-parse HEAD > "$REVISION_FILE" 2>/dev/null
    ok "revision recorded: $(git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null)"
  fi
}

# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------
main() {
  if [[ "$CHECK" == "1" ]]; then
    echo -e "\033[1;33m  check mode: nothing will be changed\033[0m"
  elif [[ "$(id -u)" -ne 0 ]]; then
    err "run as root: sudo bash scripts/update.sh"
    exit 1
  fi

  log "Update - $(date '+%Y-%m-%d %H:%M')"
  update_checkout
  classify_changes

  if [[ "$RESTART_ONLY" == "1" ]]; then
    restart_service || exit 1
    verify
    exit 0
  fi

  if [[ "$CHANGED" == "none" ]]; then
    log "nothing changed"
    ok "already running $(git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null)"
    exit 0
  fi

  memory_guard
  update_backend
  update_frontend
  restart_service || exit 1
  verify || exit 1

  log "done"
  echo "  hard reload (Ctrl+Shift+R) to pick up the new build"
}

main "$@"
