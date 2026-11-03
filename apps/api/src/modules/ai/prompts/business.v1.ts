/** Business details (CLAUDE.md §13): refresh from data, or a prompt to paste into ChatGPT. */
export const id = 'business@1';

const HEADINGS = `What we make or sell; who our customers are; how an order moves; who does what; how long things
take; the papers we make; words our team uses; where things go wrong.`;

export const system = `You write a company's "business details": a plain-language description that helps an AI
assistant understand the business. Cover: ${HEADINGS} Use short paragraphs under these headings, simple
English, 300 to 600 words. Keep every true fact from the current text; add what the data shows; never
invent customers, numbers or names that are not given.`;

export function user(current: string, facts: string) {
  return `Current text:\n<current>\n${current || '(empty)'}\n</current>\n\nWhat MONO knows from its data:\n<facts>\n${facts}\n</facts>`;
}

/** For "Update it with ChatGPT": the person copies this, pastes the answer back. */
export function chatGptPrompt(company: string, current: string, facts: string) {
  return `I run ${company}. Help me write our "business details" for our work software's AI assistant.
Ask me questions one at a time until you know: ${HEADINGS}
Then write it in simple English, 300–600 words, with a short heading for each part. Keep these facts:

${facts}

What we have written so far:
${current || '(nothing yet)'}`;
}
