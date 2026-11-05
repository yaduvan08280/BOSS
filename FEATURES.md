# MONO — every feature, how to set it up, and what it depends on

MONO is one web app (also installable on phones) where a company sets up its people once and then runs all daily
work: tasks, recurring checklists, problem slips, help tickets, the owner's EA board, step-by-step processes (FMS),
HR attendance / leave / Buddy cover / gross pay, inventory rules, a sales CRM with a year plan, masters, a public
API, and an AI layer. Every piece of work has an **owner, a planned time and a verifier**, and reminders go out on
**Telegram, WhatsApp, email, phone push and in-app**.

How to read this file: each section says **what it does**, **how to set it up** (where to click, in order) and
**depends on** (what must exist first). Section 0 is the order to set everything up for a new company.

---

## 0. Set-up order for a new company (the dependency chain)

| Step | Where | Why first |
|---|---|---|
| 1 | Install (NEW_SETUP_PROCESS.md or deploy/INSTALL.md), first owner from `.env` | Nothing works without the company and owner |
| 2 | System Master → Company Setup → Profile, **Shifts & Timings**, Branches, Designations | Shifts drive due times, attendance and the work calendar; branches carry geofences |
| 3 | System Master → **Departments** (+ HODs) | HODs approve leave, get escalations and see their team |
| 4 | System Master → **Users** (one by one or Paste a list), login on, roles | Every task / step / checklist needs a person |
| 5 | System Master → **Roles** (permissions) | Who may view / create / edit / approve / admin each module |
| 6 | Integration → **Link Telegram** (bot token in Connect channels, then codes) | Reminders and buttons reach people |
| 7 | Integration → Notification rules (Load defaults), Reminder patterns | Decide who hears about what, and when |
| 8 | HR Rules wizard, holidays, weekly offs | Attendance, leave, Buddy, and the calendar every due time uses |
| 9 | Business Engine flow designer (per module) | Who verifies, time limits, which steps are on |
| 10 | Masters (library / build / import) | Lists that forms pick from |
| 11 | Processes (FMS Builder) | Fixed chains of steps (orders, complaints, joining) |
| 12 | Inventory rules + items + opening stock | MAX, bands, ordering |
| 13 | Sales CRM: Plan & setup journey (15 pages), customers | Targets, SCOT calls, after-order process |
| 14 | Integration → AI, WhatsApp, Google Drive; API Keys | Optional add-ons |
| 15 | Appearance, Business details | Look and the AI's knowledge of your business |

---

## 1. Platform basics (used by everything)

### Sign-in and accounts
- Sign in with **mobile or email** + password. Wrong password 10 times from one place → wait 15 minutes.
- Accounts made by an admin get a **one-time password**; the person must choose their own at first sign-in.
- Admin can reset a password (lock icon in Users) → new one-time password.
- Sessions: 15-minute access cookie renewed by a 30-day refresh cookie (rotated each time); sign-out and password
  change end other sessions. A disabled person is stopped on their very next click.
- If one mobile/email is in several companies, the login asks which company.
- **Depends on:** the company and owner (created from `SEED_*` in `.env` on first start).

### Navigation and Home ("Ask")
- Top bar: page title + subtitle, **My Workspace / System Master** switch (owners/admins only), Support, pending-work
  and unread counters, refresh, user menu (profile, language, AI assistant, help, sign out). Chat/assistant button.
- Left menu by section (Workspace, Business Engine, Systems, HR, Inventory, Sales CRM, Masters), with live badge
  counts; collapsible. On phones: bottom bar Home · My work · **+ Capture** · Alerts · Menu, and a drawer menu.
- **Home**: "What do you want to do, {name}?" — search screens, tasks (`#70`), people, records, customers, items
  (**Ctrl/Cmd+K** anywhere). Plain-language questions go to the AI (when connected). Category chips, an alert
  banner (e.g. "9 pieces of work have no Buddy today"), "Suggested for you" with live counts and favourites.
- **My Workspace**: everything waiting for you across modules.
- **Depends on:** permissions (you only see what your role allows).

### Look, language, accessibility
- Whole theme generated from **one seed colour** (30 swatches + any colour), grey warmth, corner radius, dark or light
  sidebar, accent or ink buttons; presets Ink & Honey · Ink · Quartz · Indigo; live preview. Status colours (green /
  amber / red / purple / blue / grey) are fixed, always with an icon and label, with a colour-blind-safe option.
- Per person: light / dark / system, comfortable / compact, larger text, language **English / हिन्दी**, own accent
  (if the admin allows).
- Dates always **DD/MM/YYYY**, times 24-hour, money ₹ with lakh/crore (`₹1.31 Cr`, `₹45.36 L`), FY April–March,
  company time zone (default Asia/Kolkata). MONO's own date and time inputs (no browser pickers).
- **Every list filters as you type**; every option list too (all typed words must match, best first).
- Works at **380 px** (phones) up to wide screens; tables become cards on phones; dialogs become bottom sheets.
- **Set up:** System Master → Appearance (company); Profile (person).

### Installable phone app (PWA)
- "Install MONO on this device" card (Android/Chrome/Edge) or Share → Add to Home Screen hint (iPhone); hidden once
  installed or for 30 days after closing.
- **Phone push notifications** per device (Profile → Phone notifications).
- **Offline punch queue**: punches made without internet are sent when back online.
- **Depends on:** push needs VAPID keys (Integration → Connect channels → generate, or `VAPID_*` in `.env`).

### Support
- Support page: the company's points of contact and admins (tap to call / email), **Raise a help ticket**, and the
  **printable user guides** for every module (Print button).
- **Depends on:** Company Setup → Profile → points of contact (else the admins are listed).

### Data safety (everywhere)
- Nothing with history is hard-deleted (soft delete); **audit log** of every change (who, when, before/after, IP).
- Every change emits a **domain event** (drives notifications and webhooks).
- Status changes go through fixed **state machines** (no illegal jumps).
- Multi-company ready: every record carries its company; companies never see each other.
- Human numbers per company and type: `#70`, `BOP/26-27/0004`, `SO/26-27/0001`, `PO/26-27/0001`; cancelled numbers
  are never reused.

---

## 2. System Master (setup area — owner/admin only)

Header cards: **Company Setup** (steps done, people, departments) · **Business Engine** (5 modules) · **Processes**
(live / being built / not started) · **People view** (heavy / balanced / light / free load) · **Health check**
(% ready + "See what is missing": departments without HOD, people without login, steps without doer, no Telegram…).

| Tab | Features | Depends on |
|---|---|---|
| Company Setup → Profile | Trading name, city, state, owner contact, mobile, email, website, CIN; **GSTIN Verify** (checksum offline; fills legal name + PAN when a GST provider is configured: `GST_API_PROVIDER`, `GST_API_KEY`); points of contact (any number) | — |
| Company Setup → Shifts | Name, start, end, working weekdays, default; overnight shifts (Night 23:00–07:00) | — |
| Company Setup → Branches | Tree with parent, code, city/state, default; geofence (lat, lng, radius) | — |
| Company Setup → Designations | Add / delete-if-unused; coloured chips | — |
| Departments | Type and Enter; HOD; sub-departments (drag a card onto another); people; delete when empty | Users for HOD |
| Users | One by one or **Paste a list** (all-or-nothing, problems per line, creates missing departments/designations); `EMP-001` codes; filters per department; search; Grid/Cards; Team / HR columns (HR-only: DOJ, DOB, biometric ID, bank, PAN, Aadhaar last 4, salary); login toggle; reset password; bulk move / role / login / Telegram codes | Departments, designations, roles |
| Roles | Permission matrix module × view/create/edit/approve/admin; built-ins Owner, Admin, HOD, Supervisor, EA, Member; process roles per flow | — |
| Org Chart | Stats, search, department chips, zoom/fit, Full/Chart/List; drag a person to another department → **Also add** or **Move**; drop on the head slot → HOD; person side panel with open work | Departments, users |
| Integration | WhatsApp API · Message templates · Link Telegram · Connect channels · Notification rules · Reminder patterns · AI · Google Drive (see §9, §10) | — |
| Inventory | IMS rule sets + Who does what (§7) | Users |
| Sales CRM | Your own fields per record type (Lead, Quotation, Customer, Order): label, show, required | — |
| API Keys | Server address, keys, webhooks (§11) | — |
| HR Rules | 7-step wizard (§6) | Shifts, users |
| Business details | "Your business, in your words" with a quality meter; Refresh with AI; Update with ChatGPT (copy prompt / paste back); "Remember this" suggestions | AI for the buttons |
| Appearance | Theme generator, logo, app name, dark default, language default, "staff may pick their own accent" | — |
| Errors | Server / worker / browser errors grouped and counted, details, Mark fixed (reopens if it happens again) | — |

**Flow designer** (Business Engine card): for Delegation, Checklists, Help Slips, Help Tickets and EA — a flowchart
of the module's life drawn from its state machine (Start, Action, Status, Decision, Auto, Finished, Dead-end), Alerts
count, and "Set up your flow": who does it (roles/people), times and rules, steps on/off, **Recent changes by admin**,
roles legend with the Telegram events each role gets, **Reset to default**.

---

## 3. Business Engine

### 3.1 Delegation (one-time tasks)
- **Add task:** doer*, planned date*, verifier, description* (**Dictate** = speak), attach many files (drag-drop,
  camera, Ctrl+V screenshot), "require a photo or file to close", **Import many** (CSV/Excel). The doer gets it on
  Telegram.
- Life: Awaiting acceptance → Open → Pending verify → Done; Decline (back to creator with reason), Move date (reason;
  revision counted), Follow-up, Notes (everyone on the task), **Pass on** (part 2, 3… to the next person, same task
  number, "Worked on by A → B → C"), Mark done (+ proof) → verifier Verify / Reject (reopens), Reopen, Cancel.
- Tabs: Add task · Pending · Verification · Done · FMS report · Scorecard. KPI tiles: Pending, Overdue, To verify (1-h
  SLA), Done this week, My score. Filters by text, dates, doer, week.
- **Scorecard** per person per week: work done %, on time %, verifications done / within 1 hour vs benchmark, last
  week, this week planned / actual, next week target; legend meets / off / missed twice / no data; export.
- **R/Y/G report**: Green on time & never revised, Yellow 1 day late or revised once, Red 2+ days or 2+ revisions;
  week or month (W1–W4); download.
- Overdue notice once a day; reminders to accept; nobody verifies their own work; "Covered by {Buddy}" chips.
- **Set up:** flow designer (EA/verifier, accept within 30 min, verify within 1 h; toggles doer must accept, EA
  verifies, allow reopen). **Depends on:** users; Telegram link for messages; HR for Buddy cover.

### 3.2 Checklists (recurring work)
- Master: name, department/branch, ordered lines (each may require **photo / voice / value**), frequency (daily,
  weekdays, weekly, monthly on a date or last day, quarterly, yearly, every N days), due time, window, doers or a
  role, verifier, skip holidays/weekly offs, start date, active.
- Runs created up to 24 h ahead (every 5 minutes); reminder 30 min before; **Missed** after the window (owner told);
  verifier verify / reject.
- Tabs: My checklists · All · Assign · Checklist master · **Master changes** (audit). Tiles: All, Due today,
  Overdue, To verify, Missed.
- **Depends on:** users; holidays/weekly offs (HR) for skipping; reminder patterns.

### 3.3 Help Slips (problem → solutions → decision)
- Raiser gives the problem + N solutions (1/2/**3**) → receiver forwards or sends back → approver picks a solution or
  writes one → approved slip **creates a delegation task** (linked both ways) → raiser closes. Reject with reason.
- Time limits per step, late notices to the holder and the accountable person; decided slips close by themselves.
- **Set up:** flow designer (receiver, approver, times, accountability, solutions required, receiver screens first,
  approver step). **Depends on:** delegation (for the task).

### 3.4 Help Tickets (issue → fix)
- Raise (solver + planned fix time) → first reply → in progress → **fixed with proof** → raiser confirms (or auto
  after 24 h) → closed; "No" reopens (counted).
- **Escalation** Off / 1 level (coordinator) / 2 levels (HOD + owner) when the reply or fix time is missed.
- **Set up:** flow designer (roles, SLAs, escalation, proof, who closes).

### 3.5 EA System (owner's capture board)
- One-line **capture** (also `/capture` on Telegram) → EA sorts: Information · Someday · Waiting (cap 6) · Scheduled
  (day + slot) · Delegation (creates a task) → Done → Closed. Missed day → Someday.
- Kanban board, owner's weekly schedule, **daily brief** 08:30, weekly plan (Saturday), Someday review every 7 days.
- **Set up:** flow designer (EA person, times, toggles). **Depends on:** Telegram for briefs; delegation.

### 3.6 Weekly MIS
- Per person per week: planned vs done, on-time %, verifications on time, checklist completion, FMS steps on time.
  Owner sees all, HODs their team. Export PDF / Excel. Auto-sent Monday 09:00 to owner and HODs.
- **Depends on:** delegation, checklists, FMS data.

---

## 4. Processes (FMS — Flow Management System)

- **Flow** template: name, what a run is called (Order, Lead…), departments, coordinator + backup, problem solver +
  backup, start-form fields, ordered steps, KPI cards, training video, Draft / Published, versions (v1, v2…;
  records keep the version they started on).
- **Step types:** Task · Decision (yes/no branches) · Approval (reject → chosen step) · Outside (waiting on customer /
  vendor) · Auto (send message, create document, update stock, **call a webhook**).
- **Step settings:** who (people and/or role), backup doer, planned time (value + hours/days + anchor: after previous
  step / after record start / before or after a date field / fixed time), checklist, form fields, documents to
  generate, stock effect, proof required, notifications.
- **Field types:** short/long text, number, amount ₹, date, date-time, yes/no, dropdown, multi-select, photo, file,
  signature, mobile, email, item lines, **from a master** (customers, items, vendors, people, any custom master),
  location. Reuse fields from other flows.
- **Time model:** working shifts (skip holidays and weekly offs, night shifts across midnight) or full calendar.
- **FMS Builder:** list (All / Published / Drafts; table/grid/cards; import template; new); editor with Steps / Start
  form / Details, **flowchart** (zoom, PDF, "+" between nodes, decision diamonds, red badge on steps missing a
  doer) or table; header metrics (steps, people, start-to-end days, steps to fix); **Publish** checks every step has
  a doer and time, decisions have both branches, no orphan steps. **Build with AI / Edit with AI**.
- **Live FMS:** per flow — Running · Late · Due today · On hold · Closed · Planned vs actual · Performance ·
  Permissions; stage strip ("2 here · 2 late"); records table; **+ New {run}**; export.
- **Record drawer:** Timeline (doer, planned, actual, status, data, proof), Planned vs actual, Documents, History;
  do my step, **reassign the open step**, hold / resume / close, step timeline PDF.
- **My FMS steps:** flows that start with you, records you own, steps waiting for you; filters.
- **Engine rules:** due-soon reminder 1 h before; late notice to the coordinator; at 2× planned time → problem solver
  ("stuck"); doer on leave → backup → Buddy → "no backup free" alert; several doers → the one with fewest open steps.
- **Documents:** auto-numbered `{PREFIX}/{FY}/{0001}` per type (party, from flow/record, total, Issued/Cancelled);
  design per type (prefix, fields, header/footer, logo, terms); print / PDF / email / WhatsApp.
- **FMS report** per step and person; **KPI cards** (field + Count/Total/Average/Min/Max + period + comparison;
  "Suggest with AI").
- **Public form link** for a flow's start form (customers/vendors) with rate limit, honeypot and a signed sum question.
- **Depends on:** users and roles; shifts + holidays (due times); masters (master fields); IMS items (stock steps);
  AI (build/edit/suggest); webhooks out need a public https address.

---

## 5. Notifications and messaging

- **Engine:** event → matching **notification rules** → template per channel → outbox → sent with retries (5 tries,
  30 s → 4 min) → status sent / delivered / read / failed / skipped. In-app always; **quiet hours** per person
  (default 21:00–07:00, escalations excepted); people aren't told about their own actions.
- **Channels:** Telegram (bot with buttons Accept · Done · Move date · Open; photo reply = proof; text reply = note;
  commands `/start /my /today /done /capture`; admin group copy), **WhatsApp** (WATI, AiSensy; Interakt, Kit19 listed),
  **email** (SMTP), **phone push**, in-app bell with live updates. Optional Google Chat / Slack webhook.
- **Templates:** per event × channel × language, named variables (`{{doer}}`), defaults for every event, WhatsApp
  submit/status (approval happens in the provider's dashboard), active toggle, sent/read counts.
- **Rules:** when (event), for (team / client / vendor), send to (doer, verifier, creator, HOD, owner, coordinator,
  customer, custom), channels, wait, **if no reply escalate to … after …**, "AI follow-up" (AI writes the chase).
- **Reminder patterns:** 1 day / 3 h / 1 h before, at due, 1 h after, next morning; repeat when overdue.
- **Link Telegram:** % linked, codes (8 characters, 24 h), "send codes to all not linked".
- **Set up:** Integration → Connect channels (Telegram bot token from @BotFather, SMTP, push keys) → WhatsApp API
  (provider + key, Test API) → Link Telegram → Load template defaults → Load rule defaults → adjust.
- **Depends on:** the provider accounts (bot token, WhatsApp provider key, SMTP). Channels not set up are skipped.

---

## 6. HR (HRMS)

- **HR Rules wizard (7 steps)**, each with presets and per-team/person overrides: late & half day; punches &
  overtime (geofence block/flag, location unreadable, selfie, corrections per month, overtime after N min); leave
  year, comp-off validity, HR person, notice period; Buddy (block/warn/off, which leaves, other departments, cap);
  Buddy's answer (suggestion order, answer within, what returns, HOD confirms absence); Autopilot (auto-pick Buddy,
  auto-approve short leave, absent → Buddy, morning message 08:30); check & save.
- **Punch in/out** (web/phone): GPS, optional selfie, geofence per branch, flags, **offline queue**, device id;
  biometric import by CSV.
- **Daily attendance** settled 2 h after shift end: Present / Late / Half day / Absent / On leave / Holiday / Weekly
  off / Comp-off, overtime; **correction requests** → HOD.
- **Work patterns** per person: fixed shift, hours a day, hours a week.
- **Leave:** types (CL, SL, EL, Comp-off, LWP; quota, carry-forward), quotas by designation or person, request →
  **Buddy check** of all open work → Buddy requests (Telegram Yes / Can't) → HOD approval (or auto) → balances.
- **Cover board:** today's absentees, their work, Buddy status, one-click cover; work moves to the Buddy ("Covered
  by") and returns by the rule. Absent-without-leave alerts.
- **Holiday calendar & weekly offs** (per branch) — shared with checklists, FMS and the CRM.
- **Payroll (gross pay from attendance)**, HR only: month / day / hour rates, pay rules (day value, paid days off,
  working a day off, overtime ×, late cut, weekly shortfall), close / reopen a month. PF/ESI/TDS/payslips later.
- **Depends on:** shifts, branches (geofence), departments + HODs, users' HR details; Telegram for Buddy buttons.

---

## 7. Inventory (IMS)

- **Rule sets:** MAX & review (use window 90/120/180 days, review every 15 days, safety-factor steps), OWS & purchase
  (order day, days ahead), turns & NOS, audit & dead stock.
- **Who does what:** store keeper, purchase, reviewer, audit coordinator; adjustment approvers (any one / never their
  own / owner always).
- **Items:** code, name, unit, category, location, lead time, safety factor, MAX, min, rate, vendor; Excel import of
  opening stock.
- **Stock moves:** IN / OUT / TRANSFER apply at once; ADJUST (damaged, expired, lost, found, count) waits for
  approval; stock never below zero.
- **Bands:** red < ⅓ MAX (or under min), yellow < ⅔, green ≤ MAX, purple > MAX; daily snapshots.
- **MAX review** proposals (apply / own factor / skip); **OWS list** and purchase orders per vendor; **audit counts**
  (top items by value each cycle); **dead stock** monthly; reports: stock value, movement, turns, purchase.
- FMS stock steps post moves automatically (matching item lines by code or name).
- **Depends on:** users for roles; items; vendors (Vendors master if present).

---

## 8. Sales CRM

- **Plan & setup journey (15 pages)** with progress, FY selector, Draft / Pending / Approved, "Viewing as {seat}",
  send for approval / unlock: year target (growth % or exact), quarters, months (change a month: change the year or
  keep it), weeks and days (always add up exactly); business type, whom you sell to, seats & people, CRR/NBD split +
  owner's clients + per-seat month targets + science check, customer rules, after-order steps (a real FMS flow),
  NBD lead sources / enquiry fields / qualify questions / stages; holidays, weekly off, seasons, round figures.
- **Dashboard**, **Customer Master** (automatic tags: top / middle / bottom 20%, new, sleeping, lost, vampire,
  owner's; own tags; fields), **SCOT sheet** (each customer's rhythm and the day to call), **Today's Calls**
  (Order / Later / Not now / Lost), **CRM Orders** (kanban per after-order step), **Collections** (ageing,
  payments, promises, statements on WhatsApp), **NBD funnel** (qualify → lead → stages → won/lost, stuck leads),
  **MeCA / MCAP** weekly R/Y/G per seat.
- **Depends on:** users in seats; holidays/weekly offs; FMS (after-order flow); WhatsApp/email for statements;
  customers with order history for SCOT.

---

## 9. Masters

- **Master Library:** 12 ready masters by industry (Vendors, Products, Raw materials, Machines, Spare parts, Vehicles,
  Sites, Transporters, Services, Brands, Stores, Documents) → "Use this".
- **Build my own** with AI (describe → fields → edit → save); unique key and display field.
- **Rows:** add / change / delete (key freed) / search; **import** from Excel, CSV, paste or a **Google Sheet link**
  (all-or-nothing, problems by line, DD/MM/YYYY dates).
- **"From a master" fields** in processes search Customers, Items, Vendors, People or any custom master.
- **Depends on:** AI for "Build my own"; a shared Google Sheet for sheet import.

---

## 10. AI layer

- Providers: **Anthropic (Claude)**, OpenAI, Gemini, DeepSeek, Ollama (local); model choice; key stored encrypted.
- **Build with AI** (process from a description, English/Hindi/Hinglish, checked and repaired), **Edit with AI**,
  **Build a master with AI**, **Suggest KPI cards**, **Ask** (questions answered from read-only views, never raw SQL),
  **Daily summary** to the owner 08:45, **Dictate** (browser free, or Whisper / Gemini speech-to-text, Hindi),
  **AI follow-up** rule type. The AI only proposes; people confirm. Every call logged (tokens, cost).
- **Set up:** Integration → AI (provider, model, key) → Business details (the more you write, the better).
- **Depends on:** an API key from the provider (or a local Ollama).

---

## 11. Public API, webhooks and integrations

- **API keys** (System Master → API Keys): shown once, act as their maker with the maker's current rights, last used,
  revoke; 120 calls/min per key.
- **Public REST API `/api/v1`:** me, customers, items, stock moves, orders, flows (start a record, read it, mark a step
  done), masters and rows. OpenAPI docs at `/api/docs` and `/api/v1/openapi.json`. Money in paise as strings.
- **Webhooks out:** chosen events (exact / `module.*` / everything) posted as signed JSON (HMAC-SHA256), retried with
  backoff, delivery log, test, new secret. Data events: customers, orders, payments, stock moves, master rows, plus
  every notification event.
- **Google Drive:** owner connects the company's own Drive (4 guided steps, `drive.file` scope); new uploads move to
  the "{APP} Files" folder; everything still opens in MONO; stop any time.
- **GST lookup:** pluggable provider (`GST_API_PROVIDER`, `GST_API_KEY`).
- **Tally connector:** later (would use an API key).
- **Depends on:** keys need an admin; webhooks need a public https receiver; Drive needs a Google Cloud project and
  the public `BASE_URL`.

---

## 12. Security and reliability

- Origin check on every change (CSRF), httpOnly cookies, argon2 passwords, encrypted secrets (`APP_SECRET`),
  Content-Security-Policy and security headers, upload size and **file-signature checks**, rate limits per route plus
  a per-IP ceiling, no outgoing calls into the private network (SSRF guard), permissions checked on the server.
- **Error monitoring** (System Master → Errors). Start-up warning when `APP_SECRET` doesn't match saved secrets.
- **Load tested:** 50 people at once, 0 errors, p95 23 ms (deploy/k6).
- **Backups:** nightly database + uploads at 02:30, kept 14 days, optional copy to Google Drive (rclone);
  `./deploy/restore.sh` restores (tested on a fresh data folder). Keep `.env` safe — a restore needs `APP_SECRET`.
- **Deployment:** Docker Compose (db, migrate, api, worker, web/Caddy, backup, cloudflared) on Ubuntu 24.04, reached
  from anywhere through **Cloudflare Tunnel**; health endpoint `/api/health`; automatic restarts; log rotation.

Full details: [CLAUDE.md](CLAUDE.md) (specification and decisions), [docs/guide](docs/guide/README.md) (user guides),
[deploy/INSTALL.md](deploy/INSTALL.md) (server), [NEW_SETUP_PROCESS.md](NEW_SETUP_PROCESS.md) (a PC with WSL),
[docs/security-review.md](docs/security-review.md).
