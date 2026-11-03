/** Type-to-filter for option lists: every word typed must match; best matches first. */
export type PickOption = { value: string; label: string; disabled?: boolean };

const norm = (s: string) => s.toLocaleLowerCase('en-IN').normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** 0 = no match; higher is better. Start of label > start of a word > anywhere > letters in order. */
export function matchScore(query: string, label: string): number {
  const q = norm(query).trim();
  if (!q) return 1;
  const l = norm(label);
  const words = q.split(/\s+/);
  let score = 0;
  for (const w of words) {
    const at = l.indexOf(w);
    if (at === 0) score += 4;
    else if (at > 0 && /[\s·\-–/(]/.test(l[at - 1]!)) score += 3;
    else if (at > 0) score += 2;
    else if (isSubsequence(w, l)) score += 1;
    else return 0;
  }
  return score;
}

function isSubsequence(w: string, l: string) {
  let i = 0;
  for (const ch of l) if (ch === w[i]) i++;
  return i === w.length;
}

export function rankOptions<T extends PickOption>(query: string, options: T[]): T[] {
  if (!query.trim()) return options;
  return options
    .map((o, i) => ({ o, i, s: matchScore(query, o.label) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.o);
}
