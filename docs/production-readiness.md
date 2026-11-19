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
| POS: open an order | 3,443 | 31 ms | 129 ms | 254 ms | 477 ms |
| POS: send to kitchen | 3,443 | 63 ms | 208 ms | 333 ms | 627 ms |
| POS: read the order | 3,443 | 15 ms | 68 ms | 127 ms | 248 ms |
| POS: make the bill | 3,443 | 58 ms | 233 ms | 527 ms | 1,908 ms |
| POS: take payment | 3,443 | 90 ms | **290 ms** | 541 ms | 1,349 ms |
| Front desk reads | 4,447 | 22 ms | 85 ms | 150 ms | 803 ms |
| Office reads | 21,998 | 29 ms | 129 ms | 197 ms | 806 ms |

43,660 requests in 15 minutes (48 a second), **0 failed**. Target met — narrowly: the payment's p95 is 290 ms
against 300.

### How it got there (the same test, same data, same machine)

| Run | Result | Cause found | Change |
|---|---|---|---|
| 1 | 7 server errors, 1,209 refusals, payment p95 **14 s** | the worker asked "was this event already told?" by reading two whole tables (no index on the event id) | two indexes |
| 2 | 5 errors, payment p50 4.9 s | each payment read every unpaid bill of the party (the walk-in guest has them all) | a payment reads the bills it names, else the oldest unpaid 50 at a time |
| 3 | 0 errors, POS p95 0.8–2.4 s | the top-bar counter read every task waiting for a check, on every screen — 92 ms of server time a call, ten calls a second | a database count (24 ms) |
| 4 | 0 errors, POS p95 **287 ms** (5 min) | order and kitchen-ticket numbers were locked for the whole of each order's transaction | numbers taken on a side pool |
| 5 | 0 errors, POS p95 529 ms over 15 min | receipts took their number first, then did the stock and the order while everyone else waited for the series | receipts are made last |
| 6 | **0 errors, POS p95 290 ms over 15 min** | — | — |

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
| API killed in service | 10 devices take, send, bill and pay orders without pause, each request sent again unchanged until answered (`deploy/loadtest/kill-drill.mjs`); the API container was killed with `kill -9` at second 15 and second 43, started again each time | 622 orders sent, **622 on the server, 622 bills with 622 different numbers, 622 receipts, none unpaid**; 440 calls went unanswered and were all retried |
| Worker killed while telling people | 600 tasks given at once (600 events); the worker killed with `kill -9` after about a hundred; two workers started together; one of them killed again | every event handled **once**: one notification a person an event, no message queued twice, none left |
| Recovery time of the worker | — | **first run: nothing went out for 15 minutes** (the killed job stayed "running" in the queue); after the fix (heartbeat, one waiting job) work resumed **22 s** after the kill |
| Database wiped | the database's folder deleted; rebuilt from the nightly base copy and the minute-by-minute log (`deploy/restore-pitr.sh`) | back in **17 s**, losing only the last seconds; rolling back to a chosen minute works |
| Whole stack from a backup | an empty stack, last night's dump and uploads (`deploy/restore.sh`) | **25 s**; sign-in, files and saved keys work |

Not drilled here (they need the building): pulling the internet, cutting the power, a real printer, a second
physical machine. Steps in `docs/go-live.md` §8–9.

## 3. The slowest reads on the large data set

`deploy/loadtest/slow-screens.mjs` reads every list and every "one row" address (247 reads) as the owner:
median 14 ms; 95 % under 524 ms (it was 1,759 ms, with three screens that froze the whole server). The table
of what was slow, why, and what is still over 200 ms is in `docs/database.md` §5.
