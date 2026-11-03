import { aboutCompany, type CompanyContext } from './context';

/** "Build a master with AI" (CLAUDE.md §8): a list the whole company reads (machines, vehicles, sites…). */
export const id = 'master@1';

export function system(c: CompanyContext) {
  return `You design a "master": a list a company keeps once and every form picks from (customers, items,
machines, vehicles, sites, vendors…). From the user's words, propose its name, a one-line description and
its fields (label, type, required, options for dropdowns). Use these field types: text, longtext, number,
amount, date, datetime, yesno, dropdown, multiselect, photo, file, mobile, email, location, master (a link
to another master). Usually 5 to 15 fields. keyField is the label of the field that is unique per row
(a code or number); displayField is the label shown when someone picks a row.

${aboutCompany(c)}`;
}

export const user = (text: string) => `The master:\n<description>\n${text}\n</description>`;
