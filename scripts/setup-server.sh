#!/usr/bin/env bash
#
# What it does:
#   1) installs prerequisites (Nginx, Node, MariaDB, certbot, build tools)
#   2) starts and hardens MariaDB, creates the database, imports the dump
#   3) builds the NestJS backend and writes backend/.env
#   4) builds the PWA frontend (Vite) and writes frontend-app/.env
#   5) installs a permanent systemd service for the backend
#   6) configures Nginx (serves the PWA, reverse-proxies /api)
#   7) HTTPS (when DOMAIN is given), firewall and daily backup cron job
#
# Usage (needs root):
#   sudo bash scripts/setup-server.sh
# Values can be edited at the bottom of this file or passed as environment vars:
#   DOMAIN=app.example.com DB_PASS='...' BALE_BOT_TOKEN='...' sudo -E bash scripts/setup-server.sh
#
# Idempotent: re-running updates services and configuration without breaking anything.
set -euo pipefail

# ------------------------------------------------------------------
# 1) configuration variables (override here or via environment)
# ------------------------------------------------------------------

INSTALL_DIR="${INSTALL_DIR:-/opt/vizitik}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${SRC_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

DB_NAME="${DB_NAME:-vizitik_db}"
DB_USER="${DB_USER:-vizitik}"
DB_PASS="${DB_PASS:-CHANGE_ME_STRONG_PASSWORD}"
DB_HOST="localhost"

APP_NAME_FA="${APP_NAME_FA:-ویزیتیک}"
APP_NAME_EN="${APP_NAME_EN:-Vizitik}"

BALE_BOT_TOKEN="${BALE_BOT_TOKEN:-}"
BALE_BOT_USERNAME="${BALE_BOT_USERNAME:-}"
BALE_ADMIN_CHAT_ID="${BALE_ADMIN_CHAT_ID:-}"
JWT_SECRET="${JWT_SECRET:-$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)}"

DOMAIN="${DOMAIN:-}"
CERT_EMAIL="${CERT_EMAIL:-admin@example.com}"

BACKEND_PORT="${BACKEND_PORT:-3000}"
NODEJS_MAJOR=20

# ------------------------------------------------------------------
# 2) helpers
# ------------------------------------------------------------------

log()  { echo -e "\n\033[1;36m> $*\033[0m"; }
ok()   { echo -e "\033[1;32m  OK  $*\033[0m"; }
warn() { echo -e "\033[1;33m  WARN $*\033[0m"; }
fail() { echo -e "\033[1;31m  FAIL $*\033[0m" >&2; exit 1; }

urlencode() {
  local s="$1"
  jq -rn --arg v "$s" '$v|@uri'
}

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    fail "this script must run as root (sudo bash $0)"
  fi
}

distro_check() {
  . /etc/os-release 2>/dev/null || fail "unknown OS"
  case "$ID" in
    ubuntu|debian) ok "OS: $PRETTY_NAME" ;;
    *) fail "this script supports Ubuntu/Debian only (yours: $ID)" ;;
  esac
}

# ------------------------------------------------------------------
# 3) prerequisites
# ------------------------------------------------------------------

install_prereqs() {
  log "installing and updating prerequisites"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get upgrade -y
  apt-get install -y \
    curl git nginx ufw mariadb-server \
    certbot python3-certbot-nginx \
    build-essential python3 make g++ \
    ca-certificates gnupg jq

  local node_major=0
  if command -v node >/dev/null 2>&1; then
    node_major="$(node -v | sed 's/v//;s/\..*//')"
  fi
  if [[ "$node_major" -lt 18 ]]; then
    warn "Node missing or too old; installing Node $NODEJS_MAJOR from nodesource..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODEJS_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi
  ok "Node: $(node -v 2>/dev/null), npm: $(npm -v 2>/dev/null)"
}

# ------------------------------------------------------------------
# 4) database
# ------------------------------------------------------------------

setup_database() {
  log "setting up MariaDB"
  systemctl enable --now mariadb
  systemctl restart mariadb
  sleep 2

  if mysql -u root -e "SELECT 1" >/dev/null 2>&1; then
    warn "MySQL root has no password; run 'mysql_secure_installation' later"
  fi

  mysql -u root <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
  ok "database "${DB_NAME}" and user "${DB_USER}" are ready"

  local dump="$SRC_DIR/documents/hesabchin.sql"
  if [[ -f "$dump" ]]; then
    log "importing initial schema dump"
    local tmp="/tmp/vizitik_import.sql"
    sed '/CREATE DATABASE/,/^USE `hesabchin`;/d' "$dump" > "$tmp"
    mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$tmp"
    rm -f "$tmp"
    ok "schema dump imported"
  else
    warn "documents/hesabchin.sql not found; tables will only be created by prisma db push"
  fi
}

# ------------------------------------------------------------------
# 5) copy sources
# ------------------------------------------------------------------

copy_source() {
  log "copying sources to $INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  if [[ -d "$SRC_DIR/backend" && -d "$SRC_DIR/frontend-app" ]]; then
    rm -rf "$INSTALL_DIR/backend" "$INSTALL_DIR/frontend-app"
    cp -r "$SRC_DIR/backend" "$SRC_DIR/frontend-app" "$INSTALL_DIR/"
    ok "backend and frontend-app copied"
  else
    fail "repo structure not found in $SRC_DIR (backend and frontend-app are required)"
  fi
}

# ------------------------------------------------------------------
# 6) build backend
# ------------------------------------------------------------------

build_backend() {
  log "installing dependencies and building backend"
  cd "$INSTALL_DIR/backend"
  npm install --no-audit --no-fund

  npx prisma generate

  local DB_PASS_URL
  DB_PASS_URL="$(urlencode "$DB_PASS")"

  cat > .env <<EOF
DATABASE_URL="mysql://${DB_USER}:${DB_PASS_URL}@${DB_HOST}:3306/${DB_NAME}"
NODE_ENV=production
JWT_SECRET="${JWT_SECRET}"
JWT_EXPIRES_IN="30d"
PORT=${BACKEND_PORT}
APP_NAME_FA="${APP_NAME_FA}"
APP_NAME_EN="${APP_NAME_EN}"
BALE_BOT_USERNAME="${BALE_BOT_USERNAME}"
BALE_BOT_TOKEN="${BALE_BOT_TOKEN}"
BALE_ADMIN_CHAT_ID="${BALE_ADMIN_CHAT_ID}"
EOF
  if [[ -z "$BALE_BOT_TOKEN" ]]; then
    warn "BALE_BOT_TOKEN is empty; the bot will not send messages (fill it in .env and restart the service)"
  fi
  npx prisma db push --skip-generate || warn "prisma db push failed; check the tables manually"
  npm run build
  ok "backend built (dist/main.js)"
}

# ------------------------------------------------------------------
# 7) build PWA frontend
# ------------------------------------------------------------------

build_frontend() {
  log "installing and building the PWA frontend"
  cd "$INSTALL_DIR/frontend-app"
  npm install --no-audit --no-fund
  # only VITE_* is exposed to the browser; the app name is fixed in vite.config.js
  cat > .env <<EOF
VITE_API_URL="/api"
EOF
  npm run build
  ok "PWA built ($INSTALL_DIR/frontend-app/dist)"
}

# ------------------------------------------------------------------
# 8) systemd service
# ------------------------------------------------------------------

create_service() {
  log "creating the systemd service"
  local unit="/etc/systemd/system/vizitik-backend.service"
  cat > "$unit" <<EOF
[Unit]
Description=${APP_NAME_EN} NestJS Backend (API + Bale bot)
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
  systemctl daemon-reload
  systemctl enable vizitik-backend
  systemctl restart vizitik-backend
  sleep 2
  systemctl is-active --quiet vizitik-backend && ok "service is active" || warn "service did not start; check: journalctl -u vizitik-backend -n 50"
}

# ------------------------------------------------------------------
# 9) Nginx
# ------------------------------------------------------------------

setup_nginx() {
  log "configuring Nginx"
  local srv="_"
  [[ -n "$DOMAIN" ]] && srv="$DOMAIN"
  local conf="/etc/nginx/sites-available/vizitik"

  cat > "$conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${srv};
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

  ln -sf "$conf" /etc/nginx/sites-enabled/vizitik
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  ok "Nginx configured (server_name: ${srv})"
}

# ------------------------------------------------------------------
# 10) HTTPS
# ------------------------------------------------------------------

setup_https() {
  if [[ -z "$DOMAIN" ]]; then
    warn "DOMAIN not given; skipping TLS. (PWA install/offline needs valid HTTPS - see docs/DEPLOY-UBUNTU.md section 11)"
    return
  fi
  log "requesting SSL certificate for $DOMAIN"
  certbot --nginx -d "$DOMAIN" --redirect --agree-tos -m "$CERT_EMAIL" --non-interactive
  ok "HTTPS enabled"
}

# ------------------------------------------------------------------
# 11) firewall
# ------------------------------------------------------------------

setup_firewall() {
  log "configuring the UFW firewall"
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1
  ufw allow 'Nginx Full' >/dev/null 2>&1
  ufw --force enable >/dev/null 2>&1 || true
  ok "UFW enabled (SSH + Nginx)"
}

# ------------------------------------------------------------------
# 12) backup cron job
# ------------------------------------------------------------------

setup_backup() {
  log "creating the daily database backup cron job"
  mkdir -p /var/backups
  local cron="/etc/cron.d/vizitik-backup"
  cat > "$cron" <<EOF
SHELL=/bin/bash
0 2 * * * root mysqldump -u ${DB_USER} -p'${DB_PASS}' ${DB_NAME} > /var/backups/${DB_NAME}-\$(date +\%F).sql && find /var/backups -name '${DB_NAME}-*.sql' -mtime +7 -delete
EOF
  chmod 644 "$cron"
  ok "backups in /var/backups (7 days kept)"
}

# ------------------------------------------------------------------
# 13) summary and smoke test
# ------------------------------------------------------------------

final_summary() {
  log "final checks"
  local url="http://localhost"
  [[ -n "$DOMAIN" ]] && url="https://$DOMAIN"

  echo
  if [[ -n "${TEST_PHONE:-}" && -n "${TEST_PASSWORD:-}" ]]; then
    ok "backend: POST /api/auth/login returned"
    curl -s -X POST "http://127.0.0.1:${BACKEND_PORT}/api/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"phone\":\"${TEST_PHONE}\",\"password\":\"${TEST_PASSWORD}\"}" \
      -o /dev/null -w "  HTTP %{http_code}\n" || warn "no answer (check that this account exists)"
  else
    ok "backend is listening on port ${BACKEND_PORT} (export TEST_PHONE / TEST_PASSWORD to smoke-test the login)"
  fi

  echo -e "\n\033[1;32m======================================================\033[0m"
  echo -e "\033[1;32m  deployment finished! \033[0m"
  echo -e "\033[1;32m  site:       $url\033[0m"
  echo -e "\033[1;32m  API:      $url/api\033[0m"
  echo -e "\033[1;32m======================================================\033[0m"
  echo "  next steps:"
  echo "   - review $INSTALL_DIR/backend/.env (BALE_BOT_TOKEN and JWT_SECRET)"
  echo "   - backend logs: journalctl -u vizitik-backend -f"
  echo "   - without a domain, see docs/DEPLOY-UBUNTU.md section 11 for PWA install"
}

# ------------------------------------------------------------------
# ------------------------------------------------------------------

main() {
  require_root
  distro_check
  install_prereqs
  setup_database
  copy_source
  build_backend
  build_frontend
  create_service
  setup_nginx
  setup_https
  setup_firewall
  setup_backup
  final_summary
}

main "$@"
