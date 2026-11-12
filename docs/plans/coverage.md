# Coverage checklist — the rows that define "done"

From `docs/plans/hospitality-100-plan.md` §13. A row is green when an automated test (unit or e2e) proves it.
The "Test" column names the test once it exists. Rows for Phases 12–21 are in `coverage-later.md`; they are
reviewed with GGM / the hotel team and frozen before each phase starts.

## Phase 11 — Linked fields, record types, reports (29 rows)

| Row | Workflow | Plan | Test |
|---|---|---|---|
| L1 | A text field set to "remember what people type" shows as a dropdown of the values already entered, most used first, filtered as you type | §2.1 | `apps/api/src/modules/lists/lists.test.ts` |
| L2 | The last option is always "Write…"; a new value is saved and the next record offers it | §2.1 | `apps/api/src/modules/lists/lists.test.ts`, `lists.masters.test.ts`, `apps/web/src/modules/lists/offer.test.ts` |
| L3 | A named shared list is offered by fields in two different processes | §2.1 | `apps/api/src/modules/lists/lists.test.ts`, `lists.masters.test.ts` |
| L4 | Masters → Lists: an admin renames, merges and hides values; old records keep what they said | §2.1 | `apps/api/src/modules/lists/lists.test.ts`, `lists.masters.test.ts` |
| L5 | "Only admins add" turns the field into a strict dropdown once the list has values | §2.1 | `apps/api/src/modules/lists/lists.test.ts`, `apps/web/src/modules/lists/offer.test.ts` |
| L6 | A dropdown offers the values typed in a field of another process (`fms:<flow>:<field>`) | §2.2 | `apps/api/src/modules/forms/links.test.ts` |
| L7 | A field picks a whole record of another process, shown as `#12 · Sharma wedding · 14/12/2026` (`rec:<flow>`) | §2.2 | `apps/api/src/modules/forms/links.test.ts` |
| L8 | Record choices can be limited: only at step X, only running, only started by me, only within N days | §2.2 | `apps/api/src/modules/forms/links.test.ts` |
| L9 | A picked value keeps a link to its row: renaming the row does not break it; values saved before stay readable | §2.2 | `apps/api/src/modules/forms/links.test.ts` (API; the screen has no e2e yet) |
| L10 | A "unique" field refuses a value already used in another live record; cancelling that record frees it | §2.2 | `apps/api/src/modules/forms/links-rules.test.ts` |
| L11 | Auto-fill: picking an item fills unit and rate, picking a record fills its fields; filled fields stay editable unless locked | §2.3 | `apps/api/src/modules/forms/links-rules.test.ts`, `apps/web/src/modules/fms/form/depend.test.ts` |
| L12 | Dependent choices: pick an Outlet → only its Tables are offered | §2.3 | `apps/api/src/modules/forms/links-rules.test.ts`, `apps/web/src/modules/fms/form/depend.test.ts` |
| L13 | Formula fields: `qty × rate`, nights between two dates, the sum of item lines, a percentage — worked out on the server by a safe expression language (never `eval`) | §2.3 | `apps/api/src/modules/forms/formula.test.ts`, `apps/web/src/modules/fms/formula/formula.test.ts`, `packages/shared/src/formula/` |
| L14 | Item lines pick from the item master (code or name) with unit, rate and live stock; typed items only where the form allows | §2.4 | `apps/api/src/modules/ims/step-stock.test.ts` |
| L15 | Any step can issue, receive or transfer stock, from / to a fixed location or one taken from a field, with a preview before "Mark done" | §2.4 | `apps/api/src/modules/ims/step-stock.test.ts` |
| L16 | Not enough stock: the step is blocked, or (by setting) allowed and flagged for the store keeper's approval | §2.4 | `apps/api/src/modules/ims/step-stock-reversal.test.ts` |
| L17 | Sending a record back past a stock step, or cancelling the record, reverses its stock with new moves | §2.4 | `apps/api/src/modules/ims/step-stock-reversal.test.ts`, `packages/shared/src/ims/ims.test.ts` |
| L18 | Linked, list and formula values show as columns in Live FMS, in documents (`{{field.column}}`), in KPI cards and in notification templates | §2.5 | `apps/api/src/modules/fms/show.test.ts` (Live FMS columns, KPI cards, document texts, message values), `apps/worker/src/notify/fms-values.test.ts` (a sent message), `packages/shared/src/fms/paths.test.ts` |
| U1 | A record type is made from screens alone: fields, its own number series `{PREFIX}/{FY}/{0001}` | §2.6 | `apps/api/src/modules/records/records.test.ts`, `packages/shared/src/records/records.test.ts` (API; the editor screen has no e2e yet) |
| U2 | A record type has statuses with allowed moves and who may make each one, run through the shared `transition()` | §2.6 | `apps/api/src/modules/records/records.test.ts`, `packages/shared/src/records/records.test.ts` |
| U3 | A record links to records of other types, and holds child lines (a table inside the record) | §2.6 | `apps/api/src/modules/records/records-links.test.ts` |
| U4 | Each record type has its own list screen (columns, filters, saved views; cards on phones) and a drawer with Notes, History and attachments | §2.6 | `apps/api/src/modules/records/records-list.test.ts` (API; the list screen and drawer have no e2e yet) |
| U5 | Records import and export; the admin places the record type in the left menu | §2.6 | `apps/api/src/modules/records/records-io.test.ts` |
| U6 | Permissions per record type (view / create / edit / approve) are enforced by the API | §2.6 | `apps/api/src/modules/records/records-access.test.ts` |
| U7 | A status change can start a process; records can be picked in any form; changes raise events for notification rules, the public API and webhooks | §2.6 | `apps/api/src/modules/records/records-reach.test.ts` (a move starts a process, the public API, the webhook), `apps/api/src/modules/records/records-links.test.ts` (picked in forms), `apps/worker/src/notify/records.test.ts` (notification rules) |
| U8 | A record type is drafted by AI from a description; nothing is saved until a person accepts | §2.6 | `apps/api/src/modules/ai/records.test.ts` (scripted model; not yet tried against a live AI key) |
| U9 | A field marked reportable keeps a typed, indexed copy; existing records are back-filled by the worker | §2.7 | `apps/api/src/modules/reports/reportable.test.ts` |
| U10 | Report builder: source → columns → filters → group → totals → table or chart; save, share by role, schedule, export; Ask can read it | §2.7 | `apps/api/src/modules/reports/reports.test.ts` (build, filter, group, totals, share by role, export, schedule, Ask). Screens looked at in a browser at 380 and 1440 (no e2e yet) |
| A1 | The request ceiling is counted per signed-in person; many people behind one internet address are not refused | §1.2 | `apps/api/src/plugins/ceiling.test.ts` |

State on 12/11/2026: all 29 rows are built and each has a passing automated test at unit / API level (the "Test"
column). On top of that, every row except A1 (not a screen) is driven through the real screens by Playwright, on a
phone (380 px) and a desktop (1440 px): `e2e/phase11-forms.spec.ts` (L1–L4, L6–L13), `e2e/phase11-stock.spec.ts`
(L5, L14–L17, U6), `e2e/phase11-records.spec.ts` (U1–U5, U7, U8 with the model's answer stood in),
`e2e/phase11-reports.spec.ts` (L18, U9, U10, and a fit-the-screen pass of the new screens in English and Hindi with
no browser date pickers). 22 of 22 pass. Screenshots: `docs/screenshots/phase11/`. The older suite still passes on
the merged code (58 passed, 21 skipped by design; the one email check needs Mailpit, the development mail catcher).

Consume-by-recipe on a step (plan §2.4) needs recipes, which arrive in Phase 13; it is row I-recipe there, not here.

## Phase 12 — Branches, legal entities, countries and franchises (45 rows)

Written 12/11/2026 from plan §3 and the answers to decisions 9–14. Stages: A branch as a dimension · B legal entities
· C countries · D franchises (plan §3.12). A row is green when the test named in "Test" passes.

| Row | Stage | Workflow | Plan | Test |
|---|---|---|---|---|
| G1 | A | Structure: group → legal entity → region (any depth) → branch (outlet / central kitchen / store / office / hotel) → location, set up from System Master → Branches | §3.1 | `apps/api/src/modules/branches/branches.test.ts` (API; the set-up screen is not built yet); screens: `e2e/phase12-branches.spec.ts` (380 and 1440) |
| G2 | A | A branch has one or more branch managers; a region has area managers; one person may manage any set of branches | §3.2 | `apps/api/src/modules/branches/branches.test.ts` |
| G3 | A | A role has a reach (own records / my branches / my entity / whole group); a person's branches = home + managed + worked at | §3.3 | `apps/api/src/modules/branches/branches.test.ts`, `packages/db/src/reach.test.ts` |
| G4 | A | Reach is enforced in the database layer for every branch-bearing model; a test fails when such a model is missing from the list | §3.3 | `packages/db/src/reach.test.ts` |
| G5 | A | An area manager over 4 outlets sees only those in lists, counts, search, exports and Ask | §3.3 | tasks (`apps/api/src/modules/branches/branches.test.ts`); process records, record lists and counts, opening by id, reports, Ask (`apps/api/src/modules/branches/branches-work.test.ts`). Search finds people and departments only (not branch-bound). Still to check one by one: the remaining module lists and exports (they read through the same fenced client) |
| G6 | A | An API key and a webhook carry their maker's reach | §3.3 | `apps/api/src/modules/branches/branches-work.test.ts` (a scheduled report also runs with its maker's reach — code only, no test yet) |
| G7 | A | Branch switcher in the top bar ("All my branches" or one) for people with more than one branch | §3.3 | `apps/api/src/modules/branches/branches.test.ts` (the rule); the top-bar switcher: `e2e/phase12-branches.spec.ts` (380 and 1440) |
| G8 | A | A branch manager adds and manages only their branch's people; group settings stay with owner / group admins | §3.3 | |
| G9 | A | Approval routing is a setting the owner controls: an ordered chain per module and request type, with overrides per entity or branch; each step can skip if empty, skip the requester, or go up after N hours | §3.2, decision 14 | `apps/api/src/modules/branches/approvals.test.ts` (API and rules; the set-up screen is still to build). One decision decides; "from this amount" starts the request at that step; the owner can always decide; screen (System Master → Branches → Who approves): `e2e/phase12-branches.spec.ts` (380 and 1440) |
| G10 | A | Leave, corrections, stock adjustments, slips and ticket escalation follow the configured chain | §3.2 | `apps/api/src/modules/branches/approvals.test.ts` (leave, stock adjustment, slip, ticket escalation by test; corrections share the leave code path and have no test of their own yet) |
| G11 | A | New notification recipients: branch manager, area manager, branch HR, department head at this branch | §3.2 | `apps/worker/src/notify/places.test.ts` |
| G12 | A | The head of a department can be set per branch or group-wide | §3.2 | `apps/worker/src/notify/places.test.ts` (per-branch head, else the group-wide head); set through `PUT /api/branches/department-heads` (screen still to build) |
| G13 | A | Every task, checklist run, slip, ticket, process record, document, PO and CRM order carries a branch (the starter's, or a field) | §3.10 | `apps/api/src/modules/branches/branches-work.test.ts` (process record, document, ticket, slip, record, imported record, checklist run, PO, CRM order); task (`branches.test.ts`). "Or a field" on a start form is not built yet |
| G14 | A | Process step doers are picked inside the record's branch first, then the fallback (region, group) — never silently someone at another outlet | §3.10 | |
| G15 | A | One checklist template makes a run per branch, done by that branch's people at that branch's due time | §3.10 | |
| G16 | A | Flow designer people (EA, slip receiver / approver, ticket coordinator) can be set per branch | §3.10 | |
| G17 | A | Live FMS, My steps, Delegation, Checklists, Weekly MIS and reports filter by branch / region / entity / group | §3.10, §3.11 | |
| G18 | A | Outlet comparison and ranking (attendance, checklist misses, ticket times, on-time work) | §3.11 | |
| G19 | A | System Master header cards and the health check per branch | §3.11 | |
| G20 | A | Open an outlet by copying another (checklists, routing, people roles); close an outlet safely (move people, finish or move open work, archive) | §3.11 | |
| G21 | A | Master rows and record-type records can belong to a branch / entity or be group-wide | §3.11 | |
| G22 | B | A legal entity per GSTIN / foreign registration with address, letterhead and licences (FSSAI …); branches belong to an entity | §3.1, §3.9 | |
| G23 | B | Number series by entity / branch / document type / FY (one invoice series per GSTIN per FY); existing company-wide series continue unchanged | §3.9 | |
| G24 | B | Letterhead, address, GSTIN / TRN and licence numbers of the right entity and branch on every document | §3.9 | |
| G25 | B | Branch history with dates: a move takes effect from a date; attendance, cover and pay use the branch on each day | §3.4 | |
| G26 | B | A person moved mid-month is paid correctly by both branches (days and cost split) | §3.4 | |
| G27 | B | Allowed branches for punching (floating staff, managers); a branch may have several geofences | §3.4 | |
| G28 | B | Borrowing staff: lend a person to another branch for dates; they show on its cover board and work lists and their cost moves with them | §3.4 | |
| G29 | B | Buddy cover can be limited to the same branch or allowed across branches | §3.4 | |
| G30 | B | HR people per branch / entity; HR rule overrides by entity and branch | §3.5 | |
| G31 | B | Pay rules per entity as data (state minimum wages, weekly-off rules); payroll runs and closes per entity | §3.5 | |
| G32 | B | Holidays per country, state and branch; leave types and quotas per entity | §3.5 | |
| G33 | B | Cover board, attendance, the morning report and absence alerts are per branch, to that branch's managers and HR | §3.5 | |
| G34 | C | Each entity has a currency: money is minor units + currency code; Indian entities keep ₹ and lakh / crore | §3.7, decision 10 | |
| G35 | C | Each entity has a tax regime as a profile the accountant fills (GST, VAT, none); documents use the entity's legal and number formats | §3.7 | |
| G36 | C | Each branch has a time zone: due times, shifts, attendance and reminders follow the branch's clock | §3.7 | |
| G37 | C | Group reports convert to INR with one exchange rate per currency per month, typed by an accountant | §3.7, decision 11 | |
| G38 | C | Payroll closes per entity in its own currency | §3.5, §3.7 | |
| G39 | D | A franchise is an entity with hard isolation: its people never reach beyond it; group people see it only with the "franchise oversight" right | §3.8, decision 9 | |
| G40 | D | Brand content is shared read-only with franchises: checklists and SOPs, masters, training material | §3.8 | |
| G41 | D | Royalty and fees: % of sales or fixed, invoiced monthly, with a minimum guarantee | §3.8 | |
| G42 | D | Brand audits: head-office auditors run audit checklists at franchise outlets (score, photos, corrective tasks) | §3.8 | |
| G43 | D | Franchise agreement, licences and renewal dates with reminders | §3.8 | |
| G44 | D | Exit: export everything of one entity (data and files) as a package, then archive it | §3.8 | |
| G45 | 13 | Stock per location, supply routes, indents, in-transit, emergency transfers, production, transfer price and inter-GSTIN invoices are designed in Phase 12 and built and proven in Phase 13 (rows I-…) | §3.6 | |
