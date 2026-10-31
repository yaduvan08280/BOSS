#!/bin/sh
# Runs backup.sh on BACKUP_CRON (default 02:30 every night, in the TZ of this container).
set -eu
CRON="${BACKUP_CRON:-30 2 * * *}"
printenv | grep -E '^(PG|BACKUP_|RCLONE_|TZ)' | sed 's/^/export /' > /etc/backup.env
echo "$CRON . /etc/backup.env && /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "Backups scheduled: $CRON (keep ${BACKUP_KEEP_DAYS:-14} days)"
exec crond -f -l 8
