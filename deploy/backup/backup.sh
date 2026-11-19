#!/bin/sh
# Backups into /backups, with an optional off-machine copy. Restore: deploy/INSTALL.md → "Restore from a backup".
#   backup.sh         nightly: Postgres dump + uploads archive, kept BACKUP_KEEP_DAYS days
#   backup.sh quick   during the day: a database snapshot only (mono-db-<stamp>-q.dump), kept BACKUP_QUICK_KEEP_HOURS
#                     hours, and new uploaded files copied off the machine — so a failure loses minutes, not a day
#   backup.sh base    after the nightly dump: a copy of the database's own files (base/base-<stamp>.tar.gz). With
#                     the write-ahead log pieces in wal/ it rebuilds the database as it was at any minute since
#                     (deploy/restore-pitr.sh). BACKUP_BASE_KEEP copies are kept (2), and the log pieces they need.
#   backup.sh wal     every two minutes: new log pieces copied off the machine (when rclone is set up)
#   backup.sh verify  once a week: the newest nightly dump is restored into a scratch database and checked
#   backup.sh disk    every five minutes: how full the disks are, for the health check
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

# What the health check reads (a row per kind in the database): mark <key> <true|false> <note>.
# Never fails a backup: an older database has no such table yet.
mark() {
  psql -qAt -v k="$1" -v ok="$2" -v note="$3" <<'SQL' >/dev/null 2>&1 || true
insert into ops_marks (key, ok, note, at) values (:'k', :'ok', :'note', now())
on conflict (key) do update set ok = excluded.ok, note = excluded.note, at = excluded.at;
SQL
}
# How full the disks are, as the backup container sees them (the database's files, the backups, the uploads).
disk_mark() {
  pct() { [ -d "$1" ] && df -P "$1" | awk 'NR==2 { sub("%", "", $5); print $5 }' || echo 0; }
  mark disk true "pg=$(pct "${BACKUP_PGDATA:-/pgdata}") backups=$(pct "$DEST") uploads=$(pct "$UPLOADS")"
}

if [ "$MODE" = "disk" ]; then disk_mark; exit 0; fi

if [ "$MODE" = "verify" ]; then
  # The weekly proof that the backups can be restored: the newest nightly dump is restored into a scratch
  # database beside the real one, looked at, and dropped. The result is what the health check shows.
  LATEST="$(ls -1 "$DEST" | grep -E '^mono-db-[0-9]{8}-[0-9]{4}\.dump$' | sort | tail -1 || true)"
  [ -n "$LATEST" ] || { mark restore_test false "no nightly backup to test"; echo "[backup] restore test: no nightly backup yet"; exit 1; }
  START="$(date +%s)"
  dropdb --if-exists --force mono_restore_test
  createdb mono_restore_test
  if pg_restore --no-owner --exit-on-error -d mono_restore_test "$DEST/$LATEST" >/dev/null 2>&1 &&
    N="$(psql -d mono_restore_test -tAc 'select count(*) from companies')" && [ "$N" -ge 1 ]; then
    TOOK=$(( $(date +%s) - START ))
    mark restore_test true "$LATEST restored in ${TOOK}s ($N companies)"
    echo "[backup] restore test passed: $LATEST in ${TOOK}s"
    dropdb --if-exists --force mono_restore_test
    exit 0
  fi
  mark restore_test false "$LATEST could not be restored"
  dropdb --if-exists --force mono_restore_test
  echo "[backup] RESTORE TEST FAILED: $LATEST"; exit 1
fi

if [ "$MODE" = "wal" ]; then
  # No lock needed: pieces are complete files (renamed into place), and copying one twice does no harm.
  off_machine && [ -d "$DEST/wal" ] &&
    rclone --config "$RCLONE_CONF" copy "$DEST/wal" "$RCLONE_REMOTE/wal" --max-age 30m --exclude '.*'
  exit 0
fi

if [ "$MODE" = "base" ]; then
  PGDATA_RO="${BACKUP_PGDATA:-/pgdata}"
  [ -f "$PGDATA_RO/PG_VERSION" ] || { echo "[backup] no database files at $PGDATA_RO; base backup skipped"; exit 0; }
  [ "$(psql -tAc 'show archive_mode')" = "on" ] || { echo "[backup] log archiving is off; base backup skipped"; exit 0; }
  mkdir -p "$DEST/base"
  BASE="$DEST/base/base-$STAMP"
  echo "[backup] $STAMP copying the database's files"
  # One session marks the start, copies the files and marks the end; the label it returns goes with the copy.
  # (tar may warn that a file changed while it was read — the log pieces replayed on restore put that right.)
  psql -v ON_ERROR_STOP=1 -qtA <<SQL > "$BASE.label.partial"
select pg_backup_start('mono-base-$STAMP', true) \\gset skip_
\\! tar -C "$PGDATA_RO" -czf "$BASE.tar.gz.partial" --exclude=./pg_wal --exclude=./postmaster.pid --exclude=./postmaster.opts --exclude=./pg_replslot --exclude=./pg_dynshmem --exclude=./pg_notify --exclude=./pg_serial --exclude=./pg_snapshots --exclude=./pg_stat_tmp --exclude=./pg_subtrans . || true
select labelfile from pg_backup_stop(true);
SQL
  # A copy is good only if it holds the files and the label names a starting log piece.
  if ! tar -tzf "$BASE.tar.gz.partial" >/dev/null 2>&1 || ! grep -q '^START WAL LOCATION' "$BASE.label.partial"; then
    rm -f "$BASE.tar.gz.partial" "$BASE.label.partial"
    mark base false "the copy could not be read back"
    echo "[backup] BASE BACKUP FAILED: the copy could not be read back"; exit 1
  fi
  mv "$BASE.tar.gz.partial" "$BASE.tar.gz"
  mv "$BASE.label.partial" "$BASE.label"
  # Keep the newest copies, and every log piece from the oldest kept copy onwards.
  KEEP_BASE="${BACKUP_BASE_KEEP:-2}"
  ls -1 "$DEST/base" | sed -n 's/^base-\(.*\)\.label$/\1/p' | sort -r | tail -n "+$((KEEP_BASE + 1))" |
    while read -r old; do rm -f "$DEST/base/base-$old.tar.gz" "$DEST/base/base-$old.label"; done
  OLDEST="$(ls -1 "$DEST/base" | sed -n 's/^base-\(.*\)\.label$/\1/p' | sort | head -1)"
  FIRST="$(sed -n 's/^START WAL LOCATION: .* (file \([0-9A-F]*\))$/\1/p' "$DEST/base/base-$OLDEST.label")"
  if [ -n "$FIRST" ] && [ -d "$DEST/wal" ]; then
    for f in "$DEST"/wal/*.gz; do
      [ -e "$f" ] || continue
      n="$(basename "$f" .gz)"
      # Only plain log pieces of the same line of history, older than the first one still needed.
      case "$n" in *.*) continue ;; esac
      [ "${#n}" -eq 24 ] && [ "$(printf '%s\n%s\n' "$n" "$FIRST" | sort | head -1)" = "$n" ] && [ "$n" != "$FIRST" ] && rm -f "$f"
    done
  fi
  if off_machine; then
    rclone --config "$RCLONE_CONF" copy "$DEST/base" "$RCLONE_REMOTE/base" --max-age 2d
    rclone --config "$RCLONE_CONF" delete "$RCLONE_REMOTE/base" --min-age 4d
    rclone --config "$RCLONE_CONF" delete "$RCLONE_REMOTE/wal" --min-age 4d
  fi
  mark base true "$(basename "$BASE").tar.gz"
  echo "[backup] base copy $(basename "$BASE").tar.gz ($(du -h "$BASE.tar.gz" | cut -f1)); log pieces kept: $(ls -1 "$DEST/wal" 2>/dev/null | wc -l)"
  exit 0
fi

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
# A dump that cannot be listed back is not a backup: say so loudly and keep nothing that looks like one.
if ! pg_restore --list "$DEST/mono-db-$STAMP.dump.partial" >/dev/null 2>&1; then
  rm -f "$DEST/mono-db-$STAMP.dump.partial"
  mark backup false "the dump could not be read back"
  echo "[backup] BACKUP FAILED: the dump could not be read back"; exit 1
fi
mv "$DEST/mono-db-$STAMP.dump.partial" "$DEST/mono-db-$STAMP.dump"

if [ -d "$UPLOADS" ]; then
  echo "[backup] archiving uploads"
  tar -czf "$DEST/mono-uploads-$STAMP.tar.gz.partial" -C "$UPLOADS" .
  tar -tzf "$DEST/mono-uploads-$STAMP.tar.gz.partial" >/dev/null ||
    { rm -f "$DEST/mono-uploads-$STAMP.tar.gz.partial"; mark backup false "the uploads archive could not be read back"; echo "[backup] BACKUP FAILED: the uploads archive could not be read back"; exit 1; }
  mv "$DEST/mono-uploads-$STAMP.tar.gz.partial" "$DEST/mono-uploads-$STAMP.tar.gz"
fi

echo "[backup] removing backups older than $KEEP days"
find "$DEST" -maxdepth 1 -name 'mono-*' -mtime "+$KEEP" -print -delete

if off_machine; then
  echo "[backup] copying to $RCLONE_REMOTE"
  rclone --config "$RCLONE_CONF" copy "$DEST" "$RCLONE_REMOTE" --include 'mono-*' --exclude 'mono-db-*-q.dump' --max-age 2d
fi
mark backup true "mono-db-$STAMP.dump ($(du -h "$DEST/mono-db-$STAMP.dump" | cut -f1))"
disk_mark
echo "[backup] done: $(ls -1 "$DEST" | wc -l) files in $DEST"
# The lock is this shell's: let the base copy take its own.
exec 9>&-
"$0" base || echo "[backup] the base copy failed (the dump above is good)"
