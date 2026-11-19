#!/bin/sh
# Runs backup.sh on BACKUP_CRON (default 02:30 every night, in the TZ of this container) and a database snapshot on
# BACKUP_QUICK_CRON (default every 15 minutes; set it to "off" to have the nightly backup only).
set -eu
CRON="${BACKUP_CRON:-30 2 * * *}"
QUICK="${BACKUP_QUICK_CRON:-*/15 * * * *}"
printenv | grep -E '^(PG|BACKUP_|RCLONE_|TZ)' | sed -e "s/'/'\\\\''/g" -e "s/^\([^=]*\)=\(.*\)$/export \1='\2'/" > /etc/backup.env
echo "$CRON . /etc/backup.env && /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
if [ "$QUICK" != "off" ]; then
  echo "$QUICK . /etc/backup.env && /usr/local/bin/backup.sh quick >> /proc/1/fd/1 2>&1" >> /etc/crontabs/root
fi
# New write-ahead-log pieces go off the machine every two minutes (only when rclone is set up).
echo "*/2 * * * * . /etc/backup.env && /usr/local/bin/backup.sh wal >> /proc/1/fd/1 2>&1" >> /etc/crontabs/root
# The weekly restore test (Sunday 03:30) and how full the disks are (every five minutes).
echo "${BACKUP_VERIFY_CRON:-30 3 * * 0} . /etc/backup.env && /usr/local/bin/backup.sh verify >> /proc/1/fd/1 2>&1" >> /etc/crontabs/root
echo "*/5 * * * * . /etc/backup.env && /usr/local/bin/backup.sh disk >> /proc/1/fd/1 2>&1" >> /etc/crontabs/root
echo "Backups scheduled: $CRON (keep ${BACKUP_KEEP_DAYS:-14} days); snapshots: $QUICK (keep ${BACKUP_QUICK_KEEP_HOURS:-48} hours)"
exec crond -f -l 8
