#!/bin/sh
# Backups into /backups, with an optional off-machine copy. Restore: deploy/INSTALL.md → "Restore from a backup".
#   backup.sh         nightly: Postgres dump + uploads archive, kept BACKUP_KEEP_DAYS days
#   backup.sh quick   during the day: a database snapshot only (mono-db-<stamp>-q.dump), kept BACKUP_QUICK_KEEP_HOURS
#                     hours, and new uploaded files copied off the machine — so a failure loses minutes, not a day
set -eu
MODE="${1:-full}"
STAMP="$(date +%Y%m%d-%H%M)"
DEST="${BACKUP_DEST:-/backups}"
UPLOADS="${BACKUP_UPLOADS:-/uploads}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
QUICK_KEEP_MIN=$(( ${BACKUP_QUICK_KEEP_HOURS:-48} * 60 ))
RCLONE_CONF="${RCLONE_CONFIG_FILE:-/config/rclone/rclone.conf}"
mkdir -p "$DEST"

# One backup at a time: a snapshot that falls due while the nightly one runs is skipped.
exec 9>"$DEST/.backup.lock"
flock -n 9 || { echo "[backup] another backup is running; skipped"; exit 0; }

off_machine() { [ -n "${RCLONE_REMOTE:-}" ] && [ -f "$RCLONE_CONF" ]; }

if [ "$MODE" = "quick" ]; then
  NAME="mono-db-$STAMP-q.dump"
  pg_dump --format=custom --compress=6 --file="$DEST/$NAME.partial"
  mv "$DEST/$NAME.partial" "$DEST/$NAME"
  find "$DEST" -maxdepth 1 -name 'mono-db-*-q.dump' -mmin "+$QUICK_KEEP_MIN" -delete
  if off_machine; then
    rclone --config "$RCLONE_CONF" copy "$DEST" "$RCLONE_REMOTE" --include 'mono-db-*-q.dump' --max-age 2h
    # Files uploaded since last night: copied (never deleted) so they survive the disk too.
    [ -d "$UPLOADS" ] && rclone --config "$RCLONE_CONF" copy "$UPLOADS" "$RCLONE_REMOTE/uploads-live" --max-age 26h
    rclone --config "$RCLONE_CONF" delete "$RCLONE_REMOTE" --include 'mono-db-*-q.dump' --min-age 3d
  fi
  echo "[backup] snapshot $NAME ($(du -h "$DEST/$NAME" | cut -f1))"
  exit 0
fi

echo "[backup] $STAMP dumping database"
pg_dump --format=custom --compress=6 --file="$DEST/mono-db-$STAMP.dump.partial"
mv "$DEST/mono-db-$STAMP.dump.partial" "$DEST/mono-db-$STAMP.dump"

if [ -d "$UPLOADS" ]; then
  echo "[backup] archiving uploads"
  tar -czf "$DEST/mono-uploads-$STAMP.tar.gz.partial" -C "$UPLOADS" .
  mv "$DEST/mono-uploads-$STAMP.tar.gz.partial" "$DEST/mono-uploads-$STAMP.tar.gz"
fi

echo "[backup] removing backups older than $KEEP days"
find "$DEST" -maxdepth 1 -name 'mono-*' -mtime "+$KEEP" -print -delete

if off_machine; then
  echo "[backup] copying to $RCLONE_REMOTE"
  rclone --config "$RCLONE_CONF" copy "$DEST" "$RCLONE_REMOTE" --include 'mono-*' --exclude 'mono-db-*-q.dump' --max-age 2d
fi
echo "[backup] done: $(ls -1 "$DEST" | wc -l) files in $DEST"
