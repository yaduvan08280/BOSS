#!/bin/sh
# PostgreSQL calls this for every finished piece of its write-ahead log (docker-compose.yml: archive_command).
# The piece is compressed into /wal, where the backup container picks it up. With the nightly base backup these
# pieces can rebuild the database as it was at any minute (deploy/restore-pitr.sh).
#   archive-wal.sh <path of the piece> <its name>
# It must fail when it cannot write: PostgreSQL then keeps the piece and tries again — nothing is lost.
set -eu
SRC="$1"
NAME="$2"
DEST="/wal"
[ -d "$DEST" ] && [ -w "$DEST" ] || { echo "archive-wal: $DEST is not writable" >&2; exit 1; }
# Already there (an earlier try got as far as the rename): done.
[ -f "$DEST/$NAME.gz" ] && exit 0
gzip -1 < "$SRC" > "$DEST/.$NAME.tmp"
mv "$DEST/.$NAME.tmp" "$DEST/$NAME.gz"
