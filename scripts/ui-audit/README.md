# UI audit

A Playwright crawler that signs in and looks at every screen of MONO at one screen size:

- every route of the router and the side menu (read from `apps/web/src/app/router.tsx` and `layout/nav.ts`; a
  route with a parameter is filled with the first matching link it meets);
- every tab and sub-tab;
- with `--deep`: the first row's drawer and its tabs, every button that opens something, and every dropdown —
  buttons that delete, pay, send, approve, save or sign out are never pressed.

For each state it records: the page or a dialog scrolling sideways; anything outside the screen; a dialog taller
than the screen or with its buttons out of reach; text cut with no "…"; controls on top of each other; on phones,
touch targets under 40 px and text under 12 px; raw translation keys; `undefined`, `NaN`, `Invalid Date`,
`[object`; empty dropdowns and lists that open off-screen; console errors and API answers of 400 and above;
on wide screens, content sitting in a narrow strip. Tables that scroll sideways inside their own card are
listed, not counted as problems.

## Run it

Use a **local copy** of the data — it presses buttons. Never point it at the live server.

```bash
# the app must be running; a built copy is much faster than the dev server:
#   (cd apps/web && npx vite build && PORT=<api port> npx vite preview --port <web port> --strictPort)
AUDIT_MOBILE=9000000000 AUDIT_PASSWORD=… npm run ui:audit -- --base http://localhost:5173 --size 390x844 --label demo-owner
AUDIT_MOBILE=… AUDIT_PASSWORD=… npm run ui:audit:all -- --base http://localhost:5173 --label demo-owner --deep-key
```

Flags: `--size WxH` · `--deep` · `--label name` · `--workers 4` · `--variant dark|hindi|large|collapsed` · `--press-all` (a throw-away copy of the data only: also presses the buttons that change or send something) ·
`--only /hosp` (one part of the app) · `--no-shots` · `--out dir` (default `ui-audit-out/`, not committed).
`AUDIT_CHROMIUM` names a Chrome binary when Playwright's own is not installed.

`ui:audit:all` runs the fourteen sizes from a small phone to a 27" monitor, plus dark, Hindi, larger text and
the folded menu once each; `--deep-key` adds the deep crawl at 390, 1024, 1440 and 2560.

## Output

`ui-audit-out/<label>/<size>/report.md` (problems grouped by kind), `states.jsonl` (every state), `summary.json`
and `shots/` (a screenshot of every state). A run that is stopped carries on where it left off; delete the
folder to start again.
