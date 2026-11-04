# Changelog

## Phase 7 — HR: rules, attendance, leave, Buddy, cover board (04/11/2026)

**HR rules wizard** (System Master → HR rules)
- The 7 steps of CLAUDE.md §9.1 with their defaults:
  1. late & half day;
  2. punches & overtime;
  3. leave & HR;
  4. Buddy;
  5. the Buddy's answer;
  6. autopilot;
  7. check & save, grouped, with a Change link on each group.
- Each answer is preset chips plus a −/+ stepper for any other value.
- "Different for a team or person": a department or one person can have their own grace minutes and away-from-office rule.

**One calendar** (HR → Leave → Holidays)
- Holidays and weekly offs (Working / Half / Off per weekday, for the company or a branch) now drive everything: FMS due times, checklist runs, leave days and attendance.
- With no weekly offs set, the default shift's working days still apply, so nothing changes for companies that haven't set them up.

**Attendance** (HR → Attendance)
- Punch in / out on the phone:
  - the location is checked against the branch's geofence, and a punch away from the office is blocked or flagged by the rules (a flag tells the HOD);
  - a selfie is taken when the rules ask for one;
  - punches made with no connection are kept with their time and sent when the phone is back online.
- Before the day is settled, the screen shows "At work" / "Not in yet", not a provisional "Half day".
- Each day is settled two hours after the shift ends: Present / Late / Half day / Absent / On leave / Holiday / Weekly off, with the reasons ("40 min late", "No punch-out: half day until a correction"), plus overtime and comp-offs.
  - Night shifts count on the date they start.
  - A missed punch-out tells the person.
  - Days before someone joined are never marked.
- My month: a calendar of days with a colour per status; tap a day to see why, and to ask for a correction.
- **Corrections:** limited per month by the rules (3 by default); the HOD or HR approves, and the day is settled again.
- **Team:** one day for the team (HOD) or everyone (HR): in and out times, status and flagged punches.
- **Biometric import (HR):** a device CSV with code or biometric id, DD/MM/YYYY HH:mm, and IN/OUT if given (else first = IN, last = OUT). Repeats are skipped; unknown codes and impossible dates (31/02) are reported.

**Leave** (HR → Leave)
- Leave types: CL, SL, EL, Comp-off and LWP, with yearly quotas and carry-forward, editable.
- Balances per leave year (April or January). Comp-off = days earned by working half a day or more on a day off, within the validity window.
- Apply: kind, first and last day, half day, reason (Dictate works). Only working days are counted. Overlaps and over-balance requests are refused.
- The form lists **your open work in that period**: tasks due (late ones too), checklists that fall due, FMS steps you hold. Each piece gets a Buddy, the company's suggestion order first:
  1. the step's backup;
  2. your default Buddy;
  3. the least busy free person in your department;
  4. your HOD.
  People away, or already covering the most they may, aren't suggested.
- Buddies are asked on Telegram with **Yes, I will cover / Can't** buttons, and on the web under Buddy requests. An answer is due within the rule's hours; with the autopilot on, a no (or no answer) asks the next person.
- The HOD gets the request on Telegram with **Approve / Reject**.
  - "Block approval" refuses while any work has no Buddy.
  - "Warn only" approves and marks it.
  - The autopilot can approve a short leave by itself once everything is covered.
  - Nobody approves their own leave.
- Calling off a leave gives covered work back at once and returns the days.

**Buddy cover and the cover board** (HR → Cover board)
- When the leave starts, the work moves to the Buddy and shows **Covered by …**. That applies to tasks, FMS steps and checklist runs; new checklist runs during the leave are made for the Buddy.
- When it ends, the work goes back by the rule: **work not started goes back** (the default; anything the Buddy did on it counts as started), all of it goes back, or the Buddy keeps it.
- **Absent without leave:** someone who normally punches and isn't in by the half-day mark is absent. Their HOD is told which work has no Buddy, and the owner too after the confirm time. With the autopilot, the work goes to the first suggested Buddy.
- The cover board shows today's absentees and people on leave, their open work, and who covers it (covered, asked, or nobody). One click gives a piece to the suggested Buddy, or gives everything to someone.
- **08:30 morning report** to the owner, HR and the HODs: who is away and which of their work has no Buddy.

**Demo data** (`npm run seed:demo`)
- Weekly offs, a geofence on the plant, and two weeks of punches (a few late, one missed punch-out, one absence).
- Arjun Rawat on leave today and tomorrow, his task and process steps covered by Sunita Bansal.
- Pooja Jain's leave waiting on her Buddy, and a correction waiting for the HOD.

**Fixes found while testing**
- Plain dates in messages (a leave's first day) showed as 2026-11-06; every message now shows DD/MM/YYYY.
- A biometric line with the code "EMP-003" was taken for the header row and skipped.
- "31/02/2026" was read as 3 March; impossible dates are refused.
- The HOD was counted twice in the Buddy order (as "a free person in the department" too); they come last.

**Verified**
- 249 unit/integration tests (35 new):
  - the attendance rules with fixed punch data (grace, half day, missed punch-out, overtime, night shifts, leave, comp-off) and the geofence;
  - the rules defaults and overrides; leave days, Buddy order and the three state machines;
  - the API: punches, settling, corrections and their limit, biometric import, balance/overlap/days-off checks, "Block approval", autopilot, cancelling, absence, the cover board, the morning report and permissions.
- **Phase 7 acceptance, end to end:**
  1. Asha applies for leave with two open tasks.
  2. Her Buddy Ravi is asked on Telegram and taps "Yes, I will cover".
  3. The HOD approves from Telegram.
  4. When the leave starts, both tasks show "Covered by Ravi".
  5. After it ends, the task Ravi never touched goes back to Asha, and the one he started stays his.
- 42 browser tests pass (4 new): every HR screen fits at 380 px and 1440 px; leave across three people's browsers (apply → the Buddy says yes → the HOD approves); the rules wizard saves; a phone punch inside the geofence.
- Production stack: the `hr` migrations apply, the HR routes answer through Caddy, the worker's HR sweep runs, and the logs are clean.

## Phase 6 acceptance on DeepSeek (04/11/2026)

- **DeepSeek is a provider choice** (System Master → Integration → AI). The address (`https://api.deepseek.com`) is built in.
  - Models: `deepseek-flash` (default, $0.30 in / $1.20 out per million tokens at peak) and `deepseek-v4-pro` ($1.32 / $3.96).
  - Estimates use peak prices; off-peak is half (weekday peaks are 06:30–09:30 and 11:30–15:30 IST).
- **A DeepSeek model chosen under "OpenAI" without an address is now refused** with a clear message. Before, the key went to OpenAI and failed as "key not accepted"; that is what happened to the first GGM setup.
- **Build with AI prompt version 2** (`build_flow@2`, `edit_flow@2`; version 1 kept on file):
  - every step except automatic ones gets a person (a decision goes to whoever knows the answer, an outside wait to whoever follows up);
  - a branch that "closes the lead" points to the end instead of adding a step to close it.
- **Acceptance met:** the Lead to Order description became a valid 12-step flow (decision, price approval with its reject route, automatic thank-you), with every step assigned. It opened in the builder, in the browser test, in 17 seconds.
  - The other four examples have no broken branches. The only open points are roles that aren't one person ("HOD", "Customer care"); a person picks those in the builder.
  - The five DeepSeek answers are recorded in `evals/fixtures/deepseek-flash/` and checked again by every `npm test`.
- Cost of today's 13 DeepSeek calls (tests, five drafts, two runs, repair rounds): about $0.09. One Lead to Order draft: about 6,600 tokens in, 4,800 out, $0.008.
- The dev database got the rule for the new 08:45 summary event. The GGM owner's first AI-written summary arrives tomorrow at 08:45.

## Phase 6 — AI layer (03/11/2026)

**Connect an AI** (System Master → Integration → AI)
- Pick Anthropic (Claude), OpenAI (or a compatible server), Google Gemini or Ollama (a free model on your own machine).
  - The default model is Claude Opus 5.5. MONO knows the prices of the Claude models; for any other model you can type the price per million tokens.
  - The key is stored encrypted and never shown again; the screen shows only its last 4 characters.
- **Test** makes one tiny call and keeps the result.
- "This month" shows calls, tokens and the estimated cost per feature, plus the latest calls. Every AI call is logged with its feature, prompt version, tokens, time and cost.
- Speech to text: the browser (free, Chrome) or OpenAI Whisper / Gemini (Hindi and English).
- A switch for the daily summary.

**Business details** (System Master → Business details)
- "Your business, in your words": what you make, your customers, how an order moves, who does what… Every AI request includes it.
- A quality meter with the word count ("Very good · 521 words").
- **Refresh with our AI** rewrites it from the current text plus what MONO's data shows (departments, processes, papers…). The new text is shown for review and saved only when you press Save.
- **Update it with ChatGPT**: copy a ready prompt, paste ChatGPT's answer back. Nothing is sent anywhere by MONO for this.
- **Remember this for next time?** After a draft, the AI suggests short facts; the ticked ones are added to the business details.

**Build with AI** (FMS Builder → Build with AI)
- Describe how the work goes, by typing or speaking, in English, Hindi or Hinglish. A counter shows "x/30 words".
- Optionally give a name and a department. Five examples fill the box: Lead to order, Order to dispatch, Purchase request, Customer complaint (Hindi) and New employee joining.
- "Your flow, drafted by AI" shows:
  - the summary ("11 steps · 5 start fields · 14 step fields · Everyone is assigned");
  - names it could not find in MONO;
  - the flowchart, with red marks on steps to fix.
- From there:
  - ask for changes in your own words;
  - **Open in the Builder** creates a draft process (your description becomes its "how it works" text).
- Names are matched to real people: the full name, a unique first name ("Neha"), or a unique designation ("store keeper"). Ambiguous names (two Ravis) are left for you to choose.
- MONO checks every draft. When it finds problems it can name (a step without a time, a branch to a step that doesn't exist, a step nothing leads to, no way to the end), it asks the AI once to fix them and keeps the better version.
- It also corrects common slips by itself:
  - a step that only says "End" is dropped;
  - a task with Yes/No routes becomes a decision;
  - an approval's Yes/No become its approved / rejected routes.

**Edit with AI** (in the process editor)
- Say the change ("add a quality check after packing; Ravi does the invoice"), or use the quick changes: Add approval step · Add photo proof · WhatsApp update · Make it shorter.
- You see what would change (new steps, removed steps, and which part of a step changes: who, time, form, route…). **Apply** or **Try again**.
- Details the AI doesn't handle stay as they were: backups, date-field timing, documents, field help.

**More AI**
- **Suggest with AI** on the Dashboard tab proposes KPI cards. Only fields that exist are used, and only number fields are added up.
- **Masters:** *My masters* lists the company's masters; *Build a master with AI* proposes the fields to check and save; you can also make one by hand. Rows, Excel import and the Master Library come in phase 10.
- **Ask** (Home search): type a question ("who has the most late tasks?"). The answer is a sentence plus the rows behind it, each opening its record.
  - The AI only fills in a plan over six read-only views (tasks, checklists, tickets, process steps, process records, people). MONO checks every name, binds every value, adds the company, and runs it read-only with a 5-second limit.
  - People without AI admin rights see only their own work.
- **Dictate:** every mic button uses the company's speech-to-text when it is set up, else the browser's.
- **Daily summary:** the owner gets a short message at 08:45 (company time): yesterday's work, what is late now (with names), what is due today. Telegram by default, once a day, only when AI is connected.
- **AI follow-up:** a switch on any notification rule lets the AI write a short, polite chase in the person's language for Telegram and email. WhatsApp keeps its approved template, and the template is used whenever the AI has nothing.

**Fixes found while testing**
- A rate limit set on one route also applied to every route around it. This happened on the AI settings routes and the company settings routes, where GST verify's 30 a minute applied to all of them. Each route now has its own hook list, and a test covers it.
- Two labels (Edit, Delete) were missing and showed as raw keys. A new test fails the build when a screen asks for text that doesn't exist.
- A step the AI called "end" took the name MONO uses for "the record closes", which broke the flow. "end" is now reserved.
- Ollama on a CPU: a long answer always failed after exactly 5 minutes with "Could not reach the AI service". Node gives up when no reply starts within 5 minutes, and Ollama sent nothing until it had finished writing. Answers are now streamed, so they can take as long as they need (up to 30 minutes).

**Verified**
- 217 unit/integration tests (28 new) cover:
  - name matching, draft conversion and its slip fixes, the edit diff, Ask plan checks, cost estimates;
  - the AI API with a scripted model: not-connected, key never returned, build → open in builder, the repair round, edit diff, KPI filtering, Ask over the real views, an injection attempt, own rows only, another company's rows never shown;
  - business details, masters, and the 08:45 summary once a day;
  - AI follow-up in the notification engine, Ollama streaming, and the rate-limit regression.
- 37 browser tests:
  - the AI screens fit at 380 px and 1440 px;
  - business details save;
  - a master shows and is deleted;
  - the AI follow-up switch;
  - "Build with AI" review → "Open in the Builder" with the model's answer stubbed.
- Live run on a real model: Ollama with **qwen2.5:7b** on this machine's CPU. No cloud key was available.
  - The whole screen path works: drafting, summary, flags, chart, "remember" suggestions.
  - Evals: 3 of 5 descriptions pass (Order to dispatch, Purchase request, New employee joining).
  - Lead to order gave 9–11 steps with gaps: some steps without a person, and the "need confirmed?" decision missed. The Hindi complaint had a broken "No" branch. Both answers are kept in `apps/api/src/modules/ai/evals/failed/`.
  - **The phase 6 acceptance (Lead to Order → a valid 10–12 step flow) is not yet shown on the default model (Claude Opus 5.5).** It needs an API key: `AI_EVAL_PROVIDER=anthropic AI_EVAL_KEY=… npm test -- flow.eval`.
- Production stack: the `task_handover` and `ai` migrations apply; AI routes answer through Caddy; no errors in the logs.

## Delegation: Pass on and task notes (03/11/2026)

**Pass on: one task, several people, one after another**
- When your part is done and someone else has to finish, press **Pass on** (in the task or on its row). Fill in:
  - what you did;
  - who does the next part;
  - when their part is due;
  - your work, attached (optional).
- The same task (same number) moves to them:
  - They get it on Telegram like a new task, with an Accept button, your note, the original brief and the files you attached.
  - The person who gave the task is told who has it now.
  - The next person can pass it on again, as many times as needed.
- The task shows "Part 2", "Part 3"… and a "Worked on by Sandeep Pal → Ramesh Choudhary → …" line. The history records each hand-over with both due dates.
- Everyone who did a part keeps seeing the task in their list and its notes, but can't change it any more.
- Refused:
  - passing it to yourself;
  - a due time that has already passed;
  - passing it on before accepting it;
  - anyone but the doer passing it on.
- Passing it back to the person who gave it needs no acceptance.
- The new due time is a new part, not a "date moved", so it doesn't turn the task yellow or red.

**Notes on a task, with names**
- The task drawer has **Notes** and **History** tabs.
- Notes shows everything people wrote on the task, each with name, time and a tag:
  - notes and follow-ups;
  - hand-overs ("Passed on to Ramesh Choudhary");
  - done notes ("Done");
  - send-back and reopen reasons.
  A box at the bottom adds a note; Ctrl+Enter sends it.
- Notes can be added while the task runs and after it is done (not once it is cancelled). Each note reaches the doer, the person who gave it, the verifier and everyone who did a part, except the person who wrote it.
- Rows show how many notes a task has.
- Telegram: reply to a task message with text to add a note. A photo reply still attaches proof. `/help` says so.
- The green "done note" box is gone from the drawer: the note is in Notes with the doer's name.

**Notifications**
- New events (with English and Hindi texts):
  - `delegation.passed_on`, to the next person and the person who gave the task;
  - `delegation.note`, to everyone on the task.
  Every deploy now adds rules and templates for new events to every company, not only the main one. Existing rules are never changed.
- Telegram buttons on a message can go to one person only. On a hand-over, only the next person gets Accept / Done; the person who gave the task just reads the news.

**Verified**
- 6 new tests:
  - machine rules for pass on and notes;
  - a three-person chain through the API: refusals, visibility for earlier doers, who hears about notes, the hand-over history, passing back to the creator;
  - a Telegram text reply becoming a note;
  - per-person Telegram buttons.
- New browser test, on phone and desktop:
  1. Sandeep passes a task to Ramesh.
  2. Ramesh sees "Part 2", accepts it, reads Sandeep's note with his name, and adds his own.
  3. Sandeep still sees the task and Ramesh's note, with no Pass on button.

## Phase 5 — FMS: builder, engine, Live FMS, My steps, documents, KPI cards (03/11/2026)

**FMS Builder** (`/fms/builder`)
- The list has All / Published / Drafts tabs and table or card views. Each row shows its steps, departments, status ("Published v2", "Draft · changes not published") and its actions (edit, publish, duplicate, archive).
- The editor has four tabs:
  - Steps: a list with a step editor beside it. Each step has a type (Task, Decision, Approval, Outside, Auto), doers or "whoever started it", a backup, and a planned time. The time counts from the previous step, the start, a date field, or is a fixed time. Steps can also have a checklist, an entry form, required proof and a customer update.
  - Start form: 17 field types, including items (item, qty, rate, amount), dropdowns and from-a-master.
  - Details: coordinator and backup, problem solver and backup, departments, training video and KPI cards.
  - Flowchart: Yes/No branches and dashed rejection lines. A "+" under each step inserts one after it, and a red "!" marks steps that need fixing.
- The header shows "12 steps · 4 people · Start to end 3.2 days · 1 step to fix", plus the Working shifts or Full calendar choice.
- Publish refuses a flow until it is ready: every step needs a doer and a time, decisions need both branches, and no step may be orphaned. The errors are named per step.
- Published versions never change. Running records stay on the version they started with, and editing a published flow makes a draft of the next version.

**Engine**
- Starting a record checks the start form, numbers the record (#1, #2… per flow), gives it a title from the first fields, and opens step 1 for its doer.
- With several doers, the step goes to the one with the fewest open steps. A step done by "whoever started it" falls back to the coordinator for public-form records.
- Completing a step checks its fields, checklist and proof, then records the actual time:
  - Decision steps take the Yes or No branch.
  - Approval steps either approve or go to their reject step.
  - Outside steps wait for the outside party.
  - Auto steps run on their own: create a numbered document, send a customer update, or call a webhook. Webhooks are retried by the worker every minute.
- Planned times use working time: only shift hours count (night shifts included), and holidays and weekly offs are skipped. The other choice is the full calendar.
- Record actions: reassign the open step (the new doer gets it on Telegram), put on hold, resume, and close. Each action writes history with who did it and when.
- Every 5 minutes the worker checks open steps:
  - Due soon (an hour before): the doer is reminded.
  - Late: the doer and the coordinator are told.
  - Stuck (twice the planned time gone): the problem solver is told. A late step is only told once.

**Live FMS** (`/fms/live`) and **My FMS steps** (`/fms/my-steps`)
- Live FMS has a flow picker and tabs: Running · Late · Due today · On hold · Closed · Planned vs actual · Performance.
- A stage strip shows one circle per step with how many records are there and how many are late. The records table shows the record, step n of N, who has it, when it is due and how late it is. "+ New {run name}" opens the start form.
- The record drawer has four tabs:
  - Timeline: each step with doer, planned and actual time, On time / Done late / Delayed / Waiting, the data entered and the proof.
  - Planned vs actual.
  - Documents.
  - History.
  The drawer also has "Do my step", Reassign, Hold / Resume / Close, and a timeline PDF.
- My FMS steps has two parts: "Flows that start with you" (start one in a tap) and your steps, filtered by Running / Waiting on you / Late / Closed.
- Telegram:
  - `/my` lists FMS steps too.
  - Step messages have Done / Yes / No / Approve buttons. A step that needs fields or proof sends you to the web form instead.

**Documents** (`/documents`)
- Auto steps create papers numbered per type and per financial year: `INV/26-27/0001`.
- The list shows the number, type, date, party, which flow and record it came from, the total in ₹, and its status. Documents can be cancelled with a reason, and the number is never reused.
- Every document is a clean A4 PDF with the company, number, party, line items with totals, and the terms. Dates read DD/MM/YYYY and yes/no answers read Yes/No.
- Document types (prefix, header, footer, terms) are set up on the same page.

**KPI cards and the public form**
- KPI cards: pick a field, Count / Total / Average / Min / Max, and a period (Today / This week / This month / This FY). Each card is compared with the period before.
- Share a form link: customers fill a flow's start form at `/f/{token}` with no login. The form is protected by a rate limit, a hidden honeypot field and a signed sum question ("What is 4 + 7?"). It can be switched off at any time, and the record shows up on Live FMS.

**System Master**
- The Processes card counts real flows (live, being built, not started).
- The People card counts load from open FMS steps plus tasks.

**Demo data** (`npm run seed:demo`)
- The 8 flows from §15. Seven are published with 5 records each, some late and one closed in each. Lead to Order Conversion (12 steps) is a draft.
- Also 4 document types (QUO, PI, COA, INV) and 2 KPI cards per flow.

**Fixes found while testing**
- Saving one detail of a flow (say, the training video) reset its run name to "Record" and cleared its departments. Partial saves now change only what was sent, and a test covers it.
- Dates in the record drawer and in document PDFs read DD/MM/YYYY, never the stored 2026-11-03. An e2e check fails if a stored date comes back.
- The flowchart opens readable (at least 80 % zoom, from the top) instead of shrinking a long flow to fit.
- The Documents toolbar no longer overflows a phone screen.

**Verified**
- 183 unit/integration tests. New ones cover flow validation, readiness, branching, working time (shifts, night shifts, holidays), field checks and the engine. The engine tests run a decision, an approval reject, an auto document, reassigning, hold and close, and check that partial saves keep the rest.
- 19 browser tests. The Phase 5 acceptance test does it all in the browser:
  - builds a 6-step flow with a decision in the builder and publishes version 1;
  - starts an order on Live FMS and completes every step;
  - downloads the numbered invoice PDF.
  The others check that every FMS screen fits at 380 px and 1440 px, and that the public form works on a phone.
- Production stack: the `fms` migration applies. Smoke-tested through Caddy (publish → record → step done → auto `INV/26-27/0001` → PDF, timeline PDF, public form) with no errors in the logs.

## Fixes after EA testing (03/11/2026)

- **Weekly schedule:** entries were cut off mid-line in short slots. Hours are taller now, short entries end with "…", and hovering or focusing opens the full text (tooltip too).
- **People lists:** every people list shows name · designation · department ("Ramesh Gurjar · Truck Driver · Dispatch"), and the EA can delegate to the owner too.
- **Help slip vs help ticket:** both raise forms open with a short "which one do I need?" card with an example and a link to the other; the menu descriptions say it in one line.
- **`/capture`:** shows only for the owner and the EA, in `/help`, the hello and Telegram's command menu (each chat gets its own menu, updated when the EA changes). Anyone else typing it is told who can.

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

**Uploads in development**
- The api and the worker each resolved the relative `UPLOAD_DIR` from their own start folder, so web uploads and Telegram photos landed in two different folders. The verifier's message warned that a file "could not be attached", and the web couldn't show Telegram photos. Relative paths are now always from the project root; existing files were merged. Production was not affected (both use `/data/uploads`).
- Proof sent to the verifier is only what the doer (or ticket solver) attached, not the brief the creator attached when giving the task.
- The brief travels too: files attached when giving a task (also on reassign), raising a ticket or raising a help slip go into the doer's / solver's / receiver's Telegram message.

**Verified**
- 161 unit/integration tests (18 new). They cover:
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
