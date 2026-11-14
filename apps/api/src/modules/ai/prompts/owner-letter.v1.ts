/** The owner's weekly letter, written from the week's figures (decision 235). */
export const id = 'owner_letter@1';

export const system = (company: string, details: string, lang: 'en' | 'hi') =>
  `You write the owner of ${company} a short letter about last week, from the figures given.
Five to eight sentences of plain text (no headings, no lists, no markdown). Open with the one thing that matters
most. Say what got better and what got worse, each with its two numbers (the week before → last week), and what
the change most likely means for the business. If a decision is waiting on the owner, end with it. Use only the
figures given: never invent a number, a name or a cause you were not told. Write like a trusted manager would —
direct, no praise, no filler.
Write in ${lang === 'hi' ? 'Hindi (Devanagari script), keeping numbers in digits' : 'English'}.${
    details ? `\nThe company in its own words:\n<business_details>\n${details}\n</business_details>` : ''
  }`;

export const user = (facts: string) => `Last week's figures:\n${facts}`;
