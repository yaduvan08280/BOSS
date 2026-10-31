# PROMPTS.md — paste these into Claude Code, one at a time

## Step 0 — Set up your build environment (once)

Build on **WSL2 Ubuntu 24.04** on your Windows PC; run the live app on the **i7 Ubuntu server**.
Claude Code runs inside WSL (not inside Docker). Docker is only for running MONO.

In **PowerShell (Admin)**:
```powershell
wsl --install -d Ubuntu-24.04
```
Restart Windows, open "Ubuntu 24.04", create your Linux user. Then in the **Ubuntu terminal**:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl build-essential unzip

# Node 22 LTS via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc && nvm install 22 && node -v

# Docker Engine inside WSL (free; no Docker Desktop needed)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # close and reopen the terminal after this
docker run hello-world

# Claude Code
curl -fsSL https://claude.ai/install.sh | bash
claude --version

# Project folder (keep it inside Linux, NOT under /mnt/c — much faster)
mkdir -p ~/mono && cd ~/mono && git init
cp /mnt/c/Users/<YOUR-WINDOWS-USER>/Downloads/CLAUDE.md .
cp /mnt/c/Users/<YOUR-WINDOWS-USER>/Downloads/PROMPTS.md .
claude          # log in with your Claude Pro/Max/Team account, then paste Prompt 0
```
Optional: give WSL more RAM — create `C:\Users\<you>\.wslconfig` with `[wsl2]` / `memory=12GB` / `processors=8`, then `wsl --shutdown`.
Optional: VS Code + "WSL" extension, then run `code .` inside `~/mono`.

Deploying to the i7 later: push `~/mono` to a **private** GitHub repo → on the i7 (Ubuntu 24.04) install Docker the same way → `git clone` → copy `.env` → `docker compose up -d` (Phase 0 writes `deploy/INSTALL.md` with the exact steps).

## How to use this file

1. Create an empty folder (for example `~/mono`), put **CLAUDE.md** in it, and run `git init`.
2. Open a terminal in that folder and start Claude Code: `claude`
3. Paste **Prompt 0 (Kick-off)**. Then paste the phase prompts **in order**, one per session.
   - Before each phase, switch to *plan mode* (Shift+Tab) so Claude shows its plan first. Approve it, then let it build.
   - After each phase: run the app, click through it, then `git commit -am "phase N"`.
   - If a phase is too big for one session, say: *"Continue phase N from where you stopped. Check the Status table in CLAUDE.md first."*
4. When something breaks, use the **Fix prompt** at the bottom. Don't start the next phase on a broken one.
5. Keep CLAUDE.md as the single source of truth. When you change your mind about a feature, edit CLAUDE.md first, then ask Claude to apply the change.

---

## Prompt 0 — Kick-off (paste first)

```
Read CLAUDE.md completely. It is the full specification for this project (MONO) and overrides your defaults.

Before writing any code:
1. Summarise back to me, in 15 bullet points, what you understood: modules, stack, deployment target, and non-negotiables.
2. List any contradictions or gaps you see in CLAUDE.md, and the decision you propose for each.
3. Propose the exact folder structure, the npm workspace setup, and the order of work for Phase 0.

Do not build yet. Wait for my "go".
```

---

## Phase 0 — Scaffold, auth, deploy skeleton

```
Phase 0 from CLAUDE.md (sections 1, 2, 16, 17).

Build:
- npm workspaces monorepo: apps/api (Fastify + TypeScript + zod + Prisma), apps/worker (pg-boss), apps/web (React + Vite + TS + Tailwind + shadcn/ui + TanStack Query + React Router), packages/shared.
- Prisma schema with Company, Branch, Shift, Department, Designation, Role, User, UserDepartment, Counter, AuditLog, Attachment, ModuleSetting, Notification. Include a migration and a minimal seed: one company, one owner user, password from env.
- Auth: login by mobile or email + password (argon2), JWT access + refresh in httpOnly cookies, logout, me endpoint, password change, role guard + company scoping middleware, rate limit on login.
- App shell: top bar (My Workspace / System Master switch, counters, user menu with language EN/HI), collapsible left menu with every section from CLAUDE.md section 3 (placeholder pages are fine), floating assistant button, light/dark theme, i18n setup (react-i18next) with en.json and hi.json.
- Domain event bus (in-process emitter + pg-boss publish) and an audit-log helper. Shared state-machine helper `transition()` with unit tests.
- Health endpoint, structured logging (pino), env validation with zod.
- deploy/: Dockerfiles, docker-compose.yml (db, api, worker, web via Caddy, cloudflared, backup), Caddyfile, backup script, .env.example, INSTALL.md with copy-paste steps for Ubuntu 24.04 + Docker + Cloudflare Tunnel.

Done when: `docker compose up` on a fresh machine shows the login page, I can log in as owner, see the shell on desktop and on a 380 px phone width, and `npm run lint && npm test && npm run build` pass. Update the Status table.
```

---

## Phase 1 — Company setup, departments, users, roles, org chart, Home

```
Phase 1 from CLAUDE.md (sections 3 Home, 4.1, 4.2 Company Setup / Departments / Users / Roles / Org Chart / Appearance, 15 seed:demo).

Build exactly as specified, field for field:
- System Master header cards (Company Setup, Business Engine, Processes, People view, Health check). Compute the numbers live from data; use placeholder 0s for modules not built yet.
- Company Profile with GSTIN verify (provider interface + checksum fallback), points of contact; Shifts & Timings; Branches tree; Designations.
- Departments: cards, HOD, sub-departments dialog, drag a card onto another to make it a sub-department (dnd-kit), delete rules.
- Users: one-by-one form, Paste a list parser with preview, department filter chips, search, grid and cards views, column groups, bulk actions, login toggle, reset password, auto codes EMP-001.
- Roles: permission matrix (module × view/create/edit/approve/admin), built-in roles, enforce on the API.
- Org Chart: stats, zoom/fit, chart/list views, drag a person to another department → "Also add / Move / Cancel" dialog, drop on the top slot to make HOD, person side panel.
- Home "Ask" page: Ctrl+K command search over screens, people and (later) records; category chips; alert banner component; Suggested for you with favourites.
- Appearance settings (logo, colour, app name, default language).
- seed:demo with the 25 people and 14 departments described in section 15.

Write Playwright e2e tests for: paste a list of 5 users, move a person between departments, make someone HOD.
Done when everything in this list works end to end with the demo seed. Update Status.
```

---

## Phase 2 — Notification engine, Telegram, templates, rules, reminders

```
Phase 2 from CLAUDE.md (section 7 entirely, plus 4.2 Integration tabs: Message templates, Link Telegram, Connect channels, Notification rules, Reminder patterns, WhatsApp API).

Build:
- Outbox + worker sender with retries/backoff, delivery status, quiet hours, in-app notifications streamed over SSE with a bell dropdown and unread counter.
- Channel adapters: Telegram (grammY, long polling, commands /start /my /today /done /capture, inline buttons Accept/Done/Move date/Open, photo reply = proof), Email (nodemailer SMTP), WhatsApp provider interface with WATI and AiSensy implementations (send template, check template status), Web Push (VAPID).
- Telegram linking: 8-character codes, 24 h expiry, "Send codes to all not linked", admin group chat.
- Templates screen with defaults for every event in 7.3 (WA, Email, TG, all with variables), Submit to provider, Check all statuses.
- Notification rules screen + defaults, Add a rule dialog, wait + "if no reply escalate to" logic in the worker.
- Reminder patterns screen; reusable by tasks and checklists later.
- Secrets encrypted at rest with APP_SECRET (AES-256-GCM).

Done when: I link my Telegram with a code, trigger a test event from an admin "Send test" button, and receive it on Telegram, email and in-app; a rule with "if no reply in 10 min escalate to HOD" escalates. Update Status.
```

---

## Phase 3 — Delegation, Checklists, Scorecard, R/Y/G

```
Phase 3 from CLAUDE.md (sections 5.1, 5.2).

Build the Delegation sheet and Checklists exactly as described: every tab, KPI tile, filter, table column, chip, dialog (Add task with Dictate placeholder + attachments + paste screenshot + require proof, Import many from CSV/Excel, Move the planned date, Mark done, Add follow-up, verify/reject), the state machines in packages/shared with full unit tests, the Scorecard (KRA/KPI per person per week, benchmark, next-week target, export), and the R/Y/G report (week and month views, download).
Checklists: master editor with all frequency options and holiday skipping, the checklist.sweep job (idempotent), run screen with per-item photo/voice proof, missed auto-close, verify flow, Master changes audit tab.
Hook every transition to the domain events so Phase 2 rules fire (assigned, accepted, done, verified, overdue, missed…). Overdue detection job every 5 minutes.

Done when: the demo seed has tasks in every state, I can run the whole lifecycle from Telegram buttons and from the web, scores and R/Y/G compute correctly (unit tests with fixed dates). Update Status.
```

---

## Phase 4 — Help Slips, Help Tickets, EA System, Weekly MIS, flow designer

```
Phase 4 from CLAUDE.md (sections 5 intro, 5.3, 5.4, 5.5, 5.6).

Build:
- Help Slips (N solutions, receiver screening, return/resubmit, approver decision → auto-creates a linked Delegation task).
- Help Tickets (SLAs, first reply, proof to resolve, raiser confirm or auto-close 24 h, reopen, escalation levels 0/1/2 by worker).
- EA System kanban (Captured, Information, Someday, Waiting with cap, Scheduled with day+slot, Done, Closed), capture from Telegram /capture, daily brief at 08:30, owner's weekly schedule grid.
- Weekly MIS per person, auto-sent Monday 09:00, PDF export.
- The Business Engine flow-designer page for all 5 modules: React Flow chart generated from each state machine, legend, Alerts count, "Set up your flow" panel whose toggles and timings are stored in ModuleSetting and actually change behaviour, "Recent changes by admin" log, roles legend.

Done when every lifecycle works end to end with notifications, and turning "EA verifies before done" OFF makes Mark done go straight to DONE. Update Status.
```

---

## Phase 5 — FMS: builder, engine, Live FMS, My steps, Documents, KPI cards

```
Phase 5 from CLAUDE.md (section 6 entirely, plus System Master Processes list).

Build:
- Flow definition schema (zod) with step types TASK/DECISION/APPROVAL/OUTSIDE/AUTO, all field types, planned-time anchors, backup doers, checklist, documents, stock effect hook (no-op until IMS).
- FMS Builder: list (All/Published/Drafts, table/grid/cards), editor with Steps / Start form / Details, React Flow flowchart with + insert, decision branches, red badges, zoom, PDF export, table view, Save draft, Publish with validation and versioning.
- Process editor full-screen view with "Tell me how it works" panel (AI buttons disabled until Phase 6), tabs Overview/Steps/Coordinator & Solver/FMS report/Dashboard/Video, readiness meter.
- Working-time calculator using shifts, holidays and weekly offs (unit-tested heavily).
- Engine in the worker: start record, assign steps, complete step with form validation, decisions, approvals, AUTO actions (send message, create document), late detection, coordinator follow-up, problem-solver escalation, reassign, hold/resume/close.
- Live FMS (stage strip with counts and late counts, tabs, record table, New record form), Record detail drawer (timeline, planned vs actual, documents, history), My FMS steps, Documents register with numbering per type per FY and pdfmake PDFs, Design & types, FMS report, KPI cards (count/total/average/min/max by period), public share-a-form link.
- seed:demo flows: the 8 flows listed in section 15 with realistic steps and ~40 running records, some late.

Done when I can build a 6-step flow with one decision in the builder, publish it, start a record, complete every step from Telegram/web, see it move on Live FMS, and download a numbered PDF document. Update Status.
```

---

## Phase 6 — AI layer

```
Phase 6 from CLAUDE.md (section 13, plus 4.2 Business details).

Build the provider-agnostic LLM interface (Anthropic, OpenAI, Gemini, Ollama), the AI settings screen with encrypted key and a Test button, ai_usage logging with a cost estimate, and these features:
- Business details page with word count/quality meter, Refresh with AI, "Update it with ChatGPT" copy-prompt/paste-answer flow, "Remember this for next time?" suggestions.
- Build with AI for processes (text or voice, English/Hindi/Hinglish, 30-word guidance, examples) → zod-validated flow draft → "Your flow, drafted by AI" review → change in your own words → Open in the Builder. Match doer names to real users; flag unmatched.
- Edit with AI on an existing flow (returns a diff the user accepts or rejects).
- Build a master with AI; Suggest KPI cards.
- Ask: natural-language questions from the Home search answered via a read-only query planner over whitelisted SQL views (never raw SQL from the model), with answer + table + links.
- Dictate/Speak: speech-to-text for every text box that has a mic (Hindi supported).
- Daily summary to the owner (Telegram 08:45) and the "AI follow-up" rule type.
Write prompt templates as versioned files in apps/api/src/modules/ai/prompts/. Add eval tests with 5 sample process descriptions and assert the JSON validates.
Done when the "Lead to Order Conversion" description from the demo produces a valid 10–12 step flow that opens in the builder. Update Status.
```

---

## Phase 7 — HR: rules wizard, attendance, leave, Buddy, cover board

```
Phase 7 from CLAUDE.md (section 9 entirely; payroll/hiring NOT in this phase).

Build the 7-step HR Rules wizard exactly (questions, chips, defaults, per-team/person overrides, Check & save); punch in/out PWA screen with GPS geofence per branch, optional selfie, offline queue and flags; daily attendance computation job; correction requests with monthly limit; leave types, balances, requests; Buddy check across delegation, checklists and FMS steps for the leave period; Buddy suggestion order; Buddy answer timeout; HOD cover confirmation for absent-without-leave; autopilot options; 08:30 morning cover report; Cover board screen; "Covered by" chips on covered work; work returns when the person is back per the rule; holiday calendar and weekly offs shared with the working-time calculator; biometric CSV import.
Done when: a user applies for leave with open work, a Buddy is asked on Telegram, accepts, the tasks show "Covered by", and after the leave ends unstarted work returns. Unit-test the attendance rules with fixed punch data. Update Status.
```

---

## Phase 8 — Inventory (IMS)

```
Phase 8 from CLAUDE.md (section 10).

Build the IMS rule screens (MAX & review, OWS & purchase, Turns & NOS, Audit & dead stock) with the exact defaults; Who does what with the stock-adjustment approval rules (any one / never their own / owner always); Item master with Excel import; stock moves with approvals; Stock today with colour bands; MAX review job and screen (safety factor up/down by the rules); OWS purchase list and simple PO; turns/NOS report; audit counts; dead stock list; stock value and movement reports; FMS AUTO step "post stock move".
Done when MAX recalculates correctly from seeded history (unit tests) and a red item appears in the OWS list on its order day. Update Status.
```

---

## Phase 9 — Sales CRM

```
Phase 9 from CLAUDE.md (section 11 entirely).

Build the Sales CRM area with its own menu and the 15-page setup journey: Overview; Plan the Year (year target with grow-by-% or exact, quarters, months with the "change year total vs keep total" dialog, weeks and day-by-day split, all adding up exactly — write property tests for the split math); CRM Configuration 7 pages (business type defaults, whom you sell to, seats & people, target split CRR/NBD with per-seat month table and science check, customer rules, after-order CRM FMS built on the Phase 5 engine, NBD leads & funnel config); Settings (holidays, weekly off, seasons with year strip, round figures); approval and unlock flow; Viewing as.
Daily screens: Dashboard, Customer Master with automatic tags + custom tags + Fields & tags dialog, SCOT Sheet with rhythm computation from order history + calls-per-day chart + settings, Today's Calls (cards/grid, one-tap results), CRM Orders kanban driven by the after-order flow, Collections with ageing, NBD Funnel with qualify dialog and stage kanban, MeCA/MCAP weekly scorecard.
Done when the demo seed shows a full year plan that adds up to the rupee, SCOT schedules calls correctly from order history, and an "Order taken" call creates an order that moves through the after-order steps. Update Status.
```

---

## Phase 10 — Masters, Google Drive, public API, WhatsApp go-live, PWA, hardening

```
Phase 10 from CLAUDE.md (sections 8, 12, 16, 17).

Build the Master Library, custom masters with Excel/Google Sheet import and "from a master" fields everywhere; Google Drive connect wizard exactly as specified (4 steps, FAQ, drive.file scope, callback); API Keys screen and the public /api/v1 with OpenAPI docs and outgoing webhooks; finish the PWA (install prompt, push notifications, offline punch queue); then harden: security review (OWASP top 10, auth, file upload limits and type checks, rate limits, CSP), performance pass with 50 concurrent users (k6 script), backup and restore drill documented in INSTALL.md, error monitoring, and a printable user guide per module in /docs.
Done when a restore from last night's backup works on a fresh VM following INSTALL.md exactly. Update Status.
```

---

## Utility prompts

**Fix prompt**
```
Something is broken: <describe what you did, what you expected, what happened, paste the error/log>.
Find the root cause, explain it in 3 lines, fix it, add a test that would have caught it, and run the full test suite.
```

**Match-the-reference prompt** (when a screen feels different from the demo)
```
Compare the <screen name> screen with CLAUDE.md section <n>. List every field, tab, button, tile, chip and dialog the spec mentions that is missing or different in our build, then fix all of them.
```

**Review prompt** (end of each phase)
```
Review this phase as a strict senior engineer: company scoping on every query, permission checks on every route, state machine usage, missing tests, N+1 queries, mobile layout at 380 px, Hindi strings missing. Give me a list, then fix everything you listed.
```

**GGM customisation prompt** (after Phase 10)
```
Run seed:ggm. Then help me set up GGM Minerals: departments and people from my attached list, branches Kishangarh plant / Tonk mines / Niwai factory, shifts, and the first three processes I describe next. Ask me questions one at a time.
```
