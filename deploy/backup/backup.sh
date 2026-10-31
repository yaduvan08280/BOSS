#!/bin/sh
# Nightly backup: Postgres dump + uploads archive into /backups, keep N days, optional off-machine copy.
# Restore: see deploy/INSTALL.md → "Restore from a backup".
set -eu
STAMP="$(date +%Y%m%d-%H%M)"
DEST="/backups"
KEEP="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$DEST"

echo "[backup] $STAMP dumping database"
pg_dump --format=custom --compress=6 --file="$DEST/mono-db-$STAMP.dump.partial"
mv "$DEST/mono-db-$STAMP.dump.partial" "$DEST/mono-db-$STAMP.dump"

if [ -d /uploads ]; then
  echo "[backup] archiving uploads"
  tar -czf "$DEST/mono-uploads-$STAMP.tar.gz.partial" -C /uploads .
  mv "$DEST/mono-uploads-$STAMP.tar.gz.partial" "$DEST/mono-uploads-$STAMP.tar.gz"
fi

echo "[backup] removing backups older than $KEEP days"
find "$DEST" -maxdepth 1 -name 'mono-*' -mtime "+$KEEP" -print -delete

if [ -n "${RCLONE_REMOTE:-}" ] && [ -f /config/rclone/rclone.conf ]; then
  echo "[backup] copying to $RCLONE_REMOTE"
  rclone --config /config/rclone/rclone.conf copy "$DEST" "$RCLONE_REMOTE" --include 'mono-*' --max-age 2d
fi
echo "[backup] done: $(ls -1 "$DEST" | wc -l) files in $DEST"
