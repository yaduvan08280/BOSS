# New setup process — run MONO on a Windows PC with WSL Ubuntu

Every command below is meant to be run **one by one, in order**. Copy a block, paste it, wait for it to finish,
then go to the next. Lines starting with `#` are notes. Nothing else needs to be installed.

What you end up with: the whole application (API, worker, web app, database, test mail inbox) running on your PC,
opened in the browser at <http://localhost:5173>.

> To install MONO on the **real server** (Ubuntu 24.04, Docker, Cloudflare Tunnel, nightly backups), follow
> [deploy/INSTALL.md](deploy/INSTALL.md) instead. This file is for a development / test PC.

---

## Part A — Windows (once)

### A1. Install WSL with Ubuntu 24.04

Open **PowerShell as Administrator** (Start → type "PowerShell" → right-click → Run as administrator):

```powershell
wsl --install -d Ubuntu-24.04
```

Restart the PC when asked. After the restart, an Ubuntu window opens: choose a **user name** and a **password**
(you will type this password for `sudo` below).

Check (in PowerShell, not as admin is fine):

```powershell
wsl -l -v
```

`Ubuntu-24.04` should show `VERSION 2`.

### A2. Give WSL enough memory (recommended)

In PowerShell:

```powershell
notepad "$env:USERPROFILE\.wslconfig"
```

Paste this, save, close Notepad:

```ini
[wsl2]
memory=8GB
processors=4
```

Then:

```powershell
wsl --shutdown
```

Open **Ubuntu** again from the Start menu. Everything from here on is typed in the **Ubuntu** window.

---

## Part B — Ubuntu tools (once)

### B1. Update Ubuntu and install basic tools

```bash
sudo apt update && sudo apt upgrade -y
```

```bash
sudo apt install -y git curl ca-certificates build-essential openssl unzip
```

### B2. Make sure systemd is on (Docker needs it)

```bash
cat /etc/wsl.conf
```

If it does **not** show `systemd=true`, run these two, then close and reopen Ubuntu:

```bash
printf '[boot]\nsystemd=true\n' | sudo tee /etc/wsl.conf
```

```powershell
# in PowerShell:
wsl --shutdown
```

### B3. Install Docker (inside Ubuntu)

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker $USER
```

Close the Ubuntu window and open it again (so the `docker` group applies), then check:

```bash
docker run --rm hello-world
```

```bash
docker compose version
```

(If you already use **Docker Desktop** on Windows with "WSL integration" turned on for Ubuntu-24.04, skip B3; the
two checks above must still work.)

### B4. Install Node.js 22 (through nvm)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```

Close and reopen Ubuntu, then:

```bash
nvm install 22
```

```bash
nvm alias default 22
```

```bash
node -v && npm -v
```

`node -v` must print `v22.x` (22.12 or newer).

---

## Part C — Get the code (once)

### C1. Connect this PC to GitHub with an SSH key

```bash
ssh-keygen -t ed25519 -C "itadmin@ggminerals.com"
```

Press Enter three times (default file, no passphrase — or set one if you prefer). Then show the public key:

```bash
cat ~/.ssh/id_ed25519.pub
```

Copy the whole line → GitHub → your picture → **Settings → SSH and GPG keys → New SSH key** → paste → Add.
Check:

```bash
ssh -T git@github.com
```

Type `yes` if asked. It should say "Hi … You've successfully authenticated".

### C2. Download MONO

```bash
cd ~ && git clone git@github.com:yaduvan08280/BOSS.git mono
```

```bash
cd ~/mono
```

### C3. Tell git who you are (for commits)

```bash
git config --global user.name "Nikhil"
```

```bash
git config --global user.email "itadmin@ggminerals.com"
```

---

## Part D — Settings and database (once)

All commands from here on run inside `~/mono`.

### D1. Install the project's packages

```bash
cd ~/mono && nvm use
```

```bash
npm ci
```

(This also generates the database client. It takes a few minutes the first time.)

### D2. Create the settings file `.env`

```bash
cp .env.example .env
```

Put a random secret in it (needed for sign-in and for encrypting saved keys):

```bash
sed -i "s#^APP_SECRET=.*#APP_SECRET=$(openssl rand -base64 48 | tr -d '\n/+=')#" .env
```

Open it to set your own first login:

```bash
nano .env
```

Change these lines (Ctrl+O, Enter to save; Ctrl+X to close):

| Line | Put |
|---|---|
| `SEED_COMPANY_NAME` | `GGM Minerals` |
| `SEED_OWNER_NAME` | your name |
| `SEED_OWNER_MOBILE` | your 10-digit mobile |
| `SEED_OWNER_EMAIL` | your email |
| `SEED_OWNER_PASSWORD` | a password with letters and numbers (at least 8) |

Leave `DATABASE_URL`, `TEST_DATABASE_URL` and `BASE_URL=http://localhost:5173` as they are.

> Keep a copy of `.env` somewhere safe (password manager). The same `APP_SECRET` is needed to read saved bot
> tokens, AI keys and Drive / webhook secrets.

### D3. Start the database and the test mail inbox

```bash
npm run db:up
```

Wait ~10 seconds, then check both are running:

```bash
docker ps
```

You should see `mono-dev-db-1` (healthy) and `mono-dev-mail-1`.

### D4. Create the tables

```bash
npm run db:deploy
```

And the same for the test database (used by `npm test`):

```bash
DATABASE_URL=$(grep '^TEST_DATABASE_URL=' .env | cut -d= -f2-) npx prisma migrate deploy
```

### D5. Create your company and owner login

```bash
npm run db:seed
```

### D6. (Optional) Load the demo company

A full example company (25 people, processes, tasks, stock, sales) to try every screen:

```bash
npm run seed:demo
```

Demo sign-in: mobile `9000000000`, password `Demo1234`.

---

## Part E — Run MONO (every day)

```bash
cd ~/mono && nvm use
```

```bash
npm run db:up
```

```bash
npm run dev
```

Leave this window open (it shows the logs; **Ctrl+C** stops MONO). Then open in the Windows browser:

- **App:** <http://localhost:5173> — sign in with `SEED_OWNER_MOBILE` (or email) and `SEED_OWNER_PASSWORD`.
- **API documentation:** <http://localhost:3000/api/docs>
- **Emails MONO sends (test inbox):** <http://localhost:8025>
- **UI kit / theme playground:** <http://localhost:5173/dev/ui>

To open it from your phone on the same Wi-Fi, use the production-style stack (Part G) with `WEB_BIND=0.0.0.0`.

---

## Part F — Check that everything works (optional, recommended after each update)

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

End-to-end browser tests (needs `npm run dev` running in another Ubuntu window and the demo company):

```bash
npm run test:e2e:docker
```

Load test (50 people at once) — see [deploy/k6/README.md](deploy/k6/README.md).

---

## Part G — The production-style stack on this PC (optional)

This runs exactly what the server runs (Docker images, Caddy, backups) at <http://localhost:8080>:

```bash
cp .env .env.prod-test
```

```bash
nano .env.prod-test
```

Set `NODE_ENV=production`, `BASE_URL=http://localhost:8080`, `DATA_DIR=/home/$USER/mono-data` (write your user
name), `POSTGRES_PASSWORD=` a random value (`openssl rand -hex 24`), `COMPOSE_PROFILES=` (empty). Then:

```bash
mkdir -p ~/mono-data/pg ~/mono-data/uploads ~/mono-data/backups ~/mono-data/rclone
```

```bash
MONO_ENV_FILE=$PWD/.env.prod-test ./deploy/compose.sh up -d --build
```

```bash
curl -s http://localhost:8080/api/health
```

Stop it with `MONO_ENV_FILE=$PWD/.env.prod-test ./deploy/compose.sh down`.

---

## Part H — Getting updates

```bash
cd ~/mono && git pull
```

```bash
npm ci
```

```bash
npm run db:deploy
```

```bash
npm run dev
```

---

## What depends on what

| Piece | Needs | Started by |
|---|---|---|
| Web app (port 5173) | Node 22, the API | `npm run dev` |
| API (port 3000) | Node 22, Postgres, `.env` (`APP_SECRET`, `DATABASE_URL`) | `npm run dev` |
| Worker (reminders, Telegram bot, webhooks, Drive sync, scheduled jobs) | Node 22, Postgres | `npm run dev` |
| Postgres 16 (port 5432, databases `mono` and `mono_test`) | Docker | `npm run db:up` |
| Mailpit test inbox (8025 / SMTP 1025) | Docker | `npm run db:up` |
| Tables | Postgres running | `npm run db:deploy` |
| First company + owner | Tables | `npm run db:seed` |
| Telegram / WhatsApp / email / AI / Google Drive | Keys entered in System Master → Integration | (optional) |

Telegram on a PC: make a separate **test bot** with @BotFather. Never use the server's bot token on the PC — one token
can only be read from one place.

## When something goes wrong

| Problem | Fix |
|---|---|
| `docker: permission denied` | Close and reopen Ubuntu after B3; check with `groups` that `docker` is listed. |
| `Cannot connect to the Docker daemon` | B2 (systemd), then `sudo systemctl start docker`. |
| `npm ci` fails with "engine" / wrong Node | `nvm use` (must be 22.12+). |
| `Can't reach database server at localhost:5432` | `npm run db:up`, wait 10 s, try again. |
| Port 5432 / 3000 / 5173 already in use | Another Postgres or app is running; stop it, or `docker ps` and stop the old container. |
| Sign-in says "Too many attempts" | Wait 15 minutes (10 tries per 15 minutes), or set `LOGIN_RATE_LIMIT=100` in `.env` and restart `npm run dev`. |
| Screens look old after an update | Stop `npm run dev` (Ctrl+C) and start it again; hard-refresh the browser (Ctrl+Shift+R). |
| "APP_SECRET … must be at least 32 characters" | Run the `sed` line in D2 again. |
