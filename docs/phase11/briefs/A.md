# Package A — Lists (rows L1–L5, plan §2.1)

Plug into: `packages/shared/src/fms/definition.ts` (`learn`, `list`, `writeAllowed`), `packages/shared/src/fms/links.ts`
(`listKeyOf`), `apps/api/src/modules/forms/index.ts` (the `FormStage` pipeline), your stubs `forms/learn.ts`,
`masters/sources/list.ts`, `apps/web/src/modules/fms/form/LearnInput.tsx`, `fms/field-extras/LearnExtras.tsx`.

Build:
- **Model** `ValueList` in new `prisma/schema/lists.prisma` (company, key, value, uses, lastUsedAt, createdById,
  hidden, timestamps); values unique per (company, key) ignoring case. One migration `phase11_lists`. Add the
  model to `packages/db/src/scope.ts`.
- **Stage** `forms/learn.ts`, for every `learn: true` field with a value. `check`: when `writeAllowed === false`,
  the list already has visible values, the value is not one of them and `scope.canAddValues` is not true → error
  on that field. `commit`: add the value or count one more use. Public-form values (`scope.publicForm`) are never
  added. The key is `listKeyOf(scope.owner, field)`.
- **Source** `masters/sources/list.ts`: `list:<listKey>` → visible values, most used first, filtered by `q`
  (a field's own list is `list:flow:<flowId>:<fieldKey>`, a named one `list:list:<name>`). Own company only.
- **Admin API** in new `apps/api/src/modules/lists/` (routes + service; register in `apps/api/src/app.ts`): all
  lists with counts and where they are used; a list's values; add, rename, merge (A into B: uses added, A gone),
  hide / unhide. Needs `core.edit`. Every change writes audit + a domain event (see `recordChange` in
  `masters/rows.ts`). Rename and merge **never rewrite old records** — they only change what is offered.
- **Input** `fms/form/LearnInput.tsx`: combobox of the values already entered (most used first, all typed words
  must match — decision 47), last option always **"Write…"** which turns it into a text box; the new value is
  saved with the record and offered next time. With `writeAllowed === false` and a non-empty list, "Write…" shows
  only to people who may add (ask the server; do not guess in the browser). No `owner` → plain input. Works at
  380 px, touch targets ≥ 44 px.
- **Editor block** `fms/field-extras/LearnExtras.tsx` (text fields only): "Remember what people type"; when on:
  share the list with other forms (pick a named list or type a new name → `list`) and "Only admins add new
  values" (`writeAllowed: false`).
- **Screen** Masters → **Lists** (`apps/web/src/modules/lists/`, route `/masters/lists`, entry in the MASTERS
  section of `layout/nav.ts`, route in `app/router.tsx`): lists (cards on a phone), values with use counts,
  search, add, rename, merge, hide / unhide; empty, loading and error states.
- Strings: `apps/web/src/locales/parts/lists.en.json` / `lists.hi.json`.

Tests — `apps/api/src/modules/lists/lists.test.ts` (style of `masters/masters.test.ts`, `fms/fms.test.ts`):
L1 most used first + filter; L2 a typed value is offered by the next record; L3 one named list fed and offered
by fields in two flows; L4 rename / merge / hide change what is offered and leave an old record's stored value
untouched; L5 a closed list refuses a member's new value and accepts an admin's; company scoping; permission.
