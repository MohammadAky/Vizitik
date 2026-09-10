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
SETUP_SVC="${SETUP_SVC:-vizitik-backend}"
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

CHECK=0; YES=0; DO_BACKEND=1; DO_FRONTEND=1; DO_PULL=1; RESTART_ONLY=0; FORCE_DEPS=0; DO_RESTART=1; FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check|--dry-run) CHECK=1 ;;
    --backend-only)    DO_FRONTEND=0 ;;
    --frontend-only)   DO_BACKEND=0 ;;
    --restart-only)    RESTART_ONLY=1; DO_PULL=0; DO_BACKEND=0; DO_FRONTEND=0 ;;
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

classify_changes() {
  CHANGED=""
  local files=""
  # the real question is the distance between HEAD and what is deployed, so a
  # "git pull" done by hand (or the very first update.sh run) still rebuilds
  if [[ "$FORCE" == "1" ]]; then
    CHANGED="backend frontend deps schema"
    info "--force: rebuilding both sides from HEAD ($(git_at rev-parse --short HEAD 2>/dev/null))"
    return 0
  fi
  if [[ -z "$DEPLOYED_REV" ]]; then
    CHANGED="backend frontend"
    warn "$(REVISION_FILE) is missing - this install was not produced by update.sh, rebuilding both sides"
    return 0
  fi
  if [[ "$DEPLOYED_REV" == "$(git_at rev-parse HEAD 2>/dev/null)" ]]; then
    if [[ "$DO_PULL" == "1" && "$PREV" == "$NOW" ]]; then
      CHANGED="none"
      info "the server already runs $(git_at rev-parse --short HEAD 2>/dev/null) and the pull brought nothing new"
      return 0
    fi
  fi
  if ! git_at cat-file -e "$DEPLOYED_REV^{commit}" 2>/dev/null; then
    CHANGED="backend frontend"
    warn "$(git_at rev-parse --short "$DEPLOYED_REV" 2>/dev/null || echo "$DEPLOYED_REV") is not in this history (rewritten branch?), rebuilding both sides"
    return 0
  fi
  files="$(git_at diff --name-only "${DEPLOYED_REV}..HEAD" 2>/dev/null)"
  if [[ -z "$files" ]]; then
    CHANGED="backend frontend"
    info "no file diff between the deployed revision and HEAD, rebuilding both sides to be safe"
    return 0
  fi
  if [[ "$DO_PULL" == "1" && -n "$PREV" && -n "$NOW" ]]; then
    if [[ "$PREV" == "$NOW" ]]; then
      if [[ "$FORCE_DEPS" == "1" || -n "$REVISION" ]]; then
        files="$(git_at show --name-only --format= HEAD 2>/dev/null)"
      else
        CHANGED="none"
        info "the checkout did not move (still $(git_at rev-parse --short HEAD 2>/dev/null))"
        return 0
      fi
    else
      files="$(git_at diff --name-only "$PREV..$NOW" 2>/dev/null)"
    fi
  else
    # nothing was fetched: use the last commit as the reference
    files="$(git_at diff --name-only HEAD~1..HEAD 2>/dev/null || true)"
    [[ -z "$files" ]] && files="$(git_at show --name-only --format= HEAD 2>/dev/null || true)"
  fi
  [[ "$FORCE_DEPS" == "1" ]] && files="$files
package-lock.json"
  if [[ -n "${CHANGED_OVERRIDE:-}" ]]; then files="$CHANGED_OVERRIDE"; fi

  [[ -z "$files" ]] && { CHANGED="backend frontend"; info "no diff available, rebuilding both sides"; return 0; }
  local parts=()
  echo "$files" | grep -q '^backend/'            && parts+=("backend")
  echo "$files" | grep -q '^frontend-app/'       && parts+=("frontend")
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
  local src="$SRC_DIR/backend" be="$INSTALL_DIR/backend" f
  if [[ "$DO_BACKEND" == "1" ]]; then
    if [[ "$CHECK" == "1" ]]; then
      echo "      would replace $be/src and $be/prisma with the checkout, then the config files"
    else
      # src/prisma are replaced completely, so a file deleted in the repo cannot linger
      # and break the next tsc run; the rest is copied over
      rm -rf "$be/src" "$be/prisma"
      cp -a "$src/src" "$be/src"
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
  npm_install_in "$be"
  if [[ " $CHANGED " == *" schema "* ]] || [[ ! -d "$be/node_modules/.prisma" ]]; then
    run "prisma generate" bash -c "cd '$be' && npx prisma generate"
  else
    skip "prisma schema unchanged"
  fi
  if [[ " $CHANGED " == *" schema "* ]]; then
    run "prisma db push" bash -c "cd '$be' && npx prisma db push --skip-generate" \
      || warn "prisma db push failed - check the tables by hand before trusting the new build"
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
  npm_install_in "$fe"
  local tmp="$INSTALL_DIR/.frontend-app.new"
  run "clean tmp" rm -rf "$tmp"
  run "make tmp" mkdir -p "$tmp"
  # tar instead of cp so node_modules and the live dist are left out of the copy,
  # then the installed node_modules is reused through a symlink
  run "copy sources" bash -c "tar -C '$SRC_DIR/frontend-app' --exclude=./node_modules --exclude=./dist -cf - . | tar -C '$tmp' -xf - && ln -s '$fe/node_modules' '$tmp/node_modules'"
  run "env file" bash -c "[[ -f '$fe/.env' ]] && cp '$fe/.env' '$tmp/.env' || printf 'VITE_API_URL=\"/api\"\n' > '$tmp/.env'"
  if ! run "vite build" bash -c "cd '$tmp' && npm run build"; then
    err "PWA build failed - the served site is untouched"
    run "clean tmp" rm -rf "$tmp"
    exit 1
  fi
  if [[ "$CHECK" == "1" ]]; then skip "dist would be swapped in and the old one kept for a moment"; return 0; fi
  local prev="$INSTALL_DIR/frontend-app/dist.prev.$(stamp)"
  mv "$fe/dist" "$prev" 2>/dev/null && info "previous dist kept at $(basename "$prev")"
  mv "$tmp/dist" "$fe/dist"
  rm -rf "$tmp" "$prev"
  ok "PWA rebuilt and swapped in ($(find "$fe/dist" -maxdepth 1 -type f | wc -l) files at the root of dist)"
}

# ------------------------------------------------------------------
# 4) service, nginx, verification
# ------------------------------------------------------------------

restart_service() {
  [[ "$DO_RESTART" == "1" ]] || { skip "restart skipped (--no-restart)"; return 0; }
  log "service"
  if have systemctl; then
    run "restart" systemctl restart "$SETUP_SVC" || { err "could not restart $SETUP_SVC"; return 1; }
    sleep 3
    local state; state="$(systemctl is-active "$SETUP_SVC" 2>/dev/null)"
    if [[ "$state" == "active" ]]; then ok "$SETUP_SVC is active"
    else
      err "$SETUP_SVC is '$state'"
      [[ "$CHECK" == "1" ]] || journalctl -u "$SETUP_SVC" -n 25 --no-pager 2>/dev/null | sed 's/^/        /'
      return 1
    fi
  else
    warn "no systemctl here; restart the process yourself (pm2 restart all / node dist/main.js)"
  fi
  if have nginx && [[ "$DO_FRONTEND" == "1" || "$RESTART_ONLY" == "1" ]]; then
    if run "nginx -t" nginx -t >/dev/null 2>&1; then
      run "reload nginx" systemctl reload nginx 2>/dev/null && ok "nginx reloaded"
    else
      warn "nginx -t failed; the old configuration is still in memory"
      [[ "$CHECK" == "1" ]] || nginx -t 2>&1 | sed 's/^/        /'
    fi
  fi
}

verify() {
  log "verification"
  local code
  if have curl; then
    code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://127.0.0.1:${BACKEND_PORT}/" 2>/dev/null)"
    if [[ "$code" =~ ^[0-9]{3}$ && "$code" != "000" ]]; then
      ok "the api answers on 127.0.0.1:${BACKEND_PORT} (http $code; a 404 here is normal, it has no root route)"
    elif [[ "$CHECK" == "1" ]]; then
      skip "no probe in check mode"
    else
      err "the api did not answer on 127.0.0.1:${BACKEND_PORT} - last log lines:"
      journalctl -u "$SETUP_SVC" -n 25 --no-pager 2>/dev/null | sed 's/^/        /'
      return 1
    fi
    local host="${DOMAIN_PROBE:-$(awk '/server_name/{print $2; exit}' /etc/nginx/sites-enabled/vizitik /etc/nginx/sites-enabled/vizitik.conf 2>/dev/null)}"
    [[ -z "$host" ]] && host="127.0.0.1"
    code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H "Host: $host" http://127.0.0.1/ 2>/dev/null)"
    if [[ "$code" =~ ^(200|301|302|304)$ ]]; then ok "nginx serves the PWA for $host (http $code)"
    elif [[ "$CHECK" == "1" ]]; then skip "no probe in check mode"
    else warn "http://127.0.0.1/ answered '$code' for Host: $host"; fi
  else
    skip "curl not found, skipping the probes"
  fi
  if [[ -n "${GIT_REMOTE:-}" ]] && have git; then
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
    restart_service; verify; exit $?
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
  restart_service || exit 1
  verify || exit 1
  log "done"
  echo "  in the browser, hard reload once (Ctrl+Shift+R) so the service worker picks up the new build"
}

main "$@"
