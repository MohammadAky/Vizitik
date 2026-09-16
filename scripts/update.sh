#!/usr/bin/env bash
#
# Update existing deployment
#
# The live install ($INSTALL_DIR, default /opt/vizitik) is NOT a git checkout —
# setup-server.sh only copies the deployable trees there. So this script:
#   1) pulls the source checkout ($SRC_DIR, default: the repo this script lives in)
#   2) re-syncs the deployable trees (backend, frontend-app, landing, admin)
#      into $INSTALL_DIR, preserving backend/.env, frontend-app/.env and node_modules
#   3) rebuilds only what changed (backend and/or the PWA), restarts what needs it,
#      and records the deployed revision.
#
# PHP site (frontend/) needs no build: files served from a checkout are live
# right after the pull; when served from $INSTALL_DIR the sync covers it.
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
#   --no-pull         Skip the git pull, deploy the checkout as it is
#   -y, --yes         Skip confirmations
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${SRC_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
INSTALL_DIR="${INSTALL_DIR:-/opt/vizitik}"
BACKEND_PORT="${BACKEND_PORT:-3000}"
SETUP_SVC="vizitik-backend"
ADMIN_SVC="vizitik-admin"

log()  { echo -e "\n\033[1;36m> $*\033[0m"; }
ok()   { echo -e "\033[1;32m  OK  $*\033[0m"; }
info() { echo -e "\033[0;36m  ..  $*"; }
warn() { echo -e "\033[1;33m  WARN $*"; }
err()  { echo -e "\033[1;31m  FAIL $*" >&2; }
skip() { echo -e "  --  $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

CHECK=0; YES=0; DO_BACKEND=1; DO_FRONTEND=1; DO_PULL=1; RESTART_ONLY=0; FORCE=0
LEGACY=0 # 1 when $INSTALL_DIR itself is the git checkout (files in place after pull)
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
  -f, --force       rebuild both sides from the checkout
  --no-pull         deploy the checkout as it is (no git pull)
  -y, --yes         no confirmations

  SRC_DIR       source checkout to deploy (default: parent of scripts/)
  INSTALL_DIR   live install dir        (default: /opt/vizitik)
TXT
      exit 0 ;;
    *) err "unknown argument: $1"; exit 2 ;;
  esac
  shift
done

run() {
  local label="$1"; shift
  if [[ "$CHECK" == "1" ]]; then
    # keep the preview readable: shell snippets are printed as their label only
    local cmd="$*"
    if [[ "$cmd" == *$'\n'* ]]; then
      echo "      would run: $label"
    else
      echo "      would run: $cmd"
    fi
    return 0
  fi
  "$@"
}

# ------------------------------------------------------------------
# 1) Git checkout — the source checkout gets the pull
# ------------------------------------------------------------------
update_checkout() {
  PULLED=0
  NEW_REV=""
  OLD_REV=""

  # legacy: if the install dir itself is a git checkout, pull there
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    LEGACY=1
    info "install dir is a git checkout — pulling there"
    local branch
    branch="$(git -C "$INSTALL_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)"
    OLD_REV="$(git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null)"
    local doff
    doff="git -C $INSTALL_DIR"
    if [[ "$CHECK" == "1" ]]; then
      if $doff fetch origin "$branch" >/dev/null 2>&1; then
        NEW_REV="$($doff rev-parse FETCH_HEAD 2>/dev/null)"
        local ahead
        ahead="$($doff rev-list --count "$OLD_REV..$NEW_REV" 2>/dev/null || echo 0)"
        [[ "$ahead" -gt 0 ]] && { PULLED=1; info "check mode: $ahead commit(s) pending on origin/$branch"; }
      fi
    elif git -C "$INSTALL_DIR" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
      if run "pull" git -C "$INSTALL_DIR" pull --ff-only; then
        NEW_REV="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
        [[ "$NEW_REV" != "$OLD_REV" ]] && PULLED=1
      fi
    else
      if run "pull" git -C "$INSTALL_DIR" pull --ff-only origin "$branch"; then
        NEW_REV="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
        [[ "$NEW_REV" != "$OLD_REV" ]] && PULLED=1
      fi
    fi
    if [[ "$PULLED" == "0" ]]; then
      [[ -n "${NEW_REV:-}" && "$NEW_REV" == "$DEPLOYED_REV" ]] && { info "already at latest"; return 0; }
      NEW_REV="${NEW_REV:-$(git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null)}"
      OLD_REV="$DEPLOYED_REV"
    fi
    return 0
  fi

  # normal mode: pull the source checkout (~/Vizitik)
  [[ -d "$SRC_DIR/.git" ]] || { err "no git checkout at $SRC_DIR — clone the repo there first"; exit 1; }
  [[ "$DO_PULL" == "0" ]] && { skip "pull skipped (--no-pull)"; }

  OLD_REV="$(git -C "$SRC_DIR" rev-parse HEAD 2>/dev/null)"
  if [[ "$DO_PULL" == "1" ]]; then
    info "source checkout: $SRC_DIR"
    local branch
    branch="$(git -C "$SRC_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)"
    if [[ "$CHECK" == "1" ]]; then
      # read-only: fetch and preview what a real run would pull
      if git -C "$SRC_DIR" fetch origin "$branch" >/dev/null 2>&1; then
        NEW_REV="$(git -C "$SRC_DIR" rev-parse FETCH_HEAD 2>/dev/null)"
        local ahead
        ahead="$(git -C "$SRC_DIR" rev-list --count "$OLD_REV..$NEW_REV" 2>/dev/null || echo 0)"
        if [[ "$ahead" -gt 0 ]]; then
          PULLED=1
          info "check mode: $ahead commit(s) pending on origin/$branch:"
          git -C "$SRC_DIR" log --oneline "$OLD_REV..$NEW_REV" | sed 's/^/        /'
        else
          info "check mode: up to date with origin/$branch"
        fi
      else
        warn "check mode: could not fetch origin (offline?) — assuming the checkout as-is"
      fi
    elif git -C "$SRC_DIR" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
      if ! run "pull" git -C "$SRC_DIR" pull --ff-only; then
        err "git pull failed in $SRC_DIR"
        err "if the VPS has local commits, push or merge them first (git pull refuses to fast-forward)"
        exit 2
      fi
      NEW_REV="$(git -C "$SRC_DIR" rev-parse HEAD 2>/dev/null)"
      [[ "$NEW_REV" != "$OLD_REV" ]] && { PULLED=1; ok "pulled: $(git -C "$SRC_DIR" log --oneline "$OLD_REV..$NEW_REV" | sed 's/^/        /')"; }
    else
      if ! run "pull" git -C "$SRC_DIR" pull --ff-only origin "$branch"; then
        err "git pull failed in $SRC_DIR (no upstream tracking?)"
        exit 2
      fi
      NEW_REV="$(git -C "$SRC_DIR" rev-parse HEAD 2>/dev/null)"
      [[ "$NEW_REV" != "$OLD_REV" ]] && { PULLED=1; ok "pulled: $(git -C "$SRC_DIR" log --oneline "$OLD_REV..$NEW_REV" | sed 's/^/        /')"; }
    fi
  else
    NEW_REV="$OLD_REV"
  fi

  if [[ "$PULLED" == "0" && "${OLD_REV:-}" == "$DEPLOYED_REV" ]]; then
    info "already at latest"
    return 0
  fi
  # classification base: what was pulled this run (OLD_REV), or when nothing
  # was pulled, the last recorded deployed revision
  [[ "$PULLED" == "1" ]] || OLD_REV=""
}

# ------------------------------------------------------------------
# 2) Classify changes
# ------------------------------------------------------------------
classify_changes() {
  CHANGED=""
  if [[ "$FORCE" == "1" ]]; then
    CHANGED="backend frontend deps schema php landing admin"
    info "--force: rebuilding all"
    return 0
  fi
  if [[ -z "$NEW_REV" ]]; then
    CHANGED="none"
    return 0
  fi
  if [[ -z "$OLD_REV" && -z "$DEPLOYED_REV" ]]; then
    CHANGED="backend frontend"
    warn "no deployed revision found; rebuilding all"
    return 0
  fi

  local base="${OLD_REV:-$DEPLOYED_REV}"
  local files
  files="$(git -C "$SRC_DIR" diff --name-only "$base..$NEW_REV" 2>/dev/null || git -C "$INSTALL_DIR" diff --name-only "$base..$NEW_REV" 2>/dev/null)"
  [[ -z "$files" ]] && { CHANGED="none"; return 0; }

  local parts=()
  echo "$files" | grep -q '^backend/' && parts+=("backend")
  echo "$files" | grep -q '^frontend-app/' && parts+=("frontend")
  echo "$files" | grep -q '^frontend/' && parts+=("php")
  echo "$files" | grep -q '^landing/' && parts+=("landing")
  echo "$files" | grep -q '^admin/' && parts+=("admin")
  echo "$files" | grep -Eq '^backend/package(-lock)?\.json$|^frontend-app/package(-lock)?\.json$' && parts+=("deps")
  echo "$files" | grep -q '^backend/prisma/schema.prisma' && parts+=("schema")
  [[ ${#parts[@]} -eq 0 ]] && parts=("none")
  CHANGED="${parts[*]}"
  info "changed: $CHANGED"

  if [[ "$CHANGED" != *backend* && "$CHANGED" != *schema* && "$CHANGED" != *deps* ]]; then
    [[ "$DO_BACKEND" == "1" ]] && skip "no backend changes"
    DO_BACKEND=0
  fi
  if [[ "$CHANGED" != *frontend* && "$CHANGED" != *deps* ]]; then
    [[ "$DO_FRONTEND" == "1" ]] && skip "no PWA changes"
    DO_FRONTEND=0
  fi
}

# ------------------------------------------------------------------
# 2b) Sync deployable trees from the source checkout
# ------------------------------------------------------------------
sync_trees() {
  if [[ "$LEGACY" == "1" ]]; then
    skip "install dir is the checkout — files are in place after the pull"
    return 0
  fi
  log "syncing source trees to $INSTALL_DIR"
  local t
  for t in backend frontend-app landing admin; do
    if [[ ! -d "$SRC_DIR/$t" ]]; then
      skip "$t (not in checkout)"
      continue
    fi
    local dest="$INSTALL_DIR/$t"
    if [[ "$CHECK" == "1" ]]; then
      # --check promises to change nothing, so do not create directories here
      [[ -d "$dest" ]] || echo "      would create: $dest"
    else
      [[ -d "$dest" ]] || mkdir -p "$dest"
    fi

    # preserve the live .env, node_modules and built dist while replacing the
    # rest of the tree with the fresh source
    # (the dist backups from update_backend - backend.dist.*.tgz - are kept too,
    #  otherwise the rollback copy would be wiped by every sync)
    run "clean+copy" bash -c "
      d='$dest'; s='$SRC_DIR/$t';
      [[ -d \"\$d/node_modules\" ]] && mv \"\$d/node_modules\" \"\$d/.nm.keep\" 2>/dev/null || true;
      [[ -f \"\$d/.env\" ]] && cp \"\$d/.env\" \"\$d/.env.keep\" 2>/dev/null || true;
      [[ -d \"\$d/dist\" ]] && mv \"\$d/dist\" \"\$d/.dist.keep\" 2>/dev/null || true;
      for a in \"\$d\"/backend.dist.*.tgz; do [[ -e \"\$a\" ]] && mv \"\$a\" \"\$a.keep\" 2>/dev/null; done;
      find \"\$d\" -mindepth 1 -maxdepth 1 ! -name '.nm.keep' ! -name '.env.keep' ! -name '.dist.keep' ! -name '*.tgz.keep' -exec rm -rf {} + 2>/dev/null;
      cp -r \"\$s/.\" \"\$d/\";
      [[ -f \"\$d/.env.keep\" ]] && { mv \"\$d/.env.keep\" \"\$d/.env\"; } || rm -f \"\$d/.env.keep\";
      [[ -d \"\$d/.nm.keep\" ]] && { mv \"\$d/.nm.keep\" \"\$d/node_modules\"; rm -rf \"\$d/node_modules/.vite\"; } || true;
      [[ -d \"\$d/.dist.keep\" ]] && mv \"\$d/.dist.keep\" \"\$d/dist\" || true;
      for a in \"\$d\"/*.tgz.keep; do [[ -e \"\$a\" ]] && mv \"\$a\" \"\${a%.keep}\" 2>/dev/null; done;
      true
    "
    [[ "$CHECK" == "1" ]] || ok "$t synced"
  done

  # the admin panel runs from backend/admin/server.js (systemd WorkingDirectory)
  if [[ -f "$SRC_DIR/admin/server.js" && -d "$INSTALL_DIR/backend" ]]; then
    run "admin script" bash -c "mkdir -p '$INSTALL_DIR/backend/admin' && cp '$SRC_DIR/admin/server.js' '$INSTALL_DIR/backend/admin/server.js'"
    [[ "$CHECK" == "1" ]] || ok "admin panel script synced"
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
  # Fingerprint of the manifest+lock: a stale node_modules (e.g. wiped on the
  # VPS, or installed from an older package.json) must be reinstalled even
  # when the pulled diff contains no dependency files.
  local marker="$INSTALL_DIR/.deps-$(basename "$dir").sha"
  local hash
  hash="$(cat "$dir/package.json" "$dir/package-lock.json" 2>/dev/null | sha256sum | cut -d' ' -f1)"
  if [[ "$hash" != "$(cat "$marker" 2>/dev/null)" || ! -d "$dir/node_modules" ]]; then
    run "npm" bash -c "cd '$dir' && npm ci --no-audit --no-fund --no-progress --loglevel=error 2>/dev/null || npm install --no-audit --no-fund --no-progress --loglevel=error"
    [[ "$CHECK" == "1" ]] || echo "$hash" > "$marker"
  else
    skip "dependencies unchanged"
  fi
}

# `nest build` deletes dist/ before it starts compiling (deleteOutDir in
# nest-cli.json), so a type error would leave the install without anything to
# start. Keep the last good build and put it back when the new one fails.
archive_backend_dist() {
  local be="$1"
  [[ -d "$be/dist" ]] || return 0
  if [[ "$CHECK" == "1" ]]; then
    echo "      would keep a copy of $be/dist"
    return 0
  fi
  local stamp
  stamp="$(date +%s)"
  if tar -C "$be" -czf "$be/backend.dist.$stamp.tgz" dist >/dev/null 2>&1; then
    info "kept a copy of the current build (backend.dist.$stamp.tgz)"
  else
    warn "could not archive $be/dist (continuing without a rollback copy)"
    return 0
  fi
  # keep only the three newest archives
  local old
  ls -1t "$be"/backend.dist.*.tgz 2>/dev/null | tail -n +4 | while read -r old; do
    rm -f "$old"
  done
}

restore_backend_dist() {
  local be="$1" newest
  newest="$(ls -1t "$be"/backend.dist.*.tgz 2>/dev/null | head -1)"
  [[ -n "$newest" ]] || return 1
  rm -rf "$be/dist"
  if tar -C "$be" -xzf "$newest" >/dev/null 2>&1 && [[ -f "$be/dist/main.js" ]]; then
    warn "backend build failed - restored the previous build from $(basename "$newest")"
    return 0
  fi
  return 1
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

  archive_backend_dist "$be"
  if ! run "build" bash -c "cd '$be' && npm run build"; then
    err "backend build failed"
    if restore_backend_dist "$be"; then
      if have systemctl && systemctl list-unit-files "$SETUP_SVC.service" >/dev/null 2>&1; then
        run systemctl restart "$SETUP_SVC"
        sleep 2
        if systemctl is-active --quiet "$SETUP_SVC"; then
          ok "$SETUP_SVC is serving the previous build again"
        else
          warn "$SETUP_SVC did not come back up - check: journalctl -u $SETUP_SVC -n 30"
        fi
      fi
      echo "      the TypeScript errors above are the cause; fix them and run update.sh again"
    else
      err "no previous build to restore - the API stays down until the build succeeds"
      echo "      rebuild manually:  cd $be && npm run build"
    fi
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

  if [[ "$CHECK" == "1" ]]; then
    echo "      would swap: $tmp/dist -> $fe/dist (old dist kept as dist.prev until success)"
    return 0
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
  # --check must not touch services: it only previews what would happen
  local need_restart=0
  [[ "$RESTART_ONLY" == "1" || "$DO_BACKEND" == "1" ]] && need_restart=1
  [[ " $CHANGED " == *" admin "* ]] && need_restart=1
  [[ "$need_restart" == "1" ]] || return 0
  if [[ "$CHECK" == "1" ]]; then
    log "restarting services"
    [[ "$DO_BACKEND" == "1" || "$RESTART_ONLY" == "1" ]] && echo "      would run: systemctl restart $SETUP_SVC"
    [[ "$RESTART_ONLY" == "1" ]] && echo "      would run: systemctl restart $ADMIN_SVC"
    return 0
  fi
  log "restarting services"

  if have systemctl; then
    if [[ "$DO_BACKEND" == "1" || "$RESTART_ONLY" == "1" ]]; then
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
    fi

    if [[ " $CHANGED " == *" admin "* || "$RESTART_ONLY" == "1" ]] && systemctl is-active --quiet "$ADMIN_SVC" 2>/dev/null; then
      run "restart admin" systemctl restart "$ADMIN_SVC"
      ok "$ADMIN_SVC restarted"
    fi
  else
    warn "no systemctl; restart the services manually"
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

  if [[ -n "$NEW_REV" ]]; then
    echo "$NEW_REV" > "$REVISION_FILE" 2>/dev/null
    ok "revision recorded: $(echo "$NEW_REV" | cut -c1-7)"
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
  NEW_REV=""; OLD_REV=""
  update_checkout
  classify_changes

  if [[ "$RESTART_ONLY" == "1" ]]; then
    restart_service || exit 1
    verify
    exit 0
  fi

  if [[ "$CHANGED" == "none" || -z "$CHANGED" ]]; then
    log "nothing changed"
    ok "already running $(git -C "$SRC_DIR" rev-parse --short HEAD 2>/dev/null || git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null)"
    verify
    exit 0
  fi

  # sync the deployable trees so the build runs against fresh sources
  sync_trees

  memory_guard
  update_backend
  update_frontend
  restart_service || exit 1
  verify || exit 1

  log "done"
  echo "  hard reload (Ctrl+Shift+R) to pick up the new build"
}

main "$@"
