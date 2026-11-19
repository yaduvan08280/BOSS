#!/bin/sh
# Update MONO to the newest code — with a backup first, a check after, and a way back.
#   ./deploy/update.sh              backup → get the code → build → migrate → start → check
#   ./deploy/update.sh --back <id>  go back to an earlier version (the id is printed by every update)
# The old version keeps running while the new one is built; people are interrupted for a few seconds at
# the restart. Migrations only ever add (docs/database.md, rule 5), so the old code runs on the new
# database — going back needs no restore unless the new version wrote something wrong.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
C="$ROOT/deploy/compose.sh"
ENV_FILE="${MONO_ENV_FILE:-$ROOT/.env}"
[ -f "$ENV_FILE" ] || { echo "No settings file at $ENV_FILE."; exit 1; }
WEB_PORT="$(grep -E '^WEB_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
WEB_PORT="${WEB_PORT:-8080}"
URL="http://127.0.0.1:$WEB_PORT"
cd "$ROOT"
BEFORE="$(git rev-parse --short HEAD)"

wait_for() { # wait_for <version> : the API answers and says it is that version
  i=0
  until curl -fsS "$URL/api/health" 2>/dev/null | grep -q "\"version\":\"$1"; do
    i=$((i + 1))
    [ "$i" -le 90 ] || return 1
    sleep 2
  done
}

if [ "${1:-}" = "--back" ]; then
  [ -n "${2:-}" ] || { echo "Say which version: ./deploy/update.sh --back <id>"; exit 1; }
  echo "==> Going back to $2 (now at $BEFORE)"
  git checkout --quiet "$2"
  "$C" up -d --build
  wait_for "$(git describe --always)" || { echo "It did not come up. See: ./deploy/compose.sh logs --tail 50 migrate api"; exit 1; }
  echo "Back at $2 and answering. To be on the main line again later: git checkout - && ./deploy/update.sh"
  exit 0
fi

echo "==> 1/5 Backing up first (database and uploaded files)"
"$C" exec -T backup backup.sh | tail -3
STAMP="$("$C" exec -T backup sh -c "ls -1 /backups | sed -n 's/^mono-db-\(.*\)\.dump$/\1/p' | grep -v -- -q | sort | tail -1")"
[ -n "$STAMP" ] || { echo "The backup did not produce a file. Nothing was changed."; exit 1; }

echo "==> 2/5 Getting the newest code"
git pull --ff-only
AFTER="$(git rev-parse --short HEAD)"
[ "$AFTER" != "$BEFORE" ] || echo "    (already at the newest code: rebuilding and checking anyway)"

echo "==> 3/5 Building the new version (the old one keeps running)"
"$C" build

echo "==> 4/5 Starting it (database changes are applied first)"
"$C" up -d

echo "==> 5/5 Checking"
if ! wait_for "$(git describe --always)"; then
  echo
  echo "THE NEW VERSION DID NOT COME UP."
  echo "  What it says:   ./deploy/compose.sh logs --tail 50 migrate api"
  echo "  Go back:        ./deploy/update.sh --back $BEFORE"
  echo "  If data must go back too (rare):  ./deploy/restore.sh $STAMP"
  exit 1
fi
sleep 20
echo "Running: $(curl -fsS "$URL/api/health")"
echo "Health:  $(curl -fsS "$URL/api/health/ready")"
echo
echo "Updated $BEFORE → $AFTER. Backup taken before it: $STAMP"
echo "If something is wrong:  ./deploy/update.sh --back $BEFORE"
