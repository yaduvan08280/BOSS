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

(The first start gives the uploads folder to the app's user automatically.)

```bash
sudo mkdir -p /srv/mono/pg /srv/mono/uploads /srv/mono/backups /srv/mono/rclone
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

## 7. Messaging: Telegram, email, WhatsApp, phone push

Everything below is in **System Master → Integration**. Secrets are stored encrypted and never shown again.

**Telegram (do this first: most staff get their work here)**
1. In Telegram, open **@BotFather** → send `/newbot` → give it a name (e.g. `GGM MONO`) and a username ending in `bot` (e.g. `ggm_mono_bot`).
2. Copy the token BotFather gives you → **Connect channels → Telegram bot** → paste → **Connect bot**.
3. **Link Telegram → Send codes to all not linked.** Everyone gets an 8-character code by WhatsApp or email (or you see it on screen if they have neither). Each person can also do it themselves: **Profile → Link my Telegram → Open @bot** (one tap).
4. Optional: add the bot to a Telegram group, then paste the group's chat ID under **Admin group** to get a copy of every notification.

> A bot token can be used from **one place only**. Don't run a development copy of MONO with the same token as the server: create a second bot for testing.

**Email**: **Connect channels → Email (SMTP)**. With Gmail: turn on 2-step verification, create an *App password*, then use server `smtp.gmail.com`, port `587`, your Gmail address as user, the app password, and "Send from" `MONO <you@gmail.com>`. Press **Send test**.

**WhatsApp**: **WhatsApp API** → choose WATI or AiSensy → paste the endpoint (WATI) and API key → **Test API**. WhatsApp only delivers *approved* templates: in **Message templates**, filter WhatsApp, press **Submit** on the ones you want and create a template with **the same name and text** in your provider's dashboard. Then press **Check all statuses**.

**Phone push**: **Connect channels → Phone push → Create keys**. Each person then turns it on in **Profile → Phone notifications** (from the installed app).

**Check it end to end**: **Notification rules → Send test** → pick yourself. You should get it in the app (bell), on Telegram and by email within seconds.

## 8. Updating to a new version

```bash
cd ~/mono
git pull
./deploy/compose.sh up -d --build
```

Database migrations run automatically (`migrate` service) before the new `api` starts.

## 9. Backups

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

### Keep `.env` safe (you need it to restore)

The backup holds the data; `.env` holds the keys. Saved bot tokens, AI keys, the Google Drive connection and webhook
secrets are encrypted with `APP_SECRET`, so **a restore needs the same `APP_SECRET`**. After the first start, save a
copy of `.env` in your password manager (or print it and lock it away). Do **not** put it in the same Google Drive
folder as the backups.

### Restore from a backup

`./deploy/restore.sh` does everything below; run it without a date to list the backups:

```bash
cd ~/mono
./deploy/restore.sh                    # lists the backups, newest first
./deploy/restore.sh 20261105-0230      # type yes when asked
```

It stops the app, restores the database and the uploaded files from that night, starts MONO again (applying any
newer migrations), and prints the number of companies and people and the time of the last change. If it ends with
"APP_SECRET is not the one the backup was made with", put the original `APP_SECRET` back in `.env` and run
`./deploy/compose.sh up -d --force-recreate api worker`.

### Restore on a new machine (disk died, new server)

Follow these steps exactly, in order. Nothing else is needed.

1. Do **section 1** (Docker) and **section 2** (get the code) on the new machine.
2. Put back the `.env` you saved (password manager) as `~/mono/.env`. Check `DATA_DIR` (normally `/srv/mono`).
   Do not run the `sed` lines of section 3: they would make a **new** `APP_SECRET`.
3. Do **section 4** (data folders).
4. Copy the backup files into `/srv/mono/backups`. From Google Drive (if you set up rclone, section 9):
   ```bash
   sudo mkdir -p /srv/mono/rclone && sudo nano /srv/mono/rclone/rclone.conf   # paste the saved rclone.conf, or run "rclone config" again
   docker run --rm -v /srv/mono/rclone:/config/rclone -v /srv/mono/backups:/backups rclone/rclone:1.75.2 copy gdrive:mono-backups /backups --include 'mono-*'
   ```
   Or from a USB disk: `sudo cp /media/$USER/<disk>/mono-*-20261105-0230.* /srv/mono/backups/`
5. Restore the newest backup:
   ```bash
   cd ~/mono
   ./deploy/restore.sh                   # shows what is there
   ./deploy/restore.sh 20261105-0230     # the newest; type yes
   ```
6. Check: `curl -s http://localhost:8080/api/health` says `"status":"ok"`; sign in at `http://localhost:8080`
   (or through the tunnel); yesterday's tasks and people are there.
7. Do **section 6** (Cloudflare Tunnel) if the tunnel token is not in `.env` yet. The public address stays the same.

Files that were moved to the company's **Google Drive** (System Master → Integration → Google Drive) are not in the
uploads archive; they stay in Drive and open again as soon as the restore is done (same `APP_SECRET`).

### Restore drill (do it twice a year)

Practise on a spare PC or a virtual machine, so the steps are known before a real failure: install Ubuntu 24.04,
follow "Restore on a new machine" with last night's backup, sign in, and open a few records with photos. Write the
date in the table below. (The first drill was done on 05/11/2026 with the Docker stack on a fresh data folder.)

| Date | Backup used | Time taken | Result |
|---|---|---|---|
| 05/11/2026 | test stack backup `20261105-1734`, restored into an empty data folder with `restore.sh` | 35 seconds | OK — 2 companies, 26 people, 205 tasks, the uploaded file (same checksum), sign-in and an API key all back |

## 10. Day-to-day commands

```bash
./deploy/compose.sh ps                      # what is running
./deploy/compose.sh logs -f api             # live API log (Ctrl+C to stop)
./deploy/compose.sh logs --since 1h worker  # worker log for the last hour
./deploy/compose.sh restart api worker      # restart the app
./deploy/compose.sh down                    # stop everything (data is kept)
```

Logs rotate automatically (5 × 10 MB per service).

## 11. Troubleshooting

| Symptom | Check |
|---|---|
| `migrate` exited with an error | `./deploy/compose.sh logs migrate`. Usually a `.env` value: `SEED_OWNER_PASSWORD` or `SEED_OWNER_MOBILE`/`EMAIL` missing. |
| Sign-in says "Request blocked: unknown origin" | `BASE_URL` in `.env` must match the address in the browser exactly (https, no trailing slash). Then `./deploy/compose.sh up -d`. |
| Signed in, but sent back to the login page | Same cause: `BASE_URL` must start with `https://` when using the tunnel. |
| Tunnel not connecting | `./deploy/compose.sh logs cloudflared`. Check the token and that `COMPOSE_PROFILES=tunnel`. |
| `api` unhealthy | `./deploy/compose.sh logs api | tail -50`. "Invalid environment" lists the exact settings to fix. |
| Telegram bot silent | `./deploy/compose.sh logs worker | grep -i telegram`. \"terminated by other getUpdates\" means the same token runs somewhere else. |
| Disk filling up | `du -sh /srv/mono/*` and `docker system prune` (removes old images only). |
