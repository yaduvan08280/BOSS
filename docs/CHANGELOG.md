# Changelog

## Phase 0: Scaffold, auth, deploy skeleton (31/10/2026)

**Foundation**
- npm workspaces monorepo: `apps/api`, `apps/worker`, `apps/web`, `packages/shared`, `packages/db`. TypeScript 6 (strict), ESLint 10, Prettier, Vitest 5, Playwright.
- Prisma 7 with a multi-file schema and the driver adapter. Tables: companies, branches, shifts, departments, designations, roles, users, user_departments, counters, module_settings, attachments, sessions, audit_logs, domain_events, notifications.
- Company scoping (`forCompany`): every query is limited to one company, and list reads hide soft-deleted rows. Per-company human numbers (`EMP-001`, `BOP/26-27/0004`) come from an atomic counter.

**Shared**
- `transition()` state-machine helper (roles, guards, terminal states, available actions).
- Indian formats: ₹ with lakh/crore grouping and `₹1.31 Cr` / `₹45.36 L`, DD/MM/YYYY in the company time zone, FY April–March, E.164 mobiles.
- Permission keys and default permissions for the built-in roles.
- **Theme generator**: the whole UI is built from one seed colour (default honey `#EFC75E`). Readable text is guaranteed for every swatch in both modes. Status colours are fixed.

**API**
- Fastify 5 with zod validation, OpenAPI at `/api/docs` (dev), structured logs (pino) with cookies redacted, environment checked with zod, and the standard error shape.
- Auth: login by mobile or email + password (argon2id). Access token lasts 15 min and refresh 30 days, both in httpOnly cookies. Refresh tokens are rotated, and reusing an old one revokes all sessions. A company picker appears when one login exists in two companies. Logout, `/me`, preferences, and password change (which signs out other devices). Login is rate-limited and data-changing requests are checked against the site origin.
- Every mutation writes an audit row and an outbox event in the same transaction. Postgres NOTIFY feeds Server-Sent Events at `/api/events`, with a 25 s heartbeat.
- `/api/health`.

**Worker**
- pg-boss 12: outbox dispatcher (instant via LISTEN, plus a sweep every minute), retries with backoff, heartbeat file for the Docker healthcheck.

**Web**
- App shell in the Ink & Honey theme:
  - Dark sidebar with every menu section from §3 (collapsible), and a top bar with the workspace / System Master switch, counters, refresh and user menu (language, light/dark/system, larger text, assistant, help, sign out).
  - Floating assistant button.
  - On phones: bottom tab bar (Home · My work · + Capture · Alerts · Menu) and a menu drawer.
- Pages:
  - Login (English/Hindi, company picker).
  - Home "Ask" page with screen search (Ctrl/Cmd+K) and category chips.
  - System Master overview, Profile with password change, and the `/dev/ui` UI kit with a live theme playground.
  - Placeholder pages for every later-phase screen.
- English and Hindi strings (Hindi machine-drafted, to be reviewed). Fonts are self-hosted (Inter, Noto Sans Devanagari, JetBrains Mono). Installable PWA with icons.

**Deploy**
- Docker Compose with `db`, `migrate` (migrations + first-company seed), `api`, `worker`, `web` (Caddy: SPA + `/api` proxy with no buffering for SSE), `cloudflared` (profile `tunnel`) and `backup` (nightly dump + uploads, 14 days, optional rclone).
- `deploy/compose.sh` wrapper and `deploy/INSTALL.md`.

**Verified**
- 46 unit/integration tests (state machine, formatters, theme contrast across 30 swatches × modes, company isolation, auth flows, SSE, outbox dispatcher).
- Playwright login and shell tests at 380 px and 1440 px, with a no-side-scroll check.
- Fresh-machine Docker stack: migrate → seed → login works through Caddy, SSE streams through Caddy, and a backup restores.
