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
JWT_SECRET="${JWT_SECRET:-}"   # a fresh one is generated while asking, if this is empty

DOMAIN="${DOMAIN:-}"
CERT_EMAIL="${CERT_EMAIL:-}"

BACKEND_PORT="${BACKEND_PORT:-3000}"
WITH_WWW="${WITH_WWW:-0}"
# HTTPS_MODE=http      classic HTTP-01 challenge (needs port 80 reachable from anywhere)
# HTTPS_MODE=dns       DNS-01 challenge through a Cloudflare API token (works when the
#                      hoster only serves traffic from Iran and blocks foreign probes)
HTTPS_MODE="${HTTPS_MODE:-}"
CF_API_TOKEN="${CF_API_TOKEN:-}"
NODEJS_MAJOR=20

# ------------------------------------------------------------------
# Behaviour switches - each one is also offered as a question
#   ASK=1 ask for anything that is not already set in the environment
#   ASK=0 never ask, use the environment values and the defaults above
# ------------------------------------------------------------------
ASK="${ASK:-1}"
YES="${YES:-0}"
ENABLE_HTTPS="${ENABLE_HTTPS:-1}"
ENABLE_UFW="${ENABLE_UFW:-1}"
ENABLE_BACKUP="${ENABLE_BACKUP:-1}"
TEST_PHONE="${TEST_PHONE:-}"
TEST_PASSWORD="${TEST_PASSWORD:-}"

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

gen_secret() {
  head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48
}

is_tty() { [[ -t 0 ]]; }

can_ask() { [[ "${ASK:-1}" == "1" ]] && is_tty; }

set_var() { printf -v "$1" '%s' "$2"; }

# ask <varname> <prompt> [default] - Enter keeps the value in brackets
ask() {
  local name="$1" prompt="$2" default="${3:-}" cur="" ans=""
  cur="${!name:-}"
  if ! can_ask; then
    if [[ -z "$cur" ]]; then set_var "$name" "$default"; fi
    return 0
  fi
  if [[ -n "$cur" ]]; then
    read -r -p "  $prompt [$cur]: " ans || ans=""
  else
    read -r -p "  $prompt [${default:-none}]: " ans || ans=""
  fi
  if [[ -z "$ans" ]]; then ans="${cur:-$default}"; fi
  set_var "$name" "$ans"
}

# ask_secret <varname> <prompt> - hidden input typed twice; empty input keeps the current value
ask_secret() {
  local name="$1" prompt="$2" cur="" a="" b="" keep=""
  cur="${!name:-}"
  if ! can_ask; then
    if [[ -z "$cur" || "$cur" == CHANGE_ME* ]]; then
      warn "$name is not set (or still a placeholder) and there is no terminal to ask for it"
      return 1
    fi
    return 0
  fi
  local tries=0
  while :; do
    read -r -s -p "  $prompt: " a || { printf '\n'; return 1; }
    printf '\n'
    if [[ -z "$a" ]]; then
      read -r -p "  keep the current value? [y/N]: " keep || return 1
      if [[ "$keep" =~ ^[Yy] ]]; then return 0; fi
      continue
    fi
    read -r -s -p "  repeat it: " b || { printf '\n'; return 1; }
    printf '\n'
    if [[ "$a" != "$b" ]]; then
      (( ++tries ))
      if (( tries >= 3 )); then warn "too many mismatches for $name"; return 1; fi
      warn "the two entries do not match"
      continue
    fi
    set_var "$name" "$a"
    return 0
  done
}

# ask_yes <varname> <prompt> <1|0 default>
ask_yes() {
  local name="$1" prompt="$2" default="${3:-1}" cur="" ans=""
  cur="${!name:-}"
  if ! can_ask; then
    if [[ -z "$cur" ]]; then set_var "$name" "$default"; fi
    return 0
  fi
  read -r -p "  $prompt [Y/n]: " ans || ans=""
  if [[ -z "$ans" ]]; then ans="${cur:-$default}"; fi
  case "$ans" in
    [Nn]*|0) set_var "$name" 0 ;;
    *)       set_var "$name" 1 ;;
  esac
}

print_config_summary() {
  local dbpass_state="not set"
  if [[ -n "$DB_PASS" ]]; then dbpass_state="set"; fi
  local tok_state="none"
  if [[ -n "$BALE_BOT_TOKEN" ]]; then tok_state="set"; fi
  local test_state="skipped"
  if [[ -n "$TEST_PHONE" ]]; then test_state="$TEST_PHONE"; fi
  echo
  echo "  install dir : $INSTALL_DIR"
  echo "  source dir  : $SRC_DIR"
  local shown="$DOMAIN"
  if [[ -n "$DOMAIN" && "${WITH_WWW:-0}" == "1" ]]; then shown="$DOMAIN www.$DOMAIN"; fi
  echo "  domain      : ${shown:-<none - plain http on the server ip>}"
  echo "  https       : $ENABLE_HTTPS mode=${HTTPS_MODE:-http} (email: ${CERT_EMAIL:-<none>})"
  echo "  api         : 127.0.0.1:${BACKEND_PORT}, proxied at /api"
  echo "  database    : ${DB_USER}@${DB_HOST}/${DB_NAME} (password: $dbpass_state)"
  echo "  jwt secret  : ${#JWT_SECRET} characters"
  echo "  bale bot    : ${BALE_BOT_USERNAME:-<disabled>} token: $tok_state admin chat: ${BALE_ADMIN_CHAT_ID:-<none>}"
  echo "  brand       : ${APP_NAME_EN} / ${APP_NAME_FA}"
  echo "  firewall    : $ENABLE_UFW   nightly backup: $ENABLE_BACKUP"
  echo "  smoke test  : $test_state"
}

collect_inputs() {
  log "questions - press Enter to keep the value shown in brackets"

  ask INSTALL_DIR "install directory" "/opt/vizitik"

  ask DOMAIN "public domain of the app (empty = no https)" ""
  if [[ -n "$DOMAIN" ]] && ! [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*\.)+[A-Za-z]{2,}$ ]]; then
    warn "'$DOMAIN' does not look like a full domain name (app.example.com expected)"
  fi
  if [[ -n "$DOMAIN" ]]; then
    ask_yes ENABLE_HTTPS "get a Let's Encrypt certificate for $DOMAIN" 1
    if [[ "$ENABLE_HTTPS" == "1" ]]; then
      ask CERT_EMAIL "email used for the certificate" ""
      if [[ "$CERT_EMAIL" != *@*.* ]]; then warn "'$CERT_EMAIL' is not a valid email, certbot may fail"; fi
    fi
  else
    ENABLE_HTTPS=0
  fi

  if [[ -n "$DOMAIN" ]]; then
    ask_yes WITH_WWW "also serve www.$DOMAIN" 1
  fi

  if [[ "$ENABLE_HTTPS" == "1" ]]; then
    if [[ -z "$HTTPS_MODE" ]]; then
      echo
      echo "  how should Let's Encrypt prove that $DOMAIN belongs to you?"
      echo "    1) http - needs port 80 reachable from outside (default)"
      echo "    2) dns  - uses a Cloudflare API token, works even if the hoster blocks"
      echo "              foreign traffic (common on Iranian hosting)"
      read -r -p "  choose 1 or 2 [1]: " hm || hm=""
      case "$hm" in
        2|dns) HTTPS_MODE="dns" ;;
        *)     HTTPS_MODE="http" ;;
      esac
    fi
    if [[ "$HTTPS_MODE" == "dns" ]]; then
      ask_secret CF_API_TOKEN "Cloudflare API token with Zone.DNS edit permission" || true
      if [[ -z "$CF_API_TOKEN" ]]; then
        fail "HTTPS_MODE=dns needs CF_API_TOKEN (create it at my.cloudflare.com/api-tokens: Edit zone DNS, zone vizitik.ir)"
      fi
    fi
  fi

  ask BACKEND_PORT "backend port (listens on localhost only)" "3000"
  if ! [[ "$BACKEND_PORT" =~ ^[0-9]+$ ]] || (( BACKEND_PORT <= 1024 || BACKEND_PORT >= 65536 )); then
    fail "BACKEND_PORT must be a number between 1025 and 65535"
  fi

  ask DB_HOST "database host" "localhost"
  ask DB_NAME "database name" "vizitik_db"
  if ! [[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]]; then
    fail "the database name may only contain letters, digits and underscore"
  fi
  ask DB_USER "database user" "vizitik"
  if [[ -z "$DB_PASS" || "$DB_PASS" == CHANGE_ME* ]]; then
    if ! ask_secret DB_PASS "password for the database user '$DB_USER'"; then DB_PASS=""; fi
  fi
  if [[ -z "$DB_PASS" ]]; then fail "a database password is required (export DB_PASS or answer the prompt)"; fi
  if [[ "$DB_PASS" == CHANGE_ME* ]]; then fail "DB_PASS still contains the CHANGE_ME placeholder"; fi
  if (( ${#DB_PASS} < 8 )); then warn "the database password is short - 8 characters or more is better"; fi

  ask APP_NAME_EN "brand name (latin, used by the API and the logs)" "Vizitik"
  ask APP_NAME_FA "brand name (persian, shown in bot messages)" ""
  ask BALE_BOT_USERNAME "Bale bot username without @ (empty = bot stays off)" ""
  if [[ -n "$BALE_BOT_USERNAME" ]]; then
    if ! ask_secret BALE_BOT_TOKEN "Bale bot token (the one from BotFather)"; then BALE_BOT_TOKEN=""; fi
    if [[ -n "$BALE_BOT_TOKEN" ]] && ! [[ "$BALE_BOT_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{20,}$ ]]; then
      warn "that does not look like a Bale token (expected 123456789:long-random-part)"
    fi
    if [[ -z "$BALE_BOT_TOKEN" ]]; then warn "no token - OTP codes and invoices will not be delivered"; fi
    ask BALE_ADMIN_CHAT_ID "admin chat id for alerts (digits, empty = none)" ""
    if [[ -n "$BALE_ADMIN_CHAT_ID" ]] && ! [[ "$BALE_ADMIN_CHAT_ID" =~ ^[0-9]+$ ]]; then
      warn "BALE_ADMIN_CHAT_ID should contain digits only, got: $BALE_ADMIN_CHAT_ID"
    fi
  else
    BALE_BOT_TOKEN=""
    BALE_ADMIN_CHAT_ID=""
    warn "Bale bot disabled - users cannot receive OTP codes on Bale"
  fi

  if [[ -z "$JWT_SECRET" ]]; then
    JWT_SECRET="$(gen_secret)"
    ok "generated a fresh JWT secret - it is written to $INSTALL_DIR/backend/.env"
  fi

  ask_yes ENABLE_UFW "enable the UFW firewall (SSH and Nginx get allowed)" 1
  ask_yes ENABLE_BACKUP "install a nightly database backup cron job" 1

  ask TEST_PHONE "phone of an existing account for the login test (empty = skip)" ""
  if [[ -n "$TEST_PHONE" ]]; then
    if ! ask_secret TEST_PASSWORD "and its password"; then TEST_PASSWORD=""; fi
  fi

  print_config_summary
  if [[ "$YES" != "1" && "${CHECK_ONLY:-0}" != "1" ]] && is_tty; then
    local reply=""
    read -r -p "  apply all of this to the current server? [y/N]: " reply || reply=""
    if ! [[ "$reply" =~ ^[Yy] ]]; then fail "aborted by the user - nothing was changed"; fi
  fi
}

usage() {
  cat <<'TXT'
usage: sudo bash scripts/setup-server.sh [options]

  --check              answer the questions and print the summary, change nothing
  -y, --yes            skip the final confirmation
  --non-interactive    never prompt; use environment values and the defaults
  -h, --help           this text

environment overrides:
  INSTALL_DIR SRC_DIR DOMAIN CERT_EMAIL BACKEND_PORT
  DB_HOST DB_NAME DB_USER DB_PASS APP_NAME_FA APP_NAME_EN
  BALE_BOT_USERNAME BALE_BOT_TOKEN BALE_ADMIN_CHAT_ID JWT_SECRET
  ENABLE_HTTPS ENABLE_UFW ENABLE_BACKUP TEST_PHONE TEST_PASSWORD
TXT
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
BIND_HOST=127.0.0.1
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
  local names="_"
  if [[ -n "$DOMAIN" ]]; then
    names="$DOMAIN"
    if [[ "$WITH_WWW" == "1" ]]; then names="$DOMAIN www.$DOMAIN"; fi
  fi
  local conf="/etc/nginx/sites-available/vizitik"

  log "what nginx serves right now (useful when port 80 was already taken)"
  nginx -T 2>/dev/null | grep -E '^[[:space:]]*(server_name|listen|root|proxy_pass)' | head -20 || true

  cat > "$conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${names};
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
  if [[ -e /etc/nginx/sites-enabled/default ]]; then
    mv /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.disabled-by-vizitik 2>/dev/null || true
    warn "the previous default nginx site was disabled (renamed to default.disabled-by-vizitik)"
  fi
  if ! nginx -t; then
    fail "the nginx configuration test failed - fix the reported error and run this script again"
  fi
  systemctl reload nginx
  ok "Nginx configured (server_name: ${names})"
}

# ------------------------------------------------------------------
# 10) HTTPS
# ------------------------------------------------------------------

setup_https() {
  if [[ -z "$CERT_EMAIL" ]]; then
    warn "CERT_EMAIL is empty; certbot needs one. Skipping HTTPS."
    return
  fi
  if [[ "$ENABLE_HTTPS" != "1" ]] || [[ -z "$DOMAIN" ]]; then
    warn "HTTPS skipped. (installing the PWA needs valid HTTPS - see docs/DEPLOY-UBUNTU.md section 11)"
    return
  fi
  log "requesting SSL certificate for $DOMAIN (mode: ${HTTPS_MODE:-http})"
  local logf="/var/log/vizitik-certbot.log"
  local -a cnames=( -d "$DOMAIN" )
  if [[ "$WITH_WWW" == "1" ]]; then cnames+=( -d "www.$DOMAIN" ); fi

  report_certbot_failure() {
    local rc="$1"
    warn "certbot failed (exit $rc). last lines of $logf:"
    tail -n 16 "$logf" 2>/dev/null | sed 's/^/      /'
    if grep -qiE "timeout|could not connect|connection refused|ConnectError|ReadTimeout|FetchError" "$logf" 2>/dev/null; then
      echo "      -> port 80 was not reachable from the internet. Some Iranian hosters only serve"
      echo "         traffic from inside Iran, and a Cloudflare origin without a certificate answers"
      echo "         521. Either open port 80 for all visitors in the hosting firewall, or issue the"
      echo "         certificate through the Cloudflare DNS API (no inbound connection needed):"
      echo "           CF_API_TOKEN=<token> HTTPS_MODE=dns sudo -E bash scripts/setup-server.sh --yes"
    elif grep -qiE "NXDOMAIN|DNS problem|no such domain" "$logf" 2>/dev/null; then
      echo "      -> $DOMAIN does not resolve to this server yet. Check: dig +short $DOMAIN"
    elif grep -qiE "Problem binding to port 80|already in use|could not bind" "$logf" 2>/dev/null; then
      echo "      -> something else holds port 80: ss -ltnp | grep ':80'"
    elif grep -qiE "rate limit|too many certificates|rateLimited" "$logf" 2>/dev/null; then
      echo "      -> Let's Encrypt rate limit. Wait an hour, or dry-run with --staging first."
    elif grep -qiE "invalid contact|malformed|unapproved_account" "$logf" 2>/dev/null; then
      echo "      -> the e-mail was rejected; fix CERT_EMAIL=$CERT_EMAIL and run again"
    fi
    echo "      full log: cat $logf"
    return 1
  }

  ensure_dns_plugin() {
    if ! certbot plugins 2>/dev/null | grep -qi cloudflare; then
      log "installing the certbot Cloudflare DNS plugin"
      apt-get install -y python3-certbot-dns-cloudflare >/dev/null 2>&1 \
        || pip3 install -q certbot-dns-cloudflare >/dev/null 2>&1 \
        || fail "could not install certbot-dns-cloudflare; run: pip3 install certbot-dns-cloudflare"
    fi
  }

  write_dns_credentials() {
    local creds="/etc/letsencrypt/cloudflare.credentials"
    [[ -n "$CF_API_TOKEN" ]] || fail "HTTPS_MODE=dns needs CF_API_TOKEN (create one at dash.cloudflare.com -> My Account -> API Tokens -> template 'Edit zone DNS', zone $DOMAIN)"
    mkdir -p "$(dirname "$creds")"
    printf "dns_cloudflare_api_token = %s\n" "$CF_API_TOKEN" > "$creds"
    chmod 600 "$creds"
    ok "Cloudflare API token written to $creds (mode 600)"
    echo "$creds"
  }

  if [[ "$HTTPS_MODE" == "dns" ]]; then
    ensure_dns_plugin
    local creds
    creds="$(write_dns_credentials | tail -n 1)"
    local rc=0
    certbot certonly -a dns-cloudflare --dns-cloudflare-credentials "$creds" \
      --dns-cloudflare-propagation-seconds 30 "${cnames[@]}" --agree-tos -m "$CERT_EMAIL" -n \
      >"$logf" 2>&1 || rc=$?
    if (( rc != 0 )); then report_certbot_failure "$rc"; fi
    certbot --nginx --redirect -n "${cnames[@]}" >>"$logf" 2>&1 \
      || warn "the certificate exists but nginx was not switched to it; run: certbot --nginx --redirect -n ${cnames[*]}"
    ok "HTTPS enabled with a managed certificate (renew: certbot renew -q)"
    return
  fi

  # HTTP-01: port 80 has to be reachable from the internet, so probe it first
  local probe="acme-probe-$$.txt"
  if [[ -d "$INSTALL_DIR/frontend-app/dist" ]]; then
    echo ok > "$INSTALL_DIR/frontend-app/dist/$probe"
    local code
    code="$(curl -s -o /dev/null -m 25 -w '%{http_code}' "http://$DOMAIN/$probe" 2>/dev/null)"
    rm -f "$INSTALL_DIR/frontend-app/dist/$probe"
    if [[ "$code" != "200" ]]; then
      warn "http://$DOMAIN/$probe returned '${code:-nothing}' from this box - Let's Encrypt needs the same path"
      if can_ask; then
        local reply=""
        read -r -p "  retry with the Cloudflare DNS challenge instead? [Y/n]: " reply || reply=""
        if [[ ! "$reply" =~ ^[Nn] ]]; then
          if [[ -z "$CF_API_TOKEN" ]]; then ask_secret CF_API_TOKEN "Cloudflare API token (Edit zone DNS)"; fi
          HTTPS_MODE="dns"
          setup_https
          return
        fi
      fi
    fi
  fi

  local rc=0
  certbot --nginx "${cnames[@]}" --redirect --agree-tos -m "$CERT_EMAIL" --non-interactive >"$logf" 2>&1 || rc=$?
  if (( rc != 0 )); then
    if can_ask && ! grep -qiE "rate limit|too many certificates" "$logf" 2>/dev/null; then
      local reply=""
      read -r -p "  try again with the Cloudflare DNS challenge (works without inbound port 80)? [Y/n]: " reply || reply=""
      if [[ ! "$reply" =~ ^[Nn] ]]; then
        if [[ -z "$CF_API_TOKEN" ]]; then ask_secret CF_API_TOKEN "Cloudflare API token (Edit zone DNS)"; fi
        HTTPS_MODE="dns"
        setup_https
        return
      fi
    fi
    report_certbot_failure "$rc"
  fi
  ok "HTTPS enabled (renew check: certbot renew --dry-run)"
}

# ------------------------------------------------------------------
# 11) firewall
# ------------------------------------------------------------------

setup_firewall() {
  if [[ "$ENABLE_UFW" != "1" ]]; then warn "UFW skipped (ENABLE_UFW=0)"; return 0; fi
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
  if [[ "$ENABLE_BACKUP" != "1" ]]; then warn "backup cron skipped (ENABLE_BACKUP=0)"; return 0; fi
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
  if [[ -n "$DOMAIN" ]]; then
    echo "   - open $url in a browser and register the first visitor account"
    echo "     (the registration OTP is delivered by the Bale bot, so BALE_BOT_TOKEN must be set)"
  fi
  echo "   - review $INSTALL_DIR/backend/.env (BALE_BOT_TOKEN and JWT_SECRET)"
  echo "   - backend logs: journalctl -u vizitik-backend -f"
  echo "   - without a domain, see docs/DEPLOY-UBUNTU.md section 11 for PWA install"
}

# ------------------------------------------------------------------
# ------------------------------------------------------------------

main() {
  local mode="deploy"
  local a
  for a in "$@"; do
    case "$a" in
      --check) mode="check" ;;
      -y|--yes) YES=1 ;;
      --non-interactive|--defaults) ASK=0 ;;
      -h|--help) usage; exit 0 ;;
      *) fail "unknown argument: $a (see --help)" ;;
    esac
  done

  if [[ "$mode" == "check" ]]; then
    CHECK_ONLY=1
    collect_inputs
    ok "preflight finished - nothing on this server was changed"
    exit 0
  fi

  require_root
  distro_check
  collect_inputs
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
