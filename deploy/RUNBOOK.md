# MONO runbook — what to do when…

One page for the person who looks after the server. Every command is run on the server, in `~/mono`.
Details are in `deploy/INSTALL.md`; how the database is kept is in `docs/database.md`.

**First, always:** what is running, and what does MONO say about itself?

```bash
./deploy/compose.sh ps
```

```bash
curl -s http://127.0.0.1:8080/api/health/ready
```

`"status":"ok"` — fine. Anything else names what is wrong; System Master → Errors shows it in words.
MONO also writes to every Owner and Admin on Telegram and by email when the worker stops, the queue backs
up, a backup fails or is late, a disk passes 90 %, errors jump or a channel keeps failing — once, again
after six hours while it lasts, and once more when it is over.

Put a free outside monitor (UptimeRobot, Better Stack…) on `https://<your address>/api/health/ready` and
have it alert on anything but `"status":"ok"`: MONO cannot tell you that the whole machine is off.

---

## Update to a new version

```bash
./deploy/update.sh
```

It takes a backup, gets the code, builds, applies database changes, restarts and checks. People are
interrupted for a few seconds. It prints the id to go back to. If the new version does not come up it
says so and prints the same line:

```bash
./deploy/update.sh --back <id it printed>
```

Database changes only ever add, so the older code runs on the newer database; restore data only if the
new version wrote something wrong (`./deploy/restore.sh <the backup it printed>`).

After an update that says so in `docs/CHANGELOG.md`, add the new settings to `.env`. This time:
`AI_ALLOW_PRIVATE=1` if an AI or speech server runs on this machine; `PG_SHARED_BUFFERS=8GB` and
`PG_CACHE=24GB` on the 48 GB server.

## Restore

| What happened | Do |
|---|---|
| Something was deleted or changed by mistake at a known time | `./deploy/restore-pitr.sh` (lists the copies), then `./deploy/restore-pitr.sh <copy> "2026-11-19 13:05"` — the database as it was at that minute. Uploaded files are not touched. |
| The database will not start, or its disk died, the backups folder is still there | `./deploy/restore-pitr.sh <newest copy>` — everything up to the last minute saved. |
| The whole machine is gone | New machine: INSTALL.md steps 1–4 with the **same `.env`**, copy the backups back (INSTALL.md → "Restore on a new machine"), then `./deploy/restore.sh <newest stamp>`; or, to lose a minute instead of a quarter of an hour, copy `base/` and `wal/` back too and use `restore-pitr.sh`. |
| You want last night's state, files included | `./deploy/restore.sh` (lists), then `./deploy/restore.sh <stamp>`. |

Both scripts ask before they replace anything. `restore-pitr.sh` keeps the database it replaces beside the
new one (`/srv/mono/pg.before-<time>`); delete that folder once you are sure.
Right after a restore the health check says the backup is old (it reads the restored database, whose last
backup mark is the dump's own): run one at once — `./deploy/compose.sh exec backup backup.sh`.
Measured in Docker on a small machine: a dump restore of the demo company into an empty stack, 25 s;
a rebuild from a base copy and its log pieces, 17 s.

## The owner cannot sign in

```bash
./deploy/compose.sh exec api node apps/api/dist/reset-password.js <mobile or email>
```

It prints a one-time password; they choose their own at the next sign-in. "Too many wrong passwords":
wait 15 minutes — or reset the password as above, which also clears the lock:

```bash
./deploy/compose.sh exec db psql -U mono -d mono -c "delete from login_throttles"
```

## A disk is filling (alert at 90 %)

```bash
df -h /srv/mono && du -sh /srv/mono/*
```

1. Old databases set aside by a restore: `ls -d /srv/mono/pg.before-*` — delete them when sure.
2. Old Docker images: `docker system prune` (never removes data).
3. Backups: lower `BACKUP_KEEP_DAYS` in `.env`, then `./deploy/compose.sh up -d backup`.
4. `backups/wal` growing without end means the nightly base copy is failing:
   `./deploy/compose.sh exec backup backup.sh base` and read what it says.

Never delete anything inside `/srv/mono/pg`.

## The database will not start

```bash
./deploy/compose.sh logs --tail 40 db
```

- "No space left on device": free space as above, then `./deploy/compose.sh up -d`.
- "could not write to /wal" in a loop: `sudo chown 70:70 /srv/mono/backups/wal`.
- After a power cut it replays its log by itself; give it a few minutes. The API waits for it.
- Anything else: do **not** delete files. Restore the newest copy: `./deploy/restore-pitr.sh <newest copy>`
  (the broken one is kept in `pg.before-<time>`).

## The address does not open from outside (tunnel down)

```bash
./deploy/compose.sh logs --tail 20 cloudflared
```

MONO itself is fine if `curl -s http://127.0.0.1:8080/api/health` answers. Then: the internet line; the
tunnel's status in Cloudflare Zero Trust; `CLOUDFLARE_TUNNEL_TOKEN` and `COMPOSE_PROFILES=tunnel` in `.env`;
`./deploy/compose.sh up -d cloudflared`. People in the building can use `http://<server's address>:8080`
meanwhile if `WEB_BIND=0.0.0.0` is set (then `BASE_URL` must be that address for sign-in to work).

## A key leaked

| What leaked | Do |
|---|---|
| Somebody's password | System Master → Users → key icon (signs them out everywhere). |
| An API key or a site agent's key | System Master → API Keys / Integration → Connections → Revoke, make a new one. |
| A bot token, WhatsApp / AI / gateway key | Make a new one at the provider, paste it in System Master → Integration. The old one stops when the provider revokes it. |
| `.env` itself (`APP_SECRET`, the database password) | See below. |

**Changing `APP_SECRET`** (it seals every saved key and signs every session):

```bash
NEW=$(openssl rand -base64 48 | tr -d '\n')
```

```bash
./deploy/compose.sh exec -e NEW_APP_SECRET="$NEW" api node apps/api/dist/rotate-secret.js
```

Then put `APP_SECRET=<the new value>` in `.env` (and in your password manager), and restart:

```bash
./deploy/compose.sh up -d
```

Everyone signs in again; each outlet's Pulse QR code must be printed again. If the command says a secret
"cannot be opened", nothing was changed.

**Changing the database password:** `./deploy/compose.sh exec db psql -U mono -d mono -c "alter user mono password '<new>'"`,
put it in `.env` as `POSTGRES_PASSWORD`, then `./deploy/compose.sh up -d`.

## The worker stopped (reminders and messages are not going out)

```bash
./deploy/compose.sh logs --tail 40 worker
```

```bash
./deploy/compose.sh restart worker
```

Nothing is lost: what should have gone out is still queued and goes out when it is back. "terminated by
other getUpdates" means the same Telegram token is used by another program — stop that one.

## Pinning the images to what is running

The compose file names images by version (`postgres:16-alpine`, `caddy:2.11.7-alpine`). To make an update
never pull anything new by itself, note the exact images in use and keep the list with your `.env`:

```bash
docker image inspect --format '{{index .RepoDigests 0}}' postgres:16-alpine caddy:2.11.7-alpine
```
