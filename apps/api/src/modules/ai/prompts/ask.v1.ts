import { ASK_DATE_WORDS, ASK_VIEWS } from '@mono/shared';
import { aboutCompany, type CompanyContext } from './context';

/** "Ask" step 1: the question → a plan over the read-only views. The model never writes SQL. */
export const id = 'ask@1';

export function system(c: CompanyContext) {
  const views = Object.entries(ASK_VIEWS)
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
Keep limit at 50 unless the question asks for more (at most 200). To rank by a group's number, sort by
"value". If no view can answer the question, set answerable false and say why in one sentence.
Today is ${c.now} (${c.timezone}).

Views:
${views}

${aboutCompany(c)}`;
}

export const user = (question: string) => `Question:\n<question>\n${question}\n</question>`;
