# Phase 20 — load test and drills: what was run, and the results

Written 13/11/2026. Everything here was run on the development container (one machine, PostgreSQL 16 on the same
machine, **one API process started with `tsx` — not the production Docker build**, no Caddy, no Cloudflare
tunnel). Treat the numbers as "the code is not the bottleneck", not as a promise for the hotel's own server. Both
scripts are in the repository so the same runs can be repeated on the real install.

## 1. Service-peak load test — PASSED here

`deploy/loadtest/service-peak.mjs` (plain Node 22, nothing to install). It makes its own outlet, tables, menu and
people in the company it signs in to, then for three minutes:

- **30 POS devices**, each signed in as a different person at its own table: open an order → send two lines to
  the kitchen → read the order → make the bill → take the payment, with 1.5 s between steps;
- **10 front-desk people** reading the desk, the room calendar and the day's bookings;
- **50 back-office people** reading their home counters, tasks, notifications and checklists.

| Action | Requests | p50 | p95 | Slowest |
|---|---|---|---|---|
| POS: open an order | 720 | 17 ms | 26 ms | 206 ms |
| POS: send to kitchen | 720 | 35 ms | 74 ms | 310 ms |
| POS: read the order | 720 | 9 ms | 14 ms | 53 ms |
| POS: make the bill | 720 | 37 ms | 69 ms | 133 ms |
| POS: take payment | 720 | 55 ms | **120 ms** | 327 ms |
| Front desk reads | 899 | 15 ms | 31 ms | 204 ms |
| Back-office reads | 4,485 | 11 ms | 26 ms | 107 ms |

720 orders and 720 kitchen tickets in 3.1 minutes — about **13,900 tickets an hour against the plan's 400** —
48 requests a second, **0 failed**. Gate: p95 under 300 ms for POS actions → met (worst 120 ms).

Repeat it on the real install (on a test company, never live data):

```bash
BASE=https://mono.example.com LOGIN=<owner mobile> PASSWORD=<password> node deploy/loadtest/service-peak.mjs
```

What this run did **not** cover: the 10× run of the plan (a chain of ten properties on several API copies with a
pooler, one copy killed in the middle) — the compose file still runs one API copy (see A2–A10 in
`docs/plans/coverage.md`); printing to real printers; phones on a slow network through the tunnel.

## 2. Server killed in the middle of service — PASSED here

`deploy/loadtest/kill-drill.mjs`: ten devices take, send, bill and pay takeaway orders without pause. Each
request carries its own key and is **sent again, unchanged, until the server answers** — what the POS screen
does. During the run the API process was killed (`kill -9`) at second 18 and started again 10 seconds later.

| | |
|---|---|
| Orders sent by the devices | 489 |
| Orders on the server afterwards | 489 |
| Order lines on the server | 489 (one each) |
| Bills | 489 |
| Bill numbers used twice | 0 |
| Orders left unpaid | 0 |
| Calls the server did not answer (all retried) | 250 |

Nothing was lost and nothing was billed twice. An order or a line sent twice is made once (its key); a bill asked
for twice answers "already billed" and the bill is read back; a payment sent twice is refused as already paid.

## 3. Drills that could NOT be done here — to be done at the property

These need the real building and are still open. Write the date and the result here when they are done.

| Drill | How | Result |
|---|---|---|
| Internet pulled during a service (the tunnel down, the LAN up) | Unplug the router's WAN for 10 minutes while orders are taken on the LAN address | not done |
| Internet pulled, devices on mobile data only | Same, with the tablets on Wi-Fi that has no route to the server | not done — expected: lines queue on each device and are sent when it returns; **a bill cannot be made without the server** |
| Server power pulled (UPS takes over, then runs out) | Switch the server off at the wall during service; time until the UPS shuts it down; start it again | not done |
| Database restored on a fresh machine | `deploy/restore.sh` on a second machine (the Phase 10 drill was on the dev PC) | not done |
| A real thermal printer and the site agent on a branch PC | One bill and one kitchen ticket through `deploy/site-agent/agent.mjs` | not done |

Before a live bill is taken the plan (§6) also asks for continuous database archiving; it is not set up.
