#!/usr/bin/env bash
#
# Vizitik - first deployment on a fresh Ubuntu/Debian box.
#
# This script is the front door for scripts/setup-server.sh. It closes
# whatever is left over from earlier attempts, pulls the checkout and then
# hands over to setup-server.sh, which does the real work (MariaDB, builds,
# systemd, Nginx, HTTPS, firewall, backup cron).
#
# Why the cleanup matters: a previous attempt (or the hosting panel) can hold
# port 80 or the backend port, and then Nginx/the service comes up dead or
# keeps serving an old build.
#
# Usage:
#   sudo bash scripts/deploy.sh                  # ask the questions, then apply
#   bash scripts/deploy.sh --dry-run             # show what would be closed/changed
#   sudo bash scripts/deploy.sh --only-clean     # close leftovers, deploy nothing
#   sudo bash scripts/deploy.sh --yes            # no final confirmation
#   sudo bash scripts/deploy.sh --non-interactive --yes
#   sudo bash scripts/deploy.sh --full-reset     # + wipe the install dir and vhost
#                                                #   (the database and certificates survive)
#
# Flags that belong to setup-server.sh (--check, -y/--yes, --non-interactive,
# -h/--help) are passed through untouched.
#
# Environment overrides:
#   SRC_DIR        source checkout to deploy   (default: the checkout this script lives in)
#   INSTALL_DIR    live install directory      (default: /opt/vizitik)
#   BACKEND_PORT   backend port to free up     (default: 3000)
#   ADMIN_PORT     admin panel port to free up (default: 3001)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${SRC_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
INSTALL_DIR="${INSTALL_DIR:-/opt/vizitik}"
BACKEND_PORT="${BACKEND_PORT:-3000}"
ADMIN_PORT="${ADMIN_PORT:-3001}"
SETUP_SCRIPT="$SCRIPT_DIR/setup-server.sh"

DRY=0; ONLY_CLEAN=0; FULL_RESET=0; NO_PULL=0
PASSTHRU=()

log()  { echo -e "\n\033[1;36m> $*\033[0m"; }
ok()   { echo -e "\033[1;32m  OK  $*\033[0m"; }
info() { echo -e "\033[0;36m  ..  $*\033[0m"; }
warn() { echo -e "\033[1;33m  WARN $*\033[0m"; }
err()  { echo -e "\033[1;31m  FAIL $*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

# run: in --dry-run mode just report the command
run() {
  if [[ "$DRY" == "1" ]]; then echo "      would run: $*"; return 0; fi
  "$@"
}

usage() {
  cat <<'TXT'
usage: sudo bash scripts/deploy.sh [options]

  --dry-run, -n     print what would be closed/deployed, change nothing
  --only-clean      close leftovers from earlier runs and stop
  --full-reset      also remove the install dir, the systemd units and the vhost
                    before deploying (database and certificates are kept)
  --no-pull         deploy the checkout as it is, without git pull
  --check           passed to setup-server.sh: questions + summary, change nothing
  -y, --yes         passed through: no final confirmation
  --non-interactive passed through: never prompt, use environment values/defaults
  -h, --help        this text

environment:
  SRC_DIR INSTALL_DIR BACKEND_PORT ADMIN_PORT
TXT
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run|-n)      DRY=1 ;;
      --only-clean)      ONLY_CLEAN=1 ;;
      --full-reset)      FULL_RESET=1 ;;
      --no-pull)         NO_PULL=1 ;;
      -h|--help)         usage; exit 0 ;;
      --check|-y|--yes|--non-interactive|--defaults) PASSTHRU+=("$1") ;;
      *) err "unknown argument: $1"; usage; exit 2 ;;
    esac
    shift
  done
}

preflight() {
  log "preflight"

  # shellcheck disable=SC1091
  if [[ -r /etc/os-release ]]; then
    . /etc/os-release
    case "${ID:-}" in
      ubuntu|debian) ok "OS: ${PRETTY_NAME:-$ID}" ;;
      *) warn "setup-server.sh supports Ubuntu/Debian only (yours: ${ID:-unknown})" ;;
    esac
  else
    warn "cannot read /etc/os-release - unknown distribution"
  fi

  if [[ "$DRY" == "1" ]]; then
    info "dry run: no root needed, nothing will be changed"
  elif [[ "$(id -u)" -ne 0 ]]; then
    err "run as root: sudo bash scripts/deploy.sh"
    exit 1
  fi

  [[ -f "$SETUP_SCRIPT" ]] || { err "missing $SETUP_SCRIPT"; exit 1; }
  [[ -d "$SRC_DIR/backend" && -d "$SRC_DIR/frontend-app" ]] || {
    err "no Vizitik checkout at $SRC_DIR (backend/ and frontend-app/ are required)"
    exit 1
  }
  ok "source: $SRC_DIR"
  ok "install dir: $INSTALL_DIR"
}

resources() {
  log "resources"

  if have free; then
    local mem swap
    mem="$(free -m | awk '/^Mem:/{print $2}')"
    swap="$(free -m | awk '/^Swap:/{print $2}')"
    info "RAM ${mem:-?} MB, swap ${swap:-?} MB"
    if [[ "${mem:-0}" -lt 1024 && "${swap:-0}" -lt 1024 ]]; then
      warn "less than ~2 GB of RAM+swap: setup-server.sh will create a swap file, otherwise npm/vite get OOM-killed"
    fi
  fi
  have df && info "disk free: $(df -h / | awk 'NR==2{print $4}')"

  # DNS (only if a domain was passed in the environment)
  local d
  for d in ${DOMAIN:-} ${APP_DOMAIN:-} ${ADMIN_DOMAIN:-}; do
    [[ -z "$d" ]] && continue
    if have getent && getent hosts "$d" >/dev/null 2>&1; then
      ok "$d resolves"
    elif have dig && [[ -n "$(dig +short "$d" A 2>/dev/null)" ]]; then
      ok "$d resolves"
    else
      warn "$d does not resolve yet - Let's Encrypt will fail until the A record points here"
    fi
  done
}

# who is holding a port (empty when nothing does)
port_holder() {
  have ss || return 0
  ss -ltnpH "sport = :$1" 2>/dev/null | head -1
}

leftovers() {
  log "closing leftovers from earlier runs"

  local unit
  for unit in vizitik vizitik-backend vizitik-admin; do
    if have systemctl && systemctl list-unit-files "$unit.service" >/dev/null 2>&1; then
      if systemctl is-active --quiet "$unit" 2>/dev/null; then
        run systemctl stop "$unit" >/dev/null 2>&1 || true
        ok "stopped $unit.service"
      fi
      # `vizitik.service` came from the old standalone installer and would
      # fight vizitik-backend for port 3000 after a reboot
      if [[ "$unit" == "vizitik" ]] && systemctl is-enabled --quiet "$unit" 2>/dev/null; then
        run systemctl disable "$unit" >/dev/null 2>&1 || true
        ok "disabled the legacy $unit.service (replaced by vizitik-backend.service)"
      fi
    fi
  done

  if have pm2; then
    run pm2 delete all >/dev/null 2>&1 || true
    ok "cleared pm2 (if anything was running there)"
  fi

  # dev servers / manual launches that would fight for the ports
  local pat
  for pat in 'node dist/main.js' 'nest start' 'php -S' 'vite'; do
    if pgrep -f "$pat" >/dev/null 2>&1; then
      run pkill -f "$pat" >/dev/null 2>&1 || true
      ok "stopped stray process: $pat"
    fi
  done

  # a hung certbot keeps the ACME challenge port busy
  if pgrep -f certbot >/dev/null 2>&1; then
    run pkill -f certbot >/dev/null 2>&1 || true
    ok "stopped a hung certbot"
  fi

  # hosting-panel Apache squatting on port 80 (Nginx needs it)
  if [[ -n "$(port_holder 80)" ]] && have systemctl; then
    for unit in apache2 httpd; do
      if systemctl list-unit-files "$unit.service" >/dev/null 2>&1 && systemctl is-active --quiet "$unit" 2>/dev/null; then
        run systemctl stop "$unit" >/dev/null 2>&1 || true
        run systemctl disable "$unit" >/dev/null 2>&1 || true
        ok "stopped and disabled $unit (it held port 80)"
      fi
    done
  fi

  # report the ports we care about afterwards
  local p holder
  for p in 80 "$BACKEND_PORT" "$ADMIN_PORT"; do
    holder="$(port_holder "$p")"
    if [[ -n "$holder" ]]; then
      warn "port $p is still busy: $holder"
    else
      ok "port $p is free"
    fi
  done
}

pull_checkout() {
  if [[ "$NO_PULL" == "1" ]]; then
    warn "skipping git pull (--no-pull)"
    return 0
  fi
  if [[ "$DRY" == "1" ]]; then
    info "dry run: would pull $SRC_DIR (git pull --ff-only)"
    return 0
  fi
  if [[ ! -d "$SRC_DIR/.git" ]]; then
    warn "$SRC_DIR is not a git checkout - using the files as they are"
    return 0
  fi

  log "updating the checkout"
  local branch
  branch="$(git -C "$SRC_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if git -C "$SRC_DIR" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    if ! git -C "$SRC_DIR" pull --ff-only; then
      err "git pull failed in $SRC_DIR"
      err "the VPS has local commits or uncommitted changes; commit/push or merge them first,"
      err "or run with --no-pull to deploy the checkout as it is"
      exit 2
    fi
  elif ! git -C "$SRC_DIR" pull --ff-only origin "$branch"; then
    err "git pull failed in $SRC_DIR (no upstream tracking branch, and origin/$branch is unreachable)"
    err "fix the remote (git remote -v) or run with --no-pull"
    exit 2
  fi
  ok "checkout at $(git -C "$SRC_DIR" rev-parse --short HEAD)"
}

full_reset() {
  log "full reset (database and certificates are kept)"

  run systemctl stop vizitik-backend vizitik-admin vizitik >/dev/null 2>&1 || true
  run systemctl disable vizitik-backend vizitik-admin vizitik >/dev/null 2>&1 || true
  run rm -f /etc/systemd/system/vizitik-backend.service \
            /etc/systemd/system/vizitik-admin.service \
            /etc/systemd/system/vizitik.service
  run systemctl daemon-reload >/dev/null 2>&1 || true
  ok "systemd units removed"

  run rm -f /etc/nginx/sites-enabled/vizitik /etc/nginx/sites-available/vizitik
  run systemctl reload nginx >/dev/null 2>&1 || true
  ok "vhost removed"

  run rm -rf "$INSTALL_DIR"
  ok "install dir removed: $INSTALL_DIR"
}

main() {
  parse_args "$@"

  echo -e "\033[1;36m"
  echo "  Vizitik - deploy"
  echo -e "\033[0m"

  preflight
  resources
  leftovers

  if [[ "$ONLY_CLEAN" == "1" ]]; then
    log "done (--only-clean)"
    exit 0
  fi

  [[ "$FULL_RESET" == "1" ]] && full_reset
  pull_checkout

  if [[ "$DRY" == "1" ]]; then
    log "dry run: handing over to setup-server.sh --check (questions + summary, no changes)"
    PASSTHRU+=(--check)
  else
    log "handing over to setup-server.sh"
  fi

  export SRC_DIR INSTALL_DIR BACKEND_PORT
  exec bash "$SETUP_SCRIPT" ${PASSTHRU[@]+"${PASSTHRU[@]}"}
}

main "$@"
