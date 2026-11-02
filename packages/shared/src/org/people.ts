import { looksLikeEmail, normalizeMobile } from '../format/phone';

/** One line of a pasted people list, after parsing and checks. */
export type PastedPerson = {
  line: number;
  name: string;
  mobile: string | null;
  email: string | null;
  department: string | null;
  designation: string | null;
  errors: string[];
};

const HEADERS: Record<keyof Omit<PastedPerson, 'line' | 'errors'>, RegExp> = {
  name: /^(full\s*)?name$/i,
  mobile: /^(mobile|phone|mobile\s*no\.?|phone\s*no\.?|contact)$/i,
  email: /^e-?mail$/i,
  department: /^(department|dept\.?)$/i,
  designation: /^(designation|title|post)$/i,
};
const DEFAULT_ORDER = ['name', 'mobile', 'email', 'department', 'designation'] as const;

/** Split one CSV line, honouring "quoted, values". */
function splitLine(line: string, sep: string): string[] {
  if (sep === '\t') return line.split('\t').map((c) => c.trim());
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Parse a list pasted from Excel/Sheets (tab separated) or typed as CSV.
 * Columns: name, mobile, email, department, designation — or any order if the first line is a header.
 */
export function parsePeopleList(text: string): PastedPerson[] {
  const lines = text
    .split(/\r?\n/)
    .map((l, i) => ({ raw: l, line: i + 1 }))
    .filter((l) => l.raw.trim());
  if (lines.length === 0) return [];
  const sep = lines.some((l) => l.raw.includes('\t'))
    ? '\t'
    : lines.some((l) => l.raw.includes(';')) && !lines.some((l) => l.raw.includes(','))
      ? ';'
      : ',';

  let order: (keyof typeof HEADERS | null)[] = [...DEFAULT_ORDER];
  const first = splitLine(lines[0]!.raw, sep);
  const headerMap = first.map(
    (cell) => (Object.keys(HEADERS) as (keyof typeof HEADERS)[]).find((k) => HEADERS[k].test(cell)) ?? null,
  );
  if (headerMap.includes('name')) {
    order = headerMap;
    lines.shift();
  }

  const seenMobile = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  return lines.map(({ raw, line }) => {
    const cells = splitLine(raw, sep);
    const get = (key: keyof typeof HEADERS) => {
      const idx = order.indexOf(key);
      const v = idx >= 0 ? cells[idx]?.trim() : '';
      return v ? v : null;
    };
    const errors: string[] = [];
    const name = (get('name') ?? '').replace(/\s+/g, ' ');
    if (!name) errors.push('Name is missing');
    const rawMobile = get('mobile');
    const mobile = rawMobile ? normalizeMobile(rawMobile) : null;
    if (rawMobile && !mobile) errors.push(`"${rawMobile}" is not a valid mobile number`);
    const rawEmail = get('email');
    const email = rawEmail ? rawEmail.toLowerCase() : null;
    if (email && !looksLikeEmail(email)) errors.push(`"${rawEmail}" is not a valid email`);
    if (mobile) {
      if (seenMobile.has(mobile)) errors.push(`Same mobile as line ${seenMobile.get(mobile)}`);
      else seenMobile.set(mobile, line);
    }
    if (email && looksLikeEmail(email)) {
      if (seenEmail.has(email)) errors.push(`Same email as line ${seenEmail.get(email)}`);
      else seenEmail.set(email, line);
    }
    return {
      line,
      name,
      mobile,
      email,
      department: get('department'),
      designation: get('designation'),
      errors,
    };
  });
}
