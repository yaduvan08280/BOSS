# Phase 11 work packages — common rules (read with your package's brief)

You build one work package of Phase 11 of MONO in **your own checkout** (a git worktree; its path is in your
prompt). Other agents build sibling packages in other checkouts; all branches are merged afterwards, so file
ownership matters. Never edit anything under `/home/user/BOSS` outside your own checkout.

## Read first
1. `docs/phase11/README.md` (in `/home/user/BOSS/docs/phase11/`) — the fixed contracts, who owns which files.
2. `/home/user/BOSS/docs/plans/hospitality-100-plan.md` §2 (your sections) and `/home/user/BOSS/docs/plans/coverage.md` (your rows).
3. Your package brief in this folder.
CLAUDE.md §17 (definition of done) and its decisions log bind you.

## Your checkout
- It may already hold **uncommitted work from an earlier run of this same package** that was cut off. Look at
  `git status` / `git diff` first, judge it against the brief, keep what is right and continue from it.
- **Commit early and often** on the checkout's branch (a commit after every meaningful step, even if the package
  is not finished): the machine can restart, and only committed work is safe. Never push, never open a PR.
  End every commit message with:
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01DnQDLpfmLNstUuJf5heFAY`
- `node_modules` should be there (`npm ci` if not). Postgres 16 runs on localhost:5432 (role `mono`, password
  `mono`). If it is down: `service postgresql start`. Your databases are `mono_<x>` and `mono_<x>_test`, where
  `<x>` is your package letter in lower case (create them if missing:
  `PGPASSWORD=mono psql -h localhost -U mono -d postgres -c 'CREATE DATABASE mono_<x>'`). Your `.env` (copy of
  `.env.example`) must point `DATABASE_URL` and `TEST_DATABASE_URL` at them.
- To look at screens: `npx prisma migrate deploy && npm run seed:demo` on your dev DB, then
  `PORT=31<n> npm run dev -w @mono/api` and `WEB_PORT=52<n> PORT=31<n> npm run dev -w @mono/web`
  (A=01, B=02, C=03, D=04, E=05). Demo logins are in `prisma/seed-demo.ts`. Chromium + Playwright are
  preinstalled (`require('playwright')`; do not install). Stop the servers you started when you are done.
- The machine has 4 CPUs and 15 GB: run one heavy command at a time (not typecheck, tests and build together).

## Done means
`npm run lint`, `npm run typecheck`, `npm test` (whole suite, your test DB) and `npm run build` pass in your
checkout. No file over 400 lines. `npx prettier --write` on what you touched. Every coverage row of your package
has at least one passing automated test with the row id in its name (`it('L2: …')`).

## Hand-over
- `docs/phase11/<LETTER>-<name>.md` in your checkout: what was built, decisions taken, anything left open.
- Do not edit `CLAUDE.md`, `docs/CHANGELOG.md`, `apps/web/src/locales/en.json` / `hi.json`, or files owned by
  another package. Shared files you must add a line to: add that line, change nothing else, and list them.
- Report honestly. Do not say something works unless you ran it. Say plainly what is unfinished or unverified.
