# Phase 11 — how it is built (read before touching the code)

Plan: `docs/plans/hospitality-100-plan.md` §2 and §1.1–1.2. Rows to turn green: `docs/plans/coverage.md`.
The foundation below is already in `main`-line code; each work package fills its own files.

## Contracts that are fixed

**1. Field settings** — `packages/shared/src/fms/definition.ts`. Every phase-11 setting on a field is optional
(`learn`, `list`, `writeAllowed`, `recFilter`, `unique`, `fill`, `locked`, `filterBy`, `formula`, `reportable`,
`freeItems`; field type `formula`; step setting `stock`). A flow saved before phase 11 must parse to exactly what
it was — never add a default to a field setting.

**2. Links are kept beside the text, not instead of it** — `packages/shared/src/fms/links.ts`.
A form value stays the text people read. A picked row's link lives under the reserved key `_refs`:
`{ customer: 'Sharma Traders', _refs: { customer: 'customer:<id>' } }`. Ref kinds: `customer`, `item`, `user`,
`row` (master row), `rec` (FMS record), `rt` (record of a record type). Use `refsOf`, `withRef`, `mergeData`,
`plainValues`, `makeRef`, `parseRef`, `parseSource`, `listKeyOf`. This differs from the plan's `{ text, ref }`
wording on purpose: every reader of values (documents, titles, KPI cards, AI views, the public API) keeps working.

**3. Server form pipeline** — `apps/api/src/modules/forms/index.ts`.
`processForm(tx, scope, fields, input)` = shared `checkFields`, then the stages in order
`links → learn → formula → unique`, each a `FormStage { check?, commit? }` in its own file. `check` may fix
`state.values` / `state.refs` and add `state.errors[fieldKey]`; `commit` runs only for a valid form, in the saving
transaction. `scope.owner` is `{ kind: 'flow' | 'master' | 'recordType', id }`; `scope.known` holds the record's
earlier values. FMS start / step and master rows already go through it. Anything new that saves a form must too.

**4. Choice sources** — `apps/api/src/modules/masters/options.ts` + `masters/sources/*.ts`.
`GET /api/masters/options?source=…&q=…` returns `MasterOption { value, label, sub, ref?, columns? }`.
Sources by prefix: `customers`, `items`, `people`, `vendors`, `m:<id>`, `fms:<flowId>:<field>`, `rec:<flowId>`,
`list:<key>`, `rt:<recordTypeId>`. `columns` feed auto-fill and dependent choices.

**5. Web form** — `apps/web/src/modules/fms/FieldsForm.tsx` gives every input a `FormCtx`
(`form/ctx.ts`): `values`, `refs`, `set(key, value, ref?)`, `patch(values, refs?)`, `owner`, `known`, `people`.
Inputs live in `fms/form/*.tsx`; per-field settings in the editor live in `fms/field-extras/*.tsx`.

**6. Strings** — new features put their English and Hindi strings in
`apps/web/src/locales/parts/<feature>.en.json` / `.hi.json` (new top-level sections only). Do not edit
`en.json` / `hi.json` unless changing an existing string.

## Who owns which files

| Package | Rows | Owns |
|---|---|---|
| A Lists | L1–L5 | `forms/learn.ts`, `masters/sources/list.ts`, `prisma/schema/lists.prisma`, `apps/api/src/modules/lists/**`, `fms/form/LearnInput.tsx`, `fms/field-extras/LearnExtras.tsx`, `apps/web/src/modules/lists/**`, `locales/parts/lists.*` |
| B Links | L6–L12 | `forms/links.ts`, `forms/unique.ts`, `masters/sources/{fms,rec}.ts`, `masters/options.ts`, `masters/routes.ts` (options route), `prisma/schema/links.prisma`, `fms/form/LinkedInput.tsx`, `fms/field-extras/LinkExtras.tsx`, `masters/MasterPicker.tsx`, `masters/api.ts` (options hook), the source picker in `FieldsEditor.tsx`, `StartDialog.tsx` / `StepDialog.tsx` (owner, known), `locales/parts/links.*` |
| C Formulas | L13 | `packages/shared/src/formula/**`, `forms/formula.ts`, `fms/form/FormulaValue.tsx`, `fms/field-extras/FormulaExtras.tsx`, `locales/parts/formula.*` |
| D Stock | L14–L17 | `apps/api/src/modules/ims/fms.ts`, `ims/step-stock.ts` (new), the stock calls in `fms/engine.ts` / `fms/records.ts`, `prisma/schema/ims.prisma`, `fms/form/ItemLines.tsx`, `fms/field-extras/ItemsExtras.tsx`, the Stock tab in `StepEditor.tsx`, the stock preview in `StepDialog.tsx`, `locales/parts/stock-steps.*` |
| E Record types | U1–U6 | `prisma/schema/records.prisma`, `packages/shared/src/records/**`, `apps/api/src/modules/records/**`, `masters/sources/record-type.ts`, `apps/web/src/modules/records/**`, `locales/parts/records.*` |
| Second wave | L18, U7–U10, e2e | reportable fields, report builder, showing values anywhere, AI drafts, docs |

Shared files several packages must touch (`app.ts` route registration, `router.tsx`, `layout/nav.ts`,
`packages/shared/src/index.ts`, `permissions.ts`, `events.ts`, `packages/db/src/scope.ts`, `FieldsForm.tsx`,
`StepDialog.tsx`): add your lines, change nothing else, and list each such file in your report.

## Rules for every package

- CLAUDE.md §17 applies in full: 380 px and 1440 px, Hindi + English, state machines through `transition()`,
  audit + domain event on every change, permissions checked in the API, company scoping tested, no file over
  400 lines, no browser date pickers (use `DateInput` / `TimeInput`), option lists through the shared `Select`.
- Each coverage row gets at least one automated test; put the row id in the test name (`it('L2: …')`).
- One Prisma migration per package, named after it. Add new models to `packages/db/src/scope.ts`.
- Do not edit `CLAUDE.md` or `docs/CHANGELOG.md`: write `docs/phase11/<package>.md` with what was built, the
  decisions taken and anything left open. They are merged into the main docs at the end.

## After the merge (12/11/2026)

The five packages are merged into the main branch. What was joined by hand when they met:

- **Record types as a source of choices** (`rt:<typeId>`): the handler checks picked links (`ids`) and is
  company-scoped only; "may this person browse it" is asked by `masterOptions` / `sourceColumns`
  (`mayReadRecordType`), so a saved form verifies its links whoever fills it in. `recordType` is in `FIELD_FINDERS`
  (a record form's own picker, child-table columns included), `rt` in `LINK_RESOLVERS` (named only to people who may
  see the type; opens `/records/<typeId>?record=<id>`) and in `SOURCE_COLUMNS`; the editor's source picker lists
  record types.
- **A link that holds makes the text the row's current name** — also for records of a record type
  ("SITE/26-27/0001 · Tonk mine"), in fields and in child lines.
- **Lists**: Masters → Lists shows record types under "used in"; `list.*` events are listed for webhooks.
- `fms/engine.ts` is split (`engine-helpers.ts`) and back under 400 lines.

## Second wave (built 12/11/2026, in the main checkout)

- **U7** `records/start-flow.ts` (a move starts a process, in the move's transaction), `platform/v1-records.ts`
  (public API), `record.*` notification events, webhook module names fixed.
- **L18** `packages/shared/src/fms/paths.ts` + `fms/show.ts` (value paths, read through links in bulk),
  `fms/paths.ts` (Live FMS columns), `fms/kpi.ts`, document texts, `{{data.…}}` in process messages.
- **U9** `forms/report.ts` (the pipeline stage), `reports/backfill.ts` (worker), the "Use in reports" tick.
- **U10** `packages/shared/src/reports`, `reports/engine.ts` (definition → bound SQL), `reports/service.ts` (saved
  reports, exports), `reports/schedule.ts`, the Ask hook (`ai/prompts/ask.v2.ts`), `apps/web/src/modules/reports`.
- **U8** `ai/records.ts` + `ai/prompts/record-type.v1.ts`, `records/AiDraftDialog.tsx`.
- `e2e/phase11-*.spec.ts` (four files and `phase11-kit.ts`), demo data in `prisma/seed-demo-records.ts`, CHANGELOG and CLAUDE.md (decisions 102–116).

The briefs `G.md`–`J.md` in `briefs/` were written for agents; the work was done by hand instead and differs in
places (reports use only reportable fields and built-in columns; schedules send a message with the numbers and a
link, not an attachment).
