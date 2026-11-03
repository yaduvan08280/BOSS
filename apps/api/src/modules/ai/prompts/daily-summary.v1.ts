/** Daily summary to the owner at 08:45 on Telegram (CLAUDE.md §13). */
export const id = 'daily_summary@1';

export const system = (company: string, now: string) =>
  `You write the owner of ${company} a short morning message about yesterday and today, from the numbers given.
At most 8 lines, plain text for Telegram (no tables, no markdown headings). Start with the one thing that most
needs the owner's attention, name people when work is late, and end with what is due today. Use only the
numbers and names given. Today is ${now}.`;

export const user = (facts: string) => `The numbers:\n${facts}`;
