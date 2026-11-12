# Package E — Custom record types (rows U1–U6, plan §2.6 and §1.1)

The largest package: what lets any industry add its own things (a prescription, a site visit, a trip, a project)
without code. CLAUDE.md §2, §3, §8 and decisions 8, 46, 47, 54, 71, 91 bind you. Patterns to copy: masters
(`prisma/schema/ai.prisma`, `apps/api/src/modules/masters/rows.ts`, `apps/web/src/modules/masters/MasterRowsPage.tsx`,
`modules/ai/MastersPage.tsx`); `packages/shared/src/machines/transition.ts` + one machine; `packages/db/src/counters.ts`
and `fms/documents.ts` (numbering); `apps/api/src/modules/forms/index.ts` (every form you save goes through it
with `owner: { kind: 'recordType', id }`; deletes call `releaseForm`); `masters/options.ts` + your stub
`masters/sources/record-type.ts`; `permissions.ts`, `events.ts`, `platform/events.ts`, `lib/events.ts`
(`recordChange`); web `fms/FieldsForm.tsx`, `fms/FieldsEditor.tsx` (reuse both), `components/*`, `layout/nav.ts`,
`layout/Sidebar.tsx`, `app/router.tsx`, and a finished module with tabs, table → cards and a drawer with Notes /
History (`modules/tickets` or `modules/delegation`).

Build — data and shared:
- `prisma/schema/records.prisma`, migration `phase11_records`, models in `packages/db/src/scope.ts`: record type
  (name, plural, code, number prefix, definition JSON, menu place, permissions, active / archived, soft delete),
  record (type, number, code, title, status, data JSON, child lines JSON, created by, timestamps, soft delete),
  record events (history and notes), saved views (mine / shared). Indexed for lists. Company-scoped.
- `packages/shared/src/records/` (exported from the shared index): zod schema of a definition + helpers.
  Fields = the FMS `fieldSchema` (so lists, links, formulas, unique work in records for free). **Child lines**:
  `tables: [{ key, label, fields }]`. **Links**: a `master` field with source `rt:<recordTypeId>` (one), or a
  child table with such a column (many); implement the `rt:` source (label = code and title, `ref` =
  `rt:<recordId>`, `columns` = data + `status`), respecting the caller's permission on that type.
  **Statuses**: `statuses: [{ key, label, kind }]` (`kind` = a fixed status colour from
  `packages/shared/src/theme/status.ts`; never colour alone), one start status, final statuses;
  `moves: [{ from, action, label, to, who }]`. Build a transition table and run every status change through the
  shared `transition()` — never set `status` directly. Definition validation with messages a non-programmer can
  act on (unique keys, moves point at real statuses, a start status, every status reachable).

Build — API (`apps/api/src/modules/records/`, registered in `app.ts`):
- Types: list, create, read, update, archive — needs a new `records.admin` permission (add a `records` module to
  `permissions.ts` following the pattern; sensible defaults for built-in roles). No destructive change to a type
  that has records (a field's key / type, a status in use) — say why.
- **Permissions per record type** (U6): view / create / edit / approve granted to roles (and "everyone"), stored
  on the type, enforced in the service on every route incl. the `rt:` source, lists, exports, attachments.
- Records: create (number from `Counter`, code `{PREFIX}/{FY}/{0001}`, never reused), read, update fields and
  child lines, change status (a move + optional note), add a note, soft delete, attachments
  (`entityType: 'record'`). Every mutation: audit + domain event via `recordChange` (`record.created`,
  `record.changed`, `record.status_changed`, `record.note`, `record.deleted`, in the shared event catalog as
  master rows did in phase 10, so webhooks carry them).
- **List** (U4): server-side search, status filter, date range, filter by any field's value, sort, paging; chosen
  columns; saved views. JSON-field filtering may be simple for now but correct, company-scoped, no SQL built from
  user text.
- **Import / export** (U5): import a table (all or nothing, problems by line, like masters); export the current
  list as CSV and Excel the way other modules export.
- **Left menu** (U5): each type says where it shows (section name + an icon from a fixed lucide set, or hidden);
  an endpoint returns the entries the signed-in person may see.

Build — web (`apps/web/src/modules/records/`, routes in `router.tsx`, strings in `locales/parts/records.*`):
- **Record types** (`/records/types`, reached from Masters, admin only): cards; editor with tabs Details · Fields
  (`FieldsEditor` with `owner`) · Lines · Statuses & moves · Permissions, validation messages, "ready to use".
- **A type's own list** (`/records/:typeId`): "+ New {name}", search, status chips with counts, filters, column
  chooser, saved views, table → cards under 768 px, skeleton / empty / error states, export, import.
- **Record drawer**: code in the mono font, title, status chip with icon; fields (`FieldsForm`); child lines (a
  card per row on phones); buttons for the moves this person may make (with a note); tabs Notes · History · Files.
- **Left menu**: keep `nav.ts` static; add the dynamic entries where the sidebar and the phone drawer render.
- 380 px throughout: bottom sheets, ≥ 44 px targets, `DateInput` / `TimeInput`, shared `Select`, DD/MM/YYYY.
- Take screenshots of every new screen at 380 px and 1440 px, light and dark, into `docs/screenshots/phase11/`
  and look at them before calling the screens done.

Leave ready, do not build (second wave): starting an FMS flow on a status change (a clear hook in the
status-change service), AI drafting of a type, `/api/v1` routes, the reportable-field index.

Tests: `packages/shared/src/records/records.test.ts` (validation, machine builder) and
`apps/api/src/modules/records/records.test.ts`: U1 a "Site visit" type made through the API alone, records
`SV/26-27/0001`, `…0002`; U2 allowed / refused moves, who may make them, history; U3 a link to another type's
record (and to a customer), child lines validated and saved; U4 search / status / field filter / sort / paging,
a saved view; U5 import all-or-nothing with problems by line, export, menu entries; U6 the four permissions on
every route; company scoping. Also: a `unique` field and a "remember what people type" field on a record type do
not break saving (their stages may still be stubs in your checkout).
