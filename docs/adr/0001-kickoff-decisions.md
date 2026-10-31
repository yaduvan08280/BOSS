# ADR 0001: Decisions agreed at kick-off (31/10/2026)

Status: accepted. A short list is in CLAUDE.md §19; this file keeps the reasoning.

| # | Decision | Why |
|---|---|---|
| 1 | Worker imports `@mono/api/services`; one server image runs as api or worker | Avoids duplicating business logic between HTTP and jobs |
| 2 | `packages/db` holds the generated Prisma client, `forCompany()` scoping and counters | Both api and worker need it; scoping in one place is easier to test |
| 3 | Transactional outbox (`domain_events`) + `pg_notify` inside the same transaction | Events can't be lost or sent for rolled-back changes; NOTIFY fires only on commit, so SSE and the worker react instantly |
| 4 | Refresh tokens stored hashed in `sessions`, rotated, reuse = revoke all | Lets us sign out devices, detect stolen tokens, and revoke on password change |
| 5 | Every request re-checks user status and session in the DB | A user who leaves or is disabled is locked out immediately, not after 15 minutes |
| 6 | Login identifiers unique per company, with a company picker | Multi-tenant without forcing a company code on 50 users who only have one company |
| 7 | `SameSite=Lax` cookies + Origin check on mutations | CSRF protection without tokens in forms |
| 8 | Soft delete everywhere; list reads hide `deletedAt` rows automatically | Spec §0.6; fewer chances to forget the filter |
| 9 | Money = BigInt paise (JSON string); quantities Decimal(14,3) | Exact arithmetic; JSON can't carry BigInt |
| 10 | Wall-clock settings as minutes from midnight in the company TZ | Shifts and due times are local concepts; instants stay UTC |
| 11 | SSE heartbeat 25 s, Caddy `flush_interval -1` | Cloudflare closes idle connections at 100 s; Caddy must not buffer the stream |
| 12 | `migrate` one-shot compose service (migrations + idempotent seed) | api/worker never start against an old schema |
| 13 | Theme generated in OKLCH from one seed colour, status colours fixed | Any company colour looks right and stays readable; status meaning never changes |
| 14 | Phone bottom tab bar (addition to §3) | Thumb reach on phones; most staff use phones |
| 15 | Tests never wipe the database (`migrate deploy` only; unique data per test) | Prisma 7 blocks destructive resets from AI agents without consent, and it's safer anyway |
| 16 | E2E runs in the official Playwright Docker image | WSL lacks Chromium's system libraries without sudo |

Phase-0 deviations from CLAUDE.md §1: none in the stack. The tsup bundles include only `@mono/*`; npm packages load from `node_modules` (Prisma's runtime cannot be bundled into ESM).
