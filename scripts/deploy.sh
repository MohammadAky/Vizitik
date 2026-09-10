#!/usr/bin/env bash
#
# Run this on the server instead of calling setup-server.sh directly:
#
#   sudo bash scripts/deploy.sh
#
# A second deploy on the same box is where most trouble comes from: a pm2 backend
# still holding the API port, an Apache from the hosting panel answering on 80, a
# half finished npm install, a certbot from the previous attempt that never exited.
# This script stops all of that first, shows you what it found, then hands over to
# scripts/setup-server.sh with the same arguments.
#
# Nothing here deletes data. The database, backend/.env, the Nginx log files and the
# issued certificates are never touched. --full-reset also removes the installed copy
# in /opt/vizitik and the site file in /etc/nginx/sites-enabled (both are rebuilt).
#
# options:
#   --dry-run          show what would be stopped or disabled, change nothing, no root
#   --only-clean       stop everything and exit without deploying
#   --skip-pull        do not run git pull, use the checkout as it is
#   --require-clean    abort if the checkout has uncommitted changes
#   --full-reset       remove the installed copy and the nginx site before deploying
#   -y, --yes          no questions, and forward --yes to setup-server.sh
#   -h, --help         this text
#
# environment overrides (also read by setup-server.sh):
#   INSTALL_DIR BACKEND_PORT DOMAIN SETUP_SCRIPT
#
set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/vizitik}"
BACKEND_PORT="${BACKEND_PORT:-3000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${SRC_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SETUP_SCRIPT="${SETUP_SCRIPT:-$SCRIPT_DIR/setup-server.sh}"
SETUP_SVC="vizitik-backend"
SWAP_NEEDED_MB=2048

# services that fight for port 80 (hosting panels ship these next to nginx)
CONFLICT_SERVICES=(apache2 httpd lighttpd litespeed caddy nginx-passenger)
# what may be left behind by an earlier run. "scoped" patterns are only stopped
# when the command line also mentions vizitik, so another app on this box is safe.
STRAY_SCOPED=( "dist/main.js" "node_modules/.bin/vite" "nodemon" "ts-node" )
STRAY_ANY=( "scripts/dev-preview.mjs" "pwa-parity-check.py" "certbot" )
STRAY_PORTS=( "${BACKEND_PORT}" "8000" )   # a "php -S" dev server on these ports

log()  { echo -e "\n\033[1;36m> $*\033[0m"; }
ok()   { echo -e "\033[1;32m  OK  $*\033[0m"; }
info() { echo -e "\033[0;36m  ..  $*\033[0m"; }
warn() { echo -e "\033[1;33m  WARN $*\033[0m"; }
err()  { echo -e "\033[1;31m  FAIL $*\033[0m" >&2; }
skip() { echo -e "  --  $*"; }

YES=0; DRY=0; ONLY_CLEAN=0; SKIP_PULL=0; REQUIRE_CLEAN=0; FULL_RESET=0
FORWARD=()
usage() {
  cat <<TXT
usage: sudo bash scripts/deploy.sh [options]

  stops what an earlier run left behind (services, stray node/php/certbot
  processes, a panel web server on port 80), updates the checkout and then runs
  scripts/setup-server.sh with the remaining arguments.

  --dry-run          print what would be stopped or disabled, change nothing
  --only-clean       stop everything and exit without deploying
  --skip-pull        do not run git pull, use the checkout as it is
  --require-clean    abort if the checkout has uncommitted changes
  --full-reset       remove $INSTALL_DIR and the nginx site before deploying
  -y, --yes          no questions, and forward --yes to setup-server.sh
  -h, --help         this text

  every other argument is passed to setup-server.sh, e.g.
  sudo bash scripts/deploy.sh --yes --check
  sudo bash scripts/deploy.sh --only-clean

  environment: INSTALL_DIR BACKEND_PORT DOMAIN CF_API_TOKEN SETUP_SCRIPT
TXT
}

for a in "$@"; do
  case "$a" in
    --dry-run)    DRY=1 ;;
    --only-clean) ONLY_CLEAN=1 ;;
    --skip-pull)  SKIP_PULL=1 ;;
    --require-clean) REQUIRE_CLEAN=1 ;;
    --full-reset) FULL_RESET=1 ;;
    -y|--yes)     YES=1; FORWARD+=("$a") ;;
    -h|--help)    usage; exit 0 ;;
    *)            FORWARD+=("$a") ;;
  esac
done

have() { command -v "$1" >/dev/null 2>&1; }
is_tty() { [[ -t 0 ]]; }

ask_yes() {  # ask_yes <var name> <prompt> <default 1|0>; sets the var to 1 or 0
  local name="$1" prompt="$2" default="${3:-1}" ans=""
  if [[ "$YES" == "1" || "$DRY" == "1" ]] || ! is_tty; then
    printf -v "$name" '%s' "$default"; return 0
  fi
  read -r -p "  $prompt [Y/n]: " ans || ans=""
  case "${ans:-$default}" in
    [Nn]*|0) printf -v "$name" '%s' 0 ;;
    *)       printf -v "$name" '%s' 1 ;;
  esac
}

did() {  # did <text> - report a change, but say "would" during a dry run
  if [[ "$DRY" == "1" ]]; then info "$* (not in dry run)"; else ok "$*"; fi
}

doit() {  # doit <command...> - run it, or only print it in dry-run mode
  if [[ "$DRY" == "1" ]]; then
    echo "      would run: $*"
  else
    "$@"
  fi
}

root_check() {
  if [[ "$DRY" == "1" ]]; then
    info "dry run: no privileges needed, nothing will be changed"
    return 0
  fi
  if [[ "$(id -u)" -ne 0 ]]; then
    err "this must run as root:  sudo bash scripts/deploy.sh $*"
    exit 1
  fi
}

show_state() {
  log "server state"
  if [[ -r /etc/os-release ]]; then
    info "os:      $(. /etc/os-release; echo "${PRETTY_NAME:-$NAME}")"
  fi
  info "kernel:  $(uname -sr)"
  info "ram:     $(free -m | awk '/^Mem:/{printf "%s MB total, %s MB used, %s MB free", $2, $3, $4}')"
  info "swap:    $(free -m | awk '/^Swap:/{printf "%s MB", $2}')"
  info "disk /:  $(df -hP / | awk 'NR==2{printf "%s used of %s (%s free)", $3, $2, $4}')"
  info "cores:   $(nproc)"
  local total free_kb
  free_kb="$(df -Pk / 2>/dev/null | awk 'NR==2{print $4}')"
  if [[ -n "${free_kb:-}" ]] && (( free_kb / 1024 < SWAP_NEEDED_MB + 1024 )); then
    warn "only $(( free_kb / 1024 )) MB free on /: a swap file plus node_modules need about $(( SWAP_NEEDED_MB + 1024 )) MB"
    warn "  free some up first:  apt clean; journalctl --vacuum-size=100M; du -xh -d1 / | sort -h | tail"
  fi
  total="$(awk '/^MemTotal:/{r=int($2/1024)} /^SwapTotal:/{s=int($2/1024)} END{print r+s}' /proc/meminfo)"
  if [[ "${total:-0}" -lt "$SWAP_NEEDED_MB" ]]; then
    warn "only ${total} MB of ram+swap; npm and vite builds need about ${SWAP_NEEDED_MB} MB"
    info "setup-server.sh will create /swapfile for you (refuse with CREATE_SWAP=0)"
  fi
}

stop_previous_service() {
  log "previous vizitik service"
  if have systemctl && [[ "$(systemctl is-active "$SETUP_SVC" 2>/dev/null)" == "active" ]]; then
    info "stopping ${SETUP_SVC} so the api port is free during the build"
    doit systemctl stop "$SETUP_SVC"
    did "${SETUP_SVC} stopped (setup-server.sh installs and starts it again)"
  else
    skip "${SETUP_SVC} is not running"
  fi
  if have pm2; then
    local names
    names="$(pm2 jlist 2>/dev/null | tr -d '\n')"
    if [[ -n "${names:-}" && "$names" != "[]" ]]; then
      info "pm2 holds processes from an earlier manual deploy"
      ask_yes PM2_STOP "stop them (pm2 delete all)? ${names:0:120}" 1
      if [[ "${PM2_STOP:-1}" == "1" ]]; then
        doit pm2 delete all && did "pm2 processes removed"
      else
        warn "leaving pm2 alone; port ${BACKEND_PORT} may stay busy and the service will fail to start"
      fi
    else
      skip "pm2 has no processes"
    fi
  fi
}

kill_strays() {
  log "leftover processes"
  local rows
  rows="$(ps -eo pid=,args= 2>/dev/null)"
  local keep="" pat line pid
  while read -r pid line; do
    [[ -z "${pid:-}" || "$pid" == "$$" || "$pid" == "$PPID" ]] && continue
    local hit=0
    for pat in "${STRAY_ANY[@]}"; do
      [[ "$line" == *"$pat"* ]] && hit=1
    done
    if [[ "$hit" == "0" ]]; then
      for pat in "${STRAY_SCOPED[@]}"; do
        if [[ "$line" == *"$pat"* ]] && [[ "$line" == *izitik* ]]; then hit=1; fi
      done
    fi
    if [[ "$hit" == "0" ]]; then
      for pat in "${STRAY_PORTS[@]}"; do
        case "$line" in
          *"php -S "*":$pat "*|*"php -S "*":$pat") hit=1 ;;
          *"python3 -m http.server $pat "*|*"http.server $pat") hit=1 ;;
        esac
      done
    fi
    [[ "$hit" == "1" ]] && keep+="$pid "
  done <<< "$rows"

  if [[ -z "${keep// /}" ]]; then skip "nothing left from an earlier run"; return 0; fi
  echo "      processes an earlier run or a dev session left behind:"
  for pid in $keep; do
    echo "$rows" | awk -v p="$pid" '$1 == p {printf "          %s  %s\n", $1, substr($0, index($0,$2))}'
  done
  ask_yes KILL "  stop these processes?" 1
  if [[ "${KILL:-1}" != "1" ]]; then warn "left running on purpose; port 80 or ${BACKEND_PORT} may stay busy"; return 0; fi
  if [[ "$DRY" == "1" ]]; then echo "      would run: kill ${keep% }"; return 0; fi
  # shellcheck disable=SC2086
  kill $keep 2>/dev/null
  sleep 2
  local left=""
  for pid in $keep; do kill -0 "$pid" 2>/dev/null && left+="$pid "; done
  if [[ -n "${left// /}" ]]; then
    warn "still alive after SIGTERM: ${left% } - sending SIGKILL"
    # shellcheck disable=SC2086
    kill -9 $left 2>/dev/null
  fi
  ok "stopped"
}

disable_web_server_conflicts() {
  log "who owns port 80 and 443"
  local p line svc
  for p in 80 443 "$BACKEND_PORT"; do
    line="$(ss -ltnp 2>/dev/null | awk -v port=":$p" '$4 ~ port"$" || $4 ~ port" " {print}')"
    if [[ -z "$line" ]]; then skip "port $p is free"; continue; fi
    echo "      port $p: $(echo "$line" | head -1 | cut -c1-150)"
    if [[ "$p" == "$BACKEND_PORT" ]] && [[ "$line" != *izitik* ]]; then
      warn "the api port is held by something this script does not recognise as ours"
      warn "  stop it yourself if it is an old run:  fuser -k ${BACKEND_PORT}/tcp"
    fi
    for svc in "${CONFLICT_SERVICES[@]}"; do
      [[ "$svc" == "nginx" ]] && continue
      if ! have systemctl; then
        echo "$line" | grep -qi "$svc" && warn "${svc} is answering on port $p; disable it with: service $svc stop"
        continue
      fi
      if [[ "$(systemctl is-active "$svc" 2>/dev/null)" == "active" ]] && echo "$line" | grep -qi "$svc"; then
        warn "${svc} (from your hosting panel) is answering on port $p"
        ask_yes DISABLE "  stop and disable ${svc} so nginx can take the port?" 1
        if [[ "${DISABLE:-1}" == "1" ]]; then
          doit systemctl stop "$svc"; doit systemctl disable "$svc"
          did "${svc} stopped; bring it back with: systemctl enable --now $svc"
        else
          err "nginx will not be able to listen on port $p while ${svc} owns it"
          err "the deploy then fails on 'nginx -t' / a site that is unreachable - this is the usual 500 you saw"
          [[ "$p" != "80" && "$p" != "443" ]] && continue
          exit 1
        fi
      fi
    done
  done
  if [[ -f /etc/nginx/sites-enabled/default ]]; then
    info "nginx also ships /etc/nginx/sites-enabled/default; setup-server.sh renames it to default.disabled-by-vizitik"
  fi
}

certbot_leftovers() {
  [[ -d /etc/letsencrypt/live ]] || { skip "no certificates yet"; return 0; }
  log "certificates on this box"
  local d
  for d in /etc/letsencrypt/live/*/; do
    [[ -d "$d" ]] || continue
    local name; name="$(basename "$d")"
    info "$name  expires: $(openssl x509 -enddate -noout -in "${d}cert.pem" 2>/dev/null | cut -d= -f2)"
  done
  info "setup-server.sh reuses these; it never deletes a certificate"
  if [[ -f /var/log/vizitik-certbot.log ]]; then
    doit mv -f /var/log/vizitik-certbot.log /var/log/vizitik-certbot.log.1
    skip "old certbot log moved aside, so the tail after this run is fresh"
  fi
}

update_checkout() {
  log "source checkout ($SRC_DIR)"
  have git || { warn "git is not installed, skipping the pull"; return 0; }
  [[ -d "$SRC_DIR/.git" ]] || { skip "not a git checkout, leaving it alone"; return 0; }
  if [[ "$SKIP_PULL" == "1" ]]; then skip "git pull skipped (--skip-pull)"; return 0; fi
  local dirty branch
  dirty="$(git -C "$SRC_DIR" status --porcelain 2>/dev/null | head -20)"
  branch="$(git -C "$SRC_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if [[ -n "$dirty" ]]; then
    echo "      uncommitted changes:"
    echo "$dirty" | sed 's/^/        /'
    if [[ "$REQUIRE_CLEAN" == "1" ]]; then
      err "--require-clean was given and the checkout is not clean"
      exit 1
    fi
    warn "these files are NOT from the repository and will not be overwritten by the pull"
    warn "if the deploy is behaving oddly, this is the first thing to look at:"
    warn "  git -C $SRC_DIR stash && bash scripts/deploy.sh"
  fi
  info "branch: ${branch:-unknown}"
  ask_yes PULL "fetch the newest commits from origin/${branch:-main}?" 1
  if [[ "${PULL:-1}" != "1" ]]; then skip "keeping the checkout as it is"; return 0; fi
  if [[ "$DRY" == "1" ]]; then
    return 0
  fi
  local -a pull_args=( pull --ff-only )
  if git -C "$SRC_DIR" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    info "upstream: $(git -C "$SRC_DIR" rev-parse --abbrev-ref '@{u}' 2>/dev/null)"
  elif git -C "$SRC_DIR" remote get-url origin >/dev/null 2>&1; then
    warn "this branch has no upstream configured; pulling origin/${branch:-main} explicitly"
    pull_args=( pull --ff-only origin "${branch:-main}" )
  else
    err "this checkout has no origin remote, so there is nothing to pull. Add it with:"
    err "  git -C $SRC_DIR remote add origin https://github.com/<your name>/<your repo>.git"
    exit 1
  fi
  if git -C "$SRC_DIR" "${pull_args[@]}"; then
    ok "checkout is up to date ($(git -C "$SRC_DIR" rev-parse --short HEAD 2>/dev/null))"
  else
    err "git pull --ff-only failed (local commits or a rewritten branch)."
    err "see where it diverged, then decide:  git -C $SRC_DIR log --oneline -5  /  git -C $SRC_DIR reset --hard origin/main"
    exit 1
  fi
}

full_reset() {
  [[ "$FULL_RESET" == "1" ]] || return 0
  log "full reset of the installed copy"
  warn "this removes $INSTALL_DIR and /etc/nginx/sites-enabled/vizitik*; the database and the certificates stay"
  if [[ "${FULL_RESET_CONFIRM:-0}" == "1" ]]; then
    GO=1
  else
    ask_yes GO "really remove them now? (--yes never confirms this, use FULL_RESET_CONFIRM=1)" 0
  fi
  if [[ "${GO:-0}" != "1" ]]; then skip "reset declined, the installed copy stays as it is"; return 0; fi
  doit rm -rf "$INSTALL_DIR"
  if [[ -d /etc/nginx/sites-enabled ]]; then
    doit rm -f /etc/nginx/sites-enabled/vizitik /etc/nginx/sites-enabled/vizitik.conf
  fi
  doit nginx -t 2>/dev/null && doit systemctl reload nginx 2>/dev/null
  did "installed copy removed; setup-server.sh will rebuild it"
}

cloudflare_preflight() {
  log "dns and cloudflare check"
  local domain="${DOMAIN:-}"
  if [[ -z "$domain" && -r /etc/nginx/sites-enabled/vizitik.conf ]]; then
    domain="$(awk '/server_name/{print $2; exit}' /etc/nginx/sites-enabled/vizitik.conf 2>/dev/null)"
  fi
  if [[ -z "$domain" ]]; then
    skip "no domain given, so the records are not checked; the deploy asks for it and then:"
    echo "          dig +short A <your domain>"
    return 0
  fi
  local ips mine answers
  ips="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]' | head -3)"
  mine="$(echo "$ips" | head -1)"
  answers="$( (dig +short A "$domain" 2>/dev/null || getent hosts "$domain" 2>/dev/null) | tr -d ' ' | grep -E '^[0-9]' | paste -sd' ' -)"
  info "domain:   $domain"
  info "this box: ${mine:-unknown}"
  info "answers:  ${answers:-no answer at all}"
  if [[ -z "${answers// /}" ]]; then
    warn "$domain does not resolve - Let's Encrypt and your visitors both fail on that"
    warn "  in Cloudflare: DNS -> Records -> A, name @, content ${mine:-<server ip>}, then Save"
  elif [[ "$answers" == *"$mine"* ]]; then
    ok "$domain points at this server"
  else
    warn "$domain points at ${answers}, which is not ${mine:-this box}"
    warn "  if the orange cloud is on, that is Cloudflare's ip and is correct;"
    warn "  if the record is grey (DNS only), fix the A record in Cloudflare before deploying"
  fi
  if [[ -n "${CF_API_TOKEN:-}" ]]; then
    ok "CF_API_TOKEN is in the environment (DNS-01 will be used with HTTPS_MODE=dns)"
  else
    info "CF_API_TOKEN is not set: HTTP-01 needs port 80 open to the whole internet, from outside Iran too"
  fi
  info "the click-by-click steps are in docs/CLOUDFLARE-SSL.md"
}

post_checks() {
  cat <<TXT

  after the deploy finishes, these four lines tell you if it worked:
      systemctl is-active $SETUP_SVC nginx
      ss -ltnp | grep -E ':(80|443|${BACKEND_PORT})\$'
      curl -sI -H 'Host: ${DOMAIN:-localhost}' http://127.0.0.1/ | head -1
      curl -s -o /dev/null -w '%{http_code}\n' https://${DOMAIN:-localhost}/
TXT
}

main() {
  root_check "$*"
  log "deploy.sh - stopping what a previous run left behind"
  show_state
  stop_previous_service
  kill_strays
  disable_web_server_conflicts
  certbot_leftovers
  cloudflare_preflight
  [[ "$ONLY_CLEAN" == "1" ]] && { log "clean only, no deploy (--only-clean)"; exit 0; }
  update_checkout
  [[ "$DRY" == "1" ]] && { log "dry run finished, nothing was changed"; post_checks; exit 0; }
  [[ -x "$SETUP_SCRIPT" || -r "$SETUP_SCRIPT" ]] || { err "setup script not found: $SETUP_SCRIPT"; exit 1; }
  full_reset
  if [[ "$YES" != "1" ]] && is_tty; then
    echo
    ask_yes GO "start the deploy now?" 1
    [[ "${GO:-1}" == "1" ]] || { info "cancelled; nothing was deployed"; exit 0; }
  fi
  log "handing over to $(basename "$SETUP_SCRIPT") ${FORWARD[*]:-}"
  bash "$SETUP_SCRIPT" ${FORWARD[@]+"${FORWARD[@]}"}
  post_checks
}

main "$@"
