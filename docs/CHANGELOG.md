# Changelog

## Fixes after GGM testing (03/11/2026)

**Dates are DD/MM/YYYY everywhere**
- The browser's own date pickers are gone. They follow the browser's language: "11/04/2026" meant 4 November in an English (US) browser. All 13 were replaced by MONO's own fields:
  - Date: type `04112026` and the slashes appear, or pick from a Monday-first calendar.
  - Time: 24-hour; `18:00`, `1800` and `6pm` all work.
  - Impossible dates like 31/02 are refused.
- Every date shown, in lists, chips, Telegram, briefs and the MIS, now carries its year: `04/11/2026 18:00`.

**Type to filter in every list**
- Every dropdown in the app filters as you type. Every word must match (`sand pal` → Sandeep Pal), best matches come first, and letters in order also match (`rmsh` → Ramesh). Arrow keys and Enter work.
- Long lists get a search box; on short ones you can still just start typing.

**Telegram**
- `/done` and `/move` were never wired to the bot (only the code behind them was tested); now they work. `/done` with no number lists your open tasks as tap-to-finish buttons. `/move` takes DD/MM/YYYY. Unknown commands get the help text.
- `/today` = due before midnight in the company's time zone, plus anything late. Work due later is counted ("2 more due later — send /my").
- `/my` shows one-tap Accept / Done / Verify buttons. It now includes tasks you verify by default (as the creator or EA), not only ones with your name as verifier.
- **Seen without a button:** Telegram never tells bots when a message is read, so a WhatsApp-style blue tick isn't possible. Instead, anything you do in the chat (a button, a command, any message) marks everything delivered there before it as seen, which also stops escalations. The Seen button is gone.
- **Proof travels with "please verify":**
  - Covers delegation done, ticket fixed and checklist submitted. The photos are sent into the chat: one photo carries the message and the Verify button as its caption; several come as an album, then the message.
  - Documents are sent as files. A missing file never blocks the message.
- Button results are also written into the chat (Telegram's pop-up disappears too quickly to read "this task needs a photo").

**Verified**
- 159 unit/integration tests (16 new). They cover:
  - Date reading and formatting (day first, no month-first, year always shown) and type-to-filter ranking.
  - Every Telegram command path, including the exact messages from testing.
  - /today across midnight; default verifiers in /my.
  - Auto-seen (only what was delivered on Telegram).
  - Proof files in the outbox; single photo, album and missing-file sending.
- Playwright: no browser date picker on any date form, a typed date saved and shown back as DD/MM/YYYY, type-to-filter leaving one match. All 26 browser tests pass on phone and desktop.

## Phase 4: Help slips, help tickets, EA system, weekly MIS, Business Engine flow designer (02/11/2026)

**Help slips** (`/help-slips`)
- A problem plus the raiser's own solutions (the company sets how many: 1–3). Flow: receiver screens (forward or send back) → approver decides → **approving creates a linked delegation task** (pick a solution or write your own, choose the doer and date) → raiser closes.
- Switches: "Receiver screens first" off sends slips straight to the approver; "Approver step" off lets the receiver decide.
- Every step has a time limit. A late slip tells whoever holds it, plus the accountable person, once. Decided slips the raiser leaves open close by themselves (approved ones once their task is done).
- Accountability: "none" means the raiser stays accountable; it can also be the receiver or the approver.
- Tabs: Waiting on me, Raise a slip, My slips, All slips. Tiles: Waiting on me, Open, Late, Approved, Rejected. Drawer with solutions, decision, linked task, files and history.

**Help tickets** (`/help-tickets`)
- Raise → solver replies → marks it fixed (photo or file required when "Proof to resolve" is on, again after every reopen) → raiser confirms, or says "not fixed" (reopen count). "Auto after 24 hrs" closes resolved tickets on its own.
- Escalation is a level on the ticket, not a status:
  - **Level 1:** the first reply or the planned fix time was missed; goes to the coordinator, or the solver's HOD if there is none.
  - **Level 2:** still missed one more SLA later; goes to the HOD and the owner.
  - The coordinator chases but decides nothing; they can comment, move the fix time or reassign.
- Tabs: To fix, Raise a ticket, My tickets, All tickets. Tiles: Open, Late, Escalated, Waiting to confirm, Closed. Drawer with the conversation, SLA chips and actions.

**EA system** (`/ea`)
- One-line capture (web or Telegram `/capture`; plain Telegram messages from the owner or the EA count too).
- The EA sorts captures on a drag-and-drop board: Captured, Information, Someday, Waiting (with the cap), Scheduled (day, time and kind), Delegated (creates a task), Done. Switched-off stages hide.
- **Owner's week:** a day × hour grid on desktop and an agenda on phones; tap a free hour to book something into it.
- Automatic:
  - A scheduled day that passed goes back to Someday.
  - Information closes after the "kept for" days.
  - Delegated items finish when their task is done.
  - The **daily brief** at 08:30 lists today's schedule, captures to sort, waiting n/cap, delegated work to chase and the Someday review.
  - The **weekly plan** goes out on the plan day. Both send once per day per owner.

**Weekly MIS** (`/mis`)
- Per person, per week: tasks planned, work done %, on time %, verified in time %, checklists %, tickets fixed in time %, score (FMS steps arrive in phase 5). Admins see everyone, HODs their team, others themselves.
- Week picker, Excel (CSV) and **PDF** (pdfmake, landscape A4).
- Sent every Monday at 09:00 (company time) for the past week: to owners with everyone, to HODs with their team.

**Business Engine flow designer** (System Master → Business engine card → `/system/engine`)
- For all five modules: a React Flow chart drawn from the module's state machine under the company's settings. Legend: start, action, status, automatic, finished, dead end/escalation. Steps switched off, and statuses nothing can reach any more, fade out.
- **Alerts (n/n)** view, full view, and a "Set up your flow" panel:
  1) who does it; 1B) times and rules; 2) steps on/off.
  - Live preview while editing, then Save or Reset to default, with a "Default / Changed" badge.
  - "Recent changes by admin" (who, when, before → after) and who hears about what on Telegram.
- Every setting does something:
  - **Delegation:** "EA verifies before done" off makes Mark done go straight to Done. "Accept within" reminds the doer and tells the creator. "Reports open on" sets the sheet's default range.
  - **Checklists:** "Mark missed after" is the default window for new checklists, and "Tell the owner about misses" off leaves the owner out of miss alerts.
  - **Slips:** "Delegated within" sets the approved task's default date.

**Also**
- My Workspace, menu badges and the top-bar count now include slips, tickets and the EA's captures. Telegram `/my` lists tickets to fix and slips waiting.
- New notification events: `delegation.accept_late`, `slip.late`, `slip.closed`, `mis.weekly`.
  - `ticket.escalated`, `ea.daily_brief` and `ea.weekly_plan` now go to exactly the people the worker picks.
  - Untouched built-in rules are upgraded automatically.
- An event can leave out recipients a company switched off.
- `seed:demo` adds 8 help slips and 10 tickets in every state (some late or escalated), and a 17-item EA board with this week's schedule. Sunita Bansal is set as the EA.
- New packages, pinned to releases at least two weeks old: pdfmake 0.3.12, @xyflow/react 12.12.0, @dagrejs/dagre 3.1.1.

**Verified**
- 143 unit/integration tests. New ones cover:
  - The slip, ticket and EA state machines, and the flow charts under different settings.
  - Escalation levels and weekly MIS on fixed dates.
  - Slip, ticket and EA lifecycles through the API.
  - Late slips chased once; auto-closes; escalation recipients.
  - The waiting cap, day rollover, a brief sent once at its time, and the brief text.
  - "EA verifies" off going straight to Done; settings validation, reset and change log.
  - MIS visibility, the PDF and the Monday send.
- Playwright (phone and desktop), each person in their own browser:
  - A slip raised, forwarded, approved into a task and closed.
  - A ticket replied, fixed with a photo and confirmed.
  - An EA capture scheduled into the week and done.
  - The designer's switch turned off and a task closed without verification.
  - Every new screen fits at 380 and 1440 px.
- Production stack: the `engine` migration applies, the slip, ticket, EA, MIS PDF and designer APIs work through Caddy, and there are no errors in the API or worker logs.

## Phase 3: Delegation, checklists, scorecard, R/Y/G (02/11/2026)

**Delegation sheet** (`/delegation`)
- Every task change goes through the shared state machine (accept, decline, move date, follow-up, mark done, verify, send back, reopen, give to someone else, cancel). The company's toggles decide the guards: doer must accept, EA verifies, allow reopen.
- Each change writes history, audit and a domain event, so Telegram, email and in-app follow automatically.
- Tiles: Pending, Overdue, To verify (with the company's target), Done this week (on time / done) and My score.
- Tabs: Add task, Pending, Verification and Done (with counts), FMS report (phase 5 placeholder), Scorecard.
- Filters: search, doer, This week / All / dates, Mine / My team / Everyone. Tables on desktop, cards on phones. Bulk accept and verify.
- **Add task**:
  - Fields: doer (or Myself), planned date, optional verifier, description.
  - **Dictate** uses the browser's speech recognition until the AI layer arrives.
  - Files: drag-drop, camera, paste a screenshot, many files.
  - "Require a photo or file when done": the API refuses to close the task on a remark alone.
- **Import many** from CSV/Excel with a preview and per-line errors (all or nothing).
- Task drawer: details, files and full history (date moves with reasons, follow-ups, notes, status changes).
- Overdue tasks raise `delegation.overdue` once per local day; moving the date resets it.
- **Scorecard**:
  - Week picker and CSV export. Per person: % not done, % not on time, % verifications not done, % verifications late.
  - Each KPI shows benchmark, last week, planned, actual, actual % and next week's target.
  - Each line has a state: meets / off this week / missed twice / no data.
- **R/Y/G report**: Green/Yellow/Red/Still open tiles, per-person table with split bars, Week or Month (W1–W4), CSV download.

**Checklists** (`/checklists`)
- Checklist master:
  - Items can require a photo, voice note or value.
  - Frequency: daily, chosen weekdays, weekly, monthly (date or last day), quarterly, yearly or every N days.
  - Also: due time, hours to finish, doers, verifier, skip holidays and weekly offs, start date, on/off.
- The worker sweeps every 5 minutes, creating each run up to 24 h ahead. Runs are unique per (master, planned time, doer), so a sweep never creates duplicates. Saving a master creates its due runs at once.
- Run sheet: tick items, enter values (entering a value ticks the item), photo or voice proof per item, note, submit. The verifier verifies or sends it back.
- Reminders before the due time; runs still open after the window close as **Missed** and the rules tell the owner.
- Tabs: My checklists, All checklists, Assign checklist, Checklist master, Master changes (who changed what). Tiles: All, Due today, Overdue, To verify, Missed.
- Deleting a master keeps its runs as history, but they leave every list and count and are never reminded or marked missed.

**My Workspace** (`/workspace`): one list of tasks to do, tasks to verify and checklists due, live over SSE. Top-bar and menu badges show the same counts.

**Telegram**
- Task messages carry buttons:
  - Accept or Done · Move date on new tasks.
  - **Verify** for the verifier.
  - Seen ✓ and Open on all of them.
- `/done 70 what was done`, `/move 70 05/11 18:00 reason`; `/my` and `/today` list tasks and checklists.
- A photo sent as a reply is saved as proof, then Done works on proof-required tasks.

**Other**
- Nobody verifies their own work: when the verifier (or the EA/creator fallback) is the doer, there is no verification step, and the scorecard doesn't count one.
- People never get a message about their own action (tests and escalations excepted).
- Live notification toasts share one slot (a new one replaces the last; the bell keeps them all), so a busy hour can't cover a phone screen and swallow taps.
- The web app loads each screen on first visit: the main bundle went from 1.18 MB to 476 KB (145 KB gzipped).
- Uploads accept more file types (PDF, Office, audio), up to 10 MB.
- `seed:demo` adds:
  - 30 tasks in every state.
  - 6 checklist masters with a week of run history.
  - 4 holidays.
- No messages are sent while seeding.

**Verified**
- 118 unit/integration tests. New ones cover:
  - Both state machines.
  - Recurrence in the company time zone across holidays, weekly offs and month ends.
  - R/Y/G grades and scorecard KPIs on fixed dates, plus next-week targets.
  - The idempotent sweep, reminders, misses and deleted masters.
  - Permissions and privacy; import; overdue once a day.
  - Telegram buttons and commands.
- Playwright (phone and desktop, run one at a time because specs share the demo accounts), each person in their own browser:
  - Owner gives a task, the doer accepts and marks it done, the verifier verifies.
  - A checklist run gets a value and a photo, is submitted and verified.
  - Delegation, Scorecard, R/Y/G, Checklists, Masters and My Workspace fit at 380 and 1440 px.
- Production stack: the `work` migration applies on a fresh database; task and checklist flows, scorecard and SPA routes work through Caddy; no errors in the API or worker logs.

## Phase 2: Notifications, Telegram, templates, rules, reminders (02/11/2026)

**Engine** (worker)
- Domain event → matching rules → recipients → templates.
  - Recipients: doer, verifier, creator, HOD, owner, coordinator, customer… or a named person. The HOD lookup walks up the department tree, then falls back to the owner.
  - Templates are picked per channel and the person's language, with variables filled from the event (user ids become names; dates shown as DD/MM/YYYY HH:mm in the company time zone).
- In-app notification is always created, once per person, and pushed live over SSE (bell counter, toast).
- Telegram, email, WhatsApp and push go through the **outbox**:
  - The rule's wait and the person's quiet hours are respected (escalations and tests ignore quiet hours).
  - Sending starts the moment something is queued, plus a 10 s poll for delayed messages and retries.
  - `SKIP LOCKED` claims; 5 tries with exponential backoff; then SENT / FAILED / SKIPPED, each with a clear reason.
- **Escalations**: "if no reply in N minutes, escalate to HOD / owner / coordinator / a person", checked every minute. A reply means the notification was read (also via Telegram "Seen") or the person acted on the record.
- Admin group: one copy of every Telegram message.

**Channels**
- **Telegram** (grammY, long polling, one bot per company or the .env bot):
  - Link with an 8-character code (24 h) or a one-tap `t.me/bot?start=CODE` link.
  - `/start` `/my` `/today` `/done` `/capture`; inline Seen / Open buttons (Accept / Done / Move date wired with tasks in phase 3).
  - A photo sent as a reply is saved as proof on that record.
- **Email**: nodemailer SMTP per company (or .env), branded HTML + plain text.
- **WhatsApp**: provider interface with **WATI** (send template, read template statuses, test) and **AiSensy** (send via API campaign). Interakt and Kit19 are shown as "coming later".
- **Web push**: VAPID keys per company, per-device opt-in in Profile, a service-worker push handler, and dead subscriptions removed automatically.
- Secrets (bot token, SMTP password, API keys, VAPID private key) encrypted with AES-256-GCM from `APP_SECRET`; never returned to the browser; empty field = keep.

**Screens** (System Master → Integration)
- **WhatsApp API**: provider, credentials, connection panel, Test API.
- **Message templates**: 342 defaults (57 events × 3 channels × EN/HI), search, category and channel filters, load defaults per channel, editor with variable chips and live preview, Submit / Check all statuses, active toggle.
- **Link Telegram**: Linked % (target 80%), pending / expired, people table, "Send codes to all not linked" (codes go by WhatsApp/email; people without either get theirs on screen), admin group.
- **Connect channels**: Telegram bot (token checked with Telegram before saving), SMTP, phone push keys, each with Send test.
- **Notification rules**: tiles, module chips, table, Add/Edit rule (event, audience, recipients, channels, wait, escalation), on/off, **Send test**.
- **Reminder patterns**: Standard / Gentle / Strict defaults, editor (remind at, channels, once overdue).
- Google Drive tab is a placeholder for phase 10.
- **Bell** dropdown + **Notifications** page; **Profile** gets "Link my Telegram" and "Phone notifications".

**Dev and ops**
- Mailpit added to the dev stack (`http://localhost:8025`); `.env` SMTP points at it.
- `db:migrate` now passes arguments to `prisma migrate dev`, and the client regenerates afterwards.
- Existing companies get any missing defaults on the next seed/migrate run.
- INSTALL.md has a new "Messaging" section (BotFather, Gmail app password, WhatsApp approval, push).

**Verified**
- 89 unit/integration tests, including:
  - Encryption and tamper detection; secrets never returned.
  - Engine fan-out, idempotency and quiet hours; skipping unconfigured channels.
  - Retries and backoff; escalation to the HOD vs answered.
  - Bot linking, Seen, photo proof; Telegram codes; inbox and permissions.
- Playwright: Send test → toast and bell update live → email arrives in Mailpit; every Integration screen fits at 380 and 1440 px.
- Production stack: Send test gives the in-app notification, and the unconfigured channels are recorded with reasons.

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
