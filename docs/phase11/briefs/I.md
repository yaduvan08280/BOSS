# Package I — Reportable fields and the report builder (rows U9, U10, plan §2.7)

**U9:** a field marked reportable keeps a typed, indexed copy; existing records are back-filled by the worker.
**U10:** report builder: source → columns → filters → group → totals → table or chart; save, share by role,
schedule, export; Ask can read it.

## What exists
- `reportable?: boolean` on a field (shared definition) and the editor toggle (`field-extras/ReportExtras.tsx`).
- The form pipeline (`apps/api/src/modules/forms/index.ts`): stages with `check` / `commit` / `release`, run for
  process start forms and steps, master rows and record types (`scope.owner`, `scope.recordId`).
- Record lists already query JSON with safe SQL (`records/query.ts`) — reuse the approach, not the file.
- Ask (decision 60): the model fills a plan over whitelisted read-only views; MONO checks every name.

## Build
1. **The index (U9).** A table of typed copies, one row per (owner kind, owner id, record id, field key):
   `text` (lower-cased copy for matching + the shown text), `number` (Decimal), `date` (date / timestamptz),
   `ref` (the link under `_refs`), plus `company_id`, with indexes for (company, owner, field, value). Field
   types map: text / dropdown / master / list → text (+ ref); number / amount / formula → number; date /
   date-time → date; yes-no → text. Written by a new pipeline stage (`forms/report.ts`: `commit` upserts the
   record's reportable values in the same transaction, `release` removes them when a record is cancelled or
   deleted). For processes a record's values come from the start form and each finished step — the same
   `recordId` (the FMS record) for all of them. Turning "reportable" on for a field of existing records queues a
   **worker back-fill** job (pg-boss, batches, idempotent, resumable, progress visible in the editor:
   "Copying 1,240 of 8,000"); turning it off removes the copies. Reads never trust the index for a field whose
   back-fill is not finished (the report says so).
2. **Report engine (pure plan → safe SQL).** A report definition (zod, in `packages/shared`): source (a flow or
   a record type) → columns (built-ins: number, title, status, started / made on, by; and reportable fields) →
   filters (eq, contains, between, in the last N days, this week / month / FY, empty / filled) → group by (a text
   field, or a date by day / week / month / quarter / FY, company time zone, FY April–March) → measures (count,
   total, average, min, max of a number field) → sort, limit. Every name is checked against the source's
   definition; every value is bound; `company_id` always added; statement timeout; read-only. Results: rows +
   totals row. Non-reportable fields may be used only while the source has few records (say ≤ 2,000), read from
   JSON, with a note "mark it reportable for speed".
3. **Screens** (`apps/web/src/modules/reports/`): Reports list (mine + shared with my role), builder as steps
   (Source → Columns → Filters → Group → Totals → Look), live preview, table or chart (bar / line / pie as small
   SVG components like the CRM's), save / save as, share by role (view), **schedule** (daily / weekly / monthly at
   a time → Telegram and / or email to chosen people, through the notification outbox with the PDF attached or a
   link), **export** Excel and PDF. Left menu entry "Reports" (SYSTEMS section). Phone: the builder is a stepper,
   tables become card lists, charts scroll inside their card. Money as ₹ lakh / crore, dates DD/MM/YYYY.
4. **Permissions:** a new module key `reports` (view / create / edit / admin). A report only returns what its
   reader may see in the source: `fms.view` for a flow; the record type's own view right for a record type. A
   shared report run by a person without that right says so instead of showing data. Company scoping tested.
5. **KPI cards read the same source:** a report with one measure can be pinned as a card on a flow's dashboard
   (a link is enough if the KPI code belongs to package G: expose `runReport` and note it in the hand-over).
6. **Ask:** saved reports the person may run are offered to Ask as extra read-only sources ("report:<id>": its
   columns and measures); the answer comes from running the report through the same engine, never from model SQL.
7. Scheduled sends once per slot (`JobMark`), in the company time zone; a failing report is reported to its
   owner, not retried forever.

## Tests (row id in the name)
`U9:` saving a record writes typed copies (text, number, date, ref); editing updates, cancelling removes; the
back-fill fills old records in batches and can be run twice; turning it off removes. `U10:` a "Site visit"
record type grouped by month with count and total (the plan's "done when"); a flow report filtered by a date
range and a linked customer; a hostile field name / operator is refused; another company gets nothing; sharing by
role; export produces a real .xlsx and a PDF; a schedule sends once; Ask answers from a saved report (fake LLM).

## Ownership
Yours: `apps/api/src/modules/reports/**`, `apps/api/src/modules/forms/report.ts`, `prisma/schema/reports.prisma`
+ migration, `packages/shared/src/reports/**`, `apps/web/src/modules/reports/**`, the worker jobs for back-fill
and schedules, the Ask catalog entry. One-line additions: `forms/index.ts` (register the stage), `app.ts`,
`router.tsx`, `nav.ts`, `permissions.ts`, `scope.ts`, shared `index.ts`. Not yours: `records/**` (package H),
Live FMS / documents / KPI internals (package G), `e2e/**` (package J).

This is the largest package: build in the order above and commit after each numbered part, so whatever is
finished is usable if you are cut off. If time runs short, U9 + the engine + list / builder / table / export
come before charts, schedules and Ask — and say exactly what is missing.
