/**
 * "Import many" for the Delegation sheet: rows from a CSV/TSV paste or an Excel sheet.
 * Columns (any order with a header row): doer, planned date, task, verifier, proof.
 * People are matched by employee code, mobile (last 10 digits) or exact name.
 */
export type ImportPerson = { id: string; code: string; name: string; mobile: string | null };
export type ImportedTask = {
  line: number;
  doerId: string | null;
  doerLabel: string;
  plannedAt: string | null;
  description: string;
  verifierId: string | null;
  verifierLabel: string;
  requireProof: boolean;
  errors: string[];
};

const HEAD: Record<string, RegExp> = {
  doer: /^(doer|assign(ed)? to|person|who)$/i,
  date: /^(planned( date)?|due( date)?|date|deadline)$/i,
  task: /^(task|description|work|what)$/i,
  verifier: /^(verifier|check(ed)? by)$/i,
  proof: /^(proof|photo|require proof)$/i,
};
const DEFAULT = ['doer', 'date', 'task', 'verifier', 'proof'];

/** "05/11/2026", "05/11/2026 18:00", "2026-11-05", Excel serial numbers → local date + minutes. */
export function parseLocalDateTime(
  raw: string,
  defaultMinutes = 18 * 60,
): { date: string; minutes: number } | null {
  const s = raw.trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    const ms = Math.round((serial - 25569) * 86_400_000);
    const d = new Date(ms);
    const minutes = Math.round((serial % 1) * 1440);
    return { date: d.toISOString().slice(0, 10), minutes: minutes || defaultMinutes };
  }
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s);
  if (m) {
    const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const date = `${year}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    // Round-trip so 31/02 is rejected instead of rolling over into March.
    const real = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1]))).toISOString().slice(0, 10);
    if (real !== date) return null;
    return { date, minutes: m[4] ? Number(m[4]) * 60 + Number(m[5]) : defaultMinutes };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (m)
    return {
      date: `${m[1]}-${m[2]}-${m[3]}`,
      minutes: m[4] ? Number(m[4]) * 60 + Number(m[5]) : defaultMinutes,
    };
  return null;
}

function findPerson(people: ImportPerson[], label: string): ImportPerson | null {
  const l = label.trim().toLowerCase();
  if (!l) return null;
  const digits = l.replace(/\D/g, '');
  return (
    people.find((p) => p.code.toLowerCase() === l) ??
    (digits.length >= 10 ? people.find((p) => p.mobile?.endsWith(digits.slice(-10))) : undefined) ??
    people.find((p) => p.name.toLowerCase() === l) ??
    null
  );
}

export function parseTaskRows(
  rows: string[][],
  people: ImportPerson[],
  toInstant: (date: string, minutes: number) => string,
): ImportedTask[] {
  const clean = rows.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some(Boolean));
  if (!clean.length) return [];
  let order = DEFAULT;
  const head = clean[0]!.map((c) => Object.keys(HEAD).find((k) => HEAD[k]!.test(c)) ?? '');
  const hasHeader = head.includes('doer') || head.includes('task');
  if (hasHeader) order = head;
  return clean.slice(hasHeader ? 1 : 0).map((cells, i) => {
    const get = (k: string) => (order.indexOf(k) >= 0 ? (cells[order.indexOf(k)] ?? '') : '');
    const errors: string[] = [];
    const doerLabel = get('doer');
    const doer = findPerson(people, doerLabel);
    if (!doer) errors.push(doerLabel ? `No person called "${doerLabel}"` : 'Doer is missing');
    const parsed = get('date') ? parseLocalDateTime(get('date')) : null;
    if (!parsed)
      errors.push(
        get('date') ? `"${get('date')}" is not a date (use DD/MM/YYYY)` : 'Planned date is missing',
      );
    const description = get('task');
    if (description.length < 3) errors.push('Task is missing');
    const verifierLabel = get('verifier');
    const verifier = verifierLabel ? findPerson(people, verifierLabel) : null;
    if (verifierLabel && !verifier) errors.push(`No person called "${verifierLabel}"`);
    return {
      line: i + (hasHeader ? 2 : 1),
      doerId: doer?.id ?? null,
      doerLabel: doer?.name ?? doerLabel,
      plannedAt: parsed ? toInstant(parsed.date, parsed.minutes) : null,
      description,
      verifierId: verifier?.id ?? null,
      verifierLabel: verifier?.name ?? verifierLabel,
      requireProof: /^(y|yes|true|1|haan|हाँ)$/i.test(get('proof')),
      errors,
    };
  });
}

/** Split pasted text into rows (tab or comma separated, quotes respected). */
export function splitTable(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : ',';
  return lines.map((line) => {
    if (sep === '\t') return line.split('\t');
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (ch === ',' && !q) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  });
}
