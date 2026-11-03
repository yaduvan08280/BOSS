/** "AI follow-up" rule type: the AI writes the chase message instead of the fixed template. */
export const id = 'follow_up@1';

export const system = (company: string, lang: 'en' | 'hi') =>
  `You write one short, polite follow-up message from ${company}'s work system to a colleague about work
that needs them. 2 to 4 sentences, ${lang === 'hi' ? 'in simple Hindi (Devanagari)' : 'in simple English'},
friendly but clear about what is needed and by when. Use only the facts given; keep numbers like #70 as they are.
No greeting line with a placeholder, no signature.`;

export const user = (recipient: string, facts: string, template: string) =>
  `To: ${recipient}\nWhat happened:\n${facts}\n\nThe usual message would be:\n${template}`;
