# Package J — Browser tests and screenshots for the first wave (rows L1–L17, U1–U6)

The first wave was proven through the API and shared code; its screens were only looked at by their builders.
Your job is to **prove the screens in a real browser**, find what is broken there, fix it, and leave Playwright
specs that keep it proven.

## What exists
- `e2e/*.spec.ts` (Playwright, one test at a time — decision 45; `npm run test:e2e`; read `playwright.config.ts`
  for how the stack is started and which accounts the specs share). Chromium is preinstalled — never run
  `playwright install`; if the project's pinned @playwright/test cannot find the browser, launch with
  `executablePath: '/opt/pw-browsers/chromium'`.
- The first wave's hand-over notes (`docs/phase11/{A-lists,B-links,C-formulas,D-stock,E-records}.md`) say which
  screens exist and what was not looked at (Hindi, dark mode, other roles).

## Do
1. Run the **existing** e2e suite on the merged code first (pass `--trace off`). Anything the merge broke: fix it
   (smallest change), note it.
2. New specs, each test named with the rows it proves (`test('L1 L2: …')`):
   - `e2e/lists.spec.ts` — a text field set to "remember what people type" in a process: the start form offers
     earlier values most-used first, "Write…" adds one that the next record offers; a shared list in two
     processes; Masters → Lists rename / merge / hide; "only admins add" makes it strict (L1–L5).
   - `e2e/links.spec.ts` — a dropdown from another process's values; picking a whole record (label format);
     limited record choices; a picked row renamed → the record still links and shows the new name; unique
     refused then freed by cancelling; auto-fill (locked and unlocked); Outlet → Table dependent choice (L6–L12).
   - `e2e/formulas.spec.ts` — a formula field built in the editor, worked out live in the start form and stored
     by the server; a broken formula blocks Publish with the place marked (L13).
   - `e2e/stock-steps.spec.ts` — item lines picked from the item master with unit / rate / stock; a step that
     issues stock with the preview; short stock blocked, and flagged for approval by setting; sending back and
     cancelling reverse the moves (L14–L17).
   - `e2e/records.spec.ts` — a "Site visit" type made from screens alone (fields, a child table, statuses and
     moves, a link to a customer), numbered records, moves by the right people only, list filters and a saved
     view, import with problems by line and export, the menu entry, a member without the right refused (U1–U6).
   Build the set-up through the API where the screens for it are not what the test proves; drive the behaviour
   under test through the screens.
3. Each spec also runs its main screen at **380 px** (no sideways scroll, touch targets ≥ 44 px on the controls
   it uses) and once in Hindi (no raw keys). Add the e2e guard the repo already has for browser date pickers to
   the new screens if it is route-based.
4. Screenshots at 380 / 1440, light / dark, of every new first-wave screen into `docs/screenshots/phase11/`
   (keep the files small: PNG, viewport-sized, not full-page unless needed).
5. Bugs: fix what you find in the first-wave code with the smallest change and a unit / API test where one fits;
   list each fix (file, what, why) in the hand-over. If a fix is large or touches the design, do not force it —
   write it up exactly instead.

## Ownership
Yours: `e2e/**`, `docs/screenshots/phase11/**`, `playwright.config.ts` if needed. First-wave source files only
for bug fixes. Not yours: `records/**` beyond bug fixes (package H is adding to it — keep fixes there minimal),
`reports/**` (I), Live FMS columns / documents / KPI (G).

In your result, "rows" lists L1–L17 and U1–U6: `proven` = a Playwright test you ran and saw pass drives that
row's behaviour through the screen.
