# Package D — Stock on steps (rows L14–L17, plan §2.4)

CLAUDE.md §10, §6.3 and decisions 9, 74, 75, 81 bind you. Plug into: `packages/shared/src/fms/definition.ts`
(`stepStockSchema`, step `stock`, field `freeItems`), `fms/fields.ts` (lines keep `itemId`, `unit`),
`packages/shared/src/machines/ims.ts`, `apps/api/src/modules/ims/moves.ts` (`applyMove`, pending adjustments,
approvers), `ims/fms.ts` (today's AUTO stock step), `fms/engine.ts`, `fms/auto.ts`, `fms/records.ts`,
`fms/routes.ts`, `masters/options.ts` (the `items` source returns `ref` and `columns` `unit`, `rate` in rupees,
`stock`); web `fms/form/ItemLines.tsx` (yours), `fms/field-extras/ItemsExtras.tsx` (stub), `fms/StepEditor.tsx`,
`fms/StepDialog.tsx`, `fms/RecordDrawer.tsx`, `masters/api.ts`.

Build:
- **L14 item picker** (`ItemLines.tsx`): each line picks an item by code or name through the `items` source; unit
  and rate fill in (rate editable), live stock shows, the line keeps `itemId` and `unit`. Typing an item not in the
  master only when the field has `freeItems: true` (toggle in `ItemsExtras.tsx`, `items` fields). Public form:
  typed as today. Enforce on the server too (a line without a valid `itemId` on a non-free field is refused; an
  `itemId` must be an active item of the same company) without changing `checkFields`' signature — e.g. your own
  `FormStage` registered in `forms/index.ts` (one line). Flows published before phase 11 have no `freeItems` and
  must keep accepting typed lines: decide how, document, test. Usable at 380 px.
- **L15 stock on any step**: a TASK / APPROVAL / DECISION / OUTSIDE step with `stock` moves stock when done, same
  transaction: `ISSUE`, `RECEIVE`, `TRANSFER` (stock is one number per item today — a transfer records from / to
  and moves the item's location, decision 74; per-location stock is Phase 13). From / to: fixed text or a form
  field's value. Lines resolve by `itemId`, then code / name. AUTO `auto.action = 'stock'` keeps working through
  the same code path. Moves carry their record and step.
- **Preview**: an endpoint returning, for an open step and the values typed so far, what will move (item, qty,
  unit, stock now, after, short?, from / to); `StepDialog.tsx` shows it above "Mark done" (package B also edits
  this file — keep your change contained).
- **L16 not enough stock**: `block` → refuse, naming the item and the shortfall. `flag` → the step passes; the
  lines that could not be issued wait for the store keeper's approval through the existing pending-adjustment /
  approver machinery (decision 75) and the shared state machine; stock never goes below zero. Define exactly what
  approving and rejecting does; notify the approvers the existing way.
- **L17 reversal**: when a rejected approval sends the record back before a step that moved stock, and when a
  record is cancelled, that stock is reversed with **new** moves pointing at the ones they undo; nothing edited or
  deleted; never reversed twice; pending flagged lines withdrawn. If a reversal cannot be applied, the record must
  not get stuck: note it in the record's history and tell the store keeper.
- **Editor**: `StepEditor.tsx` Stock sub-tab for every non-AUTO step (action, items field, from / to, when short).
- Schema changes in `prisma/schema/ims.prisma`, one migration `phase11_stock_steps`.
- Strings: `locales/parts/stock-steps.en.json` / `stock-steps.hi.json`.

Tests — new `apps/api/src/modules/ims/step-stock.test.ts`: L14 (picked line keeps itemId / unit; typed refused
unless allowed; another company's item refused; an old flow still accepts typed lines); L15 (issue, receive,
transfer on a TASK step, location fixed and from a field; preview matches what happens); L16 (block names the
item; flag passes and leaves a pending line only an approver can approve or reject); L17 (rejection sends back →
reversed, redoing moves it again; cancel reverses everything once; stock right after each); company scoping.
The AUTO stock tests in `ims.test.ts` must still pass. Split helpers out of `engine.ts` rather than pass 400 lines.
