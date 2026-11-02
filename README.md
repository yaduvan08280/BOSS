# MONO

Business operating system for GGM Minerals. The full specification is in [CLAUDE.md](CLAUDE.md);
installing on the server is in [deploy/INSTALL.md](deploy/INSTALL.md).

## Develop (WSL2 / Ubuntu)

```bash
nvm use                      # Node 22
npm ci                       # also generates the Prisma client
cp .env.example .env         # then set APP_SECRET and the SEED_* lines
npm run db:up                # Postgres 16 (+ mono_test) and Mailpit (dev emails at http://localhost:8025)
npm run db:deploy            # apply migrations
npm run db:seed              # first company + owner from .env
npm run seed:demo            # optional: Demo Industries, 25 people (owner 9000000000 / Demo1234)
npm run dev                  # api :3000, worker, web :5173
```

Open <http://localhost:5173> and sign in with `SEED_OWNER_MOBILE` (or email) and `SEED_OWNER_PASSWORD`.
API docs (dev only): <http://localhost:3000/api/docs>. UI kit and theme playground: `/dev/ui`.

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build
npm run test:e2e:docker      # Playwright in Docker against the running app (E2E_SCREENSHOTS=1 saves docs/screenshots)
```

After changing the Prisma schema run `npm run db:migrate -- --name <what-changed>` (the client is regenerated afterwards; Prisma 7 no longer does that by itself).
Telegram in development: create a separate test bot with @BotFather; never use the server's bot token on your PC (one token can only be polled from one place).
E2E tests use the demo company (`npm run seed:demo`) and remove what they create.

`npm test` runs against the `mono_test` database (`TEST_DATABASE_URL`). It only applies migrations, never wipes data.

## Layout

| Path | What |
|---|---|
| `apps/api` | Fastify API: `src/modules/<module>`, plugins (auth, errors, origin check, SSE) |
| `apps/worker` | pg-boss jobs: dispatches outbox events (notifications plug in here in phase 2) |
| `apps/web` | React 19 + Vite + Tailwind 4 app shell, i18n (en/hi), theme from one colour |
| `packages/shared` | State-machine helper, money/date/phone formatters, permissions, theme generator, zod schemas |
| `packages/db` | Generated Prisma client, company scoping, counters |
| `prisma` | Schema (one file per module), migrations, seed |
| `deploy` | Dockerfiles, compose stack, Caddyfile, backups, INSTALL.md |
