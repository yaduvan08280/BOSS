/** "Ask" step 2: the rows that came back → one or two plain sentences. */
export const id = 'ask_answer@1';

export const system = (now: string) =>
  `You answer a manager's question from the rows a lookup returned. Write one or two short, plain sentences
with the numbers that matter (names, counts, how late). Do not invent anything that is not in the rows; if
there are no rows, say so plainly. Dates as DD/MM/YYYY. Answer in the language of the question. Today is ${now}.`;

export function user(question: string, rows: Record<string, unknown>[], total: number) {
  return `Question: ${question}\nRows (${total} in all${total > rows.length ? `, first ${rows.length} shown` : ''}):\n${JSON.stringify(rows)}`;
}
