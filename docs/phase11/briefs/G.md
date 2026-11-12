# Package G — Showing values anywhere (row L18, plan §2.5)

**Row L18:** linked, list and formula values show as columns in Live FMS, in documents (`{{field.column}}`), in
KPI cards and in notification templates.

## What exists
- Values are stored as text with links beside them under `_refs` (`packages/shared/src/fms/links.ts`); a linked
  row's other values are its `columns` (`masters/options.ts` `lookupRefs`, `masters/columns.ts` `sourceColumns`).
- The record drawer already shows linked values (`apps/web/src/modules/fms/RecordValues.tsx`, `record-links.ts`).
- Formula values are stored like typed values (`forms/formula.ts`); remembered-list values are plain text.

## Build
1. **One path language** in `packages/shared` (pure, unit-tested): `field` = the record's stored value;
   `field.column` = a column of the row the field links to (`customer.city`, `item.rate`, `booking.guest_name`),
   read **live** through the link when it still resolves, else empty. A helper lists the paths a flow offers
   (start fields + step fields, and for each linked field its source's columns) for pickers.
2. **Live FMS columns**: per flow, an admin (`fms.edit`) chooses extra columns from those paths (stored on the
   flow, not in the immutable version — it is a view setting); the records table shows them at 1440 px and as
   lines on the phone cards; values come from the server in one query per page (no N+1: resolve links in bulk).
   Sorting/filtering by these columns is NOT required here (reportable fields are package I).
3. **Documents**: document templates / document-type field mapping accept `{{field}}` and `{{field.column}}`
   anywhere text is rendered (title, party, body lines, terms). Formula numbers print with Indian grouping and
   2 decimals where the field is an amount; dates DD/MM/YYYY. Unknown paths print empty and are reported in the
   design screen as a warning, never as raw braces in a PDF.
4. **KPI cards**: a card's source may be any number-like path — a number/amount field, a formula field, a
   numeric column of a linked row (`item.rate`) — and "Count" may group by a text path (a remembered-list field
   or a linked field). Keep the existing aggregations and periods.
5. **Notification templates**: FMS events (`fms.step_assigned`, `fms.step_due_soon`, `fms.step_late`,
   `fms.record_started`, `fms.record_closed`, `fms.approval_needed`) can use `{{data.<path>}}` placeholders that
   are filled from the record's values (and linked columns); the template editor's variable list offers them when
   a flow is chosen. Missing values render empty. WhatsApp numbering on submit must keep working.
6. Web: the column chooser (works at 380 px as a bottom sheet), the path picker shared by documents / KPI /
   templates, EN + HI strings in `locales/parts/show.{en,hi}.json`.

## Tests (row id in the name)
`L18:` tests for: the path resolver (unit); Live FMS list returning chosen columns incl. a linked column after the
linked row was renamed; a document rendered with `{{field.column}}` and a formula value; a KPI card totalling a
formula field and one counting by a list field; a notification rendered with `{{data.<path>}}`; company scoping
(a link to another company's row never resolves).

## Ownership
Yours: FMS live list / columns (`fms/queries.ts`, Live FMS web), `fms/documents.ts` rendering, KPI cards, the
notify template renderer's variable handling, `packages/shared/src/fms/paths.ts` (new). Not yours:
`apps/api/src/modules/records/**` (package H), `reports/**` (package I), `e2e/**` (package J).
