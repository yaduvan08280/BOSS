# Package H — Record types reach the rest of MONO (rows U7, U8, plan §2.6)

**U7:** a status change can start a process; records can be picked in any form; changes raise events for
notification rules, the public API and webhooks.
**U8:** a record type is drafted by AI from a description; nothing is saved until a person accepts.

## What exists (package E, merged — read `docs/phase11/E-records.md`)
Record types with fields, child tables, statuses and moves; `records/hooks.ts` (`statusHooks`, run inside the
status-change transaction, nothing registered); `record.*` domain events in the shared data-event catalog (so
webhooks subscribed to them get deliveries); the `rt:<typeId>` choice source works in every form (joined after
the merge: options, link names, columns, the editor's source picker). The AI layer: `apps/api/src/modules/ai/`
(`masters.ts` + `prompts/master.v1.ts` is the closest pattern; decisions 58–59).

## Build
1. **A move starts a process.** In the type editor (Statuses & moves) a move may have "Start a process": pick a
   published flow, and map the flow's start-form fields from the record (a record field, the record's number /
   title, or a fixed text; a `master` start field whose source is `rt:<this type>` gets the record itself as a
   link). When the move happens, `startRecord` runs **in the same transaction** through a registered status hook:
   if the start form refuses (a required field unmapped / empty), the move is refused with that message. The
   record's history gets a line with a link to the started process record, the FMS record keeps a link back
   (`_refs` on the mapped field, or the record's code in its title), and the drawer shows "Started: {flow} #n".
   Validation on saving the type: the flow exists, is published, required start fields are mapped. A flow that
   is later archived makes the move refuse with a clear message (not a 500).
2. **Notification rules for records.** `record.created`, `record.status_changed`, `record.note` become events a
   notification rule can use (module "Records"): recipients Creator / a role / a named person / custom; templates
   with `{{type}}`, `{{record}}`, `{{status}}`, `{{from}}`, `{{to}}`, `{{by}}`, `{{note}}`, `{{link}}`; default
   EN + HI templates and one default rule per event that is **off** until an admin turns it on (records are
   company-defined; nothing should start messaging by itself). People are not told about their own actions
   (decision 36). Follow how the other modules register events, templates and `RULE_UPGRADES`.
3. **Public API** under `/api/v1` (API key, decision 92; same services as the screens, so permissions and audit
   hold): list record types; list / get / create / update records of a type; move a record (action + note).
   In OpenAPI. Webhooks: a test that a `record.status_changed` delivery is made with the documented body.
4. **Build a record type with AI.** On the record types page: "Build with AI" → describe it in words (or
   Dictate) → the AI proposes name, plural, prefix, fields (the shared field types), child tables, statuses with
   kinds, moves with who may make them → the draft opens in the type editor **unsaved**; the person edits and
   saves. Prompt file `ai/prompts/record-type.v1.ts`, zod-validated output, checked by
   `checkRecordDefinition` with the problems sent back to the model once (like process drafts, decision 59);
   logged in `ai_usage`; without an AI key the button says "Connect AI in System Master". Tests use the fake LLM
   the AI tests already use.
5. Web strings in `locales/parts/records-reach.{en,hi}.json`; every new control works at 380 px.

## Tests (row id in the name)
`U7:` a move starts a process with mapped values and both links; a refusing start form undoes the move; a
notification rule on `record.status_changed` reaches the creator but not the actor; `/api/v1` create → move →
get with an API key, scoped to its company and permissions; the webhook delivery. `U8:` a draft is returned and
nothing is saved; an unsound draft is sent back once; no key → the documented error.

## Ownership
Yours: `apps/api/src/modules/records/**`, `apps/web/src/modules/records/**`, the record parts of
`platform/v1.ts`, `ai/records.ts` + its prompt, the record entries in the notify defaults. Not yours:
`reports/**` and the reportable index (package I), Live FMS / documents / KPI (package G), `e2e/**` (package J).
