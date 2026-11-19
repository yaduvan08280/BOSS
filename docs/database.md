# The database: rules, limits and what was measured (19/11/2026)

MONO keeps everything in one PostgreSQL 16 database. This note says how it is kept healthy, what was
measured with a large data set, and the rules for changing it. Nothing here was run on a live server.

## 1. Rules for migrations

Migrations are hand-written SQL in `prisma/migrations/<time>_<name>/migration.sql`, applied by
`prisma migrate deploy` (the `migrate` container does it before the API and worker start).

1. **The schema files and the migrations must agree.** `packages/db/src/schema-drift.test.ts` migrates an
   empty database and fails if the schema files say anything the migrations did not do.
2. **A migration must not hold a long lock on a big table.** Start it with `SET lock_timeout = '5s';` — if
   it cannot get its lock quickly it gives up and can be run again, instead of making everyone wait.
3. **Adding a column**: nullable, or with a constant default (PostgreSQL does not rewrite the table).
   Never `ALTER COLUMN … TYPE` on a big table in one step: add a new column, fill it in batches from the
   worker, switch the code, drop the old column in a later release.
4. **Adding an index** on a table under about a million rows: plain `CREATE INDEX` (measured: seven
   indexes on tables of 500,000–650,000 rows took 4 seconds together). Above that: one
   `CREATE INDEX CONCURRENTLY` per migration file (a file with a single statement is not run inside a
   transaction), and no other statement in that file.
5. **Never drop or rename** a column or table in the release that stops using it: the old API may still be
   running while the migration is applied. Drop it one release later.
6. **A model with a required `companyId`** joins the company wall by itself: run
   `node scripts/gen-company-models.mjs` after adding one (a test fails until you do).
7. **A model with a `branchId`** must be listed in `packages/db/src/reach.ts` as scoped or as free with
   the reason (a test checks).
8. **Partial indexes are not used**: Prisma does not describe them, so the drift test could not protect
   them.

## 2. Connections and time limits

| | API | Worker |
|---|---|---|
| Connections (pool) | 15 (`DB_POOL_MAX`) | 8 |
| One statement may run | 30 s (`DB_STATEMENT_TIMEOUT_MS`) | 2 min |
| Waiting for a lock | 10 s | 10 s |
| A transaction left open and idle | closed after 60 s | 60 s |
| A transaction (Prisma) | waits 10 s for a connection, runs 20 s (long imports set their own) | same |
| Waiting for a free connection | 10 s, then an error | same |

Set in `packages/db/src/client.ts`; the limits are enforced by the database on every connection, so one
stuck request cannot hold a lock or a connection until somebody restarts the server. Each process names
itself (`mono-api`, `mono-worker`) in `pg_stat_activity`.

**No pooler (PgBouncer) is needed** for one machine: API 15 + worker 8 + its queue (pg-boss) about 10 + the
live-events listener 2 + backups 2 is under 40 of the database's 100 connections. Add a pooler when there
are several API copies or `max_connections` is reached — not before: it adds a moving part, and
transaction-mode pooling breaks `LISTEN` and session settings.

Start-up: the API waits up to a minute for the database (a power cut restarts both). Shutdown: requests
and jobs in hand are finished (25 s / 20 s), live streams are ended, then the pool closes; the containers
get 35 s (`stop_grace_period`). A dropped connection is replaced by the pool; the live-events listener
reconnects by itself, also after a clean database restart.

## 3. The database's own settings (deploy/docker-compose.yml → db)

`shared_buffers` 1 GB and `effective_cache_size` 3 GB by default — on the 48 GB machine set
`PG_SHARED_BUFFERS=8GB` and `PG_CACHE=24GB` in `.env`. `work_mem` 16 MB, `max_connections` 100,
`random_page_cost` 1.1 (SSD). Statements slower than 0.5 s and lock waits are logged
(`./deploy/compose.sh logs db`). Autovacuum starts at 5 % changed rows (analyze at 2 %) instead of 20 % / 10 %,
so the busy tables stay small and well measured.

## 4. What only ever grows, and what is done about it

The worker runs a clean-up every night at 04:10 IST (`apps/api/src/modules/system/retention.ts`), in
batches of 5,000 rows, safe to stop and run again:

| Table | Removed when | Kept |
|---|---|---|
| `outbox` (messages) | sent, delivered, read, skipped or failed | 90 days |
| `notifications` | read | 180 days (unread: 1 year) |
| `domain_events` | delivered to every listener | 180 days |
| `sync_logs` | finished (OK or failed) | 90 days |
| `print_jobs` | printed or failed | 30 days |
| `webhook_deliveries` | sent or failed | 90 days |
| `error_events` | not seen again | 180 days |
| `sessions` | signed out or run out | 30 days |
| `login_throttles` | window and lock over | at once |
| `audit_logs` | **never deleted**: rows older than 3 years move to files | `uploads/_archive/audit/<company>/<YYYY-MM>.jsonl.gz` (in every backup) |

Not waiting (queued messages, undelivered events) is never removed. Work, money, stock, people and their
history are never touched. To read an archived month: `zcat 2023-11.jsonl.gz | less` — one JSON row a line.

## 5. Measured with a large data set

`deploy/loadtest/grow.mjs` copies one company of a scratch database until it holds about two years of a
busy company (10 million rows, 4.7 GB): 500,000 tasks with 1.65 million events, 1.4 million checklist
items, 650,000 bills, 500,000 stock moves, 320,000 POS orders with 500,000 lines, 216,000 sales orders,
520,000 notifications, 520,000 audit rows, 296 people. `deploy/loadtest/slow-screens.mjs` then reads every
list and every "one row" address (247 reads) as the owner.

| | Before | After |
|---|---|---|
| Median read | 14 ms | 14 ms |
| 95 % of reads under | 1,759 ms | 524 ms |
| Reads that froze the whole server | CRM dashboard, Customer Master (22 s each), receivables | none |
| Largest answer | 50 MB (My FMS) | 1.7 MB (a month's muster for 296 people) |

What was wrong and what was changed:

| Screen | Before | After | Cause → change |
|---|---|---|---|
| CRM dashboard / customers / SCOT / collections | 22 s, server frozen | 1.7–1.9 s, server free | every order was copied into a growing list per customer (quadratic) and all years of orders were read on every request → the database adds up counts, what is unpaid and how late each customer pays; only 12 months come into memory |
| Monthly muster (296 people) | 7.4 s | 0.3–0.5 s | each person's settings and recent days were asked for one at a time, and every time-zone conversion built a new formatter → bulk loads; one cached formatter per time zone (this speeds every date in the app) |
| Team attendance | 2.8 s | 0.5 s | same |
| Cover board | 1.3 s | 0.25 s | same |
| My FMS | 3.6 s, 50 MB | 0.13 s | every open step was sent → the 300 most urgent, the rest counted |
| Tally ledger map | 2.0 s | 0.16 s | every voucher was read to find a dozen names → the database finds them |
| GSTR-1 (28,000 bills in the month) | froze the server | 0.8 s | the whole month in memory → read a page at a time |
| Process list | 0.8 s | 0.11 s | every late step was read to be counted → counted by the database |
| Bills list | 211 ms | 25 ms | index |
| Money owed / cash flow | 263 ms | 43–130 ms | index |
| Task list / notifications | 136 / 72 ms | 47 / 23 ms | index |

**Still over 200 ms on this data set, and why it was left:**

- The CRM pages (1.7–3.3 s) at 216,000 sales orders and 200,000 payments — about eighteen years of GGM's
  order volume. The sums run in the database now, so the server stays responsive; at 20,000 orders they
  take about 0.15 s. Going further needs running totals kept on each customer as orders and payments are
  written — not done.
- Reports over a whole month or year (hospitality sales 1.2 s for 13,000 orders, stock turns 1.1 s for a
  year of issues, void / discount audit 0.7 s, the owner's letter and what-if 0.3–0.4 s): they read the
  period's rows once; nobody waits on them between taps.
- HR for 296 people (muster 0.3–0.5 s, team day 0.5 s): six times the target company's head-count.
- The leave preview answers 20 MB **only** for the test owner, who "has" 100,000 open tasks because every
  copied task kept its open status. A real person's open work is tens of rows.

The worker on the same data: it paged through half a million overdue rows, raised 72,000 events in four
minutes and handled about 80 a second; no statement took more than 0.4 s.

Seven indexes were added (`20261124110000_big_data_indexes`); the rest of the busy tables already had the
ones their lists use.

## 6. Things done at the same moment

`apps/api/src/security/concurrency.test.ts`: 40 tasks given at once get 40 consecutive numbers; 30 invoices
issued at once get 30 consecutive numbers; 20 people taking 1 from a stock of 12 — exactly 12 succeed and
the stock ends at 0; one bill paid in full by ten cashiers at once is settled once and the rest stays as
money on account. Two bookings of one table, and two confirmations of one hall, were already tested
(`res-book.test.ts`, `banquet.test.ts`).

## 7. Backups

| What | How often | Lost at worst | Kept |
|---|---|---|---|
| Write-ahead log pieces (`backups/wal/`) | every minute | **about a minute** | as long as the base copies need |
| Base copy of the database's files (`backups/base/`) | nightly, after the dump | — | 2 |
| Database dump (`mono-db-<stamp>.dump`) | nightly 02:30 | a day (alone) | 14 days |
| Database snapshot (`…-q.dump`) | every 15 minutes | 15 minutes (alone) | 48 hours |
| Uploaded files (`mono-uploads-<stamp>.tar.gz`) | nightly; new files copied off the machine every 15 minutes | — | 14 days |

Every dump and archive is read back after it is written; one that cannot be read is deleted and reported
(health check → `backup`). Every Sunday 03:30 the newest dump is restored into a scratch database, counted
and dropped (`restoreTest`). With rclone set up, everything also goes off the machine — the log pieces
every two minutes.

Restoring: `deploy/restore.sh <stamp>` (a dump: the whole installation as it was that night or that quarter
of an hour) or `deploy/restore-pitr.sh <base> ["YYYY-MM-DD HH:MM"]` (the database as it was at any minute).
Both were drilled in Docker — see `docs/production-readiness.md`.

**When a disk fills**: the health check warns at 80 % and alerts at 90 %. If the log archive cannot be
written (its folder is full or not writable), PostgreSQL keeps the pieces itself and its own disk fills —
that is why `logArchive` is a check of its own. Free space first (old `pg.before-*` folders after a restore,
old dumps), never by deleting files in `pg/`.
