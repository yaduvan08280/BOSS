import { ASK_DATE_WORDS, ASK_VIEWS, ASK_VIEW_KEYS, type AskViewKey } from '@mono/shared';
import { aboutCompany, type CompanyContext } from './context';

/**
 * "Ask" step 1: the question → a plan over the read-only views, or the id of a saved report that already answers
 * it. The model never writes SQL. (v2: saved reports are offered — plan §2.7. v3, 14/11/2026: business views —
 * stock, stock moves, items sold, bills, attendance, table bookings — offered only to people with the right.)
 */
export type OfferedReport = { id: string; name: string; about: string };
export const id = 'ask@3';

export function system(
  c: CompanyContext,
  reports: OfferedReport[] = [],
  allowed: AskViewKey[] = ASK_VIEW_KEYS,
) {
  const views = Object.entries(ASK_VIEWS)
    .filter(([k]) => allowed.includes(k as AskViewKey))
    .map(
      ([k, v]) =>
        `${k} — ${v.about}\n${Object.entries(v.columns)
          .map(([col, d]) => `  ${col} (${d.type}): ${d.about}`)
          .join('\n')}`,
    )
    .join('\n\n');
  return `You answer questions about a company's work by planning a read-only lookup in one of these views.
Pick the view, the columns to show (or none for the usual ones), filters, and optionally a group with a
count/sum/avg/min/max. Names of people, departments and processes are matched with "contains".
Dates: give "YYYY-MM-DD" or one of these words: ${ASK_DATE_WORDS.join(', ')}. "This week" = from
start_of_week; "last month" = from start_of_last_month to start_of_month. Late or overdue work: is_late = true.
Stock: "kitchen stock", "bar stock", "cold room" — filter location contains the word (e.g. location contains
"kitchen"); location_kind is KITCHEN, BAR, COLD_ROOM or STORE. Quantities are in each item's own unit (ml, kg,
pc…): when the question compares items of different units, include unit and value, or rank by value. For "the most / least" of single items, list the rows sorted by qty (no group) so the
unit shows; group only for totals across items or places. "Sales", "sold", "best seller": use sales_items
(sum amount or qty, is_void = false); bills, covers and payment modes use bills.
Keep limit at 50 unless the question asks for more (at most 200). To rank by a group's number, sort by
"value". If no view can answer the question, set answerable false and say why in one sentence.
Today is ${c.now} (${c.timezone}).

Views:
${views}

${
  reports.length
    ? `Saved reports (made by people here from their own processes and records). When one answers the question as
it stands, set "report" to its id and leave the rest as it is — MONO shows that report. Otherwise "report" is null.
${reports.map((r) => `  ${r.id} — ${r.name}: ${r.about}`).join('\n')}

`
    : ''
}${aboutCompany(c)}`;
}

export const user = (question: string) => `Question:\n<question>\n${question}\n</question>`;
