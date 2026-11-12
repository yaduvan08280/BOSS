# Security review — Phase 10 (05/11/2026)

Scope: the API (`apps/api`), the worker, the web app, and the Docker deployment (`deploy/`). Checked against the
OWASP Top 10 (2021), plus file uploads, rate limits and the browser's security headers. Items marked **Fixed** were
changed in Phase 10; **OK** were already in place and re-checked; **Accepted** are known limits with the reason.

## A01 Broken access control — OK
- Every route signs in through `app.authenticate`, which re-reads the user and session from the database on each
  request (a disabled person or a revoked session stops at once). Permissions are checked in the services, not only
  hidden in the screens.
- Company scoping: every business table has `company_id`; the scoped client and the services filter by it, and a test
  fails if a new model is missing from the scope lists (`packages/db/src/scope.ts`). Tests in each module check that
  one company can't read or change another's records.
- **Fixed:** API keys act as the person who made them, with that person's *current* role; a revoked key, or a maker
  who is disabled or deleted, stops the key. Keys, webhooks and the error list need `core.admin`; Google Drive needs
  the owner.

## A02 Cryptographic failures — OK
- Passwords: argon2. Refresh tokens are stored hashed and rotated. JWT access cookies are `HttpOnly; SameSite=Lax;
  Secure` in production.
- Saved secrets (bot tokens, WhatsApp keys, AI keys, Drive tokens, webhook secrets) are AES-256-GCM with a key
  derived from `APP_SECRET`; they are never sent back to the browser.
- **Fixed:** API keys are stored as sha256 only and compared in constant time; shown once. Webhook bodies are signed
  with HMAC-SHA256 over `timestamp.body`.
- **Fixed:** a start-up check warns (log + System Master → Errors) when `APP_SECRET` can't read the saved secrets,
  e.g. after a restore with a new `.env`.
- TLS ends at Cloudflare; the tunnel to `cloudflared` is encrypted. **Fixed:** `Strict-Transport-Security` is sent.

## A03 Injection — OK
- All database access goes through Prisma (parameterised). The only raw SQL is tagged templates (bound values) and
  two fixed `SET` statements in Ask. Ask never runs model-written SQL: it fills a checked plan over six read-only
  views, with a 5 s timeout, in a read-only transaction.
- React escapes everything it renders; there is no `dangerouslySetInnerHTML` and no `eval`.
- **Fixed:** a Content-Security-Policy on the web app (`script-src 'self'`, no inline scripts, `object-src 'none'`,
  `frame-ancestors 'none'`). `style-src` allows inline styles because the theme sets CSS variables on elements.
- PDFs are made by pdfmake with no file or network access.

## A04 Insecure design — OK
- State changes go through the shared state machines; every change writes an audit row and a domain event.
- All imports are all-or-nothing with problems named per line. Deletes are soft.
- The AI only proposes; a person confirms before anything is saved.

## A05 Security misconfiguration — Fixed
- Caddy: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (camera,
  microphone, location only for MONO itself), `Cross-Origin-Opener-Policy`, HSTS, CSP; the `Server` header removed.
- The OpenAPI page in production shows only the public API (`/api/v1`); the app's own routes are hidden.
- Error answers never include stacks; unexpected errors say "Something went wrong on our side" and are logged.
- The api and worker containers run as non-root (`node`, uid 1000); the database is not published outside the Docker network; the web
  port binds to 127.0.0.1 unless `WEB_BIND` is set.

## A06 Vulnerable and outdated components — OK
- Versions are pinned (package-lock), and new packages are pinned to releases at least two weeks old (decision 44).
  Run `npm audit --omit=dev` before each release; the Docker images pin their base versions.

## A07 Identification and authentication failures — OK
- Login: 10 tries per IP per 15 minutes (`LOGIN_RATE_LIMIT`); the same for change-password. Behind Caddy the IP is the
  real client's (`CF-Connecting-IP`, trusted only from private networks).
- First sign-in after an admin reset must choose a new password (enforced by the API).
- Logout and password change revoke sessions.

## A08 Software and data integrity failures — OK
- Every mutating browser request must carry this site's `Origin` (CSRF guard). API-key requests carry no cookies.
- The service worker and app shell come only from this server; webhooks out are signed so receivers can check them.

## A09 Security logging and monitoring failures — Fixed
- Audit log for every change (who, when, before/after, IP, user agent; API-key calls are marked `api-key <prefix>`).
- **Fixed:** error monitoring. Unexpected errors from the API (5xx), the worker (jobs, outbox, webhooks) and browsers
  (`window.onerror`, unhandled promises, crashed screens) are grouped by kind and counted in `error_events`, shown in
  System Master → Errors (owner sees system-wide ones too). A fixed error that happens again reopens.

## A10 Server-side request forgery — Fixed
- **Fixed:** outgoing webhooks, FMS "call a webhook" steps and the WhatsApp provider address go through
  `assertPublicUrl`: https only in production, no user name/password in the URL, and every address the host resolves
  to must be public (private, loopback, link-local, CGNAT, multicast and IPv4-mapped forms are refused). Redirects are
  not followed. `WEBHOOK_ALLOW_PRIVATE=1` lifts this outside production only (tests, local receivers).
- Google Sheet import rebuilds the URL from the sheet id on `docs.google.com` only; Google Drive calls fixed Google
  addresses only.
- **Accepted:** a DNS answer could change between the check and the call (DNS rebinding). The window is milliseconds,
  the setting is admin-only, and redirects are refused.

## File uploads — Fixed
- 10 MB per file, one file per request, a fixed list of types (photos, PDF, Excel/Word/CSV, voice notes, mp4). SVG and
  HTML are refused.
- **Fixed:** the content must match the claimed type (magic bytes: PNG, JPEG, WebP, HEIC, `%PDF-`, ZIP for
  xlsx/docx, OLE for xls, WebM, Ogg, MP3, MP4/M4A; CSV must not contain NUL bytes). A renamed program or web page is
  refused and deleted.
- Files are served with `X-Content-Type-Options: nosniff`; anything not an image, audio or PDF downloads as an
  attachment. Storage keys are generated (no user path) and checked to stay inside the upload folder.

## Rate limits — Fixed
- Per route (decision 62): login, change-password, public form, Google Sheet import, AI, API key creation, webhook
  test, Drive connect, error reports (20/min), the public API (120/min per key).
- **Fixed:** a ceiling for every API call of 600 a minute in production (`API_RATE_LIMIT`), as its own counter
  so it never switches off a route's stricter limit. Live updates and the health check are not counted.
- **Changed 12/11/2026 (Phase 11, row A1):** the ceiling is counted **per signed-in person** (read from the signed
  access cookie, no database call), because a whole office or outlet shares one internet address and a count per
  address locked people out of each other's allowance. Visitors who are not signed in — or who send a cookie that
  does not verify — are still counted per address, and one address is held to 20 people's worth in total as a flood
  guard.
- Bodies are limited to 2 MB (imports 4–8 MB).

## Left for later
- Two-factor sign-in for the owner (Telegram code) — Phase 11 candidate.
- Off-site copy of `.env` is a manual step (INSTALL.md "Keep .env safe").
