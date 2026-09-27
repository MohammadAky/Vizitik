#!/usr/bin/env bash
# Internal helper shared by server install and full updates. No secrets in cron.
set -euo pipefail
INSTALL_DIR="${1:?install directory required}"
BACKUP_DIR="${2:?backup directory required}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ "$EUID" == 0 ]] || { echo 'Backup cron installation requires root' >&2; exit 1; }
install -d -m 755 "$INSTALL_DIR/scripts"
if [[ "$(realpath "$SCRIPT_DIR/database-backup.py")" != "$(realpath -m "$INSTALL_DIR/scripts/database-backup.py")" ]]; then
  install -m 755 "$SCRIPT_DIR/database-backup.py" "$INSTALL_DIR/scripts/database-backup.py"
fi
printf '#!/usr/bin/env bash\nset -euo pipefail\nexec flock -n /run/lock/vizitik-deploy.lock flock -n /run/lock/vizitik-backup.lock python3 %q --env %q --output %q --reason nightly --keep-days 14\n' \
  "$INSTALL_DIR/scripts/database-backup.py" "$INSTALL_DIR/backend/.env" "$BACKUP_DIR" > /usr/local/sbin/vizitik-backup
chmod 700 /usr/local/sbin/vizitik-backup
printf 'SHELL=/bin/bash\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n0 2 * * * root /usr/local/sbin/vizitik-backup >> /var/log/vizitik-backup.log 2>&1\n' > /etc/cron.d/vizitik-backup
chmod 644 /etc/cron.d/vizitik-backup
systemctl enable --now cron
