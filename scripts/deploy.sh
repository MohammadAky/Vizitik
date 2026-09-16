#!/usr/bin/env bash
#
# Vizitik - Personal VPS Deployment
#
# Deploys frontend + backend together on a single VPS.
# The backend serves the PWA frontend static files.
#
# Usage:
#   sudo bash scripts/deploy.sh
#
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/vizitik}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${SRC_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

# Database
DB_NAME="${DB_NAME:-vizitik_db}"
DB_USER="${DB_USER:-vizitik}"
DB_PASS="${DB_PASS:-}"
DB_HOST="localhost"

# Backend
PORT="${PORT:-3000}"
JWT_SECRET="${JWT_SECRET:-}"
NODEJS_MAJOR=20

# Memory (1GB servers need swap for builds)
MIN_TOTAL_MB="${MIN_TOTAL_MB:-1536}"
SWAP_FILE="${SWAP_FILE:-/swapfile}"

# App
APP_NAME="Vizitik"

# Optional
BALE_BOT_TOKEN="${BALE_BOT_TOKEN:-}"
BALE_BOT_USERNAME="${BALE_BOT_USERNAME:-}"
BALE_ADMIN_CHAT_ID="${BALE_ADMIN_CHAT_ID:-}"

# ------------------------------------------------------------------
log()  { echo -e "\n\033[1;36m> $*\033[0m"; }
ok()   { echo -e "\033[1;32m  ✓  $*\033[0m"; }
warn() { echo -e "\033[1;33m  ⚠  $*\033[0m"; }
fail() { echo -e "\033[1;31m  ✗  $*\033[0m" >&2; exit 1; }

urlencode() {
  local s="$1"
  jq -rn --arg v "$s" '$v|@uri'
}

gen_secret() {
  head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48
}

# ------------------------------------------------------------------
# Memory management for low-RAM servers
# ------------------------------------------------------------------
ensure_swap() {
  local ram_mb swap_mb total_mb
  ram_mb="$(awk '/^MemTotal:/{print int($2/1024)}' /proc/meminfo 2>/dev/null)"
  swap_mb="$(awk '/^SwapTotal:/{print int($2/1024)}' /proc/meminfo 2>/dev/null)"
  total_mb=$(( ram_mb + swap_mb ))

  log "memory: ${ram_mb}MB RAM + ${swap_mb}MB swap = ${total_mb}MB total"

  if (( total_mb >= MIN_TOTAL_MB )); then
    ok "enough memory"
    return 0
  fi

  if [[ -f "$SWAP_FILE" ]] && swapon --show | grep -q "$SWAP_FILE"; then
    ok "swap already active"
    return 0
  fi

  local need_mb=$(( MIN_TOTAL_MB - total_mb + 256 ))
  log "creating ${need_mb}MB swap file"

  if [[ ! -f "$SWAP_FILE" ]]; then
    fallocate -l "${need_mb}M" "$SWAP_FILE" 2>/dev/null || \
      dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$need_mb" status=none
    chmod 600 "$SWAP_FILE"
    mkswap "$SWAP_FILE" >/dev/null 2>&1
  fi

  swapon "$SWAP_FILE" 2>/dev/null
  if ! grep -qs "$SWAP_FILE" /etc/fstab; then
    echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
  fi

  ok "swap enabled: ${need_mb}MB"

  # Limit Node heap for 1GB servers
  export NODE_OPTIONS="--max-old-space-size=384"
  info "node heap limited to 384MB"
}

# ------------------------------------------------------------------
# Collect inputs
# ------------------------------------------------------------------
collect_inputs() {
  log "$APP_NAME deployment"

  if [[ -z "$DB_PASS" ]]; then
    read -s -p "  Database password: " DB_PASS
    echo
    [[ -z "$DB_PASS" ]] && fail "password required"
  fi

  if [[ -z "$JWT_SECRET" ]]; then
    JWT_SECRET="$(gen_secret)"
    ok "JWT secret generated"
  fi

  read -p "  Bale bot username (empty=skip): " BALE_BOT_USERNAME
  if [[ -n "$BALE_BOT_USERNAME" ]]; then
    read -s -p "  Bale bot token: " BALE_BOT_TOKEN
    echo
    read -p "  Admin chat ID: " BALE_ADMIN_CHAT_ID
  fi

  echo
  echo "  Install: $INSTALL_DIR"
  echo "  Database: $DB_NAME"
  echo "  Port: $PORT"
  echo "  Bot: ${BALE_BOT_USERNAME:-disabled}"
}

# ------------------------------------------------------------------
# Prerequisites
# ------------------------------------------------------------------
install_prereqs() {
  log "installing prerequisites"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y curl git nginx ufw mariadb-server build-essential jq

  if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//;s/\..*//')" -lt 18 ]]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODEJS_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi
  ok "Node $(node -v)"
}

# ------------------------------------------------------------------
# Database
# ------------------------------------------------------------------
setup_database() {
  log "setting up MariaDB"
  systemctl enable --now mariadb
  sleep 2

  mysql -u root <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
  ok "database ready"
}

# ------------------------------------------------------------------
# Build
# ------------------------------------------------------------------
npm_install_safe() {
  local dir="$1"
  local rc=0

  if [[ -f "$dir/package-lock.json" ]]; then
    (cd "$dir" && npm ci --no-audit --no-fund --no-progress --loglevel=error) || rc=$?
  fi

  if [[ "$rc" -ne 0 ]]; then
    warn "npm ci failed, trying npm install..."
    (cd "$dir" && npm install --no-audit --no-fund --no-progress --loglevel=error) || {
      err "npm install failed"
      return 1
    }
  fi
  return 0
}

build_app() {
  log "building application"

  # Copy sources
  mkdir -p "$INSTALL_DIR"
  rm -rf "$INSTALL_DIR/backend" "$INSTALL_DIR/frontend-app"
  cp -r "$SRC_DIR/backend" "$SRC_DIR/frontend-app" "$INSTALL_DIR/"

  # Create .env FIRST (needed for Prisma)
  DB_PASS_URL="$(urlencode "$DB_PASS")"
  mkdir -p "$INSTALL_DIR/backend"
  cat > "$INSTALL_DIR/backend/.env" <<EOF
DATABASE_URL="mysql://${DB_USER}:${DB_PASS_URL}@${DB_HOST}:3306/${DB_NAME}"
NODE_ENV=production
PORT=${PORT}
BIND_HOST=0.0.0.0
JWT_SECRET="${JWT_SECRET}"
JWT_EXPIRES_IN="30d"
APP_NAME_FA="ویزیتیک"
APP_NAME_EN="Vizitik"
BALE_BOT_USERNAME="${BALE_BOT_USERNAME}"
BALE_BOT_TOKEN="${BALE_BOT_TOKEN}"
BALE_ADMIN_CHAT_ID="${BALE_ADMIN_CHAT_ID}"
EOF

  # Build frontend
  log "building frontend"
  cd "$INSTALL_DIR/frontend-app"
  npm_install_safe "$INSTALL_DIR/frontend-app"
  printf 'VITE_API_URL="/api"\n' > .env
  npm run build

  # Build backend
  log "building backend"
  cd "$INSTALL_DIR/backend"
  npm_install_safe "$INSTALL_DIR/backend"
  npx prisma generate
  npx prisma db push --skip-generate
  npm run build

  ok "application built"
}

# ------------------------------------------------------------------
# Service
# ------------------------------------------------------------------
create_service() {
  log "creating systemd service"

  cat > /etc/systemd/system/vizitik.service <<EOF
[Unit]
Description=$APP_NAME
After=network.target mariadb.service

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/backend
ExecStart=$(command -v node) dist/main.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable vizitik
  systemctl restart vizitik
  sleep 2
  systemctl is-active --quiet vizitik && ok "service running" || warn "service failed to start"
}

# ------------------------------------------------------------------
# Nginx
# ------------------------------------------------------------------
setup_nginx() {
  log "configuring Nginx"

  # Backend serves everything (API + frontend), Nginx just proxies
  cat > /etc/nginx/sites-available/vizitik <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
        proxy_buffering off;
    }
}
EOF

  ln -sf /etc/nginx/sites-available/vizitik /etc/nginx/sites-enabled/vizitik
  [[ -e /etc/nginx/sites-enabled/default ]] && rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  ok "nginx configured"
}

# ------------------------------------------------------------------
# Firewall
# ------------------------------------------------------------------
setup_firewall() {
  log "enabling firewall"
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1
  ufw allow 'Nginx Full' >/dev/null 2>&1
  ufw --force enable >/dev/null 2>&1 || true
  ok "firewall enabled"
}

# ------------------------------------------------------------------
# Backup
# ------------------------------------------------------------------
setup_backup() {
  log "creating backup cron"
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
  echo -e "\n\033[1;32m======================================================\033[0m"
  echo -e "\033[1;32m  $APP_NAME deployed! \033[0m"
  echo -e "\033[1;32m  http://$(hostname -I | awk '{print $1}')\033[0m"
  echo -e "\033[1;32m======================================================\033[0m"
  echo "  Logs: journalctl -u vizitik -f"
  echo "  Config: $INSTALL_DIR/backend/.env"
}

# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------
main() {
  for a in "$@"; do
    case "$a" in
      -h|--help) echo "usage: sudo bash scripts/deploy.sh"; exit 0 ;;
    esac
  done

  [[ "$(id -u)" -ne 0 ]] && fail "run as root: sudo bash scripts/deploy.sh"
  . /etc/os-release 2>/dev/null || fail "unknown OS"
  case "$ID" in
    ubuntu|debian) ;;
    *) fail "Ubuntu/Debian required" ;;
  esac

  collect_inputs
  install_prereqs
  ensure_swap
  setup_database
  build_app
  create_service
  setup_nginx
  setup_firewall
  setup_backup
  final_summary
}

main "$@"
