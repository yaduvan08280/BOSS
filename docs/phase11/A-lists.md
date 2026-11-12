# Phase 11 — Package A: value lists (rows L1–L5, plan §2.1)

A text field can be set to **remember what people type**. It then shows as a dropdown of the values already
entered (most used first, filtered as you type) whose last choice is always **Write…**. Lists live in the new
`ValueList` table; an admin looks after them in **Masters → Lists**.

## What was built

| Part | Where |
|---|---|
| Model `ValueList` + migration `20261112033701_phase11_lists` | `prisma/schema/lists.prisma` |
| Form stage (closed lists refuse, saved values are counted) | `apps/api/src/modules/forms/learn.ts` |
| Choice source `list:<listKey>` | `apps/api/src/modules/masters/sources/list.ts` |
| Reading / counting values (one SQL upsert) | `apps/api/src/modules/lists/values.ts` |
| Which forms use which list | `apps/api/src/modules/lists/usage.ts` |
| Admin API + what a form asks | `apps/api/src/modules/lists/{routes,service}.ts` |
| Form input (combobox + "Write…") | `apps/web/src/modules/fms/form/LearnInput.tsx` |
| Editor block | `apps/web/src/modules/fms/field-extras/LearnExtras.tsx` |
| Masters → Lists screen (`/masters/lists`) | `apps/web/src/modules/lists/{ListsPage,ValuesPanel,ValueDialogs}.tsx`, `api.ts`, `offer.ts` |
| Strings (English + Hindi) | `apps/web/src/locales/parts/lists.{en,hi}.json` |

### API

| Route | Who | What |
|---|---|---|
| `GET /api/lists/offer?key=&q=` | signed in | `{ values: [{ value, uses }], total, canAdd }` — what a field offers, whether the list has values at all, and whether this person may add to a closed list |
| `GET /api/lists/names` | signed in | the named shared lists (for the form editor) |
| `GET /api/lists` | `core.edit` | every list: counts, hidden count, uses, the forms that use it, closed or not |
| `GET /api/lists/values?key=&q=` | `core.edit` | a list's values, hidden ones too |
| `POST /api/lists/values` `{ key, value }` | `core.edit` | add a value (0 uses) |
| `PATCH /api/lists/values/:id` `{ value?, hidden? }` | `core.edit` | rename, hide / show again |
| `POST /api/lists/values/:id/merge` `{ into }` | `core.edit` | A into B: B gets A's uses, A leaves the list |
| `GET /api/masters/options?source=list:<listKey>` | signed in | the same values as `MasterOption`s (`list:flow:<flowId>:<field>`, `list:list:<name>`) |

List keys are what `listKeyOf` gives: `flow:<flowId>:<field>`, `master:<id>:<field>`, `recordType:<id>:<field>`,
or `list:<name>` for a named shared list.

Domain events (each with an audit row, entity type `value_list`): `list.value_added` (payload `via: 'form' | 'admin'`),
`list.value_renamed`, `list.value_hidden`, `list.value_shown`, `list.values_merged`.

## Decisions taken

1. **One live row per value, whatever the capitals.** `ValueList.norm` is the value in lower case with single
   spaces; `(company, key, norm)` is unique. A form saved with "rooftop" when the list says "Rooftop" stores
   "Rooftop" (the list's spelling) and counts one more use, so one value stays one value.
2. **A new value and one more use are one SQL statement** (`INSERT … ON CONFLICT … DO UPDATE`), so several
   forms saved at the same moment with the same new value end up with one row and the right count. Only a
   *new* value writes an audit row and a `list.value_added` event; one more use of a known value is only counted
   (a domain event per form field per save would flood the outbox).
3. **Merge keeps history.** The merged-away value is soft-deleted (`deletedAt`, `norm` set to null), its uses are
   added to the kept one, and its text is free to be typed again as a new value. Rename, merge and hide never
   touch stored records.
4. **Hidden values are not on the list.** They are not offered; on a closed list a member cannot use one; on an
   open list typing one is accepted and counted but it stays hidden until an admin shows it again.
5. **Who may add to a closed list** ("Only admins add new values"): people with `core.edit` or `fms.admin`
   (`mayAddValues`). The brief said "when `scope.canAddValues` is not true → error". The start form's scope does
   not set `canAddValues` (that call is in `fms/engine.ts`, not this package's file), which would have refused an
   admin at the start form. So the stage accepts `scope.canAddValues === true` *or*, failing that, looks up the
   actor's role. Master rows pass `canAddValues: true` (saving a row already needs `core.edit`).
6. **A closed list is closed only once it has visible values** — until then there is nothing to pick, so the
   first value can be typed by anyone.
7. **The public form neither reads nor feeds a list**: it shows a plain text box (already so in `FieldsForm`),
   the stage skips `scope.publicForm`, and what a stranger types stays on that record only.
8. **The browser never guesses who may write.** `LearnInput` asks `GET /api/lists/offer`; for a closed list
   "Write…" shows only when the answer says the list is empty or `canAdd` is true. While the answer is not there
   yet, a closed list offers no "Write…".
9. **Typing does not save by itself.** Text typed into the dropdown only filters. To keep a new text the person
   picks the last row ("Write "…""), which turns the field into a text box holding that text. This keeps
   half-typed filters ("roo") out of the lists. An empty list starts as the text box straight away.
10. **The dropdown is a portaled popover** (like the shared `Select`), so a dialog's scroll area never cuts it
    off; "Write…" sits below the scrolling values and is always in sight. Rows are 44 px high.
11. **Shared list names are keys** (`venues`, `room_types` — the field setting `list` is a key). The editor turns
    what the admin types into one (`listSlug`) and shows it back as "Room types" (`listTitle`). Hindi-only names
    give no key; the box then leaves the field on its own list.
12. **Menu label without touching `en.json` / `hi.json`.** The menu reads `nav.<key>` / `navDesc.<key>`, which are
    existing sections a feature file may not replace. `lists.{en,hi}.json` therefore carry the two labels as flat
    keys (`"nav.valueLists"`, `"navDesc.valueLists"`); i18next resolves a flat key when the nested path is missing
    (`ignoreJSONStructure`, on by default). Checked in the browser in both languages. If the lead prefers, move
    the two strings into `nav` / `navDesc` of the main files and delete the flat keys.
13. **Masters → Lists is shown to `core.edit` only** (`NavItem.permission`); the API refuses everyone else (403)
    and the page shows "Only admins manage lists" if opened by link.
14. `/api/lists` shows a list as soon as a form asks for it (draft or published), before anyone typed in it, so an
    admin can fill a closed list first.

## Shared files touched (one or two lines each, nothing else changed)

- `apps/api/src/app.ts` — import + `app.register(listRoutes)`.
- `packages/db/src/scope.ts` — `ValueList` in `COMPANY_SCOPED_MODELS` and `SOFT_DELETE_MODELS`.
- `apps/web/src/layout/nav.ts` — the `valueLists` item in MASTERS.
- `apps/web/src/app/router.tsx` — lazy `ListsPage` + the `/masters/lists` route.
- `apps/web/src/modules/masters/MasterRowsPage.tsx` — `owner={{ kind: 'master', id: data.master.id }}` on the
  row dialog's `FieldsForm` (no package owns this file; without the line a master's remembered field stays a
  plain text box).

## Tests

- `apps/api/src/modules/lists/lists.test.ts` — L1, L2, L3, L4, L5, company scoping + permissions (6 tests).
- `apps/api/src/modules/lists/lists.masters.test.ts` — L3 (a master and a process share one list), L2 (six forms
  saved at once → one value, six uses), L4 (a merge racing a use loses nothing; another list's value is refused).
- `apps/web/src/modules/lists/offer.test.ts` — L2 ("Write…" is always the last row), L5 (who sees "Write…"),
  L3 (shared list names become valid keys).

## Looked at in a browser (Chromium, 380 px and 1440 px)

Form editor block, the start form with the dropdown open / filtered / "Write "…"" / text box, a closed list as an
admin and as a member (pick only, "Only admins add new values to this list."), keyboard (type + Enter),
Masters → Lists (lists, values, rename, merge, hide / show), Hindi + dark mode. No sideways scroll, no console
errors.

For the start form this was done with a **temporary, uncommitted** line in `StartDialog.tsx`
(`owner={{ kind: 'flow', id: flowId }}`), because that file belongs to package B.

## Left open

- **`StartDialog.tsx` / `StepDialog.tsx` must pass `owner`** (package B). Until they do, a remembered field in a
  process form is a plain text box in the browser (`LearnInput` without an owner); the server side already
  learns, offers and enforces closed lists. `StepDialog` needs `owner={{ kind: 'flow', id: <flowId> }}` too.
- **`FieldsEditor` callers do not pass `owner`** (`FlowEditor`, `StepEditor`); `LearnExtras` does not need it.
- **Record types (package E)**: `usage.ts` (`listsInForms`) reads processes and masters only. When record types
  exist, add their fields there so Masters → Lists shows "used in" for them (keys `recordType:<id>:<field>` are
  already accepted everywhere else).
- **Webhook picker**: `list.*` events are emitted and reach webhooks subscribed to `*` or `list.*`, but they are
  not in `DATA_EVENTS` (`packages/shared/src/platform/events.ts`), so the webhook screen does not list them.
- No Playwright e2e spec (second wave) and no screenshots committed.
- A list is limited to what the screen loads: the admin screen reads up to 1000 values of a list, a form 50
  matches per search.
