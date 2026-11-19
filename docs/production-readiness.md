# Production readiness — what was run, and the numbers (19/11/2026)

Read this with `docs/security-review.md` (access and security), `docs/database.md` (the database) and
`docs/go-live.md` (what only you can do). **Nothing here was run on the live server.**

## Where it was run — read this first

Everything below ran in the development sandbox: **4 CPU cores, 16 GB memory**, PostgreSQL 16 on the same
machine, and the load generator on the same machine too. The API, worker and web server ran as the
**production Docker images** (read-only, no extra privileges, behind Caddy) — built from test copies of the
Dockerfiles, because this sandbox cannot reach the Alpine / Debian package mirrors: the test server image leaves
out one system package (`openssl`), and the test backup image starts from the Postgres image instead of
installing the Postgres client, `rclone` and `tzdata` (so sending backups off the machine was not run here).
The application code and its start-up are the same.

GGM's server has 12 cores (20 threads) and 48 GB, so it has more room than this — but the numbers are a
measurement of this sandbox, not a promise for that machine. `docs/go-live.md` §9 says how to repeat the load
test there on a test company.

The data: one company grown to about two years of a busy business — **10 million rows, 5 GB**
(`deploy/loadtest/grow.mjs`; counts in `docs/database.md` §5).

## 1. Load: 30 POS devices, 10 front desk, 50 office, for 15 minutes

`deploy/loadtest/service-peak.mjs`. Every POS device opens an order, sends two lines to the kitchen, reads
the order, makes the bill and takes the payment, 1.5 s between steps (about 13,600 kitchen tickets an hour —
some thirty times a busy restaurant). Front-desk people read the desk, the room calendar and the bookings;
office people their counters, tasks, notifications and checklists. Target: zero failures and 95 % of POS
actions under 300 ms.

| Action | Requests | p50 | p95 | p99 | Slowest |
|---|---|---|---|---|---|
| POS: open an order | 3,488 | 25 ms | 77 ms | 122 ms | 251 ms |
| POS: send to kitchen | 3,488 | 56 ms | 146 ms | 214 ms | 306 ms |
| POS: read the order | 3,488 | 11 ms | 38 ms | 64 ms | 130 ms |
| POS: make the bill | 3,488 | 44 ms | 118 ms | 192 ms | 506 ms |
| POS: take payment | 3,488 | 72 ms | **193 ms** | 276 ms | 428 ms |
| Front desk reads | 4,451 | 17 ms | 55 ms | 88 ms | 193 ms |
| Office reads | 22,125 | 23 ms | 96 ms | 138 ms | 316 ms |

44,016 requests in 15 minutes (49 a second), **0 failed**, with the worker running its sweeps on the same
large company throughout. Target met with room: the slowest action's p95 is 193 ms against 300. It is still a
measurement of this 4-core sandbox with the load generator on the same machine.

### How it got there (the same test, same data, same machine)

| Run | Result | Cause found | Change |
|---|---|---|---|
| 1 | 7 server errors, 1,209 refusals, payment p95 **14 s** | the worker asked "was this event already told?" by reading two whole tables (no index on the event id) | two indexes |
| 2 | 5 errors, payment p50 4.9 s | each payment read every unpaid bill of the party (the walk-in guest has them all) | a payment reads the bills it names, else the oldest unpaid 50 at a time |
| 3 | 0 errors, POS p95 0.8–2.4 s | the top-bar counter read every task waiting for a check, on every screen — 92 ms of server time a call, ten calls a second | a database count (24 ms) |
| 4 | 0 errors, POS p95 **287 ms** (5 min) | order and kitchen-ticket numbers were locked for the whole of each order's transaction | numbers taken on a side pool |
| 5 | 0 errors, POS p95 529 ms over 15 min | receipts took their number first, then did the stock and the order while everyone else waited for the series | receipts are made last |
| 6 | 0 errors, POS p95 290 ms over 15 min | — | — |
| 7 | the same test repeated later: 0 errors, payment p95 **361 ms** (15 min), 454 ms (5 min) — a miss | three of the worker's five-minute sweeps read every waiting task, every late task and every open process step on each pass and asked about each in turn: 51 s of CPU a pass on this company, taken from the same four cores | the sweeps ask the database only for rows still owed a message (under 0.1 s a pass) |
| 8 | 0 errors, payment p95 430 ms (5 min) | payments queued for the receipt number: about twelve statements followed it inside each transaction | a paper takes its number last — five statements follow it |
| 9 | 0 errors, payment p95 268–326 ms over five 15-minute runs — at the limit, passing or failing by chance | every action's p95 was about 3.3 times its median: requests were queueing behind each other in the one API process, whatever the payment itself did | (the next four rows) |
| 10 | — | ten cashiers paying one bill each settled it in full, once the number no longer came first (caught by the concurrency test) | money is set against a bill by one transaction at a time (the bill's row is held) |
| 11 | a run that crossed midnight IST: every action twice as slow | all 97,000 late tasks were told "still overdue" in one pass — 58,000 events at once for the worker | the daily round is spread: 2,000 a pass |
| 12 | 0 errors, payment p95 295–300 ms | the number still had eight round trips after it; each signed-in request asked three queries to check the person; a receipt read its company five times | the number is one statement and the last; one sign-in query; repeated reads removed (a payment: 58 statements → 50) |
| 13 | **0 errors, payment p95 193 ms, bill 118 ms, kitchen 146 ms over 15 min** | the office task list sent 500 full tasks (427 KB) on every call — a fifth of the API process | a hundred at a time (86 KB) |

Also found on the way and fixed: an open task vanishing from the delegation sheet behind 1,000 old ones;
task events, process-record events and failed messages looked up with no index (3–9 s each on this data); the
day's bill list read one bill at a time (it is polled by every POS screen).

### Three times the load: what gives first

90 POS devices, 30 front desk, 150 office for five minutes: **0 failed, 0 server errors, nothing lost** — but
everything queues: 65 requests a second is the ceiling here and people wait 2–4 s (POS p95 6.2 s).
**What gives first is the API's single process** (one CPU core at 100 %; the database was at about 30 % of
one core and had connections to spare). The way past that is a second API copy behind Caddy (architecture
rows A2–A10 of `docs/plans/coverage.md` — not built). For one property at thirty devices it is not needed.

## 2. Kill drills

| Drill | What was done | Result |
|---|---|---|
| API killed in service | 10 devices take, send, bill and pay orders without pause, each request sent again unchanged until answered (`deploy/loadtest/kill-drill.mjs`); the API container was killed with `kill -9` at second 15 and second 43, started again each time | 855 orders sent, **855 on the server, 855 bills with 855 different numbers, none unpaid**; 140 calls went unanswered and were all retried |
| Worker killed while telling people | 600 tasks given at once (600 events); the worker killed with `kill -9` while they were coming in; two workers started together; one of them killed again | every event handled **once**: one notification a person an event, no message queued twice, none left |
| Recovery time of the worker | — | **first run: nothing went out for 15 minutes** (the killed job stayed "running" in the queue); after the fix (heartbeat, one waiting job) everything was caught up **10 s** after the kill |
| Database wiped | the database's folder deleted; rebuilt from the nightly base copy and the minute-by-minute log (`deploy/restore-pitr.sh`) | back in **17 s**, losing only the last seconds; rolling back to a chosen minute works |
| Whole stack from a backup | the test stack backed up (`backup.sh`), its database folder and uploads deleted, then `deploy/restore.sh` on the empty folders | **22 s**; sign-in, a record made before the backup, an uploaded file and the saved keys are back |

Not drilled here (they need the building): pulling the internet, cutting the power, a real printer, a second
physical machine. Steps in `docs/go-live.md` §8–9.

## 3. The slowest reads on the large data set

`deploy/loadtest/slow-screens.mjs` reads every list and every "one row" address (247 reads) as the owner:
median 14 ms; 95 % under 524 ms (it was 1,759 ms, with three screens that froze the whole server). The table
of what was slow, why, and what is still over 200 ms is in `docs/database.md` §5.

## 4. The front end: weight, a slow phone, staying usable

| | Before | After |
|---|---|---|
| Scripts and styles before the first screen (English, compressed) | 520 KB | about 375 KB (296 KB + the language, 79 KB) |
| Languages loaded at start | both | the one on screen |
| Delegation sheet with 500 tasks: elements drawn at once | 27,500 | about 5,500 (100 tasks, then "Show 100 more") |
| The page jumping down a second after it loads (people with several branches) | every load | gone after the first visit on a device |

Lighthouse, phone profile (slow 4G, CPU four times slower), a **first visit with nothing cached**, signed in,
against the production web image — on this busy sandbox the figures move by a few points from run to run:

| Screen | Performance | Accessibility | First paint | Largest paint |
|---|---|---|---|---|
| Home | 35–43 | 100 | 3.3 s | 5.9 s |
| Delegation sheet | 45 | 100 | 3.3 s | 6.0 s |
| Checklists | 50–55 | 100 | 3.2 s | 5.8 s |
| POS | 52 | 100 | 3.2 s | 6.1 s |
| Attendance | 51–57 | 100 | 3.3 s | 5.9 s |
| Live FMS | 45–48 | 100 | 3.3 s | 6.2 s |

First paint was about 5 s before. This is the worst case — a first visit on a slow line. The installed app
keeps its files on the phone (service worker), so later visits do not download them again. What is left:
the main script is 150 KB compressed and about half of it is not used by the first screen; splitting it
further is not done.

Also in place: a screen that fails shows "This screen hit a problem — Try again" inside the menu (not a blank
page), and a bar says when the device is offline (both in `e2e/resilience.spec.ts`); an open tab that meets an
update's missing files says "A new version is ready — Reload" (in the code, not tried against a real update).

## 5. Accessibility

`e2e/a11y.spec.ts` runs axe (WCAG 2 A and AA) on every screen of the left menu (75 addresses, read from the
menu itself) and the sign-in page, at 380 and 1440 px. First run: 7 problems — 4 sideways-scrolling boxes a
keyboard could not reach (fixed for all 26 such boxes), 3 texts too faint (org chart, the flowchart's credit
link, a label on the dark card). Now: **no serious or critical problem**. Not checked: dark mode, Hindi,
dialogs and drawers (the size audit opens those; axe does not yet), a screen reader used by a person.

## 6. Browser specs

Every Playwright spec runs at 380 and 1440 px against a fresh demo database with the API, the worker and a
mail catcher running. Five specs were added for screens that had been proved through the API only (money,
stock, hospitality set-up, POS with two people, production and exchange rates). Things the full run found:

| Found | What it was | Fix |
|---|---|---|
| A process step said "Now 11,250 → 11,248" and then refused with "Only 0 in stock" | the preview counted the company's total; the step takes from the main store | the preview counts what the main store can give (`step-stock-place.test.ts`) |
| The channel-manager webhook was refused in the spec | the spec sent it with the signed-in browser's cookie, which now must say where it comes from | the spec sends it as an outside service does |
| Two locators matched more than they meant | the demo data gained an approval ladder and items kept at a bar | the specs name their own card and make their own item |
