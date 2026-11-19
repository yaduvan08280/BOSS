# Security review — 19/11/2026

What was looked at, what was found, what was changed, and the test that proves each change.
Severity is how bad it would be on a server that several companies share. "Fixed" means there is a test
that fails without the change. Nothing here was tried on a live server.

**How it was done**

- `apps/api/src/security/access.test.ts` walks **every route the API registers** (753) against the demo
  company as four people who should get nothing: a visitor, the owner of another company, a member whose
  role holds no rights, and a person of another branch. It sends bodies that fit each route's schema with
  the other company's ids in every `…Id` field, and afterwards compares a fingerprint of every row the
  company holds: not one row may differ. Routes that are open on purpose are listed, each with its reason,
  in `apps/api/src/security/open-routes.ts` — adding one there is a decision.
- Every route file, the sign-in code, uploads, exports, outgoing calls, message rendering, the web server's
  headers, the Docker set-up and the dependencies were read.

## Findings

| # | Severity | Where | What | Status | Proof |
|---|---|---|---|---|---|
| 1 | **Critical** | `PUT /api/hr/leave/types/:id` | The update named the row by id only: an HR admin of one company could overwrite another company's leave type. | Fixed | access test ("rows of leave_types changed" without the fix) |
| 2 | **High** | the database client | The bug in #1 is a class: a service that forgets the company on one `update` / `delete` / look-up by id. The walk cannot reach every such line with a valid body. | Fixed for the whole class — **the company wall** (decision 250): inside a signed-in request the database client itself adds the caller's company to every read and write of the 182 models that belong to a company, and refuses a row made in another company's name. | `security/wall.test.ts`, `packages/db/src/wall.test.ts` |
| 3 | High | Telegram messages | Messages are sent as HTML but people's text in them was not escaped: a `<` in a task made the message fail to send; a typed link tag became a real link in the bot's message. | Fixed | `apps/worker/src/notify/notify.test.ts` |
| 4 | Medium | `GET /api/money/parties`, `/tax-rates`, `/modes` | Readable by every signed-in person (customers and vendors with tax numbers and credit days). | Fixed: only people who work with money, hospitality, stock or sales. | access test |
| 5 | Medium | outgoing calls to typed addresses (webhooks, process webhook steps, WhatsApp provider, channel manager / gateway / e-invoice, AI and speech servers) | (a) `[::ffff:7f00:1]` (127.0.0.1 written as IPv6 in hex) passed the private-address check; (b) the address was checked once and resolved again when connecting, so a name could answer "public" then "private"; (c) AI and speech addresses were not checked at all. | Fixed: one `guardedFetch` checks the address the connection really goes to, never follows a redirect, reads at most 5 MB. Local AI servers need `AI_ALLOW_PRIVATE=1` in `.env`. | `platform/safe-url.guard.test.ts` |
| 6 | Medium | sign-in | Wrong passwords were limited per address only: one account could be guessed at from many addresses. | Fixed: 10 wrong passwords in 15 minutes lock that login ID for 15 minutes (`login_throttles`). | `auth/auth.test.ts` |
| 7 | Medium | CSV exports (Form C, excise register, GSTR-1, pay sheet, task export) | A cell starting with `=`, `+`, `-`, `@` was written as it is: a name typed on the public booking page could run as a formula on the computer of whoever opens the export. | Fixed: one `csvCell` in the shared package, used by every export. | `packages/shared/src/format/format.test.ts` |
| 8 | Low | `POST /api/documents/:id/cancel` | Answered 200 `{ ok: false }` for a paper that is not there, and changed the status with no audit row. | Fixed: 404, and an audit row. | access test |
| 9 | Low | `/api/agent/*` | The request was validated before the agent's key was checked: a caller with no key learned what the body should look like. | Fixed: the key is checked first. | access test (visitor walk) |
| 10 | Low | `PUT /api/owner/ranges`, `PUT /api/owner/delay`, `POST /api/owner/copy-checklists` | Accepted the id of a branch or process that is not the company's (kept as a dead entry in the company's own settings; nothing of the other company was read). | Fixed: 404. | access test |
| 11 | Low | changes with a session cookie and no `Origin` | Allowed (only an unknown `Origin` was refused). Browsers always send `Origin` on a change, so this was not exploitable from a browser. | Tightened: a cookie with no `Origin` is refused. | `auth/auth.test.ts` |
| 12 | Low | files | A file answered with no content policy of its own. | Added `Content-Security-Policy: default-src 'none'; sandbox` on every file that is not a PDF. | read |
| 13 | Low | API answers | No `Cache-Control` on JSON. | `no-store` on every API answer that sets none. | `health.test.ts` |
| 14 | Medium | server logs | The log line of each request kept its whole address: a guest's booking link, a webhook's token and the code Google sends back after a sign-in are secrets in themselves. In production, the database client's validation errors could quote the values sent (a person's details) into the log and into System Master → Errors. | The request is logged as method, address and caller's IP only — no headers, no body — and a secret part of an address is cut to four characters; the database client's errors carry no values in production. | `lib/log-safe.test.ts`; real log lines read after calling a booking link, the Google callback and a wrong password: none of the secrets appear |
| 15 | Low | two requests making the same thing at once | A unique-value clash in the database was answered 500 "Something went wrong" and counted as a server error. | Answered 409 with words the person can act on. | `security/concurrency.test.ts` |

## Looked at and found sound

- **Sign-in**: argon2id; the same time is spent when the login ID does not exist; cookies are `HttpOnly`,
  `SameSite=Lax`, `Secure` in production, the refresh cookie only on `/api/auth`; refresh tokens are stored
  hashed, rotated on every use, and re-using a rotated one signs every device out; a disabled person or a
  revoked session stops on the next request; password change signs other devices out; an admin reset gives
  a one-time password that must be changed.
- **Rights**: 552 routes refuse a member with no rights with 403; 34 answers are open on purpose
  (`open-routes.ts`).
- **Other company**: no list and no row by id of company A is shown to company B on any route.
- **Other branch**: a person of one branch with every "view" right sees none of 600 rows put at another
  branch, also when the branch switcher is sent that branch.
- **Hand-written SQL**: all of it is parameterised (`Prisma.sql`). The two builders that put names into SQL
  (Ask, reports) take names only from a fixed catalog and are tested with hostile names.
- **Formulas**: parsed and run by MONO's own small interpreter, never `eval`.
- **Uploads**: type by content (not by name), 10 MB, stored under the company's folder with a generated
  name, served with `nosniff`; HTML and SVG are refused; non-images download instead of opening.
- **Browser**: no `dangerouslySetInnerHTML`, `innerHTML` or `eval` anywhere in the web app; email text is
  escaped; the app is served with a strict content policy (`script-src 'self'`), `X-Frame-Options: DENY`,
  HSTS, `nosniff`, a referrer and a permissions policy.
- **Secrets**: provider keys, tokens and passwords are encrypted with `APP_SECRET` and never sent back to
  the browser or written to the audit log; cookies and authorization headers are removed from logs.
- **Webhooks in**: the payment gateway's signature is checked over the raw bytes in constant time; a link
  is paid once, so a replayed call changes nothing; bodies are limited to 1 MB and 300 calls a minute.
- **Webhooks out**: signed with a timestamp (`X-Mono-Signature`), 10 s, no redirects.
- **Docker**: the API and worker run as a non-root user; the database publishes no port; the web server
  listens on 127.0.0.1 unless told otherwise; the tunnel image is pinned.
- **Dependencies**: `npm audit` — no high or critical finding. 3 moderate in production (glob / minimatch
  under `@fastify/static`, which serves the API docs' own files with fixed patterns — no pattern comes from
  a request). Their fixed releases are days old; by the project's rule (releases at least two weeks old)
  they are taken after 30/11/2026. Licences of the 659 production packages: MIT, ISC, BSD, Apache-2.0 and
  the like; fonts under OFL-1.1; one EPL-2.0 (elkjs) and one MPL-2.0 used unchanged. Nothing GPL or AGPL.

## Known limits (not fixed, and why)

| What | Why it is left |
|---|---|
| A file's address (`/api/files/<id>`) opens for any signed-in person of the same company who has the id (record files follow their record type's rights). | Ids are 24 random characters and are only shown to people who can see the thing the file belongs to. Checking each file against its parent would need a rule for every kind of parent. |
| The channel manager's webhook is protected by the token in its address only (no signature). | The contract is MONO's own (decision 201); every real channel manager signs in its own way — the signature belongs to that mapping. A booking is made once per channel reference, so a replay changes nothing. |
| 26 routes answered a member with no rights with "incomplete" (400) before the rights check could be seen, because the body the test could build from the schema did not satisfy a rule inside it. | They are behind sign-in and the company wall; their rights are checked in the service, after validation. Listed by the test's output. |
| `postgres:16-alpine` and `node:22-bookworm-slim` are pinned to a major version, not to a digest. | A digest pinned here, without the registry, would be a guess; the runbook shows how to pin to the digests in use on the server. |
| No second factor at sign-in. | Not in the specification. The Telegram link could carry one later. |
