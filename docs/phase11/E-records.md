# Phase 11 · Package E — Custom record types (rows U1–U6)

A company can now add its own things — a site visit, a prescription, a trip, a project — without code: a record
type has fields, child lines, its own number series, statuses with allowed moves, permissions per type, a list
screen, a drawer and a place in the left menu.

## What was built

### Data (`prisma/schema/records.prisma`, migration `20261112033737_phase11_records`)
- `RecordType` (`record_types`): name, plural name, code (`site_visit`, freed on delete), number prefix, description,
  `definition` JSON, `menu` JSON, `permissions` JSON, status ACTIVE / ARCHIVED, soft delete.
- `RecordEntry` (`records`): type, number + FY (unique per type), code `SV/26-27/0001`, title, status, `data` JSON
  (values with links under `_refs`), `lines` JSON (child lines by table key), created by, soft delete.
  (Not called `Record`: that is a TypeScript word.)
- `RecordEvent` (`record_events`): history and notes — created, changed, status, note, file, file_removed, deleted.
- `RecordView` (`record_views`): saved views of a list, mine or shared.
- All four are in `COMPANY_SCOPED_MODELS`; types and entries in `SOFT_DELETE_MODELS`. Indexed for lists.
- The migration also gives existing **Admin** roles the five `records.*` permissions (new companies get them from
  the role defaults; the Owner has `*`).

### Shared (`packages/shared/src/records/`, exported from the index)
- `definition.ts` — the strict zod schema of a definition: `fields` (the FMS `fieldSchema`, so lists, links,
  formulas and unique work in records), `tables: [{ key, label, fields }]`, `statuses: [{ key, label, kind, final? }]`
  (`kind` = one of the fixed status tones), `start`, `moves: [{ from, action, label, to, who, noteRequired? }]`,
  `displayField`, `columns`. Also the menu schema (section + one of 24 lucide icons), the permissions schema,
  input / patch schemas (the patch has no defaults — decision 71), `defaultRecordDefinition()`,
  `checkRecordDefinition()` (problems in plain words: duplicate keys, moves pointing at statuses that don't exist,
  no start status, a move leaving a final status, a status no move leads to …) and `recordTitleOf()`.
- `machine.ts` — `buildRecordMachine(def)` turns the moves into a transition table for the shared
  `defineMachine` / `transition()`; `recordAccess()` (the four rights of a person on a type), `recordRoles()`,
  `moveRecord()`, `movesFor()` (the buttons to show) and `recordTypeMachine` (ACTIVE ⇄ ARCHIVED).
- `list.ts` — filters (`eq`, `contains`, `gte`, `lte`, `filled`, `empty`), the view config schema,
  `filterOpsFor(field)`, `defaultColumns(def)` and `riskyChanges(before, after)`.

### API (`apps/api/src/modules/records/`, registered in `app.ts`)
| Route | What |
|---|---|
| `GET /api/records/menu` | the left-menu entries the signed-in person may see |
| `GET/POST /api/records/types`, `GET/PATCH/DELETE /api/records/types/:id`, `POST …/archive`, `POST …/restore` | record types (`records.admin`) |
| `GET /api/records/types/:id/records` | the list: `q`, `status`, `from`, `to`, `filters` (JSON), `sort`, `dir`, `columns`, `page`, `pageSize` |
| `POST /api/records/types/:id/records` | a new record |
| `GET /api/records/types/:id/export?format=csv\|xlsx&all=1` | the current list as a file |
| `POST /api/records/types/:id/import` | a table (first row = field names), all or nothing |
| `GET/POST /api/records/types/:id/views`, `PUT/DELETE …/views/:viewId` | saved views |
| `GET/PATCH/DELETE /api/records/entries/:id` | one record (the drawer), change fields and lines, delete |
| `POST /api/records/entries/:id/move` | a status change (`action`, optional `note`) |
| `POST /api/records/entries/:id/notes` | a note |
| `POST /api/records/entries/:id/files`, `DELETE …/files/:fileId` | attachments (`entityType: 'record'`) |

- Every form (record fields, each child line, each imported row) goes through `forms/index.ts` with
  `owner: { kind: 'recordType', id }`; deleting a record calls `releaseForm`.
- Numbers come from `Counter` (key `rt:<typeId>`, per FY) — never reused, also after a delete or a failed import.
- Every status change runs `moveRecord()` → shared `transition()`; the update is guarded by the status it was read
  in, so two people pressing at once can't both move it. Nothing else writes `status`.
- Every mutation writes audit + a domain event through `recordChange`: `record.created`, `record.changed`,
  `record.status_changed`, `record.note`, `record.deleted`, `record.imported` — all in the shared data-event
  catalog (`platform/events.ts`), so webhooks carry them.
- `masters/sources/record-type.ts` implements the `rt:<recordTypeId>` choice source (label = code · title,
  `ref` = `rt:<recordId>`, `columns` = the record's values + `code`, `title`, `status`, `status_key`); it needs
  the caller's right to view that type (403 otherwise).
- `files/routes.ts`: a file attached to a record is served only to people who may view that record's type.
- `hooks.ts`: `statusHooks` run inside the status-change transaction (nothing registered yet) — the place to
  start an FMS flow from a move in the second wave.

### Web (`apps/web/src/modules/records/`, strings in `locales/parts/records.{en,hi}.json`)
- `/records/types` (admins; "Record types" under Masters in the left menu): cards with counts, open list,
  set up, archive / restore, delete (only when empty).
- `/records/types/new`, `/records/types/:id`: editor with tabs Details · Fields (`FieldsEditor` with `owner`, plus
  "link to another record type") · Lines · Statuses & moves · Permissions; problems listed in plain words;
  "Ready to use" chip; Save is off while something is wrong.
- `/records/:typeId`: the type's list — "+ New {name}", server search, status chips with counts, filters (date
  range, any field, sort), column chooser, saved views (mine / shared), export (Excel, CSV, all fields), import
  (Excel / CSV file or paste, problems by line), table → cards under 768 px, skeleton / empty / no-match / error
  / no-access states.
- Record drawer: code in the mono font, title, status chip with icon, values, child lines (a card per row), the
  moves this person may make (a dialog with a note, required where the move says so), edit, delete, tabs
  Notes · History · Files.
- Left menu: `nav.ts` stays static; `records/menu.ts` adds the entries (own section, or inside an existing one)
  where `AppShell` builds the sections for the sidebar and the phone drawer.
- Screenshots of every screen at 380 / 1440, light / dark: `docs/screenshots/phase11/records-*.png`.

## Decisions taken
1. **A record's status keys are the type's own** (`planned`, `visited` …); the transition table is built from the
   definition on each request. Machine roles are the move's `who` tokens (`edit`, `approve`, `creator`,
   `role:<id>`) plus `admin`.
2. **Rights** (U6): a right is held by record admins (`records.admin` / owner), by a role that has
   `records.<right>` in the Roles matrix (all types), or by a role the type names (or "everyone"). Nobody creates,
   edits or approves what they can't view. A new type defaults to: everyone views / adds / changes; HODs approve.
3. **Final statuses close a record**: its fields no longer change (notes and files still can); only an admin can
   delete it. No move may leave a final status.
4. **Nothing destructive once records hold it**: removing a field, table or status, or turning a field into a
   type its values don't fit, is refused with the count of records that hold it (409). Safe type changes
   (text ⇄ long text, number ⇄ amount, dropdown → text …) pass. The prefix may change: records already made
   keep their code and the series goes on under the new prefix.
5. **Deleting a type** is allowed only with no live records (decision 8); otherwise archive it (kept with its
   records, no new ones, off the menu). Name and prefix are unique per company among live types.
6. **Child lines** are stored on the record (`lines` JSON, ≤ 200 rows per table); each row is checked as a small
   form whose `known` values are the record's own. `lines` left out of an update keeps the tables as they are.
7. **Links**: one = a `master` field with source `rt:<typeId>`; many = a child table with such a column. The text
   stays in the value, the link under `_refs` (README contract 2).
8. **List filters are SQL with bound values only** (field keys too); the SQL text comes from fixed fragments, and
   field keys are checked against the definition first (an unknown one is a 400). Search covers the number, the
   title and every value of the record.
9. **Import** names fields in the first row by label or key, dates as DD/MM/YYYY, ≤ 2,000 rows, all or nothing
   with every problem by line; imported records take the next numbers and one `record.imported` event.
   **Export** is the current list (same filters and sort, every matching record up to 10,000), CSV with a BOM or a
   real `.xlsx` from a small built-in writer (`xlsx.ts`: no spreadsheet library on the server; typed text is never
   read as a formula).
10. **Saved views**: mine, or shared with everyone who can see the type (sharing needs the right to edit; an admin
    may change or delete anyone's shared view). A view is a saved search, so it is removed for real (the audit
    keeps it).
11. **Phones**: record screens use a local `Button` (`records/ui.tsx`) that is never under 44 px below 768 px.

## Shared files touched (lines added, nothing else changed)
- `apps/api/src/app.ts` — import + `app.register(recordRoutes)`.
- `apps/api/src/modules/files/routes.ts` — a record's file follows its type's permissions (2 imports + 1 check).
- `apps/web/src/app/router.tsx` — three lazy pages, four routes.
- `apps/web/src/layout/AppShell.tsx` — the workspace sections and the page title come through `records/menu.ts`.
- `apps/web/src/layout/Sidebar.tsx` — a menu item or section may bring its own `label`.
- `apps/web/src/modules/system/roles/RolesTab.tsx` — a module without `org.modules.<m>` falls back to
  `<m>.title` (so "Records" shows in the matrix without touching `en.json` / `hi.json`).
- `packages/db/src/scope.ts` — the four models.
- `packages/shared/src/index.ts` — `export * from './records'`.
- `packages/shared/src/permissions.ts` — `'records'` in `MODULES`.
- `packages/shared/src/platform/events.ts` — the six `record.*` data events.

## Tests (all passing in this checkout)
- `packages/shared/src/records/records.test.ts` — U1, U2, U4, U6 (validation, machine builder, rights, risky changes).
- `apps/api/src/modules/records/records.test.ts` — U1 (Site visit through the API alone, `SV/…/0001`, `0002`,
  numbers never reused; sound types; nothing destructive), U2 (moves, who, history, hooks roll back), and a
  `unique` + "remember what people type" field saving.
- `records-links.test.ts` — U3 (link to another type's record and to a customer; `rt:` source and permissions;
  child lines).
- `records-list.test.ts` — U4 (search, status, date range, field filters, sort, paging; saved views; drawer).
- `records-io.test.ts` — U5 (import all or nothing, export CSV + Excel, the xlsx writer, menu entries).
- `records-access.test.ts` — U6 (the four rights on every route, Roles matrix, admin only set-up) and company
  scoping.

## Left open (not built — second wave or later)
- A status change starting an FMS flow (hook ready: `records/hooks.ts`), AI drafting of a type, `/api/v1` routes
  for records, the reportable-field index, notification rules for `record.*` events (U7–U10).
- No Playwright e2e spec for the record screens (the second wave owns e2e); the screens were looked at through
  the screenshot script only.
- Child lines are not imported, and are not searched, filtered or sorted in the list.
- In an import, a link field takes the typed text; whether it becomes a real link depends on package B's
  `forms/links.ts` stage (a stub in this checkout). The same holds for `unique` / `learn`: tested here only as
  "saving does not break".
- A date-time field is filtered by its UTC day (the list's own "made on" range uses the company's days exactly).
- Record types are not in the Home search / Ctrl+K palette, and the Home "Suggested for you" list.
- `seed:demo` has no demo record type (the screenshots made "Sites" and "Site visits" through the API).
- The drawer's close button is the shared `Sheet` one (36 px), not changed here.
- Hindi strings are machine-drafted (decision 14) and need GGM's review.
