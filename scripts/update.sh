#!/usr/bin/env bash
#
# update.sh - take the newest commits from GitHub and put them into service.
#
# The usual loop is: change something, push it, then on the server run
#
#   sudo bash scripts/update.sh
#
# It only does the work the diff asks for: a backend change rebuilds and restarts
# the NestJS service, a frontend change rebuilds the PWA, a prisma/schema change
# runs "prisma generate" (and db push), a lockfile change reinstalls dependencies.
# The previous build is kept, so a build that fails or a service that does not come
# back up is rolled back automatically.
# Before the restart it stops whatever else still holds the API port (a
# hand-started "node dist/main.js", a pm2 copy, ...), and after the restart it
# verifies the port is served by the fresh service process - the old build can
# never keep answering silently, so an update never needs a reboot to take effect.
#
# options:
#   --check            print what would be done, change nothing (no root needed)
#   --backend-only     skip the PWA build
#   --frontend-only    skip the backend build
#   --restart-only     no pull, no build: restart the service and reload nginx
#   --force-deps       npm install even when no lockfile changed
#   --no-restart       build into place but leave the running service alone
#   --revision <sha>   check out that commit/tag/branch instead of the newest one
#   --no-pull          use the checkout as it is
#   -y, --yes          no confirmations
#   -h, --help         this text
#
# environment: SRC_DIR INSTALL_DIR BACKEND_PORT SETUP_SVC GIT_REMOTE
#
set -uo pipefail

SRC_DIR="${SRC_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ORIGINAL_ARGS=("$@")
INSTALL_DIR="${INSTALL_DIR:-/opt/vizitik}"
BACKEND_PORT="${BACKEND_PORT:-3000}"
ADMIN_PORT="${ADMIN_PORT:-3001}"
SETUP_SVC="${SETUP_SVC:-vizitik-backend}"
ADMIN_SVC="${ADMIN_SVC:-vizitik-admin}"
GIT_REMOTE="${GIT_REMOTE:-origin}"
REVISION=""

REVISION_FILE() { printf '%s' "$INSTALL_DIR/.vizitik-revision"; }

DEPLOYED_REV="$(cat "$(REVISION_FILE)" 2>/dev/null | tr -d ' \n' || true)"

log()  { echo -e "\n\033[1;36m> $*\033[0m"; }
ok()   { echo -e "\033[1;32m  OK  $*\033[0m"; }
info() { echo -e "\033[0;36m  ..  $*\033[0m"; }
warn() { echo -e "\033[1;33m  WARN $*\033[0m"; }
err()  { echo -e "\033[1;31m  FAIL $*\033[0m" >&2; }
skip() { echo -e "  --  $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

CHECK=0; YES=0; DO_BACKEND=1; DO_FRONTEND=1; DO_LANDING=1; DO_ADMIN=1; DO_PULL=1; RESTART_ONLY=0; FORCE_DEPS=0; DO_RESTART=1; FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check|--dry-run) CHECK=1 ;;
    --backend-only)    DO_FRONTEND=0; DO_LANDING=0; DO_ADMIN=0 ;;
    --frontend-only)   DO_BACKEND=0 ;;
    --restart-only)    RESTART_ONLY=1; DO_PULL=0; DO_BACKEND=0; DO_FRONTEND=0; DO_LANDING=0; DO_ADMIN=0 ;;
    --force-deps)      FORCE_DEPS=1 ;;
    -f|--force)        FORCE=1; FORCE_DEPS=1 ;;
    --no-restart)      DO_RESTART=0 ;;
    --no-pull)         DO_PULL=0 ;;
    --revision)        shift; REVISION="${1:-}" ;;
    --revision=*)      REVISION="${1#*=}" ;;
    -y|--yes)          YES=1 ;;
    -h|--help)
      cat <<TXT
usage: sudo bash scripts/update.sh [options]

  pulls the newest commits in $SRC_DIR and rebuilds only what the diff touched.

  --check           print what would be done, change nothing (no root needed)
  --backend-only    skip the PWA build
  --frontend-only   skip the backend build
  --restart-only    no pull, no build: restart the service and reload nginx
  --force-deps      reinstall node packages even when no lockfile changed
  -f, --force       rebuild both sides from HEAD, ignoring what the diff says
  --no-restart      build into place, leave the running service alone
  --no-pull         use the checkout as it is
  --revision <sha>  check out that commit/tag/branch instead of the newest
  -y, --yes         no confirmations
TXT
      exit 0 ;;
    *)                 err "unknown argument: $1 (see --help)"; exit 2 ;;
  esac
  shift
done

PARTIAL_UPDATE=0
for arg in "${ORIGINAL_ARGS[@]}"; do
  [[ "$arg" == "--backend-only" || "$arg" == "--frontend-only" ]] && PARTIAL_UPDATE=1
done

run() {  # run <label> <command...> - in check mode only print it
  local label="$1"; shift
  if [[ "$CHECK" == "1" ]]; then echo "      would run: $*"; return 0; fi
  "$@"
}

ask() {  # ask <prompt> <default y|n> -> 0 for yes
  if [[ "$YES" == "1" || "$CHECK" == "1" ]] || ! [[ -t 0 ]]; then
    [[ "${2:-y}" == "y" ]]; return $?
  fi
  local ans=""
  read -r -p "  $prompt [${2:-y}/n]: " ans || ans=""
  [[ "${ans:-${2:-y}}" =~ ^[Yy] ]]
}

# ------------------------------------------------------------------
# 1) the checkout: what actually changed?
# ------------------------------------------------------------------

git_at() { git -C "$SRC_DIR" "$@"; }

update_checkout() {
  PREV=""; NOW=""
  log "source checkout: $SRC_DIR"
  have git || { err "git is not installed"; exit 1; }
  [[ -d "$SRC_DIR/.git" ]] || { err "$SRC_DIR is not a git checkout"; exit 1; }

  if [[ "$DO_PULL" == "0" && -z "$REVISION" ]]; then
    skip "pull skipped (--no-pull / --restart-only)"
    return 0
  fi
  if ! git_at remote get-url "$GIT_REMOTE" >/dev/null 2>&1 && [[ -z "$REVISION" ]]; then
    warn "this checkout has no '$GIT_REMOTE' remote, so there is nothing to fetch; building what is here"
    DO_PULL=0
    return 0
  fi

  local dirty
  dirty="$(git_at status --porcelain 2>/dev/null | head -10)"
  if [[ -n "$dirty" ]]; then
    warn "the checkout has uncommitted changes; they are not from GitHub and will stay:"
    echo "$dirty" | sed 's/^/        /'
  fi

  PREV="$(git_at rev-parse HEAD 2>/dev/null || echo '')"
  if [[ -n "$REVISION" ]]; then
    log "checking out $REVISION"
    run "fetch" git_at fetch --tags "$GIT_REMOTE" || { err "fetch failed"; exit 1; }
    run "checkout" git_at checkout --detach "$REVISION" || { err "could not check out $REVISION"; exit 1; }
  else
    local branch upstream
    branch="$(git_at rev-parse --abbrev-ref HEAD 2>/dev/null)"
    if [[ "${branch:-}" == "HEAD" ]]; then
      info "the checkout is detached (a --revision deploy?), there is no branch to pull; building what is here"
      DO_PULL=0
      return 0
    fi
    if git_at rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
      upstream="$(git_at rev-parse --abbrev-ref '@{u}' 2>/dev/null)"
      run "pull" git_at pull --ff-only || {
      warn "git pull --ff-only failed; trying an explicit fetch + fast-forward"
      run "fetch" git_at fetch "$GIT_REMOTE" || { err "git fetch failed"; exit 1; }
      run "merge" git_at merge --ff-only "$upstream" || {
        err "the branch is not a fast-forward of $upstream (you have local commits?)."
        err "  look:  git -C $SRC_DIR log --oneline HEAD..$upstream"
        err "  then:  git -C $SRC_DIR reset --hard $upstream   # throws away local commits"
        exit 1
      }
    }
    else
      upstream="$GIT_REMOTE/${branch:-main}"
      info "branch ${branch:-?} has no upstream; pulling $upstream"
      run "pull" git_at pull --ff-only "$GIT_REMOTE" "${branch:-main}" || {
        warn "the explicit pull failed; building the checkout as it is"
        DO_PULL=0
      }
    fi
  fi
  NOW="$(git_at rev-parse HEAD 2>/dev/null || echo '')"
  # if the pull brought a new update.sh, hand over to it: the old copy must not run
  # logic that was already judged wrong by the commit being deployed
  if [[ "$PREV" != "$NOW" && -n "$PREV" && "${VIZITIK_UPDATE_SELF:-}" != "1" ]] \
     && git_at diff --name-only "$PREV..$NOW" 2>/dev/null | grep -qx 'scripts/update.sh'; then
    info "this script was updated by the pull - restarting with the new copy"
    export VIZITIK_UPDATE_SELF=1
    exec bash "$SRC_DIR/scripts/update.sh" --no-pull "${ORIGINAL_ARGS[@]}"
  fi
  if [[ "$NOW" == "$PREV" ]]; then
    info "already at $(git_at rev-parse --short HEAD 2>/dev/null): $(git_at log -1 --format=%s 2>/dev/null)"
  else
    ok "updated $(git_at rev-parse --short "$PREV" 2>/dev/null || echo '?') -> $(git_at rev-parse --short HEAD 2>/dev/null)"
    git_at log --oneline "${PREV:+$PREV..}$NOW" 2>/dev/null | head -12 | sed 's/^/        /'
  fi
}

hint_remote_ahead() {
  # the classic "i pushed but update.sh says nothing changed": the commits went
  # to another branch than the one this server deploys. read-only, never changes
  # the checkout; it only names the branch that is ahead.
  [[ -d "$SRC_DIR/.git" ]] || return 0
  local branch; branch="$(git_at rev-parse --abbrev-ref HEAD 2>/dev/null)"
  [[ -z "$branch" || "$branch" == "HEAD" ]] && return 0
  if [[ "$CHECK" != "1" ]]; then
    git_at fetch --quiet "$GIT_REMOTE" 2>/dev/null || return 0
  fi
  local head ref short count
  head="$(git_at rev-parse HEAD 2>/dev/null)" || return 0
  while read -r ref; do
    [[ -n "$ref" ]] || continue
    short="${ref#refs/remotes/$GIT_REMOTE/}"
    [[ "$short" == "HEAD" || "$short" == "$branch" ]] && continue
    count="$(git_at rev-list --count "$head..$ref" 2>/dev/null || echo 0)"
    if [[ "$count" =~ ^[0-9]+$ ]] && (( count > 0 )); then
      warn "$GIT_REMOTE/$short holds $count commit(s) this server does not have (it deploys branch '$branch' @ $(git_at rev-parse --short HEAD 2>/dev/null))"
      info "merge $short into $branch and rerun, or deploy it directly: sudo bash scripts/update.sh --revision $GIT_REMOTE/$short"
    fi
  done < <(git_at for-each-ref --format='%(refname)' "refs/remotes/$GIT_REMOTE/" 2>/dev/null)
}

classify_changes() {
  CHANGED=""
  local files=""
  # the real question is the distance between HEAD and what is deployed, so a
  # "git pull" done by hand (or the very first update.sh run) still rebuilds
  if [[ "$FORCE" == "1" ]]; then
    CHANGED="backend frontend landing admin deps schema"
    info "--force: rebuilding both sides from HEAD ($(git_at rev-parse --short HEAD 2>/dev/null))"
    return 0
  fi
  if [[ -z "$DEPLOYED_REV" ]]; then
    CHANGED="backend frontend landing admin"
    warn "$(REVISION_FILE) is missing - this install was not produced by update.sh, rebuilding both sides"
    return 0
  fi
  if [[ "$DEPLOYED_REV" == "$(git_at rev-parse HEAD 2>/dev/null)" ]]; then
    if [[ "$DO_PULL" == "1" && "$PREV" == "$NOW" ]]; then
      CHANGED="none"
      info "the server already runs $(git_at rev-parse --short HEAD 2>/dev/null) and the pull brought nothing new"
      hint_remote_ahead
      return 0
    fi
  fi
  if ! git_at cat-file -e "$DEPLOYED_REV^{commit}" 2>/dev/null; then
    CHANGED="backend frontend landing admin"
    warn "$(git_at rev-parse --short "$DEPLOYED_REV" 2>/dev/null || echo "$DEPLOYED_REV") is not in this history (rewritten branch?), rebuilding both sides"
    return 0
  fi
  files="$(git_at diff --name-only "${DEPLOYED_REV}..HEAD" 2>/dev/null)"
  if [[ -z "$files" ]]; then
    CHANGED="backend frontend landing admin"
    info "no file diff between the deployed revision and HEAD, rebuilding both sides to be safe"
    return 0
  fi
  [[ "$FORCE_DEPS" == "1" ]] && files="$files
package-lock.json"
  if [[ -n "${CHANGED_OVERRIDE:-}" ]]; then files="$CHANGED_OVERRIDE"; fi

  [[ -z "$files" ]] && { CHANGED="backend frontend landing admin"; info "no diff available, rebuilding all sides"; return 0; }
  local parts=()
  echo "$files" | grep -q '^backend/'            && parts+=("backend")
  echo "$files" | grep -q '^frontend-app/'       && parts+=("frontend")
  echo "$files" | grep -q '^landing/'            && parts+=("landing")
  echo "$files" | grep -q '^admin/'              && parts+=("admin")
  echo "$files" | grep -Eq 'package-lock.json|package.json' && parts+=("deps")
  echo "$files" | grep -q 'prisma/schema.prisma' && parts+=("schema")
  echo "$files" | grep -Eq '^scripts/setup-server.sh|^docs/' && parts+=("docs")
  [[ ${#parts[@]} -eq 0 ]] && parts=("none")
  CHANGED="${parts[*]}"
  info "changed areas: $CHANGED"
  # do not rebuild a side the diff did not touch
  if [[ "$CHANGED" != *backend* && "$CHANGED" != *schema* && "$CHANGED" != *deps* ]]; then
    [[ "$DO_BACKEND" == "1" ]] && skip "no backend files in this range - the NestJS build is skipped"
    DO_BACKEND=0
  fi
  if [[ "$CHANGED" != *frontend* && "$CHANGED" != *deps* ]]; then
    [[ "$DO_FRONTEND" == "1" ]] && skip "no frontend files in this range - the PWA build is skipped"
    DO_FRONTEND=0
  fi
  if [[ "$CHANGED" != *landing* ]]; then
    [[ "$DO_LANDING" == "1" ]] && skip "no landing files in this range - the landing page stays as it is"
    DO_LANDING=0
  fi
  if [[ "$CHANGED" != *admin* ]]; then
    [[ "$DO_ADMIN" == "1" ]] && skip "no admin files in this range - the admin panel stays as it is"
    DO_ADMIN=0
  fi
  if ! ask "apply these to the running server" y; then
    info "cancelled; nothing was rebuilt"
    exit 0
  fi
}

# ------------------------------------------------------------------
# 2) memory: a small box needs a heap ceiling for tsc and vite
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
    warn "tight on memory: node heap capped at ${heap} MB; add swap if a build gets killed"
  fi
}

# ------------------------------------------------------------------
# 3) the two builds
# ------------------------------------------------------------------

stamp() { date '+%Y%m%d-%H%M%S'; }

sync_source() {  # refresh the sources in the install; node_modules and dist stay
  log "syncing the sources into $INSTALL_DIR"
  [[ -d "$INSTALL_DIR" ]] || { err "$INSTALL_DIR does not exist - run scripts/setup-server.sh first"; exit 1; }
  [[ -d "$INSTALL_DIR/backend" || -d "$INSTALL_DIR/frontend-app" ]] || { err "no backend/ or frontend-app/ in $INSTALL_DIR"; exit 1; }
  if [[ "$(realpath "$SRC_DIR")" == "$(realpath "$INSTALL_DIR")" ]]; then
    skip "source and install are the same directory; no source copy needed"
    return 0
  fi
  local src="$SRC_DIR/backend" be="$INSTALL_DIR/backend" f
  if [[ "$DO_BACKEND" == "1" ]]; then
    if [[ "$CHECK" == "1" ]]; then
      echo "      would replace $be/src and $be/prisma with the checkout, then the config files"
    else
      # src/prisma are replaced completely, so a file deleted in the repo cannot linger
      # and break the next tsc run; the rest is copied over
      rm -rf "$be/src" "$be/prisma"
      cp -a "$src/src" "$be/src" || exit 1
      [[ -d "$src/prisma" ]] && cp -a "$src/prisma" "$be/prisma"
      for f in package.json package-lock.json tsconfig.json tsconfig.build.json nest-cli.json .env.example documents; do
        [[ -e "$src/$f" ]] && cp -a "$src/$f" "$be/"
      done
      ok "backend sources refreshed"
    fi
  fi
  if [[ "$DO_FRONTEND" == "1" ]]; then skip "the PWA is built in a temporary copy, so the live dist is untouched until the build succeeds"; fi
}

needs_deps() { [[ "$FORCE_DEPS" == "1" ]] || [[ " $CHANGED " == *" deps "* ]]; }

npm_install_in() {  # $1 = dir
  local dir="$1"
  if [[ ! -d "$dir" ]]; then return 0; fi
  if needs_deps || [[ ! -d "$dir/node_modules" ]]; then
    if [[ -f "$dir/package-lock.json" ]]; then
      run "npm ci" bash -c "cd '$dir' && npm ci --no-audit --no-fund --no-progress --loglevel=error" ||
        run "npm install" bash -c "cd '$dir' && npm install --no-audit --no-fund --no-progress --loglevel=error"
    else
      run "npm install" bash -c "cd '$dir' && npm install --no-audit --no-fund --no-progress --loglevel=error"
    fi
  else
    skip "dependencies unchanged (use --force-deps to reinstall)"
  fi
}

update_backend() {
  [[ "$DO_BACKEND" == "1" ]] || return 0
  log "backend"
  local be="$INSTALL_DIR/backend"
  npm_install_in "$be" || exit 1
  if [[ " $CHANGED " == *" schema "* ]] || [[ ! -d "$be/node_modules/.prisma" ]]; then
    run "prisma generate" bash -c "cd '$be' && npx prisma generate" || exit 1
  else
    skip "prisma schema unchanged"
  fi
  if [[ " $CHANGED " == *" schema "* ]]; then
    run "prisma db push" bash -c "cd '$be' && npx prisma db push --skip-generate" \
      || { err "prisma db push failed; update aborted"; exit 1; }
  fi
  local backup="$INSTALL_DIR/backend.dist.$(stamp).tgz"
  if [[ -d "$be/dist" ]]; then
    run "backup dist" tar -czf "$backup" -C "$be" dist
    [[ -f "$backup" ]] && info "previous build kept at $(basename "$backup")"
    if [[ "$CHECK" != "1" ]]; then
      ls -1t "$INSTALL_DIR"/backend.dist.*.tgz 2>/dev/null | tail -n +4 | xargs -r rm -f
    fi
  else
    backup=""
    skip "no dist yet, nothing to roll back to"
  fi

  if ! run "build backend" bash -c "cd '$be' && npm run build"; then
    err "backend build failed"
    if [[ -n "$backup" && -f "$backup" ]]; then
      warn "restoring the previous dist"
      run "rollback" bash -c "rm -rf '$be/dist' && tar -xzf '$backup' -C '$be'"
      restart_service || true
    fi
    exit 1
  fi
  [[ "$CHECK" == "1" ]] && skip "the backend build is not run in check mode" || ok "backend built ($(date '+%H:%M:%S'))"
}

update_frontend() {
  [[ "$DO_FRONTEND" == "1" ]] || return 0
  log "PWA frontend"
  local fe="$INSTALL_DIR/frontend-app"
  local tmp="$INSTALL_DIR/.frontend-app.new"
  run "clean tmp" rm -rf "$tmp"
  run "make tmp" mkdir -p "$tmp"
  # tar instead of cp so node_modules and the live dist are left out of the copy,
  # then the installed node_modules is reused through a symlink
  run "copy sources" bash -c "tar -C '$SRC_DIR/frontend-app' --exclude=./node_modules --exclude=./dist -cf - . | tar -C '$tmp' -xf -"
  run "env file" bash -c "[[ -f '$fe/.env' ]] && cp '$fe/.env' '$tmp/.env' || printf 'VITE_API_URL=\"/api\"\n' > '$tmp/.env'"
  npm_install_in "$tmp" || exit 1
  if ! run "vite build" bash -c "cd '$tmp' && npm run build"; then
    err "PWA build failed - the served site is untouched"
    run "clean tmp" rm -rf "$tmp"
    exit 1
  fi
  if [[ "$CHECK" == "1" ]]; then skip "dist would be swapped in and the old one kept for a moment"; return 0; fi
  local prev="$INSTALL_DIR/frontend-app/dist.prev.$(stamp)"
  mv "$fe/dist" "$prev" 2>/dev/null && info "previous dist kept at $(basename "$prev")"
  mv "$tmp/dist" "$fe/dist" || { mv "$prev" "$fe/dist"; exit 1; }
  rm -rf "$tmp" "$prev"
  ok "PWA rebuilt and swapped in ($(find "$fe/dist" -maxdepth 1 -type f | wc -l) files at the root of dist)"
}

update_landing() {
  [[ "$DO_LANDING" == "1" ]] || return 0
  log "landing page"
  local src="$SRC_DIR/landing" dst="$INSTALL_DIR/landing"
  [[ -d "$src" ]] || { warn "landing/ is missing in the checkout; the served page stays as it is"; return 0; }
  local tmp="$INSTALL_DIR/.landing.new"
  run "clean tmp" rm -rf "$tmp"
  run "copy landing" bash -c "mkdir -p '$tmp' && tar -C '$src' -cf - . | tar -C '$tmp' -xf -"
  if [[ "$CHECK" == "1" ]]; then skip "landing would be swapped in"; return 0; fi
  local prev="$INSTALL_DIR/landing.prev.$(stamp)"
  mv "$dst" "$prev" 2>/dev/null || true
  mv "$tmp" "$dst" || { [[ ! -d "$prev" ]] || mv "$prev" "$dst"; exit 1; }
  rm -rf "$prev"
  ok "landing page updated ($(find "$dst" -maxdepth 1 -type f | wc -l) files at the root)"
}

repair_admin_environment() {
  # Node does not load .env automatically; supply it through systemd.
  local dropin="/etc/systemd/system/$ADMIN_SVC.service.d"
  run "admin environment directory" mkdir -p "$dropin" || return 1
  run "admin environment" bash -c 'printf "[Service]\nEnvironmentFile=%s/backend/.env\n" "$1" > "$2/environment.conf"' _ "$INSTALL_DIR" "$dropin" || return 1
  run "reload units" systemctl daemon-reload
}

update_admin() {
  [[ "$DO_ADMIN" == "1" ]] || return 0
  log "admin panel"
  local src="$SRC_DIR/admin" dst="$INSTALL_DIR/admin"
  [[ -d "$src" ]] || { warn "admin/ is missing in the checkout; the served panel stays as it is"; return 0; }
  # the static UI is swapped atomically, like the landing page
  local tmp="$INSTALL_DIR/.admin.new"
  run "clean tmp" rm -rf "$tmp"
  run "copy admin" bash -c "mkdir -p '$tmp' && tar -C '$src' -cf - . | tar -C '$tmp' -xf -"
  if [[ "$CHECK" == "1" ]]; then skip "admin panel would be swapped in and the service restarted"; return 0; fi
  local prev="$INSTALL_DIR/admin.prev.$(stamp)"
  mv "$dst" "$prev" 2>/dev/null || true
  mv "$tmp" "$dst" || { [[ ! -d "$prev" ]] || mv "$prev" "$dst"; exit 1; }
  rm -rf "$prev"
  ok "admin panel static files updated"
  # the node script runs from backend/admin so the backend Prisma client is reused
  if have systemctl && [[ "$(systemctl show -p LoadState --value "$ADMIN_SVC" 2>/dev/null)" == "loaded" ]]; then
    run "install script" bash -c "mkdir -p '$INSTALL_DIR/backend/admin' && cp '$dst/server.js' '$INSTALL_DIR/backend/admin/server.js'"
    repair_admin_environment || exit 1
    [[ "$DO_RESTART" == "1" ]] || { warn "admin restart deferred"; return 0; }
    run "restart $ADMIN_SVC" systemctl restart "$ADMIN_SVC" || exit 1
    sleep 1
    if systemctl is-active --quiet "$ADMIN_SVC"; then
      ok "admin service restarted on 127.0.0.1:$ADMIN_PORT"
    else
      err "$ADMIN_SVC did not come back; last log lines:"
      journalctl -u "$ADMIN_SVC" -n 25 --no-pager 2>/dev/null | sed 's/^/        /'
      exit 1
    fi
  else
    err "$ADMIN_SVC unit not found - provision the admin service before updating it"
    exit 1
  fi
}

# ------------------------------------------------------------------
# 4) service, nginx, verification
# ------------------------------------------------------------------

port_listeners() {  # pids with a LISTEN socket on BACKEND_PORT, one per line
  ss -ltnp 2>/dev/null | awk -v port=":$BACKEND_PORT" '$4 ~ port"$" {print}' \
    | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u
}

service_pid() {  # MainPID of the systemd unit, or 0 when it has none
  local out="MainPID=0" pid="0"
  if have systemctl; then
    out="$(systemctl show -p MainPID "$SETUP_SVC" 2>/dev/null)" || out="MainPID=0"
    pid="${out#MainPID=}"
  fi
  [[ "$pid" =~ ^[0-9]+$ ]] || pid="0"
  printf '%s' "$pid"
}

stop_pm2_vizitik() {
  # a pm2-held copy of the backend restarts itself when killed, so killing the
  # port listener is not enough: it has to be deleted from pm2. only vizitik
  # command lines are touched, every other pm2 app is left alone.
  have pm2 || return 0
  local list ids=""
  list="$(pm2 jlist 2>/dev/null || echo '[]')"
  [[ -z "${list//[[:space:]]/}" || "$list" == "[]" ]] && { skip "pm2 has no processes"; return 0; }
  if have jq; then
    ids="$(printf '%s' "$list" | jq -r '.[] | select(((.name // "") | tostring | test("vizitik|dist/main")) or ((((.pm2_env // {}) | (.pm_exec_path // "")) | tostring) | test("vizitik"))) | .pm_id' 2>/dev/null)"
  elif have python3; then
    ids="$(printf '%s' "$list" | python3 -c 'import json,sys,re
try: apps=json.load(sys.stdin)
except Exception: apps=[]
for a in (apps if isinstance(apps,list) else []):
  env=a.get("pm2_env") or {}
  if re.search(r"vizitik|dist/main",str(a.get("name",""))+" "+str(env.get("pm_exec_path","")),re.I): print(a.get("pm_id"))' 2>/dev/null)"
  else
    warn "pm2 holds processes but neither jq nor python3 is here to inspect them; the port listeners are still stopped below"
    return 0
  fi
  if [[ -z "${ids//[[:space:]]/}" ]]; then skip "no vizitik app inside pm2"; return 0; fi
  info "pm2 holds vizitik processes (ids: $(echo "$ids" | tr '\n' ' '))- they are deleted so they cannot resurrect the old build"
  if [[ "$CHECK" == "1" ]]; then echo "      would run: pm2 delete <those ids> && pm2 save"; return 0; fi
  # shellcheck disable=SC2086
  if pm2 delete $ids >/dev/null 2>&1; then
    pm2 save >/dev/null 2>&1 || true
    ok "vizitik apps deleted from pm2"
  else
    warn "pm2 delete failed; the port listeners are still stopped below"
  fi
}

free_backend_port() {
  # Whatever listens on the API port that is NOT the systemd service is a
  # leftover from a manual run and would keep serving the OLD build after the
  # restart - update.sh used to report success in that state (the probe got an
  # answer from the old process), and only a reboot cleared it.
  have ss || { warn "ss not found; leftover listeners on port $BACKEND_PORT cannot be detected"; return 0; }
  stop_pm2_vizitik
  local main pids p strays=""
  main="$(service_pid)"
  pids="$(port_listeners)"
  if [[ -z "$pids" ]]; then skip "nothing listens on port $BACKEND_PORT yet"; return 0; fi
  for p in $pids; do
    [[ "$p" == "$main" ]] || strays+="$p "
  done
  if [[ -z "${strays// /}" ]]; then skip "port $BACKEND_PORT is held by the service only"; return 0; fi
  warn "port $BACKEND_PORT is also held by leftover processes (NOT $SETUP_SVC) - they serve the old build and are stopped:"
  for p in $strays; do
    ps -o pid=,args= -p "$p" 2>/dev/null | sed 's/^/        /' || echo "        $p (already gone)"
  done
  if [[ "$CHECK" == "1" ]]; then echo "      would run: kill ${strays% } (then SIGKILL if needed)"; return 0; fi
  # shellcheck disable=SC2086
  kill $strays 2>/dev/null || true
  sleep 2
  local left=""
  for p in $strays; do kill -0 "$p" 2>/dev/null && left+="$p "; done
  if [[ -n "${left// /}" ]]; then
    warn "still alive after SIGTERM: ${left% } - sending SIGKILL"
    # shellcheck disable=SC2086
    kill -9 $left 2>/dev/null || true
    sleep 1
  fi
  ok "leftover listeners on port $BACKEND_PORT stopped"
}

wait_for_port() {  # $1 = seconds; 0 once something listens on BACKEND_PORT
  have ss || return 0
  local tries="${1:-30}" i
  for (( i=0; i<tries; i++ )); do
    if port_listeners | grep -q .; then return 0; fi
    sleep 1
  done
  return 1
}

check_port_owner() {
  # the promise update.sh makes: after the restart, the ONLY answer on the API
  # port comes from the fresh service process. anything else means the old build
  # is still live, and the revision must NOT be recorded as deployed.
  [[ "$CHECK" == "1" ]] && { skip "no port-owner check in check mode"; return 0; }
  have systemctl || return 0
  have ss || { warn "ss not found; cannot confirm which process serves port $BACKEND_PORT"; return 0; }
  local main pids p foreign=""
  main="$(service_pid)"
  if [[ -z "$main" || "$main" == "0" ]]; then
    err "$SETUP_SVC reports active but has no MainPID - last log lines:"
    journalctl -u "$SETUP_SVC" -n 25 --no-pager 2>/dev/null | sed 's/^/        /'
    return 1
  fi
  pids="$(port_listeners)"
  if [[ -z "$pids" ]]; then
    err "nothing listens on port $BACKEND_PORT although $SETUP_SVC (pid $main) looks active - last log lines:"
    journalctl -u "$SETUP_SVC" -n 25 --no-pager 2>/dev/null | sed 's/^/        /'
    return 1
  fi
  for p in $pids; do
    [[ "$p" == "$main" ]] || foreign+="$p "
  done
  if [[ -n "${foreign// /}" ]]; then
    err "port $BACKEND_PORT is served by processes that are NOT $SETUP_SVC (pid $main) - the api would keep answering with the OLD build:"
    for p in $foreign; do
      ps -o pid=,args= -p "$p" 2>/dev/null | sed 's/^/        /'
    done
    err "this is the 'had to reboot' trap: stop them and rerun (kill ${foreign% } / pm2 delete <id> / fuser -k ${BACKEND_PORT}/tcp)"
    err "if one of them keeps coming back, a pm2 daemon of another user holds it: ps -eo user=,args= | grep -i pm2"
    return 1
  fi
  ok "port $BACKEND_PORT is served by the fresh $SETUP_SVC (pid $main)"
  return 0
}

restart_service() {
  [[ "$DO_RESTART" == "1" ]] || { skip "restart skipped (--no-restart)"; return 0; }
  log "service"
  if [[ "$RESTART_ONLY" == "1" && "$(systemctl show -p LoadState --value "$ADMIN_SVC" 2>/dev/null)" == "loaded" ]]; then
    repair_admin_environment || return 1
    run "restart admin" systemctl restart "$ADMIN_SVC" || return 1
  fi
  if have systemctl; then
    free_backend_port
    run "restart" systemctl restart "$SETUP_SVC" || { err "could not restart $SETUP_SVC"; return 1; }
    sleep 3
    local state; state="$(systemctl is-active "$SETUP_SVC" 2>/dev/null)"
    if [[ "$state" == "active" ]]; then ok "$SETUP_SVC is active"
    else
      err "$SETUP_SVC is '$state'"
      [[ "$CHECK" == "1" ]] || journalctl -u "$SETUP_SVC" -n 25 --no-pager 2>/dev/null | sed 's/^/        /'
      return 1
    fi
    if [[ "$CHECK" == "1" ]]; then
      skip "no port wait in check mode"
    elif wait_for_port 30; then
      ok "the api listens on port $BACKEND_PORT"
    else
      err "port $BACKEND_PORT stays silent 30s after the restart - last log lines:"
      journalctl -u "$SETUP_SVC" -n 25 --no-pager 2>/dev/null | sed 's/^/        /'
      return 1
    fi
    check_port_owner || return 1
  else
    warn "no systemctl here; restart the process yourself (pm2 restart all / node dist/main.js)"
  fi
  if have nginx && [[ "$DO_FRONTEND" == "1" || "$DO_LANDING" == "1" || "$DO_ADMIN" == "1" || "$RESTART_ONLY" == "1" ]]; then
    if run "nginx -t" nginx -t >/dev/null 2>&1; then
      run "reload nginx" systemctl reload nginx 2>/dev/null && ok "nginx reloaded"
    else
      err "nginx -t failed; the old configuration is still in memory"
      [[ "$CHECK" == "1" ]] || nginx -t 2>&1 | sed 's/^/        /'
      return 1
    fi
  fi
}

verify() {
  log "verification"
  [[ "$CHECK" == "1" ]] && { skip "no live probes or revision writes in check mode"; return 0; }
  local code
  if have curl; then
    code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://127.0.0.1:${BACKEND_PORT}/" 2>/dev/null)"
    if [[ "$code" =~ ^[0-9]{3}$ && "$code" != "000" ]]; then
      ok "the api answers on 127.0.0.1:${BACKEND_PORT} (http $code; a 404 here is normal, it has no root route)"
      local owner; owner="$(port_listeners 2>/dev/null | tr '\n' ' ')"
      [[ -n "${owner// /}" ]] && info "port $BACKEND_PORT is served by pid ${owner% } (service pid $(service_pid))"
    elif [[ "$CHECK" == "1" ]]; then
      skip "no probe in check mode"
    else
      err "the api did not answer on 127.0.0.1:${BACKEND_PORT} - last log lines:"
      journalctl -u "$SETUP_SVC" -n 25 --no-pager 2>/dev/null | sed 's/^/        /'
      return 1
    fi
    local hosts
    hosts="$(awk '/server_name/{gsub(/;/,""); for(i=2;i<=NF;i++) print $i}' /etc/nginx/sites-enabled/vizitik /etc/nginx/sites-enabled/vizitik.conf 2>/dev/null | sort -u | head -4)"
    [[ -n "${DOMAIN_PROBE:-}" ]] && hosts="$DOMAIN_PROBE"
    [[ -z "${hosts// /}" ]] && hosts="127.0.0.1"
    for host in $hosts; do
      code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H "Host: $host" http://127.0.0.1/ 2>/dev/null)"
      if [[ "$code" =~ ^(200|301|302|304)$ ]]; then ok "nginx serves $host (http $code)"
      elif [[ "$CHECK" == "1" ]]; then skip "no probe in check mode"
      else warn "http://127.0.0.1/ answered '$code' for Host: $host"; fi
    done
    if [[ "$(systemctl show -p LoadState --value "$ADMIN_SVC" 2>/dev/null)" == "loaded" ]]; then
      code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://127.0.0.1:${ADMIN_PORT}/api/health" 2>/dev/null)"
      if [[ "$code" == "200" ]]; then ok "the admin panel answers on 127.0.0.1:${ADMIN_PORT}"
      elif [[ "$CHECK" == "1" ]]; then skip "no admin probe in check mode"
      else err "the admin panel did not answer on 127.0.0.1:${ADMIN_PORT} (journalctl -u $ADMIN_SVC)"; return 1; fi
    fi
  else
    skip "curl not found, skipping the probes"
  fi
  if [[ "$PARTIAL_UPDATE" == "0" && "$DO_RESTART" == "1" && "$RESTART_ONLY" == "0" ]] && have git; then
    run "record revision" bash -c "git -C '$SRC_DIR' rev-parse HEAD > '$(REVISION_FILE)' 2>/dev/null"
  fi
}

main() {
  if [[ "$CHECK" == "1" ]]; then
    echo -e "\033[1;33m  check mode: nothing on this server will be changed\033[0m"
  elif [[ "$(id -u)" -ne 0 ]]; then
    err "run it as root:  sudo bash scripts/update.sh"
    exit 1
  fi
  log "update.sh - $(hostname 2>/dev/null || echo server), $(date '+%Y-%m-%d %H:%M')"
  update_checkout
  classify_changes
  if [[ "$RESTART_ONLY" == "1" ]]; then
    restart_service || exit 1
    verify; exit $?
  fi
  if [[ "$CHANGED" == "none" && "$FORCE_DEPS" == "0" && "$REVISION" == "" ]]; then
    log "nothing relevant changed"
    ok "the server already runs $(git_at rev-parse --short HEAD 2>/dev/null)"
    exit 0
  fi
  memory_guard
  sync_source
  update_backend
  update_frontend
  update_landing
  update_admin
  restart_service || exit 1
  verify || exit 1
  log "done"
  echo "  in the browser, hard reload once (Ctrl+Shift+R) so the service worker picks up the new build"
}

main "$@"
