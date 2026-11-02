# Changelog

## Phase 1: Company setup, departments, users, roles, org chart, Home (02/11/2026)

**System Master** (Owner/Admin)
- Five header cards on every tab, computed live:
  - Company setup steps, people and departments.
  - Business engine.
  - Processes and the people-load split (0s until phases 3–5).
  - Health check: 8 checks, with "See what is missing" linking to each fix.
- Tabs with count badges; later-phase tabs are placeholders.
- **Company setup**
  - Profile with the required fields.
  - GSTIN **Verify**: an offline checksum fills PAN and state; a pluggable GST provider (`GST_API_PROVIDER`) adds the legal name.
  - Points of contact.
  - Shifts & timings: overnight shifts, working-day chips, one default.
  - Branch tree with loop protection.
  - Designations as coloured chips; delete only when unused.
- **Departments**: type-and-Enter, cards with HOD picker, sub-departments, people and "with login" counts. Drag a card onto another to nest it, with Undo. Sub-department dialog. Delete only when empty.
- **Users**
  - Add one by one, or **Paste a list** from Excel/Sheets: tab or CSV, header in any order, live preview with per-line errors.
  - Department filter chips (plus Not assigned and New dept), search, Grid/Cards views (always cards on phones).
  - Team / HR column groups; HR details only with `hr.admin`.
  - Bulk move, set role and enable login; Telegram codes come in phase 2.
  - Login toggle, reset password, soft delete, and an edit panel with "also works in".
  - Auto codes `EMP-001`.
- **Roles**: permission matrix (16 modules × view/create/edit/approve/admin), built-in roles protected (Owner always all), custom roles, process-roles note. Enforced on every API route.
- **Org chart**
  - Stats row, search, department chips, zoom/Fit, Left & inactive, Full/Chart/List views, Owner on top.
  - Drag a person to another department → "Also add / Move / Cancel"; drop on the head slot → HOD.
  - Person side panel; touch drag by press-and-hold.
- **Appearance**: the theme generator with presets, 30 swatches plus any colour, warmth, corners, sidebar and buttons, with a live preview on the whole app. Also logo upload, app name, default language and mode, and the "staff may pick their own accent" switch.

**Home / search**
- Ctrl/Cmd+K command palette anywhere, plus inline search on Home over screens (English and Hindi), people and departments.
- Category chips per spec, an alert banner (e.g. departments without HOD), and favourites (star) saved per user.

**Accounts**
- One-time passwords for admin-created logins, shown once with copy buttons.
- Forced password change on first sign-in, enforced by the API.
- Resetting a password signs the person out everywhere; nobody can remove the last Owner or delete themselves.

**Platform**
- File uploads (`/api/files`, PNG/JPG/WebP up to 5 MB) on a local-disk storage interface; served only to the same company.
- New tables `company_contacts`; user `prefs` and `must_change_password`; company profile columns.
- `npm run seed:demo` (Demo Industries: 25 people, 14 departments, 5 shifts, 4 branches, 19 designations) and `npm run seed:ggm` (GGM sites and departments, no invented people). Both are safe to re-run.
- Docker: the `migrate` service now gives the uploads folder to the API user (no manual `chown`).

**Verified**
- 70 unit and integration tests, including permissions (Member gets 403, HR fields hidden), company isolation, delete rules, owner guards, paste import, chart moves, summary and search.
- Playwright: paste 5 users, move a person between departments, make a HOD (cleans up after itself), plus no side-scroll on every System Master tab at 380 and 1440 px.
- Production stack rebuilt from scratch: migrate, seed, login, upload and download through Caddy.

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
