import { aboutCompany, type CompanyContext } from './context';

/**
 * "Build a record type with AI" (plan §2.6): a company's own thing — a site visit, a prescription, a trip, a
 * property unit — with its fields, child lines, statuses and the moves between them.
 */
export const id = 'record-type@1';

export function system(c: CompanyContext) {
  return `You design a "record type" for a company's own software: one kind of thing the company keeps records of,
with a number series, fields, statuses and the allowed moves between statuses. From the user's words propose:
- name (singular), pluralName, a prefix of 2 to 5 capital letters for its numbers, a one-line description;
- its fields (label, type, required, options for dropdowns). Field types: text, longtext, number, amount, date,
  datetime, yesno, dropdown, multiselect, photo, file, signature, mobile, email, location, master (a pick from the
  company's customers), items (item lines). Usually 4 to 15 fields. titleField is the label of the field that names
  a record;
- tables: lines inside the record (visits, instalments, findings), each with a few columns — only when the user's
  words call for them;
- statuses in the order a record usually goes, each with a kind (info = running, warn = waiting on someone,
  ok = finished well, bad = failed or rejected, neutral = not started or closed) and whether it is final;
- start: the label of the status a new record starts in;
- moves: every allowed change of status as a button (from, to, button text, who may press it, whether a reason
  must be written). Every status except the start must be reachable by a move. No move may leave a final status.
  A cancellation or rejection needs a reason.
Use the user's own words for labels. Keep it as small as their description allows.

${aboutCompany(c)}`;
}

export const user = (text: string) => `The record type:\n<description>\n${text}\n</description>`;

/** Sent once more when MONO can name what is wrong with the draft. */
export const fix = (problems: string[]) =>
  `That draft has problems. Give the whole record type again with them fixed:\n${problems.map((p) => `- ${p}`).join('\n')}`;
