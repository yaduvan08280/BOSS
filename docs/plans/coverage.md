# Coverage checklist — the rows that define "done"

From `docs/plans/hospitality-100-plan.md` §13. A row is green when an automated test (unit or e2e) proves it.
The "Test" column names the test once it exists. Rows for Phases 12–21 are in `coverage-later.md`; they are
reviewed with GGM / the hotel team and frozen before each phase starts.

## Phase 11 — Linked fields, record types, reports (29 rows)

| Row | Workflow | Plan | Test |
|---|---|---|---|
| L1 | A text field set to "remember what people type" shows as a dropdown of the values already entered, most used first, filtered as you type | §2.1 | |
| L2 | The last option is always "Write…"; a new value is saved and the next record offers it | §2.1 | |
| L3 | A named shared list is offered by fields in two different processes | §2.1 | |
| L4 | Masters → Lists: an admin renames, merges and hides values; old records keep what they said | §2.1 | |
| L5 | "Only admins add" turns the field into a strict dropdown once the list has values | §2.1 | |
| L6 | A dropdown offers the values typed in a field of another process (`fms:<flow>:<field>`) | §2.2 | |
| L7 | A field picks a whole record of another process, shown as `#12 · Sharma wedding · 14/12/2026` (`rec:<flow>`) | §2.2 | |
| L8 | Record choices can be limited: only at step X, only running, only started by me, only within N days | §2.2 | |
| L9 | A picked value keeps a link to its row: renaming the row does not break it; values saved before stay readable | §2.2 | |
| L10 | A "unique" field refuses a value already used in another live record; cancelling that record frees it | §2.2 | |
| L11 | Auto-fill: picking an item fills unit and rate, picking a record fills its fields; filled fields stay editable unless locked | §2.3 | |
| L12 | Dependent choices: pick an Outlet → only its Tables are offered | §2.3 | |
| L13 | Formula fields: `qty × rate`, nights between two dates, the sum of item lines, a percentage — worked out on the server by a safe expression language (never `eval`) | §2.3 | |
| L14 | Item lines pick from the item master (code or name) with unit, rate and live stock; typed items only where the form allows | §2.4 | |
| L15 | Any step can issue, receive or transfer stock, from / to a fixed location or one taken from a field, with a preview before "Mark done" | §2.4 | |
| L16 | Not enough stock: the step is blocked, or (by setting) allowed and flagged for the store keeper's approval | §2.4 | |
| L17 | Sending a record back past a stock step, or cancelling the record, reverses its stock with new moves | §2.4 | |
| L18 | Linked, list and formula values show as columns in Live FMS, in documents (`{{field.column}}`), in KPI cards and in notification templates | §2.5 | |
| U1 | A record type is made from screens alone: fields, its own number series `{PREFIX}/{FY}/{0001}` | §2.6 | |
| U2 | A record type has statuses with allowed moves and who may make each one, run through the shared `transition()` | §2.6 | |
| U3 | A record links to records of other types, and holds child lines (a table inside the record) | §2.6 | |
| U4 | Each record type has its own list screen (columns, filters, saved views; cards on phones) and a drawer with Notes, History and attachments | §2.6 | |
| U5 | Records import and export; the admin places the record type in the left menu | §2.6 | |
| U6 | Permissions per record type (view / create / edit / approve) are enforced by the API | §2.6 | |
| U7 | A status change can start a process; records can be picked in any form; changes raise events for notification rules, the public API and webhooks | §2.6 | |
| U8 | A record type is drafted by AI from a description; nothing is saved until a person accepts | §2.6 | |
| U9 | A field marked reportable keeps a typed, indexed copy; existing records are back-filled by the worker | §2.7 | |
| U10 | Report builder: source → columns → filters → group → totals → table or chart; save, share by role, schedule, export; Ask can read it | §2.7 | |
| A1 | The request ceiling is counted per signed-in person; many people behind one internet address are not refused | §1.2 | |

Consume-by-recipe on a step (plan §2.4) needs recipes, which arrive in Phase 13; it is row I-recipe there, not here.
