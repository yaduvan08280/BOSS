import { FORMULA_MAX_LENGTH, type FormulaProblem } from './types';

export type Symbol_ = '+' | '-' | '*' | '/' | '%' | '(' | ')' | ',' | '<' | '>' | '<=' | '>=' | '=' | '!=';

export type Token = { at: number; end: number } & (
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'str'; v: string }
  | { t: 'sym'; v: Symbol_ }
  | { t: 'end' }
);

/** Thrown inside the parser only; `parseFormula` turns it into a result. */
export class FormulaSyntaxError extends Error {
  constructor(readonly problem: FormulaProblem) {
    super(problem.code);
  }
}

export function fail(
  code: FormulaProblem['code'],
  at: number,
  end: number,
  name?: string,
  other?: string,
): never {
  throw new FormulaSyntaxError({
    code,
    at,
    end,
    ...(name !== undefined ? { name } : {}),
    ...(other !== undefined ? { other } : {}),
  });
}

/** Every way people type the signs: the keyboard's, the phone's (× ÷ −) and the ones word processors swap in. */
const SYMBOLS: [string, Symbol_][] = [
  ['<=', '<='],
  ['>=', '>='],
  ['!=', '!='],
  ['<>', '!='],
  ['==', '='],
  ['≤', '<='],
  ['≥', '>='],
  ['≠', '!='],
  ['+', '+'],
  ['-', '-'],
  ['−', '-'], // U+2212 minus
  ['–', '-'], // en dash
  ['*', '*'],
  ['×', '*'],
  ['/', '/'],
  ['÷', '/'],
  ['%', '%'],
  ['(', '('],
  [')', ')'],
  [',', ','],
  ['<', '<'],
  ['>', '>'],
  ['=', '='],
];

const SHOWN: Record<Symbol_, string> = {
  '+': '+',
  '-': '−',
  '*': '×',
  '/': '÷',
  '%': '%',
  '(': '(',
  ')': ')',
  ',': ',',
  '<': '<',
  '>': '>',
  '<=': '≤',
  '>=': '≥',
  '=': '=',
  '!=': '≠',
};

/** A token as it is named in a message: signs the way people write them on paper, the rest as typed. */
export function shown(tok: Token, text: string): string {
  return tok.t === 'sym' ? SHOWN[tok.v] : text.slice(tok.at, tok.end);
}

const SINGLE = "'‘’";
const DOUBLE = '"“”';
const isDigit = (c: string) => c >= '0' && c <= '9';
const isLetter = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

/** The text as a list of numbers, names, quoted texts and signs. Anything else is refused. */
export function tokenize(text: string): Token[] {
  if (text.length > FORMULA_MAX_LENGTH) fail('tooLong', FORMULA_MAX_LENGTH, text.length);
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const at = i;
    if (isDigit(c) || (c === '.' && isDigit(text[i + 1] ?? ''))) {
      while (i < text.length && (isDigit(text[i]!) || text[i] === '.')) i++;
      const raw = text.slice(at, i);
      if (!/^(\d+\.?\d*|\.\d+)$/.test(raw)) fail('badNumber', at, i, raw);
      out.push({ t: 'num', v: Number(raw), at, end: i });
      continue;
    }
    if (isLetter(c)) {
      while (i < text.length && (isLetter(text[i]!) || isDigit(text[i]!) || text[i] === '_')) i++;
      out.push({ t: 'id', v: text.slice(at, i).toLowerCase(), at, end: i });
      continue;
    }
    if (SINGLE.includes(c) || DOUBLE.includes(c)) {
      const closers = SINGLE.includes(c) ? SINGLE : DOUBLE;
      i++;
      while (i < text.length && !closers.includes(text[i]!)) i++;
      if (i >= text.length) fail('openText', at, text.length);
      out.push({ t: 'str', v: text.slice(at + 1, i), at, end: ++i });
      continue;
    }
    const sym = SYMBOLS.find(([s]) => text.startsWith(s, i));
    if (!sym) {
      // One whole character, even when it is made of two code units.
      const ch = String.fromCodePoint(text.codePointAt(i)!);
      return fail('badChar', at, at + ch.length, ch);
    }
    i += sym[0].length;
    out.push({ t: 'sym', v: sym[1], at, end: i });
  }
  out.push({ t: 'end', at: text.length, end: text.length });
  return out;
}
