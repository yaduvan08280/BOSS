# Phase 11 · Package D — Stock on steps (rows L14–L17)

Plan §2.4. Branch `worktree-agent-ae87832677a65b374`. Everything below was run on 12/11/2026 in this checkout
(`mono_d` / `mono_d_test`): lint, typecheck, the whole test suite (53 files, 365 passed, 5 skipped) and the build.

## What was built

### L14 — item lines pick from the item master
- `apps/web/src/modules/fms/form/ItemLines.tsx` + `form/ItemPicker.tsx`: every line searches the item master by
  code or name (the `items` choice source), picks an item; unit and rate fill in (the rate stays editable; a rate
  already typed is kept), live stock shows under the line, and the line keeps `itemId` and `unit`. On a phone each
  line is a small card (item + remove, then quantity / rate / amount).
- Typed items: the last choice "Write “…” as typed" is offered only where the field allows it. The toggle is in
  `field-extras/ItemsExtras.tsx` ("Items may also be typed by hand"). The public form types, as before.
- Server: `apps/api/src/modules/ims/item-lines.ts` — a `FormStage` (`itemLinesStage`) registered in
  `forms/index.ts` after `links`. `checkFields` is unchanged.
  - A line with an `itemId` must point at an **active item of the same company**, else the field is refused
    (`… is no longer in the item list — pick it again`). The line then reads as the master does (name, unit).
  - A line without an `itemId` is linked when its text is exactly an item's code or name (case-insensitive) —
    so API clients and imports can send codes.
  - A line that matches nothing is refused on a field that takes only items
    (`… is not in the item master — pick an item from the list`), kept as typed on a field that allows typed items.

### L15 — stock on any step
- `apps/api/src/modules/ims/step-stock.ts`: `stockSpecOf` (a step's `stock` setting, or an AUTO step's
  `auto.action = 'stock'`), `planStock` (reads only — the one plan behind both the preview and the move),
  `applyStepStock`, `stockOnStepDone` (called by `completeStep`, same transaction), `previewStepStock`.
- `ISSUE` → an `OUT` move, `RECEIVE` → `IN`, `TRANSFER` → a `TRANSFER` move (quantity 0, the line's quantity in
  `lineQty`, the item's location moves — decision 74). From / to: a fixed text or a form field's value (start form
  or any earlier / this step). Lines resolve by `itemId`, then code, then name.
- Every move carries `refType = 'fms_record'`, `refId` (the record) and the new `stepId` (the `FmsRecordStep` row).
- AUTO `auto.action = 'stock'` runs through the same code (`ims/fms.ts` is now a thin wrapper; `fmsStockMoves`
  keeps its signature and its note text, the test in `ims.test.ts` is untouched and passes).
- Preview: `POST /api/fms/steps/:id/stock-preview { data }` → `{ stock: { action, short, lines[], problem,
  blocked } | null }`; each line has item, code, unit, qty, stock now, after, short, shortBy, from, to. Only the
  step's doer, the flow's problem solver or an FMS admin may ask. `StockPreview.tsx` shows it above "Mark done" in
  `StepDialog.tsx` (asked 0.4 s after typing stops).
- `GET /api/fms/records/:id/stock` + `RecordStock.tsx`: the record drawer's timeline shows under each step what it
  moved, what waits for approval, what was not issued and what was reversed.
- Editor: `StepStockEditor.tsx`, a "Stock" section in `StepEditor.tsx` for every step type but AUTO (action, item
  lines field, from / to as "not recorded / a fixed place / a field", what happens when short).

### L16 — not enough stock
- `block` (default): the step is refused with HTTP 409
  `Not enough stock: Bearing 6205 is short by 6 pcs (10 needed, 4 in stock)`; nothing moves. Lines of the same
  item are counted together, in order.
- `flag`: the step passes. What can go, goes. Each short line becomes a `PENDING` `OUT` move (whole line; it moved
  nothing) that waits in Inventory → Stock → To approve. Approvers are told through the existing
  `ims.adjustment_approval` notice; the store keepers are added to its recipients.
- Deciding it uses the existing endpoint `POST /api/ims/moves/:id/decide`, the approver rules of decision 75
  (listed approvers / `ims.approve`, the owner always, never your own = the person who did the step) and the
  shared `adjustMachine`:
  - **Approve** = issue the line now. Stock still can't go below zero: while stock is short the approval is
    refused (`Only 4 pcs of Bearing 6205 in stock`) and the line keeps waiting; once stock is there it applies.
  - **Reject** = the line is not issued; stock is unchanged.
  - Either way the record's history gets a note (`Stock issued after approval: …` /
    `Stock not issued — the approver said no: …`).
- `decideAdjustment` moved from `ims/moves.ts` to the new `ims/approvals.ts` (it now also decides step lines).

### L17 — reversal
- `apps/api/src/modules/ims/step-reversal.ts` `reverseStock`. Nothing is edited or deleted: each applied move gets
  one **new** move with `reversesId` pointing at it. `reversesId` is unique in the database, so a move can never be
  reversed twice. Lines still waiting for approval are withdrawn (`adjustMachine` action `withdraw`, role
  `system`, PENDING → REJECTED, `decisionNote = "Withdrawn — …"`).
- When: (1) an APPROVAL step is **rejected** — the stock of every step row from the step it sends the record back
  to, up to the approval, is reversed (AUTO stock steps in between too); redoing the step moves stock again (a new
  step row, new moves). (2) the record is **cancelled** (`recordAction`, which the CRM also uses to cancel an
  order) — every move of the record still standing is reversed, including AUTO moves made before phase 11.
- A reversal that can't be applied (a receipt whose stock was already used) does not stop anything: it is saved
  as a `PENDING` move with `reversesId`, the approvers and store keepers are told (same notice), and the record's
  history says so. The approver applies it once stock allows, or drops it.
- Stock is given back before any is taken away, so a receipt and a later issue of the same item both unwind.

### Schema
`prisma/schema/ims.prisma`, migration `20261112090000_phase11_stock_steps`: `StockMove.stepId`, `lineQty`,
`reversesId` (unique, self-relation `reverses` / `reversedBy`), indexes on `(refType, refId)` and `stepId`.
No new model, so nothing to add to `packages/db/src/scope.ts`.

### Strings
`apps/web/src/locales/parts/stock-steps.en.json` / `.hi.json` (section `stockSteps`). Hindi is machine-drafted
(decision 14). `en.json` / `hi.json` are untouched.

## Decisions taken (for the decisions log)
1. **Fields from before phase 11.** `freeItems` has three readings: `true` = typed items allowed; `false` = only
   items of the master; **absent = the field predates phase 11 (or is made by MONO itself: the CRM's after-order
   flow, the demo seed, AI drafts) and keeps accepting typed lines exactly as before** — nothing is added to old
   definitions and no data is migrated. The builder writes `freeItems: false` when a field's type is changed to
   "Item lines" (one line in `FieldsEditor.tsx`), so every field made in the builder from now on takes only items
   until the toggle is switched on. In the editor an absent setting shows as "on".
2. **The public form** always accepts typed lines, even on a field that takes only items: a visitor has no item
   list. Such a line is linked when its text is an item's code or name; otherwise it stays text and moves no stock.
3. **A line that is not in the item master never moves stock** — on any step, in any mode it is noted on the
   record's history and skipped (decision 81 extended); the preview shows "will not move". It never blocks.
4. **AUTO steps** use only `auto` (`short` behaves as "note and go on", decision 81); a `stock` setting on an
   AUTO step is ignored. An APPROVAL step moves its stock only when approved. A DECISION step moves it whatever
   the answer.
5. **A transfer with no destination** (the field is empty) refuses the step with `Say where the stock moves to`;
   the preview says the same.
6. **Flagged lines wait whole** (not "issue what there is and wait for the rest").
7. **Rejection reverses by position**: step rows whose position in the flow is between the step the rejection
   leads to and the approval itself. A DECISION's "No" branch that loops back, a normal `next` loop, and
   "Close record" do **not** reverse — only a rejected approval and a cancel do.
8. A step that moves stock is no longer offered as a one-tap Telegram button (`telegramActions`): the doer sees
   the preview in the app first.
9. A receipt takes the line's rate only when the item has no rate yet (otherwise the item's rate, as AUTO did).
10. Server-written history notes are English, like the existing ones (`Stock out: 2 line(s) · 1 waiting for
    approval (Bearing 6205)`); they are logged as `note` events (no new event type, so `en.json` is untouched).

## Shared files touched (lines added, nothing else changed)
- `apps/api/src/modules/forms/index.ts` — import + `itemLinesStage` in `STAGES`.
- `apps/api/src/modules/fms/engine.ts` — one call to `stockOnStepDone` in `completeStep`, `row.id` passed to
  `runAuto`; **helpers moved out** to the new `fms/engine-helpers.ts` (`fmsLink`, `parseDefinition`,
  `telegramActions`, `log`, `pickDoer`, `Ctx`, `payloadOf`, `recordData`, `mayDo`) and re-exported, so existing
  imports from `./engine` keep working. `engine.ts` went from 411 to 345 lines.
- `apps/api/src/modules/fms/auto.ts` — optional `stepId` parameter passed on to `fmsStockMoves`.
- `apps/api/src/modules/fms/records.ts` — `reverseStock` on cancel.
- `apps/api/src/modules/fms/routes.ts` — the two routes above.
- `packages/shared/src/machines/ims.ts` — `withdraw` on `adjustMachine` (+ a test in `ims/ims.test.ts`).
- `apps/web/src/modules/fms/FieldsEditor.tsx` — the type `onChange` (decision 1).
- `apps/web/src/modules/fms/StepEditor.tsx`, `StepDialog.tsx`, `RecordDrawer.tsx` — an import and one JSX line each.
  `RecordDrawer.tsx` is now 393 lines: a merge that adds more to it must split it.
- IMS files changed: `ims/moves.ts` (three optional `MoveArgs`, `show` exported, `decideAdjustment` moved out,
  three more fields in `listMoves`), `ims/access.ts` (`askApprovers`), `ims/routes.ts` (import).

## Tests (all pass)
- `apps/api/src/modules/ims/step-stock.test.ts` — L14 ×3, L15 ×2.
- `apps/api/src/modules/ims/step-stock-reversal.test.ts` — L16 ×2, L17 ×2, company scoping (split from the first
  file to stay under 400 lines; shared set-up in `step-stock.fixture.ts`).
- `packages/shared/src/ims/ims.test.ts` — `L17: a waiting line is withdrawn by the system only…`.
- `apps/api/src/modules/ims/ims.test.ts` (AUTO stock step) unchanged and passing.

## Looked at in a browser
Chromium, 380 px and 1440 px, light theme, English, demo data: the builder's Stock section and the typed-items
toggle; the start form's item picker (list open, two lines filled); the step dialog with the preview (one line
fine, one short, `flag`); the record drawer with a waiting line; Inventory → Stock → To approve. No sideways
scroll on any of them. Screenshots were not saved into the repository.

## Left open / not done
- No Playwright e2e spec for these screens (README puts e2e in the second wave). Dark theme and the Hindi strings
  were not looked at in a browser.
- "Mark done" is not disabled when the preview says the step is blocked: the server refuses and the message shows.
- Publishing does not check a TRANSFER step for a destination (the editor warns; the step refuses at run time).
- Plan §2.4 also names "reopening a step" and "consume-by-recipe": FMS has no reopen action today, and recipes are
  Phase 13. Neither is built.
- AI-drafted flows and the CRM's after-order flow create "items" fields without `freeItems`, so they accept typed
  lines (decision 1). If AI drafts should default to "only items", `build-flow` must write `freeItems: false`.
- A reversal the approver **rejects** stays rejected: that receipt can't be reversed again from the record.
- The notice for a waiting step line reuses the "Stock adjustment to approve" template (its text says
  "adjustment"); no new event or template was added.
- Stock is still one number per item: from / to on issues and receipts are recorded on the move only (Phase 13).
