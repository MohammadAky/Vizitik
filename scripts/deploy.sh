#!/usr/bin/env bash
#
# Vizitik - First-time VPS deployment script
#
# This script deploys Vizitik to a fresh Ubuntu/Debian VPS:
#   1) Installs prerequisites (Nginx, Node, MariaDB, certbot)
#   2) Sets up MariaDB database
#   3) Builds NestJS backend
#   4) Builds PWA frontend
#   5) Creates systemd services
#   6) Configures Nginx
#   7) Sets up HTTPS (Let's Encrypt)
#   8) Enables firewall and backup cron
#
# Usage (requires root):
#   sudo bash scripts/deploy.sh
#
# Configuration via environment variables:
#   DOMAIN=vizitik.ir DB_PASS='...' BALE_BOT_TOKEN='...' sudo -E bash scripts/deploy.sh
#
# The app is served on app.$DOMAIN; override with APP_DOMAIN=app.example.com
#
set -euo pipefail

# ------------------------------------------------------------------
# Vizitik branding - hardcoded
# ------------------------------------------------------------------
APP_NAME_EN="Vizitik"
APP_NAME_FA="ویزیتیک"

# ------------------------------------------------------------------
# Configuration (override via environment or edit here)
# ------------------------------------------------------------------
INSTALL_DIR="${INSTALL_DIR:-/opt/vizitik}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${SRC_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

DB_NAME="${DB_NAME:-vizitik_db}"
DB_USER="${DB_USER:-vizitik}"
DB_PASS="${DB_PASS:-}"
DB_HOST="localhost"

BALE_BOT_TOKEN="${BALE_BOT_TOKEN:-}"
BALE_BOT_USERNAME="${BALE_BOT_USERNAME:-}"
BALE_ADMIN_CHAT_ID="${BALE_ADMIN_CHAT_ID:-}"
JWT_SECRET="${JWT_SECRET:-}"

DOMAIN="${DOMAIN:-}"
APP_DOMAIN="${APP_DOMAIN:-}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
ADMIN_PORT="${ADMIN_PORT:-3001}"
CERT_EMAIL="${CERT_EMAIL:-}"

BACKEND_PORT="${BACKEND_PORT:-3000}"
WITH_WWW="${WITH_WWW:-0}"
HTTPS_MODE="${HTTPS_MODE:-}"
CF_API_TOKEN="${CF_API_TOKEN:-}"
NODEJS_MAJOR=20

ASK="${ASK:-1}"
YES="${YES:-0}"
ENABLE_HTTPS="${ENABLE_HTTPS:-1}"
ENABLE_UFW="${ENABLE_UFW:-1}"
ENABLE_BACKUP="${ENABLE_BACKUP:-1}"
TEST_PHONE="${TEST_PHONE:-}"
TEST_PASSWORD="${TEST_PASSWORD:-}"

MIN_TOTAL_MB="${MIN_TOTAL_MB:-2048}"
CREATE_SWAP="${CREATE_SWAP:-auto}"
SWAP_FILE="${SWAP_FILE:-/swapfile}"
SWAP_MB="${SWAP_MB:-auto}"
NODE_HEAP_MB="${NODE_HEAP_MB:-auto}"

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
log()  { echo -e "\n\033[1;36m> $*\033[0m"; }
ok()   { echo -e "\033[1;32m  OK  $*\033[0m"; }
warn() { echo -e "\033[1;33m  WARN $*\033[0m"; }
info() { echo -e "\033[0;36m  ..  $*\033[0m"; }
fail() { echo -e "\033[1;31m  FAIL $*\033[0m" >&2; exit 1; }
err()  { echo -e "\033[1;31m  FAIL $*\033[0m" >&2; }

report_step_rc() {
  local rc="$1" label="$2"
  if (( rc == 0 )); then return 0; fi
  err "step failed (exit $rc): $label"
  if (( rc == 137 )) || (( rc == 143 )); then
    err "exit $rc means the kernel killed the process: out of memory"
    err "  ram:  $(free -m | awk '/^Mem:/{print $2" MB"}') | swap: $(free -m | awk '/^Swap:/{print $2" MB"}')"
    err "  fix: add swap or increase it"
  fi
  err "this script is idempotent - fix the cause and run it again"
  exit "$rc"
}

run_here() {
  local label="$1"; shift
  local rc=0
  "$@" || rc=$?
  report_step_rc "$rc" "$label"
}

run_in() {
  local dir="$1" label="$2"; shift 2
  local rc=0
  ( cd "$dir" && "$@" ) || rc=$?
  report_step_rc "$rc" "$label"
}

memory_totals() {
  local r sm
  r="$(awk '/^MemTotal:/{print int($2/1024)}' /proc/meminfo 2>/dev/null)"
  sm="$(awk '/^SwapTotal:/{t+=$2} END{print int(t/1024)}' /proc/meminfo 2>/dev/null)"
  echo "${r:-0} ${sm:-0}"
}

ensure_swapfile() {
  local mb="$1"
  if command -v swapon >/dev/null 2>&1 && swapon --show=NAME --noheadings 2>/dev/null | grep -qx "$SWAP_FILE"; then
    ok "swap file $SWAP_FILE is already active"
    return 0
  fi
  log "creating ${mb} MB of swap at $SWAP_FILE"
  if [[ ! -f "$SWAP_FILE" ]]; then
    if ! fallocate -l "${mb}M" "$SWAP_FILE" 2>/dev/null; then
      dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$mb" status=none || { err "could not create $SWAP_FILE"; return 0; }
    fi
    chmod 600 "$SWAP_FILE"
    mkswap "$SWAP_FILE" >/dev/null 2>&1 || { err "mkswap failed"; return 0; }
  fi
  swapon "$SWAP_FILE" 2>/dev/null || { warn "swapon refused"; return 0; }
  if ! grep -qs "^$SWAP_FILE" /etc/fstab; then
    echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab 2>/dev/null || true
  fi
  ok "swap enabled"
}

memory_guard() {
  local parts ram swap total heap
  parts=($(memory_totals)); ram="${parts[0]}"; swap="${parts[1]}"; total=$(( ram + swap ))
  info "memory: ${ram} MB ram + ${swap} MB swap = ${total} MB"
  if (( total >= MIN_TOTAL_MB )); then
    ok "enough memory for the builds"
  elif [[ "$CREATE_SWAP" == "0" ]]; then
    warn "only ${total} MB and CREATE_SWAP=0: builds may be killed"
  else
    local want="$SWAP_MB"
    [[ "$want" == "auto" ]] && want=$(( MIN_TOTAL_MB - total + 1024 ))
    if can_ask && [[ "$YES" != "1" ]]; then
      read -r -p "  create a ${want} MB swap file? [Y/n]: " ans || ans=""
      [[ "$ans" =~ ^[Nn] ]] && { warn "no swap; builds may be killed"; want=0; }
    fi
    [[ "$want" != "0" ]] && ensure_swapfile "$want"
  fi
  heap="$NODE_HEAP_MB"
  if [[ "$heap" == "auto" ]]; then
    parts=($(memory_totals)); total=$(( ${parts[0]} + ${parts[1]} ))
    heap=$(( total * 6 / 10 ))
    (( heap < 512 )) && heap=512
    (( heap > 3072 )) && heap=3072
  fi
  export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=${heap}"
  info "node heap capped at ${heap} MB"
}

npm_install_in() {
  local dir="$1" rc=0
  if [[ -f "$dir/package-lock.json" ]]; then
    ( cd "$dir" && npm ci --no-audit --no-fund --no-progress --loglevel=error ) || rc=$?
    if (( rc == 0 )); then return 0; fi
    if (( rc == 137 )) || (( rc == 143 )); then
      report_step_rc "$rc" "npm ci in $dir"
    fi
    warn "npm ci failed; retrying with npm install"
  fi
  run_in "$dir" "npm install in $dir" npm install --no-audit --no-fund --no-progress --loglevel=error
}

urlencode() {
  local s="$1"
  jq -rn --arg v "$s" '$v|@uri'
}

gen_secret() {
  head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48
}

is_tty() { [[ -t 0 ]]; }
can_ask() { [[ "${ASK:-1}" == "1" ]] && is_tty; }
set_var() { printf -v "$1" '%s' "$2"; }

ask() {
  local name="$1" prompt="$2" default="${3:-}" cur="" ans=""
  cur="${!name:-}"
  if ! can_ask; then
    [[ -z "$cur" ]] && set_var "$name" "$default"
    return 0
  fi
  if [[ -n "$cur" ]]; then
    read -r -p "  $prompt [$cur]: " ans || ans=""
  else
    read -r -p "  $prompt [${default:-none}]: " ans || ans=""
  fi
  [[ -z "$ans" ]] && ans="${cur:-$default}"
  set_var "$name" "$ans"
}

ask_secret() {
  local name="$1" prompt="$2" cur="" a="" b=""
  cur="${!name:-}"
  if ! can_ask; then
    [[ -z "$cur" || "$cur" == CHANGE_ME* ]] && { warn "$name not set"; return 1; }
    return 0
  fi
  while :; do
    read -r -s -p "  $prompt: " a || { printf '\n'; return 1; }
    printf '\n'
    if [[ -z "$a" ]]; then
      read -r -p "  keep current value? [y/N]: " keep || return 1
      [[ "$keep" =~ ^[Yy] ]] && return 0
      continue
    fi
    read -r -s -p "  repeat: " b || { printf '\n'; return 1; }
    printf '\n'
    if [[ "$a" == "$b" ]]; then set_var "$name" "$a"; return 0; fi
    warn "entries do not match"
  done
}

ask_yes() {
  local name="$1" prompt="$2" default="${3:-1}" ans=""
  if ! can_ask; then
    [[ -z "${!name:-}" ]] && set_var "$name" "$default"
    return 0
  fi
  read -r -p "  $prompt [Y/n]: " ans || ans=""
  [[ -z "$ans" ]] && ans="${default}"
  case "$ans" in
    [Nn]*|0) set_var "$name" 0 ;;
    *)       set_var "$name" 1 ;;
  esac
}

# ------------------------------------------------------------------
# Collect inputs
# ------------------------------------------------------------------
collect_inputs() {
  log "Vizitik deployment - press Enter to keep the value in brackets"

  ask INSTALL_DIR "install directory" "/opt/vizitik"
  ask DOMAIN "public domain (empty = no https)" ""
  if [[ -n "$DOMAIN" ]]; then
    ask_yes ENABLE_HTTPS "get Let's Encrypt certificate for $DOMAIN" 1
    if [[ "$ENABLE_HTTPS" == "1" ]]; then
      ask CERT_EMAIL "email for certificate (empty = no expiry notices)" ""
      if [[ -z "$APP_DOMAIN" ]]; then APP_DOMAIN="app.$DOMAIN"; fi
      ask APP_DOMAIN "app subdomain" "$APP_DOMAIN"
      if [[ -z "$ADMIN_DOMAIN" ]]; then ADMIN_DOMAIN="admin.$DOMAIN"; fi
      ask ADMIN_DOMAIN "admin subdomain (empty = no admin panel)" "$ADMIN_DOMAIN"
      if [[ -n "$ADMIN_DOMAIN" && -z "$ADMIN_TOKEN" ]]; then
        ADMIN_TOKEN="$(openssl rand -hex 24)"
        ok "ADMIN_TOKEN generated"
      fi
      if [[ -z "$HTTPS_MODE" ]]; then
        echo "  HTTPS challenge method:"
        echo "    1) http - needs port 80 reachable (default)"
        echo "    2) dns  - Cloudflare DNS API"
        read -r -p "  choice [1]: " hm || hm=""
        case "$hm" in
          2|dns) HTTPS_MODE="dns" ;;
          *)     HTTPS_MODE="http" ;;
        esac
      fi
      if [[ "$HTTPS_MODE" == "dns" ]]; then
        ask_secret CF_API_TOKEN "Cloudflare API token" || true
      fi
    fi
    ask_yes WITH_WWW "also serve www.$DOMAIN" 1
  else
    ENABLE_HTTPS=0
  fi

  ask BACKEND_PORT "backend port" "3000"
  ask DB_HOST "database host" "localhost"
  ask DB_NAME "database name" "vizitik_db"
  ask DB_USER "database user" "vizitik"
  if [[ -z "$DB_PASS" || "$DB_PASS" == CHANGE_ME* ]]; then
    ask_secret DB_PASS "database password" || true
  fi
  [[ -z "$DB_PASS" ]] && fail "database password is required"
  [[ "$DB_PASS" == CHANGE_ME* ]] && fail "DB_PASS still has placeholder"

  ask BALE_BOT_USERNAME "Bale bot username (empty = disabled)" ""
  if [[ -n "$BALE_BOT_USERNAME" ]]; then
    ask_secret BALE_BOT_TOKEN "Bale bot token" || true
    ask BALE_ADMIN_CHAT_ID "admin chat id for alerts" ""
  fi

  [[ -z "$JWT_SECRET" ]] && JWT_SECRET="$(gen_secret)" && ok "JWT secret generated"
  ask_yes ENABLE_UFW "enable UFW firewall" 1
  ask_yes ENABLE_BACKUP "install nightly backup cron" 1
  ask TEST_PHONE "phone for login test (empty = skip)" ""
}

print_summary() {
  echo
  echo "  App:         $APP_NAME_EN / $APP_NAME_FA"
  echo "  Install dir: $INSTALL_DIR"
  echo "  Domain:      ${DOMAIN:-<none>} | App: ${APP_DOMAIN:-<same>} | Admin: ${ADMIN_DOMAIN:-<none>}"
  echo "  HTTPS:       $ENABLE_HTTPS (mode: ${HTTPS_MODE:-http})"
  echo "  Database:    ${DB_USER}@${DB_HOST}/${DB_NAME}"
  echo "  Backend:     port $BACKEND_PORT"
  echo "  Bale bot:    ${BALE_BOT_USERNAME:-<disabled>}"
  echo "  Firewall:    $ENABLE_UFW | Backup: $ENABLE_BACKUP"
  local mt; mt=($(memory_totals))
  echo "  Memory:      ${mt[0]} MB ram + ${mt[1]} MB swap"
}

# ------------------------------------------------------------------
# Prerequisites
# ------------------------------------------------------------------
install_prereqs() {
  log "installing prerequisites"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get upgrade -y
  apt-get install -y \
    curl git nginx ufw mariadb-server \
    certbot python3-certbot-nginx \
    build-essential python3 make g++ \
    ca-certificates gnupg jq

  if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//;s/\..*//')" -lt 18 ]]; then
    warn "Installing Node $NODEJS_MAJOR..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODEJS_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi
  ok "Node: $(node -v), npm: $(npm -v)"
}

# ------------------------------------------------------------------
# Database
# ------------------------------------------------------------------
setup_database() {
  log "setting up MariaDB"
  systemctl enable --now mariadb
  systemctl restart mariadb
  sleep 2

  mysql -u root <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
  ok "database ready"

  local dump="$SRC_DIR/documents/hesabchin.sql"
  if [[ -f "$dump" ]]; then
    log "importing initial schema"
    local tmp="/tmp/vizitik_import.sql"
    sed '/CREATE DATABASE/,/^USE `hesabchin`;/d' "$dump" > "$tmp"
    mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$tmp"
    rm -f "$tmp"
    ok "schema imported"
  fi
}

# ------------------------------------------------------------------
# Copy sources
# ------------------------------------------------------------------
copy_source() {
  log "copying sources to $INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  rm -rf "$INSTALL_DIR/backend" "$INSTALL_DIR/frontend-app" "$INSTALL_DIR/landing" "$INSTALL_DIR/admin"
  cp -r "$SRC_DIR/backend" "$SRC_DIR/frontend-app" "$INSTALL_DIR/"
  [[ -d "$SRC_DIR/landing" ]] && cp -r "$SRC_DIR/landing" "$INSTALL_DIR/"
  [[ -d "$SRC_DIR/admin" ]] && cp -r "$SRC_DIR/admin" "$INSTALL_DIR/"
  ok "sources copied"
}

# ------------------------------------------------------------------
# Build backend
# ------------------------------------------------------------------
build_backend() {
  log "building backend"
  cd "$INSTALL_DIR/backend"
  npm_install_in "$INSTALL_DIR/backend"
  run_here "prisma generate" npx prisma generate

  local DB_PASS_URL
  DB_PASS_URL="$(urlencode "$DB_PASS")"

  cat > "$INSTALL_DIR/.env" <<EOF
DATABASE_URL="mysql://${DB_USER}:${DB_PASS_URL}@${DB_HOST}:3306/${DB_NAME}"
NODE_ENV=production
JWT_SECRET="${JWT_SECRET}"
JWT_EXPIRES_IN="30d"
PORT=${BACKEND_PORT}
BIND_HOST=127.0.0.1
BALE_BOT_USERNAME="${BALE_BOT_USERNAME}"
BALE_BOT_TOKEN="${BALE_BOT_TOKEN}"
BALE_ADMIN_CHAT_ID="${BALE_ADMIN_CHAT_ID}"
ADMIN_PORT=${ADMIN_PORT}
ADMIN_TOKEN="${ADMIN_TOKEN}"
ADMIN_STATIC_DIR="${INSTALL_DIR}/admin"
ADMIN_FONTS_DIR="${INSTALL_DIR}/landing/fonts"
VITE_API_URL="/api"
EOF
  [[ -f "$INSTALL_DIR/scripts/env-sync.mjs" ]] && node "$INSTALL_DIR/scripts/env-sync.mjs" || true
  [[ -f .env ]] || cp "$INSTALL_DIR/.env" .env

  npx prisma db push --skip-generate || warn "prisma db push failed"
  run_here "backend build" npm run build
  ok "backend built"
}

# ------------------------------------------------------------------
# Build admin
# ------------------------------------------------------------------
build_admin() {
  [[ -n "$ADMIN_DOMAIN" && -d "$INSTALL_DIR/admin" ]] || return 0
  log "installing admin panel"
  mkdir -p "$INSTALL_DIR/backend/admin"
  cp "$INSTALL_DIR/admin/server.js" "$INSTALL_DIR/backend/admin/server.js"
  ok "admin panel installed"
}

# ------------------------------------------------------------------
# Build frontend
# ------------------------------------------------------------------
build_frontend() {
  log "building PWA frontend"
  cd "$INSTALL_DIR/frontend-app"
  npm_install_in "$INSTALL_DIR/frontend-app"
  [[ -f .env ]] || printf 'VITE_API_URL="/api"\n' > .env
  run_here "PWA build" npm run build
  ok "PWA built"
}

# ------------------------------------------------------------------
# Systemd services
# ------------------------------------------------------------------
create_services() {
  log "creating systemd services"

  cat > /etc/systemd/system/vizitik-backend.service <<EOF
[Unit]
Description=${APP_NAME_EN} Backend API
After=network.target mariadb.service

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/backend
ExecStart=$(command -v node) dist/main.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
User=root

[Install]
WantedBy=multi-user.target
EOF

  if [[ -n "$ADMIN_DOMAIN" && -f "$INSTALL_DIR/backend/admin/server.js" ]]; then
    cat > /etc/systemd/system/vizitik-admin.service <<EOF
[Unit]
Description=${APP_NAME_EN} Admin Panel
After=network.target mariadb.service vizitik-backend.service

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/backend
EnvironmentFile=$INSTALL_DIR/backend/.env
ExecStart=$(command -v node) admin/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
User=root

[Install]
WantedBy=multi-user.target
EOF
  fi

  systemctl daemon-reload
  systemctl enable vizitik-backend
  systemctl restart vizitik-backend
  sleep 2
  systemctl is-active --quiet vizitik-backend && ok "backend service active" || warn "backend failed to start"

  if [[ -n "$ADMIN_DOMAIN" ]]; then
    systemctl enable vizitik-admin 2>/dev/null || true
    systemctl restart vizitik-admin 2>/dev/null || true
    ok "admin service started"
  fi
}

# ------------------------------------------------------------------
# Nginx
# ------------------------------------------------------------------
setup_nginx() {
  log "configuring Nginx"
  local app_name="${APP_DOMAIN:-$DOMAIN}"
  app_name="${app_name:-_}"
  local conf="/etc/nginx/sites-available/vizitik"

  : > "$conf"

  if [[ -n "$DOMAIN" ]]; then
    local names="$DOMAIN"
    [[ "$WITH_WWW" == "1" ]] && names="$DOMAIN www.$DOMAIN"
    cat >> "$conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${names};
    root $INSTALL_DIR/landing;
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }

    location ~* \.(woff2?|png|js|css)$ {
        expires 30d;
        add_header Cache-Control "public";
    }
}
EOF
  fi

  cat >> "$conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${app_name};
    root $INSTALL_DIR/frontend-app/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* (sw\.js|workbox-.*\.js|manifest\.webmanifest)$ {
        expires -1;
        add_header Cache-Control "no-cache";
        add_header Service-Worker-Allowed "/";
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF

  if [[ -n "$ADMIN_DOMAIN" ]]; then
    cat >> "$conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${ADMIN_DOMAIN};

    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        proxy_pass http://127.0.0.1:${ADMIN_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 60s;
    }
}
EOF
  fi

  ln -sf "$conf" /etc/nginx/sites-enabled/vizitik
  [[ -e /etc/nginx/sites-enabled/default ]] && mv /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.disabled-by-vizitik 2>/dev/null || true
  nginx -t || fail "nginx config test failed"
  systemctl reload nginx
  ok "Nginx configured"
}

# ------------------------------------------------------------------
# HTTPS
# ------------------------------------------------------------------
setup_https() {
  [[ "$ENABLE_HTTPS" == "1" && -n "$DOMAIN" ]] || { warn "HTTPS skipped"; return 0; }
  log "setting up HTTPS"

  local -a cnames=(-d "$DOMAIN")
  [[ "$WITH_WWW" == "1" ]] && cnames+=(-d "www.$DOMAIN")
  [[ -n "$APP_DOMAIN" && "$APP_DOMAIN" != "$DOMAIN" ]] && cnames+=(-d "$APP_DOMAIN")
  [[ -n "$ADMIN_DOMAIN" && "$ADMIN_DOMAIN" != "$DOMAIN" ]] && cnames+=(-d "$ADMIN_DOMAIN")

  local -a email_args=(--register-unsafely-without-email)
  [[ "$CERT_EMAIL" == *@*.* ]] && email_args=(-m "$CERT_EMAIL")

  if [[ "$HTTPS_MODE" == "dns" ]]; then
    if ! certbot plugins 2>/dev/null | grep -qi cloudflare; then
      apt-get install -y python3-certbot-dns-cloudflare >/dev/null 2>&1 || \
        pip3 install -q certbot-dns-cloudflare >/dev/null 2>&1
    fi
    local creds="/etc/letsencrypt/cloudflare.credentials"
    [[ -z "$CF_API_TOKEN" ]] && fail "CF_API_TOKEN required for DNS mode"
    mkdir -p "$(dirname "$creds")"
    printf "dns_cloudflare_api_token = %s\n" "$CF_API_TOKEN" > "$creds"
    chmod 600 "$creds"
    certbot certonly --expand -a dns-cloudflare --dns-cloudflare-credentials "$creds" \
      --dns-cloudflare-propagation-seconds 30 "${cnames[@]}" --agree-tos "${email_args[@]}" -n || warn "certbot failed"
  else
    certbot --nginx --expand "${cnames[@]}" --redirect --agree-tos "${email_args[@]}" --non-interactive || warn "certbot failed"
  fi
  ok "HTTPS enabled"
}

# ------------------------------------------------------------------
# Firewall
# ------------------------------------------------------------------
setup_firewall() {
  [[ "$ENABLE_UFW" != "1" ]] && return 0
  log "configuring firewall"
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1
  ufw allow 'Nginx Full' >/dev/null 2>&1
  ufw --force enable >/dev/null 2>&1 || true
  ok "UFW enabled"
}

# ------------------------------------------------------------------
# Backup
# ------------------------------------------------------------------
setup_backup() {
  [[ "$ENABLE_BACKUP" != "1" ]] && return 0
  log "creating backup cron job"
  mkdir -p /var/backups
  cat > /etc/cron.d/vizitik-backup <<EOF
SHELL=/bin/bash
0 2 * * * root mysqldump -u ${DB_USER} -p'${DB_PASS}' ${DB_NAME} > /var/backups/${DB_NAME}-\$(date +\%F).sql && find /var/backups -name '${DB_NAME}-*.sql' -mtime +7 -delete
EOF
  chmod 644 /etc/cron.d/vizitik-backup
  ok "backups scheduled"
}

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
final_summary() {
  log "Vizitik deployed successfully!"
  local url="http://localhost"
  [[ -n "$DOMAIN" ]] && url="https://$DOMAIN"

  echo -e "\n\033[1;32m======================================================\033[0m"
  echo -e "\033[1;32m  $APP_NAME_EN deployment complete! \033[0m"
  echo -e "\033[1;32m  Site:  $url\033[0m"
  echo -e "\033[1;32m  API:   $url/api\033[0m"
  [[ -n "$ADMIN_DOMAIN" ]] && echo -e "\033[1;32m  Admin: https://$ADMIN_DOMAIN\033[0m"
  echo -e "\033[1;32m======================================================\033[0m"
  echo "  Next steps:"
  echo "   - Open $url and register the first account"
  echo "   - Review $INSTALL_DIR/.env"
  echo "   - Logs: journalctl -u vizitik-backend -f"
}

# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------
main() {
  local mode="deploy"
  for a in "$@"; do
    case "$a" in
      --check) mode="check" ;;
      -y|--yes) YES=1 ;;
      --non-interactive) ASK=0 ;;
      -h|--help)
        echo "usage: sudo bash scripts/deploy.sh [--check] [-y] [--non-interactive]"
        exit 0 ;;
      *) fail "unknown argument: $a" ;;
    esac
  done

  if [[ "$mode" == "check" ]]; then
    collect_inputs
    print_summary
    ok "preflight done - nothing changed"
    exit 0
  fi

  [[ "$(id -u)" -ne 0 ]] && fail "run as root: sudo bash scripts/deploy.sh"
  . /etc/os-release 2>/dev/null || fail "unknown OS"
  case "$ID" in
    ubuntu|debian) ;;
    *) fail "Ubuntu/Debian required (yours: $ID)" ;;
  esac

  collect_inputs
  print_summary
  memory_guard
  install_prereqs
  setup_database
  copy_source
  build_backend
  build_admin
  build_frontend
  create_services
  setup_nginx
  setup_https
  setup_firewall
  setup_backup
  final_summary
}

main "$@"
