# CLAUDE.md — MONO (business operating system for GGM Minerals)

This file is the single source of truth for this project. Read it fully before any work.
Re-read the relevant module section before you touch that module.

---

## 0. What we are building

**MONO** is a self-hosted, multi-module "business operating system": one web app where a company
sets up its people and structure once, then runs all daily work through it — delegated tasks,
recurring checklists, problem slips, help tickets, an executive-assistant (EA) board, step-by-step
business processes (FMS), HR attendance/leave with automatic "Buddy" cover, inventory rules (IMS),
and a sales CRM with a year plan. Every piece of work has an **owner, a planned time and a verifier**,
and a **scheduler** sends reminders and escalations over **Telegram, WhatsApp, email and in-app**.
An **AI layer** drafts processes from plain-language descriptions and answers questions about the data.

- Functional reference: a competitor product ("BOS by WIZONE") seen in a silent demo recording.
  We replicate its **features and behaviour**, NOT its name, logo, copy, colours or exact layouts.
  Product name is **MONO** (configurable via `APP_NAME`, default "MONO"). Brand: MONO — part of the Mono product family (Mono Sheets, Mono AI).
- First customer / tenant: **GGM Minerals** (Goyal Group of Minerals) — quartz slab manufacturer,
  brand Levanto Quartz, plant at Kishangarh (Rajasthan), mines at Tonk, factory at Niwai.
  ~50 active users, Hindi + English speaking staff, many use phones.
- Owner / developer: Nikhil (IT Administrator). He tests and deploys; keep instructions copy-pasteable.

### Non-negotiables
1. Self-hosted on one Ubuntu 24.04 machine (Intel i7-12700, 48 GB RAM, ~1.8 TB disk), via Docker Compose.
2. Reachable from anywhere through **Cloudflare Tunnel** (no static IP, no open ports).
3. Multi-tenant ready: every business table has `company_id`; every query is scoped by it.
4. Mobile-first responsive UI + installable PWA. Every screen must work at 380 px wide.
5. Hindi + English UI strings (i18n from day one; English default).
6. Nothing is ever hard-deleted that has history — soft delete (`deleted_at`) + audit log.
7. All times stored in UTC, displayed in company time zone (default `Asia/Kolkata`).
8. Indian formats: ₹, lakh/crore display (`₹1.31 Cr`, `₹45.36 L`), DD/MM/YYYY, FY April–March.

---

## 1. Tech stack (do not change without asking)

| Layer | Choice |
|---|---|
| Language | TypeScript 6 everywhere (strict) |
| Monorepo | npm workspaces: `apps/api`, `apps/worker`, `apps/web`, `packages/shared`, `packages/db` |
| API | Node 22 LTS + Fastify, zod validation, OpenAPI generated from zod |
| ORM / DB | Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`, multi-file schema) + PostgreSQL 16 |
| Jobs / scheduler | **pg-boss** (Postgres-backed queue + cron; no Redis) in a separate `worker` process |
| Realtime | Server-Sent Events (`/api/events`) for in-app notifications and live boards |
| Web | React 19 + Vite + TypeScript, React Router, TanStack Query, Tailwind CSS 4, shadcn/ui (Radix), lucide icons — themed by the generator in §3.1 |
| Flowcharts | @xyflow/react (React Flow) + dagre auto-layout |
| Drag & drop | @dnd-kit |
| Charts | Recharts |
| Forms | react-hook-form + zod (schemas shared from `packages/shared`) |
| Auth | Login by mobile or email + password, argon2 hashes, JWT access (15 min) + refresh (30 days) in httpOnly cookies, optional Telegram login code |
| Files | Local disk volume `/data/uploads` (S3-compatible interface so it can swap later); optional Google Drive sync (`drive.file` scope) |
| PDF | pdfmake (server side) for documents, scorecards, flowcharts export |
| Telegram | grammY (long polling; no webhook needed behind the tunnel) |
| WhatsApp | Provider adapter interface; implement WATI and AiSensy; others later |
| Email | nodemailer (SMTP settings per company) |
| AI | Provider-agnostic `LLM` interface: Anthropic, OpenAI, Gemini, Ollama (local). Structured output validated with zod. Speech-to-text via provider (Whisper-compatible) for "Speak/Dictate" |
| PWA / push | vite-plugin-pwa + Web Push (VAPID) |
| Tests | Vitest (unit), Playwright (e2e on key flows) |
| Deploy | Docker Compose: `db`, `api`, `worker`, `web` (built static served by Caddy), `cloudflared`, `backup` |

---

## 2. Repository layout

```
/apps/api        Fastify app: src/modules/<module>/{routes,service,schemas}.ts
/apps/worker     pg-boss jobs: reminders, checklist generation, escalations, briefs, outbox sender, telegram bot
/apps/web        React app: src/modules/<module>/..., src/components/ui (shadcn), src/layout
/packages/shared zod schemas, enums, state machines, permission keys, money/date formatters, i18n keys
/packages/db     generated Prisma client + company-scope / soft-delete helpers (used by api and worker)
/prisma          schema/*.prisma (one file per module), migrations, seed.ts; prisma.config.ts at repo root
/deploy          docker-compose.yml, Caddyfile, cloudflared config, backup script, INSTALL.md
/docs            module notes, ADRs, screenshots
```

Conventions
- One folder per module on both API and web. Module names: `core`, `org`, `delegation`, `checklist`,
  `slip`, `ticket`, `ea`, `fms`, `docs`, `hr`, `ims`, `crm`, `notify`, `ai`, `integrations`, `search`.
- **State machines live in `packages/shared/src/machines/*.ts`** as transition tables
  `{from, action, to, guard?, roles}`. API services must call `transition()`; never set `status` directly.
- Every mutation writes an `audit_log` row and emits a domain event (`events.emit('task.assigned', payload)`).
  Notifications are driven ONLY by domain events + notification rules (section 7).
- API errors: `{ error: { code, message, details? } }`. HTTP 4xx for user errors.
- IDs: `cuid2` strings. Human numbers per company per type (`#70`, `BOP/26-27/0004`) via `counters` table.
- Money: store as integer paise (`BigInt`) or `Decimal(14,2)`; format with shared helpers.
- Keep components small; no file > 400 lines. Write tests for every state machine.
- After each phase: run `npm run lint && npm test && npm run build`; fix everything before saying done.

---

## 3. App shell and navigation

### Top bar (every screen)
Logo + page title + one-line subtitle · **My Workspace / System Master** switch (System Master only for
Owner/Admin) · support button · two counters (my pending work, unread notifications) · refresh ·
user menu (profile, language, AI assistant, help, sign out). Floating chat/assistant button bottom-right.

### Left menu (My Workspace)
- WORKSPACE: Home · My Workspace · Support
- BUSINESS ENGINE: Delegation sheet · Checklists · Help Slips · Help Tickets · EA system · Weekly MIS
- SYSTEMS: My FMS steps · Live FMS · Documents · FMS Builder
- HR: Attendance · Leave · Cover board · Payroll (gross pay from attendance; HR only)
- INVENTORY: Stock · Purchase (OWS) · MAX review · Audit
- SALES CRM: Dashboard · Plan & setup · Customer Master · SCOT Sheet · Today's Calls · CRM Orders · Collections · NBD Funnel · MeCA/MCAP
- MASTERS: My Masters · Master Library · Build my own
Badges show counts (e.g. Checklists 13). Collapsible ("Collapse menu").

### Home — "Ask" command page
- Heading "What do you want to do, {firstName}?" + hint "Type a screen, a task or a word. Try 'leave', 'stock' or 'overdue'."
- Global search box (Ctrl/Cmd+K anywhere) over screens, tasks, people, records, customers, items. Natural-language
  questions go to the AI (section 13) and answer from data.
- Category chips: Business Engine, Systems, HRMS, Sales CRM, Masters, Messaging, Workspace.
- Alert banner when something needs action, e.g. "9 pieces of work have no Buddy today — AJAY (9) away" → button "Open the cover board".
- "Suggested for you": list of screens with icon, one-line purpose, module tag, live count ("6 due today", "18 open"), star to favourite.

### 3.1 Design system and theming ("Ink & Honey", generated from one colour)
The whole look is generated at runtime from **one seed colour** chosen from a large pool (30 swatches + any colour
picker). Default seed **`#EFC75E`** (honey), grey warmth **45**, corner radius **14 px**, **dark sidebar**,
**primary buttons in the theme colour**. Style reference: GGM's existing "Slabworks" dashboards — charcoal sidebar,
cream page, soft cream cards with large radius, one ink "hero" KPI card per screen, monospace record numbers.

- Generator lives in `packages/shared/src/theme/` (pure functions, unit-tested). Input
  `{ seed, warmth 0–100, radius 4–22, sidebar 'dark'|'light', buttons 'accent'|'ink', mode 'light'|'dark' }`
  → a map of CSS variables. Works in OKLCH: neutrals (page, card, border, text, muted, sidebar, ink) take the seed's hue
  with low chroma scaled by warmth; accent = seed (dark mode clamps its lightness); text on accent = black or white,
  whichever has higher contrast; every text/background pair is checked for WCAG AA and nudged if it fails.
- **Status colours are fixed and never themed**: ok/green, warn/amber-orange, bad/red, over/purple, info/blue,
  neutral/grey — each with bg/text pairs for light and dark, an icon and an EN/HI label, defined once in
  `packages/shared` next to the state machines. Colour is never the only signal. If the seed is close to a status hue,
  Appearance shows a warning.
- Components read only semantic tokens (`--background`, `--card`, `--primary`, `--sidebar`, `--status-bad-bg` …)
  mapped into Tailwind 4 `@theme`; no raw hex in components.
- Customisation levels: **Company** (System Master → Appearance: seed, warmth, radius, sidebar, buttons, logo, app
  name, saved presets: Ink & Honey · Ink · Quartz · Indigo; live preview) · **User** (light/dark/system, density
  comfortable/compact, larger text, language; own accent only if the admin allows it) · **Fixed** (status colours;
  colour-blind-safe option instead).
- Typography: Inter (Latin) + Noto Sans Devanagari (Hindi) + JetBrains Mono (record numbers/codes), self-hosted;
  tabular numbers for money; min 12 px on phones; Hindi gets taller line-height and wrapping buttons.
- Phone (< 768 px): bottom tab bar Home · My work · **+ Capture** (accent) · Alerts · Menu; left menu becomes a drawer;
  dialogs become bottom sheets; tables become card lists; touch targets ≥ 44 px; skeleton loaders; PWA status bar
  colour = sidebar colour.
- A `/dev/ui` style page shows every token and component in light/dark at 380 px; each phase attaches Playwright
  screenshots (380 / 1440, light / dark).

---

## 4. System Master (setup area)

### 4.1 Header cards (always on top of System Master)
1. **Company Setup** — "5/5 steps done", "25 people · 14 departments", Open.
2. **Business Engine** — "5 modules: Checklist · Delegation · Help Slip · Help Ticket · EA System".
3. **Processes** — count, "5 live · 3 being built · 0 not started" with coloured bar.
4. **People view** — "who does what, how much": counts of heavy / balanced / light / free load (by open steps + tasks per person), "14 of 25 in a process".
5. **Health check** — % readiness, "2 of 8 fully ready", link "See what is missing" (lists gaps: departments without HOD, people without login, steps without doer, no Telegram link, etc.).

### 4.2 Tabs
`Company Setup · Departments · Users · Roles · Org Chart · Integration · Inventory · Sales CRM · API Keys · HR Rules · Business details · Appearance` (each with a count badge).

**Company Setup** sub-tabs:
- *Company Profile*: trading name*, city*, state*, owner/contact name*, mobile*, email, website, CIN.
  Tax & registration: GSTIN with **Verify** button → fills legal name + PAN (pluggable GST API provider; if none configured, validate GSTIN checksum only and let user type legal name). Points of contact list (role, name, phone, email) — "Add as many as you need".
- *Shifts & Timings*: name, start, end, working weekdays (chips Mon–Sun), "Set as default". Overnight shifts allowed (Night 23:00–07:00).
- *Branches*: tree. Parent picker ("No parent (top level)"), name, code, city/state, default flag. Render as org-tree.
- *Designations*: add by name; show as coloured avatar chips; delete if unused.

**Departments**: "type and press Enter, then the next one". Card per department: initial avatar, name, people count, "N with login", HOD + Change, sub-departments chips + "+ Sub-department", People avatars + People menu, delete (×). Drag a card onto another → becomes its sub-department. Sub-department dialog: name, head (team lead), add people from the parent department, "People in this sub-department", nested sub-departments, Delete (only when empty), Done.

**Users**: Add people "One by one" or "Paste a list" (name, mobile, email, department, designation — parse tab/comma separated). Filter chips per department with counts + "Not assigned" + "+ New dept". Search by name, code, mobile, department. Table columns: #, code (`EMP-001` auto), name, main department, role, reports to, status (Active/Left/Inactive), also works in (multi-department chips), HOD flag, login toggle, login ID, lock (reset password), delete. Views: Grid / Cards; column groups "Team columns" / "HR details" (DOJ, DOB, biometric ID, bank, PAN, Aadhaar last 4, salary — HR-only permission). Bulk select ("Tick all 25") → move department, set role, enable login, send Telegram codes.

**Roles**: role list with permission matrix (module × action: view / create / edit / approve / admin). Built-in roles: Owner, Admin, HOD, Supervisor, EA, Member, plus process roles assigned per flow (Coordinator, Problem Solver, Verifier). Users can have one main role + process roles.

**Org Chart**: stats row (People, Departments, HODs set x/y, Not in a department, With app login x/y). Search person/designation, department filter chips. Zoom (−, %, +, Fit), "Left & Inactive" toggle, views Full view / Chart / List. Owner card on top, one column per department: head-of-department slot (photo, name, designation, HOD badge, or "No HOD yet — Drop a person here" + Assign), team list with status dot, "+ Add person". **Drag a person onto another department** → dialog "Sandeep Pal → IT. What should happen?" options **Also add to IT (works in both)** / **Move to IT (leaves Maintenance)** / Cancel. Drop on the top slot → make HOD. Click person → side panel with details and their open work.

**Integration** sub-tabs (section 7 & 12): WhatsApp API · Message templates · Link Telegram · Connect channels · Notification rules · Reminder patterns · Google Drive.

**Inventory**: IMS rule sets + "Who does what" (section 10).
**Sales CRM**: custom fields per record type (Lead, Quotation, Customer, Order): your label, show toggle, required toggle, "+ Add a field".
**API Keys**: server URL (copy), "+ Generate API key" (shown once, then masked), list with Show/Revoke, last used. Keys scoped per company; used by external tools (Tally connector etc.).
**HR Rules**: 7-step wizard (section 9.1).
**Business details** (AI memory): see section 13.
**Appearance**: theme generator controls from §3.1 (seed colour pool + picker, grey warmth, corners, sidebar, button style, presets, live preview), logo upload, app name, dark mode default, language default, "staff may pick their own accent" toggle.

---

## 5. Business Engine

Each of the 5 modules has, in System Master → Business Engine card, a **flow designer page**:
left list of modules; centre "Life of a … — from the moment it is given to the moment it closes"
flowchart rendered from the state machine (legend: Start, Action, Status, Decision, Auto, Finished,
Dead-end/escalation) with Flowchart / Alerts (n/n) buttons and Full view; right panel **"Set up your flow"**
(badge "Default" until changed) with: 1) who does it (role pickers), 1B) times and rules (dropdowns),
2) switch steps on/off (toggles), Recent changes by admin (who/when/what), and the roles legend with
which Telegram events each role receives. Toggles change the state machine guards at runtime
(store as `module_settings` JSON per company; defaults in `packages/shared/src/defaults.ts`).

### 5.1 Delegation (one-time tasks)
**Settings defaults**: EA = (user), accept/respond within 30 min, verify within 1 h, reports open on "This week";
toggles **Doer must accept** ON, **EA verifies before done** ON, **Allow re-open** ON.

**State machine**
```
CREATED --assign--> AWAITING_ACCEPTANCE (if doerMustAccept) | OPEN
AWAITING_ACCEPTANCE --accept(doer)--> OPEN
AWAITING_ACCEPTANCE --decline(doer, reason)--> RETURNED_TO_CREATOR
OPEN --moveDate(doer|creator, newDate, reason)--> OPEN (log revision++)
OPEN --addFollowUp(any)--> OPEN
OPEN --passOn(doer, nextDoer, note, newDate, files?)--> AWAITING_ACCEPTANCE (if doerMustAccept and next ≠ creator) | OPEN
AWAITING_ACCEPTANCE | OPEN | PENDING_VERIFY | RETURNED_TO_CREATOR | DONE --addNote(any)--> same status
OPEN --markDone(doer, note, proof?)--> PENDING_VERIFY (if eaVerifies or verifier set) | DONE
PENDING_VERIFY --verify(verifier)--> DONE
PENDING_VERIFY --reject(verifier, comment)--> REOPENED (if allowReopen) --> OPEN
DONE --reopen(creator, comment)--> REOPENED (if allowReopen)
any --cancel(creator|admin)--> CANCELLED
```
**Screen "Delegation sheet"** tabs: Add task · Pending (n) · Verification (n) · Done (n) · FMS report · Scorecard.
- KPI tiles: Pending (your open tasks) · Overdue (past planned date) · To verify (1-hour SLA) · Done this week (on time) · My score (this week, work done %).
- Filters: search task/doer/verifier, From–To dates, doer dropdown, "This week", All.
- Table: checkbox, #number + doer avatar/name + "by {creator}", status chips (Awaiting acceptance / Accepted dd/mm hh:mm / Verifier: name / Covered by {buddy}), task description, planned date + "overdue 2d", Follow up button, assigned by, actions (calendar = move date, pencil = edit, bin = cancel, tick = accept/verify).
- **Add task** form: Select doer*, Planned date*, Verifier (optional), Task description* with **Dictate** (voice → text), Attach images or files (drag-drop, camera, paste screenshot with Ctrl+V, many files), checkbox "Require a photo or file when this is marked done — the doer cannot close it on a remark alone", Submit task ("The doer gets it on Telegram"), **Import many** (CSV/Excel).
- Dialogs: **Move the planned date** (new planned date, why is it changing*), **Mark done** (what was done*, attach proof, button "Mark done · send to {verifier}"), **Add follow-up** (note), toast "Sent to Sandeep for verification".
- **Pass on** (work done by several people one after another): the doer writes what they did*, picks who does the next part* and when it is due*, may attach their work → button "Pass on to {name}". The same task (same number) moves on; chips "Part 2", row "Worked on by A → B → C". Everyone who did a part keeps seeing the task and its notes.
- **Notes** tab in the task drawer: everything people wrote on the task (notes, follow-ups, hand-overs, done notes, reasons) with name and time, and a box to add a note; History tab shows every change. On Telegram, replying to a task message with text adds a note.
- **Scorecard** tab: week picker (prev/next, This week), Export. Rows per person: KRA/KPI lines — "All work should be done" (% work not done), "All work should be done on time" (% not on time), "All verifications should be done" / "within 1 hour" — Benchmark %, Last week actual %, This week planned / actual / actual %, Next week target. Legend: Meets benchmark / Off within a week / Missed twice / No data.
- **R/Y/G report** toggle: Green = on time, no revision; Yellow = a day late or revised once; Red = two+ days late or revised twice+; Open = still running and not late. Tiles Graded/Green/Yellow/Red/Still open; table per person total, G, Y, R, open, % G / % Y / % R with bar; Week or Month (W1–W4) view; download.

### 5.2 Checklists (recurring work)
**Settings defaults**: verifier (user), reminder 30 min before, mark missed after 4 h; toggles **Verifier step** ON, **Photo / voice proof** ON, **Tell the owner about misses** ON.

**State machine**: `MASTER (active) --sweep(due)--> OPEN --tickItems--> OPEN --submit--> PENDING_VERIFY | DONE --verify--> DONE`, `OPEN --windowExpired(auto)--> MISSED` (owner notified), `PENDING_VERIFY --reject--> OPEN`.
- **Checklist master**: name, department/branch, items (ordered lines; each may require photo/voice/value), frequency (daily, specific weekdays, weekly on day, monthly on date or "last day", quarterly, yearly, every N days), due time, window (hours to complete), doer(s) or role, verifier, skip holidays/weekly offs (uses HR calendar), start date, active toggle.
- Worker job `checklist.sweep` every 5 minutes creates runs whose planned time ≤ now+lead; idempotent by (master_id, planned_at).
- Tabs: My checklists · All checklists · Assign checklist · Checklist master · Master changes (audit of master edits).
- KPI tiles: All · Due today ("1 already done") · Overdue ("open past the due time") · To verify ("waiting for a verifier") · Missed ("auto-closed, never done").
- Table: checklist name + department, planned, due + "2d left", status (Running/Done/Missed), progress "0/3 items", tick action → opens run: items with checkbox, photo/voice capture per item, note, submit.

### 5.3 Help Slip (problem → solutions → decision)
**Settings defaults**: receiver (user), approver (user), receiver forward within 4 h, accountability (none), approver decides within 24 h, delegated within 4 h, raiser close 48 h; "Solutions the raiser must give" = 1|2|**3**; toggles **Receiver screens first** ON, **Approver step** ON.
**Flow**: Raiser raises slip (problem + at least N solutions) → SUBMITTED (with receiver) → receiver: forward → WITH_APPROVER, or send back → RETURNED (raiser edits → resubmit) → approver picks a solution (or writes own) → APPROVED → auto-creates a Delegation task for the chosen solution (link both ways) → raiser confirms → CLOSED. Approver may REJECT with reason.

### 5.4 Help Ticket (issue → fix)
**Settings**: raiser / problem solver / process coordinator roles; first reply SLA, fix SLA; escalation levels **Off / 1 level / 2 levels**; toggle **Proof to resolve**; "Who closes the ticket": **Raiser confirms** or **Auto after 24 hrs**.
**Flow**: OPEN (raised) → first reply → IN_PROGRESS → solver fixes + proof → RESOLVED (waiting on raiser) → raiser "fixed?" Yes → CLOSED / No → back to IN_PROGRESS (reopen count++). If no response within SLA or planned fix time passed → ESCALATED (auto) to coordinator (level 1) then HOD/owner (level 2). Roles: Raiser (raises, picks solver + planned fix time, confirms), Problem Solver (replies, fixes with proof), Process Coordinator (rides along and chases; decides nothing).

### 5.5 EA System (owner's personal capture board, run by an EA)
**Settings**: EA (user), week starts Monday, weekly plan day Saturday, waiting cap 6 items, daily brief 08:30, working day 08:00–20:00, information kept 7 days, Someday review every 7 days, delegation follow-up 2 days; toggles **Information stage** ON, **Waiting stage** ON, **Missed day → Someday** ON.
**Flow**: Quick capture (one line, no category; also from Telegram message to bot) → CAPTURED → EA sorts into INFORMATION (reference/fyi) · SOMEDAY (maybe later) · WAITING (parked, capped) · SCHEDULED (day + time slot) · or DELEGATION (creates a Delegation task) → DONE (from any live stage) → CLOSED (no longer carried). Day passes on a scheduled item → back to SOMEDAY if toggle on.
Screens: kanban board by stage, "Owner's weekly schedule" (week grid with meetings/calls/review slots), daily brief message to owner at 08:30.

### 5.6 Weekly MIS
Per person, per week, across modules: planned vs done, on-time %, verifications on time, checklist completion, FMS steps on time. Owner view with all people; export PDF/Excel; auto-send Monday 09:00 to owner and HODs.

---

## 6. Processes / FMS (Flow Management System)

### 6.1 Concepts
- **Flow** (template): name, "runs are called" (e.g. "Order", "Lead", "Complaint"), departments, Process Coordinator (follows up on time) + backup, Problem Solver (steps in when stuck) + backup, start form fields, ordered **steps**, KPI cards, training video link, status Draft/Published, version (v1, v2… published versions are immutable; records keep the version they started on).
- **Step types**: `TASK` (someone does work) · `DECISION` (yes/no split; each branch → next step id) · `APPROVAL` (a manager says OK; reject → configurable step) · `OUTSIDE` (customer/vendor — waiting on outside) · `AUTO` (system does it: send message, create document, update stock, call webhook).
- **Step config**: name, type, who (users and/or role, "People of Sales, HR"; who can see), backup doer, planned time (value + unit hours/days + anchor: after previous step / after record start / before or after a date field / at a fixed time), checklist lines, entry form fields, documents to generate, stock effect (IMS item in/out), proof required, notify (WhatsApp update to customer etc.).
- **Field types**: short text, long text, number, amount ₹, date, date-time, yes/no, dropdown, multi-select, photo, file, signature, mobile, email, items (line items: item, qty, rate, amount), from a master (customer/item/vendor/person/any custom master), location. Each: label, required/optional, help text, reuse from other flows ("Reuse fields").
- **Time model**: toggle "Working shifts" (count only shift hours, skip holidays and weekly offs) vs "Full calendar".

### 6.2 Screens
- **Processes list** (System Master → Processes card): filters All / Live / Being built / Not started, department chips with counts; groups by department; row: process code (PRC-001), name, "Everything is in place" or "no training video"/"no KPI card"/"Problem Solver missing" warnings, doers avatars, coordinator, problem solver, readiness meter (5/5), status (Live, n running / Being built). Buttons: Import template, Ask AI, **Build with AI**, + New process, List/Grid view.
- **Process editor** (full-screen): left panel "Tell me how it works" (text box + Speak with language select English/Hindi/Hinglish, "Write it again with AI", quick changes "Add approval step", "Add photo proof", "WhatsApp update", "Make it shorter", free text "e.g. add a manager approval after…" + Change). Tabs: Overview · Steps (n) · Coordinator & Solver · FMS report · Dashboard · Video. Steps tab: step list (number, name, doer · planned time · fields) + selected step editor (type radio, Who/Time/Checklist/Entry form/Documents/Stock sub-tabs). Header: readiness "3/5 ready", Saved/Save process, close.
- **FMS Builder**: list (All / Published / Drafts; Table/Grid/Cards; Import template; + New flow system) with #, flow system, department, steps, updated, status (Draft / Published v2), actions (edit, publish, duplicate, archive). Editor: Steps / Start form / Details tabs; **Flowchart** (React Flow, zoom, PDF export, "+" between nodes to insert a step, decision diamonds with Yes/No edges, red badge on steps needing a doer) / Table view; Edit with AI; All flows; Save draft; **Publish** (validates: every step has doer + time; decisions have both branches; no orphan steps). Header metrics: "12 steps · 2 people · Start to end 4.4 days · 1 step to fix · Due times count: Working shifts | Full calendar".
- **Live FMS** (per flow dropdown): tabs Running · Late · Due today · On hold · Closed · Planned vs actual · Performance · Permissions. Stage strip: one circle per step with count of records there and late count ("2 here · 2 late"). Records table: record (title · #n · started dd/mm), on step (step n of N), with (doer; warning "Primary on leave · no backup free"), due, reading (late by "4.2 days late"/on time), Open. Buttons: Export, refresh, **+ New {run name}** (start form).
- **Record detail drawer**: header (record title, flow, #n, status, started), tabs Timeline · Planned vs actual · Documents · History. Timeline: each step with doer, planned time, actual time, status (On time / Done late / Delayed / Waiting), entered data, proof. Actions: do my step (form), **Reassign the open step** (give this step to…), Resume / Put on hold / Close record, Step timeline PDF. Toast "Step given to the new person".
- **My FMS steps**: tabs Owned FMS (records I started) / My steps in FMS. "Flows that start with you" cards (name, department, "12 running · 8 steps", "+ New order"). Running records table (record, now at, progress bar step x of N, due, started). Filters Running / Waiting on you / Late / Closed. Export, Refresh.
- **Documents**: auto-numbered papers created by AUTO/document steps: No. (`{PREFIX}/{FY}/{0001}`), document type, date, party, from (flow · record #), total ₹, status (Issued/Cancelled). Tabs All · per type · How it works · Design. "Design & types": per document type — prefix, fields mapping, header/footer, logo, terms; print/PDF/email/WhatsApp share.
- **FMS report**: per flow, per step: records passed, avg actual vs planned, % on time, worst steps, per person on-time %.
- **Dashboard (KPI cards)**: each card = label + source field from start/step forms + aggregation (Count / Total / Average / Min / Max) + period (Today / This week / This month / This FY) + comparison to previous period. "Suggest with AI" proposes cards from the flow.
- **Share a form link**: public link for a flow's start form (customers/vendors fill it) with captcha + rate limit.

### 6.3 Engine rules
- Starting a record: validate start form, create `fms_record`, compute planned time of step 1, create `fms_record_step` OPEN for its doer, emit `fms.step.assigned`.
- Completing a step: validate step form + checklist + proof; record actual time; DECISION picks branch; APPROVAL waits; AUTO runs immediately in worker; next step planned time computed from anchor using working-time calculator (shifts, holidays, weekly offs from HR settings).
- Doer on leave / absent → use step backup → Buddy rules (section 9.2) → flag "no backup free" and alert coordinator.
- Late detection job every 5 min: steps past planned → `fms.step.late` events; coordinator gets follow-up; problem solver after 2× planned.
- Records are never edited destructively; corrections create history entries.

---

## 7. Notifications, messaging and reminders

### 7.1 Engine
Domain event → match **notification rules** → render **template** per channel with variables → enqueue in
`outbox` → worker sends with retries (exponential backoff, 5 tries) → delivery status (sent/delivered/read/failed).
In-app notification is always created. Quiet hours per user (default 21:00–07:00, except escalations).

### 7.2 Screens (System Master → Integration)
- **WhatsApp API**: step 1 Provider (WATI · AiSensy · Interakt · Kit19 — "Switching provider resets the connection"); step 2 Credentials (API endpoint, API key/access token — stored encrypted with `APP_SECRET`, never shown again; display name); Connection status panel (provider, display name, number, quality rating, messaging tier, credentials Saved/Not saved, last test) + **Test API**.
- **Message templates**: "Templates · 101 shown", search name/body, category filter, channel tabs All/WhatsApp/Email/Telegram, Load WA defaults / Load Email defaults / Load TG defaults, Check all statuses, + New template. Columns: template code (e.g. `att_flag_wa`), channel, category (Utility/Marketing/Authentication), language, status (Approved/Draft/Pending/Rejected), quality, sent·read, active toggle, Submit (WhatsApp → provider approval), Edit, Delete. Variables `{{1}}…` mapped to named fields.
- **Link Telegram**: tiles Linked % ("3 of 25 · need 80%"), Pending (code sent, waiting), Expired codes. Banner "Your Telegram is linked. Your tasks and reminders arrive on @{bot}". Steps: get the 8-character code (WhatsApp or "Link my Telegram") → open @bot → send the code. People table (person, WhatsApp, status, code, sent) + "Send codes to all not linked". Codes expire after 24 h. Admin group: group chat ID + "Connect group" — all notifications also go to this group.
- **Connect channels**: email SMTP, Telegram bot token (from @BotFather), web push keys, Google Chat/Slack webhook (optional).
- **Notification rules**: tiles Active (49 rules) · Your team (Telegram) · Clients (WhatsApp + Email) · Vendors · AI follow-up. Module filter chips (Delegation, Checklists, Help Slips, Help Tickets, EA System, Business Engine, HRMS, Systems, Client/Vendor, Inventory). Columns: When (event), For (Your team / Client / Vendor), Send to (Doer / Verifier / Creator / HOD / Owner / Coordinator / Customer / custom), Channels (Telegram, WhatsApp, Email, In-app), Wait (delay), If no reply (escalate to … after …), Status, Added; actions Turn off / Edit / Delete. Load defaults; Add a rule dialog (event, audience, recipients, channels, template per channel, wait, escalation).
- **Reminder patterns**: name; remind at (1 day before, 3 hours before, 1 hour before, at due time, 1 hour after, next morning); channels; once overdue: do not repeat / every 1 h / every morning. A checklist master or task picks a pattern.

### 7.3 Default events (seed rules for each)
delegation: assigned, accepted, declined, date_moved, follow_up, passed_on, note, done, verified, rejected, overdue, reopened ·
checklist: assigned, reminder, completed, missed, verified, rejected · slip: submitted, returned, forwarded, decided ·
ticket: raised, replied, resolved, reopened, escalated, closed · ea: captured, daily_brief, weekly_plan ·
fms: step_assigned, step_due_soon, step_late, record_started, record_closed, approval_needed ·
hr: punch_flagged, missed_punch, leave_requested, leave_decided, buddy_requested, buddy_answered, absent_no_cover, morning_cover_report ·
ims: below_min, above_max, max_review_due, adjustment_approval, dead_stock, ows_ready ·
crm: call_due, lead_assigned, lead_stuck, order_step_due, payment_due, customer_sleeping.

### 7.4 Telegram bot
Commands: `/start` (ask for link code), `/my` (my pending list), `/today`, `/done <id>`, `/capture <text>` (EA), photo reply = attach proof, text reply to a task message = a note on that task. Inline buttons on messages: Accept · Done · Move date · Open. Each message deep-links to the web app.

---

## 8. Masters

- **Master Library** (by industry: manufacturing, trading, services, retail, projects): ready master definitions (Customers, Vendors, Items, Machines, Vehicles, Sites, Products, Raw materials, Spare parts…) — pick → creates master with fields.
- **Build any master with AI**: describe in plain words → AI proposes fields → edit → save.
- **Custom master** = definition (name, fields as in 6.1 field types, unique key, display field) + rows; import from Excel/Google Sheet; used by any form field "from a master".
- "Enter it once. Every module reads the same customer, item and person."

---

## 9. HR (HRMS)

### 9.1 HR Rules wizard (7 steps, each answer = preset chips + stepper, "Different for a team or person" overrides)
1. **Late & half day**: grace minutes late (0/10/**15**/30); how late makes a half day (1h/2h/**2.5h**/4h → 150 min); hours of work for a full day (4/6/**8**); forgets to punch out → **Half day until a correction** | Punch out at shift end.
2. **Punches & overtime**: punch away from office → **Block the punch** | Allow, and flag it; phone location can't be read → Block | **Allow, and flag it**; selfie when punching (Yes/**No**, per attendance category); forgotten punches someone can fix in a month (0/2/**3**/5); count overtime (**Yes**/No); overtime counts after (0/15/**30**/60 min) past shift end.
3. **Leave & HR**: leave year starts (January/**April**); comp-off from working a holiday must be used within (30/**60**/90 days); HR person (user); notice period (**30**/60/90 days).
4. **Buddy**: leave approved but some work has no Buddy → Block approval / **Warn only** / Off; which leaves need a Buddy → **Any leave, half days too** / A full day and more / A number of days and more; Buddy can be from another department (Yes/**No**); one Buddy may cover at most (1/2/**3**) people.
5. **Buddy's answer**: suggestion order (drag to reorder): 1 The step's backup in FMS · 2 Their default Buddy · 3 A free person in the same department · 4 Their HOD; Buddy must answer within (2h/**4h**/8h/24h); when the person is back → **Work not started goes back** / All work goes back / The Buddy keeps it; absent without leave → HOD confirms cover within (1h/**2h**/4h).
6. **Autopilot**: nobody chosen as Buddy → should the system pick one (Yes/**No**); approve short leave by itself (Yes/**No**); absent with no leave → work goes to their Buddy (Yes/**No**); send a morning message "who is away and which work has no Buddy" (**Yes**) at **08:30** to HODs, HR, Owner.
7. **Check & save**: summary grouped Attendance / Leave & HR / Buddy / Autopilot with Change links.

### 9.2 Attendance and leave
- **Punch in/out** (web/PWA): GPS + optional selfie; geofence per branch (lat, lng, radius m); flags per rules; offline queue on phone; device fingerprint. Optional import from biometric device (CSV import first; device API adapter later).
- **Daily attendance** computed by worker at shift end + 2 h: Present / Late / Half day / Absent / On leave / Holiday / Weekly off / Comp-off; overtime minutes; missed-punch correction requests (limit per month) → HOD approval.
- **Leave**: types (CL, SL, EL, Comp-off, LWP — configurable with yearly quota & carry-forward), request (from, to, half day, reason) → Buddy check for all open work in the period (delegation, checklists, FMS steps) → Buddy request(s) → HOD approval (or auto for short leave) → balances.
- **Cover board**: today's absentees, their open work, Buddy status (asked/accepted/none), one-click assign cover. "Covered by {buddy}" chip shows on the covered tasks.
- **Holiday calendar & weekly offs** (shared with CRM and working-time calculator): add holiday (date, name, type Festival/National/Optional, full/half day), calendar view of FY; weekly off per day (Working / Half day / Off), per branch.
- **Later phase** (from the reference pitch): job openings, hiring sources, interviews, offer & joining, onboarding checklist, loans & advances, payroll with payslips, PF/ESI/TDS, exit & full-and-final. Payroll statutory logic must be confirmed by the company's accountant before go-live.

---

## 10. Inventory (IMS)

### 10.1 Rule sets (System Master → Inventory → Rules)
- **MAX & review**: daily use from the last (90/**120**/180) days; review every **15** days; raise safety factor when red for **3** days; lower safety factor when purple **50%** of the review period; safety-factor step **0.25**; lowest safety factor **1**. Formula: `MAX = average daily use × lead time (days) × safety factor`. Colour bands: Red (stock < 33% of MAX), Yellow (33–66%), Green (66–100%), Purple (> MAX).
- **OWS & purchase** (Order When Short): order day (e.g. Monday), make orders N days ahead; order qty = MAX − (stock + on order).
- **Turns & NOS**: NOS (non-moving / slow) from < **10** turns a year; NOS target **50%** of stock value; turns growth **26%** a quarter; bottom **20%** by turns offered for stopping.
- **Audit & dead stock**: audit top **50** items by value every cycle; dead after **365** days without movement.
### 10.2 Who does what
Cards: Store keeper (daily entry, stock in/out, goods receipt), Purchase (raise OWS orders, purchase orders), Reviewer (15-day MAX review, safety factor), Audit coordinator (outside audit, dead stock, cash review) — each with Assign/Change/Clear. **Approves stock adjustments** (damaged, expired, lost, found): approvers list; rules "Any one of them" · "Never their own" · "Owner always can".
### 10.3 Screens
Item master (code, name, unit, category, location/bin, lead time, current safety factor, MAX, min, rate, vendor), Stock today (by colour band), stock moves (in/out/transfer/adjust with approval), IMS sheet (every in/out in one sheet), OWS purchase list, MAX review screen, audit counts, dead stock, reports (stock value, movement, purchase), Excel import of opening stock. FMS AUTO steps can post stock moves.

---

## 11. Sales CRM ("Sales & Growth Planner")

Separate section with its own left menu and a **setup journey of 15 pages** with progress ("8 of 15 pages done"), plan status Draft/Approved, FY selector, "Viewing as {seat}" preview, **Send for approval** (owner approves; approved plan shows "Unlock this plan? Anyone with edit access can change it again. It will need approval once more.").

### 11.1 Setup pages
- **Overview**: Year turnover target, gross profit target + margin, business type, plan status; setup journey checklist with Done/To do/Locked; plan completeness ring (year/quarters/months/weeks).
- **Plan the Year (4 pages)**:
  1. *Year target*: last FY actual turnover (before GST) and gross profit (amount shown in words: "₹5 crore"); this year "Grow by %" (chips +10/+20/+30/+50/+75/+100 and slider) or "Type exact amount"; outputs: target, growth, GP margin, "Sell every month ₹45.36 L", "Sell every week ₹11.83 L", bar comparison last vs this year.
  2. *Quarters*: growth % each quarter over the one before (No growth/+5/+10/+15/+20/+30 + slider); seasons and holidays already counted; cards Q1–Q4 with turnover, GP, % of year; fine-tune any quarter with −/+.
  3. *Months*: month bars (Apr–Mar), growth within quarter; each quarter total stays the same; edit a month → dialog "Change October 2026": turnover, gross profit; "You changed this month. What should happen to the rest of the plan?" → **Change the year total** or **Keep the year total — adjust other months**.
  4. *Weeks*: weeks Mon–Sun, part weeks at month edges joinable; per month view of weeks (target, GP, working days, holidays, per day); **day by day** dialog: Equal every day / Set each day (±% per day, week total stays the same). Check line "October's weeks add up to ₹95 L = its month target. All 12 months add up to ₹7.5 Cr."
- **CRM Configuration (7 pages)**:
  1. *Business type*: Manufacturing / Trading / Services / Retail / Projects (each changes defaults; e.g. Manufacturing → "fix PMS (production plan) first").
  2. *Whom you sell to*: B2B, B2C, Distributors/Dealers, Export, Government (multi; Export adds sampling FMS + English CRM; Government adds liaison person + Tender FMS).
  3. *Seats & people*: seats Owner/MD, CRR Sales Coordinator (SC), Office Sales Rep (OSR), CRM, NBD Sales Coordinator, Sales Rep / Sales Executive, Marketing (lead generation; can be Outside agency), EA, MIS Executive, PC (Process Coordinator), Production PC / Data entry operator → assign people (one person may hold several seats); summary "13 of 13 seats in use · 5 people · 1 owner · 1 agency · 3/0 empty".
  4. *Target split*: CRR (existing clients) vs NBD (new clients) share slider (e.g. 50/50 → ₹3.75 Cr each), "GP split follows turnover" toggle; Owner's top 20% clients (sales from owner's own clients this year); per-seat month-by-month target table (seats × Apr…Mar × Year) following seasons/holidays; "Science check" warnings ("Targets add up and no rule is broken").
  5. *Customer rules*: a new customer stays "New" until N orders (3) or N days (90) — whichever first/both; Sleeping after 60 days no order; Lost after 180 days (single setting; the Customer Master tags in §11.2 read these same values). Sleeping/lost customers go to the CRR SC's win-back calls (sorry / connect / reference).
  6. *After the order — CRM FMS*: steps table (Confirm order — CRM — 2 hours after the order — docs: order confirmation; Dispatch/delivery — CRM — 0 days by the promised date — invoice, e-way bill — photo proof; Documents to customer — 2 days after the previous step — invoice copy, delivery proof; Payment follow-up — on the payment due date — statement; Payment received — receipt) with owner seat, planned time, documents, proof; Reset to default; + Add step. This is a real FMS flow under the hood.
  7. *NBD leads & funnel*: lead sources (Website, Google/Meta ads, IndiaMART/portals, Reference, Dream 100, Exhibition, Tender portal, + add) with counts; enquiry form field toggles (name/mobile/city/source/requirement always on; company name, email, budget/expected value, when they will buy); Qualify questions — an enquiry becomes a lead when all are "Yes" (Talking to the person who decides? Need is confirmed? + add); funnel stages (First contact → Meeting → Demo/sample/trial → Proposal in person → Negotiation → Won/Lost) with planned days per stage.
- **Settings (4 pages)**: Holidays (shared with HR), Weekly off, **Seasons** (Peak +40%, Good +15%, Slow −20%; assign months; "Your year at a glance" strip), **Round figures** (round targets to nearest ₹1,000/₹10,000/₹1 L).

### 11.2 Daily screens
- **Dashboard**: banner "Good afternoon, {name}" + "LIVE · {date}", month target, achieved MTD (% on pace), gap to close + days left; buttons Start today's calls / Collect overdue / NBD funnel / System Master. KPI tiles with sparkline and delta: Revenue MTD, Gross profit MTD (margin), Orders this month, Collection due (overdue amount), Today's calls (done/overdue), NBD leads open (this week). Revenue vs target chart (achieved/target/GP by month), Plan health ring "57% of year done".
- **Customer Master**: tiles Customers, Top 20% share of GP (80/20 check), With the owner (₹), Sleeping, Lost, Vampires. Search name/city/mobile/segment; chips All, Top 20%, Middle, Bottom 20%, New, Sleeping, Lost, Vampire, Owner's, + custom tags (Key account, Price sensitive, Gives referrals). Table: customer (name, city, mobile, segment), tags, sales 12m (₹ + orders), gross profit (₹ + % + rank), last order, customer segment (Dealer/Distributor/Contractor/OEM/Institution), handled by. Sort by GP rank. **Fields & tags** dialog: automatic tags (Top 20% by ₹ GP 12 months → go to the owner; Bottom 20% → review or stop; New; Sleeping / Lost — thresholds from Customer rules, default 60 / 180 days; Vampire = top-40% sales but pays later than credit days and GP below the middle — toggle; Owner's customer) + your own tags (name + colour). Import, + Add customer.
- **SCOT Sheet** (Sales Coordinator Order Taking): "The CRR SC's order-taking sheet: average order, how often, usual date, and the date to call". Example line: "Ram · ₹10,000 average order · every 20 days · usual date 10th · call on the 5th · calling 1× month · weekly". Tiles On SCOT (regular customers), Calls today, Overdue, Next 7 days, Expected 30 days ₹. Calls-per-day bar chart next 30 days (busiest day, average/working day). SCOT vs CRR target (CRR target this month, SCOT expects next 30 days, gap to fill with win-back calls, sleeping+lost to call). Filters All/Overdue/Today/Next 7 days/Later/Sleeping/by SC. Table: customer, next call (late/due), average order, orders every (days), usual date, call before (days), order due, rhythm (Weekly/Fortnightly/Monthly/Every N days), usually orders (top items), SC. Row click → customer card (SCOT row values, what they buy most, order history 12 months, last order). **SCOT settings**: call this many days before the usual date (5), best time to call (Morning), include sleeping customers, move a call off holidays and weekly offs.
- **Today's Calls**: tiles Calls due, Done today, ₹ taken today, Today's CRR target, Win-back. Cards / Grid toggle; filters Due calls / Win-back / Done today; SC selector. Card: customer, phone (tap to call), lateness, average order, last order, order due, "Usually orders ₹2.03 L every 12 days · Valves, Packing material", buttons **✓ Order** · Later · Not now · Lost. Result dialog: Order taken (goes to CRM Orders + starts the after-order FMS) / Call later (pick a date) / Not now (next cycle) / Lost (why lost* → customer moves to win-back list); note; Save result.
- **CRM Orders**: tiles calls due, done today, orders, on-time %, backlog ₹. Kanban columns = after-order FMS steps (Confirm order, Dispatch/delivery, Documents to customer, Payment follow-up, Payment received, Next step…) with cards (customer, amount, planned, late badge, action button). Step dialog "Step 1: Confirm order": planned, owner, lateness, done at*, documents checklist (Order confirmation), photo proof file, why late (if late)*, note, ✓ Mark step done.
- **Collections**: receivables by customer with ageing (0–30/31–60/61–90/90+), due today, promised dates, escalation chart run by the CRM person, follow-up log, WhatsApp statement send.
- **NBD Funnel**: owner filter (Everyone/seat), Stages settings, + New enquiry. Tiles To qualify, Open leads (₹ in funnel), Stuck (past planned days), No next action, Won 90 days (₹), Win rate %. "Enquiries to qualify" list (name, contact, city, mobile, source, when, need) with **Qualify** button → dialog (Qualify / Not qualified; qualify questions Yes/No; expected value ₹; next action* + on date*) → "Make it a lead". Kanban by stage with cards (company, contact, city, value, days in stage vs plan, source, next action + date, owner, On track/Stuck).
- **MeCA / MCAP**: weekly scorecard per sales seat — leads, conversion, average sale, calls made vs planned, orders vs target, measured every week (W1–W4/month), with R/Y/G.

---

## 12. Other integrations
- **Google Drive**: "Where your files go — Right now, files are kept on the {APP} server" → connect own Drive; guided 4 steps with checkboxes (create Google Cloud project + enable Drive API; OAuth consent screen External, scope `https://www.googleapis.com/auth/drive.file`, publish app (testing mode disconnects after 7 days); create OAuth client (Web application) with redirect URI `{BASE_URL}/api/integrations/google-drive/callback`; paste Client ID & Secret → Connect Drive). FAQ panel. Uploads then go to a "{APP} Files" folder; existing files stay where they are. Only the account owner can set it up.
- **API (public)**: REST under `/api/v1` with API key header; endpoints for customers, items, stock moves, orders, FMS records start/step done, webhooks out (event subscriptions).
- **Tally connector** (later): sync ledgers/stock items/vouchers using Tally's XML over HTTP (port 9000) from a small agent on the Tally machine that calls our API with an API key.
- **GST lookup**: pluggable provider interface; env `GST_API_PROVIDER`, `GST_API_KEY`.

---

## 13. AI layer

- `LLM` interface `{ complete(messages, opts), json<T>(messages, zodSchema) }` with providers Anthropic, OpenAI, Gemini, Ollama. Config per company in Integration → AI (provider, model, key encrypted). If no key: AI buttons show "Connect AI in System Master".
- **Business details** (company memory): long text "Your business, in your words" — what you make/sell, customers, how an order moves, who does what, how long things take, papers you make, words your team uses, where it goes wrong. Quality meter ("Very good · 521 words"). Every AI prompt includes it. Buttons: Refresh with our AI (rewrite from data), "Update it with ChatGPT" (copy a prompt, paste the answer back). "Remember this for next time?" suggestions after each AI draft → append to Business details.
- **Build with AI** (process): input "How does the work go?" (text or voice; English/Hindi/Hinglish; ≥ 30 words recommended, counter "0/30 words") + optional name/department; examples (Order to dispatch, Purchase request, Customer complaint, New employee joining). Output (zod-validated): flow name, run name, departments, coordinator, problem solver, start fields, steps (type, name, doer by name→matched to users, planned time, fields, decision branches), "Remember this" rules. Show "Your flow, drafted by AI" summary (11 steps · 5 start fields · 14 step fields · Everyone is assigned) → ask for changes in own words → **Open in the Builder**.
- **Edit with AI** on any flow ("add a quality check after packing; Ravi does the invoice").
- **Build a master with AI**, **Suggest KPI cards**, **Ask** (Home search natural-language → AI writes a safe, parameterised read-only query plan over whitelisted views, returns answer + table + link), **Daily summary** to owner, **Dictate** (speech → text, Hindi supported), **AI follow-up** rule type (AI drafts the chase message).
- Guardrails: AI never writes to the DB directly — it proposes; user confirms. Log every AI call (tokens, cost) in `ai_usage`.

---

## 14. Data model (Prisma — key tables; add indexes on `company_id` + status + due fields)

core: `Company`(settings Json, timezone, fyStartMonth) · `Branch`(parentId, lat, lng, radiusM) · `Shift` · `Department`(parentId, hodUserId, color) · `Designation` · `Role`(permissions Json) · `User`(code, name, mobile, email, passwordHash, roleId, designationId, mainDepartmentId, reportsToId, status, loginEnabled, branchId, shiftId, defaultBuddyId, telegramChatId, lang, avatarUrl, hr Json) · `UserDepartment`(userId, departmentId) · `Counter`(companyId, key, fy, value) · `AuditLog` · `Attachment`(entityType, entityId, path, mime, size, driveFileId) · `ModuleSetting`(module, json, changedBy) · `ApiKey`(hash, last4, lastUsedAt, revokedAt)
work: `Task` · `TaskEvent`(type: follow_up|date_moved|comment|status) · `ChecklistMaster` · `ChecklistRun` · `ChecklistRunItem` · `Slip` · `SlipSolution` · `Ticket` · `TicketEvent` · `EaItem` · `Cover`(entityType, entityId, originalUserId, buddyUserId, from, to, status)
fms: `Flow`(status, version, publishedAt) · `FlowVersion`(definition Json) · `FmsRecord`(flowVersionId, number, title, data Json, status, currentStepIds) · `FmsRecordStep`(stepKey, doerId, plannedAt, startedAt, doneAt, status, data Json, decision) · `DocumentType` · `Document` · `KpiCard`
masters: `MasterDef`(fields Json) · `MasterRow`(data Json)
notify: `NotificationRule` · `Template` · `ReminderPattern` · `Outbox`(channel, to, payload, status, tries, providerId) · `Notification`(in-app) · `TelegramLinkCode` · `PushSubscription` · `ChannelConfig`(encrypted Json)
hr: `HrRules`(Json) · `Holiday` · `WeeklyOff` · `Punch`(type, at, lat, lng, accuracy, selfieId, flagged, flagReason) · `AttendanceDay` · `CorrectionRequest` · `LeaveType` · `LeaveBalance` · `LeaveRequest` · `BuddyRequest`
ims: `Item` · `StockMove`(type, qty, rate, refType, refId, approvedBy) · `StockSnapshot` · `ImsRules`(Json) · `PurchaseOrder` · `PoLine` · `AuditCount`
crm: `Customer`(segment, handledById, creditDays, rhythm Json) · `CustomerTag` · `Contact` · `Lead`(source, stage, value, nextAction, nextActionAt, ownerId, qualify Json) · `Call`(customerId, scId, dueAt, result, note) · `SalesOrder`(→ FmsRecord) · `Invoice` · `Payment` · `Plan`(fy, status, json) · `SeatAssignment` · `Season`
ai: `AiConfig` · `AiUsage` · `BusinessDetails`

---

## 15. Seed / demo data
`npm run seed:demo` creates company "Demo Industries" with 25 people across 14 departments (Admin, Accounts, Dispatch, HR, IT, Logistics, Maintenance, Management, Marketing, Production, Purchase, Quality, Sales, Store), shifts (General 09:00–19:00, Morning 07:00–15:00, Evening 15:00–23:00, Night 23:00–07:00, Office 09:30–18:30), 4 branches, 19 designations, 8 flows (Sales FMS, Sales Desk FMS, Sales Order to Dispatch, New Client Audit Project Onboarding, Order to Delivery, End-to-End Pharma Sales Order Fulfilment, Returns & Complaints (13 steps), Lead to Order Conversion (12 steps)), ~30 tasks in mixed states, 6 checklist masters, 24 customers with order history for SCOT, 20 leads, 50 items with stock history.
`npm run seed:ggm` creates GGM Minerals skeleton (Kishangarh plant, Tonk mines, Niwai factory branches; departments; no fake people).

---

## 16. Deployment target (see /deploy/INSTALL.md)
Ubuntu 24.04 LTS on i7-12700 / 48 GB / 1.8 TB. Docker Engine + Compose plugin. Services: `db` (postgres:16, volume `/srv/mono/pg`), `api`, `worker`, `web` (Caddy serving built SPA + reverse-proxy `/api` to api), `cloudflared` (token from Cloudflare Zero Trust → public hostname e.g. `mono.ggminerals.com` → `http://web:80`), `backup` (nightly `pg_dump` + uploads tar to `/srv/mono/backups`, keep 14 days, optional rclone to Google Drive). `.env` holds `APP_NAME, BASE_URL, APP_SECRET, DATABASE_URL, TZ, SMTP_*, TELEGRAM_BOT_TOKEN, VAPID_*`. Health endpoint `/api/health`. Log rotation. UPS recommended; auto-restart `unless-stopped`.

---

## 17. Definition of done (every phase)
- Migrations + seed run clean on an empty DB. `lint`, `typecheck`, unit tests, build all pass.
- Every new screen works at 380 px and 1440 px; empty, loading and error states exist.
- Permissions enforced on API (not just hidden in UI). Company scoping tested.
- Every status change goes through the shared state machine and writes audit + event.
- Update `/docs/CHANGELOG.md` and the "Status" table below.

## 18. Status (update as phases complete)
| Phase | Scope | Status |
|---|---|---|
| 0 | Scaffold, auth, deploy skeleton | done (31/10/2026) |
| 1 | Company setup, departments, users, roles, org chart, Home/Ask | done (02/11/2026) |
| 2 | Notification engine, Telegram, templates, rules, reminders, worker | done (02/11/2026) — live Telegram/WhatsApp delivery needs GGM's own bot token / provider key |
| 3 | Delegation, checklists, scorecard, R/Y/G | done (02/11/2026) — Dictate uses the browser's speech recognition until phase 6; holiday screens arrive in phase 7 |
| 4 | Help slips, tickets, EA, weekly MIS, Business Engine flow designer | done (02/11/2026) — MIS PDFs use Helvetica (Hindi names need a Devanagari font later) |
| 5 | FMS builder, engine, Live FMS, My steps, documents, KPI cards | done (03/11/2026) — "Build/Edit with AI" and "Suggest KPI cards" arrive with the AI layer in phase 6; Buddy cover for steps arrives with HR in phase 7 |
| 6 | AI layer | done (04/11/2026) — acceptance met on DeepSeek (`deepseek-flash`): Lead to Order → 12 valid steps, all assigned. Claude not yet tried (no key). Rows/import for masters arrive in phase 10 |
| 7 | HR rules, attendance, leave, Buddy, cover board | done (04/11/2026) — biometric devices import by CSV (a device API adapter comes later); the selfie rule is per company/team/person. Added at GGM's request: work patterns (shift / hours a day / hours a week) and gross pay from attendance (month / day / hour) with pay rules and leave by designation; PF/ESI/TDS, payslips and hiring are a later phase |
| 8 | IMS | done (04/11/2026) — FMS stock steps match item lines by code or name (item lines are free text until masters arrive in phase 10); stock is one number per item (transfers record the location) |
| 9 | Sales CRM | done (05/11/2026) — charts are small SVG components (no Recharts yet); order line items are free text until masters arrive in phase 10; Contact / Invoice / Season / SeatAssignment live inside the CRM settings and orders rather than as tables |
| 10 | Masters library, Google Drive, public API, WhatsApp, PWA push, hardening | not started |

---

## 19. Decisions log (agreed at kick-off, 31/10/2026 — full reasoning in /docs/adr/0001-kickoff-decisions.md)
1. Project root is `~/mono` (git repo). Start Claude Code from there.
2. Worker reuses API services by importing `@mono/api` modules; one server Docker image runs as `api` or `worker`.
3. Prisma schema in `/prisma/schema/*.prisma`; client generated into `packages/db`, which adds company scoping and soft-delete helpers.
4. Domain events use a transactional outbox: a `DomainEvent` row is written in the same DB transaction as the change; the worker dispatches it. The in-process emitter only feeds SSE.
5. Refresh tokens live hashed in a `Session` table; rotated on every refresh; logout and password change revoke them.
6. Login identifiers (mobile, email) are unique per company; if one identifier matches several companies, the login screen asks which company. Mobiles stored E.164 (`+91…`).
7. Cookies `HttpOnly; SameSite=Lax; Secure` (prod); every mutating request must carry a matching `Origin`.
8. All deletes are soft (`deletedAt`), allowed only when nothing still references the row.
9. Money = `BigInt` paise, sent over JSON as a string; quantities `Decimal(14,3)`.
10. Wall-clock settings (shift start, due time) are stored as minutes from midnight in the company time zone; instants are `timestamptz` UTC.
11. SSE sends a heartbeat every 25 s (Cloudflare idle timeout); Caddy does not buffer `/api/events`.
12. A one-shot `migrate` compose service runs `prisma migrate deploy` before `api` and `worker` start.
13. React 19, TypeScript 6, Tailwind 4, Prisma 7 (pinned at kick-off).
14. Hindi strings are machine-drafted and marked for review by GGM staff.
15. Delegation `REOPENED` is an event (status returns to `OPEN`, `reopenCount++`); `CREATED` is never persisted.
16. HR full-day hours default = 8.
17. Night shifts count on the date the shift starts.
18. Customer tags: `CustomerTag` table only (no `tags[]` array on Customer).
19. Off-machine backup (rclone to Google Drive) is part of the install steps and on by default.
20. PWA manifest/icons in Phase 0; web push sending + per-device opt-in in Phase 2 (install prompt and offline queue in Phase 10).
21. Help Slip "accountability (none)" (answered 02/11/2026): nobody else is held to it — the raiser stays accountable. The other choices make the receiver or the approver accountable. The accountable person is told when the slip is late.
22. Logins created by an admin (add person, login toggle, reset) get a one-time password shown once; the person must choose their own at first sign-in, enforced by the API (`PASSWORD_CHANGE_REQUIRED`).
23. "Paste a list" imports all-or-nothing, reports problems per line, and creates departments/designations that don't exist yet.
24. Org chart: a drop counts only where the pointer is; the head slot wins over its column. HOD of a department is always also a member of it.
25. `seed:demo` holds org data only for now; each later phase adds its own demo data (flows, tasks, checklists, customers, leads, items).
26. Notifications: templates use named placeholders (`{{doer}}`); WhatsApp templates are numbered on submit. Defaults: every §7.3 event × WhatsApp/Email/Telegram × English/Hindi; one rule per event (team → Telegram + in-app + push, clients → WhatsApp + email). In-app is created immediately, once per person per event; other channels wait for the rule's delay and the person's quiet hours (default 21:00–07:00, company time zone). Escalations, test messages and Telegram codes ignore quiet hours.
27. "Reply" for escalations = the person read the notification (app or Telegram "Seen"), or did anything on the same record after it was sent.
28. Channels a company hasn't set up are recorded as SKIPPED when queued; send failures retry 5 times with backoff (30 s → 4 min) then FAILED.
29. WhatsApp approval happens in the provider dashboard (WATI/AiSensy have no reliable submit API); MONO marks templates Pending and reads statuses back from WATI. AiSensy sends through API campaigns named like the template code.
30. One Telegram bot per company (or the .env bot for companies without one), long polling in the worker. A token must not be polled from two places.
31. R/Y/G (per task, cancelled not graded): Green = done on time, never revised; Yellow = 1 day late (any part of a day counts) or revised once; Red = 2+ days late or revised 2+ times; Open = not done and not yet late.
32. Scorecard: a KPI line for the current week grades what was due by now **or is already done** (early work counts at once). Next week's target = the benchmark once met, else this week's actual − 10 points (never below the benchmark). States: meets / off this week / missed twice (this and last week over the benchmark) / no data.
33. Nobody verifies their own work: if the task's verifier (or the EA/creator fallback when "EA verifies" is on) is the doer, the task has no verification step.
34. Checklist runs are created up to 24 h ahead, unique per (master, planned time, doer); saving a master sweeps it immediately. Deleting a master keeps its runs as history, but they leave lists and counts and are never reminded or missed.
35. `delegation.overdue` fires at most once per task per local day; moving the date resets it.
36. People are not notified about their own actions (tests, escalations and Telegram codes excepted).
37. Holidays live in the `Holiday` table from phase 3 (recurrence skips them); the calendar screens come with HR in phase 7.
38. The change-password rate limit follows `LOGIN_RATE_LIMIT`. Web screens are loaded per route (React.lazy) to keep the phone download small.
39. Help ticket escalation is a level (0/1/2) on the ticket, not a status. Level 1 when the first reply or the planned fix is missed (→ coordinator, else the solver's HOD); level 2 one SLA later — 2× the reply time, or the planned fix + the fix time (→ HOD and owner). Moving the fix time resets the level. Every "mark fixed" after a reopen needs fresh proof.
40. Help slip steps have time limits: receiver forwards / decides, approver decides, raiser fixes a returned slip (receiver's time), raiser closes. One late notice per step to its holder and the accountable person. Decided slips close by themselves after the raiser's time (approved ones only once their task is done or cancelled).
41. EA boards belong to owners. The EA is the person set in the flow designer; anyone with `ea.edit` can stand in. Daily brief, weekly plan and Monday MIS are sent once each through `JobMark` keys. The Someday review comes every N days counted from Monday 05/01/2026 (no stored state).
42. Weekly MIS grades what was due that week (or already done), like the scorecard; the score is the average of the parts that have data. Admins see everyone, HODs their team, everyone else themselves.
43. Flow designer settings are validated per module; person pickers must be active people; "Reset to default" deletes the company's row. Every setting shown has an effect. An event may leave out recipients with `payload.skipRecipients`. Built-in rule changes apply only to rules a company never edited (`RULE_UPGRADES`).
44. Server PDFs use pdfmake with its built-in Helvetica and no file or network access while rendering. New npm packages are pinned to releases at least two weeks old.
45. Playwright runs one test at a time (specs share the demo accounts); live notification toasts share one slot.
46. Dates are only ever shown and typed as DD/MM/YYYY (times 24-hour HH:mm), always with the year. Browser date/time pickers are not used anywhere (they follow the browser locale); MONO's own DateInput/TimeInput replace them, and an e2e test fails if one comes back.
47. Every option list filters as you type (the shared Select): all typed words must match, best matches first.
48. Telegram has no read receipts for bots: any update from a linked chat marks everything delivered there before it as read (this also counts as a reply for escalations). No "Seen" button.
49. Proof files (task done, ticket fixed, checklist submitted) are sent into Telegram with the verifier's message; every bot command goes through one tested router (`onText`).
50. FMS flows are edited as one draft; publishing copies it into an immutable `FlowVersion` (v1, v2…). Records keep the version they started on. Partial saves of flow details use a patch schema with no defaults, so only the fields sent change.
51. FMS planned times count working minutes: shift hours on working days, night shifts across midnight, holidays and weekly offs skipped. "Full calendar" counts every minute.
52. A step with several doers goes to the one with the fewest open FMS steps. "Whoever started it" steps fall back to the flow's coordinator when nobody signed in started the record (public form).
53. An FMS step is "due soon" an hour before its planned time and "late" after it (each told once); at 2× the planned duration it is "stuck" and the problem solver is told.
54. Documents are numbered `{PREFIX}/{FY}/{0001}` per type through `Counter`; cancelled numbers are never reused.
55. The public form has no captcha service. It uses a rate limit, a honeypot field and a small sum question whose answer is HMAC-signed with `APP_SECRET`.
56. Delegation "Pass on" (answered 03/11/2026): a task done by several people one after another stays one task. The doer passes it on with what they did, the next person and a new due time (it can't be in the past or to themselves). The next person accepts it like a new task (not when it goes back to whoever gave it). A pass-on date is a new part, not a revision. History records each hand-over (from, to, both dates). People who passed it on keep seeing it. Fixed chains that repeat belong in an FMS flow instead. The task counts in reports for whoever finishes it; each earlier part's timing is visible in its hand-over.
57. Task notes are `TaskEvent` rows of type `note`, written by anyone who can see the task (also after it is done, not once cancelled). They go to the doer, creator, verifier and everyone who did a part (`helper` recipient). The Notes tab shows every written entry (notes, follow-ups, hand-overs, done notes, reasons) with name and time. Telegram buttons on a message can be limited to one person (`telegramActionsFor`).
58. AI (phase 6): one `Llm` interface (`complete` / `json` with a zod schema). Anthropic goes through the official SDK (`@anthropic-ai/sdk` 0.135.0) with structured outputs and `fallbacks: "default"`; OpenAI, Gemini, DeepSeek (OpenAI-compatible, address built in; added 04/11/2026 at GGM's request) and Ollama (streamed) go through `fetch`, with the JSON checked and asked for once more if it doesn't match. The default model is Claude Opus 5.5; the company can pick another. The key is stored encrypted with `APP_SECRET` and never sent back to the browser. Every call is logged in `ai_usage` (feature, prompt id@version, tokens, time, estimated cost in millionths of a dollar).
59. Prompts are versioned files in `apps/api/src/modules/ai/prompts/` (`build-flow.v1.ts` …). Every prompt includes the company's Business details. The AI only proposes: drafts are shown for review, and nothing is saved until a person accepts. A process draft is checked by MONO; problems it can name (missing time, broken branch, unreachable step, no end) go back to the model once, and the version with fewer problems is kept. The key `end` is reserved for "the record closes".
60. Ask never runs SQL from the model. The model fills a plan (view, columns, filters, group, aggregate) over six read-only `ai_v_*` views; MONO checks every name against the shared catalog, binds every value, always adds `company_id`, and runs the query read-only with a 5 s timeout. People without `ai.admin` see only their own rows (plus the people list).
61. Speech to text: the company chooses the browser (free) or OpenAI Whisper / Gemini (Hindi and English) in AI settings. The daily summary goes to the owner at 08:45 company time, once a day (`JobMark`), only when AI is connected. An "AI follow-up" rule lets the AI write the Telegram/email text; WhatsApp keeps its approved template, and the template is used whenever the AI has nothing.
62. Rate limits are set per route. Hook lists (`onRequest`) are never shared between routes, because the rate limiter adds its hook to the list and a shared list would carry one route's limit to all the others.
63. One calendar (`companyCalendar`) drives FMS due times, checklist runs, leave days and attendance: holidays, plus weekly offs per weekday (a branch's own win over the company's; none set = the default shift's days). A half weekday counts as working.
64. Attendance is a pure rule (`computeDay`): first IN, last OUT; late past the grace; a half day when late past "half day after", or fewer than the full-day hours (under half of them = absent); a missed punch-out is a half day until corrected, or counts to shift end. A day is settled two hours after the shift ends and settled again after a correction or an import. Days before someone joined are never marked.
65. Absent without leave = someone who punches (any punch in the last 14 days) with no IN by shift start + "half day after", on a working day, with no approved leave. The HOD is told first; the owner too once the confirm time has passed (or right away if the worker first notices late).
66. Buddy cover moves the work: at the leave's start the Buddy becomes the doer and the work shows "Covered by …" (tasks, FMS steps, checklist runs; the sweep makes runs inside a cover for the Buddy). At the end it returns by the rule; "started" = any action by the Buddy on a task since the cover was arranged, data or a note on an FMS step, ticked items on a run. Suggestions follow the company's order and the other-department rule, but a person may choose any active colleague. The HOD is only the last suggestion.
67. Leave: the approver is the person's HOD (or the parent department's); HR (hr.admin or the HR person) can decide any leave; nobody decides their own. Balances are per leave year; comp-off is days earned in the validity window; LWP isn't limited. "Block approval" refuses while work has no accepted Buddy; "Warn only" approves and marks the leave.
68. Telegram buttons on HR messages: the Buddy gets Yes / Can't, the HOD Approve / Reject (only for them, via `telegramActionsFor`). Plain YYYY-MM-DD values in any message show as DD/MM/YYYY.
69. Work patterns (answered 04/11/2026), per person in `EmployeeTerms`: fixed shift (default), hours a day (any time of day, never late; under half = absent, under all = half day, more = overtime), or hours a week (Monday–Sunday; the week, not the day, counts). Hours a day / a week may set a latest start time for the absence alert; without one there is none. A night shift belongs to the date it starts, including the punch card after midnight, absence alerts and the cover board.
70. Pay from attendance is **gross only**. PF, ESI, TDS, payslips and loans wait for the accountant (§9.2). Each person is paid by the month, the day or the hour (paise in `EmployeeTerms.rate`; without terms, the HR-details salary is a monthly rate). Pay rules (`PayRules`, overrides by department < designation < person) set: the month's day value (all calendar days, working days only, or a fixed number), whether days off are paid, what working a day off gives (comp-off by default; extra pay × a day, a fixed amount, or nothing — a comp-off is earned only under the comp-off rule), overtime × the hourly rate, a cut per N late days, and the weekly shortfall. A salary is cut only for days on record (absent, unpaid leave, half days); a day with no record (before MONO was used) doesn't cut a salary and doesn't pay a day wage, and is shown. Days before joining (HR-details DOJ, else when the person was added) are not paid. A running month counts up to yesterday. Pay figures are number paise inside the calculation (they fit easily).
71. Override schemas never carry defaults (`overrideOf`): zod's `.partial()` keeps each field's default, so an override would otherwise reset every answer it didn't mention. A zod error thrown inside a service is a 400, like route validation.
72. Pay is HR's: hr.admin or the HR person in the rules sees and changes it, and nobody changes their own pay except the owner (`*`). The Payroll menu item is shown only with hr.admin (`NavItem.permission`). A month can be closed once it has ended and every day is settled. The closed `PayRun` keeps the figures. Reopening needs a reason and deletes the run, with its figures kept in the audit log.
73. Leave a year can differ by designation or person (`LeaveQuota`): the person's own number, else their designation's, else the leave type's. This year's balance follows at once.
74. Inventory stock (phase 8) is one number per item, kept on `Item.stock` and changed only by `applyMove` in the same transaction as the `StockMove` row. An issue or negative adjustment can't take it below zero: the check and the change are one `UPDATE … WHERE stock >= qty`. Transfers record from / to and move the item's location, not the quantity. Receipts, issues and transfers apply at once; adjustments (damaged, expired, lost, found, audit count) wait as PENDING for an approver (`adjustMachine`).
75. Adjustment approvers: the listed approvers (anyone with `ims.approve` when none are listed); the owner always, when that rule is on; never your own, when that rule is on. With "any one of them" off, every listed approver must say yes (the owner's yes is final).
76. Bands: red below ⅓ of MAX (or under the item's minimum), yellow below ⅔, green up to MAX, purple above it, none without a MAX. A daily `StockSnapshot` keeps each item's stock and the worst band the day saw (red, then purple). The MAX review counts these days. Average daily use is the issues in the window ÷ the window's days, or ÷ the days tracked for a newer item. MAX is rounded up (whole units from 1, three decimals below). Items with no issues in the window get no proposal and keep their MAX.
77. The MAX review proposes; it never changes an item by itself. The morning job (once a day, `JobMark`) writes PROPOSED reviews for items not reviewed for the review period, and tells the reviewers. A reviewer (or `ims.edit`) applies, sets their own safety factor (MAX from the formula), or skips. Either way the item counts as reviewed for that period.
78. OWS: short = stock + on order below ⅔ of MAX, or under the minimum. Order quantity = MAX − (stock + on order), rounded up. "On order" counts open purchase-order lines, drafts included, so a list turned into drafts isn't ordered twice. The list opens N days before the order day (`ims.ows_ready`, once per order day). Red items can be ordered any day. One draft is made per vendor. Purchase orders are `PO/{FY}/{0001}` via `Counter`.
79. Audit cycles are counted from Monday 05/01/2026, every N days (no stored state). Each cycle the top N items by stock value get an `AuditCount`. A difference raises a COUNT adjustment that waits for approval like any other. The owner hears about dead stock once a month.
80. Turns a year = issues' value in the last 365 days (scaled to a year for an item tracked for less) ÷ average stock value from the daily snapshots. Company turns compare the last 90 days with the 90 before. Inventory figures are sent as strings of paise (decision 9) and quantities as numbers.
81. An FMS AUTO "stock" step issues (or receives) the record's item lines, matching each line's item by code, then by name. A line that can't be posted is written on the record's history and skipped; a record never stops on stock.
82. The year plan (phase 9) stores only its inputs (`CrmPlan.data`); every view is worked out by the shared `buildPlan`, which the browser also runs for live previews. Money in the plan is number paise. Every split is `splitExact` (largest remainder, whole rounding units, the leftover to the biggest part), so the year, quarters, months, weeks and days always add up exactly. The seats × months table uses `splitGrid`, so both rows and columns add up. Months follow working days × season × growth within the quarter; quarters follow growth over the one before × tuning.
83. Once a month is changed by hand, the months are the plan (`months` / `monthsGp`) and their sum is the year: "keep the year total" spreads the difference over the other months in proportion; "change it" moves the year. Changing an input that shapes the months then needs `resetMonths` (`MONTHS_EDITED` asks first). The plan goes DRAFT → PENDING → APPROVED (`planMachine`); only the owner approves or sends back; an approved or pending plan can't be edited until it is unlocked or taken back.
84. The CRM configuration is one `CrmSettings.config` (business type, sell to, seats, split, customer rules, after-order steps, NBD, SCOT, own tags, own fields, pages done); seats are lists of people, not a table. Seat targets: CRR / NBD by the share; the owner's own clients come out of CRR; each side is shared by its seats' people (by weight, else equally). The science check names empty seats, the owner over CRR, no lead sources and no owner.
85. The after-order steps are a real FMS flow ("CRM — after the order"), published on save (and again when seats change): doers are the seat's people; "by the promised date" and "after the payment due date" anchor on start-form date fields; documents become checklist lines. Orders (`SO/{FY}/0001`) start a record in it; an order is DONE when its record closes, and cancelling an order cancels its record through the FMS machine.
86. SCOT needs two orders on different days in the last 12 months: the average order, the median gap, a usual day of the month when most orders fall within 2 days of it (monthly or slower; ties → the day closest to all orders), the next order due, and the call N days before (moved back off holidays and weekly offs). Lost customers, and sleeping ones unless SCOT includes them, are off SCOT. Calls are made once a day (`JobMark`): a SCOT call when its day comes (one per cycle), a win-back call every 30 days for sleeping and lost customers. "Later" waits for its date, "not now" waits one rhythm, "lost" marks the customer lost, and an open SCOT call is cancelled if the customer orders anyway.
87. Automatic customer tags are worked out, never stored: top / bottom 20% by 12 months' GP (the rest middle); new by the customer rule (first = until either limit, both = until both); sleeping / lost by days since the last order (or marked lost); vampire = top 40% by sales, paying after the due date and a GP margin below the middle; owner's = flagged or handled by the owner seat. Own tags are `CustomerTag` rows defined in Fields & tags.
88. Receivables: order amount − payments, with payments set against the oldest orders first; an order is due after the customer's credit days; ageing is by days past due (0–30 includes not yet due). A payment can't be more than is owed or dated in the future. Statements go through `crm.payment_due` to the customer's mobile / email and are logged.
89. Leads: an enquiry becomes a lead only when every qualify question is yes, with a value, the next action and its date; every stage move needs a next action. A lead is stuck past its stage's planned days (its owner is told once per stage). Winning makes a customer (or joins one with the same name). People without CRM edit rights see and change only their own leads and calls; the dashboard shows them their own numbers.
90. MeCA grades each sales seat's week against the plan's weeks for the month: orders against the week's share of the person's month target, and calls done against calls due, green at 100%, yellow from 80%, red below.
