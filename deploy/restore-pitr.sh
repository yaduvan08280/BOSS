#!/bin/sh
# Rebuild the MONO database as it was at a chosen minute, from a nightly base copy and the write-ahead-log
# pieces kept since (deploy/RUNBOOK.md → "Restore"). Uploaded files are not touched: restore those with
# restore.sh, or leave them — they are only ever added to.
#   ./deploy/restore-pitr.sh                                   list the base copies and the span they cover
#   ./deploy/restore-pitr.sh 20261119-0230                     that base copy, then every change up to the last one saved
#   ./deploy/restore-pitr.sh 20261119-0230 "2026-11-19 13:05"  ... up to that minute (the server's clock: IST unless told otherwise)
# The database it replaces is kept beside it (pg.before-<time>) until you delete it.
# PITR_DB_ONLY=1 stops after the database is up, so you can look before MONO starts.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
C="$ROOT/deploy/compose.sh"
ENV_FILE="${MONO_ENV_FILE:-$ROOT/.env}"
[ -f "$ENV_FILE" ] || { echo "No settings file at $ENV_FILE."; exit 1; }
val() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' || true; }
DATA_DIR="$(val DATA_DIR)"; DATA_DIR="${DATA_DIR:-/srv/mono}"
WEB_PORT="$(val WEB_PORT)"; WEB_PORT="${WEB_PORT:-8080}"
B="$DATA_DIR/backups"

if [ $# -lt 1 ]; then
  echo "Base copies in $B/base (each can be rolled forward to any minute after it was taken):"
  for l in $(ls -1 "$B/base" 2>/dev/null | sed -n 's/^base-\(.*\)\.label$/\1/p' | sort -r); do
    echo "  $l   taken $(sed -n 's/^START TIME: //p' "$B/base/base-$l.label")"
  done
  echo "Log pieces kept: $(ls -1 "$B/wal" 2>/dev/null | wc -l); newest $(ls -1t "$B/wal" 2>/dev/null | head -1)"
  echo "Restore with:  ./deploy/restore-pitr.sh <base copy> [\"YYYY-MM-DD HH:MM\"]"
  exit 0
fi
STAMP="$1"
UNTIL="${2:-}"
TAR="$B/base/base-$STAMP.tar.gz"
LABEL="$B/base/base-$STAMP.label"
[ -f "$TAR" ] && [ -f "$LABEL" ] || { echo "Not found: $TAR and its .label (copy them into $B/base first)"; exit 1; }
[ -d "$B/wal" ] || { echo "No log pieces at $B/wal: a base copy alone cannot be opened."; exit 1; }
TZ_NAME="$(val BACKUP_TZ)"; TZ_NAME="${TZ_NAME:-Asia/Kolkata}"

if [ "${RESTORE_YES:-}" != "1" ]; then
  printf 'This REPLACES the MONO database with base copy %s rolled forward to %s. Type yes to go on: ' \
    "$STAMP" "${UNTIL:-the last change saved}"
  read -r answer
  [ "$answer" = "yes" ] || { echo "Stopped. Nothing changed."; exit 1; }
fi

echo "==> 1/5 Stopping MONO and the database"
"$C" stop api worker web backup db >/dev/null 2>&1 || true

echo "==> 2/5 Setting the present database aside"
KEPT=""
if [ -d "$DATA_DIR/pg" ] && [ -n "$(ls -A "$DATA_DIR/pg" 2>/dev/null)" ]; then
  KEPT="pg.before-$(date +%Y%m%d-%H%M%S)"
  docker run --rm -v "$DATA_DIR:/d" postgres:16-alpine sh -c "mv /d/pg /d/$KEPT && mkdir /d/pg"
  echo "    kept as $DATA_DIR/$KEPT"
else
  mkdir -p "$DATA_DIR/pg"
fi

echo "==> 3/5 Unpacking the base copy and telling the database how far to roll forward"
# The last log pieces the old database had not handed over yet (it was stopped a moment ago, or the machine
# died with them still on its disk) are used too, so nothing saved is lost.
docker run --rm -e UNTIL="$UNTIL" -e TZ_NAME="$TZ_NAME" -e KEPT="$KEPT" \
  -v "$DATA_DIR:/d" -v "$B:/b:ro" postgres:16-alpine sh -euc '
    cd /d/pg
    tar -xzf "/b/base/base-'"$STAMP"'.tar.gz"
    cp "/b/base/base-'"$STAMP"'.label" backup_label
    mkdir -p pg_wal pg_replslot pg_dynshmem pg_notify pg_serial pg_snapshots pg_stat_tmp pg_subtrans
    if [ -n "$KEPT" ] && [ -d "/d/$KEPT/pg_wal" ]; then
      for f in /d/$KEPT/pg_wal/0*; do
        [ -f "$f" ] && [ ! -f "/b/wal/$(basename "$f").gz" ] && cp "$f" pg_wal/ || true
      done
    fi
    : > recovery.signal
    {
      echo "restore_command = '"'"'gunzip -c /wal/%f.gz > %p'"'"'"
      echo "recovery_target_action = '"'"'promote'"'"'"
      [ -n "$UNTIL" ] && echo "recovery_target_time = '"'"'$UNTIL $TZ_NAME'"'"'" || true
    } >> postgresql.auto.conf
    chown -R 70:70 /d/pg
    chmod 700 /d/pg
  '

echo "==> 4/5 Starting the database (it replays the log; this can take a few minutes)"
"$C" up -d --wait db
i=0
until [ "$("$C" exec -T db psql -U mono -d mono -tAc 'select not pg_is_in_recovery()' 2>/dev/null)" = "t" ]; do
  i=$((i + 1))
  [ "$i" -le 300 ] || { echo "The database is still replaying after 10 minutes. See: ./deploy/compose.sh logs --tail 50 db"; exit 1; }
  sleep 2
done

if [ "${PITR_DB_ONLY:-}" = "1" ]; then
  echo "The database is up at the chosen moment; MONO itself was left stopped (PITR_DB_ONLY=1)."
  echo "Look at it with:  ./deploy/compose.sh exec db psql -U mono -d mono      Start MONO with:  ./deploy/compose.sh up -d"
  exit 0
fi

echo "==> 5/5 Starting MONO (newer migrations are applied first)"
"$C" up -d --build
i=0
until curl -fsS "http://127.0.0.1:$WEB_PORT/api/health" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -le 90 ] || { echo "MONO did not come up in 3 minutes. See: ./deploy/compose.sh logs --tail 50 migrate api"; exit 1; }
  sleep 2
done
echo
"$C" exec -T db psql -U mono -d mono -tA -c "SELECT 'Companies: ' || count(*) FROM companies WHERE deleted_at IS NULL UNION ALL SELECT 'People: ' || count(*) FROM users WHERE deleted_at IS NULL UNION ALL SELECT 'Last change: ' || to_char(max(created_at) AT TIME ZONE '$TZ_NAME', 'DD/MM/YYYY HH24:MI:SS') FROM audit_logs"
echo "Done. When you are sure, delete the database that was set aside: $DATA_DIR/${KEPT:-(none)}"
