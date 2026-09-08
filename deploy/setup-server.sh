#!/usr/bin/env bash
#
# ═══════════════════════════════════════════════════════════════════
#  ویزیتیک — اسکریپت کاملِ استقرار و کانفیگ سرور (Ubuntu / Debian)
# ═══════════════════════════════════════════════════════════════════
#  کارهایی که انجام می‌دهد:
#    ۱) نصب پیش‌نیازها (Nginx, Node, MariaDB, certbot, ابزارهای build)
#    ۲) راه‌اندازی و امن‌سازی MariaDB + ساخت دیتابیسِ دلخواه + ایمپورت دامپ
#    ۳) بیلد بک‌اند NestJS  و  ساخت فایل .env
#    ۴) بیلد فرانت PWA (Vite) + .env آن
#    ۵) سرویس دائمی systemd برای بک‌اند
#    ۶) Nginx (سرو PWA + ریورس‌پروکسی /api)
#    ۷) HTTPS (در صورت دادن دامنه) + فایروال + بکاپ کرون
#
#  طرز استفاده (با دسترسی root / sudo):
#    sudo bash deploy/setup-server.sh
#  می‌توانی مقادیر را یا از پایینِ همین فایل عوض کنی، یا به‌صورت متغیر محیطی بدهی:
#    DOMAIN=app.example.com DB_PASS='...' BALE_BOT_TOKEN='...' sudo -E bash deploy/setup-server.sh
#
#  ⚠️ ایدمپوتنت است؛ اجرای مجدد، سرویس‌ها و کانفیگ را به‌روز می‌کند بدون خرابی.
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# ──────────────────────────────────────────────────────────────────
# ۱) متغیرهای پیکربندی (از این‌جا یا از محیط)
# ──────────────────────────────────────────────────────────────────

# دایرکتوری نصب روی سرور
INSTALL_DIR="${INSTALL_DIR:-/opt/vizitik}"

# دایرکتوری سورس (ریپو) — به‌طور خودکار پوشهٔ والد همین اسکریپت
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${SRC_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

# ── دیتابیس ──
DB_NAME="${DB_NAME:-vizitik_db}"            # ← نام دیتابیس (هر چه بخواهی)
DB_USER="${DB_USER:-vizitik}"               # کاربر دیتابیس
DB_PASS="${DB_PASS:-CHANGE_ME_STRONG_PASSWORD}"   # ← حتماً عوض کن
DB_HOST="localhost"

# ── برند / نام نرم‌افزار ──
APP_NAME_FA="${APP_NAME_FA:-ویزیتیک}"
APP_NAME_EN="${APP_NAME_EN:-Vizitik}"

# ── ربات بله ──
BALE_BOT_TOKEN="${BALE_BOT_TOKEN:-}"              # ← توکن واقعی ربات را بده
BALE_BOT_USERNAME="${BALE_BOT_USERNAME:-HesabchinBot}"
BALE_ADMIN_CHAT_ID="${BALE_ADMIN_CHAT_ID:-542633638}"
JWT_SECRET="${JWT_SECRET:-$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)}"

# ── دامنه (خالی بگذار تا HTTPS/دامنه نگیرد) ──
DOMAIN="${DOMAIN:-}"
CERT_EMAIL="${CERT_EMAIL:-admin@example.com}"

# ── پورت‌ها ──
BACKEND_PORT="${BACKEND_PORT:-3000}"
NODEJS_MAJOR=20

# ──────────────────────────────────────────────────────────────────
# ۲) توابع کمکی
# ──────────────────────────────────────────────────────────────────

log()  { echo -e "\n\033[1;36m▸ $*\033[0m"; }
ok()   { echo -e "\033[1;32m  ✔ $*\033[0m"; }
warn() { echo -e "\033[1;33m  ⚠ $*\033[0m"; }
fail() { echo -e "\033[1;31m  ✖ $*\033[0m" >&2; exit 1; }

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    fail "این اسکریپت باید با root اجرا شود. (sudo bash $0)"
  fi
}

distro_check() {
  . /etc/os-release 2>/dev/null || fail "سیستمعامل ناشناخته است."
  case "$ID" in
    ubuntu|debian) ok "سیستمعامل: $PRETTY_NAME" ;;
    *) fail "این اسکریپت فقط برای Ubuntu/Debian است (شما: $ID)." ;;
  esac
}

# ──────────────────────────────────────────────────────────────────
# ۳) نصب پیش‌نیازها
# ──────────────────────────────────────────────────────────────────

install_prereqs() {
  log "نصب و به‌روزرسانی پیش‌نیازها"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get upgrade -y
  apt-get install -y \
    curl git nginx ufw mariadb-server \
    certbot python3-certbot-nginx \
    build-essential python3 make g++ \
    ca-certificates gnupg jq

  # اطمینان از Node ≥ ۱۸
  local node_major=0
  if command -v node >/dev/null 2>&1; then
    node_major="$(node -v | sed 's/v//;s/\..*//')"
  fi
  if [[ "$node_major" -lt 18 ]]; then
    warn "Node نصب نیست یا قدیمی است؛ نصب Node $NODEJS_MAJOR از nodesource..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODEJS_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi
  ok "Node: $(node -v 2>/dev/null) ، npm: $(npm -v 2>/dev/null)"
}

# ──────────────────────────────────────────────────────────────────
# ۴) دیتابیس
# ──────────────────────────────────────────────────────────────────

setup_database() {
  log "راه‌اندازی دیتابیس MariaDB"
  systemctl enable --now mariadb
  systemctl restart mariadb
  sleep 2

  # امن‌سازیِ حداقلی اگر هنوز رمز root نیست
  if mysql -u root -e "SELECT 1" >/dev/null 2>&1; then
    warn "MySQL root بدون رمز است — بهتر است 'mysql_secure_installation' را بعداً اجرا کنی."
  fi

  # ساخت دیتابیس/کاربر در صورت نبود
  mysql -u root <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
  ok "دیتابیس «${DB_NAME}» و کاربر «${DB_USER}» آماده شد."

  # ایمپورت دامپ در صورت وجود
  local dump="$SRC_DIR/documents/hesabchin.sql"
  if [[ -f "$dump" ]]; then
    log "ایمپورت دامپ اولیه (ساختار)"
    local tmp="/tmp/vizitik_import.sql"
    sed '/CREATE DATABASE/,/^USE `hesabchin`;/d' "$dump" > "$tmp"
    mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$tmp"
    rm -f "$tmp"
    ok "دامپ ایمپورت شد."
  else
    warn "فایل documents/hesabchin.sql پیدا نشد — فقط ساختارِ Prisma با db push ساخته می‌شود."
  fi
}

# ──────────────────────────────────────────────────────────────────
# ۵) کپی سورس به دایرکتوری نصب
# ──────────────────────────────────────────────────────────────────

copy_source() {
  log "کپی کد به $INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  # جلوگیری از کپیِ node_modules/dist در صورت هم‌ریشه‌بودن
  if [[ -d "$SRC_DIR/backend" && -d "$SRC_DIR/frontend-app" ]]; then
    rm -rf "$INSTALL_DIR/backend" "$INSTALL_DIR/frontend-app"
    cp -r "$SRC_DIR/backend" "$SRC_DIR/frontend-app" "$INSTALL_DIR/"
    ok "backend و frontend-app کپی شدند."
  else
    fail "ساختار ریپو در $SRC_DIR پیدا نشد (backend و frontend-app لازم است)."
  fi
}

# ──────────────────────────────────────────────────────────────────
# ۶) بیلد بک‌اند
# ──────────────────────────────────────────────────────────────────

build_backend() {
  log "نصب وابستگی‌ها و بیلد بک‌اند"
  cd "$INSTALL_DIR/backend"
  # ⚠️ باید devDependencies هم نصب شوند چون build از طریق @nestjs/cli (nest build)
  #    و prisma انجام می‌شود که هر دو devDependency هستند.
  npm install --no-audit --no-fund

  npx prisma generate

  cat > .env <<EOF
DATABASE_URL="mysql://${DB_USER}:${DB_PASS}@${DB_HOST}:3306/${DB_NAME}"
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
    warn "BALE_BOT_TOKEN خالی است؛ ربات پیام نمی‌فرستد (بعداً در .env پر کن و سرویس را ری‌استارت کن)."
  fi
  npx prisma db push --skip-generate || warn "db push ناموفق؛ جداول را دستی بررسی کن."
  npm run build
  ok "بک‌اند بیلد شد (dist/main.js)."
}

# ──────────────────────────────────────────────────────────────────
# ۷) بیلد فرانت PWA
# ──────────────────────────────────────────────────────────────────

build_frontend() {
  log "نصب و بیلد فرانت PWA"
  cd "$INSTALL_DIR/frontend-app"
  npm install --no-audit --no-fund
  cat > .env <<EOF
VITE_APP_NAME_FA="${APP_NAME_FA}"
VITE_APP_NAME_EN="${APP_NAME_EN}"
VITE_API_URL="/api"
EOF
  npm run build
  ok "فرانت PWA بیلد شد ($INSTALL_DIR/frontend-app/dist)."
}

# ──────────────────────────────────────────────────────────────────
# ۸) سرویس systemd
# ──────────────────────────────────────────────────────────────────

create_service() {
  log "ایجاد سرویس systemd"
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
  systemctl is-active --quiet vizitik-backend && ok "سرویس فعال است." || warn "سرویس فعال نشد؛ لاگ را ببین: journalctl -u vizitik-backend -n 50"
}

# ──────────────────────────────────────────────────────────────────
# ۹) Nginx
# ──────────────────────────────────────────────────────────────────

setup_nginx() {
  log "پیکربندی Nginx"
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
  ok "Nginx تنظیم شد (دامنه: ${srv})."
}

# ──────────────────────────────────────────────────────────────────
# ۱۰) HTTPS (فقط اگر DOMAIN داده شده باشد)
# ──────────────────────────────────────────────────────────────────

setup_https() {
  if [[ -z "$DOMAIN" ]]; then
    warn "DOMAIN داده نشده؛ از گواهی رد شدیم. (PWA بدون HTTPSِ معتبر نصب/آفلاین نمی‌شود — ببین docs/DEPLOY-UBUNTU.md بخش ۱۱)"
    return
  fi
  log "دریافت گواهی SSL برای $DOMAIN"
  certbot --nginx -d "$DOMAIN" --redirect --agree-tos -m "$CERT_EMAIL" --non-interactive
  ok "HTTPS فعال شد."
}

# ──────────────────────────────────────────────────────────────────
# ۱۱) فایروال
# ──────────────────────────────────────────────────────────────────

setup_firewall() {
  log "پیکربندی فایروال UFW"
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1
  ufw allow 'Nginx Full' >/dev/null 2>&1
  ufw --force enable >/dev/null 2>&1 || true
  ok "UFW فعال شد (SSH + Nginx)."
}

# ──────────────────────────────────────────────────────────────────
# ۱۲) بکاپ کرون
# ──────────────────────────────────────────────────────────────────

setup_backup() {
  log "ایجاد کرون‌جاب بکاپ روزانه دیتابیس"
  mkdir -p /var/backups
  local cron="/etc/cron.d/vizitik-backup"
  cat > "$cron" <<EOF
SHELL=/bin/bash
# دامپ روزانه ساعت ۲ بامداد + نگه‌داری ۷ روز آخر
0 2 * * * root mysqldump -u ${DB_USER} -p'${DB_PASS}' ${DB_NAME} > /var/backups/${DB_NAME}-\$(date +\%F).sql && find /var/backups -name '${DB_NAME}-*.sql' -mtime +7 -delete
EOF
  chmod 644 "$cron"
  ok "بکاپ در /var/backups (نگه‌داری ۷ روز)."
}

# ──────────────────────────────────────────────────────────────────
# ۱۳) خلاصه و تست
# ──────────────────────────────────────────────────────────────────

final_summary() {
  log "تست نهایی"
  local url="http://localhost"
  [[ -n "$DOMAIN" ]] && url="https://$DOMAIN"

  echo
  ok "بک‌اند: curl /api/auth/login —"
  curl -s -X POST "http://127.0.0.1:${BACKEND_PORT}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"phone":"09121234567","password":"123456"}' \
    -o /dev/null -w "  HTTP %{http_code}\n" || warn "پاسخ نگرفت (کاربر/رمز پیش‌فرض در DB موجود نیست)."

  echo -e "\n\033[1;32m══════════════════════════════════════════════\033[0m"
  echo -e "\033[1;32m  استقرار کامل شد! \033[0m"
  echo -e "\033[1;32m  وب‌سایت:  $url\033[0m"
  echo -e "\033[1;32m  API:      $url/api\033[0m"
  echo -e "\033[1;32m══════════════════════════════════════════════\033[0m"
  echo "  نکات بعدی:"
  echo "   • .env را در $INSTALL_DIR/backend/.env چک کن (توکن ربات بله و JWT_SECRET)"
  echo "   • لاگ بک‌اند: journalctl -u vizitik-backend -f"
  echo "   • بدون دامنه، برای نصب PWA ببین docs/DEPLOY-UBUNTU.md بخش ۱۱"
}

# ──────────────────────────────────────────────────────────────────
# اجرا
# ──────────────────────────────────────────────────────────────────

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
