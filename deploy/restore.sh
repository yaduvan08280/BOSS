#!/bin/sh
# Restore MONO from a nightly backup (deploy/INSTALL.md → "Restore from a backup").
#   ./deploy/restore.sh                    list the backups that can be restored
#   ./deploy/restore.sh 20261105-0230      restore that night's database and uploaded files
# It REPLACES the database. Run it from the repo, as the user who runs MONO, with the same .env (APP_SECRET!).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
C="$ROOT/deploy/compose.sh"
ENV_FILE="${MONO_ENV_FILE:-$ROOT/.env}"
[ -f "$ENV_FILE" ] || { echo "No settings file at $ENV_FILE. Create it first (INSTALL.md step 3) with the SAME APP_SECRET as before."; exit 1; }
DATA_DIR="$(grep -E '^DATA_DIR=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
DATA_DIR="${DATA_DIR:-/srv/mono}"
WEB_PORT="$(grep -E '^WEB_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
WEB_PORT="${WEB_PORT:-8080}"
B="$DATA_DIR/backups"

if [ $# -lt 1 ]; then
  echo "Backups in $B:"
  ls -1 "$B" 2>/dev/null | sed -n 's/^mono-db-\(.*\)\.dump$/  \1/p' | sort -r
  echo "Restore one with:  ./deploy/restore.sh <date-time from the list>"
  exit 0
fi
STAMP="$(basename "$1" | sed -e 's/^mono-db-//' -e 's/\.dump$//')"
DUMP="$B/mono-db-$STAMP.dump"
FILES="$B/mono-uploads-$STAMP.tar.gz"
[ -f "$DUMP" ] || { echo "Not found: $DUMP  (copy the backup files into $B first)"; exit 1; }
[ -f "$FILES" ] || echo "Note: no uploads archive for $STAMP; only the database will be restored."

if [ "${RESTORE_YES:-}" != "1" ]; then
  printf 'This REPLACES the MONO database with the backup from %s. Type yes to go on: ' "$STAMP"
  read -r answer
  [ "$answer" = "yes" ] || { echo "Stopped. Nothing changed."; exit 1; }
fi

mkdir -p "$DATA_DIR/pg" "$DATA_DIR/uploads" "$DATA_DIR/backups" "$DATA_DIR/rclone" 2>/dev/null || true

echo "==> 1/5 Stopping the app (the database keeps running)"
"$C" stop api worker web >/dev/null 2>&1 || true

echo "==> 2/5 Starting the database"
"$C" up -d --build --wait db backup

echo "==> 3/5 Restoring the database from $DUMP"
"$C" exec -T backup sh -c "dropdb --force --if-exists mono && createdb mono && pg_restore --no-owner --exit-on-error -d mono /backups/mono-db-$STAMP.dump"

if [ -f "$FILES" ]; then
  echo "==> 4/5 Restoring uploaded files"
  docker run --rm --entrypoint sh -v "$DATA_DIR/uploads:/u" -v "$B:/b:ro" mono-backup:latest \
    -c "tar -xzf /b/mono-uploads-$STAMP.tar.gz -C /u && chown -R 1000:1000 /u"
else
  echo "==> 4/5 No uploaded files to restore"
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
"$C" exec -T backup psql -tA -c "SELECT 'Companies: ' || count(*) FROM companies WHERE deleted_at IS NULL UNION ALL SELECT 'People: ' || count(*) FROM users WHERE deleted_at IS NULL UNION ALL SELECT 'Last change: ' || to_char(max(created_at) AT TIME ZONE 'Asia/Kolkata', 'DD/MM/YYYY HH24:MI') FROM audit_logs"
curl -fsS "http://127.0.0.1:$WEB_PORT/api/health" && echo
sleep 3
if "$C" logs api 2>/dev/null | grep -q 'SECRET CHECK FAILED'; then
  echo "WARNING: APP_SECRET in .env is not the one the backup was made with. Saved bot tokens, AI keys, Drive and"
  echo "webhooks can't be read. Put the original APP_SECRET back and run: ./deploy/compose.sh up -d --force-recreate api worker"
  exit 2
fi
echo "Restore done. Sign in and check today's work."
