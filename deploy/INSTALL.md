# Installing MONO on the server

Target: **Ubuntu 24.04 LTS** (the i7-12700 / 48 GB / 1.8 TB machine). Everything runs in Docker.
The app is reached from anywhere through **Cloudflare Tunnel**, so no ports are opened on the router.

Run each block in a terminal on the server, top to bottom. Lines starting with `#` are notes.

---

## 1. Install Docker (once)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and back in (or reboot), then check:

```bash
docker run --rm hello-world
docker compose version
```

Docker starts on boot by itself, and every MONO container has `restart: unless-stopped`, so MONO comes back after a power cut.
A UPS is still strongly recommended, because a sudden power loss can corrupt the database.

## 2. Get the code

```bash
cd ~
git clone git@github.com:<your-account>/mono.git
cd ~/mono
```

(Private repo: add the server's SSH key to GitHub first with `ssh-keygen -t ed25519` → copy `~/.ssh/id_ed25519.pub` → GitHub → Settings → SSH keys.)

## 3. Create the settings file (`.env`)

```bash
cd ~/mono
cp .env.example .env
# Fill the secrets with random values:
sed -i "s#^APP_SECRET=.*#APP_SECRET=$(openssl rand -base64 48 | tr -d '\n/+=')#" .env
sed -i "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$(openssl rand -hex 24)#" .env
nano .env
```

In `nano`, set at least these lines (Ctrl+O to save, Ctrl+X to exit):

| Setting | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `BASE_URL` | `https://mono.ggminerals.com` | The exact address people will type. Login cookies only work on this address. |
| `SEED_COMPANY_NAME` | `GGM Minerals` | Used once, on the very first start. |
| `SEED_OWNER_NAME` | `Nikhil` | |
| `SEED_OWNER_MOBILE` | `98xxxxxxxx` | The owner logs in with this mobile... |
| `SEED_OWNER_EMAIL` | `itadmin@ggminerals.com` | ...or this email. |
| `SEED_OWNER_PASSWORD` | a strong password | Change it after the first login (Profile → Change password). |
| `DATA_DIR` | `/srv/mono` | Database, uploads and backups live here. |
| `COMPOSE_PROFILES` | `tunnel` | Turns on Cloudflare Tunnel (step 6). Leave empty until you have a token. |

`DATABASE_URL` in `.env` is only for development; the Docker stack sets its own.

## 4. Create the data folders

```bash
sudo mkdir -p /srv/mono/pg /srv/mono/uploads /srv/mono/backups /srv/mono/rclone
sudo chown 1000:1000 /srv/mono/uploads
```

## 5. Start MONO

```bash
cd ~/mono
./deploy/compose.sh up -d --build
```

The first build takes a few minutes. Then check that everything is healthy:

```bash
./deploy/compose.sh ps
curl -s http://localhost:8080/api/health
```

You should see `api`, `worker` and `db` as `healthy`, `migrate` as `exited (0)`, and `{"status":"ok","db":"ok",...}`.
The first start also creates the company and the owner from the `SEED_*` lines:

```bash
./deploy/compose.sh logs migrate | tail -3
```

To test from another computer on the office network before the tunnel exists, set `WEB_BIND=0.0.0.0` in `.env`, run
`./deploy/compose.sh up -d` again, and open `http://<server-ip>:8080`.
(While `BASE_URL` is the https address, sign-in only works through that address; for a LAN test, temporarily set `BASE_URL=http://<server-ip>:8080`.)

## 6. Cloudflare Tunnel (access from anywhere)

1. Go to <https://one.dash.cloudflare.com> → **Networks → Tunnels → Create a tunnel** → **Cloudflared** → name it `mono`.
2. On the "Install connector" page, copy the long **token** (the part after `--token`). You don't need to install anything; Docker does it.
3. Add it to `.env`:
   ```bash
   nano .env      # CLOUDFLARE_TUNNEL_TOKEN=<paste>   and   COMPOSE_PROFILES=tunnel
   ```
4. Back in Cloudflare → the tunnel → **Public hostname → Add**:
   - Subdomain `mono`, domain `ggminerals.com`
   - Service: **HTTP** → URL **`web:80`**
5. Start the tunnel container:
   ```bash
   ./deploy/compose.sh up -d
   ./deploy/compose.sh logs cloudflared | tail -5     # look for "Registered tunnel connection"
   ```
6. Open `https://mono.ggminerals.com` and sign in as the owner.

Cloudflare handles HTTPS. No router ports need to be opened.

## 7. Updating to a new version

```bash
cd ~/mono
git pull
./deploy/compose.sh up -d --build
```

Database migrations run automatically (`migrate` service) before the new `api` starts.

## 8. Backups

- Every night at **02:30 India time**, the `backup` container saves the database (`mono-db-*.dump`) and uploaded files
  (`mono-uploads-*.tar.gz`) to `/srv/mono/backups`, keeping **14 days** (`BACKUP_CRON`, `BACKUP_KEEP_DAYS` in `.env`).
- Run one now to check:
  ```bash
  ./deploy/compose.sh exec backup backup.sh
  ls -lh /srv/mono/backups
  ```

### Copy backups off the machine (strongly recommended)

A backup on the same disk doesn't survive a disk failure. Copy it to Google Drive with rclone:

```bash
docker run --rm -it -v /srv/mono/rclone:/config/rclone rclone/rclone:1.75.2 config
#  n (new remote) → name: gdrive → storage: drive → leave client id/secret empty → scope: 1 (full) ...
#  "Use web browser to automatically authenticate?" → n → follow the link on your PC, paste the code back
nano .env      # RCLONE_REMOTE=gdrive:mono-backups
./deploy/compose.sh up -d backup
./deploy/compose.sh exec backup backup.sh      # last line should say "copying to gdrive:mono-backups"
```

### Restore from a backup

This **replaces** the current database. Stop the app first:

```bash
cd ~/mono
./deploy/compose.sh stop api worker web
ls /srv/mono/backups                           # pick a file, e.g. mono-db-20261031-0230.dump
./deploy/compose.sh exec backup sh -c 'dropdb mono && createdb mono && pg_restore --no-owner -d mono /backups/mono-db-20261031-0230.dump'
sudo tar -xzf /srv/mono/backups/mono-uploads-20261031-0230.tar.gz -C /srv/mono/uploads
./deploy/compose.sh up -d
```

## 9. Day-to-day commands

```bash
./deploy/compose.sh ps                      # what is running
./deploy/compose.sh logs -f api             # live API log (Ctrl+C to stop)
./deploy/compose.sh logs --since 1h worker  # worker log for the last hour
./deploy/compose.sh restart api worker      # restart the app
./deploy/compose.sh down                    # stop everything (data is kept)
```

Logs rotate automatically (5 × 10 MB per service).

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| `migrate` exited with an error | `./deploy/compose.sh logs migrate`. Usually a `.env` value: `SEED_OWNER_PASSWORD` or `SEED_OWNER_MOBILE`/`EMAIL` missing. |
| Sign-in says "Request blocked: unknown origin" | `BASE_URL` in `.env` must match the address in the browser exactly (https, no trailing slash). Then `./deploy/compose.sh up -d`. |
| Signed in, but sent back to the login page | Same cause: `BASE_URL` must start with `https://` when using the tunnel. |
| Tunnel not connecting | `./deploy/compose.sh logs cloudflared`. Check the token and that `COMPOSE_PROFILES=tunnel`. |
| `api` unhealthy | `./deploy/compose.sh logs api | tail -50`. "Invalid environment" lists the exact settings to fix. |
| Disk filling up | `du -sh /srv/mono/*` and `docker system prune` (removes old images only). |
