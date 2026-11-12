# Package B — Links (rows L6–L12, plan §2.2 and §2.3 without formulas)

Plug into: `packages/shared/src/fms/definition.ts` (`master`, `recFilter`, `unique`, `fill`, `locked`, `filterBy`),
`packages/shared/src/fms/links.ts`, `apps/api/src/modules/forms/index.ts` (`check` / `commit` / `release`), your
stubs `forms/links.ts`, `forms/unique.ts`, `masters/sources/fms.ts`, `masters/sources/rec.ts`; `masters/options.ts`
(registry; built-in sources already return `ref` and `columns`), `masters/routes.ts`, `fms/engine.ts`
(`startRecord`, `completeStep`, `recordData`), `fms/records.ts` (cancel calls `releaseForm`); web
`fms/FieldsForm.tsx`, `fms/form/ctx.ts`, your stubs `fms/form/LinkedInput.tsx`, `fms/field-extras/LinkExtras.tsx`,
plus `fms/FieldsEditor.tsx`, `masters/MasterPicker.tsx`, `masters/api.ts`, `fms/StartDialog.tsx`,
`fms/StepDialog.tsx`, `fms/RecordDrawer.tsx`.

Build — server:
- `fms:<flowId>:<field>`: distinct values typed in that field (start form or any step) across that flow's live
  records, searchable. ("Vendor name" in *Purchase request* becomes the dropdown in *Goods receipt*.)
- `rec:<flowId>`: pick a whole record, shown `#12 · Sharma wedding · 14/12/2026` (DD/MM/YYYY, decision 46);
  `ref` = `rec:<recordId>`; `columns` = the record's merged data (`mergeData`) plus `number`, `title`, `status`,
  `started`. Filters from the field's `recFilter`: at step X, only RUNNING, started by me, last N days.
- Both read other processes' data: require `fms.view`; always company-scoped; test another company gets nothing.
- Options route: support dependent choices and record filters without letting the browser widen what a field may
  show — prefer sending the owner (flow / master / record type) + field key and reading the field's own settings
  on the server; raw parameters may only narrow. Add an endpoint listing a source's columns (keys + labels) for
  the editor.
- `forms/links.ts` `check`: for each `master` field arriving with a link in `_refs`, verify the row exists in this
  company and belongs to the field's source; an invalid link is dropped (text stays). Apply `fill`: targets that
  are `locked` are recomputed on the server from the source row (never forgeable); unlocked targets keep the
  browser's value. Enforce `filterBy` on save (a row whose column does not match the other field's value is an
  error).
- `forms/unique.ts`: `unique: true` refuses a value already used in another **live** record of the same owner.
  Race-safe: a small table with a database unique index (new `prisma/schema/links.prisma`, migration
  `phase11_links`, model in `packages/db/src/scope.ts`), not read-then-write. `commit` claims, `release` frees
  (cancelled FMS records and deleted master rows already call `releaseForm`). A record does not trip over its own
  value. Comparison ignores case and surrounding spaces.

Build — web:
- `LinkedInput.tsx`: search and pick for every source; on pick `ctx.set(key, text, ref)` and apply `fill` with one
  `ctx.patch(...)` (filled fields stay editable unless the target is `locked` → read-only); with `filterBy`, send
  the other field's value (from `ctx.values`, else `ctx.known`), hint when the parent is empty, clear this field
  when the parent changes. Typed text that matches nothing stays allowed where it is today. 380 px, ≥ 44 px.
  Keep the people dropdown working.
- `LinkExtras.tsx`: for `master` fields — records to offer (`recFilter`, `rec:` only), auto-fill mapping (column
  → another field), "Depends on" (`filterBy`); for a fill target — "Locked"; for text / number / date / master —
  "Must be unique".
- `FieldsEditor.tsx` source picker: add "Values typed in another process" (process + field) and "A record of
  another process" (process). Leave room for record types (`rt:<id>`; package E adds it).
- `StartDialog.tsx` / `StepDialog.tsx` (and callers): pass `owner={{ kind: 'flow', id }}` and, for steps, `known`
  into `FieldsForm`. Package D adds a stock preview to `StepDialog.tsx` — keep your change there small.
- L9 on screen: in the record drawer a linked value opens the row / record it came from and shows the row's
  current name if it was renamed (links resolved in bulk on the server, company-scoped).
- Strings: `locales/parts/links.en.json` / `links.hi.json`.

Tests — new `apps/api/src/modules/forms/links.test.ts` (style of `fms/fms.test.ts`): L6; L7 label, ref, columns;
L8 each of the four filters; L9 link stored under `_refs`, survives a rename, a forged / other-company link is
dropped, pre-phase-11 data (no `_refs`) still reads; L10 refused the second time, free again after cancel, two
simultaneous saves cannot both win; L11 item fills unit and rate, a locked target cannot be overridden by the
browser; L12 Outlet → Table offered and enforced on save; company scoping; the `fms.view` check.
