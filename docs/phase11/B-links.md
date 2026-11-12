# Phase 11 — package B: linked choices (rows L6–L12)

Plan §2.2 and §2.3 (without formulas). Branch `worktree-agent-a14b87f54c9be442d`.

## What was built

### Server

| Piece | File | What it does |
|---|---|---|
| `fms:<flowId>:<field>` | `masters/sources/fms.ts` | Distinct values typed in that field (start form or any finished step) across the flow's live records (not cancelled, not deleted). One choice per value ignoring case and outer spaces (the most used spelling is shown), most used first, searchable. No link (a value is not a row). |
| `rec:<flowId>` | `masters/sources/rec.ts` | A whole record: `#12 · Sharma wedding · 14/12/2026` (company time zone, decision 46). `ref` = `rec:<id>`; `columns` = `mergeData` of the start form and finished steps + `number`, `title`, `status`, `started` (YYYY-MM-DD). `sub` = the step it stands at. Filters: at step X (an OPEN step with that key), only RUNNING, started by the person, started in the last N days. Search by number (`12`, `#12`) or title. |
| Options | `masters/options.ts` | `sourceRows` (no permission check; company-scoped; dependent-choice filter), `masterOptions` (the route; `fms:` / `rec:` need `fms.view`), `lookupRefs` (rows behind links, by `ids`), `matchesFilter` (link to link when both sides have one of the same kind, else text ignoring case / spaces). Every built-in handler honours `query.ids`. |
| Field-driven options | `masters/field-options.ts` | `GET /api/masters/options?owner=flow:<id>&field=<key>[&step=&record=&q=&parent=&parentRef=]` reads the field's own `master`, `recFilter` and `filterBy` (record's version → published version → draft). The browser can only search and name the parent's value — both only narrow. With `filterBy` and no parent value nothing is offered. `source=` alone still lists a whole source (editor, pickers outside forms). |
| Columns | `masters/columns.ts` | `GET /api/masters/columns?source=…` → `[{ key, label }]` for the editor (`rec:` and `fms:` need `fms.view`). |
| Link names | `masters/resolve.ts` | `POST /api/masters/links { refs }` → `{ [ref]: { label, to } }`: each link's name today and where it opens; company-scoped; `rec` links only with `fms.view`; a link to something deleted / foreign is simply absent. |
| Link stage | `forms/links.ts` | `check`: a link under `_refs` is kept only if the row exists in this company and is one the field offers (source + `recFilter`); otherwise dropped, text stays. A kept link makes the text the row's current name. `filterBy` enforced (this form's value, else `scope.known`). `fill` targets that are `locked` are recomputed from the source row; unlocked targets keep the browser's value. |
| Unique stage | `forms/unique.ts` + `prisma/schema/links.prisma` (`unique_values`, migration `20261112034058_phase11_links`) | `check` refuses a value held by another live record; `commit` claims with `INSERT … ON CONFLICT DO NOTHING` under a unique index `(company, owner kind, owner id, field, value)`; `release` frees on cancel / delete. Compared lower-case, trimmed. |

### Web

- `masters/MasterPicker.tsx` — search-and-pick with arrow keys, a clear (×) button, 44 px rows, an error line when the list can't be read, optional "Use “…”" row for typed text.
- `fms/form/LinkedInput.tsx` — every source. On pick: `ctx.patch` with the value, its link and the `fill` columns (dates, mobiles, item lines converted to what the inputs hold). `filterBy`: sends the parent's value / link (`ctx.values`, else `ctx.known`), disabled with a hint while the parent is empty. People stay a dropdown and now keep `user:<id>`.
- `fms/form/depend.ts` — `clearDependents` (parent changes → the dependent choice is emptied, down a chain), `fitsParent`, `isLockedTarget`. `fms/form/LockedValue.tsx` — a locked fill target, read-only.
- `fms/field-extras/SourcePicker.tsx` — source picker with "Values typed in another process" (process + field) and "A record of another process" (process); a marked place for `rt:`.
- `fms/field-extras/LinkExtras.tsx` — records to offer, auto-fill mapping, "depends on", "Locked" (shown on a fill target), "Must be unique" (text / number / date / master).
- `fms/RecordValues.tsx`, `fms/record-links.ts` — in the record drawer a linked value is a link to its row / record and shows `(now <name>)` when renamed; one `/api/masters/links` call per record. `knownOf(record)` feeds step forms.
- Strings: `locales/parts/links.en.json` / `links.hi.json` (Hindi machine-drafted, decision 14).

## Tests (all passing in the full suite: 54 files, 373 passed, 5 skipped)

- `apps/api/src/modules/forms/links.test.ts` — L6, L7, L8, L9 (×3), another company gets nothing, `fms.view`.
- `apps/api/src/modules/forms/links-rules.test.ts` — L10 (×3: refused / freed on cancel; three simultaneous saves, one wins; values from before the field was unique + master rows), L11 (×2: item → unit / rate with a locked rate; record → its fields), L12 (×2: Outlet → Table offered and enforced; parent on an earlier form).
- `apps/web/src/modules/fms/form/depend.test.ts` — L11, L12 on the form side.
- `apps/api/src/modules/forms/test-kit.ts` — helpers shared by the two API test files.

## Decisions taken

1. **A new record's id is chosen before the form is saved.** `scope.recordId` must be the id the record will be created with (`createId()`), because unique values are claimed for it in the same transaction. `startRecord` and `saveRow` do this. `uniqueStage.commit` throws if a form with unique fields arrives without `recordId` — record types (package E) must pass it.
2. **"Live" for unique = not cancelled and not deleted.** A closed record keeps its value (a bill number stays taken).
3. **Values saved before a field became unique (or imported) count too**, by a plain look through the owner's live records (flows and masters). Only the table is race-safe; a record that has a claim for the field is left to the table.
4. **`recFilter` is enforced on save**, not only in the list: a link to a record the field would not offer is dropped (text stays).
5. **A kept link overrides the text** with the row's current name, so text and link can never disagree.
6. **`filterBy` without a link:** if the source has rows of that name, one of them must fit the parent (it is then linked); a name that is in no row may still be typed. An empty parent with a value in the dependent field is an error ("choose Outlet first").
7. **A locked target with no linked source is empty**, and "required" then fails — a locked field has nowhere else to come from.
8. **Typing a value that is in no list** is offered on the web only for `fms:` sources (they are lists of typed values). Row sources (masters, customers, items, records) stay pick-only on the web, as they were; the server still accepts typed text.
9. **Permission:** listing `fms:` / `rec:` choices, their columns and `rec` link names needs `fms.view`. Saving a form never needs it — the form's designer decided what the field reads.
10. **Opening a link:** records open in Live FMS (`?record=`); master rows, customers and items open their list searched for the name (`?q=`, new on those three pages); people have no screen to open.
11. Dependent-choice matching scans at most 2,000 rows of the source before filtering (`FILTER_SCAN`).

## Shared / not-owned files touched

- `packages/db/src/scope.ts` — `'UniqueValue'` in `COMPANY_SCOPED_MODELS`.
- `apps/api/src/modules/fms/engine.ts` — `startRecord`: `createId()` → `recordId` in the form scope and `id` in the create (4 lines; the file was 411 lines before, 415 now).
- `apps/api/src/modules/masters/rows.ts` — the same for a new master row.
- `apps/api/src/modules/forms/index.ts` — comment on `FormScope.recordId` only.
- `apps/api/src/modules/masters/sources/index.ts` — `OptionQuery.ids`, `filter.ref`, `SourceColumn`.
- `apps/web/src/modules/fms/FieldsForm.tsx` — `set` / `patch` go through `clearDependents`; a locked fill target renders `LockedValue`; the people branch moved into `LinkedInput`.
- `apps/web/src/modules/fms/form/ctx.ts` — `FormOwner` gains optional `step`, `record`.
- `apps/web/src/modules/fms/StepDialog.tsx` — new props `flowId`, `recordId`, `known`; passes `owner` and `known` (nothing else changed). Callers `RecordDrawer.tsx`, `MyStepsPage.tsx`.
- `apps/web/src/modules/fms/StartDialog.tsx` — passes `owner`.
- `apps/web/src/modules/fms/FieldsEditor.tsx` — the source `<Select>` replaced by `<SourcePicker>`.
- `apps/web/src/modules/fms/RecordDrawer.tsx` — values through `FieldValue` / `StepValues` (also stops `_refs` showing as a value on a step).
- `apps/web/src/modules/masters/MasterRowsPage.tsx` — `owner` on the row form; search starts from `?q=`.
- `apps/web/src/modules/crm/CustomersPage.tsx`, `apps/web/src/modules/ims/StockToday.tsx` — search starts from `?q=` (one line each).

## For the other packages

- **E (record types):** add `rt` to `SOURCE_COLUMNS` (`masters/columns.ts`), `recordType` to `FIELD_FINDERS` (`masters/field-options.ts`), `rt` to `LINK_RESOLVERS` (`masters/resolve.ts`), an option in `SourcePicker.tsx`; the `rt` handler must honour `query.ids` and return `ref` + `columns`; pass `recordId: createId()` for a new record and call `releaseForm` on delete.
- **D (stock):** `StepDialog` now takes `flowId`, `recordId`, `known`.
- **Anyone saving a form:** see decision 1.

## Left open / not verified

- **Browser:** start form, picker lists, dependent choice, locked field, record picker, typed value on a step, drawer links, rename note, opening a master row, and the editor's Start form tab were looked at in Chromium at 380 px and 1440 px (light theme, English). **Not looked at:** Hindi, dark mode, the master-row dialog with a dependent choice, the people dropdown's link, the "can't load" line for someone without `fms.view`. No Playwright e2e spec was added and the existing e2e suite was not run.
- **Editor:** "depends on" and auto-fill only offer fields of the same form; a step field that depends on a start-form field works on the server and in the form (tested) but has to be set in the definition, not through the editor. An unfinished source (`fms:` / `rec:` with no process chosen) is not flagged by Publish.
- **Master import** (`importRows`) does not go through the form pipeline (it never did): imported rows hold no claim, so duplicates inside one import are not refused; later single saves do see them (decision 3).
- **Unique + a step done again with the value emptied:** the old step row still holds the old text, so the history look (decision 3) may keep refusing that old value for other records.
- `fms/engine.ts` is over 400 lines (it already was).
- Showing linked values outside the record drawer (Live FMS columns, documents, KPI cards, notifications — §2.5) is second-wave work.
